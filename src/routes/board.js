const router = require('express').Router();
const pool   = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { wsBroadcast }  = require('../ws');

router.get('/announcements', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT a.*, t.name AS created_by_name,
        (SELECT COUNT(*) FROM comments c WHERE c.ref_type='announcement' AND c.ref_id=a.id) AS comment_count
      FROM announcements a LEFT JOIN team_members t ON a.created_by = t.id
      ORDER BY a.is_pinned DESC, a.created_at DESC`);
    res.json({ success: true, data: rows });
  } catch (err) { handleError(res, err); }
});

router.post('/announcements', async (req, res) => {
  try {
    const { title, content, is_pinned, created_by } = req.body;
    const [result] = await pool.query(
      'INSERT INTO announcements (title, content, is_pinned, created_by) VALUES (?,?,?,?)',
      [title, content, is_pinned ? 1 : 0, created_by || null]);
    wsBroadcast({ type: 'announcement', title });
    res.json({ success: true, id: result.insertId });
  } catch (err) { handleError(res, err); }
});

router.put('/announcements/:id', async (req, res) => {
  try {
    const { title, content, is_pinned } = req.body;
    await pool.query('UPDATE announcements SET title=?, content=?, is_pinned=? WHERE id=?',
      [title, content, is_pinned ? 1 : 0, req.params.id]);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

router.delete('/announcements/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM announcements WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

router.get('/comments', async (req, res) => {
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

router.post('/comments', async (req, res) => {
  try {
    const { ref_type, ref_id, content, author_name } = req.body;
    const [result] = await pool.query(
      'INSERT INTO comments (ref_type, ref_id, content, author_name) VALUES (?,?,?,?)',
      [ref_type, ref_id, content, author_name || '익명']);
    wsBroadcast({ type: 'notification', text: `💬 새 댓글: ${content.substring(0, 40)}` });
    res.json({ success: true, id: result.insertId });
  } catch (err) { handleError(res, err); }
});

router.delete('/comments/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM comments WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

router.get('/faq', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM faq ORDER BY category, created_at DESC');
    res.json({ success: true, data: rows });
  } catch (err) { handleError(res, err); }
});

router.post('/faq', async (req, res) => {
  try {
    const { question, answer, category } = req.body;
    const [result] = await pool.query(
      'INSERT INTO faq (question, answer, category) VALUES (?,?,?)',
      [question, answer, category || '기타']);
    res.json({ success: true, id: result.insertId });
  } catch (err) { handleError(res, err); }
});

router.delete('/faq/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM faq WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

module.exports = router;
