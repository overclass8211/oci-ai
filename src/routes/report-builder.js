'use strict';
// =============================================================
// /api/report-builder — 사용자 정의 리포트 빌더 (Phase 1 MVP)
//
// 데이터 소스: leads (영업 리드) 단일
// 차원 8 / 지표 4 — whitelist 기반 (SQL injection 방어)
//
// 권한: team_lead(level 2) 이상만 — RBAC 미들웨어에서 처리
// 데이터 스코프: manager 는 본인 리드만, team_lead+ 는 전체
//
// 엔드포인트:
//   GET    /fields              — 사용 가능한 필드 카탈로그
//   POST   /query               — config_json 으로 쿼리 실행 + 차트 데이터 반환
//   GET    /saved               — 본인 저장 리포트 목록
//   GET    /saved/:id           — 단건 조회
//   POST   /saved                 — 저장
//   PUT    /saved/:id           — 수정
//   DELETE /saved/:id           — 삭제
//
// config_json 형식:
//   {
//     datasource: 'leads',
//     rows:    ['stage'],
//     columns: ['region'],            // 선택
//     filters: [{ field, op, value }],
//     measures: ['count' | 'sum_expected_amount' | ...]
//     chartType: 'auto' | 'bar' | 'pie' | 'line' | 'stacked-bar'
//   }
// =============================================================

const router = require('express').Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { getUserId } = require('../middleware/auth');
const { requireFeature } = require('../middleware/featureGuard');

// 라우트 전체에 feature flag 적용 — crm.report_builder OFF 시 모든 엔드포인트 차단
router.use(requireFeature('crm.report_builder'));

// ── 자가 마이그레이션 (idempotent) ────────────────────────────
async function ensureSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS report_definitions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        name VARCHAR(150) NOT NULL,
        description VARCHAR(500),
        config_json JSON NOT NULL,
        is_shared TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_report_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  } catch (_) {
    /* 이미 존재 — 무시 */
  }
}
const _migrationPromise = ensureSchema();

// ── 필드 카탈로그 (whitelist — SQL injection 방어) ───────────
// 키: 클라이언트가 보내는 식별자 / sql: 실제 컬럼식 / label: 한국어 라벨
// type: dimension | measure / dataType: text | number | date / chartHint: bar | line | pie
const FIELDS = {
  // ─── 차원 (Dimensions) ─────────────────────
  stage: {
    type: 'dimension',
    sql: 'leads.stage',
    label: '단계',
    dataType: 'text',
    chartHint: 'bar',
  },
  region: {
    type: 'dimension',
    sql: 'leads.region',
    label: '지역',
    dataType: 'text',
    chartHint: 'pie',
  },
  business_type: {
    type: 'dimension',
    sql: 'leads.business_type',
    label: '사업유형',
    dataType: 'text',
    chartHint: 'pie',
  },
  assigned_name: {
    type: 'dimension',
    sql: 'COALESCE(tm.name, "(미지정)")',
    label: '담당자',
    dataType: 'text',
    chartHint: 'bar',
    join: 'team',
  },
  currency: {
    type: 'dimension',
    sql: 'leads.currency',
    label: '통화',
    dataType: 'text',
    chartHint: 'pie',
  },
  source: {
    type: 'dimension',
    sql: 'COALESCE(leads.source, "(없음)")',
    label: '리드 소스',
    dataType: 'text',
    chartHint: 'pie',
  },
  year_created: {
    type: 'dimension',
    sql: 'YEAR(leads.created_at)',
    label: '등록 연도',
    dataType: 'date',
    chartHint: 'line',
  },
  month_created: {
    type: 'dimension',
    sql: 'DATE_FORMAT(leads.created_at, "%Y-%m")',
    label: '등록 월',
    dataType: 'date',
    chartHint: 'line',
  },

  // ─── 지표 (Measures) ───────────────────────
  count: { type: 'measure', sql: 'COUNT(*)', label: '건수', dataType: 'number' },
  sum_expected_amount: {
    type: 'measure',
    sql: 'COALESCE(SUM(leads.expected_amount), 0)',
    label: '예상금액 합계',
    dataType: 'number',
  },
  avg_expected_amount: {
    type: 'measure',
    sql: 'COALESCE(AVG(leads.expected_amount), 0)',
    label: '예상금액 평균',
    dataType: 'number',
  },
  sum_capacity_mw: {
    type: 'measure',
    sql: 'COALESCE(SUM(leads.capacity_mw), 0)',
    label: '용량 합계(MW)',
    dataType: 'number',
  },
};

// ── 필터 연산자 whitelist ───────────────────────────────────
const FILTER_OPS = {
  eq: '=',
  ne: '!=',
  gt: '>',
  lt: '<',
  gte: '>=',
  lte: '<=',
  like: 'LIKE',
  in: 'IN',
};

// ── 차원 필드만 (필터에 사용 가능) ──────────────────────────
function isDimension(key) {
  return FIELDS[key] && FIELDS[key].type === 'dimension';
}
function isMeasure(key) {
  return FIELDS[key] && FIELDS[key].type === 'measure';
}

// ── 자동 차트 타입 추천 ─────────────────────────────────────
function suggestChartType(rows, columns, measures) {
  const rowCount = rows.length;
  const colCount = columns.length;
  const measureCount = measures.length;

  if (measureCount === 0) return 'bar';

  // 행 1개 + 열 1개 → stacked-bar
  if (rowCount === 1 && colCount === 1) return 'stacked-bar';

  // 행 1개 + 열 0개
  if (rowCount === 1 && colCount === 0) {
    const rowField = FIELDS[rows[0]];
    if (rowField && rowField.dataType === 'date') return 'line';
    return rowField?.chartHint || 'bar';
  }

  return 'bar';
}

// ── 사용자 권한 → 데이터 스코프 결정 ───────────────────────
async function getUserScope(userId) {
  if (!userId) return { isManager: true };
  const [[u]] = await pool.query('SELECT role FROM users WHERE id = ? LIMIT 1', [userId]);
  if (!u) return { isManager: true };
  return { isManager: u.role === 'manager' };
}

// ── GET /fields — 필드 카탈로그 ─────────────────────────────
router.get('/fields', (req, res) => {
  try {
    const dimensions = [];
    const measures = [];
    for (const [key, def] of Object.entries(FIELDS)) {
      const item = { key, label: def.label, dataType: def.dataType };
      if (def.chartHint) item.chartHint = def.chartHint;
      if (def.type === 'dimension') dimensions.push(item);
      else measures.push(item);
    }
    res.json({
      success: true,
      data: {
        datasources: [{ key: 'leads', label: '영업 리드' }],
        dimensions,
        measures,
        filter_ops: Object.keys(FILTER_OPS),
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── POST /query — 리포트 실행 ────────────────────────────────
router.post('/query', async (req, res) => {
  try {
    const userId = getUserId(req);
    const config = req.body || {};
    const datasource = config.datasource || 'leads';
    if (datasource !== 'leads') {
      return res
        .status(400)
        .json({ success: false, error: 'Phase 1 은 leads 데이터 소스만 지원합니다' });
    }

    const rows = Array.isArray(config.rows) ? config.rows.filter(isDimension) : [];
    const columns = Array.isArray(config.columns) ? config.columns.filter(isDimension) : [];
    const filters = Array.isArray(config.filters) ? config.filters : [];
    const measures = Array.isArray(config.measures) ? config.measures.filter(isMeasure) : [];

    if (rows.length === 0 && measures.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: '최소 1개의 차원(행) 또는 지표가 필요합니다' });
    }
    if (rows.length > 1)
      return res
        .status(400)
        .json({ success: false, error: '행(Row)은 1개만 지원됩니다 (Phase 1)' });
    if (columns.length > 1)
      return res
        .status(400)
        .json({ success: false, error: '열(Column)은 1개만 지원됩니다 (Phase 1)' });
    if (measures.length > 3)
      return res.status(400).json({ success: false, error: '지표는 최대 3개까지 지원됩니다' });

    // ── SELECT 절 구성 ────────────────────────────────────
    const selectParts = [];
    const groupParts = [];

    if (rows[0]) {
      selectParts.push(`${FIELDS[rows[0]].sql} AS row_key`);
      groupParts.push(FIELDS[rows[0]].sql);
    }
    if (columns[0]) {
      selectParts.push(`${FIELDS[columns[0]].sql} AS col_key`);
      groupParts.push(FIELDS[columns[0]].sql);
    }
    for (const m of measures) {
      selectParts.push(`${FIELDS[m].sql} AS ${m}`);
    }

    // ── FROM + JOIN ───────────────────────────────────────
    const needsTeamJoin =
      [...rows, ...columns].some(k => FIELDS[k]?.join === 'team') ||
      filters.some(f => FIELDS[f?.field]?.join === 'team');

    let fromClause = 'FROM leads';
    if (needsTeamJoin) {
      fromClause += ' LEFT JOIN team_members tm ON tm.id = leads.assigned_to';
    }

    // ── WHERE 절 ──────────────────────────────────────────
    const whereParts = [];
    const params = [];

    // 권한 스코프 — manager 는 본인 리드만
    const scope = await getUserScope(userId);
    if (scope.isManager) {
      whereParts.push('leads.assigned_to = (SELECT id FROM team_members WHERE id = ? LIMIT 1)');
      params.push(userId);
    }

    // 사용자 정의 필터
    for (const f of filters) {
      if (!f || !isDimension(f.field) || !FILTER_OPS[f.op]) continue;
      const sql = FIELDS[f.field].sql;
      const op = FILTER_OPS[f.op];
      if (f.op === 'in' && Array.isArray(f.value)) {
        if (f.value.length === 0) continue;
        const placeholders = f.value.map(() => '?').join(',');
        whereParts.push(`${sql} IN (${placeholders})`);
        params.push(...f.value);
      } else if (f.op === 'like') {
        whereParts.push(`${sql} ${op} ?`);
        params.push(`%${f.value}%`);
      } else {
        whereParts.push(`${sql} ${op} ?`);
        params.push(f.value);
      }
    }
    const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
    const groupSql = groupParts.length ? `GROUP BY ${groupParts.join(', ')}` : '';
    const orderSql = groupParts.length ? `ORDER BY ${groupParts[0]}` : '';

    const sql = `
      SELECT ${selectParts.join(', ')}
      ${fromClause}
      ${whereSql}
      ${groupSql}
      ${orderSql}
      LIMIT 500
    `;

    const [data] = await pool.query(sql, params);

    // ── 차트 타입 결정 ────────────────────────────────────
    const chartType =
      config.chartType === 'auto' || !config.chartType
        ? suggestChartType(rows, columns, measures)
        : config.chartType;

    res.json({
      success: true,
      data: {
        rows: data,
        config: { datasource, rows, columns, filters, measures, chartType },
        meta: {
          rowCount: data.length,
          fields: [...rows, ...columns, ...measures].map(k => ({ key: k, label: FIELDS[k].label })),
        },
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET /saved — 본인 저장 리포트 목록 ───────────────────────
router.get('/saved', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: '인증 필요' });

    const [rows] = await pool.query(
      `SELECT id, name, description, config_json, is_shared, created_at, updated_at
         FROM report_definitions
        WHERE user_id = ?
        ORDER BY updated_at DESC`,
      [userId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET /saved/:id — 단건 조회 ───────────────────────────────
router.get('/saved/:id', async (req, res) => {
  try {
    const userId = getUserId(req);
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });

    const [[row]] = await pool.query(
      `SELECT id, name, description, config_json, is_shared, created_at, updated_at
         FROM report_definitions
        WHERE id = ? AND user_id = ?`,
      [id, userId]
    );
    if (!row) return res.status(404).json({ success: false, error: '리포트를 찾을 수 없음' });
    res.json({ success: true, data: row });
  } catch (err) {
    handleError(res, err);
  }
});

// ── POST /saved — 신규 저장 ──────────────────────────────────
router.post('/saved', async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: '인증 필요' });

    const { name, description, config_json } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, error: '리포트 이름이 필요합니다' });
    }
    if (!config_json || typeof config_json !== 'object') {
      return res
        .status(400)
        .json({ success: false, error: '리포트 설정(config_json)이 필요합니다' });
    }

    const [result] = await pool.query(
      `INSERT INTO report_definitions (user_id, name, description, config_json, is_shared)
       VALUES (?, ?, ?, ?, 0)`,
      [
        userId,
        String(name).slice(0, 150),
        description ? String(description).slice(0, 500) : null,
        JSON.stringify(config_json),
      ]
    );
    res.json({ success: true, data: { id: result.insertId } });
  } catch (err) {
    handleError(res, err);
  }
});

// ── PUT /saved/:id — 수정 ────────────────────────────────────
router.put('/saved/:id', async (req, res) => {
  try {
    const userId = getUserId(req);
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });

    const { name, description, config_json } = req.body || {};
    const updates = [];
    const params = [];
    if (name !== undefined) {
      updates.push('name = ?');
      params.push(String(name).slice(0, 150));
    }
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description ? String(description).slice(0, 500) : null);
    }
    if (config_json !== undefined) {
      updates.push('config_json = ?');
      params.push(JSON.stringify(config_json));
    }
    if (!updates.length) {
      return res.status(400).json({ success: false, error: '변경 사항이 없습니다' });
    }
    params.push(id, userId);

    const [result] = await pool.query(
      `UPDATE report_definitions SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
      params
    );
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, error: '리포트를 찾을 수 없거나 권한이 없습니다' });
    }
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── DELETE /saved/:id — 삭제 ─────────────────────────────────
router.delete('/saved/:id', async (req, res) => {
  try {
    const userId = getUserId(req);
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });

    const [result] = await pool.query(
      'DELETE FROM report_definitions WHERE id = ? AND user_id = ?',
      [id, userId]
    );
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, error: '리포트를 찾을 수 없거나 권한이 없습니다' });
    }
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
module.exports._migrationPromise = _migrationPromise;
