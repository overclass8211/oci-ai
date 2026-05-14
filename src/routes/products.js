const router = require('express').Router();
const pool   = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { parsePage, pageResult } = require('../utils/routeHelper');

router.get('/', async (req, res) => {
  try {
    const { category } = req.query;
    const { page, limit, offset } = parsePage(req.query);

    let where = '';
    const params = [];
    if (category) { where = 'WHERE category = ?'; params.push(category); }

    const [[countRows], [rows]] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM products ${where}`, params),
      pool.query(`SELECT * FROM products ${where} ORDER BY category, name LIMIT ? OFFSET ?`,
        [...params, limit, offset]),
    ]);
    const total = Number(countRows[0]?.total ?? 0);
    res.json(pageResult(rows, total, page, limit));
  } catch (err) { handleError(res, err); }
});

router.post('/', async (req, res) => {
  try {
    const { name, category, unit, current_price, currency, notes } = req.body;
    const [result] = await pool.query(
      `INSERT INTO products (name, category, unit, current_price, currency, last_updated, notes)
       VALUES (?,?,?,?,?,CURRENT_DATE(),?)`,
      [name, category, unit, current_price, currency || 'USD', notes || null]);
    await pool.query(
      `INSERT INTO cost_history (product_id, price, recorded_at) VALUES (?,?,CURRENT_DATE())`,
      [result.insertId, current_price]);
    res.json({ success: true, id: result.insertId });
  } catch (err) { handleError(res, err); }
});

router.put('/:id', async (req, res) => {
  try {
    const { current_price, notes } = req.body;
    const [[old]] = await pool.query('SELECT current_price FROM products WHERE id = ?', [req.params.id]);
    if (!old) return res.status(404).json({ success: false });
    const previous  = parseFloat(old.current_price);
    const newPrice  = parseFloat(current_price);
    const changePct = previous ? (((newPrice - previous) / previous) * 100).toFixed(2) : 0;
    await pool.query(
      `UPDATE products SET previous_price=?, current_price=?, change_pct=?, last_updated=CURRENT_DATE(), notes=? WHERE id=?`,
      [previous, newPrice, changePct, notes || null, req.params.id]);
    await pool.query(
      `INSERT INTO cost_history (product_id, price, recorded_at) VALUES (?,?,CURRENT_DATE())`,
      [req.params.id, newPrice]);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

router.get('/:id/history', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM cost_history WHERE product_id = ? ORDER BY recorded_at`, [req.params.id]);
    res.json({ success: true, data: rows });
  } catch (err) { handleError(res, err); }
});

module.exports = router;
