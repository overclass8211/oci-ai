// =============================================================
// OCI CRM - Express 서버 (MariaDB + Claude AI 연동)
// =============================================================
const express = require('express');
const http    = require('http');
const WebSocket = require('ws');
const mysql   = require('mysql2/promise');
const cors    = require('cors');
const path    = require('path');
const multer  = require('multer');
const fs      = require('fs');
require('dotenv').config({ override: true });
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// WebSocket 서버
const wss = new WebSocket.Server({ server });
const wsClients = new Set();
wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
});
function wsBroadcast(data) {
  const msg = JSON.stringify(data);
  wsClients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

// 파일 업로드 설정
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 25 * 1024 * 1024 }, // 오디오 포함 25MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|mp3|wav|m4a|webm|ogg|opus|flac/;
    const ok = allowed.test(path.extname(file.originalname).toLowerCase()) ||
               (file.mimetype || '').startsWith('audio/');
    cb(null, ok);
  }
});

// Gemini 클라이언트
const { HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const MODEL_FAST = 'gemini-2.5-flash';
const MODEL_PRO  = 'gemini-2.5-pro';

// 안전 필터 — 영업/CRM 컨텍스트는 비즈니스 용어("수주", "공략" 등)가 많아
// 기본(MEDIUM) 임계값으로는 오탐 가능 → BLOCK_ONLY_HIGH 로 완화
const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH }
];

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------
// MariaDB 연결 풀
// -------------------------------------------------------------
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'oci_crm',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4'
});

// 연결 테스트
(async () => {
  try {
    const conn = await pool.getConnection();
    console.log('✅ MariaDB 연결 성공:', process.env.DB_HOST + ':' + (process.env.DB_PORT || 3306));
    conn.release();
  } catch (err) {
    console.error('❌ MariaDB 연결 실패:', err.message);
    console.error('   .env 파일의 DB 접속 정보를 확인하세요.');
  }
})();

// -------------------------------------------------------------
// 공통 에러 핸들러
// -------------------------------------------------------------
const handleError = (res, err) => {
  console.error('API Error:', err);
  res.status(500).json({ success: false, error: friendlyError(err) });
};

// =============================================================
// API: 대시보드 통계
// =============================================================
app.get('/api/dashboard/stats', async (req, res) => {
  try {
    const [[totalLeads]] = await pool.query(
      `SELECT COUNT(*) AS count FROM leads
       WHERE stage NOT IN ('won','lost','dropped')`
    );
    const [[monthlyNew]] = await pool.query(
      `SELECT COUNT(*) AS count FROM leads
       WHERE MONTH(created_at) = MONTH(CURRENT_DATE())
       AND YEAR(created_at) = YEAR(CURRENT_DATE())`
    );
    const [[wonAmount]] = await pool.query(
      `SELECT COALESCE(SUM(expected_amount),0) AS amount FROM leads
       WHERE stage = 'won' AND YEAR(updated_at) = YEAR(CURRENT_DATE())`
    );
    const [[bidding]] = await pool.query(
      `SELECT COUNT(*) AS count FROM leads WHERE stage = 'bidding'`
    );
    const [[domestic]] = await pool.query(
      `SELECT COUNT(*) AS count FROM leads
       WHERE region='국내' AND stage NOT IN ('won','lost','dropped')`
    );
    const [[overseas]] = await pool.query(
      `SELECT COUNT(*) AS count FROM leads
       WHERE region='해외' AND stage NOT IN ('won','lost','dropped')`
    );
    const [[wonCount]] = await pool.query(
      `SELECT COUNT(*) AS count FROM leads
       WHERE stage='won' AND YEAR(updated_at)=YEAR(CURRENT_DATE())`
    );
    const [[allCount]] = await pool.query(`SELECT COUNT(*) AS count FROM leads`);

    res.json({
      success: true,
      data: {
        totalLeads: totalLeads.count,
        monthlyNew: monthlyNew.count,
        wonAmount: parseFloat(wonAmount.amount),
        bidding: bidding.count,
        domestic: domestic.count,
        overseas: overseas.count,
        winRate: allCount.count > 0
          ? ((wonCount.count / allCount.count) * 100).toFixed(1)
          : 0
      }
    });
  } catch (err) { handleError(res, err); }
});

// 단계별 파이프라인 카운트
app.get('/api/dashboard/funnel', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT stage, COUNT(*) AS count, COALESCE(SUM(expected_amount),0) AS amount
       FROM leads GROUP BY stage`
    );
    res.json({ success: true, data: rows });
  } catch (err) { handleError(res, err); }
});

// 월별 영업기회 (사업유형별)
app.get('/api/dashboard/monthly', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
         DATE_FORMAT(created_at, '%Y-%m') AS month,
         business_type,
         COUNT(*) AS count
       FROM leads
       WHERE created_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH)
       GROUP BY month, business_type
       ORDER BY month`
    );
    res.json({ success: true, data: rows });
  } catch (err) { handleError(res, err); }
});

// 최근 활동
app.get('/api/dashboard/activities', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.*, t.name AS performer_name, l.customer_name, l.project_name
       FROM activities a
       LEFT JOIN team_members t ON a.performed_by = t.id
       LEFT JOIN leads l ON a.lead_id = l.id
       ORDER BY a.performed_at DESC LIMIT 10`
    );
    res.json({ success: true, data: rows });
  } catch (err) { handleError(res, err); }
});

// =============================================================
// API: 영업 리드 (Leads)
// =============================================================
app.get('/api/leads', async (req, res) => {
  try {
    const { stage, region, assigned_to, business_type, search } = req.query;
    let sql = `
      SELECT l.*, t.name AS assigned_name, t.role AS assigned_role
      FROM leads l
      LEFT JOIN team_members t ON l.assigned_to = t.id
      WHERE 1=1
    `;
    const params = [];
    if (stage)        { sql += ' AND l.stage = ?'; params.push(stage); }
    if (region)       { sql += ' AND l.region = ?'; params.push(region); }
    if (assigned_to)  { sql += ' AND l.assigned_to = ?'; params.push(assigned_to); }
    if (business_type){ sql += ' AND l.business_type = ?'; params.push(business_type); }
    if (search)       {
      sql += ' AND (l.customer_name LIKE ? OR l.project_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    sql += ' ORDER BY l.updated_at DESC';

    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) { handleError(res, err); }
});

app.get('/api/leads/:id', async (req, res) => {
  try {
    const [[lead]] = await pool.query(
      `SELECT l.*, t.name AS assigned_name FROM leads l
       LEFT JOIN team_members t ON l.assigned_to = t.id
       WHERE l.id = ?`, [req.params.id]);
    if (!lead) return res.status(404).json({ success: false, error: 'Not found' });
    const [activities] = await pool.query(
      `SELECT a.*, t.name AS performer_name FROM activities a
       LEFT JOIN team_members t ON a.performed_by = t.id
       WHERE a.lead_id = ? ORDER BY a.performed_at DESC`, [req.params.id]);
    res.json({ success: true, data: { ...lead, activities } });
  } catch (err) { handleError(res, err); }
});

app.post('/api/leads', async (req, res) => {
  try {
    const {
      customer_name, project_name, business_type, region,
      capacity_mw, expected_amount, currency, stage,
      assigned_to, expected_close_date, bidding_deadline, notes
    } = req.body;
    const [result] = await pool.query(
      `INSERT INTO leads
       (customer_name, project_name, business_type, region,
        capacity_mw, expected_amount, currency, stage,
        assigned_to, expected_close_date, bidding_deadline, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [customer_name, project_name, business_type || '태양광',
       region || '국내', capacity_mw || null, expected_amount || null,
       currency || 'KRW', stage || 'lead',
       assigned_to || null, expected_close_date || null,
       bidding_deadline || null, notes || null]
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) { handleError(res, err); }
});

app.put('/api/leads/:id', async (req, res) => {
  try {
    const fields = ['customer_name','project_name','business_type','region',
      'capacity_mw','expected_amount','currency','stage',
      'assigned_to','expected_close_date','bidding_deadline','notes'];
    const updates = [];
    const values = [];
    fields.forEach(f => {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); }
    });
    if (!updates.length) return res.json({ success: true, message: 'No changes' });
    values.push(req.params.id);
    await pool.query(`UPDATE leads SET ${updates.join(',')} WHERE id = ?`, values);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// 단계 변경 (칸반 드래그앤드롭용)
app.patch('/api/leads/:id/stage', async (req, res) => {
  try {
    const { stage } = req.body;
    await pool.query('UPDATE leads SET stage = ? WHERE id = ?', [stage, req.params.id]);
    // 활동 이력 자동 기록
    const stageNameMap = {
      lead:'리드발굴', review:'검토', proposal:'제안', bidding:'입찰',
      negotiation:'협상', won:'수주', lost:'실주', dropped:'드롭'
    };
    await pool.query(
      `INSERT INTO activities (lead_id, activity_type, title, content, performed_by)
       VALUES (?, ?, ?, ?, ?)`,
      [req.params.id,
       stage === 'won' ? '수주' : stage === 'dropped' ? '드롭' : '기타',
       `단계 변경: ${stageNameMap[stage]}`,
       `리드 단계가 ${stageNameMap[stage]}(으)로 변경되었습니다.`,
       1]
    );
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

app.delete('/api/leads/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM leads WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// =============================================================
// API: 상품 / 원가
// =============================================================
app.get('/api/products', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM products ORDER BY category, name');
    res.json({ success: true, data: rows });
  } catch (err) { handleError(res, err); }
});

app.post('/api/products', async (req, res) => {
  try {
    const { name, category, unit, current_price, currency, notes } = req.body;
    const [result] = await pool.query(
      `INSERT INTO products
       (name, category, unit, current_price, currency, last_updated, notes)
       VALUES (?,?,?,?,?,CURRENT_DATE(),?)`,
      [name, category, unit, current_price, currency || 'USD', notes || null]
    );
    await pool.query(
      `INSERT INTO cost_history (product_id, price, recorded_at)
       VALUES (?, ?, CURRENT_DATE())`, [result.insertId, current_price]);
    res.json({ success: true, id: result.insertId });
  } catch (err) { handleError(res, err); }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const { current_price, notes } = req.body;
    const [[old]] = await pool.query(
      'SELECT current_price FROM products WHERE id = ?', [req.params.id]);
    if (!old) return res.status(404).json({ success: false });

    const previous = parseFloat(old.current_price);
    const newPrice = parseFloat(current_price);
    const changePct = previous ? (((newPrice - previous) / previous) * 100).toFixed(2) : 0;

    await pool.query(
      `UPDATE products SET previous_price = ?, current_price = ?,
       change_pct = ?, last_updated = CURRENT_DATE(), notes = ? WHERE id = ?`,
      [previous, newPrice, changePct, notes || null, req.params.id]);
    await pool.query(
      `INSERT INTO cost_history (product_id, price, recorded_at)
       VALUES (?, ?, CURRENT_DATE())`, [req.params.id, newPrice]);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

app.get('/api/products/:id/history', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM cost_history WHERE product_id = ?
       ORDER BY recorded_at`, [req.params.id]);
    res.json({ success: true, data: rows });
  } catch (err) { handleError(res, err); }
});

// =============================================================
// API: 프로젝트
// =============================================================
app.get('/api/projects', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.*, t.name AS assigned_name FROM projects p
       LEFT JOIN team_members t ON p.assigned_to = t.id
       ORDER BY p.created_at DESC`);
    res.json({ success: true, data: rows });
  } catch (err) { handleError(res, err); }
});

app.post('/api/projects', async (req, res) => {
  try {
    const {
      name, customer_name, project_type, contract_amount,
      estimated_cost, status, due_date, assigned_to, notes
    } = req.body;
    const margin = (contract_amount && estimated_cost)
      ? (((contract_amount - estimated_cost) / contract_amount) * 100).toFixed(2)
      : null;
    const [result] = await pool.query(
      `INSERT INTO projects
       (name, customer_name, project_type, contract_amount,
        estimated_cost, margin_pct, status, due_date, assigned_to, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [name, customer_name, project_type, contract_amount,
       estimated_cost, margin, status || '진행중',
       due_date || null, assigned_to || null, notes || null]
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) { handleError(res, err); }
});

app.put('/api/projects/:id', async (req, res) => {
  try {
    const fields = ['name','customer_name','project_type','contract_amount',
      'estimated_cost','status','due_date','assigned_to','notes'];
    const updates = []; const values = [];
    fields.forEach(f => {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); }
    });
    if (req.body.contract_amount && req.body.estimated_cost) {
      const m = (((req.body.contract_amount - req.body.estimated_cost) / req.body.contract_amount) * 100).toFixed(2);
      updates.push('margin_pct = ?'); values.push(m);
    }
    if (!updates.length) return res.json({ success: true });
    values.push(req.params.id);
    await pool.query(`UPDATE projects SET ${updates.join(',')} WHERE id = ?`, values);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

app.delete('/api/projects/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM projects WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// =============================================================
// API: 팀원
// =============================================================
app.get('/api/team', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT t.*,
        (SELECT COUNT(*) FROM leads WHERE assigned_to = t.id) AS total_leads,
        (SELECT COUNT(*) FROM leads WHERE assigned_to = t.id
          AND stage NOT IN ('won','lost','dropped')) AS active_leads,
        (SELECT COUNT(*) FROM leads WHERE assigned_to = t.id
          AND stage = 'won' AND YEAR(updated_at) = YEAR(CURRENT_DATE())) AS won_count,
        (SELECT COALESCE(SUM(expected_amount),0) FROM leads
          WHERE assigned_to = t.id AND stage = 'won'
          AND YEAR(updated_at) = YEAR(CURRENT_DATE())) AS won_amount,
        (SELECT COUNT(*) FROM leads WHERE assigned_to = t.id
          AND MONTH(created_at) = MONTH(CURRENT_DATE())
          AND YEAR(created_at) = YEAR(CURRENT_DATE())) AS new_this_month
      FROM team_members t
      WHERE t.is_active = 1
      ORDER BY FIELD(t.role,'Sales','Field','CS'), t.name
    `);
    res.json({ success: true, data: rows });
  } catch (err) { handleError(res, err); }
});

app.post('/api/team', async (req, res) => {
  try {
    const { name, role, team, email, phone } = req.body;
    const [result] = await pool.query(
      `INSERT INTO team_members (name, role, team, email, phone)
       VALUES (?,?,?,?,?)`,
      [name, role, team || null, email || null, phone || null]);
    res.json({ success: true, id: result.insertId });
  } catch (err) { handleError(res, err); }
});

app.put('/api/team/:id', async (req, res) => {
  try {
    const fields = ['name','role','team','email','phone','is_active'];
    const updates = []; const values = [];
    fields.forEach(f => {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); }
    });
    if (!updates.length) return res.json({ success: true });
    values.push(req.params.id);
    await pool.query(`UPDATE team_members SET ${updates.join(',')} WHERE id = ?`, values);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

app.delete('/api/team/:id', async (req, res) => {
  try {
    await pool.query('UPDATE team_members SET is_active = 0 WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// =============================================================
// API: 고객사
// =============================================================
app.get('/api/customers', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM customers ORDER BY name');
    res.json({ success: true, data: rows });
  } catch (err) { handleError(res, err); }
});

app.post('/api/customers', async (req, res) => {
  try {
    const { name, region, country, industry, contact_person, phone, email, address } = req.body;
    const [result] = await pool.query(
      `INSERT INTO customers
       (name, region, country, industry, contact_person, phone, email, address)
       VALUES (?,?,?,?,?,?,?,?)`,
      [name, region || '국내', country || null, industry || null,
       contact_person || null, phone || null, email || null, address || null]);
    res.json({ success: true, id: result.insertId });
  } catch (err) { handleError(res, err); }
});

// =============================================================
// API: 활동 이력
// =============================================================
app.post('/api/activities', async (req, res) => {
  try {
    const { lead_id, project_id, activity_type, title, content, performed_by } = req.body;
    const [result] = await pool.query(
      `INSERT INTO activities
       (lead_id, project_id, activity_type, title, content, performed_by)
       VALUES (?,?,?,?,?,?)`,
      [lead_id || null, project_id || null, activity_type || '기타',
       title, content || null, performed_by || null]);
    res.json({ success: true, id: result.insertId });
  } catch (err) { handleError(res, err); }
});

// =============================================================
// API: AI 기능
// =============================================================

// CRM 컨텍스트 수집 (AI 프롬프트에 삽입)
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

function friendlyError(err) {
  const msg = err.message || String(err);
  if (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid') || msg.includes('PERMISSION_DENIED')) {
    return 'Gemini API 키가 유효하지 않습니다. .env 파일의 GEMINI_API_KEY를 확인 후 서버를 재시작하세요.';
  }
  if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota') || err.status === 429) {
    return 'Gemini API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.';
  }
  if (msg.includes('INVALID_ARGUMENT') || err.status === 400) {
    return '요청 형식 오류입니다: ' + msg;
  }
  // Gemini SDK 에러 메시지에 "blocked" 단어는 자주 포함됨 (예: "Text not available. Response may have been blocked.")
  // 실제 안전 필터 차단은 promptFeedback.blockReason 으로 판단해야 하므로, 단순 문자열 매칭은 제거
  return msg;
}

// 요청 헤더에서 사용자 ID 추출 (다중 사용자 시뮬레이션)
function getUserId(req) {
  const id = parseInt(req.headers['x-user-id']);
  return Number.isFinite(id) && id > 0 ? id : null;
}

// AI 토큰 사용량 로깅
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

// 사용자별 월간 토큰 한도 검증 — 초과 시 true 반환
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

// Gemini 스트리밍 어댑터
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
    // chunk.text() 는 청크에 텍스트 part가 없을 때 throw — 방어적 처리
    let text = '';
    try { text = chunk.text(); } catch (_) { text = ''; }
    if (text) { sseSend(res, text); totalChars += text.length; }
  }

  // 응답 메타데이터 분석 — 토큰 기록 + 차단 여부 확인
  let blockReason = null;
  try {
    const final = await result.response;
    await logTokenUsage(params._endpoint || 'stream', final.usageMetadata, opts.model, params._userId);

    // 프롬프트 자체가 거부된 경우
    if (final.promptFeedback?.blockReason) {
      blockReason = `프롬프트가 ${final.promptFeedback.blockReason} 사유로 거부되었습니다.`;
    }
    // 답변이 도중 차단된 경우
    const candidate = final.candidates?.[0];
    if (candidate?.finishReason && candidate.finishReason !== 'STOP' && candidate.finishReason !== 'MAX_TOKENS') {
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

// AI-6: 챗봇 / AI 어시스턴트 (스트리밍)
app.post('/api/ai/chat', async (req, res) => {
  let sseStarted = false;
  try {
    const { messages, context } = req.body;
    const ctx = await getCrmContext();

    const systemPrompt = `당신은 OCI의 영업관리 AI 어시스턴트입니다.
OCI는 태양광 모듈, EPC, ESS, 전기 사업을 영위하는 회사입니다.

현재 CRM 현황:
- 활성 리드: ${ctx.stats.active_leads}건
- 입찰 진행: ${ctx.stats.bidding_count}건
- 올해 수주: ${ctx.stats.won_this_year}건 / ${Number(ctx.stats.won_amount).toFixed(1)}억원
- 진행중 프로젝트: ${ctx.stats.active_projects}건
- 등록 고객사: ${ctx.stats.total_customers}개사

최근 주요 리드:
${ctx.recentLeads.map(l => `- ${l.customer_name} | ${l.project_name} | ${l.business_type} | ${l.stage}`).join('\n')}

긴박한 입찰 일정:
${ctx.urgentLeads.map(l => `- ${l.customer_name} | ${l.project_name} | 마감: ${l.bidding_deadline}`).join('\n') || '없음'}

${context ? '추가 컨텍스트: ' + context : ''}

답변은 한국어로 명확하고 간결하게 작성하세요. 영업 실무에 도움이 되는 구체적인 조언을 제공하세요.`;

    sseStart(res); sseStarted = true;
    await runStream(res, { _userId: getUserId(req),
      model: MODEL_FAST,
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages || [{ role: 'user', content: '안녕하세요' }]
    });
  } catch (err) {
    console.error('AI chat error:', err.message);
    if (sseStarted) sseError(res, friendlyError(err));
    else res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// AI-1: 고객사 브리핑
app.get('/api/ai/briefing/:customerId', async (req, res) => {
  let sseStarted = false;
  try {
    const [[customer]] = await pool.query('SELECT * FROM customers WHERE id = ?', [req.params.customerId]);
    if (!customer) return res.status(404).json({ success: false, error: '고객사 없음' });

    const [leads] = await pool.query(
      `SELECT project_name, business_type, stage, expected_amount, currency FROM leads WHERE customer_id = ? ORDER BY updated_at DESC LIMIT 10`,
      [req.params.customerId]
    );
    const [activities] = await pool.query(
      `SELECT a.activity_type, a.title, a.performed_at, t.name AS performer
       FROM activities a
       JOIN leads l ON a.lead_id = l.id
       LEFT JOIN team_members t ON a.performed_by = t.id
       WHERE l.customer_id = ? ORDER BY a.performed_at DESC LIMIT 10`,
      [req.params.customerId]
    );

    const prompt = `다음 고객사에 대한 영업 브리핑 리포트를 작성해주세요.

고객사: ${customer.name}
지역: ${customer.region} / ${customer.country || ''}
산업: ${customer.industry || '미분류'}
담당자: ${customer.contact_person || '미등록'} / ${customer.phone || ''} / ${customer.email || ''}

영업 이력 (${leads.length}건):
${leads.map(l => `- ${l.project_name} | ${l.business_type} | ${l.stage} | ${l.expected_amount}${l.currency}`).join('\n') || '없음'}

최근 활동 (${activities.length}건):
${activities.map(a => `- [${a.activity_type}] ${a.title} (${a.performer || '시스템'} / ${new Date(a.performed_at).toLocaleDateString('ko-KR')})`).join('\n') || '없음'}

다음 내용을 포함해 브리핑을 작성하세요:
1. 고객사 개요 및 특성
2. 주요 거래 현황 및 영업 단계
3. 관계 강도 평가 (활동 이력 기반)
4. 향후 영업 전략 제언 (2~3가지)
5. 주의사항 또는 리스크

간결하고 실무적으로 작성하세요.`;

    sseStart(res); sseStarted = true;
    await runStream(res, { _userId: getUserId(req),
      model: MODEL_FAST,
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }]
    });
  } catch (err) {
    console.error('AI briefing error:', err.message);
    if (sseStarted) sseError(res, friendlyError(err));
    else res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// AI-2: 리드 히스토리 요약
app.get('/api/ai/summary/:leadId', async (req, res) => {
  let sseStarted = false;
  try {
    const [[lead]] = await pool.query(
      `SELECT l.*, t.name AS assigned_name FROM leads l LEFT JOIN team_members t ON l.assigned_to = t.id WHERE l.id = ?`,
      [req.params.leadId]
    );
    if (!lead) return res.status(404).json({ success: false, error: '리드 없음' });

    const [activities] = await pool.query(
      `SELECT a.activity_type, a.title, a.content, a.performed_at, t.name AS performer
       FROM activities a LEFT JOIN team_members t ON a.performed_by = t.id
       WHERE a.lead_id = ? ORDER BY a.performed_at ASC`,
      [req.params.leadId]
    );

    const stageMap = { lead:'리드발굴', review:'검토', proposal:'제안', bidding:'입찰', negotiation:'협상', won:'수주', lost:'실주', dropped:'드롭' };

    const prompt = `다음 영업 리드의 진행 히스토리를 요약하고 분석해주세요.

프로젝트: ${lead.project_name}
고객사: ${lead.customer_name}
사업유형: ${lead.business_type} / ${lead.region}
현재 단계: ${stageMap[lead.stage] || lead.stage}
예상 금액: ${lead.expected_amount}${lead.currency}
용량: ${lead.capacity_mw ? lead.capacity_mw + ' MW' : '미정'}
담당자: ${lead.assigned_name || '미배정'}
예상 마감: ${lead.expected_close_date || '미정'}
입찰 마감: ${lead.bidding_deadline || '없음'}
메모: ${lead.notes || '없음'}

활동 이력 (${activities.length}건):
${activities.map(a => `[${new Date(a.performed_at).toLocaleDateString('ko-KR')}] ${a.activity_type}: ${a.title}${a.content ? ' - ' + a.content.substring(0, 100) : ''} (${a.performer || '시스템'})`).join('\n') || '활동 이력 없음'}

다음을 포함해 분석해주세요:
1. 영업 진행 요약 (타임라인 기반)
2. 현재 단계 평가 및 수주 가능성 (%)
3. 핵심 성공 요인 및 리스크
4. 다음 단계 액션 아이템 (구체적으로 3가지)

실무 영업 담당자가 바로 활용할 수 있게 작성하세요.`;

    sseStart(res); sseStarted = true;
    await runStream(res, { _userId: getUserId(req),
      model: MODEL_FAST,
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }]
    });
  } catch (err) {
    console.error('AI summary error:', err.message);
    if (sseStarted) sseError(res, friendlyError(err));
    else res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// AI-3: 주간/월간 보고서 생성
app.post('/api/ai/report', async (req, res) => {
  let sseStarted = false;
  try {
    const { type = 'weekly' } = req.body;
    const period = type === 'weekly' ? 7 : 30;
    const label = type === 'weekly' ? '주간' : '월간';

    const [newLeads]    = await pool.query(`SELECT customer_name, project_name, business_type, region, expected_amount, currency, stage FROM leads WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) ORDER BY created_at DESC`, [period]);
    const [wonLeads]    = await pool.query(`SELECT customer_name, project_name, expected_amount, currency FROM leads WHERE stage='won' AND updated_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`, [period]);
    const [activities]  = await pool.query(`SELECT a.activity_type, a.title, l.customer_name, t.name AS performer FROM activities a LEFT JOIN leads l ON a.lead_id = l.id LEFT JOIN team_members t ON a.performed_by = t.id WHERE a.performed_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`, [period]);
    const [pipeline]    = await pool.query(`SELECT stage, COUNT(*) AS cnt, COALESCE(SUM(expected_amount),0) AS amt FROM leads WHERE stage NOT IN ('won','lost','dropped') GROUP BY stage`);
    const [costChanges] = await pool.query(`SELECT name, category, current_price, change_pct, currency FROM products WHERE ABS(change_pct) > 2 ORDER BY ABS(change_pct) DESC LIMIT 5`);

    const prompt = `OCI 영업팀의 ${label} 보고서를 작성해주세요.

기간: 최근 ${period}일

## 신규 등록 리드 (${newLeads.length}건)
${newLeads.map(l => `- ${l.customer_name} | ${l.project_name} | ${l.business_type} | ${l.region} | ${l.expected_amount}${l.currency}`).join('\n') || '없음'}

## 이번 기간 수주 (${wonLeads.length}건)
${wonLeads.map(l => `- ${l.customer_name} | ${l.project_name} | ${l.expected_amount}${l.currency}`).join('\n') || '없음'}

## 영업 활동 (${activities.length}건)
${activities.slice(0, 10).map(a => `- [${a.activity_type}] ${a.title} - ${a.customer_name || ''} (${a.performer || ''})`).join('\n') || '없음'}

## 현재 파이프라인
${pipeline.map(p => `- ${p.stage}: ${p.cnt}건 / ${Number(p.amt).toFixed(1)}억`).join('\n')}

## 원자재/원가 주요 변동
${costChanges.map(c => `- ${c.name}: ${c.current_price}${c.currency} (${c.change_pct > 0 ? '+' : ''}${c.change_pct}%)`).join('\n') || '없음'}

다음 형식으로 보고서를 작성하세요:
1. 📊 ${label} 영업 실적 요약
2. 🏆 주요 성과 (수주/제안)
3. 📋 파이프라인 현황 분석
4. ⚠️ 주의사항 및 리스크
5. 📈 원가/시장 동향
6. 🎯 다음 주 중점 과제 (3가지)

전문적이고 실용적인 보고서 형식으로 작성하세요.`;

    sseStart(res); sseStarted = true;
    await runStream(res, { _userId: getUserId(req),
      model: MODEL_FAST,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    });
  } catch (err) {
    console.error('AI report error:', err.message);
    if (sseStarted) sseError(res, friendlyError(err));
    else res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// AI 대시보드 인사이트 (non-streaming)
app.get('/api/ai/insights', async (req, res) => {
  try {
    const ctx = await getCrmContext();
    const [riskLeads] = await pool.query(`
      SELECT customer_name, project_name, stage, expected_close_date, bidding_deadline
      FROM leads
      WHERE stage NOT IN ('won','lost','dropped')
        AND (expected_close_date <= DATE_ADD(CURRENT_DATE(), INTERVAL 14 DAY)
             OR bidding_deadline <= DATE_ADD(CURRENT_DATE(), INTERVAL 7 DAY))
      ORDER BY COALESCE(bidding_deadline, expected_close_date) ASC LIMIT 5
    `);

    const prompt = `OCI CRM 현황을 분석해 핵심 인사이트 5가지를 제공해주세요.

현황:
- 활성 리드: ${ctx.stats.active_leads}건
- 입찰 진행: ${ctx.stats.bidding_count}건
- 올해 수주: ${ctx.stats.won_this_year}건 / ${Number(ctx.stats.won_amount).toFixed(1)}억원
- 긴급 리드: ${riskLeads.map(l => `${l.customer_name}(${l.stage}, 마감:${l.bidding_deadline || l.expected_close_date})`).join(', ') || '없음'}

각 인사이트를 한 줄 요약으로 제공하세요. 형식:
[긴급/주의/정보] 인사이트 내용

영업팀이 바로 행동할 수 있는 실용적인 내용으로 작성하세요.`;

    const model = genAI.getGenerativeModel({
      model: MODEL_FAST,
      safetySettings: SAFETY_SETTINGS,
      generationConfig: {
        maxOutputTokens: 4096,
        temperature: 0.7,
        thinkingConfig: { thinkingBudget: 0 }
      }
    });
    const userId = getUserId(req);
    if (await isUserOverLimit(userId)) {
      return res.status(429).json({ success: false, error: '월간 토큰 한도를 초과했습니다.' });
    }
    const result = await model.generateContent(prompt);
    await logTokenUsage('insights', result.response.usageMetadata, MODEL_FAST, userId);
    res.json({ success: true, data: result.response.text() });
  } catch (err) {
    console.error('AI insights error:', err.message);
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// AI-5: 회의록 텍스트 정리 & 요약
app.post('/api/ai/meeting-notes', async (req, res) => {
  let sseStarted = false;
  try {
    const { text, customer_name, meeting_type } = req.body;
    if (!text) return res.status(400).json({ success: false, error: '텍스트 필요' });

    const prompt = `다음 회의 내용을 정리해 구조화된 회의록으로 작성해주세요.

고객사: ${customer_name || '미기재'}
회의 유형: ${meeting_type || '영업 미팅'}
원본 텍스트:
${text}

다음 형식으로 작성하세요:
## 회의 요약
## 주요 논의 사항
## 결정 사항
## 후속 액션 아이템 (담당자 및 기한 포함)
## 다음 미팅 일정`;

    sseStart(res); sseStarted = true;
    await runStream(res, { _userId: getUserId(req),
      model: MODEL_FAST,
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    });
  } catch (err) {
    console.error('Meeting notes error:', err.message);
    if (sseStarted) sseError(res, friendlyError(err));
    else res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// =============================================================
// API: 시스템 설정 (관리자)
// =============================================================
app.get('/api/admin/settings', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT setting_key, setting_value FROM system_settings');
    const data = {};
    rows.forEach(r => { data[r.setting_key] = r.setting_value; });
    res.json({ success: true, data });
  } catch (err) { handleError(res, err); }
});

app.put('/api/admin/settings', async (req, res) => {
  try {
    const updates = req.body || {};
    for (const [key, value] of Object.entries(updates)) {
      await pool.query(
        `INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [key, String(value)]
      );
    }
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// 사용자별 토큰 사용량 + 한도
app.get('/api/admin/token-usage-by-user', async (req, res) => {
  try {
    const [[def]] = await pool.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'default_monthly_token_limit'`
    );
    const defaultLimit = def ? parseInt(def.setting_value) : 0;

    const [rows] = await pool.query(`
      SELECT
        t.id, t.name, t.role, t.email,
        t.monthly_token_limit,
        COALESCE((
          SELECT SUM(total_tokens) FROM ai_usage
          WHERE user_id = t.id
            AND YEAR(created_at) = YEAR(CURRENT_DATE())
            AND MONTH(created_at) = MONTH(CURRENT_DATE())
        ), 0) AS used_this_month,
        COALESCE((
          SELECT COUNT(*) FROM ai_usage
          WHERE user_id = t.id
            AND YEAR(created_at) = YEAR(CURRENT_DATE())
            AND MONTH(created_at) = MONTH(CURRENT_DATE())
        ), 0) AS calls_this_month
      FROM team_members t
      WHERE t.is_active = 1
      ORDER BY used_this_month DESC, t.name
    `);
    res.json({ success: true, data: rows, defaultLimit });
  } catch (err) { handleError(res, err); }
});

// 사용자 토큰 한도 변경
app.patch('/api/admin/team-members/:id/token-limit', async (req, res) => {
  try {
    const { monthly_token_limit } = req.body;
    const limit = monthly_token_limit === '' || monthly_token_limit == null
      ? null : parseInt(monthly_token_limit);
    await pool.query(
      'UPDATE team_members SET monthly_token_limit = ? WHERE id = ?',
      [limit, req.params.id]
    );
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// AI 토큰 사용량 (오늘)
app.get('/api/ai/usage/today', async (req, res) => {
  try {
    const [[row]] = await pool.query(
      `SELECT
         COALESCE(SUM(total_tokens), 0) AS total,
         COALESCE(SUM(prompt_tokens), 0) AS prompt,
         COALESCE(SUM(completion_tokens), 0) AS completion,
         COUNT(*) AS calls
       FROM ai_usage
       WHERE DATE(created_at) = CURRENT_DATE()`
    );
    res.json({ success: true, data: {
      total:      Number(row.total),
      prompt:     Number(row.prompt),
      completion: Number(row.completion),
      calls:      Number(row.calls)
    }});
  } catch (err) { handleError(res, err); }
});

// 알림 목록
app.get('/api/notifications', async (req, res) => {
  try {
    const [urgent] = await pool.query(`
      SELECT id, customer_name, project_name, stage, bidding_deadline AS due_date, '입찰마감' AS type
      FROM leads
      WHERE bidding_deadline IS NOT NULL
        AND bidding_deadline BETWEEN CURRENT_DATE() AND DATE_ADD(CURRENT_DATE(), INTERVAL 7 DAY)
        AND stage NOT IN ('won','lost','dropped')
      UNION ALL
      SELECT id, customer_name, project_name, stage, expected_close_date AS due_date, '마감임박' AS type
      FROM leads
      WHERE expected_close_date IS NOT NULL
        AND expected_close_date BETWEEN CURRENT_DATE() AND DATE_ADD(CURRENT_DATE(), INTERVAL 3 DAY)
        AND stage NOT IN ('won','lost','dropped')
      ORDER BY due_date ASC LIMIT 20
    `);
    res.json({ success: true, data: urgent });
  } catch (err) { handleError(res, err); }
});

// =============================================================
// 정적 페이지 라우팅
// =============================================================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// =============================================================
// API: 명함 OCR (Gemini Multimodal — Vision + JSON 파싱 통합)
// =============================================================
app.post('/api/customers/ocr', upload.array('cards', 20), async (req, res) => {
  if (!process.env.GEMINI_API_KEY) {
    return res.status(400).json({ success: false, error: 'GEMINI_API_KEY가 .env에 설정되지 않았습니다.' });
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
      thinkingConfig: { thinkingBudget: 0 }
    }
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
        { inlineData: { mimeType, data: imageData } }
      ]);
      await logTokenUsage('ocr', result.response.usageMetadata, MODEL_FAST, getUserId(req));
      const text = result.response.text();

      let parsed = {};
      try {
        parsed = JSON.parse(text);
      } catch (_) {
        const m = text.match(/\{[\s\S]*\}/);
        if (m) { try { parsed = JSON.parse(m[0]); } catch (__) {} }
      }

      results.push({
        filename: file.originalname,
        raw_text: text,
        parsed
      });
    } catch (err) {
      console.error('OCR error:', err.message);
      results.push({ filename: file.originalname, error: friendlyError(err), parsed: {} });
    } finally {
      fs.unlink(file.path, () => {});
    }
  }
  res.json({ success: true, data: results });
});

// AI: 고객사 인텔리전스 (최신 동향 + Kill 전략)
app.get('/api/customers/:id/intelligence', async (req, res) => {
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

    const stageMap = { lead:'리드',review:'검토',proposal:'제안',bidding:'입찰',negotiation:'협상',won:'수주',lost:'실주',dropped:'드롭' };

    const prompt = `당신은 OCI의 시니어 영업 전략가입니다.
다음 고객사 정보를 바탕으로 최신 동향 분석과 수주 Kill 전략을 작성해주세요.

## 고객사 정보
- 회사명: ${customer.name}
- 지역: ${customer.region} / ${customer.country || ''}
- 산업: ${customer.industry || '미분류'}
- 주요 연락처: ${customer.contact_person || '미등록'} (${customer.phone || ''} / ${customer.email || ''})

## 영업 이력 (${leads.length}건)
${leads.map(l => `- ${l.project_name} | ${l.business_type} | 단계: ${stageMap[l.stage]||l.stage} | 금액: ${l.expected_amount||0}${l.currency}`).join('\n') || '이력 없음'}

## 최근 활동 (${activities.length}건)
${activities.map(a => `- [${a.activity_type}] ${a.title}: ${(a.content||'').substring(0,80)} (${a.performer||''}, ${new Date(a.performed_at).toLocaleDateString('ko-KR')})`).join('\n') || '활동 없음'}

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

    sseStart(res); sseStarted = true;
    await runStream(res, { _userId: getUserId(req),
      model: MODEL_FAST,
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    });
  } catch (err) {
    console.error('Customer intelligence error:', err.message);
    if (sseStarted) sseError(res, friendlyError(err));
    else res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// =============================================================
// API: 캘린더 이벤트
// =============================================================
app.get('/api/calendar/events', async (req, res) => {
  try {
    const { start, end, assigned_to } = req.query;
    let sql = `SELECT e.*, t.name AS assignee_name FROM calendar_events e
               LEFT JOIN team_members t ON e.assigned_to = t.id WHERE 1=1`;
    const params = [];
    if (start)       { sql += ' AND e.start_datetime >= ?'; params.push(start); }
    if (end)         { sql += ' AND e.start_datetime <= ?'; params.push(end); }
    if (assigned_to) { sql += ' AND e.assigned_to = ?';    params.push(assigned_to); }
    sql += ' ORDER BY e.start_datetime ASC LIMIT 2000';
    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) { handleError(res, err); }
});

app.post('/api/calendar/events', async (req, res) => {
  try {
    const { title, description, start_datetime, end_datetime, all_day,
            event_type, status, lead_id, customer_name, assigned_to, color, recurrence } = req.body;
    const [result] = await pool.query(
      `INSERT INTO calendar_events
       (title, description, start_datetime, end_datetime, all_day, event_type,
        status, lead_id, customer_name, assigned_to, color, recurrence)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [title, description || null, start_datetime, end_datetime || null,
       all_day ? 1 : 0, event_type || '기타', status || 'planned',
       lead_id || null, customer_name || null, assigned_to || null,
       color || '#e63946', recurrence || null]
    );
    logAccess(req, 201);
    res.json({ success: true, id: result.insertId });
  } catch (err) { handleError(res, err); }
});

app.put('/api/calendar/events/:id', async (req, res) => {
  try {
    const fields = ['title','description','start_datetime','end_datetime','all_day',
                    'event_type','status','lead_id','customer_name','assigned_to','color','recurrence'];
    const updates = []; const values = [];
    fields.forEach(f => { if (req.body[f] !== undefined) { updates.push(`${f}=?`); values.push(req.body[f]); } });
    if (!updates.length) return res.json({ success: true });
    values.push(req.params.id);
    await pool.query(`UPDATE calendar_events SET ${updates.join(',')} WHERE id=?`, values);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

app.delete('/api/calendar/events/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM calendar_events WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// 대량 시드 — 2026년 1~4월 평일에 매일 3~4건씩 영업활동 채우기
app.post('/api/calendar/seed-massive', async (req, res) => {
  try {
    // 기존 데이터 모두 삭제 (사용자 요청 시드라 깔끔하게 재생성)
    await pool.query('DELETE FROM calendar_events');

    const [leads] = await pool.query(
      `SELECT id, customer_name, project_name, business_type
       FROM leads ORDER BY id`
    );
    if (!leads.length) return res.status(400).json({ success: false, error: '리드가 없어 시드 불가' });

    const [team] = await pool.query('SELECT id, name FROM team_members WHERE is_active=1');
    const teamIds = team.length ? team.map(t => t.id) : [null];

    // 한국 공휴일 (2026년 1~4월)
    const HOLIDAYS = new Set([
      '2026-01-01', // 신정
      '2026-02-16', '2026-02-17', '2026-02-18', // 설날 연휴
      '2026-03-01', '2026-03-02', // 삼일절 + 대체공휴일
      '2026-04-15' // 국회의원 선거
    ]);

    const TYPE_COLORS = {
      '미팅':'#3788d8','영업방문':'#28a745','입찰':'#e63946',
      '제안':'#fd7e14','내부':'#6c757d','기타':'#9c27b0'
    };

    // 시간대별 활동 풀 (오전/점심/오후/저녁)
    const SLOTS = [
      { hour: 9,  label:'오전', types: ['미팅','영업방문','내부'] },
      { hour: 11, label:'오전', types: ['미팅','입찰','제안','내부'] },
      { hour: 14, label:'오후', types: ['미팅','영업방문','제안','입찰'] },
      { hour: 16, label:'오후', types: ['영업방문','내부','기타','제안'] }
    ];

    // 자연스러운 한글 타이틀 패턴 (실제 영업 활동처럼)
    const TITLE_BANK = {
      '미팅':     ['방문 미팅','기술 협의 미팅','킥오프 미팅','진행상황 점검 미팅','임원 보고 미팅','계약 조율 미팅','파트너사 미팅'],
      '영업방문': ['현장 답사','사이트 실사','본사 방문','신규 거래선 발굴 방문','관계 강화 방문','공장 실사'],
      '입찰':     ['입찰서 제출','PQ 제출','입찰 마감 대응','입찰 현장 설명회 참석','Q&A 세션 참석','기술 평가 대응'],
      '제안':     ['견적서 발송','제안서 발표','RFP 입수','제안 PT','상업 조건 협의','가격 협상','최종 제안서 제출'],
      '내부':     ['파이프라인 리뷰','영업 전략 회의','주간 보고','원가 검토','분기 실적 회의','수주 현황 공유'],
      '기타':     ['자료 전달','계약서 검토','전화 상담','이메일 팔로업','샘플 발송','문서 요청 응대']
    };

    const p2 = n => String(n).padStart(2, '0');
    const ymd = d => `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`;
    const dt  = (d,h) => `${ymd(d)} ${p2(h)}:00:00`;
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];

    // 오늘 기준 — 과거는 'completed', 미래는 'planned'
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const start = new Date('2026-01-01');
    const end   = new Date('2026-04-30');
    const rows = [];

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay();
      if (dow === 0 || dow === 6) continue;
      if (HOLIDAYS.has(ymd(d))) continue;

      const eventCount = 3 + Math.floor(Math.random() * 2);
      const slots = [...SLOTS].sort(() => Math.random() - 0.5).slice(0, eventCount);
      const status = d < today ? 'completed' : 'planned';

      for (const slot of slots) {
        const lead = pick(leads);
        const type = pick(slot.types);
        const titleAction = pick(TITLE_BANK[type]);
        const assignee = pick(teamIds);
        const endHour = slot.hour + 1;

        // "삼성케미칼 견적서 발송" 식의 자연스러운 타이틀
        const title = `${lead.customer_name} ${titleAction}`;

        rows.push([
          title,
          `${lead.project_name || lead.customer_name} 관련 ${type} — ${lead.business_type || ''}`,
          dt(new Date(d), slot.hour),
          dt(new Date(d), endHour),
          0, type, status, lead.id, lead.customer_name, assignee, TYPE_COLORS[type]
        ]);
      }
    }

    const BATCH = 50;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const placeholders = batch.map(() => '(?,?,?,?,?,?,?,?,?,?,?)').join(',');
      const flat = batch.flat();
      await pool.query(
        `INSERT INTO calendar_events
         (title,description,start_datetime,end_datetime,all_day,event_type,
          status,lead_id,customer_name,assigned_to,color)
         VALUES ${placeholders}`, flat
      );
    }

    res.json({ success: true, seeded: rows.length, period: '2026-01-01 ~ 2026-04-30' });
  } catch (err) { handleError(res, err); }
});

// 데모 데이터 시드 (calendar_events 비어있을 때만)
app.post('/api/calendar/seed-demo', async (req, res) => {
  try {
    const [[cnt]] = await pool.query('SELECT COUNT(*) AS c FROM calendar_events');
    if (cnt.c >= 5) return res.json({ success: true, seeded: 0, message: '이미 충분한 데이터 있음' });

    const [leads] = await pool.query(
      'SELECT id, customer_name, project_name FROM leads ORDER BY updated_at DESC LIMIT 15'
    );
    if (!leads.length) return res.json({ success: true, seeded: 0, message: '리드 없음' });

    const typeColors = {
      '미팅':'#3788d8','영업방문':'#28a745','입찰':'#e63946',
      '제안':'#fd7e14','내부':'#6c757d','기타':'#adb5bd'
    };
    const typeTitles = {
      '미팅':     ['킥오프 미팅','제품 소개 미팅','기술 협의 미팅','견적 검토 미팅','상황 점검 미팅'],
      '영업방문': ['현장 실사 방문','고객 니즈 파악','관계 강화 방문','경쟁 현황 파악'],
      '입찰':     ['입찰서류 제출','기술 평가 대응','현장 설명회 참석','Q&A 세션'],
      '제안':     ['기술 제안 발표','상업 조건 협의','최종 제안서 제출','가격 협상'],
      '내부':     ['주간 파이프라인 리뷰','영업 전략 회의','팀 브리핑','원가 검토 회의'],
      '기타':     ['전화 상담','이메일 팔로업','서류 전달','계약서 검토']
    };
    const types = Object.keys(typeColors);
    const now = new Date();

    const p2 = n => String(n).padStart(2, '0');
    const fmtDT = d =>
      `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())} ${p2(d.getHours())}:00:00`;

    const rows = [];
    for (let i = 0; i < 28; i++) {
      const offset = Math.floor(Math.random() * 110) - 30; // -30 ~ +80일
      const date = new Date(now);
      date.setDate(date.getDate() + offset);
      date.setHours(9 + Math.floor(Math.random() * 8), 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(date.getHours() + 1, 0, 0, 0);

      const lead = leads[Math.floor(Math.random() * leads.length)];
      const type = types[Math.floor(Math.random() * types.length)];
      const titles = typeTitles[type];
      const subtl = titles[Math.floor(Math.random() * titles.length)];

      rows.push([
        `[${type}] ${lead.customer_name} ${subtl}`,
        `${lead.project_name || lead.customer_name} 관련 ${type} 일정`,
        fmtDT(date), fmtDT(endDate), 0, type,
        lead.id, lead.customer_name, null, typeColors[type]
      ]);
    }

    for (const r of rows) {
      await pool.query(
        `INSERT INTO calendar_events
         (title,description,start_datetime,end_datetime,all_day,event_type,
          lead_id,customer_name,assigned_to,color)
         VALUES (?,?,?,?,?,?,?,?,?,?)`, r
      );
    }

    res.json({ success: true, seeded: rows.length });
  } catch (err) { handleError(res, err); }
});

// =============================================================
// API: 회의록 AI (Google STT + Gemini 요약 + 저장 + 캘린더 연동)
// =============================================================

// 1) 음성 → 텍스트 (Google Cloud Speech-to-Text + 화자 분리)
app.post('/api/meeting/transcribe', upload.single('audio'), async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(400).json({ success: false, error: 'GEMINI_API_KEY 미설정' });
  if (!req.file) return res.status(400).json({ success: false, error: '오디오 파일이 필요합니다' });

  const audioPath = req.file.path;
  try {
    const audioData = fs.readFileSync(audioPath).toString('base64');
    const sizeKB = Math.round(req.file.size / 1024);

    // 인코딩 추론
    const mime = (req.file.mimetype || '').toLowerCase();
    let encoding = 'OGG_OPUS';
    let sampleRate = 48000;
    if (mime.includes('webm'))     { encoding = 'WEBM_OPUS'; sampleRate = 48000; }
    else if (mime.includes('mp3')) { encoding = 'MP3';       sampleRate = 0;     }
    else if (mime.includes('wav')) { encoding = 'LINEAR16';  sampleRate = 16000; }
    else if (mime.includes('flac')){ encoding = 'FLAC';      sampleRate = 0;     }

    const config = {
      encoding,
      languageCode: 'ko-KR',
      enableAutomaticPunctuation: true,
      model: 'latest_long',
      diarizationConfig: {
        enableSpeakerDiarization: true,
        minSpeakerCount: 2,
        maxSpeakerCount: 6
      }
    };
    if (sampleRate) config.sampleRateHertz = sampleRate;

    // 비동기 longrunningrecognize → 폴링
    const startResp = await fetch(
      `https://speech.googleapis.com/v1/speech:longrunningrecognize?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config, audio: { content: audioData } })
      }
    );
    const startJson = await startResp.json();
    if (startJson.error) {
      return res.status(500).json({ success: false, error: `STT 오류: ${startJson.error.message}` });
    }

    const opName = startJson.name;
    let opData;
    const startTime = Date.now();
    while (true) {
      await new Promise(r => setTimeout(r, 3000));
      const opResp = await fetch(
        `https://speech.googleapis.com/v1/operations/${opName}?key=${apiKey}`
      );
      opData = await opResp.json();
      if (opData.done) break;
      if (Date.now() - startTime > 5 * 60 * 1000) {
        return res.status(504).json({ success: false, error: 'STT 처리 시간 초과 (5분). 더 짧은 오디오로 시도하세요.' });
      }
    }

    if (opData.error) {
      return res.status(500).json({ success: false, error: `STT 오류: ${opData.error.message}` });
    }

    const results = opData.response?.results || [];

    // 화자별로 그룹핑 (마지막 result 의 words 에 speakerTag 포함)
    const speakers = [];
    let rawTranscript = '';

    // 전체 텍스트
    results.forEach(r => {
      const t = r.alternatives?.[0]?.transcript || '';
      if (t) rawTranscript += t + '\n';
    });

    // 화자 분리: 마지막 result 의 words 배열에 speakerTag
    const lastWithWords = [...results].reverse().find(r => r.alternatives?.[0]?.words?.length);
    if (lastWithWords) {
      const words = lastWithWords.alternatives[0].words;
      let cur = null;
      for (const w of words) {
        const tag = w.speakerTag || 0;
        if (!cur || cur.speaker !== tag) {
          if (cur) speakers.push(cur);
          cur = { speaker: tag, text: '' };
        }
        cur.text += (cur.text ? ' ' : '') + w.word;
      }
      if (cur) speakers.push(cur);
    } else {
      // 단일 화자로 처리
      speakers.push({ speaker: 1, text: rawTranscript.trim() });
    }

    res.json({
      success: true,
      data: {
        transcript: rawTranscript.trim(),
        speakers,
        durationSec: Math.round((req.file.size * 8) / (16000 * 8)),  // 추정
        sizeKB
      }
    });
  } catch (err) {
    console.error('STT error:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    fs.unlink(audioPath, () => {});
  }
});

// 2) 텍스트 → 요약 (Gemini)
app.post('/api/meeting/summarize', async (req, res) => {
  try {
    const { transcript, speakers, customer_name, meeting_date } = req.body;
    if (!transcript) return res.status(400).json({ success: false, error: '텍스트 필요' });

    const userId = getUserId(req);
    if (await isUserOverLimit(userId)) {
      return res.status(429).json({ success: false, error: '월간 토큰 한도 초과' });
    }

    const speakerText = (speakers || []).map(s => `[화자 ${s.speaker}] ${s.text}`).join('\n');

    const prompt = `다음은 영업 미팅의 음성-텍스트 변환 결과입니다. 화자가 분리되어 있습니다.
회의록 요약 보고서를 마크다운 형식으로 작성하세요.

${customer_name ? `고객사: ${customer_name}` : ''}
${meeting_date ? `미팅 일시: ${meeting_date}` : ''}

미팅 내용:
${speakerText || transcript}

다음 4개 섹션을 반드시 포함하세요. 각 섹션 제목은 H2(##)로 시작:

## 미팅 주요 어젠다
- 미팅에서 다뤄진 핵심 의제 3~5개를 불릿으로 정리

## 핵심 내용
- 각 어젠다별 주요 논의 사항, 결정 사항, 제기된 이슈를 단락으로 서술
- 화자별 주요 발언이 있다면 화자 구분하여 표시

## 다음 해야할 일
- 액션 아이템을 \`- [ ] 담당자: 할 일 (기한)\` 형식의 체크리스트로 작성
- 최소 3개 이상

## 영업 인사이트
- 이번 미팅에서 도출된 영업적 시사점, 후속 전략, 주의사항을 간결하게 서술

전체적으로 실무 영업 담당자가 바로 활용할 수 있도록 구체적이고 명확하게 작성하세요.`;

    const model = genAI.getGenerativeModel({
      model: MODEL_FAST,
      safetySettings: SAFETY_SETTINGS,
      generationConfig: {
        maxOutputTokens: 4096,
        temperature: 0.5,
        thinkingConfig: { thinkingBudget: 0 }
      }
    });
    const result = await model.generateContent(prompt);
    await logTokenUsage('meeting-summary', result.response.usageMetadata, MODEL_FAST, userId);
    const summary = result.response.text();

    res.json({ success: true, data: { summary_md: summary } });
  } catch (err) {
    console.error('Meeting summarize error:', err);
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// 3) 회의록 CRUD
app.get('/api/meetings', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT m.id, m.title, m.meeting_date, m.customer_name, m.lead_id,
              m.calendar_event_id, m.created_at,
              SUBSTRING(m.summary_md, 1, 200) AS summary_preview,
              t.name AS created_by_name
       FROM meeting_minutes m
       LEFT JOIN team_members t ON m.created_by = t.id
       ORDER BY m.created_at DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) { handleError(res, err); }
});

app.get('/api/meetings/:id', async (req, res) => {
  try {
    const [[row]] = await pool.query(
      `SELECT m.*, t.name AS created_by_name
       FROM meeting_minutes m
       LEFT JOIN team_members t ON m.created_by = t.id
       WHERE m.id = ?`, [req.params.id]
    );
    if (!row) return res.status(404).json({ success: false, error: '회의록 없음' });
    res.json({ success: true, data: row });
  } catch (err) { handleError(res, err); }
});

app.post('/api/meetings', async (req, res) => {
  try {
    const { title, meeting_date, raw_transcript, speakers_json, summary_md,
            customer_name, lead_id } = req.body;

    const [result] = await pool.query(
      `INSERT INTO meeting_minutes
       (title, meeting_date, raw_transcript, speakers_json, summary_md,
        customer_name, lead_id, created_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [title || `회의록 ${new Date().toISOString().slice(0,10)}`,
       meeting_date || new Date().toISOString().slice(0,10),
       raw_transcript || null,
       speakers_json ? JSON.stringify(speakers_json) : null,
       summary_md || null,
       customer_name || null,
       lead_id || null,
       getUserId(req)]
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) { handleError(res, err); }
});

app.delete('/api/meetings/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM meeting_minutes WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// 4) 회의록 → 캘린더 이벤트 자동 등록
app.post('/api/meetings/:id/register-calendar', async (req, res) => {
  try {
    const { customer_name, lead_id } = req.body;
    const [[meeting]] = await pool.query('SELECT * FROM meeting_minutes WHERE id = ?', [req.params.id]);
    if (!meeting) return res.status(404).json({ success: false, error: '회의록 없음' });

    // 액션 아이템(다음 해야할 일) 추출 — summary_md 에서 ## 다음 해야할 일 섹션 파싱
    const md = meeting.summary_md || '';
    const todoMatch = md.match(/##\s*다음 해야할\s*일\s*\n([\s\S]*?)(?=\n##|$)/);
    const todoSection = todoMatch ? todoMatch[1].trim() : '';

    // 미팅 자체를 캘린더에 등록 + 액션 아이템도 별도 일정으로 등록
    const meetingTitle = `[미팅] ${customer_name || meeting.customer_name || ''} ${meeting.title}`.trim();
    const baseDate = meeting.meeting_date || new Date().toISOString().slice(0,10);

    const [calMain] = await pool.query(
      `INSERT INTO calendar_events
       (title, description, start_datetime, end_datetime, all_day, event_type,
        status, lead_id, customer_name, color)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [meetingTitle, md.substring(0, 500),
       `${baseDate} 10:00:00`, `${baseDate} 11:00:00`,
       0, '미팅', 'completed',
       lead_id || meeting.lead_id || null,
       customer_name || meeting.customer_name || null,
       '#1a73e8']
    );

    // 액션 아이템 항목별 등록 (체크리스트 라인 파싱)
    const todoLines = todoSection.split('\n')
      .map(l => l.trim())
      .filter(l => l.match(/^-\s*\[\s*\]/) || l.match(/^[\d]+\.\s/) || l.match(/^-\s/));

    let actionEventCount = 0;
    for (let i = 0; i < todoLines.length; i++) {
      const line = todoLines[i].replace(/^-\s*\[\s*\]\s*/, '').replace(/^[\d]+\.\s*/, '').replace(/^-\s*/, '').trim();
      if (!line) continue;
      const targetDate = new Date(baseDate);
      targetDate.setDate(targetDate.getDate() + i + 1);
      const dStr = targetDate.toISOString().slice(0, 10);
      await pool.query(
        `INSERT INTO calendar_events
         (title, description, start_datetime, end_datetime, all_day, event_type,
          status, lead_id, customer_name, color)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [`[액션] ${customer_name || meeting.customer_name || ''} ${line}`.substring(0, 200),
         `${meeting.title} 후속 액션 아이템`,
         `${dStr} 14:00:00`, `${dStr} 15:00:00`,
         0, '기타', 'planned',
         lead_id || meeting.lead_id || null,
         customer_name || meeting.customer_name || null,
         '#fd7e14']
      );
      actionEventCount++;
    }

    await pool.query(
      'UPDATE meeting_minutes SET calendar_event_id = ?, customer_name = ?, lead_id = ? WHERE id = ?',
      [calMain.insertId, customer_name || meeting.customer_name, lead_id || meeting.lead_id, req.params.id]
    );

    res.json({
      success: true,
      data: {
        main_event_id: calMain.insertId,
        action_events_created: actionEventCount
      }
    });
  } catch (err) { handleError(res, err); }
});

// =============================================================
// API: 게시판 (공지사항 / 댓글 / FAQ)
// =============================================================
app.get('/api/board/announcements', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT a.*, t.name AS created_by_name,
        (SELECT COUNT(*) FROM comments c WHERE c.ref_type='announcement' AND c.ref_id=a.id) AS comment_count
      FROM announcements a
      LEFT JOIN team_members t ON a.created_by = t.id
      ORDER BY a.is_pinned DESC, a.created_at DESC`);
    res.json({ success: true, data: rows });
  } catch (err) { handleError(res, err); }
});

app.post('/api/board/announcements', async (req, res) => {
  try {
    const { title, content, is_pinned, created_by } = req.body;
    const [result] = await pool.query(
      'INSERT INTO announcements (title, content, is_pinned, created_by) VALUES (?,?,?,?)',
      [title, content, is_pinned ? 1 : 0, created_by || null]);
    wsBroadcast({ type: 'announcement', title });
    res.json({ success: true, id: result.insertId });
  } catch (err) { handleError(res, err); }
});

app.put('/api/board/announcements/:id', async (req, res) => {
  try {
    const { title, content, is_pinned } = req.body;
    await pool.query(
      'UPDATE announcements SET title=?, content=?, is_pinned=? WHERE id=?',
      [title, content, is_pinned ? 1 : 0, req.params.id]);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

app.delete('/api/board/announcements/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM announcements WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

app.get('/api/board/comments', async (req, res) => {
  try {
    const { ref_type, ref_id } = req.query;
    let sql = 'SELECT * FROM comments WHERE 1=1';
    const params = [];
    if (ref_type) { sql += ' AND ref_type=?'; params.push(ref_type); }
    if (ref_id)   { sql += ' AND ref_id=?';   params.push(ref_id); }
    sql += ' ORDER BY created_at ASC';
    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) { handleError(res, err); }
});

app.post('/api/board/comments', async (req, res) => {
  try {
    const { ref_type, ref_id, content, author_name } = req.body;
    const [result] = await pool.query(
      'INSERT INTO comments (ref_type, ref_id, content, author_name) VALUES (?,?,?,?)',
      [ref_type, ref_id, content, author_name || '익명']);
    wsBroadcast({ type: 'notification', text: `💬 새 댓글: ${content.substring(0, 40)}` });
    res.json({ success: true, id: result.insertId });
  } catch (err) { handleError(res, err); }
});

app.delete('/api/board/comments/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM comments WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

app.get('/api/board/faq', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM faq ORDER BY category, created_at DESC');
    res.json({ success: true, data: rows });
  } catch (err) { handleError(res, err); }
});

app.post('/api/board/faq', async (req, res) => {
  try {
    const { question, answer, category } = req.body;
    const [result] = await pool.query(
      'INSERT INTO faq (question, answer, category) VALUES (?,?,?)',
      [question, answer, category || '기타']);
    res.json({ success: true, id: result.insertId });
  } catch (err) { handleError(res, err); }
});

app.delete('/api/board/faq/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM faq WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// =============================================================
// API: 파일 업로드
// =============================================================
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: '파일 없음' });
  const url = `/uploads/${req.file.filename}`;
  res.json({ success: true, url, name: req.file.originalname, size: req.file.size });
});

app.use('/uploads', express.static(uploadDir));

// =============================================================
// API: 관리자
// =============================================================
app.get('/api/admin/stats', async (req, res) => {
  try {
    const [[teamRow]]    = await pool.query('SELECT COUNT(*) AS cnt FROM team_members WHERE is_active=1');
    const [[logRow]]     = await pool.query(`SELECT COUNT(*) AS cnt FROM access_logs WHERE DATE(created_at)=CURRENT_DATE()`);
    const [[leadRow]]    = await pool.query('SELECT COUNT(*) AS cnt FROM leads');
    const [[actRow]]     = await pool.query('SELECT COUNT(*) AS cnt FROM activities');
    const uptimeHours    = Math.floor(process.uptime() / 3600);
    const uptimeMin      = Math.floor((process.uptime() % 3600) / 60);
    res.json({
      success: true,
      data: {
        total_team: teamRow.cnt,
        api_calls_today: logRow.cnt,
        total_leads: leadRow.cnt,
        total_activities: actRow.cnt,
        uptime: `${uptimeHours}시간 ${uptimeMin}분`,
        ws_connections: wsClients.size,
        node_version: process.version,
        memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
      }
    });
  } catch (err) { handleError(res, err); }
});

app.get('/api/admin/access-logs', async (req, res) => {
  try {
    const limit  = parseInt(req.query.limit)  || 100;
    const offset = parseInt(req.query.offset) || 0;
    const [rows]   = await pool.query(
      'SELECT * FROM access_logs ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset]);
    const [[total]] = await pool.query('SELECT COUNT(*) AS cnt FROM access_logs');
    res.json({ success: true, data: rows, total: total.cnt });
  } catch (err) { handleError(res, err); }
});

app.delete('/api/admin/access-logs', async (req, res) => {
  try {
    await pool.query('DELETE FROM access_logs');
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

app.get('/api/admin/team-stats', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT t.id, t.name, t.role, t.email,
        (SELECT COUNT(*) FROM leads WHERE assigned_to=t.id) AS leads_count,
        (SELECT COUNT(*) FROM activities WHERE performed_by=t.id) AS activities_count,
        (SELECT MAX(performed_at) FROM activities WHERE performed_by=t.id) AS last_active
      FROM team_members t WHERE t.is_active=1 ORDER BY t.name`);
    res.json({ success: true, data: rows });
  } catch (err) { handleError(res, err); }
});

app.get('/api/admin/daily-logs', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT DATE(created_at) AS day, COUNT(*) AS cnt
      FROM access_logs
      WHERE created_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
      GROUP BY day ORDER BY day ASC`);
    res.json({ success: true, data: rows });
  } catch (err) { handleError(res, err); }
});

app.get('/api/admin/top-paths', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT path, COUNT(*) AS cnt, ROUND(AVG(duration_ms)) AS avg_ms
      FROM access_logs
      GROUP BY path ORDER BY cnt DESC LIMIT 10`);
    res.json({ success: true, data: rows });
  } catch (err) { handleError(res, err); }
});

// =============================================================
// 접근 로그 미들웨어 (API 경로만)
// =============================================================
function logAccess(req, statusCode, durationMs) {
  const skip = ['/api/admin/access-logs', '/api/admin/daily-logs', '/api/admin/top-paths'];
  if (skip.some(p => req.path.startsWith(p))) return;
  pool.query(
    'INSERT INTO access_logs (action, method, path, ip, status_code, duration_ms) VALUES (?,?,?,?,?,?)',
    [req.method + ' ' + req.path, req.method, req.path,
     req.ip || req.connection.remoteAddress, statusCode || 200, durationMs || 0]
  ).catch(() => {});
}

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/admin/access-logs') ||
      req.path.startsWith('/admin/daily-logs') ||
      req.path.startsWith('/admin/top-paths')) return next();
  const start = Date.now();
  res.on('finish', () => {
    pool.query(
      'INSERT IGNORE INTO access_logs (action, method, path, ip, status_code, duration_ms) VALUES (?,?,?,?,?,?)',
      [req.method + ' /api' + req.path, req.method, '/api' + req.path,
       req.ip || '', res.statusCode, Date.now() - start]
    ).catch(() => {});
  });
  next();
});

// =============================================================
// DB 테이블 자동 생성
// =============================================================
async function initTables() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS calendar_events (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      title         VARCHAR(200) NOT NULL,
      description   TEXT,
      start_datetime DATETIME NOT NULL,
      end_datetime  DATETIME,
      all_day       TINYINT(1) DEFAULT 0,
      event_type    VARCHAR(20) DEFAULT '기타',
      status        VARCHAR(20) DEFAULT 'planned',
      lead_id       INT,
      customer_name VARCHAR(200),
      assigned_to   INT,
      color         VARCHAR(20) DEFAULT '#e63946',
      recurrence    VARCHAR(100),
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // status 컬럼이 기존 테이블에 없을 경우 추가
    try {
      await pool.query(`ALTER TABLE calendar_events ADD COLUMN status VARCHAR(20) DEFAULT 'planned'`);
    } catch (_) {}

    await pool.query(`CREATE TABLE IF NOT EXISTS announcements (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      title       VARCHAR(300) NOT NULL,
      content     TEXT NOT NULL,
      is_pinned   TINYINT(1) DEFAULT 0,
      created_by  INT,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await pool.query(`CREATE TABLE IF NOT EXISTS comments (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      ref_type    VARCHAR(30) NOT NULL,
      ref_id      INT NOT NULL,
      content     TEXT NOT NULL,
      author_name VARCHAR(100),
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ref (ref_type, ref_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await pool.query(`CREATE TABLE IF NOT EXISTS faq (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      question    TEXT NOT NULL,
      answer      TEXT NOT NULL,
      category    VARCHAR(50) DEFAULT '기타',
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await pool.query(`CREATE TABLE IF NOT EXISTS access_logs (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      action      VARCHAR(300),
      method      VARCHAR(10),
      path        VARCHAR(500),
      ip          VARCHAR(60),
      status_code INT,
      duration_ms INT,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await pool.query(`CREATE TABLE IF NOT EXISTS meeting_minutes (
      id                  INT AUTO_INCREMENT PRIMARY KEY,
      title               VARCHAR(300) NOT NULL,
      meeting_date        DATE,
      audio_filename      VARCHAR(300),
      audio_duration_sec  INT,
      raw_transcript      MEDIUMTEXT,
      speakers_json       MEDIUMTEXT,
      summary_md          MEDIUMTEXT,
      agenda              TEXT,
      key_points          TEXT,
      action_items        TEXT,
      customer_name       VARCHAR(200),
      lead_id             INT NULL,
      calendar_event_id   INT NULL,
      created_by          INT NULL,
      created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_meeting_date (meeting_date),
      INDEX idx_customer (customer_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await pool.query(`CREATE TABLE IF NOT EXISTS ai_usage (
      id                INT AUTO_INCREMENT PRIMARY KEY,
      user_id           INT NULL,
      endpoint          VARCHAR(100),
      prompt_tokens     INT DEFAULT 0,
      completion_tokens INT DEFAULT 0,
      total_tokens      INT DEFAULT 0,
      model             VARCHAR(50),
      created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_created (created_at),
      INDEX idx_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // 기존 테이블에 user_id 컬럼 없으면 추가
    try { await pool.query(`ALTER TABLE ai_usage ADD COLUMN user_id INT NULL AFTER id`); } catch (_) {}
    try { await pool.query(`ALTER TABLE ai_usage ADD INDEX idx_user (user_id)`); } catch (_) {}

    // 시스템 설정 (정책)
    await pool.query(`CREATE TABLE IF NOT EXISTS system_settings (
      setting_key   VARCHAR(50) PRIMARY KEY,
      setting_value VARCHAR(255),
      updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // 기본 정책 값 삽입 (없을 때만)
    await pool.query(
      `INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES
        ('idle_timeout_min', '30'),
        ('default_monthly_token_limit', '500000')`
    );

    // team_members 에 월별 토큰 한도 컬럼
    try { await pool.query(`ALTER TABLE team_members ADD COLUMN monthly_token_limit INT NULL`); } catch (_) {}

    // ─── 성능 인덱스 (idempotent) ─────────────────────────
    // EXPLAIN 분석으로 식별된 핫스팟에만 추가. 이미 있으면 ALTER 가 에러 → 무시.
    const idx = [
      // 캘린더: 날짜 범위 조회가 풀스캔 → 시작시간 인덱스
      `ALTER TABLE calendar_events ADD INDEX idx_start_datetime (start_datetime)`,
      // 캘린더: 담당자 + 날짜 복합 (대시보드 / 필터)
      `ALTER TABLE calendar_events ADD INDEX idx_assignee_start (assigned_to, start_datetime)`,
      // 캘린더: 고객사별 조회 (인텔리전스)
      `ALTER TABLE calendar_events ADD INDEX idx_customer (customer_name)`,
      // 회의록: 목록 정렬 (created_at DESC)
      `ALTER TABLE meeting_minutes ADD INDEX idx_created_at (created_at)`,
      // 리드: 단계 필터 + 최신순 (자주 사용)
      `ALTER TABLE leads ADD INDEX idx_stage_updated (stage, updated_at)`,
      // 리드: 담당자별 단계 (팀 성과 쿼리)
      `ALTER TABLE leads ADD INDEX idx_assigned_stage (assigned_to, stage)`,
      // 활동: lead 별 시간순 (히스토리)
      `ALTER TABLE activities ADD INDEX idx_lead_performed (lead_id, performed_at)`,
      // 활동: 전체 최신순 (대시보드 최근 활동)
      `ALTER TABLE activities ADD INDEX idx_performed_at (performed_at)`
    ];
    for (const sql of idx) {
      try { await pool.query(sql); } catch (e) {
        // Duplicate key name 만 정상 — 그 외는 로그
        if (!String(e.message).includes('Duplicate')) {
          console.warn('⚠ 인덱스 추가 경고:', e.message);
        }
      }
    }

    console.log('✅ DB 확장 테이블 + 인덱스 초기화 완료');
  } catch (err) {
    console.error('❌ DB 초기화 오류:', err.message);
  }
}
initTables();

// =============================================================
// 서버 시작 — `node server.js` 로 직접 실행 시에만 listen.
// 테스트(supertest)에서는 app/pool 을 import 하여 사용합니다.
// =============================================================
if (require.main === module) {
  server.listen(PORT, () => {
    console.log('═════════════════════════════════════════════');
    console.log('  🔴 OCI CRM 서버 시작');
    console.log('  📍 http://localhost:' + PORT);
    console.log('  🔌 WebSocket 활성화');
    console.log('═════════════════════════════════════════════');
  });
}

module.exports = { app, server, pool };
