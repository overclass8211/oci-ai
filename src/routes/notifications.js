const router = require('express').Router();
const pool   = require('../db');
const { handleError } = require('../middleware/errorHandler');

router.get('/', async (req, res) => {
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
      ORDER BY due_date ASC LIMIT 20`);
    res.json({ success: true, data: urgent });
  } catch (err) { handleError(res, err); }
});

module.exports = router;
