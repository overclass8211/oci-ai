const router = require('express').Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { getUserId } = require('../middleware/auth');
const { parsePage, pageResult } = require('../utils/routeHelper');
const upload = require('../middleware/upload');
const { fromExcelBuffer } = require('../utils/excelHelper');
const { sendExport, normalizeFormat } = require('../utils/exportHelper');
const readReceipts = require('../services/readReceipts');

const PROJ_COLS = [
  { key: 'name', label: '프로젝트명' },
  { key: 'customer_name', label: '고객사' },
  { key: 'project_type', label: '유형' },
  { key: 'contract_amount', label: '계약금액(억)' },
  { key: 'estimated_cost', label: '산정원가(억)' },
  { key: 'margin_pct', label: '마진율(%)' },
  { key: 'status', label: '상태' },
  { key: 'due_date', label: '납기일' },
  { key: 'assigned_name', label: '담당자' },
  { key: 'notes', label: '메모' },
];

router.get('/', async (req, res) => {
  try {
    const { status, search } = req.query;
    const { page, limit, offset } = parsePage(req.query);

    let where = 'WHERE 1=1';
    const params = [];
    if (status) {
      where += ' AND p.status = ?';
      params.push(status);
    }
    if (search) {
      where += ' AND (p.name LIKE ? OR p.customer_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    const [[countRows], [rows]] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM projects p ${where}`, params),
      pool.query(
        `SELECT p.*, t.name AS assigned_name FROM projects p
         LEFT JOIN team_members t ON p.assigned_to = t.id
         ${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ),
    ]);
    const total = Number(countRows[0]?.total ?? 0);
    // v6.0.0: 읽음 상태 enrich
    await readReceipts.enrichListWithReadStatus(getUserId(req), 'project', rows);
    res.json(pageResult(rows, total, page, limit));
  } catch (err) {
    handleError(res, err);
  }
});

// ── 일괄 등록 (Copy & Paste import) ──────────────────────────
router.post('/bulk', async (req, res) => {
  const { projects } = req.body;
  if (!Array.isArray(projects) || !projects.length)
    return res.status(400).json({ success: false, message: '등록할 데이터가 없습니다.' });

  const inserted = [];
  const errors = [];
  for (const row of projects) {
    if (!row.name) {
      errors.push({ row, reason: '프로젝트명 누락' });
      continue;
    }
    try {
      const margin =
        row.contract_amount && row.estimated_cost
          ? (((row.contract_amount - row.estimated_cost) / row.contract_amount) * 100).toFixed(2)
          : null;
      const [r] = await pool.query(
        `INSERT INTO projects
         (name, customer_name, project_type, contract_amount, estimated_cost,
          margin_pct, status, due_date, assigned_to, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          row.name,
          row.customer_name || null,
          row.project_type || '태양광',
          row.contract_amount || null,
          row.estimated_cost || null,
          margin,
          row.status || '진행중',
          row.due_date || null,
          row.assigned_to || null,
          row.notes || null,
        ]
      );
      inserted.push(r.insertId);
    } catch (e) {
      errors.push({ row, reason: e.message });
    }
  }
  res.json({ success: true, inserted: inserted.length, errors });
});

router.post('/', async (req, res) => {
  try {
    const {
      name,
      customer_name,
      project_type,
      contract_amount,
      estimated_cost,
      status,
      due_date,
      assigned_to,
      notes,
    } = req.body;
    const margin =
      contract_amount && estimated_cost
        ? (((contract_amount - estimated_cost) / contract_amount) * 100).toFixed(2)
        : null;
    const [result] = await pool.query(
      `INSERT INTO projects
       (name, customer_name, project_type, contract_amount, estimated_cost, margin_pct, status, due_date, assigned_to, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        name,
        customer_name,
        project_type,
        contract_amount,
        estimated_cost,
        margin,
        status || '진행중',
        due_date || null,
        assigned_to || null,
        notes || null,
      ]
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/:id', async (req, res) => {
  try {
    const fields = [
      'name',
      'customer_name',
      'project_type',
      'contract_amount',
      'estimated_cost',
      'status',
      'due_date',
      'assigned_to',
      'notes',
    ];
    const updates = [];
    const values = [];
    fields.forEach(f => {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = ?`);
        values.push(req.body[f]);
      }
    });
    if (req.body.contract_amount && req.body.estimated_cost) {
      const m = (
        ((req.body.contract_amount - req.body.estimated_cost) / req.body.contract_amount) *
        100
      ).toFixed(2);
      updates.push('margin_pct = ?');
      values.push(m);
    }
    if (!updates.length) return res.json({ success: true });

    // 이전 status 조회 — 완료 전환 감지용
    let prevStatus = null;
    if (req.body.status !== undefined) {
      const [[curr]] = await pool.query('SELECT status FROM projects WHERE id = ?', [
        req.params.id,
      ]);
      prevStatus = curr?.status;
    }

    values.push(req.params.id);
    await pool.query(`UPDATE projects SET ${updates.join(',')} WHERE id = ?`, values);

    // Webhook — 완료 전환 시
    if (req.body.status === '완료' && prevStatus !== '완료') {
      try {
        const wh = require('../services/webhookDispatcher');
        const [[p]] = await pool.query(
          `SELECT id, name, customer_name, project_type, contract_amount, margin_pct
             FROM projects WHERE id = ?`,
          [req.params.id]
        );
        if (p) wh.emit('project.completed', p);
      } catch (_) {
        /* 무시 */
      }
    }

    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM projects WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// v6.0.0: GET /:id — 단건 조회 + 모달 오픈 시 읽음 처리
// ⚠️ /export 보다 *뒤*에 등록 (id="export" 가 잡히는 충돌 방지)
router.get('/:id(\\d+)', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    const [[row]] = await pool.query(
      `SELECT p.*, t.name AS assigned_name FROM projects p
       LEFT JOIN team_members t ON p.assigned_to = t.id WHERE p.id = ?`,
      [id]
    );
    if (!row) return res.status(404).json({ success: false, error: '프로젝트를 찾을 수 없음' });
    readReceipts.markRead(getUserId(req), 'project', id).catch(() => {});
    res.json({ success: true, data: row });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 엑셀 내보내기 ────────────────────────────────────────────
router.get('/export', async (req, res) => {
  try {
    const { status, search } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    if (status) {
      where += ' AND p.status = ?';
      params.push(status);
    }
    if (search) {
      where += ' AND (p.name LIKE ? OR p.customer_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    const [rows] = await pool.query(
      `SELECT p.*, t.name AS assigned_name FROM projects p
       LEFT JOIN team_members t ON p.assigned_to = t.id
       ${where} ORDER BY p.created_at DESC`,
      params
    );
    await sendExport(res, {
      columns: PROJ_COLS,
      rows,
      sheetName: '프로젝트',
      filename: '프로젝트_' + new Date().toISOString().slice(0, 10),
      format: normalizeFormat(req.query.format),
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 엑셀 가져오기 ────────────────────────────────────────────
router.post('/import', upload.memory.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: '파일이 없습니다.' });
    const rows = await fromExcelBuffer(req.file.buffer);
    if (!rows.length)
      return res.status(400).json({ success: false, message: '데이터가 없습니다.' });

    // 팀원 이름 → ID 맵
    const [team] = await pool.query('SELECT id, name FROM team_members');
    const teamMap = Object.fromEntries(team.map(t => [t.name.trim(), t.id]));

    const inserted = [];
    const errors = [];
    for (const row of rows) {
      const name = String(row['프로젝트명'] || row['name'] || '').trim();
      if (!name) {
        errors.push({ row, reason: '프로젝트명 누락' });
        continue;
      }
      try {
        const contractAmt = parseFloat(row['계약금액(억)'] || row['contract_amount']) || null;
        const estimatedCost = parseFloat(row['산정원가(억)'] || row['estimated_cost']) || null;
        const margin =
          contractAmt && estimatedCost
            ? (((contractAmt - estimatedCost) / contractAmt) * 100).toFixed(2)
            : null;
        const assignedName = String(row['담당자'] || row['assigned_name'] || '').trim();
        const assignedId = teamMap[assignedName] || null;
        const [r] = await pool.query(
          `INSERT INTO projects
           (name, customer_name, project_type, contract_amount, estimated_cost,
            margin_pct, status, due_date, assigned_to, notes)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [
            name,
            String(row['고객사'] || row['customer_name'] || '').trim() || null,
            String(row['유형'] || row['project_type'] || '태양광').trim(),
            contractAmt,
            estimatedCost,
            margin,
            String(row['상태'] || row['status'] || '진행중').trim(),
            row['납기일'] || row['due_date'] || null,
            assignedId,
            String(row['메모'] || row['notes'] || '').trim() || null,
          ]
        );
        inserted.push(r.insertId);
      } catch (e) {
        errors.push({ row, reason: e.message });
      }
    }
    res.json({ success: true, inserted: inserted.length, errors });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
