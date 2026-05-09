const router = require('express').Router();
const pool   = require('../db');
const { handleError } = require('../middleware/errorHandler');

router.get('/stats', async (req, res) => {
  try {
    const [[totalLeads]] = await pool.query(
      `SELECT COUNT(*) AS count FROM leads WHERE stage NOT IN ('won','lost','dropped')`);
    const [[monthlyNew]] = await pool.query(
      `SELECT COUNT(*) AS count FROM leads
       WHERE MONTH(created_at) = MONTH(CURRENT_DATE()) AND YEAR(created_at) = YEAR(CURRENT_DATE())`);
    const [[wonAmount]] = await pool.query(
      `SELECT COALESCE(SUM(expected_amount),0) AS amount FROM leads
       WHERE stage = 'won' AND YEAR(updated_at) = YEAR(CURRENT_DATE())`);
    const [[bidding]]  = await pool.query(`SELECT COUNT(*) AS count FROM leads WHERE stage = 'bidding'`);
    const [[domestic]] = await pool.query(
      `SELECT COUNT(*) AS count FROM leads WHERE region='국내' AND stage NOT IN ('won','lost','dropped')`);
    const [[overseas]] = await pool.query(
      `SELECT COUNT(*) AS count FROM leads WHERE region='해외' AND stage NOT IN ('won','lost','dropped')`);
    const [[wonCount]] = await pool.query(
      `SELECT COUNT(*) AS count FROM leads WHERE stage='won' AND YEAR(updated_at)=YEAR(CURRENT_DATE())`);
    const [[allCount]] = await pool.query(`SELECT COUNT(*) AS count FROM leads`);

    res.json({
      success: true,
      data: {
        totalLeads: totalLeads.count,
        monthlyNew: monthlyNew.count,
        wonAmount:  parseFloat(wonAmount.amount),
        bidding:    bidding.count,
        domestic:   domestic.count,
        overseas:   overseas.count,
        winRate:    allCount.count > 0
          ? ((wonCount.count / allCount.count) * 100).toFixed(1) : 0
      }
    });
  } catch (err) { handleError(res, err); }
});

router.get('/funnel', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT stage, COUNT(*) AS count, COALESCE(SUM(expected_amount),0) AS amount
       FROM leads GROUP BY stage`);
    res.json({ success: true, data: rows });
  } catch (err) { handleError(res, err); }
});

router.get('/monthly', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, business_type, COUNT(*) AS count
       FROM leads
       WHERE created_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH)
       GROUP BY month, business_type ORDER BY month`);
    res.json({ success: true, data: rows });
  } catch (err) { handleError(res, err); }
});

router.get('/activities', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.*, t.name AS performer_name, l.customer_name, l.project_name
       FROM activities a
       LEFT JOIN team_members t ON a.performed_by = t.id
       LEFT JOIN leads l ON a.lead_id = l.id
       ORDER BY a.performed_at DESC LIMIT 10`);
    res.json({ success: true, data: rows });
  } catch (err) { handleError(res, err); }
});

module.exports = router;
