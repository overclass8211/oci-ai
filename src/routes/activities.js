const router = require('express').Router();
const pool   = require('../db');
const { handleError } = require('../middleware/errorHandler');

router.post('/', async (req, res) => {
  try {
    const { lead_id, project_id, activity_type, title, content, performed_by } = req.body;
    const [result] = await pool.query(
      `INSERT INTO activities (lead_id, project_id, activity_type, title, content, performed_by)
       VALUES (?,?,?,?,?,?)`,
      [lead_id || null, project_id || null, activity_type || '기타',
       title, content || null, performed_by || null]);
    res.json({ success: true, id: result.insertId });
  } catch (err) { handleError(res, err); }
});

module.exports = router;
