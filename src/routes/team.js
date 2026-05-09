const router = require('express').Router();
const pool   = require('../db');
const { handleError } = require('../middleware/errorHandler');

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT t.*,
        (SELECT COUNT(*) FROM leads WHERE assigned_to = t.id) AS total_leads,
        (SELECT COUNT(*) FROM leads WHERE assigned_to = t.id AND stage NOT IN ('won','lost','dropped')) AS active_leads,
        (SELECT COUNT(*) FROM leads WHERE assigned_to = t.id AND stage = 'won' AND YEAR(updated_at) = YEAR(CURRENT_DATE())) AS won_count,
        (SELECT COALESCE(SUM(expected_amount),0) FROM leads WHERE assigned_to = t.id AND stage = 'won' AND YEAR(updated_at) = YEAR(CURRENT_DATE())) AS won_amount,
        (SELECT COUNT(*) FROM leads WHERE assigned_to = t.id AND MONTH(created_at) = MONTH(CURRENT_DATE()) AND YEAR(created_at) = YEAR(CURRENT_DATE())) AS new_this_month
      FROM team_members t
      WHERE t.is_active = 1
      ORDER BY FIELD(t.role,'Sales','Field','CS'), t.name
    `);
    res.json({ success: true, data: rows });
  } catch (err) { handleError(res, err); }
});

router.post('/', async (req, res) => {
  try {
    const { name, role, team, email, phone } = req.body;
    const [result] = await pool.query(
      `INSERT INTO team_members (name, role, team, email, phone) VALUES (?,?,?,?,?)`,
      [name, role, team || null, email || null, phone || null]);
    res.json({ success: true, id: result.insertId });
  } catch (err) { handleError(res, err); }
});

router.put('/:id', async (req, res) => {
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

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('UPDATE team_members SET is_active = 0 WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

module.exports = router;
