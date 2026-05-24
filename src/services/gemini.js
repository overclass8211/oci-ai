const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
require('dotenv').config({ override: true });
const pool = require('../db');
const { friendlyError } = require('../middleware/errorHandler');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const MODEL_FAST = 'gemini-2.5-flash';
const MODEL_PRO = 'gemini-2.5-pro';

const SAFETY_SETTINGS = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
  },
];

// SSE 헬퍼
function sseStart(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}
function sseSend(res, text) {
  res.write(`data: ${JSON.stringify({ text })}\n\n`);
}
function sseEnd(res) {
  res.write('data: [DONE]\n\n');
  res.end();
}
function sseError(res, message) {
  res.write(`data: ${JSON.stringify({ error: message, text: `\n\n⚠️ 오류: ${message}` })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

async function logTokenUsage(endpoint, usageMeta, model, userId) {
  if (!usageMeta) return;
  try {
    await pool.query(
      'INSERT INTO ai_usage (user_id, endpoint, prompt_tokens, completion_tokens, total_tokens, model) VALUES (?,?,?,?,?,?)',
      [
        userId || null,
        endpoint,
        usageMeta.promptTokenCount || 0,
        usageMeta.candidatesTokenCount || 0,
        usageMeta.totalTokenCount || 0,
        model || MODEL_FAST,
      ]
    );
    // 자동충전 체크 (비동기, 비크리티컬)
    if (userId) _checkAutoRecharge(userId).catch(() => {});
  } catch (_) {
    /* token logging is non-critical, silently skip on DB error */
  }
}

// ── 자동충전 트리거 ──────────────────────────────────────────
async function _checkAutoRecharge(userId) {
  try {
    const [[member]] = await pool.query(
      `SELECT monthly_token_limit, auto_recharge_enabled,
              auto_recharge_threshold, auto_recharge_amount
       FROM team_members WHERE id=?`,
      [userId]
    );
    if (!member || !member.auto_recharge_enabled) return;

    const [[def]] = await pool.query(
      `SELECT setting_value FROM system_settings WHERE setting_key='default_monthly_token_limit'`
    );
    const limit = member.monthly_token_limit ?? parseInt(def?.setting_value || 500000);
    if (!limit || limit <= 0) return;

    const [[row]] = await pool.query(
      `SELECT COALESCE(SUM(total_tokens),0) AS used FROM ai_usage
       WHERE user_id=? AND YEAR(created_at)=YEAR(CURRENT_DATE())
         AND MONTH(created_at)=MONTH(CURRENT_DATE())`,
      [userId]
    );

    const usedPct = (Number(row.used) / limit) * 100;
    const threshold = member.auto_recharge_threshold ?? 80;
    if (usedPct < threshold) return;

    // 이번 달 이미 자동충전 된 경우 1회로 제한
    const [[alreadyRecharged]] = await pool.query(
      `SELECT id FROM token_recharge_log
       WHERE user_id=? AND triggered_by='auto'
         AND YEAR(created_at)=YEAR(CURRENT_DATE())
         AND MONTH(created_at)=MONTH(CURRENT_DATE())
       LIMIT 1`,
      [userId]
    );
    if (alreadyRecharged) return;

    const rechargeAmt = member.auto_recharge_amount ?? 100000;
    const newLimit = limit + rechargeAmt;
    await pool.query(`UPDATE team_members SET monthly_token_limit=? WHERE id=?`, [
      newLimit,
      userId,
    ]);
    await pool.query(
      `INSERT INTO token_recharge_log (user_id, recharge_amount, new_limit, reason, triggered_by)
       VALUES (?,?,?,?,?)`,
      [userId, rechargeAmt, newLimit, `사용률 ${Math.round(usedPct)}% 도달 — 자동충전`, 'auto']
    );
    console.log(
      `[AutoRecharge] user=${userId} +${rechargeAmt.toLocaleString()} tokens → limit=${newLimit.toLocaleString()}`
    );
  } catch (_) {
    /* non-critical */
  }
}

async function isUserOverLimit(userId) {
  if (!userId) return false;
  try {
    const [[member]] = await pool.query(
      'SELECT monthly_token_limit FROM team_members WHERE id = ?',
      [userId]
    );
    if (!member) return false;
    let limit = member.monthly_token_limit;
    if (limit === null || limit === undefined) {
      const [[def]] = await pool.query(
        `SELECT setting_value FROM system_settings WHERE setting_key = 'default_monthly_token_limit'`
      );
      limit = def ? parseInt(def.setting_value) : 0;
    }
    if (!limit || limit <= 0) return false;
    const [[row]] = await pool.query(
      `SELECT COALESCE(SUM(total_tokens), 0) AS used FROM ai_usage
       WHERE user_id = ? AND YEAR(created_at) = YEAR(CURRENT_DATE())
         AND MONTH(created_at) = MONTH(CURRENT_DATE())`,
      [userId]
    );
    return Number(row.used) >= limit;
  } catch (_) {
    return false;
  }
}

async function getCrmContext() {
  const [[stats]] = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM leads WHERE stage NOT IN ('won','lost','dropped')) AS active_leads,
      (SELECT COUNT(*) FROM leads WHERE stage='bidding') AS bidding_count,
      (SELECT COUNT(*) FROM leads WHERE stage='won' AND YEAR(updated_at)=YEAR(CURRENT_DATE())) AS won_this_year,
      (SELECT COALESCE(SUM(expected_amount),0) FROM leads WHERE stage='won' AND YEAR(updated_at)=YEAR(CURRENT_DATE())) AS won_amount,
      (SELECT COUNT(*) FROM projects WHERE status='진행중') AS active_projects,
      (SELECT COUNT(*) FROM customers) AS total_customers
  `);
  const [recentLeads] = await pool.query(`
    SELECT customer_name, project_name, business_type, region, stage, expected_amount, currency
    FROM leads ORDER BY updated_at DESC LIMIT 10
  `);
  const [urgentLeads] = await pool.query(`
    SELECT customer_name, project_name, stage, bidding_deadline, expected_amount
    FROM leads
    WHERE bidding_deadline IS NOT NULL AND bidding_deadline >= CURRENT_DATE()
    ORDER BY bidding_deadline ASC LIMIT 5
  `);
  return { stats, recentLeads, urgentLeads };
}

// ── 제안 RFP AI 분석 (Phase 4-A) ──────────────────────────────
// Gemini Multimodal (inlineData base64) + responseSchema 구조화 응답.
// PDF/이미지/Office 등 mime_type 그대로 전달 → 모델이 직접 파싱.
// 결과는 호출자가 검토 후 사용자 [저장] 액션으로 DB 반영 (자동 저장 X).
//
// 입력: filePath(절대경로), mimeType, userId(토큰 추적)
// 출력: { rfp_title, rfp_received_date, rfp_due_date, rfp_summary, ai_strategy_md }
//        - 추출 실패한 필드는 null (환각 방지 — 확실하지 않으면 null)
const RFP_ANALYSIS_PROMPT = `당신은 B2B IT 솔루션 영업 전문가입니다. 첨부된 RFP(제안요청서) 문서를 분석하여 다음 정보를 JSON 으로 반환하세요.

규칙:
1. 반드시 문서에 명시된 정보만 사용하세요. 추론·추측·환각 금지.
2. 확실하지 않으면 해당 필드를 null 로 반환하세요. 빈 문자열 X.
3. 날짜는 'YYYY-MM-DD' 형식으로만. 시간 정보는 제거.
4. 금액은 정수로 (예: 50000000 = 5천만원). 통화는 'KRW'/'USD'/'EUR' 중 하나.

반환 필드:
- rfp_title: RFP 의 정식 제목 (300자 이내, 문서 상단/표지에 명시된 그대로)
- rfp_received_date: 발주처 접수 마감일 또는 문서 발행일 (null 가능)
- rfp_due_date: 제안서 제출 마감일 (null 가능, 가장 중요한 마감일)
- rfp_summary: RFP 핵심 요약 (한국어, 500자 이내) — 발주처, 사업 범위, 예산 규모, 평가 기준 등 핵심만
- customer_name: 발주처 / 고객사명 (200자 이내, 문서에 명시된 회사·기관명. 예: "(주)NICE피앤아이", "한국전력공사", null 가능)
- proposal_title: 우리가 작성할 제안서 제목 추천 (200자 이내, "[고객사명] [프로젝트명] 제안서" 형식 권장, null 가능)
- expected_amount: 사업 예상 금액 (정수, 예산이 명시된 경우만, null 가능)
- currency: 통화 코드 ('KRW' / 'USD' / 'EUR', 기본 'KRW', null 가능)
- ai_strategy_md: 제안 전략 마크다운 (2500자 이내)
   포함 항목 (6 섹션 — 사용자 워크플로우 요구):
   ## 1. 제안 목표
   ## 2. 제안 주요 일정
   ## 3. 제안 핵심 사항
   ## 4. 제안 준비사항 (체크리스트)
   ## 5. 예상 리스크
   ## 6. 독소조항 / 회피방안
`;

// Gemini Multimodal 이 직접 처리 가능한 파일 형식 (inlineData)
// PDF / 이미지 / 텍스트 외에는 별도 변환 없이는 처리 불가 (PPT/DOC/HWP 등)
const ANALYZABLE_EXT_TO_MIME = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.txt': 'text/plain',
};

function _resolveAnalyzableMime(filePath, mimeType) {
  const ext = require('path')
    .extname(String(filePath || ''))
    .toLowerCase();
  // 1) 확장자 기반 매칭 (가장 신뢰)
  if (ANALYZABLE_EXT_TO_MIME[ext]) return ANALYZABLE_EXT_TO_MIME[ext];
  // 2) mime_type 가 명시적으로 PDF/이미지/텍스트면 허용
  if (typeof mimeType === 'string') {
    const mt = mimeType.toLowerCase();
    if (mt === 'application/pdf') return 'application/pdf';
    if (mt.startsWith('image/')) return mt;
    if (mt.startsWith('text/')) return mt;
  }
  return null;
}

async function analyzeProposalRFP({ filePath, mimeType, userId, endpoint }) {
  // 테스트 환경 — Gemini API 호출 없이 mock 응답
  if (process.env.NODE_ENV === 'test') {
    return {
      rfp_title: '__MOCK__ RFP 제목',
      rfp_received_date: '2026-05-15',
      rfp_due_date: '2026-06-15',
      rfp_summary: '__MOCK__ RFP 요약 — 테스트 환경 응답',
      customer_name: '__MOCK__ 고객사',
      proposal_title: '__MOCK__ 제안서 제목',
      expected_amount: 50000000,
      currency: 'KRW',
      ai_strategy_md:
        '## 1. 제안 목표\n- 테스트\n\n## 2. 제안 주요 일정\n- 테스트\n\n## 3. 제안 핵심 사항\n- 테스트\n\n## 4. 제안 준비사항 (체크리스트)\n- 테스트\n\n## 5. 예상 리스크\n- 테스트\n\n## 6. 독소조항 / 회피방안\n- 테스트',
      _mock: true,
    };
  }

  // 사전 검증 1 — API 키 설정 확인
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.length < 10) {
    throw new Error(
      'AI 분석 서비스가 설정되지 않았습니다 (GEMINI_API_KEY 누락) — 관리자에게 문의하세요'
    );
  }

  const fs = require('fs');
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('분석 대상 파일이 존재하지 않습니다 (디스크에서 삭제됨)');
  }

  // 사전 검증 2 — Gemini 가 직접 처리 가능한 형식인지
  const resolvedMime = _resolveAnalyzableMime(filePath, mimeType);
  if (!resolvedMime) {
    throw new Error(
      'AI 분석은 PDF / 이미지 (PNG·JPG·WEBP) / 텍스트 파일만 지원합니다. ' +
        'PPT/DOC/HWP 등 Office 문서는 PDF 로 변환 후 다시 업로드하세요.'
    );
  }

  const fileBuffer = fs.readFileSync(filePath);
  // 20MB 이내 → inlineData (가장 간단)
  const sizeBytes = fileBuffer.length;
  if (sizeBytes > 20 * 1024 * 1024) {
    throw new Error(
      `파일이 20MB 를 초과합니다 (현재 ${(sizeBytes / 1024 / 1024).toFixed(1)}MB). 더 작은 파일로 시도하세요.`
    );
  }
  if (sizeBytes < 64) {
    throw new Error('파일이 너무 작거나 손상된 것 같습니다 (64 bytes 미만)');
  }
  const base64 = fileBuffer.toString('base64');

  console.log(
    `[gemini:analyzeProposalRFP] filePath=${filePath} mime=${resolvedMime} size=${(sizeBytes / 1024).toFixed(1)}KB`
  );

  const model = genAI.getGenerativeModel({
    model: MODEL_PRO,
    safetySettings: SAFETY_SETTINGS,
  });

  let result;
  try {
    result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: resolvedMime, data: base64 } },
            { text: RFP_ANALYSIS_PROMPT },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.3, // 환각 억제 (결정적 응답 선호)
        maxOutputTokens: 6144,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            rfp_title: { type: 'string', nullable: true },
            rfp_received_date: { type: 'string', nullable: true },
            rfp_due_date: { type: 'string', nullable: true },
            rfp_summary: { type: 'string', nullable: true },
            // Phase 8-A + Phase 9: 제안 기본정보 자동 추출 (고객사/제안명/예상금액/통화)
            customer_name: { type: 'string', nullable: true },
            proposal_title: { type: 'string', nullable: true },
            expected_amount: { type: 'integer', nullable: true },
            currency: { type: 'string', nullable: true },
            ai_strategy_md: { type: 'string', nullable: true },
          },
          required: [
            'rfp_title',
            'rfp_received_date',
            'rfp_due_date',
            'rfp_summary',
            'customer_name',
            'proposal_title',
            'expected_amount',
            'currency',
            'ai_strategy_md',
          ],
        },
      },
    });
  } catch (e) {
    console.error('[gemini:analyzeProposalRFP] generateContent failed:', e?.message || e);
    // Gemini SDK 의 친절한 에러 메시지 전달
    const friendly = friendlyError(e) || e?.message || 'Gemini API 호출 실패';
    throw new Error(`AI 분석 호출 실패: ${friendly}`);
  }

  const response = result.response;
  await logTokenUsage(
    endpoint || 'proposal_rfp_analyze',
    response.usageMetadata,
    MODEL_PRO,
    userId
  );

  // 차단 사유 확인 (safety / recitation 등)
  if (response.promptFeedback?.blockReason) {
    throw new Error(`AI 분석 거부됨: ${response.promptFeedback.blockReason}`);
  }

  const text = response.text();
  if (!text || !text.trim()) {
    throw new Error('AI 응답이 비어있습니다 (Gemini 가 응답을 생성하지 못함)');
  }

  // Phase 12: JSON 파싱 강화 — markdown fence/주변 텍스트 제거 후 재시도
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    let cleaned = String(text).trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }
    try {
      parsed = JSON.parse(cleaned);
    } catch (_e2) {
      console.error(
        '[gemini:analyzeProposalRFP] JSON parse failed (after cleanup). raw text:',
        text.slice(0, 500)
      );
      throw new Error(
        'AI 분석 응답을 JSON 으로 파싱할 수 없습니다 — RFP 파일을 다시 확인하거나 다른 파일로 시도하세요'
      );
    }
  }

  // 사후 정규화 — 날짜 형식 검증 (YYYY-MM-DD 외엔 null)
  const validDate = s => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  // Phase 8-A: 통화 화이트리스트 + 금액 양수 정수 검증
  const validCurrency = s => (['KRW', 'USD', 'EUR', 'JPY', 'CNY'].includes(s) ? s : null);
  const validAmount = n => {
    const v = parseInt(n, 10);
    return Number.isFinite(v) && v > 0 && v < 1e15 ? v : null;
  };
  return {
    rfp_title: parsed.rfp_title ? String(parsed.rfp_title).slice(0, 300) : null,
    rfp_received_date: validDate(parsed.rfp_received_date),
    rfp_due_date: validDate(parsed.rfp_due_date),
    rfp_summary: parsed.rfp_summary ? String(parsed.rfp_summary).slice(0, 5000) : null,
    // Phase 8-A + Phase 9: 제안 기본정보 자동 추출 (고객사/제안명/예상금액/통화)
    customer_name: parsed.customer_name ? String(parsed.customer_name).slice(0, 200) : null,
    proposal_title: parsed.proposal_title ? String(parsed.proposal_title).slice(0, 300) : null,
    expected_amount: validAmount(parsed.expected_amount),
    currency: validCurrency(parsed.currency) || 'KRW',
    ai_strategy_md: parsed.ai_strategy_md ? String(parsed.ai_strategy_md).slice(0, 20000) : null,
  };
}

// ── 제안서 RFP 대비 평가 (Phase 6-B) ───────────────────────────
// RFP 와 제안서 파일을 동시에 Gemini Multimodal 로 전달 → 평가위원 입장에서
// 커버율(0-100) + 충족 항목 + 누락/부족 + 개선 제안 + 전체 평가를 JSON 으로 반환.
// 기존 analyzeProposalRFP 와 동일한 보안 검증 패턴 재사용 (호환 형식 / API 키 / 크기).
const PROPOSAL_EVAL_PROMPT = `당신은 발주처 평가위원입니다. 두 개의 첨부 파일을 받게 됩니다:
1) 첫 번째 파일: RFP (제안요청서)
2) 두 번째 파일: 제안서

RFP의 요구사항·평가기준·필수항목을 기준으로 제안서가 얼마나 충실히 응답했는지 객관적으로 평가하세요.

규칙:
1. RFP 에 명시된 요구사항만을 평가 기준으로 사용 (RFP에 없는 항목 만들지 마세요).
2. 모든 점수는 RFP 의 명시된 평가 항목에 근거.
3. 확실하지 않은 항목은 missing_items 에 분류 ("애매함 → 누락"으로 안전하게).
4. 평가는 한국어로.

반환 필드 (JSON):
- coverage_score: 0~100 정수 — RFP 요구사항 대비 제안서 커버율
- covered_count: 충족된 항목 개수
- missing_count: 누락된 항목 개수
- covered_items: 배열 [{ requirement, evidence }] — 최대 15개
   · requirement: RFP의 요구사항 (50자 이내)
   · evidence: 제안서의 응답 근거 (100자 이내)
- missing_items: 배열 [{ requirement, severity, suggestion }] — 최대 10개
   · requirement: 누락/부족한 RFP 요구사항
   · severity: 'high' | 'medium' | 'low'
   · suggestion: 보완 제안 (구체적, 100자 이내)
- improvement_suggestions: 배열 [{ section, suggestion }] — 최대 5개
   · section: 제안서의 어느 절/섹션 (예: '5장 가격')
   · suggestion: 개선 방향 (100자 이내)
- overall_assessment: 한국어 마크다운 종합 평가 (500자 이내)
   포함:
   ## 1. 종합 평가
   ## 2. 강점
   ## 3. 보완 필요
   ## 4. 권장 액션

[Phase 8-B + 13-3 — 수주확률 + 정량 메트릭 (신뢰성 강화)]
- quality_metrics: 객체 — 정량 평가 (각 0~5 정수, 반드시 RFP·제안서 본문 근거에서 산출)
   · requirement_coverage: 요구사항 완전성 (0~5) — RFP 필수항목 중 응답된 비율 직결
   · strategy_clarity: 핵심 전략 명확성 (0~5) — 제안서 본문에서 전략 문장이 명시되었는가
   · differentiation: 차별화 포인트 강도 (0~5) — 경쟁사와 구별되는 강점이 명확한가
   · risk_handling: 리스크 대응 적정성 (0~5) — RFP가 요구한 리스크 항목 대응 정도
   · price_competitiveness: 가격 경쟁력 (0~5)
       - 제안서에 가격/금액/단가 정보가 **없으면 반드시 0** (3 같은 기본값 절대 금지)
       - 가격 정보가 있고 합리성이 RFP 예산 대비 적절하면 3~5

- win_probability: 0~100 정수 — 제안서 품질 기반 예상 수주 가능성
   · 산출 공식 (이 공식을 반드시 따르세요):
       1단계: avg = (quality_metrics 5개 값의 평균)
       2단계: base = avg × 20  (5점 만점 → 100점 환산)
       3단계: 최종 win_probability = base ± 5점 범위 내 (예: base=64 → 59~69 사이)
   · 일관성 강제 규칙 (반드시 준수):
       - quality_metrics 5개가 **모두 0** 이면 win_probability 는 반드시 **0~10** 사이
       - 평균이 1점 미만이면 win_probability ≤ 25
       - 평균이 3점 이상이면 win_probability ≥ 50
       - 평균이 4점 이상이면 win_probability ≥ 70
       - covered_count 가 0 이면 win_probability ≤ 15 (충족 항목이 없는데 수주확률 높으면 환각)

- win_factors: 배열 string — 수주 강점 요인 최대 5개 (각 50자 이내)
   · 반드시 quality_metrics 에서 4점 이상인 항목에 근거하여 도출
   · 근거 없는 일반론 ("좋은 회사", "신뢰성 있음") 금지
- risk_factors: 배열 string — 탈락 위험 요인 최대 5개 (각 50자 이내)
   · 반드시 quality_metrics 에서 2점 이하인 항목 또는 missing_items 에 근거
   · 빈 배열 절대 금지 (모든 제안서에는 최소 1개 이상 리스크 존재)

[최종 검증 — 응답 생성 직전 자가 검토]
다음 항목이 모두 일치해야 응답을 반환하세요. 일치하지 않으면 값을 재조정:
1. win_probability 가 quality_metrics 평균 × 20 의 ±5 범위 내인가?
2. quality_metrics 가 0인 항목에 대해 win_factors/risk_factors 가 모순되지 않는가?
3. covered_count == covered_items.length 인가?
4. missing_count == missing_items.length 인가?`;

async function evaluateProposalAgainstRFP({
  rfpPath,
  rfpMime,
  proposalPath,
  proposalMime,
  userId,
  endpoint,
}) {
  // 테스트 환경 — Gemini API 호출 없이 mock 응답
  if (process.env.NODE_ENV === 'test') {
    return {
      coverage_score: 78,
      covered_count: 12,
      missing_count: 3,
      covered_items: [
        { requirement: '__MOCK__ 클라우드 인프라', evidence: '__MOCK__ 제안서 3.1절' },
      ],
      missing_items: [
        {
          requirement: '__MOCK__ 보안 인증 (ISMS-P)',
          severity: 'high',
          suggestion: '__MOCK__ 인증 보유 현황 명시 필요',
        },
      ],
      improvement_suggestions: [
        { section: '__MOCK__ 5장 가격', suggestion: '__MOCK__ 경쟁사 비교표 추가 권장' },
      ],
      overall_assessment:
        '## 1. 종합 평가\n- 테스트\n\n## 2. 강점\n- 테스트\n\n## 3. 보완 필요\n- 테스트\n\n## 4. 권장 액션\n- 테스트',
      // Phase 8-B: 수주확률 + 정성 메트릭
      win_probability: 65,
      quality_metrics: {
        requirement_coverage: 4,
        strategy_clarity: 3,
        differentiation: 3,
        risk_handling: 2,
        price_competitiveness: 3,
      },
      win_factors: ['__MOCK__ 기술 차별화', '__MOCK__ 레퍼런스 풍부'],
      risk_factors: ['__MOCK__ 보안 인증 미보유', '__MOCK__ 가격 경쟁력 약함'],
      _mock: true,
    };
  }

  // 사전 검증 — API 키
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.length < 10) {
    throw new Error(
      'AI 평가 서비스가 설정되지 않았습니다 (GEMINI_API_KEY 누락) — 관리자에게 문의하세요'
    );
  }

  const fs = require('fs');
  if (!rfpPath || !fs.existsSync(rfpPath)) {
    throw new Error('RFP 파일이 디스크에 없습니다 (삭제됨)');
  }
  if (!proposalPath || !fs.existsSync(proposalPath)) {
    throw new Error('제안서 파일이 디스크에 없습니다 (삭제됨)');
  }

  // 호환 형식 검증 (두 파일 모두)
  const rfpResolvedMime = _resolveAnalyzableMime(rfpPath, rfpMime);
  if (!rfpResolvedMime) {
    throw new Error('RFP 파일이 분석 불가 형식입니다. PDF / 이미지 (PNG·JPG·WEBP) / 텍스트만 지원');
  }
  const propResolvedMime = _resolveAnalyzableMime(proposalPath, proposalMime);
  if (!propResolvedMime) {
    throw new Error(
      '제안서 파일이 분석 불가 형식입니다. PDF / 이미지 (PNG·JPG·WEBP) / 텍스트만 지원'
    );
  }

  const rfpBuffer = fs.readFileSync(rfpPath);
  const propBuffer = fs.readFileSync(proposalPath);
  const totalBytes = rfpBuffer.length + propBuffer.length;
  // 합계 30MB 한도 (Gemini inlineData 한계 + 안전마진)
  if (totalBytes > 30 * 1024 * 1024) {
    throw new Error(
      `두 파일 합계 ${(totalBytes / 1024 / 1024).toFixed(1)}MB 가 30MB 초과 — 파일을 압축/요약하여 재시도`
    );
  }
  if (rfpBuffer.length < 64 || propBuffer.length < 64) {
    throw new Error('파일이 너무 작거나 손상되었습니다');
  }

  console.log(
    `[gemini:evaluateProposalAgainstRFP] rfp=${(rfpBuffer.length / 1024).toFixed(1)}KB prop=${(propBuffer.length / 1024).toFixed(1)}KB`
  );

  const rfpB64 = rfpBuffer.toString('base64');
  const propB64 = propBuffer.toString('base64');

  const model = genAI.getGenerativeModel({
    model: MODEL_PRO,
    safetySettings: SAFETY_SETTINGS,
  });

  let result;
  try {
    result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            { text: '[첫 번째 파일 — RFP 제안요청서]' },
            { inlineData: { mimeType: rfpResolvedMime, data: rfpB64 } },
            { text: '[두 번째 파일 — 제안서]' },
            { inlineData: { mimeType: propResolvedMime, data: propB64 } },
            { text: PROPOSAL_EVAL_PROMPT },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2, // 평가는 결정적이어야 함 (재현 가능)
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            coverage_score: { type: 'integer' },
            covered_count: { type: 'integer' },
            missing_count: { type: 'integer' },
            covered_items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  requirement: { type: 'string' },
                  evidence: { type: 'string' },
                },
                required: ['requirement', 'evidence'],
              },
            },
            missing_items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  requirement: { type: 'string' },
                  severity: { type: 'string' },
                  suggestion: { type: 'string' },
                },
                required: ['requirement', 'severity', 'suggestion'],
              },
            },
            improvement_suggestions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  section: { type: 'string' },
                  suggestion: { type: 'string' },
                },
                required: ['section', 'suggestion'],
              },
            },
            overall_assessment: { type: 'string' },
            // Phase 8-B: 수주확률 + 정성 메트릭
            win_probability: { type: 'integer' },
            quality_metrics: {
              type: 'object',
              properties: {
                requirement_coverage: { type: 'integer' },
                strategy_clarity: { type: 'integer' },
                differentiation: { type: 'integer' },
                risk_handling: { type: 'integer' },
                price_competitiveness: { type: 'integer' },
              },
              required: [
                'requirement_coverage',
                'strategy_clarity',
                'differentiation',
                'risk_handling',
                'price_competitiveness',
              ],
            },
            win_factors: { type: 'array', items: { type: 'string' } },
            risk_factors: { type: 'array', items: { type: 'string' } },
          },
          required: [
            'coverage_score',
            'covered_count',
            'missing_count',
            'covered_items',
            'missing_items',
            'improvement_suggestions',
            'overall_assessment',
            'win_probability',
            'quality_metrics',
            'win_factors',
            'risk_factors',
          ],
        },
      },
    });
  } catch (e) {
    console.error('[gemini:evaluateProposalAgainstRFP] generateContent failed:', e?.message || e);
    const friendly = friendlyError(e) || e?.message || 'Gemini API 호출 실패';
    throw new Error(`AI 평가 호출 실패: ${friendly}`);
  }

  const response = result.response;
  await logTokenUsage(endpoint || 'proposal_evaluate', response.usageMetadata, MODEL_PRO, userId);

  if (response.promptFeedback?.blockReason) {
    throw new Error(`AI 평가 거부됨: ${response.promptFeedback.blockReason}`);
  }

  const text = response.text();
  if (!text || !text.trim()) {
    throw new Error('AI 평가 응답이 비어있습니다');
  }

  // Phase 12: JSON 파싱 강화 — markdown fence/주변 텍스트 제거 + fallback
  //   Gemini가 RFP-제안서 미스매치 케이스에서 비정형 응답을 반환할 수 있음
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    // 1차 시도 실패 → markdown fence + 주변 텍스트 제거 후 재시도
    let cleaned = String(text).trim();
    // ``` 또는 ```json fence 제거
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
    // 첫 { 부터 마지막 } 사이만 추출 (앞뒤 설명 제거)
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }
    try {
      parsed = JSON.parse(cleaned);
    } catch (_e2) {
      // 2차 시도도 실패 → RFP-제안서 미스매치로 추정, fallback 응답 반환
      console.error(
        '[gemini:evaluateProposalAgainstRFP] JSON parse failed (after cleanup). raw:',
        text.slice(0, 500)
      );
      parsed = {
        coverage_score: 0,
        covered_count: 0,
        missing_count: 0,
        covered_items: [],
        missing_items: [],
        improvement_suggestions: [],
        overall_assessment:
          '⚠️ AI가 응답을 정상 형식으로 생성하지 못했습니다.\n\n가능한 원인:\n' +
          '1. 업로드한 제안서가 RFP 와 일치하지 않는 다른 사업/프로젝트의 자료일 수 있습니다.\n' +
          '2. 제안서 파일이 손상되었거나 내용이 너무 적을 수 있습니다.\n' +
          '3. RFP 와 제안서의 언어/형식이 호환되지 않을 수 있습니다.\n\n' +
          '권장 조치: 동일 사업의 정확한 RFP-제안서 쌍을 다시 업로드하여 평가를 시도하세요.',
        win_probability: 0,
        quality_metrics: {
          requirement_coverage: 0,
          strategy_clarity: 0,
          differentiation: 0,
          risk_handling: 0,
          price_competitiveness: 0,
        },
        win_factors: [],
        risk_factors: ['RFP-제안서 미스매치 추정 — 동일 사업의 자료인지 확인 필요'],
        _parseError: true,
      };
    }
  }

  // 사후 정규화 + 길이 제한
  const clip = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');
  const clipObj = arr =>
    (Array.isArray(arr) ? arr : []).slice(0, 20).map(o => ({
      ...o,
      requirement: clip(o.requirement, 150),
      evidence: clip(o.evidence, 200),
      suggestion: clip(o.suggestion, 200),
      section: clip(o.section, 100),
      severity: ['high', 'medium', 'low'].includes(o.severity) ? o.severity : 'medium',
    }));

  const score = Math.max(0, Math.min(100, parseInt(parsed.coverage_score, 10) || 0));
  // Phase 8-B + 13-3: 수주확률 + 정량 메트릭 정규화 + 환각 일관성 가드
  const clampMetric = n => Math.max(0, Math.min(5, parseInt(n, 10) || 0));
  const qm = parsed.quality_metrics || {};
  const qualityMetrics = {
    requirement_coverage: clampMetric(qm.requirement_coverage),
    strategy_clarity: clampMetric(qm.strategy_clarity),
    differentiation: clampMetric(qm.differentiation),
    risk_handling: clampMetric(qm.risk_handling),
    price_competitiveness: clampMetric(qm.price_competitiveness),
  };

  // Phase 13-3: 환각 일관성 가드 — AI 가 quality_metrics 와 동떨어진 win_probability 를 반환할 때 보정
  //   사용자 보고: "수주확률 높다고 하는데 메트릭에 0점 자리가 나옴" → 본질적 환각
  //   가드: win_probability 가 metrics 평균 × 20 ± 15점 범위를 벗어나면 평균 기반으로 재산출
  const rawWinProb = Math.max(0, Math.min(100, parseInt(parsed.win_probability, 10) || 50));
  const metricsAvg =
    (qualityMetrics.requirement_coverage +
      qualityMetrics.strategy_clarity +
      qualityMetrics.differentiation +
      qualityMetrics.risk_handling +
      qualityMetrics.price_competitiveness) /
    5;
  const expectedWinProb = Math.round(metricsAvg * 20); // 평균 × 20 = 기대 수주확률
  const winProbDiff = Math.abs(rawWinProb - expectedWinProb);
  let winProb;
  if (metricsAvg === 0) {
    // 모든 메트릭 0 이면 수주확률도 0
    winProb = 0;
  } else if (winProbDiff > 15) {
    // 15점 초과 괴리 → 평균 기반으로 보정 (±5 노이즈 허용)
    winProb = Math.max(0, Math.min(100, expectedWinProb));
    console.warn(
      `[gemini:evaluateProposalAgainstRFP] win_probability 환각 보정: AI=${rawWinProb} → ${winProb} (metrics 평균 ${metricsAvg.toFixed(1)} 기반)`
    );
  } else {
    winProb = rawWinProb;
  }
  const clipArr = (arr, maxItems, maxLen) =>
    (Array.isArray(arr) ? arr : [])
      .slice(0, maxItems)
      .map(s => clip(s, maxLen))
      .filter(Boolean);
  return {
    coverage_score: score,
    covered_count: parseInt(parsed.covered_count, 10) || 0,
    missing_count: parseInt(parsed.missing_count, 10) || 0,
    covered_items: clipObj(parsed.covered_items),
    missing_items: clipObj(parsed.missing_items),
    improvement_suggestions: clipObj(parsed.improvement_suggestions),
    overall_assessment: clip(parsed.overall_assessment, 5000),
    // Phase 8-B: 수주확률 + 정성 메트릭
    win_probability: winProb,
    quality_metrics: qualityMetrics,
    win_factors: clipArr(parsed.win_factors, 5, 100),
    risk_factors: clipArr(parsed.risk_factors, 5, 100),
  };
}

// =============================================================
// Contract Phase 2: AI 법무 검토 (analyzeContractLegal)
//
// 입력: 계약서 파일 1건 (PDF / 이미지 / 텍스트)
// 출력: 4가지 분석 영역 (독소조항/누락/한국법규/수정안) + 종합 평가
// =============================================================
const CONTRACT_LEGAL_PROMPT = `당신은 대한민국 법무팀 변호사입니다.
첨부된 계약서를 한국 법규(공정거래법·하도급법·개인정보보호법·약관규제법) 관점에서 검토하세요.

검토 영역 4가지:
1) 독소조항 탐지 — 우리 회사(을)에게 일방적으로 불리한 조항
2) 누락 조항 — 필수 보호조항이 빠졌는지
3) 한국 법규 부합 — 강행규정 위반 여부
4) 수정안 — 각 위험 항목별 구체적 권장 문구

규칙:
1. 반드시 한국어로 응답.
2. 계약서 본문에서 실제로 발견된 조항만 인용 (없는 조항 만들지 마세요).
3. 모든 점수는 보수적으로 (애매하면 더 위험하게 평가).
4. 수정안은 한국 표준 계약 관행에 따른 문구로 제안.

반환 필드 (JSON):
- review_score: 0~100 정수 — 전반적 안전성 점수
   · 100 = 완벽히 균형잡힌 계약
   · 70~99 = 경미한 보완 필요
   · 40~69 = 중요 위험 존재
   · 0~39 = 즉시 재협상 필요
- risk_level: 'high' | 'medium' | 'low' — review_score 와 일치해야 함
   · review_score < 40 → high
   · 40~69 → medium
   · ≥ 70 → low
- toxic_clauses: 배열 [{ clause_type, severity, location, original_text, why_problematic, suggested_fix }] — 최대 10개
   · clause_type: 예: '책임 한계', '일방적 종료권', '무제한 보증', '위약금 과다', '관할법원 지정', '경업금지 과다' 등
   · severity: 'high' | 'medium' | 'low'
   · location: 예: '제8조 1항' 또는 '제3조' (조항 번호 — 본문에서 추출)
   · original_text: 원문 발췌 (최대 200자, 따옴표 없이)
   · why_problematic: 왜 문제인지 (한국 법규 또는 관행 근거, 150자 이내)
   · suggested_fix: 수정안 (구체적 문구, 200자 이내)
- missing_clauses: 배열 [{ clause_type, importance, suggested_addition }] — 최대 8개
   · clause_type: 예: '비밀유지', '손해배상 상한', '관할법원', '분쟁해결 절차', '하자보수 책임', '지적재산권 귀속', '개인정보 처리' 등
   · importance: 'high' | 'medium' | 'low' — 누락 시 위험도
   · suggested_addition: 추가 권장 문구 (200자 이내)
- legal_compliance: 객체 — 한국 법규 부합 여부
   · fair_trade_act: { compliant: boolean, issues: string[] } — 공정거래법
   · subcontract_act: { compliant: boolean, issues: string[] } — 하도급법
   · privacy_act: { compliant: boolean, issues: string[] } — 개인정보보호법
   · 각 issues 배열은 최대 3개 (각 100자 이내)
- improvement_suggestions: 배열 [{ section, suggestion }] — 최대 5개
   · section: 예: '제5조 가격', '전반' 등
   · suggestion: 개선 방향 (150자 이내)
- overall_assessment: 한국어 마크다운 종합 평가 (500자 이내, 다음 구조 포함)
   ## 1. 종합 평가
   ## 2. 가장 큰 위험
   ## 3. 권장 액션

[일관성 강제 규칙 — 응답 직전 자가 검증]
1. risk_level 과 review_score 가 위 임계값에 일치하는가?
2. toxic_clauses 가 0건이면 review_score ≥ 70 인가?
3. toxic_clauses 중 severity='high' 가 있으면 review_score < 70 인가?
4. legal_compliance 중 한 가지라도 compliant=false 이면 risk_level ≠ 'low' 인가?
일치하지 않으면 값 재조정 후 응답.`;

async function analyzeContractLegal({ contractPath, contractMime, userId, endpoint }) {
  // 테스트 환경 — Gemini API 호출 없이 mock 응답
  if (process.env.NODE_ENV === 'test') {
    return {
      review_score: 62,
      risk_level: 'medium',
      toxic_clauses: [
        {
          clause_type: '__MOCK__ 책임 한계',
          severity: 'high',
          location: '제8조 1항',
          original_text: '__MOCK__ 본 계약 위반으로 인한 손해배상은 최대 1만원으로 한정한다.',
          why_problematic: '__MOCK__ 손해배상 상한이 비현실적으로 낮음 — 공정거래법상 무효 가능성',
          suggested_fix: '__MOCK__ "계약금액의 100%를 한도로 한다" 로 변경 권장',
        },
      ],
      missing_clauses: [
        {
          clause_type: '__MOCK__ 비밀유지',
          importance: 'high',
          suggested_addition:
            '__MOCK__ 양 당사자는 본 계약 수행 중 알게 된 상대방의 영업 비밀을 제3자에게 누설하지 않는다.',
        },
      ],
      legal_compliance: {
        fair_trade_act: { compliant: false, issues: ['__MOCK__ 손해배상 상한 무효 가능성'] },
        subcontract_act: { compliant: true, issues: [] },
        privacy_act: { compliant: true, issues: [] },
      },
      improvement_suggestions: [
        { section: '__MOCK__ 제8조', suggestion: '__MOCK__ 책임 한계 재협상 필요' },
      ],
      overall_assessment:
        '## 1. 종합 평가\n- __MOCK__ 중간 위험\n\n## 2. 가장 큰 위험\n- __MOCK__ 책임 한계 비현실적\n\n## 3. 권장 액션\n- __MOCK__ 제8조 재협상',
      _mock: true,
    };
  }

  // 사전 검증 — API 키
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.length < 10) {
    throw new Error(
      'AI 법무 검토 서비스가 설정되지 않았습니다 (GEMINI_API_KEY 누락) — 관리자에게 문의하세요'
    );
  }

  const fs = require('fs');
  if (!contractPath || !fs.existsSync(contractPath)) {
    throw new Error('계약서 파일이 디스크에 없습니다 (삭제됨)');
  }

  // 호환 형식 검증 (analyzeProposalRFP 와 동일한 _resolveAnalyzableMime 재사용)
  const resolvedMime = _resolveAnalyzableMime(contractPath, contractMime);
  if (!resolvedMime) {
    throw new Error(
      '계약서 파일이 분석 불가 형식입니다. PDF / 이미지 (PNG·JPG·WEBP) / 텍스트만 지원'
    );
  }

  const buffer = fs.readFileSync(contractPath);
  if (buffer.length < 64) {
    throw new Error('파일이 너무 작거나 손상되었습니다');
  }
  if (buffer.length > 30 * 1024 * 1024) {
    throw new Error(
      `파일 크기 ${(buffer.length / 1024 / 1024).toFixed(1)}MB 가 30MB 초과 — 파일을 압축/요약하여 재시도`
    );
  }

  console.log(
    `[gemini:analyzeContractLegal] file=${(buffer.length / 1024).toFixed(1)}KB mime=${resolvedMime}`
  );

  const b64 = buffer.toString('base64');
  const model = genAI.getGenerativeModel({
    model: MODEL_PRO,
    safetySettings: SAFETY_SETTINGS,
  });

  let result;
  try {
    result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            { text: '[계약서 본문]' },
            { inlineData: { mimeType: resolvedMime, data: b64 } },
            { text: CONTRACT_LEGAL_PROMPT },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2, // 법무 검토는 결정적이어야 함 (재현 가능)
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
    });
  } catch (e) {
    console.error('[gemini:analyzeContractLegal] generateContent failed:', e?.message || e);
    const friendly = friendlyError(e) || e?.message || 'Gemini API 호출 실패';
    throw new Error(`AI 법무 검토 호출 실패: ${friendly}`);
  }

  const response = result.response;
  await logTokenUsage(
    endpoint || 'contract_legal_review',
    response.usageMetadata,
    MODEL_PRO,
    userId
  );

  if (response.promptFeedback?.blockReason) {
    throw new Error(`AI 법무 검토 거부됨: ${response.promptFeedback.blockReason}`);
  }

  const text = response.text();
  if (!text || !text.trim()) {
    throw new Error('AI 법무 검토 응답이 비어있습니다');
  }

  // JSON 파싱 강화 (Phase 12-C 패턴 재사용)
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    let cleaned = String(text).trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }
    try {
      parsed = JSON.parse(cleaned);
    } catch (_e2) {
      console.error('[gemini:analyzeContractLegal] JSON parse failed:', text.slice(0, 500));
      parsed = {
        review_score: 0,
        risk_level: 'high',
        toxic_clauses: [],
        missing_clauses: [],
        legal_compliance: {
          fair_trade_act: { compliant: false, issues: ['AI 응답 파싱 실패'] },
          subcontract_act: { compliant: false, issues: [] },
          privacy_act: { compliant: false, issues: [] },
        },
        improvement_suggestions: [],
        overall_assessment:
          '⚠️ AI가 응답을 정상 형식으로 생성하지 못했습니다.\n\n가능한 원인:\n' +
          '1. 업로드한 파일이 계약서가 아닌 다른 문서일 수 있습니다.\n' +
          '2. 파일이 손상되었거나 텍스트가 너무 적을 수 있습니다.\n\n' +
          '권장: 정상 계약서 PDF/이미지를 다시 업로드하여 재시도하세요.',
        _parseError: true,
      };
    }
  }

  // 사후 정규화 + 길이 제한 + 일관성 가드
  const clip = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');
  const clipStrArr = (arr, maxItems, maxLen) =>
    (Array.isArray(arr) ? arr : [])
      .slice(0, maxItems)
      .map(s => clip(s, maxLen))
      .filter(Boolean);

  const reviewScore = Math.max(0, Math.min(100, parseInt(parsed.review_score, 10) || 0));
  // risk_level 자동 보정 — review_score 와 일치하지 않으면 score 기준으로 재산출
  let riskLevel = parsed.risk_level;
  if (!['high', 'medium', 'low'].includes(riskLevel)) riskLevel = null;
  const expectedRisk = reviewScore < 40 ? 'high' : reviewScore < 70 ? 'medium' : 'low';
  if (riskLevel !== expectedRisk) {
    if (riskLevel) {
      console.warn(
        `[gemini:analyzeContractLegal] risk_level 보정: AI='${riskLevel}' → '${expectedRisk}' (review_score ${reviewScore} 기반)`
      );
    }
    riskLevel = expectedRisk;
  }

  const toxicClauses = (Array.isArray(parsed.toxic_clauses) ? parsed.toxic_clauses : [])
    .slice(0, 10)
    .map(c => ({
      clause_type: clip(c.clause_type, 80),
      severity: ['high', 'medium', 'low'].includes(c.severity) ? c.severity : 'medium',
      location: clip(c.location, 80),
      original_text: clip(c.original_text, 300),
      why_problematic: clip(c.why_problematic, 250),
      suggested_fix: clip(c.suggested_fix, 300),
    }))
    .filter(c => c.clause_type);

  const missingClauses = (Array.isArray(parsed.missing_clauses) ? parsed.missing_clauses : [])
    .slice(0, 8)
    .map(c => ({
      clause_type: clip(c.clause_type, 80),
      importance: ['high', 'medium', 'low'].includes(c.importance) ? c.importance : 'medium',
      suggested_addition: clip(c.suggested_addition, 300),
    }))
    .filter(c => c.clause_type);

  const lc = parsed.legal_compliance || {};
  const normalizeLaw = obj => ({
    compliant: obj && obj.compliant === true,
    issues: clipStrArr(obj?.issues, 3, 150),
  });
  const legalCompliance = {
    fair_trade_act: normalizeLaw(lc.fair_trade_act),
    subcontract_act: normalizeLaw(lc.subcontract_act),
    privacy_act: normalizeLaw(lc.privacy_act),
  };

  const improvementSuggestions = (
    Array.isArray(parsed.improvement_suggestions) ? parsed.improvement_suggestions : []
  )
    .slice(0, 5)
    .map(s => ({ section: clip(s.section, 100), suggestion: clip(s.suggestion, 250) }))
    .filter(s => s.section || s.suggestion);

  return {
    review_score: reviewScore,
    risk_level: riskLevel,
    toxic_clauses: toxicClauses,
    missing_clauses: missingClauses,
    legal_compliance: legalCompliance,
    improvement_suggestions: improvementSuggestions,
    overall_assessment: clip(parsed.overall_assessment, 5000),
  };
}

// =============================================================
// Contract Phase 5: AI 협상 코칭 (coachContractNegotiation)
//
// 입력:
//   - 법무 검토 결과 (toxic_clauses, missing_clauses, legal_compliance)
//   - 과거 유사 계약 요약 (contract_type / customer_id / 금액 범위)
//   - 계약 메타 (금액, 통화, 기간)
//
// 출력:
//   - priority_clauses[]   협상 우선순위 top 3-5
//   - give_take_matrix     Give-and-Take (양보 가능 vs 절대 보호)
//   - similar_contracts_comparison  과거 평균 vs 현재
//   - alternative_clauses[]  대안 조항 (카운터 제안)
//   - scenarios            Best / Realistic / Worst 시나리오
//   - overall_strategy     종합 전략 (마크다운)
// =============================================================
const NEGOTIATION_COACH_PROMPT = `당신은 B2B 계약 협상 전문 코치입니다.
첨부된 법무 검토 결과와 과거 유사 계약 데이터를 분석하여, 협상 전략을 한국어로 제안하세요.

규칙:
1. 반드시 한국어로 응답.
2. 법무 검토 결과에서 실제로 발견된 항목만 근거로 사용 (없는 조항 만들지 마세요).
3. 과거 계약 데이터가 부족하면 "데이터 부족" 명시 (가짜 통계 X).
4. 모든 우선순위/심각도는 객관적 근거 (법무 검토 / 과거 평균과의 차이) 에 기반.

반환 필드 (JSON):
- priority_clauses: 배열 [{ clause, priority, reason, target_outcome }] — 최대 5개
   · clause: 조항명 (50자 이내, 예: "책임 한계", "비밀유지 기간")
   · priority: 1~5 정수 (1=최우선)
   · reason: 왜 우선순위인지 (법무 검토/유사 계약 근거, 100자 이내)
   · target_outcome: 협상 목표 (구체적 결과, 100자 이내)
- give_take_matrix: { willing_to_concede[], must_protect[] }
   · willing_to_concede: 배열 string — 양보 가능 항목 (각 80자 이내, 최대 5개)
   · must_protect: 배열 string — 절대 양보 불가 (각 80자 이내, 최대 5개)
- similar_contracts_comparison: 객체
   · samples_count: 비교 대상 계약 수 (정수, 0이면 "데이터 부족")
   · avg_amount: 과거 평균 금액 (숫자 또는 null)
   · our_position: 'above_avg' | 'avg' | 'below_avg' | 'no_data'
   · gap_analysis: 차이 분석 (200자 이내)
- alternative_clauses: 배열 [{ original, alternative, justification }] — 최대 5개
   · original: 상대방 제시 (또는 현 조항) 100자 이내
   · alternative: 우리 대안 제시 (200자 이내)
   · justification: 정당화 근거 (100자 이내)
- scenarios: 객체 { best, realistic, worst }
   · best: Best case 시나리오 (한국어 마크다운, 300자 이내)
   · realistic: Realistic case (300자 이내)
   · worst: Worst case + 대응 (300자 이내)
- overall_strategy: 종합 협상 전략 (한국어 마크다운, 500자 이내)
   구조: ## 1. 핵심 메시지\\n## 2. 협상 순서\\n## 3. 결렬 시 대응

[일관성 검증 — 응답 직전 자가 확인]
1. priority_clauses 의 priority 값이 1-5 범위 내인가?
2. 비교 데이터 없으면 (samples_count=0) our_position='no_data' 인가?
3. willing_to_concede 와 must_protect 항목이 중복되지 않는가?`;

async function coachContractNegotiation({
  legalReview,
  similarContracts,
  contractMeta,
  userId,
  endpoint,
}) {
  // 테스트 환경 — mock 응답
  if (process.env.NODE_ENV === 'test') {
    return {
      priority_clauses: [
        {
          clause: '__MOCK__ 책임 한계',
          priority: 1,
          reason: '__MOCK__ 손해배상 상한이 너무 낮음',
          target_outcome: '__MOCK__ 계약금액 100% 한도로 협상',
        },
        {
          clause: '__MOCK__ 비밀유지 기간',
          priority: 2,
          reason: '__MOCK__ 누락 조항',
          target_outcome: '__MOCK__ 5년 비밀유지 조항 추가',
        },
      ],
      give_take_matrix: {
        willing_to_concede: ['__MOCK__ 가격 조정 3-5%', '__MOCK__ 지급 조건 단축'],
        must_protect: ['__MOCK__ 손해배상 상한', '__MOCK__ 지적재산권 귀속'],
      },
      similar_contracts_comparison: {
        samples_count: 2,
        avg_amount: 50000000,
        our_position: 'above_avg',
        gap_analysis: '__MOCK__ 과거 평균보다 20% 높음',
      },
      alternative_clauses: [
        {
          original: '__MOCK__ 최대 1만원으로 한정',
          alternative: '__MOCK__ 계약금액의 100%를 한도로 한다',
          justification: '__MOCK__ 공정거래법 무효 가능성 회피',
        },
      ],
      scenarios: {
        best: '## Best\\n- __MOCK__ 모든 우선조항 관철',
        realistic: '## Realistic\\n- __MOCK__ 책임한계 협상 성공',
        worst: '## Worst\\n- __MOCK__ 결렬 시 백업 공급자',
      },
      overall_strategy:
        '## 1. 핵심 메시지\\n- __MOCK__\\n## 2. 협상 순서\\n- __MOCK__\\n## 3. 결렬 시 대응\\n- __MOCK__',
      _mock: true,
    };
  }

  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.length < 10) {
    throw new Error('AI 협상 코칭 서비스가 설정되지 않았습니다 (GEMINI_API_KEY 누락)');
  }

  // 입력 정리 — 컨텍스트 prompt 로 변환
  const lr = legalReview || {};
  const meta = contractMeta || {};
  const samples = Array.isArray(similarContracts) ? similarContracts : [];

  const contextSummary = `[계약 메타]
- 유형: ${meta.contract_type || 'N/A'}
- 금액: ${meta.contract_amount || 'N/A'} ${meta.currency || 'KRW'}
- 기간: ${meta.start_date || 'N/A'} ~ ${meta.end_date || 'N/A'}

[법무 검토 요약]
- 안전성 점수: ${lr.review_score ?? 'N/A'}/100 (위험도: ${lr.risk_level || 'N/A'})
- 독소조항 ${(lr.toxic_clauses || []).length}건:
${
  (lr.toxic_clauses || [])
    .slice(0, 5)
    .map(c => `  · [${c.severity}] ${c.clause_type}: ${c.why_problematic || ''}`)
    .join('\n') || '  (없음)'
}
- 누락조항 ${(lr.missing_clauses || []).length}건:
${
  (lr.missing_clauses || [])
    .slice(0, 5)
    .map(c => `  · [${c.importance}] ${c.clause_type}`)
    .join('\n') || '  (없음)'
}
- 한국법규 부합:
  · 공정거래법: ${lr.legal_compliance?.fair_trade_act?.compliant ? '부합' : '위반 가능'}
  · 하도급법: ${lr.legal_compliance?.subcontract_act?.compliant ? '부합' : '위반 가능'}
  · 개인정보보호법: ${lr.legal_compliance?.privacy_act?.compliant ? '부합' : '위반 가능'}

[과거 유사 계약 ${samples.length}건]
${
  samples.length === 0
    ? '(데이터 부족)'
    : samples
        .slice(0, 10)
        .map(
          s =>
            `- ${s.contract_no} | ${s.title?.slice(0, 40) || ''} | ${s.contract_amount || '-'} ${s.currency || ''} | ${s.status}`
        )
        .join('\n')
}
`;

  const model = genAI.getGenerativeModel({ model: MODEL_PRO, safetySettings: SAFETY_SETTINGS });
  let result;
  try {
    result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [{ text: contextSummary }, { text: NEGOTIATION_COACH_PROMPT }],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
    });
  } catch (e) {
    console.error('[gemini:coachContractNegotiation] generateContent failed:', e?.message || e);
    const friendly = friendlyError(e) || e?.message || 'Gemini API 호출 실패';
    throw new Error(`AI 협상 코칭 호출 실패: ${friendly}`);
  }

  const response = result.response;
  await logTokenUsage(
    endpoint || 'contract_negotiation_coach',
    response.usageMetadata,
    MODEL_PRO,
    userId
  );

  if (response.promptFeedback?.blockReason) {
    throw new Error(`AI 협상 코칭 거부됨: ${response.promptFeedback.blockReason}`);
  }

  const text = response.text();
  if (!text || !text.trim()) {
    throw new Error('AI 협상 코칭 응답이 비어있습니다');
  }

  // JSON 파싱 강화 (Phase 12-C 패턴)
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    let cleaned = String(text).trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }
    try {
      parsed = JSON.parse(cleaned);
    } catch (_e2) {
      console.error('[gemini:coachContractNegotiation] JSON parse failed:', text.slice(0, 500));
      parsed = {
        priority_clauses: [],
        give_take_matrix: { willing_to_concede: [], must_protect: [] },
        similar_contracts_comparison: {
          samples_count: 0,
          avg_amount: null,
          our_position: 'no_data',
          gap_analysis: '',
        },
        alternative_clauses: [],
        scenarios: { best: '', realistic: '', worst: '' },
        overall_strategy:
          '⚠️ AI가 응답을 정상 형식으로 생성하지 못했습니다.\n\n다시 시도하거나 법무 검토를 먼저 수행하세요.',
        _parseError: true,
      };
    }
  }

  // 사후 정규화
  const clip = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');
  const clipStrArr = (arr, maxItems, maxLen) =>
    (Array.isArray(arr) ? arr : [])
      .slice(0, maxItems)
      .map(s => clip(s, maxLen))
      .filter(Boolean);
  const clampPriority = n => Math.max(1, Math.min(5, parseInt(n, 10) || 3));

  const priorityClauses = (Array.isArray(parsed.priority_clauses) ? parsed.priority_clauses : [])
    .slice(0, 5)
    .map(c => ({
      clause: clip(c.clause, 80),
      priority: clampPriority(c.priority),
      reason: clip(c.reason, 200),
      target_outcome: clip(c.target_outcome, 200),
    }))
    .filter(c => c.clause);

  const gtm = parsed.give_take_matrix || {};
  const giveTakeMatrix = {
    willing_to_concede: clipStrArr(gtm.willing_to_concede, 5, 120),
    must_protect: clipStrArr(gtm.must_protect, 5, 120),
  };

  const scc = parsed.similar_contracts_comparison || {};
  const validPositions = ['above_avg', 'avg', 'below_avg', 'no_data'];
  const similarComparison = {
    samples_count: Math.max(0, parseInt(scc.samples_count, 10) || 0),
    avg_amount:
      scc.avg_amount !== null && scc.avg_amount !== undefined ? Number(scc.avg_amount) : null,
    our_position: validPositions.includes(scc.our_position) ? scc.our_position : 'no_data',
    gap_analysis: clip(scc.gap_analysis, 400),
  };

  const alternativeClauses = (
    Array.isArray(parsed.alternative_clauses) ? parsed.alternative_clauses : []
  )
    .slice(0, 5)
    .map(c => ({
      original: clip(c.original, 200),
      alternative: clip(c.alternative, 300),
      justification: clip(c.justification, 200),
    }))
    .filter(c => c.original || c.alternative);

  const sc = parsed.scenarios || {};
  const scenarios = {
    best: clip(sc.best, 500),
    realistic: clip(sc.realistic, 500),
    worst: clip(sc.worst, 500),
  };

  return {
    priority_clauses: priorityClauses,
    give_take_matrix: giveTakeMatrix,
    similar_contracts_comparison: similarComparison,
    alternative_clauses: alternativeClauses,
    scenarios,
    overall_strategy: clip(parsed.overall_strategy, 3000),
  };
}

async function runStream(res, params) {
  if (process.env.NODE_ENV === 'test') {
    res.write('data: {"text":"[TEST] mock AI response"}\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  const opts = { model: params.model || MODEL_FAST };
  if (params.system) opts.systemInstruction = params.system;

  const model = genAI.getGenerativeModel(opts);

  const contents = (params.messages || []).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
  }));

  const outputBudget = Math.max(params.max_tokens || 2048, 8192);

  const result = await model.generateContentStream({
    contents,
    safetySettings: SAFETY_SETTINGS,
    generationConfig: {
      maxOutputTokens: outputBudget,
      temperature: 0.7,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  let totalChars = 0;
  for await (const chunk of result.stream) {
    let text;
    try {
      text = chunk.text();
    } catch (_) {
      /* chunk decode failed, skip */
    }
    if (text) {
      sseSend(res, text);
      totalChars += text.length;
    }
  }

  let blockReason = null;
  try {
    const final = await result.response;
    await logTokenUsage(
      params._endpoint || 'stream',
      final.usageMetadata,
      opts.model,
      params._userId
    );
    if (final.promptFeedback?.blockReason) {
      blockReason = `프롬프트가 ${final.promptFeedback.blockReason} 사유로 거부되었습니다.`;
    }
    const candidate = final.candidates?.[0];
    if (
      candidate?.finishReason &&
      candidate.finishReason !== 'STOP' &&
      candidate.finishReason !== 'MAX_TOKENS'
    ) {
      if (totalChars === 0) {
        blockReason = `응답 생성 차단 (${candidate.finishReason}). 프롬프트를 다르게 표현해보세요.`;
      }
    }
  } catch (e) {
    if (totalChars === 0) blockReason = friendlyError(e);
  }

  if (blockReason && totalChars === 0) {
    sseError(res, blockReason);
    return;
  }
  sseEnd(res);
}

module.exports = {
  genAI,
  MODEL_FAST,
  MODEL_PRO,
  SAFETY_SETTINGS,
  sseStart,
  sseSend,
  sseEnd,
  sseError,
  logTokenUsage,
  isUserOverLimit,
  getCrmContext,
  runStream,
  analyzeProposalRFP,
  evaluateProposalAgainstRFP,
  analyzeContractLegal,
  coachContractNegotiation,
  friendlyError,
};
