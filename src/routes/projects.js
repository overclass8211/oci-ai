const router = require('express').Router();
const pool   = require('../db');
const { handleError } = require('../middleware/errorHandler');

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.*, t.name AS assigned_name FROM projects p
       LEFT JOIN team_members t ON p.assigned_to = t.id ORDER BY p.created_at DESC`);
    res.json({ success: true, data: rows });
  } catch (err) { handleError(res, err); }
});

router.post('/', async (req, res) => {
  try {
    const {
      name, customer_name, project_type, contract_amount,
      estimated_cost, status, due_date, assigned_to, notes
    } = req.body;
    const margin = (contract_amount && estimated_cost)
      ? (((contract_amount - estimated_cost) / contract_amount) * 100).toFixed(2) : null;
    const [result] = await pool.query(
      `INSERT INTO projects
       (name, customer_name, project_type, contract_amount, estimated_cost, margin_pct, status, due_date, assigned_to, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [name, customer_name, project_type, contract_amount,
       estimated_cost, margin, status || '진행중',
       due_date || null, assigned_to || null, notes || null]);
    res.json({ success: true, id: result.insertId });
  } catch (err) { handleError(res, err); }
});

router.put('/:id', async (req, res) => {
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

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM projects WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

module.exports = router;
