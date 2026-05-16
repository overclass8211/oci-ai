'use strict';
// =============================================================
// /api/admin/labels  —  워드 사전(Word Repository) 관리
//
// 권한: level 4 (admin) 이상
// 엔드포인트:
//   GET    /                — 전체 라벨 (기본값 + 현재값) + 도메인 목록
//   GET    /scope/:scope    — 특정 도메인 라벨만
//   PUT    /                — 일괄 저장 [{scope,key,label}]
//   PUT    /:scope/:key     — 단건 저장
//   POST   /reset           — 초기화 (scope 지정 시 도메인별, 미지정 시 전체)
//   GET    /audit           — 변경 이력 (최근 200건)
//
// 별도 퍼블릭: GET /api/labels  (모든 인증 사용자 — 프론트 dictionary 조회)
//   → 본 라우터에서 함께 export 하여 server.js에서 등록
// =============================================================
const router = require('express').Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { LABEL_DEFAULTS } = require('../data/labelDefaults');

// ── 테이블 자가 생성 (idempotent) ─────────────────────────────
pool
  .query(
    `CREATE TABLE IF NOT EXISTS admin_labels (
       scope       VARCHAR(50) NOT NULL,
       key_name    VARCHAR(80) NOT NULL,
       locale      VARCHAR(10) NOT NULL DEFAULT 'ko',
       label       VARCHAR(200) NOT NULL,
       updated_by  INT NULL,
       updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       PRIMARY KEY (scope, key_name, locale)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  )
  .catch(() => {});

pool
  .query(
    `CREATE TABLE IF NOT EXISTS admin_label_audit (
       id          BIGINT AUTO_INCREMENT PRIMARY KEY,
       scope       VARCHAR(50) NOT NULL,
       key_name    VARCHAR(80) NOT NULL,
       locale      VARCHAR(10) NOT NULL DEFAULT 'ko',
       old_label   VARCHAR(200),
       new_label   VARCHAR(200),
       changed_by  INT NULL,
       changed_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       INDEX idx_scope_key (scope, key_name),
       INDEX idx_changed_at (changed_at)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  )
  .catch(() => {});

// ── 헬퍼: 기본값 + 현재값 병합 ───────────────────────────────
async function buildMergedLabels(scope) {
  const scopes = scope ? [scope] : Object.keys(LABEL_DEFAULTS);
  const conditions = scope ? 'WHERE scope = ?' : '';
  const params = scope ? [scope] : [];
  const [overrides] = await pool.query(
    `SELECT scope, key_name, label, updated_by, updated_at
       FROM admin_labels ${conditions}`,
    params
  );
  const overrideMap = {};
  overrides.forEach(o => {
    overrideMap[`${o.scope}.${o.key_name}`] = o;
  });

  const out = {};
  scopes.forEach(s => {
    const entries = LABEL_DEFAULTS[s] || {};
    out[s] = {};
    Object.entries(entries).forEach(([k, def]) => {
      const ov = overrideMap[`${s}.${k}`];
      out[s][k] = {
        default: def.label,
        desc: def.desc || '',
        current: ov ? ov.label : def.label,
        overridden: !!ov,
        updated_at: ov ? ov.updated_at : null,
      };
    });
  });
  return out;
}

// ── GET / — 전체 라벨 ────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const merged = await buildMergedLabels(null);
    res.json({
      success: true,
      data: {
        scopes: Object.keys(LABEL_DEFAULTS),
        labels: merged,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET /scope/:scope ────────────────────────────────────────
router.get('/scope/:scope', async (req, res) => {
  try {
    const { scope } = req.params;
    if (!LABEL_DEFAULTS[scope]) {
      return res.status(404).json({ success: false, error: `알 수 없는 도메인: ${scope}` });
    }
    const merged = await buildMergedLabels(scope);
    res.json({ success: true, data: merged[scope] });
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET /audit — 변경 이력 ───────────────────────────────────
router.get('/audit', async (req, res) => {
  try {
    const limit = Math.min(500, parseInt(req.query.limit) || 200);
    const [rows] = await pool.query(
      `SELECT a.id, a.scope, a.key_name, a.locale,
              a.old_label, a.new_label, a.changed_at,
              tm.name AS changed_by_name, tm.id AS changed_by_id
         FROM admin_label_audit a
         LEFT JOIN team_members tm ON a.changed_by = tm.id
         ORDER BY a.changed_at DESC
         LIMIT ?`,
      [limit]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 단건 upsert (헬퍼) ───────────────────────────────────────
async function upsertLabel(conn, { scope, key_name, label, userId }) {
  if (!LABEL_DEFAULTS[scope] || !LABEL_DEFAULTS[scope][key_name]) {
    throw Object.assign(new Error(`알 수 없는 라벨: ${scope}.${key_name}`), { status: 400 });
  }
  const cleaned = String(label || '')
    .trim()
    .slice(0, 200);
  if (!cleaned) {
    throw Object.assign(new Error('라벨은 비워둘 수 없습니다.'), { status: 400 });
  }
  // 현재값 조회 (audit 용)
  const [[curr]] = await conn.query(
    'SELECT label FROM admin_labels WHERE scope=? AND key_name=? AND locale=?',
    [scope, key_name, 'ko']
  );
  const oldLabel = curr ? curr.label : LABEL_DEFAULTS[scope][key_name].label;
  if (oldLabel === cleaned) return { changed: false };

  await conn.query(
    `INSERT INTO admin_labels (scope, key_name, locale, label, updated_by)
       VALUES (?, ?, 'ko', ?, ?)
       ON DUPLICATE KEY UPDATE label = VALUES(label), updated_by = VALUES(updated_by)`,
    [scope, key_name, cleaned, userId || null]
  );
  await conn.query(
    `INSERT INTO admin_label_audit (scope, key_name, locale, old_label, new_label, changed_by)
       VALUES (?, ?, 'ko', ?, ?, ?)`,
    [scope, key_name, oldLabel, cleaned, userId || null]
  );
  return { changed: true };
}

// ── PUT / — 일괄 저장 ────────────────────────────────────────
router.put('/', async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) {
    return res.status(400).json({ success: false, error: 'items 배열이 필요합니다.' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let changedCount = 0;
    for (const it of items) {
      const r = await upsertLabel(conn, {
        scope: it.scope,
        key_name: it.key,
        label: it.label,
        userId: req.user?.id,
      });
      if (r.changed) changedCount++;
    }
    await conn.commit();
    res.json({ success: true, changed: changedCount, total: items.length });
  } catch (err) {
    await conn.rollback();
    if (err.status) return res.status(err.status).json({ success: false, error: err.message });
    handleError(res, err);
  } finally {
    conn.release();
  }
});

// ── PUT /:scope/:key — 단건 저장 ─────────────────────────────
router.put('/:scope/:key', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const r = await upsertLabel(conn, {
      scope: req.params.scope,
      key_name: req.params.key,
      label: req.body?.label,
      userId: req.user?.id,
    });
    await conn.commit();
    res.json({ success: true, changed: r.changed });
  } catch (err) {
    await conn.rollback();
    if (err.status) return res.status(err.status).json({ success: false, error: err.message });
    handleError(res, err);
  } finally {
    conn.release();
  }
});

// ── POST /reset — 초기화 ─────────────────────────────────────
// body: { scope?: 'leads' }   미지정 시 전체 초기화
router.post('/reset', async (req, res) => {
  try {
    const scope = req.body?.scope;
    if (scope && !LABEL_DEFAULTS[scope]) {
      return res.status(400).json({ success: false, error: `알 수 없는 도메인: ${scope}` });
    }
    // 현재 오버라이드 audit 기록 후 삭제
    const where = scope ? 'WHERE scope = ?' : '';
    const params = scope ? [scope] : [];

    const [curr] = await pool.query(
      `SELECT scope, key_name, locale, label FROM admin_labels ${where}`,
      params
    );
    for (const row of curr) {
      const def = LABEL_DEFAULTS[row.scope]?.[row.key_name];
      if (!def) continue;
      await pool.query(
        `INSERT INTO admin_label_audit (scope, key_name, locale, old_label, new_label, changed_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
        [row.scope, row.key_name, row.locale, row.label, def.label, req.user?.id || null]
      );
    }
    await pool.query(`DELETE FROM admin_labels ${where}`, params);
    res.json({ success: true, reset: curr.length, scope: scope || 'ALL' });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 퍼블릭 라우터 (별도 등록) ────────────────────────────────
// GET /api/labels — 인증된 모든 사용자가 dictionary 조회
const publicRouter = require('express').Router();
publicRouter.get('/', async (_req, res) => {
  try {
    const merged = await buildMergedLabels(null);
    // 프론트 캐시 friendly — { scope: { key: 'current label' } } 평탄화
    const flat = {};
    Object.entries(merged).forEach(([scope, entries]) => {
      flat[scope] = {};
      Object.entries(entries).forEach(([k, v]) => {
        flat[scope][k] = v.current;
      });
    });
    res.json({ success: true, data: flat, ts: Date.now() });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
module.exports.publicRouter = publicRouter;
