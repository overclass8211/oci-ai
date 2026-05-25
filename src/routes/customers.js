const router = require('express').Router();
const fs = require('fs');
const pool = require('../db');
const upload = require('../middleware/upload');
const { handleError, friendlyError } = require('../middleware/errorHandler');
const { getUserId } = require('../middleware/auth');
const { validateId, schema } = require('../middleware/validate');
const { requireFeature } = require('../middleware/featureGuard');
const { parsePage, pageResult } = require('../utils/routeHelper');
const { fromExcelBuffer } = require('../utils/excelHelper');
const { sendExport, normalizeFormat } = require('../utils/exportHelper');
const {
  genAI,
  MODEL_FAST,
  SAFETY_SETTINGS,
  logTokenUsage,
  runStream,
  sseStart,
  sseError,
} = require('../services/gemini');

// JSON 안전 파싱 (실패 시 fallback)
function safeJson(s, fallback) {
  if (!s) return fallback;
  if (typeof s === 'object') return s;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

const CUST_COLS = [
  { key: 'name', label: '고객사명' },
  { key: 'region', label: '구분' },
  { key: 'country', label: '국가' },
  { key: 'industry', label: '산업군' },
  { key: 'contact_person', label: '담당자' },
  { key: 'phone', label: '연락처' },
  { key: 'email', label: '이메일' },
  { key: 'address', label: '주소' },
];

router.get('/', async (req, res) => {
  try {
    const { search, region, industry, autocomplete } = req.query;
    const { page, limit, offset } = parsePage(req.query);

    // ── Autocomplete 모드 (캘린더 자동완성 등) ──────────────
    // - Smart Ranking 적용 (정확/시작/부분 일치 + 활성딜 + 본인담당 + 최근활동)
    // - 응답에 active_deals_count, is_my_customer, last_activity_at 포함
    // - 기존 응답 형식 유지 (success, data) — 추가 필드만 더해짐
    if (autocomplete === '1' && search) {
      const userId = getUserId(req);
      const q = String(search).trim();
      if (q.length < 2) {
        return res.json({ success: true, data: [], query: q });
      }
      const acLimit = Math.min(20, parseInt(req.query.limit) || 10);
      const [rows] = await pool.query(
        `
        SELECT
          c.id, c.name, c.industry, c.region, c.country, c.contact_person,
          c.email, c.phone,
          (SELECT COUNT(*) FROM leads l
             WHERE l.customer_id = c.id
               AND l.stage NOT IN ('won','lost','dropped')) AS active_deals_count,
          (SELECT MAX(a.performed_at) FROM activities a
             JOIN leads l ON l.id = a.lead_id
            WHERE l.customer_id = c.id) AS last_activity_at,
          (SELECT 1 FROM leads l
             WHERE l.customer_id = c.id AND l.assigned_to = ?
             LIMIT 1) AS is_my_customer,
          (
            CASE WHEN c.name = ? THEN 100
                 WHEN c.name LIKE ? THEN 70
                 WHEN c.name LIKE ? THEN 40
                 ELSE 10 END
          ) AS match_score
        FROM customers c
        WHERE c.name LIKE ? OR c.contact_person LIKE ?
        ORDER BY
          match_score DESC,
          is_my_customer DESC,
          active_deals_count DESC,
          last_activity_at DESC,
          c.name ASC
        LIMIT ?
        `,
        [userId || 0, q, `${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, acLimit]
      );
      return res.json({
        success: true,
        data: rows.map(r => ({
          ...r,
          is_my_customer: !!r.is_my_customer,
          active_deals_count: Number(r.active_deals_count) || 0,
        })),
        query: q,
      });
    }

    // ── 기본 목록 조회 (기존 동작 유지) ─────────────────────
    let where = 'WHERE 1=1';
    const params = [];
    if (search) {
      where += ' AND (name LIKE ? OR contact_person LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (region) {
      where += ' AND region = ?';
      params.push(region);
    }
    if (industry) {
      where += ' AND industry = ?';
      params.push(industry);
    }

    // v6.0.0: 카드/리스트에 표시할 모듈별 카운트 4종을 서브쿼리로 enrich
    //   - related_deals_cnt: leads(customer_name = c.name) — 모달 [관련 딜] 탭과
    //     **정확히 동일한 기준** (status 필터 없음, customer_name 매칭)
    //   - quotes_cnt / proposals_cnt / contracts_cnt: customer_id 매칭, 전체 건수
    //   leads.customer_name 인덱스 (initTables.js) 로 50개 카드 +30ms 이내
    const [[countRows], [rows]] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM customers ${where}`, params),
      pool.query(
        `SELECT c.*,
          (SELECT COUNT(*) FROM leads l
             WHERE l.customer_name = c.name) AS related_deals_cnt,
          (SELECT COUNT(*) FROM quotes q
             WHERE q.customer_id = c.id) AS quotes_cnt,
          (SELECT COUNT(*) FROM proposals p
             WHERE p.customer_id = c.id) AS proposals_cnt,
          (SELECT COUNT(*) FROM contracts ct
             WHERE ct.customer_id = c.id) AS contracts_cnt
         FROM customers c
         ${where.replace(/\b(name|contact_person|region|industry)\b/g, 'c.$1')}
         ORDER BY c.name LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ),
    ]);
    const total = Number(countRows[0]?.total ?? 0);
    // 숫자 정규화 (mysql2 driver 반환 시 string 가능성 방지)
    rows.forEach(r => {
      r.related_deals_cnt = Number(r.related_deals_cnt) || 0;
      r.quotes_cnt = Number(r.quotes_cnt) || 0;
      r.proposals_cnt = Number(r.proposals_cnt) || 0;
      r.contracts_cnt = Number(r.contracts_cnt) || 0;
    });
    res.json(pageResult(rows, total, page, limit));
  } catch (err) {
    handleError(res, err);
  }
});

// ── 중복 체크 헬퍼 (고객사명 + 담당자 + 연락처 조합) ──────────
async function findDuplicate(name, contact_person, phone) {
  const cp = contact_person || null;
  const ph = phone || null;
  const [[dup]] = await pool.query(
    `SELECT id, name, contact_person, phone FROM customers
     WHERE name = ? AND (contact_person <=> ?) AND (phone <=> ?)
     LIMIT 1`,
    [name, cp, ph]
  );
  return dup || null;
}

// ── v6.0.0 Phase A4: 회사명 정규화 + 매칭 헬퍼 ─────────────────
// 한국/영문 법인 접미사 제거 + 공백/특수문자 정규화 → LIKE 매칭 정확도 향상
function normalizeCompanyName(name) {
  if (!name) return '';
  let s = String(name).trim();
  // 한국 법인 접미사 제거: (주), ㈜, 주식회사, (유), 유한회사, (재단), 재단법인 등
  s = s.replace(/[(〔（]\s*(주식회사|유한회사|재단법인|사단법인|주|유)\s*[)〕）]/gi, '');
  s = s.replace(/㈜|㈕|㈐|㉾/g, '');
  s = s.replace(/(주식회사|유한회사|재단법인|사단법인)\s*/gi, '');
  // 영문 접미사 제거: Inc., Co., Ltd., Corp., LLC, GmbH, S.A., etc.
  s = s.replace(
    /\s*[,.]?\s*(Inc\.?|Co\.?|Ltd\.?|Corp\.?|LLC|GmbH|S\.A\.?|Limited|Corporation|Company)\b\.?/gi,
    ''
  );
  // 다중 공백 → 단일 공백, trim
  return s.replace(/\s+/g, ' ').trim();
}

// ── GET /match — AI 추출 회사명 → 기존 고객사 매칭 (Phase A4) ─
// Query: ?name=쿼리
// Response: { exact: [...], partial: [...], normalized_query: "..." }
router.get('/match', async (req, res) => {
  try {
    const raw = String(req.query.name || '').trim();
    if (!raw || raw.length < 2) {
      return res.json({
        success: true,
        data: { exact: [], partial: [], normalized_query: raw, raw_query: raw },
      });
    }
    const normalized = normalizeCompanyName(raw);
    if (!normalized || normalized.length < 1) {
      return res.json({
        success: true,
        data: { exact: [], partial: [], normalized_query: normalized, raw_query: raw },
      });
    }
    const escaped = `%${normalized.replace(/[%_]/g, '\\$&')}%`;

    // 1) 정확 매치 (정규화 후 비교) — 모든 candidates 의 정규화된 이름과 비교는 SQL 만으로 불가
    //    → LIKE 로 후보군을 잡고 JS 에서 정규화 비교
    const [rows] = await pool.query(
      `SELECT id, name, industry, region, country, contact_person, phone, email
         FROM customers
        WHERE name LIKE ?
        ORDER BY CHAR_LENGTH(name) ASC
        LIMIT 50`,
      [escaped]
    );
    const exact = [];
    const partial = [];
    for (const r of rows) {
      const rn = normalizeCompanyName(r.name);
      if (rn.toLowerCase() === normalized.toLowerCase()) {
        exact.push(r);
      } else {
        partial.push(r);
      }
      if (exact.length + partial.length >= 10) break;
    }
    res.json({
      success: true,
      data: {
        exact: exact.slice(0, 3),
        partial: partial.slice(0, 5),
        normalized_query: normalized,
        raw_query: raw,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 일괄 등록 (Copy & Paste import) ──────────────────────────
router.post('/bulk', async (req, res) => {
  const { customers } = req.body;
  if (!Array.isArray(customers) || !customers.length)
    return res.status(400).json({ success: false, message: '등록할 데이터가 없습니다.' });

  const inserted = [];
  const errors = [];
  const duplicates = [];
  for (const row of customers) {
    if (!row.name) {
      errors.push({ row, reason: '고객사명 누락' });
      continue;
    }
    try {
      const dup = await findDuplicate(row.name, row.contact_person, row.phone);
      if (dup) {
        duplicates.push({
          row,
          existingId: dup.id,
          reason: `중복 (기존 ID:${dup.id} — ${dup.name} / ${dup.contact_person || '-'} / ${dup.phone || '-'})`,
        });
        continue;
      }
      const [r] = await pool.query(
        `INSERT INTO customers (name, region, country, industry, contact_person, phone, email, address)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          row.name,
          row.region || '국내',
          row.country || null,
          row.industry || null,
          row.contact_person || null,
          row.phone || null,
          row.email || null,
          row.address || null,
        ]
      );
      inserted.push(r.insertId);
    } catch (e) {
      errors.push({ row, reason: e.message });
    }
  }
  res.json({
    success: true,
    inserted: inserted.length,
    duplicates: duplicates.length,
    errors: [...errors, ...duplicates],
  });
});

router.post(
  '/',
  schema({
    name: { type: 'string', required: true, minLen: 1, maxLen: 200 },
    region: { type: 'string', maxLen: 100 },
  }),
  async (req, res) => {
    try {
      const { name, region, country, industry, contact_person, phone, email, address } = req.body;

      // 중복 체크
      const dup = await findDuplicate(name, contact_person, phone);
      if (dup) {
        return res.status(409).json({
          success: false,
          duplicate: true,
          existingId: dup.id,
          message: `이미 등록된 고객사입니다 (${dup.name} / ${dup.contact_person || '담당자 없음'} / ${dup.phone || '연락처 없음'})`,
        });
      }

      const [result] = await pool.query(
        `INSERT INTO customers (name, region, country, industry, contact_person, phone, email, address)
       VALUES (?,?,?,?,?,?,?,?)`,
        [
          name,
          region || '국내',
          country || null,
          industry || null,
          contact_person || null,
          phone || null,
          email || null,
          address || null,
        ]
      );
      res.json({ success: true, id: result.insertId, data: { id: result.insertId } });
    } catch (err) {
      handleError(res, err);
    }
  }
);

// 명함 OCR
router.post('/ocr', requireFeature('ai.ocr'), upload.array('cards', 20), async (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    return res
      .status(400)
      .json({ success: false, error: 'GEMINI_API_KEY가 .env에 설정되지 않았습니다.' });
  }
  if (!req.files || !req.files.length) {
    return res.status(400).json({ success: false, error: '파일이 없습니다.' });
  }

  const ocrModel = genAI.getGenerativeModel({
    model: MODEL_FAST,
    safetySettings: SAFETY_SETTINGS,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const ocrPrompt = `이 명함 이미지에서 정보를 추출해 JSON으로만 반환하세요. 값이 명확히 보이지 않는 필드는 null로 표기.
JSON 형식: {"name":"회사명","contact_person":"이름","industry":"산업군 추정","phone":"전화번호","email":"이메일","address":"주소","region":"국내|해외","country":"국가명","title":"직책"}`;

  const results = [];
  for (const file of req.files) {
    try {
      const imageData = fs.readFileSync(file.path).toString('base64');
      const mimeType = file.mimetype || 'image/jpeg';
      const result = await ocrModel.generateContent([
        { text: ocrPrompt },
        { inlineData: { mimeType, data: imageData } },
      ]);
      await logTokenUsage('ocr', result.response.usageMetadata, MODEL_FAST, getUserId(req));
      const text = result.response.text();
      let parsed = {};
      try {
        parsed = JSON.parse(text);
      } catch (_) {
        const m = text.match(/\{[\s\S]*\}/);
        if (m) {
          try {
            parsed = JSON.parse(m[0]);
          } catch (__) {
            /* fallback parse failed, use empty object */
          }
        }
      }
      results.push({ filename: file.originalname, raw_text: text, parsed });
    } catch (err) {
      console.error('OCR error:', err.message);
      results.push({ filename: file.originalname, error: friendlyError(err), parsed: {} });
    } finally {
      fs.unlink(file.path, () => {});
    }
  }
  res.json({ success: true, data: results });
});

// 고객사 인텔리전스
router.get('/:id/intelligence', requireFeature('ai.intelligence'), validateId, async (req, res) => {
  let sseStarted = false;
  try {
    const [[customer]] = await pool.query('SELECT * FROM customers WHERE id=?', [req.params.id]);
    if (!customer) return res.status(404).json({ success: false, error: '고객사 없음' });

    const [leads] = await pool.query(
      `SELECT project_name, business_type, stage, expected_amount, currency, created_at, updated_at
       FROM leads WHERE customer_name=? ORDER BY updated_at DESC LIMIT 10`,
      [customer.name]
    );
    const [activities] = await pool.query(
      `SELECT a.activity_type, a.title, a.content, a.performed_at, t.name AS performer
       FROM activities a JOIN leads l ON a.lead_id=l.id
       LEFT JOIN team_members t ON a.performed_by=t.id
       WHERE l.customer_name=? ORDER BY a.performed_at DESC LIMIT 10`,
      [customer.name]
    );

    const stageMap = {
      lead: '리드',
      review: '검토',
      proposal: '제안',
      bidding: '입찰',
      negotiation: '협상',
      won: '수주',
      lost: '실주',
      dropped: '드롭',
    };

    const prompt = `당신은 OCI의 시니어 영업 전략가입니다.
다음 고객사 정보를 바탕으로 최신 동향 분석과 수주 Kill 전략을 작성해주세요.

## 고객사 정보
- 회사명: ${customer.name}
- 지역: ${customer.region} / ${customer.country || ''}
- 산업: ${customer.industry || '미분류'}
- 주요 연락처: ${customer.contact_person || '미등록'} (${customer.phone || ''} / ${customer.email || ''})

## 영업 이력 (${leads.length}건)
${leads.map(l => `- ${l.project_name} | ${l.business_type} | 단계: ${stageMap[l.stage] || l.stage} | 금액: ${l.expected_amount || 0}${l.currency}`).join('\n') || '이력 없음'}

## 최근 활동 (${activities.length}건)
${activities.map(a => `- [${a.activity_type}] ${a.title}: ${(a.content || '').substring(0, 80)} (${a.performer || ''}, ${new Date(a.performed_at).toLocaleDateString('ko-KR')})`).join('\n') || '활동 없음'}

다음 형식으로 작성하세요:

## 📊 고객사 현황 분석
(영업 관계 강도, 주요 관심 분야, 의사결정 구조)

## 🌐 최신 동향 & 시장 환경
(해당 산업/지역 트렌드, 예상 수요, 경쟁사 현황)

## ⚔️ 수주 Kill 전략
### 핵심 공략 포인트 3가지
(각 포인트별 구체적 액션 포함)

### 리스크 관리
(예상 장애물과 대응 방안)

## 🎯 즉시 실행 액션 (이번 주)
1.
2.
3.

한국어로 간결하고 실무적으로 작성하세요.`;

    sseStart(res);
    sseStarted = true;
    await runStream(res, {
      _userId: getUserId(req),
      model: MODEL_FAST,
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    console.error('Customer intelligence error:', err.message);
    if (sseStarted) sseError(res, friendlyError(err));
    else res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// ── 고객사 관련 딜(leads) 목록 ───────────────────────────────
// GET /api/customers/:id/deals → customer_name 매칭 leads + 상위 활동
router.get('/:id/deals', validateId, async (req, res) => {
  try {
    const [[c]] = await pool.query('SELECT id, name FROM customers WHERE id=?', [req.params.id]);
    if (!c) return res.status(404).json({ success: false, error: '고객사 없음' });
    const [deals] = await pool.query(
      `SELECT id, project_name, business_type, region, stage,
              capacity_mw, expected_amount, currency,
              expected_close_date, bidding_deadline, updated_at, created_at
       FROM leads WHERE customer_name = ? ORDER BY updated_at DESC`,
      [c.name]
    );
    res.json({ success: true, data: deals });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 동일 회사명 그룹 (같은 name 의 customers 목록) ────────────
// GET /api/customers/:id/group → 같은 회사명을 가진 다른 고객 행들
router.get('/:id/group', validateId, async (req, res) => {
  try {
    const [[c]] = await pool.query('SELECT name FROM customers WHERE id=?', [req.params.id]);
    if (!c) return res.status(404).json({ success: false, error: '고객사 없음' });
    const [rows] = await pool.query(
      `SELECT id, name, region, country, industry, contact_person, phone, email
       FROM customers WHERE name=? ORDER BY id`,
      [c.name]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 고객사 핵심 브리핑 (간결 요약, 비스트리밍) ─────────────
// POST /api/customers/:id/brief → 핵심 4~6 bullet 요약 JSON
router.post('/:id/brief', validateId, async (req, res) => {
  try {
    const [[customer]] = await pool.query('SELECT * FROM customers WHERE id=?', [req.params.id]);
    if (!customer) return res.status(404).json({ success: false, error: '고객사 없음' });

    const [deals] = await pool.query(
      `SELECT project_name, business_type, stage, expected_amount, currency, updated_at
       FROM leads WHERE customer_name=? ORDER BY updated_at DESC LIMIT 10`,
      [customer.name]
    );
    const [acts] = await pool.query(
      `SELECT a.activity_type, a.title, a.performed_at, t.name AS performer
       FROM activities a JOIN leads l ON a.lead_id=l.id
       LEFT JOIN team_members t ON a.performed_by=t.id
       WHERE l.customer_name=? ORDER BY a.performed_at DESC LIMIT 5`,
      [customer.name]
    );

    const stageMap = {
      lead: '리드',
      review: '검토',
      proposal: '제안',
      bidding: '입찰',
      negotiation: '협상',
      won: '수주',
      lost: '실주',
      dropped: '드롭',
    };
    const totalAmount = deals.reduce((s, d) => s + Number(d.expected_amount || 0), 0);
    const wonCnt = deals.filter(d => d.stage === 'won').length;
    const openCnt = deals.filter(d => !['won', 'lost', 'dropped'].includes(d.stage)).length;

    const prompt = `당신은 OCI 영업팀 보조입니다. 다음 고객사를 매우 간결한 핵심 브리핑으로 정리하세요.

[고객사] ${customer.name} | ${customer.region} ${customer.country || ''} | ${customer.industry || '미분류'}
[담당자] ${customer.contact_person || '미등록'} (${customer.phone || ''})
[딜 ${deals.length}건] 진행 ${openCnt} · 수주 ${wonCnt} · 누적금액 ${totalAmount.toLocaleString()}
[최근 딜] ${
      deals
        .slice(0, 3)
        .map(d => `${d.project_name}(${stageMap[d.stage] || d.stage})`)
        .join(', ') || '없음'
    }
[최근 활동] ${
      acts
        .slice(0, 3)
        .map(a => `${a.activity_type}: ${a.title}`)
        .join(' / ') || '없음'
    }

다음 JSON 형식으로만 응답하세요 (마크다운/설명 없이 JSON만):
{
  "headline": "한 줄 요약 (40자 이내)",
  "key_points": ["핵심 포인트 1", "핵심 포인트 2", "핵심 포인트 3", "핵심 포인트 4"],
  "next_action": "이번 주 즉시 실행할 단 한 가지 액션 (30자 이내)",
  "risk": "주의해야 할 리스크 한 줄 (없으면 null)"
}`;

    const model = genAI.getGenerativeModel({
      model: MODEL_FAST,
      safetySettings: SAFETY_SETTINGS,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.3,
        maxOutputTokens: 600,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    const r = await model.generateContent(prompt);
    const txt = r.response.text();
    let parsed;
    try {
      parsed = JSON.parse(txt);
    } catch {
      return res
        .status(502)
        .json({ success: false, error: 'AI 응답 파싱 실패', raw: txt.slice(0, 300) });
    }

    const stats = { deals: deals.length, open: openCnt, won: wonCnt, total_amount: totalAmount };
    const userId = getUserId(req);

    // DB 캐시 + 이력 저장
    let savedRow = null;
    try {
      const [r] = await pool.query(
        `INSERT INTO customer_briefs
         (customer_id, headline, key_points, next_action, risk, stats, generated_by)
         VALUES (?,?,?,?,?,?,?)`,
        [
          req.params.id,
          (parsed.headline || '').slice(0, 250),
          JSON.stringify(parsed.key_points || []),
          (parsed.next_action || '').slice(0, 250),
          parsed.risk ? String(parsed.risk).slice(0, 490) : null,
          JSON.stringify(stats),
          userId || null,
        ]
      );
      const [[meta]] = await pool.query(`SELECT generated_at FROM customer_briefs WHERE id=?`, [
        r.insertId,
      ]);
      savedRow = { id: r.insertId, generated_at: meta?.generated_at, generated_by: userId };
    } catch (e) {
      console.warn('Brief 캐시 저장 실패:', e.message); // 저장 실패해도 응답은 유지
    }

    res.json({
      success: true,
      data: {
        ...parsed,
        stats,
        cached: false,
        ...(savedRow || {}),
      },
    });
  } catch (err) {
    console.error('Customer brief error:', err.message);
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// ── 고객사 최근 브리핑 캐시 조회 (신규) ──────────────────────
// GET /api/customers/:id/brief → 가장 최근 저장된 브리핑 1건 (없으면 null)
router.get('/:id/brief', validateId, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT cb.id, cb.customer_id, cb.headline, cb.key_points, cb.next_action,
              cb.risk, cb.stats, cb.generated_at, cb.generated_by,
              t.name AS generated_by_name
       FROM customer_briefs cb
       LEFT JOIN team_members t ON cb.generated_by = t.id
       WHERE cb.customer_id=? ORDER BY cb.generated_at DESC LIMIT 1`,
      [req.params.id]
    );
    if (!rows.length) return res.json({ success: true, data: null });
    const r = rows[0];
    res.json({
      success: true,
      data: {
        id: r.id,
        headline: r.headline,
        key_points: safeJson(r.key_points, []),
        next_action: r.next_action,
        risk: r.risk,
        stats: safeJson(r.stats, {}),
        generated_at: r.generated_at,
        generated_by: r.generated_by,
        generated_by_name: r.generated_by_name,
        cached: true,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 고객사 브리핑 전체 이력 (신규) ───────────────────────────
// GET /api/customers/:id/brief/history → 시간 역순 전체 이력
router.get('/:id/brief/history', validateId, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT cb.id, cb.headline, cb.next_action, cb.risk, cb.stats,
              cb.generated_at, cb.generated_by, t.name AS generated_by_name
       FROM customer_briefs cb
       LEFT JOIN team_members t ON cb.generated_by = t.id
       WHERE cb.customer_id=? ORDER BY cb.generated_at DESC LIMIT 50`,
      [req.params.id]
    );
    res.json({
      success: true,
      data: rows.map(r => ({
        id: r.id,
        headline: r.headline,
        next_action: r.next_action,
        risk: r.risk,
        stats: safeJson(r.stats, {}),
        generated_at: r.generated_at,
        generated_by_name: r.generated_by_name,
      })),
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 고객사 수정 ──────────────────────────────────────────────
router.put('/:id', validateId, async (req, res) => {
  try {
    const { name, region, country, industry, contact_person, phone, email, address, notes } =
      req.body;
    const fields = [];
    const vals = [];
    if (name !== undefined) {
      fields.push('name=?');
      vals.push(name);
    }
    if (region !== undefined) {
      fields.push('region=?');
      vals.push(region);
    }
    if (country !== undefined) {
      fields.push('country=?');
      vals.push(country);
    }
    if (industry !== undefined) {
      fields.push('industry=?');
      vals.push(industry);
    }
    if (contact_person !== undefined) {
      fields.push('contact_person=?');
      vals.push(contact_person);
    }
    if (phone !== undefined) {
      fields.push('phone=?');
      vals.push(phone);
    }
    if (email !== undefined) {
      fields.push('email=?');
      vals.push(email);
    }
    if (address !== undefined) {
      fields.push('address=?');
      vals.push(address);
    }
    if (notes !== undefined) {
      fields.push('notes=?');
      vals.push(notes);
    }
    if (!fields.length)
      return res.status(400).json({ success: false, error: '수정할 항목이 없습니다.' });
    vals.push(req.params.id);
    await pool.query(`UPDATE customers SET ${fields.join(',')} WHERE id=?`, vals);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 고객사 삭제 ──────────────────────────────────────────────
router.delete('/:id', validateId, async (req, res) => {
  try {
    await pool.query('DELETE FROM customers WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 엑셀 내보내기 ────────────────────────────────────────────
router.get('/export', async (req, res) => {
  try {
    const { search, region, industry } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (search) {
      where += ' AND (name LIKE ? OR contact_person LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (region) {
      where += ' AND region = ?';
      params.push(region);
    }
    if (industry) {
      where += ' AND industry = ?';
      params.push(industry);
    }
    const [rows] = await pool.query(`SELECT * FROM customers ${where} ORDER BY name`, params);
    await sendExport(res, {
      columns: CUST_COLS,
      rows,
      sheetName: '고객사',
      filename: '고객사_' + new Date().toISOString().slice(0, 10),
      format: normalizeFormat(req.query.format),
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 엑셀 가져오기 ────────────────────────────────────────────
router.post('/import', upload.memory.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: '파일이 없습니다.' });
    const rows = await fromExcelBuffer(req.file.buffer);
    if (!rows.length)
      return res.status(400).json({ success: false, message: '데이터가 없습니다.' });

    const inserted = [];
    const errors = [];
    const duplicates = [];
    for (const row of rows) {
      const name = String(row['고객사명'] || row['name'] || '').trim();
      if (!name) {
        errors.push({ row, reason: '고객사명 누락' });
        continue;
      }
      try {
        const contactPerson = String(row['담당자'] || row['contact_person'] || '').trim() || null;
        const phone = String(row['연락처'] || row['phone'] || '').trim() || null;
        const dup = await findDuplicate(name, contactPerson, phone);
        if (dup) {
          duplicates.push({
            row,
            existingId: dup.id,
            reason: `중복 (기존 ID:${dup.id} — ${dup.name})`,
          });
          continue;
        }
        const [r] = await pool.query(
          `INSERT INTO customers (name, region, country, industry, contact_person, phone, email, address)
           VALUES (?,?,?,?,?,?,?,?)`,
          [
            name,
            String(row['구분'] || row['region'] || '국내').trim(),
            String(row['국가'] || row['country'] || '').trim() || null,
            String(row['산업군'] || row['industry'] || '').trim() || null,
            contactPerson,
            phone,
            String(row['이메일'] || row['email'] || '').trim() || null,
            String(row['주소'] || row['address'] || '').trim() || null,
          ]
        );
        inserted.push(r.insertId);
      } catch (e) {
        errors.push({ row, reason: e.message });
      }
    }
    res.json({
      success: true,
      inserted: inserted.length,
      duplicates: duplicates.length,
      errors: [...errors, ...duplicates],
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── v6.0.0 Step 2: 연결된 계약 역방향 조회 ─────────────────
// GET /api/customers/:id/contracts → contracts WHERE customer_id = ?
// 고객사 상세 모달에서 "🔗 연결된 계약" 섹션 렌더링용
router.get('/:id/contracts', validateId, async (req, res) => {
  try {
    const [[c]] = await pool.query('SELECT id FROM customers WHERE id = ?', [req.params.id]);
    if (!c) return res.status(404).json({ success: false, error: '고객사 없음' });
    const [contracts] = await pool.query(
      `SELECT id, contract_no, title, status, contract_type,
              contract_amount, currency, start_date, end_date,
              customer_name, created_at
         FROM contracts
        WHERE customer_id = ?
        ORDER BY created_at DESC
        LIMIT 100`,
      [req.params.id]
    );
    res.json({ success: true, data: contracts });
  } catch (err) {
    handleError(res, err);
  }
});

// v6.0.0: GET /api/customers/:id/quotes → quotes WHERE customer_id = ?
// 고객사 모달 [💰 견적] 탭 렌더링용
router.get('/:id/quotes', validateId, async (req, res) => {
  try {
    const [[c]] = await pool.query('SELECT id FROM customers WHERE id = ?', [req.params.id]);
    if (!c) return res.status(404).json({ success: false, error: '고객사 없음' });
    // 참고: quotes 테이블에는 currency 컬럼이 없음 → 프론트에서 'KRW' fallback
    const [quotes] = await pool.query(
      `SELECT id, quote_no, name, status, customer_name,
              total_amount, quote_date,
              revision_no, created_at, updated_at
         FROM quotes
        WHERE customer_id = ?
        ORDER BY created_at DESC
        LIMIT 100`,
      [req.params.id]
    );
    res.json({ success: true, data: quotes });
  } catch (err) {
    handleError(res, err);
  }
});

// v6.0.0: GET /api/customers/:id/proposals → proposals WHERE customer_id = ?
// 고객사 모달 [📝 제안] 탭 렌더링용
router.get('/:id/proposals', validateId, async (req, res) => {
  try {
    const [[c]] = await pool.query('SELECT id FROM customers WHERE id = ?', [req.params.id]);
    if (!c) return res.status(404).json({ success: false, error: '고객사 없음' });
    const [proposals] = await pool.query(
      `SELECT id, proposal_no, proposal_title, status, customer_name,
              expected_amount, currency, proposal_date, due_date,
              owner_name, created_at, updated_at
         FROM proposals
        WHERE customer_id = ?
        ORDER BY created_at DESC
        LIMIT 100`,
      [req.params.id]
    );
    res.json({ success: true, data: proposals });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
