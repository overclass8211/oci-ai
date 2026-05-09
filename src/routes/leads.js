const router = require('express').Router();
const pool   = require('../db');
const { handleError } = require('../middleware/errorHandler');

router.get('/', async (req, res) => {
  try {
    const { stage, region, assigned_to, business_type, search } = req.query;
    let sql = `SELECT l.*, t.name AS assigned_name, t.role AS assigned_role
               FROM leads l LEFT JOIN team_members t ON l.assigned_to = t.id WHERE 1=1`;
    const params = [];
    if (stage)         { sql += ' AND l.stage = ?';          params.push(stage); }
    if (region)        { sql += ' AND l.region = ?';         params.push(region); }
    if (assigned_to)   { sql += ' AND l.assigned_to = ?';    params.push(assigned_to); }
    if (business_type) { sql += ' AND l.business_type = ?';  params.push(business_type); }
    if (search) {
      sql += ' AND (l.customer_name LIKE ? OR l.project_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    sql += ' ORDER BY l.updated_at DESC';
    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) { handleError(res, err); }
});

router.get('/:id', async (req, res) => {
  try {
    const [[lead]] = await pool.query(
      `SELECT l.*, t.name AS assigned_name FROM leads l
       LEFT JOIN team_members t ON l.assigned_to = t.id WHERE l.id = ?`, [req.params.id]);
    if (!lead) return res.status(404).json({ success: false, error: 'Not found' });
    const [activities] = await pool.query(
      `SELECT a.*, t.name AS performer_name FROM activities a
       LEFT JOIN team_members t ON a.performed_by = t.id
       WHERE a.lead_id = ? ORDER BY a.performed_at DESC`, [req.params.id]);
    res.json({ success: true, data: { ...lead, activities } });
  } catch (err) { handleError(res, err); }
});

router.post('/', async (req, res) => {
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

router.put('/:id', async (req, res) => {
  try {
    const fields = ['customer_name','project_name','business_type','region',
      'capacity_mw','expected_amount','currency','stage',
      'assigned_to','expected_close_date','bidding_deadline','notes'];
    const updates = []; const values = [];
    fields.forEach(f => {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); }
    });
    if (!updates.length) return res.json({ success: true, message: 'No changes' });
    values.push(req.params.id);
    await pool.query(`UPDATE leads SET ${updates.join(',')} WHERE id = ?`, values);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

router.patch('/:id/stage', async (req, res) => {
  try {
    const { stage } = req.body;
    await pool.query('UPDATE leads SET stage = ? WHERE id = ?', [stage, req.params.id]);
    const stageNameMap = {
      lead:'리드발굴', review:'검토', proposal:'제안', bidding:'입찰',
      negotiation:'협상', won:'수주', lost:'실주', dropped:'드롭'
    };
    await pool.query(
      `INSERT INTO activities (lead_id, activity_type, title, content, performed_by) VALUES (?,?,?,?,?)`,
      [req.params.id,
       stage === 'won' ? '수주' : stage === 'dropped' ? '드롭' : '기타',
       `단계 변경: ${stageNameMap[stage]}`,
       `리드 단계가 ${stageNameMap[stage]}(으)로 변경되었습니다.`,
       1]
    );
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM leads WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

module.exports = router;
