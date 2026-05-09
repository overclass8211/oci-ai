const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
require('dotenv').config({ override: true });
const pool          = require('../db');
const { friendlyError } = require('../middleware/errorHandler');
const { getUserId } = require('../middleware/auth');

const genAI     = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const MODEL_FAST = 'gemini-2.5-flash';
const MODEL_PRO  = 'gemini-2.5-pro';

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH }
];

// SSE 헬퍼
function sseStart(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}
function sseSend(res, text)    { res.write(`data: ${JSON.stringify({ text })}\n\n`); }
function sseEnd(res)           { res.write('data: [DONE]\n\n'); res.end(); }
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
      [userId || null, endpoint, usageMeta.promptTokenCount || 0,
       usageMeta.candidatesTokenCount || 0, usageMeta.totalTokenCount || 0,
       model || MODEL_FAST]
    );
  } catch (_) {}
}

async function isUserOverLimit(userId) {
  if (!userId) return false;
  try {
    const [[member]] = await pool.query(
      'SELECT monthly_token_limit FROM team_members WHERE id = ?', [userId]
    );
    if (!member) return false;
    let limit = member.monthly_token_limit;
    if (limit == null) {
      const [[def]] = await pool.query(
        `SELECT setting_value FROM system_settings WHERE setting_key = 'default_monthly_token_limit'`
      );
      limit = def ? parseInt(def.setting_value) : 0;
    }
    if (!limit || limit <= 0) return false;
    const [[row]] = await pool.query(
      `SELECT COALESCE(SUM(total_tokens), 0) AS used FROM ai_usage
       WHERE user_id = ? AND YEAR(created_at) = YEAR(CURRENT_DATE())
         AND MONTH(created_at) = MONTH(CURRENT_DATE())`, [userId]
    );
    return Number(row.used) >= limit;
  } catch (_) { return false; }
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

async function runStream(res, params) {
  const opts = { model: params.model || MODEL_FAST };
  if (params.system) opts.systemInstruction = params.system;

  const model = genAI.getGenerativeModel(opts);

  const contents = (params.messages || []).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }]
  }));

  const outputBudget = Math.max(params.max_tokens || 2048, 8192);

  const result = await model.generateContentStream({
    contents,
    safetySettings: SAFETY_SETTINGS,
    generationConfig: {
      maxOutputTokens: outputBudget,
      temperature: 0.7,
      thinkingConfig: { thinkingBudget: 0 }
    }
  });

  let totalChars = 0;
  for await (const chunk of result.stream) {
    let text = '';
    try { text = chunk.text(); } catch (_) { text = ''; }
    if (text) { sseSend(res, text); totalChars += text.length; }
  }

  let blockReason = null;
  try {
    const final = await result.response;
    await logTokenUsage(params._endpoint || 'stream', final.usageMetadata, opts.model, params._userId);
    if (final.promptFeedback?.blockReason) {
      blockReason = `프롬프트가 ${final.promptFeedback.blockReason} 사유로 거부되었습니다.`;
    }
    const candidate = final.candidates?.[0];
    if (candidate?.finishReason && candidate.finishReason !== 'STOP' && candidate.finishReason !== 'MAX_TOKENS') {
      if (totalChars === 0) {
        blockReason = `응답 생성 차단 (${candidate.finishReason}). 프롬프트를 다르게 표현해보세요.`;
      }
    }
  } catch (e) {
    if (totalChars === 0) blockReason = friendlyError(e);
  }

  if (blockReason && totalChars === 0) { sseError(res, blockReason); return; }
  sseEnd(res);
}

module.exports = {
  genAI, MODEL_FAST, MODEL_PRO, SAFETY_SETTINGS,
  sseStart, sseSend, sseEnd, sseError,
  logTokenUsage, isUserOverLimit, getCrmContext, runStream
};
