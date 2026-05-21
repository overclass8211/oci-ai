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
const RFP_ANALYSIS_PROMPT = `당신은 B2B IT 솔루션 영업 전문가입니다. 첨부된 RFP(제안요청서) 문서를 분석하여 다음 5가지 정보를 JSON 으로 반환하세요.

규칙:
1. 반드시 문서에 명시된 정보만 사용하세요. 추론·추측·환각 금지.
2. 확실하지 않으면 해당 필드를 null 로 반환하세요. 빈 문자열 X.
3. 날짜는 'YYYY-MM-DD' 형식으로만. 시간 정보는 제거.

반환 필드:
- rfp_title: RFP 의 정식 제목 (300자 이내, 문서 상단/표지에 명시된 그대로)
- rfp_received_date: 발주처 접수 마감일 또는 문서 발행일 (null 가능)
- rfp_due_date: 제안서 제출 마감일 (null 가능, 가장 중요한 마감일)
- rfp_summary: RFP 핵심 요약 (한국어, 500자 이내) — 발주처, 사업 범위, 예산 규모, 평가 기준 등 핵심만
- ai_strategy_md: 제안 전략 마크다운 (1500자 이내)
   포함 항목:
   ## 1. RFP 핵심 요약
   ## 2. 평가 기준 분석
   ## 3. 차별화 포인트 (기술/가격/일정/사후관리)
   ## 4. 리스크 요인
   ## 5. 권장 제안 방향
`;

async function analyzeProposalRFP({ filePath, mimeType, userId, endpoint }) {
  // 테스트 환경 — Gemini API 호출 없이 mock 응답
  if (process.env.NODE_ENV === 'test') {
    return {
      rfp_title: '__MOCK__ RFP 제목',
      rfp_received_date: '2026-05-15',
      rfp_due_date: '2026-06-15',
      rfp_summary: '__MOCK__ RFP 요약 — 테스트 환경 응답',
      ai_strategy_md:
        '## 1. RFP 핵심 요약\n- 테스트\n\n## 2. 평가 기준 분석\n- 테스트\n\n## 3. 차별화 포인트\n- 테스트\n\n## 4. 리스크 요인\n- 테스트\n\n## 5. 권장 제안 방향\n- 테스트',
      _mock: true,
    };
  }

  const fs = require('fs');
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('분석 대상 파일이 존재하지 않습니다');
  }
  const fileBuffer = fs.readFileSync(filePath);
  // 20MB 이내 → inlineData (가장 간단)
  // 그 이상은 Files API 사용 (Phase 4-B 이후 확장)
  const sizeBytes = fileBuffer.length;
  if (sizeBytes > 20 * 1024 * 1024) {
    throw new Error('파일이 20MB 를 초과합니다. 작은 파일로 시도하세요.');
  }
  const base64 = fileBuffer.toString('base64');

  const model = genAI.getGenerativeModel({
    model: MODEL_PRO,
    safetySettings: SAFETY_SETTINGS,
  });

  const result = await model.generateContent({
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: mimeType || 'application/pdf', data: base64 } },
          { text: RFP_ANALYSIS_PROMPT },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.3, // 환각 억제 (결정적 응답 선호)
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          rfp_title: { type: 'string', nullable: true },
          rfp_received_date: { type: 'string', nullable: true },
          rfp_due_date: { type: 'string', nullable: true },
          rfp_summary: { type: 'string', nullable: true },
          ai_strategy_md: { type: 'string', nullable: true },
        },
        required: [
          'rfp_title',
          'rfp_received_date',
          'rfp_due_date',
          'rfp_summary',
          'ai_strategy_md',
        ],
      },
    },
  });

  const response = result.response;
  await logTokenUsage(
    endpoint || 'proposal_rfp_analyze',
    response.usageMetadata,
    MODEL_PRO,
    userId
  );

  const text = response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    throw new Error('AI 응답을 JSON 으로 파싱할 수 없습니다');
  }

  // 사후 정규화 — 날짜 형식 검증 (YYYY-MM-DD 외엔 null)
  const validDate = s => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  return {
    rfp_title: parsed.rfp_title ? String(parsed.rfp_title).slice(0, 300) : null,
    rfp_received_date: validDate(parsed.rfp_received_date),
    rfp_due_date: validDate(parsed.rfp_due_date),
    rfp_summary: parsed.rfp_summary ? String(parsed.rfp_summary).slice(0, 5000) : null,
    ai_strategy_md: parsed.ai_strategy_md ? String(parsed.ai_strategy_md).slice(0, 20000) : null,
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
  friendlyError,
};
