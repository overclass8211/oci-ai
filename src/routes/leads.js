const router = require('express').Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const {
  requireFields,
  validateId,
  sanitizeQuery,
  schema,
  SCHEMAS,
} = require('../middleware/validate');
const { parsePage, pageResult } = require('../utils/routeHelper');
const { wsBroadcast } = require('../ws');
const upload = require('../middleware/upload');
const { fromExcelBuffer } = require('../utils/excelHelper');
const { sendExport, normalizeFormat } = require('../utils/exportHelper');

const STAGE_KO = {
  lead: '리드 발굴',
  review: '검토/미팅',
  proposal: '제안/견적',
  bidding: '입찰',
  negotiation: '협상/계약',
  won: '수주 완료',
  lost: '실주',
  dropped: '드롭',
};
const STAGE_EN = Object.fromEntries(Object.entries(STAGE_KO).map(([k, v]) => [v, k]));

const LEAD_COLS = [
  { key: 'customer_name', label: '고객사' },
  { key: 'project_name', label: '프로젝트명' },
  { key: 'business_type', label: '사업유형' },
  { key: 'capacity_mw', label: '규모(MW)' },
  { key: 'stage_label', label: '단계' },
  { key: 'region', label: '구분' },
  { key: 'expected_amount', label: '예상금액' },
  { key: 'currency', label: '통화' },
  { key: 'assigned_name', label: '담당자' },
  { key: 'expected_close_date', label: '완료예정일' },
  { key: 'bidding_deadline', label: '입찰마감일' },
  { key: 'notes', label: '비고' },
];

// stage_changed_at 컬럼 자동 생성 (없을 경우)
pool
  .query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS stage_changed_at DATETIME NULL DEFAULT NULL`)
  .catch(() => {});

router.get('/', sanitizeQuery, async (req, res) => {
  try {
    const { stage, region, assigned_to, business_type, search, date_from, date_to, date_field } =
      req.query;
    const { page, limit, offset } = parsePage(req.query);

    // date_field: 'stage'(기본) = stage_changed_at, 'created' = created_at,
    //             'close' = expected_close_date, 'updated' = updated_at
    const dateCol =
      date_field === 'created'
        ? 'l.created_at'
        : date_field === 'close'
          ? 'l.expected_close_date'
          : date_field === 'updated'
            ? 'l.updated_at'
            : 'COALESCE(l.stage_changed_at, l.updated_at)'; // 기본: 단계변경일

    let where = 'WHERE 1=1';
    const params = [];
    if (stage) {
      where += ' AND l.stage = ?';
      params.push(stage);
    }
    if (region) {
      where += ' AND l.region = ?';
      params.push(region);
    }
    if (assigned_to) {
      where += ' AND l.assigned_to = ?';
      params.push(assigned_to);
    }
    if (business_type) {
      where += ' AND l.business_type = ?';
      params.push(business_type);
    }
    if (date_from) {
      where += ` AND ${dateCol} >= ?`;
      params.push(date_from);
    }
    if (date_to) {
      where += ` AND ${dateCol} <= ?`;
      params.push(date_to);
    }
    if (search) {
      where += ' AND (l.customer_name LIKE ? OR l.project_name LIKE ? OR l.notes LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    // ⚠️ mysql2의 pool.query 는 [rows, fields] 반환 → Promise.all 결과 destructure 주의
    const [[countRows], [rows]] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM leads l ${where}`, params),
      pool.query(
        `SELECT l.*, t.name AS assigned_name, t.role AS assigned_role
         FROM leads l LEFT JOIN team_members t ON l.assigned_to = t.id
         ${where} ORDER BY l.updated_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ),
    ]);
    const total = Number(countRows[0]?.total ?? 0);
    res.json(pageResult(rows, total, page, limit));
  } catch (err) {
    handleError(res, err);
  }
});

// ── 엑셀 내보내기 ────────────────────────────────────────────
router.get('/export', async (req, res) => {
  try {
    const { stage, region, assigned_to, business_type, search } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (stage) {
      where += ' AND l.stage = ?';
      params.push(stage);
    }
    if (region) {
      where += ' AND l.region = ?';
      params.push(region);
    }
    if (assigned_to) {
      where += ' AND l.assigned_to = ?';
      params.push(assigned_to);
    }
    if (business_type) {
      where += ' AND l.business_type = ?';
      params.push(business_type);
    }
    if (search) {
      where += ' AND (l.customer_name LIKE ? OR l.project_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    const [rows] = await pool.query(
      `SELECT l.*, t.name AS assigned_name FROM leads l
       LEFT JOIN team_members t ON l.assigned_to = t.id
       ${where} ORDER BY l.updated_at DESC`,
      params
    );
    const data = rows.map(r => ({ ...r, stage_label: STAGE_KO[r.stage] || r.stage }));
    sendExport(res, {
      columns: LEAD_COLS,
      rows: data,
      sheetName: '영업리드',
      filename: '영업리드_' + new Date().toISOString().slice(0, 10),
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
    const rows = fromExcelBuffer(req.file.buffer);
    if (!rows.length)
      return res.status(400).json({ success: false, message: '데이터가 없습니다.' });

    // 팀원 이름 → ID 맵
    const [team] = await pool.query('SELECT id, name FROM team_members');
    const teamMap = Object.fromEntries(team.map(t => [t.name.trim(), t.id]));

    const inserted = [];
    const errors = [];
    for (const row of rows) {
      const cn = String(row['고객사'] || row['customer_name'] || '').trim();
      const pn = String(row['프로젝트명'] || row['project_name'] || '').trim();
      if (!cn || !pn) {
        errors.push({ row, reason: '고객사/프로젝트명 누락' });
        continue;
      }
      try {
        const stageRaw = String(row['단계'] || row['stage'] || '').trim();
        const stage = STAGE_EN[stageRaw] || stageRaw || 'lead';
        const assignedName = String(row['담당자'] || row['assigned_name'] || '').trim();
        const assignedId = teamMap[assignedName] || null;
        const [r] = await pool.query(
          `INSERT INTO leads (customer_name, project_name, business_type, region,
           capacity_mw, expected_amount, currency, stage, assigned_to,
           expected_close_date, bidding_deadline, notes)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            cn,
            pn,
            String(row['사업유형'] || row['business_type'] || '태양광').trim(),
            String(row['구분'] || row['region'] || '국내').trim(),
            parseFloat(row['규모(MW)'] || row['capacity_mw']) || null,
            parseFloat(row['예상금액'] || row['expected_amount']) || null,
            String(row['통화'] || row['currency'] || 'KRW').trim(),
            stage,
            assignedId,
            row['완료예정일'] || row['expected_close_date'] || null,
            row['입찰마감일'] || row['bidding_deadline'] || null,
            String(row['비고'] || row['notes'] || '').trim() || null,
          ]
        );
        inserted.push(r.insertId);
      } catch (e) {
        errors.push({ row, reason: e.message });
      }
    }
    res.json({ success: true, inserted: inserted.length, errors });
  } catch (err) {
    handleError(res, err);
  }
});

// ⚠️ 정적 경로는 반드시 /:id 보다 먼저 — Express 라우터 매칭 순서
router.get('/funnel-stats', async (req, res) => {
  try {
    const result = await calcFunnelConversion({
      date_from: req.query.date_from,
      date_to: req.query.date_to,
      date_field: req.query.date_field,
      region: req.query.region,
      business_type: req.query.business_type,
      assigned_to: req.query.assigned_to,
      search: req.query.search,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/:id', validateId, async (req, res) => {
  try {
    const [[lead]] = await pool.query(
      `SELECT l.*, t.name AS assigned_name FROM leads l
       LEFT JOIN team_members t ON l.assigned_to = t.id WHERE l.id = ?`,
      [req.params.id]
    );
    if (!lead) return res.status(404).json({ success: false, error: 'Not found' });
    const [activities] = await pool.query(
      `SELECT a.*, t.name AS performer_name FROM activities a
       LEFT JOIN team_members t ON a.performed_by = t.id
       WHERE a.lead_id = ? ORDER BY a.performed_at DESC`,
      [req.params.id]
    );

    // 연결된 회의록 (lead_id 직접 연결 OR 고객사명 기준 매핑)
    let meetings = [];
    try {
      const [byLead] = await pool.query(
        `SELECT id, title, meeting_date, customer_name, summary_md, calendar_event_id, created_at
         FROM meeting_minutes WHERE lead_id = ? ORDER BY meeting_date DESC`,
        [req.params.id]
      );
      const [byCustomer] = lead.customer_name
        ? await pool.query(
            `SELECT id, title, meeting_date, customer_name, summary_md, calendar_event_id, created_at
         FROM meeting_minutes WHERE customer_name = ? AND (lead_id IS NULL OR lead_id != ?)
         ORDER BY meeting_date DESC`,
            [lead.customer_name, req.params.id]
          )
        : [[]];
      // 중복 제거
      const seen = new Set(byLead.map(m => m.id));
      meetings = [...byLead, ...byCustomer.filter(m => !seen.has(m.id))];
    } catch (_) {
      /* meeting_minutes 테이블 없으면 빈 배열 */
    }

    res.json({ success: true, data: { ...lead, activities, meetings } });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 일괄 등록 (Copy & Paste import) ──────────────────────────
router.post('/bulk', async (req, res) => {
  const { leads } = req.body;
  if (!Array.isArray(leads) || !leads.length)
    return res.status(400).json({ success: false, message: '등록할 데이터가 없습니다.' });

  const inserted = [];
  const errors = [];
  for (const row of leads) {
    const { customer_name, project_name } = row;
    if (!customer_name || !project_name) {
      errors.push({ row, reason: '고객사 또는 프로젝트명 누락' });
      continue;
    }
    try {
      const [r] = await pool.query(
        `INSERT INTO leads
         (customer_name, project_name, business_type, region,
          capacity_mw, expected_amount, currency, stage,
          assigned_to, expected_close_date, bidding_deadline, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          customer_name,
          project_name,
          row.business_type || '태양광',
          row.region || '국내',
          row.capacity_mw || null,
          row.expected_amount || null,
          row.currency || 'KRW',
          row.stage || 'lead',
          row.assigned_to || null,
          row.expected_close_date || null,
          row.bidding_deadline || null,
          row.notes || null,
        ]
      );
      inserted.push(r.insertId);
    } catch (e) {
      errors.push({ row, reason: e.message });
    }
  }
  res.json({ success: true, inserted: inserted.length, errors });
});

// ── 동적 stage 검증 (pipeline_stages 테이블 기반) ──────────────
async function validateStage(stage) {
  if (!stage) return true; // null/undefined는 default('lead')로 처리됨
  const pipelineStages = require('./pipeline-stages');
  const validKeys = await pipelineStages.getValidKeys();
  return validKeys.includes(stage);
}

// 환산 헬퍼 — 실패 시 amount_krw=null로 두고 진행 (FX 장애가 리드 등록 막지 않게)
async function calcKrw(amount, currency) {
  if (!amount || !Number.isFinite(Number(amount))) return { krw: null, rate: null };
  if (!currency || currency === 'KRW') return { krw: Math.round(Number(amount)), rate: 1 };
  try {
    const Fx = require('../services/exchange');
    const rate = await Fx.getRate(currency);
    return { krw: Math.round(Number(amount) * rate), rate };
  } catch (e) {
    console.warn('[FX] 환산 실패 (currency=' + currency + '):', e.message);
    return { krw: null, rate: null };
  }
}

router.post('/', schema(SCHEMAS.createLead), async (req, res) => {
  try {
    const {
      customer_name,
      project_name,
      business_type,
      region,
      capacity_mw,
      expected_amount,
      currency,
      stage,
      assigned_to,
      expected_close_date,
      bidding_deadline,
      notes,
    } = req.body;

    // 동적 stage 검증 (pipeline_stages 기반)
    if (stage && !(await validateStage(stage))) {
      return res.status(400).json({ success: false, error: '존재하지 않는 단계입니다: ' + stage });
    }

    const cur = currency || 'KRW';
    const { krw, rate } = await calcKrw(expected_amount, cur);
    // 신규 등록은 항상 'live' 정책 (won 단계로 들어와도 등록 시점 확정 가능)
    const isWon = stage === 'won';
    const lockPolicy = isWon ? 'locked' : 'live';
    const lockedAt = isWon ? new Date() : null;

    const [result] = await pool.query(
      `INSERT INTO leads
       (customer_name, project_name, business_type, region,
        capacity_mw, expected_amount, currency, stage,
        assigned_to, expected_close_date, bidding_deadline, notes,
        amount_krw, fx_rate, fx_lock_policy, fx_locked_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        customer_name,
        project_name,
        business_type || '태양광',
        region || '국내',
        capacity_mw || null,
        expected_amount || null,
        cur,
        stage || 'lead',
        assigned_to || null,
        expected_close_date || null,
        bidding_deadline || null,
        notes || null,
        krw,
        rate,
        lockPolicy,
        lockedAt,
      ]
    );
    // Webhook 발행 — fire-and-forget
    try {
      const wh = require('../services/webhookDispatcher');
      wh.emit('lead.created', {
        id: result.insertId,
        customer_name,
        project_name,
        business_type: business_type || '태양광',
        stage: stage || 'lead',
        expected_amount,
        currency: cur,
        amount_krw: krw,
      });
      if (stage === 'won') {
        wh.emit('lead.won', {
          id: result.insertId,
          customer_name,
          project_name,
          expected_amount,
          currency: cur,
          amount_krw: krw,
        });
      }
    } catch (_) {
      /* webhook 실패는 무시 */
    }
    res.json({
      success: true,
      id: result.insertId,
      data: { id: result.insertId, amount_krw: krw },
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/:id', validateId, async (req, res) => {
  try {
    const fields = [
      'customer_name',
      'project_name',
      'business_type',
      'region',
      'capacity_mw',
      'expected_amount',
      'currency',
      'stage',
      'assigned_to',
      'expected_close_date',
      'bidding_deadline',
      'notes',
    ];
    const updates = [];
    const values = [];
    fields.forEach(f => {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = ?`);
        values.push(req.body[f]);
      }
    });
    if (!updates.length) return res.json({ success: true, message: 'No changes' });

    // expected_amount 또는 currency 변경 시 amount_krw 재계산
    // 단, 이미 'locked' 정책이면 (수주 확정) 재계산 안 함
    const amtChanged = req.body.expected_amount !== undefined;
    const curChanged = req.body.currency !== undefined;
    if (amtChanged || curChanged) {
      const [[curr]] = await pool.query(
        'SELECT expected_amount, currency, fx_lock_policy FROM leads WHERE id=?',
        [req.params.id]
      );
      if (curr && curr.fx_lock_policy !== 'locked') {
        const newAmt = amtChanged ? req.body.expected_amount : curr.expected_amount;
        const newCur = curChanged ? req.body.currency : curr.currency;
        const { krw, rate } = await calcKrw(newAmt, newCur);
        updates.push('amount_krw=?');
        values.push(krw);
        updates.push('fx_rate=?');
        values.push(rate);
      }
    }

    values.push(req.params.id);
    await pool.query(`UPDATE leads SET ${updates.join(',')} WHERE id = ?`, values);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.patch('/:id/stage', validateId, requireFields(['stage']), async (req, res) => {
  try {
    const { stage } = req.body;
    if (!(await validateStage(stage))) {
      return res.status(400).json({ success: false, error: '존재하지 않는 단계입니다: ' + stage });
    }

    // ── 환율 락 정책: won 전환 = 그날 환율로 고정, 그 외 = live 유지 ──
    let fxUpdate = '';
    const fxParams = [];
    if (stage === 'won') {
      // 현재 lead 정보 가져와서 그날 환율 고정
      const [[curr]] = await pool.query(
        'SELECT expected_amount, currency, fx_lock_policy FROM leads WHERE id=?',
        [req.params.id]
      );
      if (curr && curr.fx_lock_policy !== 'locked') {
        const { krw, rate } = await calcKrw(curr.expected_amount, curr.currency);
        fxUpdate = `, amount_krw=?, fx_rate=?, fx_lock_policy='locked', fx_locked_at=NOW()`;
        fxParams.push(krw, rate);
      }
    } else if (['lost', 'dropped'].includes(stage)) {
      // 실주/드롭은 마지막 환율로 잠금 (참조용 유지)
      const [[curr]] = await pool.query('SELECT fx_lock_policy FROM leads WHERE id=?', [
        req.params.id,
      ]);
      if (curr && curr.fx_lock_policy !== 'locked') {
        fxUpdate = `, fx_lock_policy='locked', fx_locked_at=NOW()`;
      }
    } else {
      // 활성 단계로 되돌아오면 live 로 풀기
      fxUpdate = `, fx_lock_policy='live', fx_locked_at=NULL`;
    }

    // stage_changed_at 함께 업데이트 (컬럼 없으면 ADD 후 재시도)
    const baseSql = `UPDATE leads SET stage = ?, stage_changed_at = NOW()${fxUpdate} WHERE id = ?`;
    try {
      await pool.query(baseSql, [stage, ...fxParams, req.params.id]);
    } catch (e) {
      if (e.code === 'ER_BAD_FIELD_ERROR') {
        await pool.query(
          `ALTER TABLE leads ADD COLUMN IF NOT EXISTS stage_changed_at DATETIME NULL DEFAULT NULL`
        );
        await pool.query(baseSql, [stage, ...fxParams, req.params.id]);
      } else throw e;
    }
    const stageNameMap = {
      lead: '리드발굴',
      review: '검토',
      proposal: '제안',
      bidding: '입찰',
      negotiation: '협상',
      won: '수주',
      lost: '실주',
      dropped: '드롭',
    };
    await pool.query(
      `INSERT INTO activities (lead_id, activity_type, title, content, performed_by) VALUES (?,?,?,?,?)`,
      [
        req.params.id,
        stage === 'won' ? '수주' : stage === 'dropped' ? '드롭' : 'stage_change',
        `단계 변경: ${stageNameMap[stage]}`,
        `리드 단계가 ${stageNameMap[stage]}(으)로 변경되었습니다.`,
        1,
      ]
    );
    // 단계 변경 실시간 알림 브로드캐스트
    const [[lead]] = await pool.query('SELECT customer_name, project_name FROM leads WHERE id=?', [
      req.params.id,
    ]);
    if (lead) {
      const icon =
        stage === 'won' ? '🏆' : stage === 'dropped' ? '❌' : stage === 'negotiation' ? '🤝' : '📋';
      wsBroadcast({
        type: 'stage_change',
        lead_id: Number(req.params.id),
        customer_name: lead.customer_name,
        project_name: lead.project_name,
        stage,
        stage_label: stageNameMap[stage],
        icon,
      });
      // Webhook 발행 — 단계 변경 + (수주일 때 추가 lead.won)
      try {
        const wh = require('../services/webhookDispatcher');
        wh.emit('lead.stage_changed', {
          id: Number(req.params.id),
          customer_name: lead.customer_name,
          project_name: lead.project_name,
          stage,
          stage_label: stageNameMap[stage],
        });
        if (stage === 'won') {
          const [[detail]] = await pool.query(
            'SELECT expected_amount, currency, amount_krw FROM leads WHERE id=?',
            [req.params.id]
          );
          wh.emit('lead.won', {
            id: Number(req.params.id),
            customer_name: lead.customer_name,
            project_name: lead.project_name,
            expected_amount: detail?.expected_amount,
            currency: detail?.currency,
            amount_krw: detail?.amount_krw,
          });
        }
      } catch (_) {
        /* 무시 */
      }
    }
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/:id', validateId, async (req, res) => {
  try {
    // 연결된 캘린더 이벤트의 lead_id를 NULL로 정리 (고아 데이터 방지)
    await pool.query('UPDATE calendar_events SET lead_id = NULL WHERE lead_id = ?', [
      req.params.id,
    ]);
    await pool.query('DELETE FROM leads WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ══════════════════════════════════════════════════════════════
// 시간 기반 진정한 전환율 계산 — funnel 누적 도달 방식 (영업 분석 표준)
//
// 정의:
//   - 단계 i의 "누적 도달 카드" = i 단계 + 그 이후 단계(won 포함) cnt 합
//   - 전환율(i → j) = j의 누적 도달 / i의 누적 도달
//   - 항상 0~100% (i → j 가는 카드는 i를 거쳐야 하므로)
//
// 옵션:
//   - filters: { date_from, date_to, date_field, region, business_type, assigned_to }
//     같은 필터를 페이지/AI 코칭에 적용하여 데이터 일치 보장
// ══════════════════════════════════════════════════════════════
async function calcFunnelConversion(filters = {}) {
  const pipelineStages = require('./pipeline-stages');
  const stages = await pipelineStages.getStagesCached();
  const activeStages = stages
    .filter(s => s.role === 'active')
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const wonKey = stages.find(s => s.role === 'won')?.stage_key;
  const flowKeys = [...activeStages.map(s => s.stage_key)];
  if (wonKey) flowKeys.push(wonKey); // funnel은 won 까지 포함 (목표 도달)

  // WHERE 절 구성 (필터)
  const cond = ['1=1'];
  const params = [];
  if (filters.date_from && filters.date_to) {
    const dateCol =
      filters.date_field === 'created'
        ? 'created_at'
        : filters.date_field === 'close'
          ? 'expected_close_date'
          : filters.date_field === 'updated'
            ? 'updated_at'
            : 'COALESCE(stage_changed_at, updated_at)';
    cond.push(`${dateCol} BETWEEN ? AND ?`);
    params.push(filters.date_from, filters.date_to);
  }
  if (filters.region) {
    cond.push('region = ?');
    params.push(filters.region);
  }
  if (filters.business_type) {
    cond.push('business_type = ?');
    params.push(filters.business_type);
  }
  if (filters.assigned_to) {
    cond.push('assigned_to = ?');
    params.push(filters.assigned_to);
  }
  if (filters.search) {
    cond.push('(customer_name LIKE ? OR project_name LIKE ?)');
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  const where = cond.join(' AND ');

  // 단계별 cnt 조회
  const [rows] = await pool.query(
    `SELECT stage, COUNT(*) AS cnt FROM leads WHERE ${where} GROUP BY stage`,
    params
  );
  const dist = {};
  rows.forEach(r => (dist[r.stage] = Number(r.cnt)));

  // 누적 도달 카드 (i 단계 + 그 이후 단계 합)
  const reached = {};
  for (let i = 0; i < flowKeys.length; i++) {
    let sum = 0;
    for (let j = i; j < flowKeys.length; j++) sum += dist[flowKeys[j]] || 0;
    reached[flowKeys[i]] = sum;
  }

  // 단계 간 전환율 (i → i+1)
  const conversions = {};
  for (let i = 0; i < flowKeys.length - 1; i++) {
    const from = flowKeys[i],
      to = flowKeys[i + 1];
    conversions[from + '__' + to] =
      reached[from] > 0 ? Math.round((reached[to] / reached[from]) * 100) : null;
  }

  return { dist, reached, conversions, flowKeys };
}

// ══════════════════════════════════════════════════════════════
// POST /api/leads/stage-coach
//   파이프라인 단계별 AI 헬스 코칭
//   body: { stage, filters? }
//   반환: { status, headline, going_well[], warnings[], urgent[], next_actions[], stats }
// ══════════════════════════════════════════════════════════════
const { genAI, MODEL_FAST, SAFETY_SETTINGS } = require('../services/gemini');
const { friendlyError } = require('../middleware/errorHandler');

router.post('/stage-coach', async (req, res) => {
  try {
    const { stage, filters = {} } = req.body || {};
    // 동적 검증 (pipeline_stages 기반) — 사용자 정의 단계도 지원
    if (!(await validateStage(stage))) {
      return res.status(400).json({ success: false, error: '존재하지 않는 단계: ' + stage });
    }

    // pipeline_stages에서 label 조회 (사용자가 변경한 한글명 반영)
    const pipelineStages = require('./pipeline-stages');
    const stages = await pipelineStages.getStagesCached();
    const stageInfo = stages.find(s => s.stage_key === stage);
    const stageLabel = stageInfo?.label || STAGE_KO[stage] || stage;

    // ⚠️ 페이지와 동일 모수 사용: filters 적용
    const cardCond = ['stage = ?'];
    const cardParams = [stage];
    if (filters.date_from && filters.date_to) {
      const dateCol =
        filters.date_field === 'created'
          ? 'created_at'
          : filters.date_field === 'close'
            ? 'expected_close_date'
            : filters.date_field === 'updated'
              ? 'updated_at'
              : 'COALESCE(stage_changed_at, updated_at)';
      cardCond.push(`${dateCol} BETWEEN ? AND ?`);
      cardParams.push(filters.date_from, filters.date_to);
    }
    if (filters.region) {
      cardCond.push('region = ?');
      cardParams.push(filters.region);
    }
    if (filters.business_type) {
      cardCond.push('business_type = ?');
      cardParams.push(filters.business_type);
    }
    if (filters.assigned_to) {
      cardCond.push('assigned_to = ?');
      cardParams.push(filters.assigned_to);
    }
    if (filters.search) {
      cardCond.push('(customer_name LIKE ? OR project_name LIKE ?)');
      cardParams.push(`%${filters.search}%`, `%${filters.search}%`);
    }

    // 해당 단계 카드 (필터 적용)
    const [cards] = await pool.query(
      `SELECT id, customer_name, project_name, expected_amount, currency,
              capacity_mw, business_type, region, expected_close_date, bidding_deadline,
              updated_at, created_at,
              DATEDIFF(NOW(), updated_at) AS days_in_stage
       FROM leads
       WHERE ${cardCond.join(' AND ')}
       ORDER BY updated_at ASC`,
      cardParams
    );

    // funnel 누적 도달 + 전환율 계산 (페이지와 동일 데이터)
    const funnel = await calcFunnelConversion(filters);

    // ⚠️ 0건 케이스 — AI 호출 스킵 (환각 방지) + 단계별 맞춤 안내
    if (cards.length === 0) {
      // role 기반 분류 (사용자 정의 stage_key도 지원)
      const role = stageInfo?.role || 'active';
      const isActive = role === 'active';
      const isWon = role === 'won';

      let status, headline, going_well, warnings, urgent, next_actions;
      if (isActive) {
        status = '주의';
        headline = `${stageLabel} 단계에 진행 중인 딜이 없습니다`;
        going_well = ['해당 단계에 정체된 딜이 없어 부담은 없음'];
        warnings = [
          '신규 딜 유입이 없어 파이프라인 흐름이 끊긴 상태',
          `${stageLabel} 단계 활동(미팅·제안 등)이 부족할 가능성`,
        ];
        urgent =
          stage === 'lead'
            ? ['신규 리드 발굴 활동 즉시 시작 필요']
            : [`이전 단계에서 ${stageLabel}로 진행할 딜 검토 필요`];
        next_actions =
          stage === 'lead'
            ? [
                '잠재 고객 리스트 업데이트 및 신규 영업 활동 계획 수립',
                '마케팅 캠페인·외부 이벤트 참여로 리드 유입 확대',
                '기존 고객사에 추가 제안 가능성 탐색',
              ]
            : [
                `이전 단계 진행 딜 중 ${stageLabel} 진입 후보 식별`,
                `${stageLabel} 단계의 평균 소요 시간 점검 및 병목 분석`,
                '영업 담당자별 단계 흐름 리뷰 미팅 진행',
              ];
      } else if (isWon) {
        status = '주의';
        headline = '아직 수주 완료된 딜이 없습니다';
        going_well = ['데이터 없음'];
        warnings = ['수주 사례 부재 — 영업 성과 데이터 부족'];
        urgent = ['협상/계약 단계 딜의 클로징 가속화 필요'];
        next_actions = [
          '협상 단계 딜의 진행 상태 점검 및 클로징 액션 수립',
          '경쟁사 대비 차별화 포인트 강화',
          '영업 사이클 단축을 위한 프로세스 개선 검토',
        ];
      } else {
        status = '정상';
        headline = `${stageLabel} 단계에 해당 딜이 없습니다`;
        going_well = ['실주/드롭 딜 없음 — 양호'];
        warnings = [];
        urgent = [];
        next_actions = ['현재 상태 유지 + 활성 단계에 집중'];
      }

      return res.json({
        success: true,
        data: {
          stage,
          stage_label: stageLabel,
          status,
          headline,
          going_well,
          warnings,
          urgent,
          next_actions,
          stats: { cnt: 0, total_amount: 0, avg_age: 0, stuck7: 0, stuck14: 0 },
          _ai_skipped: true,
        },
      });
    }

    // distMap, funnel 은 위에서 이미 calcFunnelConversion 으로 계산됨

    // 정체 통계
    const stuck14 = cards.filter(c => c.days_in_stage >= 14).length;
    const stuck7 = cards.filter(c => c.days_in_stage >= 7 && c.days_in_stage < 14).length;
    const avgAge = cards.length
      ? Math.round(cards.reduce((s, c) => s + (c.days_in_stage || 0), 0) / cards.length)
      : 0;
    const totalAmount = cards.reduce((s, c) => s + Number(c.expected_amount || 0), 0);

    // 상위 5건 상세 (정체된 것 우선)
    const topCards = cards
      .sort((a, b) => (b.days_in_stage || 0) - (a.days_in_stage || 0))
      .slice(0, 5)
      .map(
        c =>
          `- ${c.customer_name}/${c.project_name} (${c.business_type}, ${c.region}, ${Number(c.expected_amount || 0).toLocaleString()}${c.currency || 'KRW'}, ${c.days_in_stage}일 경과)`
      );

    // ── 단계 흐름 + 시간 기반 전환율 (funnel 누적 도달) ────────
    // flowKeys 는 funnel 에서 가져옴 (won 포함, 사용자 정의 단계 호환)
    const flowKeys = funnel.flowKeys;
    const idx = flowKeys.indexOf(stage);
    const prev = idx > 0 ? flowKeys[idx - 1] : null;
    const next = idx >= 0 && idx < flowKeys.length - 1 ? flowKeys[idx + 1] : null;

    const prevLabel = prev ? stages.find(s => s.stage_key === prev)?.label || prev : null;
    const nextLabel = next ? stages.find(s => s.stage_key === next)?.label || next : null;

    // 누적 도달 카드 수
    const stageReached = funnel.reached[stage] || 0;
    const prevReached = prev ? funnel.reached[prev] || 0 : null;
    const nextReached = next ? funnel.reached[next] || 0 : null;

    // 진정한 전환율 (누적 도달 기반, 항상 0~100%)
    const nextRate =
      next && stageReached > 0 ? Math.round((nextReached / stageReached) * 100) : null;
    const prevRate =
      prev && prevReached > 0 ? Math.round((stageReached / prevReached) * 100) : null;

    // 단계별 cnt (현재 모수 — 화면 표시용)
    const distMap = {};
    Object.keys(funnel.dist).forEach(k => (distMap[k] = { cnt: funnel.dist[k] }));
    const prevCnt = prev ? funnel.dist[prev] || 0 : null;
    const nextCnt = next ? funnel.dist[next] || 0 : null;

    // ══════════════════════════════════════════════════════════════
    // 🔒 사실 기반 진단 (백엔드 100% 신뢰 — AI 환각 차단)
    //    status / headline / going_well / warnings / urgent 는 모두 백엔드가 계산
    //    AI는 next_actions 만 제안 (실행 액션)
    // ══════════════════════════════════════════════════════════════
    const facts = { going_well: [], warnings: [], urgent: [] };

    // 잘 가고 있는 점 (사실 기반)
    if (stuck14 === 0 && stuck7 === 0 && cards.length > 0) {
      facts.going_well.push(`정체 딜 없음 (전체 ${cards.length}건 모두 7일 이내)`);
    }
    if (nextRate !== null && nextRate >= 60) {
      facts.going_well.push(`다음 단계(${nextLabel}) 전환율 ${nextRate}% — 양호`);
    }
    if (avgAge > 0 && avgAge <= 3) {
      facts.going_well.push(`평균 체류 ${avgAge}일 — 빠른 진행`);
    }
    if (cards.length > 0 && totalAmount > 0) {
      const amt =
        totalAmount >= 1e12
          ? `₩${(totalAmount / 1e12).toFixed(2)}조`
          : totalAmount >= 1e8
            ? `₩${(totalAmount / 1e8).toFixed(1)}억`
            : `₩${totalAmount.toLocaleString()}`;
      facts.going_well.push(`누적 ${amt} 규모의 파이프라인 확보`);
    }

    // 주의 사항 (사실 기반)
    if (stuck7 > 0 && stuck14 === 0) {
      facts.warnings.push(`7일 이상 체류 ${stuck7}건 — 진행 상태 점검 필요`);
    }
    if (nextRate !== null && nextRate >= 30 && nextRate < 60) {
      facts.warnings.push(`다음 단계 전환율 ${nextRate}% — 평균 이하 (60% 권장)`);
    }
    if (avgAge >= 7 && avgAge < 14) {
      facts.warnings.push(`평균 체류 ${avgAge}일 — 진행 속도 둔화`);
    }
    if (prevRate !== null && prevRate > 200) {
      facts.warnings.push(`이전 단계(${prevLabel})에서 ${prevRate}% 유입 — 적체 가능성`);
    }

    // 시급 사항 (사실 기반)
    if (stuck14 > 0) {
      facts.urgent.push(`14일 이상 정체 ${stuck14}건 — 즉시 처리 또는 정리 결정 필요`);
    }
    if (nextRate !== null && nextRate < 30) {
      facts.urgent.push(`다음 단계 전환율 ${nextRate}% — 심각한 병목 (30% 미만)`);
    }
    if (avgAge >= 14) {
      facts.urgent.push(`평균 체류 ${avgAge}일 — 단계 흐름 단절 위기`);
    }

    // status 결정 (사실 기반)
    let calculatedStatus;
    if (facts.urgent.length > 0) calculatedStatus = '시급';
    else if (facts.warnings.length > 0) calculatedStatus = '주의';
    else calculatedStatus = '정상';

    // headline 자동 생성
    let calculatedHeadline;
    if (calculatedStatus === '시급') {
      calculatedHeadline =
        stuck14 > 0
          ? `${stageLabel}: 14일+ 정체 ${stuck14}건 즉시 조치 필요`
          : nextRate !== null && nextRate < 30
            ? `${stageLabel}: 다음 단계 전환율 ${nextRate}%로 심각한 병목`
            : `${stageLabel}: 단계 흐름에 심각한 문제 발생`;
    } else if (calculatedStatus === '주의') {
      calculatedHeadline =
        stuck7 > 0
          ? `${stageLabel}: 7일+ 체류 ${stuck7}건 점검 필요`
          : nextRate !== null && nextRate < 60
            ? `${stageLabel}: 다음 단계 전환율 ${nextRate}%로 평균 이하`
            : `${stageLabel}: 일부 지표 점검 필요`;
    } else {
      calculatedHeadline = `${stageLabel}: ${cards.length}건 정상 진행 중`;
    }

    // ── AI는 next_actions 만 생성 (창의적 액션 제안) ────────────
    const contextText = `
[현재 단계] ${stageLabel}: ${cards.length}건 / 금액 ${totalAmount.toLocaleString()}원
${prev ? `[이전 단계] ${prevLabel}: ${prevCnt}건${prevRate !== null ? ` (이전→현재 진입율 ${prevRate}%)` : ''}` : ''}
${next ? `[다음 단계] ${nextLabel}: ${nextCnt}건${nextRate !== null ? ` (현재→다음 전환율 ${nextRate}%)` : ''}` : ''}

[정체 분석]
- 평균 체류: ${avgAge}일
- 7~13일 주의: ${stuck7}건
- 14일+ 정체: ${stuck14}건

[사실 기반 진단 — 이미 결정됨]
- 진단 상태: ${calculatedStatus}
- 진단 요약: ${calculatedHeadline}
- 주의 사항: ${facts.warnings.join(' / ') || '(없음)'}
- 시급 사항: ${facts.urgent.join(' / ') || '(없음)'}

[정체 상위 상세]
${topCards.join('\n') || '(없음)'}`;

    const prompt = `당신은 OCI의 시니어 영업 코치입니다. 위에 제공된 사실 기반 진단을 바탕으로, **이번 주에 실행할 액션 3~5개**를 제안해주세요.

${contextText}

⚠️ 규칙:
- 진단(status/headline/warnings 등)은 이미 백엔드가 결정함. 변경 금지.
- 위 컨텍스트에 없는 통계 수치(예: 114%, 임의의 일수 등)를 절대 만들지 말 것.
- 각 액션은 구체적·실무적이어야 함 (예: "X일까지 Y를 검토", "Z 담당자와 미팅" 등).

다음 JSON 형식으로만 응답하세요 (마크다운 금지, 순수 JSON만):
{
  "next_actions": ["액션 1", "액션 2", "액션 3", ...]
}`;

    let nextActions = [];
    try {
      const model = genAI.getGenerativeModel({
        model: MODEL_FAST,
        safetySettings: SAFETY_SETTINGS,
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.4,
          maxOutputTokens: 500,
          thinkingConfig: { thinkingBudget: 0 },
        },
      });
      const r = await model.generateContent(prompt);
      const txt = r.response.text();
      const parsed = JSON.parse(txt);
      if (Array.isArray(parsed.next_actions)) nextActions = parsed.next_actions.slice(0, 5);
    } catch (e) {
      console.warn('AI next_actions 생성 실패 (fallback 사용):', e.message);
      // AI 실패 시 fallback 액션
      nextActions = [
        `${stageLabel} 단계 딜 ${cards.length}건의 진행 상태 일괄 점검`,
        stuck14 > 0
          ? `14일+ 정체 ${stuck14}건에 대한 액션 결정 (진행/드롭)`
          : '담당자별 단계 진행 현황 리뷰',
        next ? `다음 단계(${nextLabel}) 진입을 위한 사전 준비 점검` : '단계 정의 및 흐름 재검토',
      ];
    }

    res.json({
      success: true,
      data: {
        stage,
        stage_label: stageLabel,
        status: calculatedStatus,
        headline: calculatedHeadline,
        going_well: facts.going_well,
        warnings: facts.warnings,
        urgent: facts.urgent,
        next_actions: nextActions,
        stats: {
          cnt: cards.length,
          total_amount: totalAmount,
          avg_age: avgAge,
          stuck7,
          stuck14,
          next_rate: nextRate, // 진정한 전환율 (누적 도달 기반)
          prev_rate: prevRate,
          reached: stageReached, // 현재 단계 누적 도달 카드 수
          next_reached: nextReached, // 다음 단계 누적 도달 카드 수
        },
        // 디버깅·검증용 (페이지와 동일 모수 확인)
        _funnel: { dist: funnel.dist, reached: funnel.reached },
      },
    });
  } catch (err) {
    console.error('Stage coach error:', err.message);
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

module.exports = router;
