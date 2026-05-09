const router = require('express').Router();
const pool   = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { getClientCount } = require('../ws');

router.get('/stats', async (req, res) => {
  try {
    const [[teamRow]] = await pool.query('SELECT COUNT(*) AS cnt FROM team_members WHERE is_active=1');
    const [[logRow]]  = await pool.query(`SELECT COUNT(*) AS cnt FROM access_logs WHERE DATE(created_at)=CURRENT_DATE()`);
    const [[leadRow]] = await pool.query('SELECT COUNT(*) AS cnt FROM leads');
    const [[actRow]]  = await pool.query('SELECT COUNT(*) AS cnt FROM activities');
    const uptimeHours = Math.floor(process.uptime() / 3600);
    const uptimeMin   = Math.floor((process.uptime() % 3600) / 60);
    res.json({
      success: true,
      data: {
        total_team:       teamRow.cnt,
        api_calls_today:  logRow.cnt,
        total_leads:      leadRow.cnt,
        total_activities: actRow.cnt,
        uptime:           `${uptimeHours}시간 ${uptimeMin}분`,
        ws_connections:   getClientCount(),
        node_version:     process.version,
        memory_mb:        Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
      }
    });
  } catch (err) { handleError(res, err); }
});

router.get('/settings', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT setting_key, setting_value FROM system_settings');
    const data = {};
    rows.forEach(r => { data[r.setting_key] = r.setting_value; });
    res.json({ success: true, data });
  } catch (err) { handleError(res, err); }
});

router.put('/settings', async (req, res) => {
  try {
    const updates = req.body || {};
    for (const [key, value] of Object.entries(updates)) {
      await pool.query(
        `INSERT INTO system_settings (setting_key, setting_value) VALUES (?,?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [key, String(value)]);
    }
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

router.get('/token-usage-by-user', async (req, res) => {
  try {
    const [[def]] = await pool.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'default_monthly_token_limit'`);
    const defaultLimit = def ? parseInt(def.setting_value) : 0;
    const [rows] = await pool.query(`
      SELECT t.id, t.name, t.role, t.email, t.monthly_token_limit,
        COALESCE((SELECT SUM(total_tokens) FROM ai_usage WHERE user_id=t.id AND YEAR(created_at)=YEAR(CURRENT_DATE()) AND MONTH(created_at)=MONTH(CURRENT_DATE())), 0) AS used_this_month,
        COALESCE((SELECT COUNT(*) FROM ai_usage WHERE user_id=t.id AND YEAR(created_at)=YEAR(CURRENT_DATE()) AND MONTH(created_at)=MONTH(CURRENT_DATE())), 0) AS calls_this_month
      FROM team_members t WHERE t.is_active=1 ORDER BY used_this_month DESC, t.name`);
    res.json({ success: true, data: rows, defaultLimit });
  } catch (err) { handleError(res, err); }
});

router.patch('/team-members/:id/token-limit', async (req, res) => {
  try {
    const { monthly_token_limit } = req.body;
    const limit = monthly_token_limit === '' || monthly_token_limit == null
      ? null : parseInt(monthly_token_limit);
    await pool.query('UPDATE team_members SET monthly_token_limit=? WHERE id=?', [limit, req.params.id]);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

router.get('/access-logs', async (req, res) => {
  try {
    const limit  = parseInt(req.query.limit)  || 100;
    const offset = parseInt(req.query.offset) || 0;
    const [rows]   = await pool.query('SELECT * FROM access_logs ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset]);
    const [[total]] = await pool.query('SELECT COUNT(*) AS cnt FROM access_logs');
    res.json({ success: true, data: rows, total: total.cnt });
  } catch (err) { handleError(res, err); }
});

router.delete('/access-logs', async (req, res) => {
  try {
    await pool.query('DELETE FROM access_logs');
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

router.get('/team-stats', async (req, res) => {
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

router.get('/daily-logs', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT DATE(created_at) AS day, COUNT(*) AS cnt
      FROM access_logs WHERE created_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
      GROUP BY day ORDER BY day ASC`);
    res.json({ success: true, data: rows });
  } catch (err) { handleError(res, err); }
});

router.get('/top-paths', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT path, COUNT(*) AS cnt, ROUND(AVG(duration_ms)) AS avg_ms
      FROM access_logs GROUP BY path ORDER BY cnt DESC LIMIT 10`);
    res.json({ success: true, data: rows });
  } catch (err) { handleError(res, err); }
});

module.exports = router;
