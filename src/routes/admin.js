const router = require('express').Router();
const pool = require('../db');
const { handleError, friendlyError } = require('../middleware/errorHandler');
const { getClientCount } = require('../ws');
const { genAI, MODEL_FAST, SAFETY_SETTINGS } = require('../services/gemini');

// ── DB 자동 마이그레이션 ───────────────────────────────────────
pool
  .query(
    `
  CREATE TABLE IF NOT EXISTS announcement_views (
    announcement_id INT NOT NULL,
    viewer_id       INT NOT NULL,
    viewed_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (announcement_id, viewer_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`
  )
  .catch(() => {});

// 토큰 자동충전 설정 컬럼
pool
  .query(
    `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS auto_recharge_enabled   TINYINT(1) DEFAULT 0`
  )
  .catch(() => {});
pool
  .query(
    `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS auto_recharge_threshold INT DEFAULT 80 COMMENT '% 사용시 충전 트리거'`
  )
  .catch(() => {});
pool
  .query(
    `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS auto_recharge_amount    INT DEFAULT 100000 COMMENT '1회 충전 토큰 수'`
  )
  .catch(() => {});

// 토큰 충전 로그
pool
  .query(
    `
  CREATE TABLE IF NOT EXISTS token_recharge_log (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    user_id         INT         NOT NULL,
    recharge_amount INT         NOT NULL,
    new_limit       INT         NOT NULL,
    reason          VARCHAR(100) DEFAULT '자동충전',
    triggered_by    VARCHAR(20)  DEFAULT 'auto',
    created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_date (user_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`
  )
  .catch(() => {});

// GET /api/admin/users — 사용자 목록 (404 패턴 해소)
router.get('/users', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, email, role, team, is_active, created_at
       FROM team_members
       ORDER BY is_active DESC, name ASC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/stats', async (req, res) => {
  try {
    const [[teamRow]] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM team_members WHERE is_active=1'
    );
    const [[logRow]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM access_logs WHERE DATE(created_at)=CURRENT_DATE()`
    );
    const [[leadRow]] = await pool.query('SELECT COUNT(*) AS cnt FROM leads');
    const [[actRow]] = await pool.query('SELECT COUNT(*) AS cnt FROM activities');

    // DB 크기 조회 (information_schema) — 헬스체크 + 통계 카드용
    let dbSizeMb = null;
    try {
      const [[sizeRow]] = await pool.query(`
        SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS size_mb
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
      `);
      dbSizeMb = sizeRow?.size_mb ?? null;
    } catch (_) {
      /* DB 권한 부족 등으로 실패 시 null — 헬스체크에서 '이상' 표시 */
    }

    const uptimeSec = process.uptime();
    const uptimeHours = Math.floor(uptimeSec / 3600);
    const uptimeMin = Math.floor((uptimeSec % 3600) / 60);

    res.json({
      success: true,
      data: {
        // 사용자 수 — UI 호환 위해 두 필드 모두 제공
        total_team: teamRow.cnt,
        total_users: teamRow.cnt,
        // API 호출
        api_calls_today: logRow.cnt,
        // 도메인 카운터
        total_leads: leadRow.cnt,
        total_activities: actRow.cnt,
        // DB 크기 (MB)
        db_size_mb: dbSizeMb,
        // 가동 시간 — 문자열 + 숫자 둘 다 제공
        uptime: `${uptimeHours}시간 ${uptimeMin}분`,
        uptime_hours: uptimeSec / 3600,
        // 런타임
        ws_connections: getClientCount(),
        node_version: process.version,
        memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/settings', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT setting_key, setting_value FROM system_settings');
    const data = {};
    rows.forEach(r => {
      data[r.setting_key] = r.setting_value;
    });
    res.json({ success: true, data });
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/settings', async (req, res) => {
  try {
    const updates = req.body || {};
    for (const [key, value] of Object.entries(updates)) {
      await pool.query(
        `INSERT INTO system_settings (setting_key, setting_value) VALUES (?,?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [key, String(value)]
      );
    }
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/token-usage-by-user', async (req, res) => {
  try {
    const [[def]] = await pool.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'default_monthly_token_limit'`
    );
    const defaultLimit = def ? parseInt(def.setting_value) : 0;
    const [rows] = await pool.query(`
      SELECT t.id, t.name, t.role, t.email, t.monthly_token_limit,
        COALESCE((SELECT SUM(total_tokens) FROM ai_usage WHERE user_id=t.id AND YEAR(created_at)=YEAR(CURRENT_DATE()) AND MONTH(created_at)=MONTH(CURRENT_DATE())), 0) AS used_this_month,
        COALESCE((SELECT COUNT(*) FROM ai_usage WHERE user_id=t.id AND YEAR(created_at)=YEAR(CURRENT_DATE()) AND MONTH(created_at)=MONTH(CURRENT_DATE())), 0) AS calls_this_month
      FROM team_members t WHERE t.is_active=1 ORDER BY used_this_month DESC, t.name`);
    res.json({ success: true, data: rows, defaultLimit });
  } catch (err) {
    handleError(res, err);
  }
});

router.patch('/team-members/:id/token-limit', async (req, res) => {
  try {
    const { monthly_token_limit } = req.body;
    const limit =
      monthly_token_limit === '' || monthly_token_limit == null
        ? null
        : parseInt(monthly_token_limit);
    await pool.query('UPDATE team_members SET monthly_token_limit=? WHERE id=?', [
      limit,
      req.params.id,
    ]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/access-logs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const [rows] = await pool.query(
      'SELECT * FROM access_logs ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [limit, offset]
    );
    const [[total]] = await pool.query('SELECT COUNT(*) AS cnt FROM access_logs');
    res.json({ success: true, data: rows, total: total.cnt });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/access-logs', async (req, res) => {
  try {
    await pool.query('DELETE FROM access_logs');
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/team-stats', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT t.id, t.name, t.role, t.email,
        (SELECT COUNT(*) FROM leads WHERE assigned_to=t.id) AS leads_count,
        (SELECT COUNT(*) FROM activities WHERE performed_by=t.id) AS activities_count,
        (SELECT MAX(performed_at) FROM activities WHERE performed_by=t.id) AS last_active
      FROM team_members t WHERE t.is_active=1 ORDER BY t.name`);
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/daily-logs', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT DATE(created_at) AS day, COUNT(*) AS cnt
      FROM access_logs WHERE created_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
      GROUP BY day ORDER BY day ASC`);
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/top-paths', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT path, COUNT(*) AS cnt, ROUND(AVG(duration_ms)) AS avg_ms
      FROM access_logs GROUP BY path ORDER BY cnt DESC LIMIT 10`);
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 게시판 통계 (월별/조직별) ──────────────────────────────────
router.get('/board-stats', async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;

    // ① 팀원 전체 목록 (role=본부 구분, team=팀 구분)
    const [members] = await pool.query(
      `SELECT id, name, role, team FROM team_members WHERE is_active=1 ORDER BY role, team, name`
    );

    // ② 해당 월 게시글 수 (created_by 기준)
    const [posts] = await pool.query(
      `SELECT created_by AS member_id, COUNT(*) AS cnt
       FROM announcements
       WHERE YEAR(created_at)=? AND MONTH(created_at)=? AND created_by IS NOT NULL
       GROUP BY created_by`,
      [year, month]
    );

    // ③ 해당 월 댓글 수 (author_name → team_members.name JOIN)
    const [comments] = await pool.query(
      `SELECT t.id AS member_id, COUNT(c.id) AS cnt
       FROM comments c
       JOIN team_members t ON t.name = c.author_name AND t.is_active = 1
       WHERE YEAR(c.created_at)=? AND MONTH(c.created_at)=?
       GROUP BY t.id`,
      [year, month]
    );

    // ④ 해당 월 열람 수 — 반복 누계 제외 (PK 중복 방지로 unique per 공지)
    //    같은 공지를 몇 번 읽어도 1회로 집계
    const [views] = await pool.query(
      `SELECT viewer_id AS member_id, COUNT(*) AS cnt
       FROM announcement_views
       WHERE YEAR(viewed_at)=? AND MONTH(viewed_at)=?
       GROUP BY viewer_id`,
      [year, month]
    );

    // 맵 변환
    const postMap = Object.fromEntries(posts.map(r => [r.member_id, Number(r.cnt)]));
    const commentMap = Object.fromEntries(comments.map(r => [r.member_id, Number(r.cnt)]));
    const viewMap = Object.fromEntries(views.map(r => [r.member_id, Number(r.cnt)]));

    // 팀원별 집계
    const memberStats = members.map(m => ({
      id: m.id,
      name: m.name,
      role: m.role || '미지정',
      team: m.team || '미지정',
      posts: postMap[m.id] || 0,
      comments: commentMap[m.id] || 0,
      views: viewMap[m.id] || 0,
    }));

    // 팀별 소계
    const teamMap2 = {};
    memberStats.forEach(m => {
      const key = `${m.role}||${m.team}`;
      if (!teamMap2[key])
        teamMap2[key] = { role: m.role, team: m.team, posts: 0, comments: 0, views: 0 };
      teamMap2[key].posts += m.posts;
      teamMap2[key].comments += m.comments;
      teamMap2[key].views += m.views;
    });

    // 본부별 소계
    const roleMap = {};
    memberStats.forEach(m => {
      if (!roleMap[m.role]) roleMap[m.role] = { role: m.role, posts: 0, comments: 0, views: 0 };
      roleMap[m.role].posts += m.posts;
      roleMap[m.role].comments += m.comments;
      roleMap[m.role].views += m.views;
    });

    // 전체 합계
    const total = memberStats.reduce(
      (a, m) => ({
        posts: a.posts + m.posts,
        comments: a.comments + m.comments,
        views: a.views + m.views,
      }),
      { posts: 0, comments: 0, views: 0 }
    );

    // 월별 트렌드 (12개월치, 연도 고정)
    const [monthly] = await pool.query(
      `
      SELECT
        m_val AS month,
        COALESCE(p.cnt, 0) AS posts,
        COALESCE(c.cnt, 0) AS comments,
        COALESCE(v.cnt, 0) AS views
      FROM (
        SELECT 1 m_val UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
        UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8
        UNION SELECT 9 UNION SELECT 10 UNION SELECT 11 UNION SELECT 12
      ) months
      LEFT JOIN (
        SELECT MONTH(created_at) AS m, COUNT(*) AS cnt
        FROM announcements WHERE YEAR(created_at)=? GROUP BY m
      ) p ON p.m = months.m_val
      LEFT JOIN (
        SELECT MONTH(created_at) AS m, COUNT(*) AS cnt
        FROM comments WHERE YEAR(created_at)=? GROUP BY m
      ) c ON c.m = months.m_val
      LEFT JOIN (
        SELECT MONTH(viewed_at) AS m, COUNT(*) AS cnt
        FROM announcement_views WHERE YEAR(viewed_at)=? GROUP BY m
      ) v ON v.m = months.m_val
      ORDER BY months.m_val`,
      [year, year, year]
    );

    res.json({
      success: true,
      data: {
        year,
        month,
        members: memberStats,
        teams: Object.values(teamMap2),
        roles: Object.values(roleMap),
        total,
        monthly,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ══════════════════════════════════════════════════════════════
// 토큰 모니터링 (superadmin 전용)
// ══════════════════════════════════════════════════════════════

// 모델별 단가 (USD / 1M tokens)
const MODEL_PRICE = {
  'gemini-2.5-flash': { input: 0.15, output: 0.6 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  'gemini-1.5-pro': { input: 1.25, output: 5.0 },
  default: { input: 0.15, output: 0.6 },
};
function calcCost(model, promptTok, completionTok) {
  const p = MODEL_PRICE[model] || MODEL_PRICE['default'];
  return (promptTok * p.input + completionTok * p.output) / 1_000_000;
}

// ── 종합 통계 ────────────────────────────────────────────────
router.get('/token-monitor', async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const [[def]] = await pool.query(
      `SELECT setting_value FROM system_settings WHERE setting_key='default_monthly_token_limit'`
    );
    const defaultLimit = def ? parseInt(def.setting_value) : 500000;

    // ① 이번 달 전체 요약
    const [[summary]] = await pool.query(
      `
      SELECT
        COALESCE(SUM(total_tokens),0)      AS month_tokens,
        COALESCE(SUM(prompt_tokens),0)     AS month_prompt,
        COALESCE(SUM(completion_tokens),0) AS month_completion,
        COALESCE(COUNT(*),0)               AS month_calls,
        COALESCE(COUNT(DISTINCT user_id),0) AS month_active_users
      FROM ai_usage WHERE YEAR(created_at)=? AND MONTH(created_at)=?`,
      [year, month]
    );

    // ② 오늘 요약
    const [[today]] = await pool.query(`
      SELECT COALESCE(SUM(total_tokens),0) AS today_tokens,
             COALESCE(COUNT(*),0) AS today_calls,
             COALESCE(COUNT(DISTINCT user_id),0) AS today_users
      FROM ai_usage WHERE DATE(created_at)=CURRENT_DATE()`);

    // ③ 일별 트렌드 (최근 30일)
    const [daily] = await pool.query(`
      SELECT DATE(created_at) AS day,
             SUM(prompt_tokens)     AS prompt,
             SUM(completion_tokens) AS completion,
             SUM(total_tokens)      AS total,
             COUNT(*)               AS calls,
             COUNT(DISTINCT user_id) AS users,
             model
      FROM ai_usage
      WHERE created_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 29 DAY)
      GROUP BY DATE(created_at), model
      ORDER BY day ASC`);

    // ④ 월별 트렌드 (12개월)
    const [monthly] = await pool.query(`
      SELECT YEAR(created_at) AS yr, MONTH(created_at) AS mo,
             SUM(prompt_tokens)     AS prompt,
             SUM(completion_tokens) AS completion,
             SUM(total_tokens)      AS total,
             COUNT(*)               AS calls,
             COUNT(DISTINCT user_id) AS users
      FROM ai_usage
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
      GROUP BY yr, mo ORDER BY yr, mo`);

    // ⑤ 기능별(endpoint) 사용량
    const [byEndpoint] = await pool.query(
      `
      SELECT endpoint,
             SUM(total_tokens) AS total, COUNT(*) AS calls,
             ROUND(AVG(total_tokens)) AS avg_per_call
      FROM ai_usage WHERE YEAR(created_at)=? AND MONTH(created_at)=?
      GROUP BY endpoint ORDER BY total DESC`,
      [year, month]
    );

    // ⑥ 모델별 사용량
    const [byModel] = await pool.query(
      `
      SELECT model,
             SUM(prompt_tokens)     AS prompt,
             SUM(completion_tokens) AS completion,
             SUM(total_tokens)      AS total,
             COUNT(*)               AS calls
      FROM ai_usage WHERE YEAR(created_at)=? AND MONTH(created_at)=?
      GROUP BY model ORDER BY total DESC`,
      [year, month]
    );

    // ⑦ 사용자별 이번 달 사용량 + 한도 + 자동충전 설정
    const [users] = await pool.query(
      `
      SELECT t.id, t.name, t.role, t.email,
             t.monthly_token_limit,
             t.auto_recharge_enabled,
             t.auto_recharge_threshold,
             t.auto_recharge_amount,
             COALESCE(u.total, 0)      AS used_tokens,
             COALESCE(u.prompt, 0)     AS used_prompt,
             COALESCE(u.completion, 0) AS used_completion,
             COALESCE(u.calls, 0)      AS calls,
             u.last_call
      FROM team_members t
      LEFT JOIN (
        SELECT user_id,
               SUM(total_tokens)      AS total,
               SUM(prompt_tokens)     AS prompt,
               SUM(completion_tokens) AS completion,
               COUNT(*)               AS calls,
               MAX(created_at)        AS last_call
        FROM ai_usage
        WHERE YEAR(created_at)=? AND MONTH(created_at)=?
        GROUP BY user_id
      ) u ON u.user_id = t.id
      WHERE t.is_active=1
      ORDER BY COALESCE(u.total,0) DESC`,
      [year, month]
    );

    // ⑧ 최근 충전 로그 20건
    const [rechargeLogs] = await pool
      .query(
        `
      SELECT r.*, t.name AS user_name
      FROM token_recharge_log r
      LEFT JOIN team_members t ON r.user_id = t.id
      ORDER BY r.created_at DESC LIMIT 20`
      )
      .catch(() => [[]]);

    // 비용 계산
    const modelCosts = byModel.map(m => ({
      ...m,
      cost_usd: calcCost(m.model, Number(m.prompt), Number(m.completion)),
    }));
    const totalCostUsd = modelCosts.reduce((s, m) => s + m.cost_usd, 0);

    // 일별 비용 (model 기준)
    const dailyCostMap = {};
    daily.forEach(r => {
      const day = String(r.day).slice(0, 10);
      if (!dailyCostMap[day])
        dailyCostMap[day] = { day, prompt: 0, completion: 0, total: 0, calls: 0, cost_usd: 0 };
      dailyCostMap[day].prompt += Number(r.prompt);
      dailyCostMap[day].completion += Number(r.completion);
      dailyCostMap[day].total += Number(r.total);
      dailyCostMap[day].calls += Number(r.calls);
      dailyCostMap[day].cost_usd += calcCost(
        r.model || 'default',
        Number(r.prompt),
        Number(r.completion)
      );
    });
    const dailyAgg = Object.values(dailyCostMap).sort((a, b) => a.day.localeCompare(b.day));

    // 이번 달 예상 비용 (월 진행률로 환산)
    const today2 = new Date();
    const daysInMonth = new Date(today2.getFullYear(), today2.getMonth() + 1, 0).getDate();
    const dayOfMonth = today2.getDate();
    const projectedCost =
      dayOfMonth < daysInMonth ? totalCostUsd * (daysInMonth / dayOfMonth) : totalCostUsd;

    res.json({
      success: true,
      data: {
        year,
        month,
        defaultLimit,
        summary: {
          ...summary,
          today_tokens: Number(today.today_tokens),
          today_calls: Number(today.today_calls),
          today_users: Number(today.today_users),
          cost_usd: totalCostUsd,
          projected_cost_usd: projectedCost,
        },
        daily: dailyAgg,
        monthly,
        byEndpoint,
        byModel: modelCosts,
        users: users.map(u => ({
          ...u,
          used_tokens: Number(u.used_tokens),
          used_prompt: Number(u.used_prompt),
          used_completion: Number(u.used_completion),
          calls: Number(u.calls),
          eff_limit: u.monthly_token_limit != null ? u.monthly_token_limit : defaultLimit,
          cost_usd: calcCost('default', Number(u.used_prompt), Number(u.used_completion)),
        })),
        rechargeLogs,
        totalCostUsd,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 자동충전 설정 저장 ────────────────────────────────────────
router.put('/token-recharge-settings/:id', async (req, res) => {
  try {
    const { auto_recharge_enabled, auto_recharge_threshold, auto_recharge_amount } = req.body;
    await pool.query(
      `UPDATE team_members SET
         auto_recharge_enabled   = ?,
         auto_recharge_threshold = ?,
         auto_recharge_amount    = ?
       WHERE id = ?`,
      [
        auto_recharge_enabled ? 1 : 0,
        parseInt(auto_recharge_threshold) || 80,
        parseInt(auto_recharge_amount) || 100000,
        req.params.id,
      ]
    );
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 수동 충전 (관리자가 직접 토큰 추가) ─────────────────────────
router.post('/token-recharge/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const amount = parseInt(req.body.amount) || 0;
    if (amount <= 0)
      return res.status(400).json({ success: false, message: '충전량을 입력하세요' });

    const [[member]] = await pool.query(`SELECT monthly_token_limit FROM team_members WHERE id=?`, [
      userId,
    ]);
    const [[def]] = await pool.query(
      `SELECT setting_value FROM system_settings WHERE setting_key='default_monthly_token_limit'`
    );
    const current = member?.monthly_token_limit ?? parseInt(def?.setting_value || 500000);
    const newLimit = current + amount;

    await pool.query(`UPDATE team_members SET monthly_token_limit=? WHERE id=?`, [
      newLimit,
      userId,
    ]);
    await pool.query(
      `INSERT INTO token_recharge_log (user_id, recharge_amount, new_limit, reason, triggered_by)
       VALUES (?,?,?,?,?)`,
      [userId, amount, newLimit, '수동충전', 'admin']
    );
    res.json({ success: true, new_limit: newLimit });
  } catch (err) {
    handleError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────
// 개발자 옵션 API  (superadmin 전용 미들웨어)
// ─────────────────────────────────────────────────────────────
function devOnly(req, res, next) {
  if (req.user?.role !== 'superadmin') {
    return res.status(403).json({ success: false, error: '개발자 옵션은 superadmin 전용입니다.' });
  }
  next();
}

// GET  /api/admin/dev/features
router.get('/dev/features', devOnly, async (req, res) => {
  try {
    const [features] = await pool.query(
      'SELECT * FROM dev_features ORDER BY category, feature_key'
    );
    res.json({ success: true, data: features });
  } catch (err) {
    handleError(res, err);
  }
});

// GET  /api/admin/dev/features/public  — 로그인 후 전체 유저가 읽는 플래그 (enabled 여부만)
router.get('/dev/features/public', async (req, res) => {
  try {
    const [features] = await pool.query('SELECT feature_key, is_enabled FROM dev_features');
    const flags = {};
    features.forEach(f => {
      flags[f.feature_key] = !!f.is_enabled;
    });
    res.json({ success: true, data: flags });
  } catch (err) {
    handleError(res, err);
  }
});

// PUT  /api/admin/dev/features/:key
router.put('/dev/features/:key', devOnly, async (req, res) => {
  try {
    const { is_enabled } = req.body;
    await pool.query('UPDATE dev_features SET is_enabled=? WHERE feature_key=?', [
      is_enabled ? 1 : 0,
      req.params.key,
    ]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ── 스키마 서버사이드 캐시 (30초 TTL) ──────────────────────────
const _schemaCache = { schema: null, relations: null, ts: 0, relTs: 0 };
const SCHEMA_TTL = 30_000; // 30s

// GET  /api/admin/dev/schema  — 실시간 DB 스키마 조회 (캐시 30s)
router.get('/dev/schema', devOnly, async (req, res) => {
  try {
    const force = req.query.refresh === '1';
    if (!force && _schemaCache.schema && Date.now() - _schemaCache.ts < SCHEMA_TTL) {
      return res.json({ success: true, data: _schemaCache.schema, cached: true });
    }
    const [[dbRow]] = await pool.query('SELECT DATABASE() AS db');
    const dbName = dbRow.db;
    // 두 쿼리 병렬 실행
    const [[tables], [columns]] = await Promise.all([
      pool.query(
        `SELECT TABLE_NAME, IFNULL(TABLE_ROWS,0) AS TABLE_ROWS,
                IFNULL(DATA_LENGTH,0) AS DATA_LENGTH, CREATE_TIME
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
        [dbName]
      ),
      pool.query(
        `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE,
                COLUMN_KEY, COLUMN_DEFAULT, EXTRA
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`,
        [dbName]
      ),
    ]);
    const schema = {};
    tables.forEach(t => {
      schema[t.TABLE_NAME] = { meta: t, columns: [] };
    });
    columns.forEach(c => {
      if (schema[c.TABLE_NAME]) schema[c.TABLE_NAME].columns.push(c);
    });
    _schemaCache.schema = schema;
    _schemaCache.ts = Date.now();
    res.json({ success: true, data: schema });
  } catch (err) {
    handleError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────
// DFD 동적 매핑 — 관리자가 미분류 테이블에 API 매핑 추가
//   GET    /dev/dfd-mappings              전체 매핑 목록
//   POST   /dev/dfd-mappings              upsert (단일 테이블)
//   DELETE /dev/dfd-mappings/:tableName   매핑 제거
// ─────────────────────────────────────────────────────────────
router.get('/dev/dfd-mappings', devOnly, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT table_name, api_keys, added_by, added_at, updated_at
       FROM dfd_mappings ORDER BY table_name`
    );
    // JSON 파싱 (안전)
    const data = rows.map(r => {
      let apis = [];
      try {
        apis = JSON.parse(r.api_keys || '[]');
      } catch (_) {
        apis = [];
      }
      return { ...r, api_keys: apis };
    });
    res.json({ success: true, data });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/dev/dfd-mappings', devOnly, async (req, res) => {
  try {
    const { table_name, api_keys } = req.body || {};
    if (!table_name || typeof table_name !== 'string') {
      return res.status(400).json({ success: false, error: 'table_name (string) 필요' });
    }
    if (!Array.isArray(api_keys)) {
      return res.status(400).json({ success: false, error: 'api_keys (array) 필요' });
    }
    // 안전: id-like 키만 통과 (api-leads, api-admin 등)
    const cleanKeys = api_keys
      .filter(k => typeof k === 'string' && /^api-[a-z0-9-]+$/i.test(k))
      .slice(0, 50); // 안전 상한
    await pool.query(
      `INSERT INTO dfd_mappings (table_name, api_keys, added_by)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         api_keys = VALUES(api_keys),
         added_by = COALESCE(VALUES(added_by), added_by)`,
      [table_name, JSON.stringify(cleanKeys), req.user?.id || null]
    );
    res.json({ success: true, data: { table_name, api_keys: cleanKeys } });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/dev/dfd-mappings/:tableName', devOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM dfd_mappings WHERE table_name = ?', [req.params.tableName]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────
// DFD 무시 목록 — 매핑 안 했지만 "알림 그만"으로 표시한 테이블
//   GET    /dev/dfd-dismissed              무시 목록
//   POST   /dev/dfd-dismissed              무시 등록 (body: {table_name})
//   DELETE /dev/dfd-dismissed/:tableName   다시 알림
// ─────────────────────────────────────────────────────────────
router.get('/dev/dfd-dismissed', devOnly, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT table_name, dismissed_by, dismissed_at FROM dfd_dismissed ORDER BY dismissed_at DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/dev/dfd-dismissed', devOnly, async (req, res) => {
  try {
    const { table_name } = req.body || {};
    if (!table_name || typeof table_name !== 'string') {
      return res.status(400).json({ success: false, error: 'table_name (string) 필요' });
    }
    await pool.query(
      `INSERT INTO dfd_dismissed (table_name, dismissed_by)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE
         dismissed_by = COALESCE(VALUES(dismissed_by), dismissed_by),
         dismissed_at = CURRENT_TIMESTAMP`,
      [table_name, req.user?.id || null]
    );
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/dev/dfd-dismissed/:tableName', devOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM dfd_dismissed WHERE table_name = ?', [req.params.tableName]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────
// 서버 등록 API 라우트 introspection (DFD API 자동 동기화)
// app._router.stack 을 walk → /api/* 마운트 추출
// ─────────────────────────────────────────────────────────────
router.get('/dev/registered-routes', devOnly, (req, res) => {
  try {
    const app = req.app;
    const found = new Set();
    const stack = app._router?.stack || app.router?.stack || [];
    for (const layer of stack) {
      if (!layer.regexp) continue;
      const src = layer.regexp.toString();
      // /api/<seg1>[/<seg2>] 패턴 추출
      const m = src.match(/\\\/api\\\/([a-zA-Z0-9_-]+)(?:\\\/([a-zA-Z0-9_-]+))?/);
      if (!m) continue;
      const seg1 = m[1];
      const seg2 = m[2];
      // /api/admin/<sub> → 'admin' 통합 (이미 api-admin 존재)
      if (seg2 && seg1 === 'admin') {
        found.add('/api/admin');
      } else if (seg2 && seg1 === 'pipeline') {
        // /api/pipeline/stages 같은 multi-segment
        found.add('/api/pipeline/' + seg2);
      } else {
        found.add('/api/' + seg1);
      }
    }
    res.json({ success: true, data: { routes: [...found].sort() } });
  } catch (err) {
    handleError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────
// DFD API 동적 매핑 (테이블 매핑의 거울 구조 — API → 페이지)
// ─────────────────────────────────────────────────────────────
router.get('/dev/dfd-api-mappings', devOnly, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT api_id, page_keys, added_by, added_at, updated_at
       FROM dfd_api_mappings ORDER BY api_id`
    );
    const data = rows.map(r => {
      let pages = [];
      try {
        pages = JSON.parse(r.page_keys || '[]');
      } catch (_) {
        pages = [];
      }
      return { ...r, page_keys: pages };
    });
    res.json({ success: true, data });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/dev/dfd-api-mappings', devOnly, async (req, res) => {
  try {
    const { api_id, page_keys } = req.body || {};
    if (!api_id || typeof api_id !== 'string') {
      return res.status(400).json({ success: false, error: 'api_id 필요' });
    }
    if (!Array.isArray(page_keys)) {
      return res.status(400).json({ success: false, error: 'page_keys 배열 필요' });
    }
    const cleanKeys = page_keys
      .filter(k => typeof k === 'string' && /^pg-[a-z0-9-]+$/i.test(k))
      .slice(0, 50);
    await pool.query(
      `INSERT INTO dfd_api_mappings (api_id, page_keys, added_by)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         page_keys = VALUES(page_keys),
         added_by = COALESCE(VALUES(added_by), added_by)`,
      [api_id, JSON.stringify(cleanKeys), req.user?.id || null]
    );
    res.json({ success: true, data: { api_id, page_keys: cleanKeys } });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/dev/dfd-api-mappings/:apiId', devOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM dfd_api_mappings WHERE api_id = ?', [req.params.apiId]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/dev/dfd-api-dismissed', devOnly, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT api_id, dismissed_by, dismissed_at FROM dfd_api_dismissed ORDER BY dismissed_at DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/dev/dfd-api-dismissed', devOnly, async (req, res) => {
  try {
    const { api_id } = req.body || {};
    if (!api_id || typeof api_id !== 'string') {
      return res.status(400).json({ success: false, error: 'api_id 필요' });
    }
    await pool.query(
      `INSERT INTO dfd_api_dismissed (api_id, dismissed_by)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE
         dismissed_by = COALESCE(VALUES(dismissed_by), dismissed_by),
         dismissed_at = CURRENT_TIMESTAMP`,
      [api_id, req.user?.id || null]
    );
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/dev/dfd-api-dismissed/:apiId', devOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM dfd_api_dismissed WHERE api_id = ?', [req.params.apiId]);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────
// DFD 매핑 자동 추론
//   GET /dev/infer-mappings
//     src/routes/*.js 파일들을 분석해 SQL 쿼리에서 테이블명 추출 →
//     실제 DB 테이블과 교차검증 후 제안 매핑 반환.
//     이미 매핑된/무시된 테이블은 제외.
//     응답: { suggestions: [{table_name, api_keys:[...], evidence:[...]}, ...] }
// ─────────────────────────────────────────────────────────────
// 파일명 → API ID 매핑 (예외: meetings.js → api-meeting)
const ROUTE_FILE_TO_API = {
  leads: 'api-leads',
  customers: 'api-customers',
  activities: 'api-activities',
  dashboard: 'api-dashboard',
  calendar: 'api-calendar',
  meetings: 'api-meeting',
  projects: 'api-projects',
  team: 'api-team',
  ai: 'api-ai',
  board: 'api-board',
  auth: 'api-auth',
  admin: 'api-admin',
  notifications: 'api-notifications',
  products: 'api-products',
  google: 'api-google',
};

// SQL 키워드 — table name 추출 시 노이즈로 잡힐 수 있는 단어
const SQL_NOISE_WORDS = new Set([
  'select',
  'where',
  'and',
  'or',
  'on',
  'using',
  'as',
  'is',
  'not',
  'null',
  'order',
  'group',
  'by',
  'having',
  'limit',
  'offset',
  'union',
  'all',
  'distinct',
  'values',
  'set',
  'inner',
  'left',
  'right',
  'outer',
  'cross',
  'natural',
  'use',
  'index',
  'force',
  'ignore',
  'partition',
  'dual',
  'tables',
  'columns',
  'information_schema',
  'mysql',
  'sys',
  'performance_schema',
]);

router.get('/dev/infer-mappings', devOnly, async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const routesDir = path.join(__dirname);

    // 1) 실제 DB 테이블 목록 (교차검증용)
    const [[dbRow]] = await pool.query('SELECT DATABASE() AS db');
    const [tables] = await pool.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?`,
      [dbRow.db]
    );
    const realTableSet = new Set(tables.map(t => t.TABLE_NAME.toLowerCase()));

    // 2) 이미 매핑되었거나 무시된 테이블 — 제안 대상에서 제외
    const [mappedRows] = await pool.query('SELECT table_name FROM dfd_mappings');
    const [dismissedRows] = await pool.query('SELECT table_name FROM dfd_dismissed');
    const skipSet = new Set([
      ...mappedRows.map(r => r.table_name),
      ...dismissedRows.map(r => r.table_name),
    ]);

    // 3) 정적 카탈로그(DFD.tables)에 이미 있는 테이블은 클라이언트가 알고 있으므로
    //    서버는 의식하지 않고 모두 추출 — 클라이언트가 필터.

    // 4) 라우트 파일 스캔
    const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.js'));
    // table_name → Map<api_key, evidenceFile[]>
    const accumulator = new Map();

    const TABLE_RE =
      /\b(?:from|join|into|update|alter\s+table|delete\s+from)\s+`?([a-z_][a-z0-9_]*)`?/gi;

    for (const file of files) {
      const baseName = file.replace(/\.js$/, '');
      const apiKey = ROUTE_FILE_TO_API[baseName];
      if (!apiKey) continue; // ROUTE_FILE_TO_API 에 없는 파일 스킵 (errorHandler 등)

      let content;
      try {
        content = fs.readFileSync(path.join(routesDir, file), 'utf8');
      } catch (_) {
        continue;
      }

      const seenInFile = new Set();
      let m;
      while ((m = TABLE_RE.exec(content)) !== null) {
        const tableName = m[1].toLowerCase();
        if (SQL_NOISE_WORDS.has(tableName)) continue;
        if (!realTableSet.has(tableName)) continue; // 실제 DB 테이블만
        if (skipSet.has(tableName)) continue; // 이미 처리됨
        if (seenInFile.has(`${apiKey}:${tableName}`)) continue;
        seenInFile.add(`${apiKey}:${tableName}`);

        if (!accumulator.has(tableName)) accumulator.set(tableName, new Map());
        const apis = accumulator.get(tableName);
        if (!apis.has(apiKey)) apis.set(apiKey, []);
        apis.get(apiKey).push(file);
      }
    }

    // 5) 결과 정리
    const suggestions = [];
    for (const [tableName, apis] of accumulator) {
      const apiList = [];
      for (const [apiKey, evidence] of apis) {
        apiList.push({ api_key: apiKey, evidence_files: evidence });
      }
      // api_key 알파벳 순
      apiList.sort((a, b) => a.api_key.localeCompare(b.api_key));
      suggestions.push({ table_name: tableName, api_keys: apiList });
    }
    suggestions.sort((a, b) => a.table_name.localeCompare(b.table_name));

    res.json({ success: true, data: { suggestions, scanned: files.length } });
  } catch (err) {
    handleError(res, err);
  }
});

// GET  /api/admin/dev/perf  — 최근 24h 성능 지표
router.get('/dev/perf', devOnly, async (req, res) => {
  try {
    const [hourly] = await pool.query(
      `SELECT DATE_FORMAT(created_at,'%H:00') AS hour,
              COUNT(*)                          AS requests,
              ROUND(AVG(duration_ms),1)         AS avg_ms,
              MAX(duration_ms)                  AS max_ms,
              SUM(CASE WHEN status_code >= 500 THEN 1 ELSE 0 END) AS srv_err,
              SUM(CASE WHEN status_code >= 400 AND status_code < 500 THEN 1 ELSE 0 END) AS cli_err
       FROM access_logs
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
       GROUP BY hour ORDER BY hour`
    );
    const [topRoutes] = await pool.query(
      `SELECT method, path,
              COUNT(*) AS calls, ROUND(AVG(duration_ms),1) AS avg_ms,
              SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS errors
       FROM access_logs
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
       GROUP BY method, path ORDER BY calls DESC LIMIT 20`
    );
    res.json({ success: true, data: { hourly, topRoutes } });
  } catch (err) {
    handleError(res, err);
  }
});

// ── access_logs 조치 상태 컬럼 자동 마이그레이션 ───────────────
pool
  .query(`ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS resolved      TINYINT(1)   DEFAULT 0`)
  .catch(() => {});
pool
  .query(`ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS resolved_by   INT          DEFAULT NULL`)
  .catch(() => {});
pool
  .query(`ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS resolved_at   TIMESTAMP    DEFAULT NULL`)
  .catch(() => {});
pool
  .query(`ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS resolve_note  VARCHAR(255) DEFAULT NULL`)
  .catch(() => {});

// ══════════════════════════════════════════════════════════════
// GET /api/admin/dev/error-logs  — 에러 로그 조회 (4xx/5xx, 페이지네이션)
// Query params:
//   filter    : all | 4xx | 5xx
//   sc        : 특정 상태코드 (401, 404 ...) — 상단 배지 클릭 시 사용
//   resolved  : all | pending | resolved  (default: all)
//   path      : 경로 검색어
//   hours     : 1~168
//   page / limit
// ══════════════════════════════════════════════════════════════
router.get('/dev/error-logs', devOnly, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const offset = (page - 1) * limit;
    const filter = req.query.filter || 'all'; // 'all' | '4xx' | '5xx'
    const scFilter = parseInt(req.query.sc) || null; // 특정 상태코드
    const resolvedFilter = req.query.resolved || 'all'; // 'all' | 'pending' | 'resolved'
    const pathQ = req.query.path || '';
    // hours: 0이면 전체 기간, 그 외 최대 8760(=1년)로 상한
    const rawHours = parseInt(req.query.hours);
    const hours =
      Number.isFinite(rawHours) && rawHours === 0
        ? 0
        : Math.min(8760, rawHours > 0 ? rawHours : 24);
    const allTime = hours === 0;

    // WHERE 절 — al. prefix로 JOIN ambiguous 방지
    const conditions = [];
    const params = [];
    if (!allTime) {
      conditions.push(`al.created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)`);
      params.push(hours);
    }

    // 상태코드 범위 필터
    if (scFilter) {
      conditions.push('al.status_code = ?');
      params.push(scFilter);
    } else if (filter === '4xx') {
      conditions.push('al.status_code >= 400 AND al.status_code < 500');
    } else if (filter === '5xx') {
      conditions.push('al.status_code >= 500');
    } else {
      conditions.push('al.status_code >= 400');
    }

    // 조치 상태 필터
    if (resolvedFilter === 'pending') {
      conditions.push('(al.resolved IS NULL OR al.resolved = 0)');
    } else if (resolvedFilter === 'resolved') {
      conditions.push('al.resolved = 1');
    }

    if (pathQ) {
      conditions.push('al.path LIKE ?');
      params.push(`%${pathQ}%`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    // 전체 건수 + 페이지 행 병렬 조회
    const [[countRows], [rows]] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM access_logs al ${where}`, params),
      pool.query(
        `SELECT al.id, al.user_id, al.method, al.path, al.status_code,
                al.duration_ms, al.ip, al.created_at,
                al.resolved, al.resolved_at, al.resolve_note,
                rb.full_name AS resolved_by_name,
                tm.name AS user_name, tm.email AS user_email
         FROM access_logs al
         LEFT JOIN team_members tm ON tm.id = al.user_id
         LEFT JOIN users        rb ON rb.id = al.resolved_by
         ${where}
         ORDER BY al.created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ),
    ]);
    const total = Number(countRows[0]?.total ?? 0);

    // 상태코드별 분포 — 조치 상태 포함 (resolved 컬럼이 없는 레거시 환경 대응)
    const timeWhere = allTime ? '' : 'created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR) AND ';
    const timeParam = allTime ? [] : [hours];
    const [dist] = await pool.query(
      `SELECT status_code,
              COUNT(*) AS cnt,
              SUM(CASE WHEN resolved = 1 THEN 1 ELSE 0 END) AS resolved_cnt
       FROM access_logs
       WHERE ${timeWhere}status_code >= 400
       GROUP BY status_code ORDER BY cnt DESC`,
      timeParam
    );

    // 잔여/조치완료 총합
    const [[summaryRow]] = await pool.query(
      `SELECT
         SUM(CASE WHEN (resolved IS NULL OR resolved = 0) THEN 1 ELSE 0 END) AS pending_cnt,
         SUM(CASE WHEN resolved = 1 THEN 1 ELSE 0 END)                       AS resolved_cnt
       FROM access_logs
       WHERE ${timeWhere}status_code >= 400`,
      timeParam
    );

    res.json({
      success: true,
      data: {
        rows,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        dist,
        summary: {
          pending: Number(summaryRow?.pending_cnt ?? total),
          resolved: Number(summaryRow?.resolved_cnt ?? 0),
        },
        hours,
        filter,
        scFilter,
        resolvedFilter,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ══════════════════════════════════════════════════════════════
// PATCH /api/admin/dev/error-logs/resolve
//   body: { ids: [1,2,3], note: '...' }           — 개별 ID 목록
//     or: { pattern: { sc, method, path }, note }  — 동일 패턴 일괄
//     or: { resolveAll: true, hours, filter }       — 현재 필터 전체
// ══════════════════════════════════════════════════════════════
router.patch('/dev/error-logs/resolve', devOnly, async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const { ids, pattern, resolveAll, hours = 24, filter = 'all', note = '' } = req.body;
    let affected = 0;

    if (resolveAll) {
      // 현재 필터 기준 미조치 전체 조치완료
      const cond = [
        'status_code >= 400',
        `created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)`,
        '(resolved IS NULL OR resolved = 0)',
      ];
      const p = [hours];
      if (filter === '4xx') {
        cond.push('status_code < 500');
      } else if (filter === '5xx') {
        cond.push('status_code >= 500');
      }
      const [r] = await pool.query(
        `UPDATE access_logs SET resolved=1, resolved_by=?, resolved_at=NOW(), resolve_note=?
         WHERE ${cond.join(' AND ')}`,
        [userId, note || null, ...p]
      );
      affected = r.affectedRows;
    } else if (pattern) {
      const [r] = await pool.query(
        `UPDATE access_logs SET resolved=1, resolved_by=?, resolved_at=NOW(), resolve_note=?
         WHERE status_code=? AND method=? AND path=? AND (resolved IS NULL OR resolved=0)`,
        [userId, note || null, pattern.sc, pattern.method, pattern.path]
      );
      affected = r.affectedRows;
    } else if (Array.isArray(ids) && ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      const [r] = await pool.query(
        `UPDATE access_logs SET resolved=1, resolved_by=?, resolved_at=NOW(), resolve_note=?
         WHERE id IN (${placeholders})`,
        [userId, note || null, ...ids]
      );
      affected = r.affectedRows;
    } else {
      return res
        .status(400)
        .json({ success: false, error: 'ids, pattern, resolveAll 중 하나 필요' });
    }

    res.json({ success: true, affected });
  } catch (err) {
    handleError(res, err);
  }
});

// ══════════════════════════════════════════════════════════════
// PATCH /api/admin/dev/error-logs/unresolve
//   body: { ids: [1,2,3] }
// ══════════════════════════════════════════════════════════════
router.patch('/dev/error-logs/unresolve', devOnly, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length)
      return res.status(400).json({ success: false, error: 'ids 배열 필요' });
    const placeholders = ids.map(() => '?').join(',');
    const [r] = await pool.query(
      `UPDATE access_logs SET resolved=0, resolved_by=NULL, resolved_at=NULL, resolve_note=NULL
       WHERE id IN (${placeholders})`,
      ids
    );
    res.json({ success: true, affected: r.affectedRows });
  } catch (err) {
    handleError(res, err);
  }
});

// ══════════════════════════════════════════════════════════════
// POST /api/admin/dev/error-logs/detect
//   클릭 시점에 시스템 헬스 프로브 — 미리 정의된 핵심 엔드포인트들을
//   내부 HTTP 호출하여 4xx/5xx 발생 시 access_logs 미들웨어가 자동 등록.
//   결과: { tested, failed, registered, errors:[{endpoint,status}] }
// ══════════════════════════════════════════════════════════════
router.post('/dev/error-logs/detect', devOnly, async (req, res) => {
  try {
    const http = require('http');
    const auth = req.headers.authorization || '';
    const port = req.socket?.localPort || require('../../config').port || 3001;

    // 시스템 핵심 GET 엔드포인트 — 4xx/5xx 응답은 미들웨어가 access_logs 자동 INSERT
    const endpoints = [
      ['GET', '/api/dashboard'],
      ['GET', '/api/dashboard/stats'],
      ['GET', '/api/dashboard/funnel'],
      ['GET', '/api/dashboard/monthly'],
      ['GET', '/api/dashboard/activities'],
      ['GET', '/api/leads?limit=1'],
      ['GET', '/api/customers?limit=1'],
      ['GET', '/api/products?limit=1'],
      ['GET', '/api/projects?limit=1'],
      ['GET', '/api/team'],
      ['GET', '/api/activities?limit=1'],
      ['GET', '/api/calendar'],
      ['GET', '/api/meetings'],
      ['GET', '/api/board'],
      ['GET', '/api/admin/users'],
    ];

    const probe = (method, path) =>
      new Promise(resolve => {
        const r = http.request(
          {
            host: '127.0.0.1',
            port,
            method,
            path,
            headers: { Authorization: auth },
            timeout: 4000,
          },
          resp => {
            resp.on('data', () => {});
            resp.on('end', () => resolve({ status: resp.statusCode }));
          }
        );
        r.on('error', e => resolve({ status: 0, error: e.message }));
        r.on('timeout', () => {
          r.destroy();
          resolve({ status: 0, error: 'timeout' });
        });
        r.end();
      });

    // ID 기반 카운팅 — timezone 영향 없이 정확
    const [[beforeRow]] = await pool.query('SELECT COALESCE(MAX(id),0) AS max_id FROM access_logs');
    const beforeMaxId = Number(beforeRow.max_id);

    const probedAt = new Date();
    const results = await Promise.all(endpoints.map(([m, p]) => probe(m, p)));

    const errors = results
      .map((r, i) => ({ endpoint: endpoints[i].join(' '), status: r.status, error: r.error }))
      .filter(r => r.status === 0 || r.status >= 400);

    // 미들웨어 res.on('finish') INSERT 반영 대기
    await new Promise(r => setTimeout(r, 500));

    const [[newRow]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM access_logs
       WHERE id > ? AND status_code >= 400`,
      [beforeMaxId]
    );

    res.json({
      success: true,
      tested: endpoints.length,
      failed: errors.length,
      registered: Number(newRow.cnt),
      probedAt,
      errors,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ══════════════════════════════════════════════════════════════
// POST /api/admin/dev/error-logs/auto-classify
//   known-fix 패턴을 자동으로 조치완료 처리 + 미리보기(dryRun)
//   body: { dryRun: bool, hours: 24 }
// ══════════════════════════════════════════════════════════════
router.post('/dev/error-logs/auto-classify', devOnly, async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const dryRun = req.body?.dryRun !== false; // default: dryRun=true (미리보기)
    const hours = Math.min(168, parseInt(req.body?.hours) || 24 * 7);

    // ── 자동 분류 규칙 정의 ─────────────────────────────────────
    // { label, note, conditions: [sql_fragment, ...params] }
    const rules = [
      {
        label: '로그아웃 상태 폴링 (근본 원인: SKIP_LOG_PATHS 적용 완료)',
        note: '폴링 경로 SKIP 처리로 신규 발생 차단됨',
        sql: `status_code=401 AND method='GET'
                AND path IN ('/api/ai/usage/today','/api/notifications','/api/briefing/today')
                AND (resolved IS NULL OR resolved=0)`,
        params: [],
      },
      {
        label: '개발·테스트 중 발생한 인증 오류 (현재 정상)',
        note: '서버 재시작 및 개발 테스트 세션 중 발생',
        sql: `status_code=401
                AND path LIKE '/api/admin/dev/%'
                AND (resolved IS NULL OR resolved=0)`,
        params: [],
      },
      {
        label: '테스트 데이터로 인한 404 (존재하지 않는 ID·경로)',
        note: '테스트 코드의 더미 ID/경로 요청',
        sql: `status_code=404
                AND (path LIKE '%99999%' OR path LIKE '%nonexistent%'
                     OR path REGEXP '^/api/[0-9]+$')
                AND (resolved IS NULL OR resolved=0)`,
        params: [],
      },
      {
        label: '테스트 데이터로 인한 400 (잘못된 경로)',
        note: '테스트 코드의 유효하지 않은 경로 요청',
        sql: `status_code=400
                AND (path='/api/abc' OR path='/api/0' OR path='/api/-1'
                     OR path='/api/' OR path='/api')
                AND (resolved IS NULL OR resolved=0)`,
        params: [],
      },
    ];

    const results = [];
    for (const rule of rules) {
      const timeCond = `created_at >= DATE_SUB(NOW(), INTERVAL ${hours} HOUR)`;
      const fullSql = `${rule.sql} AND ${timeCond}`;

      const [[{ cnt }]] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM access_logs WHERE ${fullSql}`,
        rule.params
      );
      const count = Number(cnt);

      if (!dryRun && count > 0) {
        await pool.query(
          `UPDATE access_logs
             SET resolved=1, resolved_by=?, resolved_at=NOW(), resolve_note=?
           WHERE ${fullSql}`,
          [userId, rule.note, ...rule.params]
        );
      }
      results.push({ label: rule.label, note: rule.note, count, applied: !dryRun && count > 0 });
    }

    const totalAffected = results.reduce((s, r) => s + (r.applied ? r.count : 0), 0);
    const totalPreview = results.reduce((s, r) => s + r.count, 0);

    res.json({
      success: true,
      dryRun,
      totalAffected,
      totalPreview,
      results,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ══════════════════════════════════════════════════════════════
// POST /api/admin/dev/schema/history  — 스키마 변경 이력 기록
//   body: { changes: [{ type, table, col, risk, msg, mitigation, before, after }] }
// ══════════════════════════════════════════════════════════════
router.post('/dev/schema/history', devOnly, async (req, res) => {
  try {
    const { changes } = req.body || {};
    if (!Array.isArray(changes) || !changes.length) return res.json({ success: true, recorded: 0 });
    const userId = req.user?.id || null;

    // 인코딩 깨진 데이터(U+FFFD replacement char) INSERT 거부
    const hasMojibake = s => typeof s === 'string' && /�/.test(s);

    let recorded = 0;
    for (const c of changes) {
      if (!c.type || !c.table || !c.msg) continue;
      if (
        hasMojibake(c.msg) ||
        hasMojibake(c.mitigation) ||
        hasMojibake(c.table) ||
        hasMojibake(c.col)
      ) {
        console.warn('[schema-history] 인코딩 깨진 데이터 INSERT 거부:', c.msg);
        continue;
      }
      // 중복 방지: 동일 (type, table, col, msg) 가 최근 5분 내 있으면 스킵
      const [[dup]] = await pool.query(
        `SELECT id FROM schema_change_log
         WHERE change_type=? AND table_name=? AND COALESCE(column_name,'')=COALESCE(?,'')
           AND message=? AND changed_at > DATE_SUB(NOW(), INTERVAL 5 MINUTE)
         LIMIT 1`,
        [c.type, c.table, c.col || null, String(c.msg).slice(0, 500)]
      );
      if (dup) continue;

      await pool.query(
        `INSERT INTO schema_change_log
         (change_type, table_name, column_name, risk, message, mitigation, before_def, after_def, detected_by)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          c.type,
          String(c.table).slice(0, 100),
          c.col ? String(c.col).slice(0, 100) : null,
          c.risk || 'LOW',
          String(c.msg).slice(0, 500),
          c.mitigation ? String(c.mitigation).slice(0, 2000) : null,
          c.before ? String(c.before).slice(0, 500) : null,
          c.after ? String(c.after).slice(0, 500) : null,
          userId,
        ]
      );
      recorded++;
    }
    res.json({ success: true, recorded });
  } catch (err) {
    handleError(res, err);
  }
});

// ══════════════════════════════════════════════════════════════
// GET /api/admin/dev/schema/history  — 변경 이력 조회 (시간 역순)
//   ?table=&type=&risk=&limit=100
// ══════════════════════════════════════════════════════════════
router.get('/dev/schema/history', devOnly, async (req, res) => {
  try {
    const limit = Math.min(500, parseInt(req.query.limit) || 100);
    const cond = [];
    const params = [];
    if (req.query.table) {
      cond.push('table_name=?');
      params.push(req.query.table);
    }
    if (req.query.type) {
      cond.push('change_type=?');
      params.push(req.query.type);
    }
    if (req.query.risk) {
      cond.push('risk=?');
      params.push(req.query.risk);
    }
    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';

    const [rows] = await pool.query(
      `SELECT scl.*, tm.name AS detected_by_name
       FROM schema_change_log scl
       LEFT JOIN team_members tm ON scl.detected_by = tm.id
       ${where}
       ORDER BY scl.changed_at DESC LIMIT ?`,
      [...params, limit]
    );

    // 통계
    const [[stats]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN risk='HIGH' THEN 1 ELSE 0 END) AS high_cnt,
              SUM(CASE WHEN risk='MEDIUM' THEN 1 ELSE 0 END) AS medium_cnt,
              SUM(CASE WHEN risk='LOW' THEN 1 ELSE 0 END) AS low_cnt,
              MIN(changed_at) AS first_at, MAX(changed_at) AS last_at
       FROM schema_change_log`
    );

    res.json({ success: true, data: rows, stats });
  } catch (err) {
    handleError(res, err);
  }
});

// ══════════════════════════════════════════════════════════════
// POST /api/admin/dev/schema/coach  — 변경 사항에 대한 AI 영향 분석 + 사전 조치 코칭
//   body: { change_id }
// ══════════════════════════════════════════════════════════════
router.post('/dev/schema/coach', devOnly, async (req, res) => {
  try {
    const { change_id } = req.body || {};
    if (!Number.isFinite(Number(change_id)))
      return res.status(400).json({ success: false, error: 'change_id 필요' });

    const [[change]] = await pool.query('SELECT * FROM schema_change_log WHERE id=?', [change_id]);
    if (!change) return res.status(404).json({ success: false, error: '변경 이력 없음' });

    // 영향 영역 자동 수집: FK 관계 + 컬럼 동시 보유 테이블
    const [[dbRow]] = await pool.query('SELECT DATABASE() AS db');
    const dbName = dbRow.db;

    const [fkOut] = await pool.query(
      `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA=? AND REFERENCED_TABLE_NAME=?`,
      [dbName, change.table_name]
    );
    const [fkIn] = await pool.query(
      `SELECT REFERENCED_TABLE_NAME AS ref_table, REFERENCED_COLUMN_NAME AS ref_col, COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND REFERENCED_TABLE_NAME IS NOT NULL`,
      [dbName, change.table_name]
    );

    // 동일 컬럼명을 가진 다른 테이블 (논리적 연결 가능성)
    let sameNameTables = [];
    if (change.column_name) {
      const [r] = await pool.query(
        `SELECT TABLE_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA=? AND COLUMN_NAME=? AND TABLE_NAME != ?`,
        [dbName, change.column_name, change.table_name]
      );
      sameNameTables = r;
    }

    const ctx = `
[변경 정보]
- 유형: ${change.change_type}
- 테이블: ${change.table_name}
- 컬럼: ${change.column_name || '(없음)'}
- 영향도: ${change.risk}
- 변경 내용: ${change.message}
- 기존 정의: ${change.before_def || '(N/A)'}
- 변경 후: ${change.after_def || '(N/A)'}

[참조 관계 — 이 테이블을 FK로 참조하는 다른 테이블 ${fkOut.length}개]
${fkOut.map(f => `  - ${f.TABLE_NAME}.${f.COLUMN_NAME}`).join('\n') || '  (없음)'}

[이 테이블이 FK로 참조하는 외부 테이블 ${fkIn.length}개]
${fkIn.map(f => `  - ${f.ref_table}.${f.ref_col} ← ${f.COLUMN_NAME}`).join('\n') || '  (없음)'}

[동일 컬럼명을 가진 다른 테이블 ${sameNameTables.length}개]
${sameNameTables.map(t => `  - ${t.TABLE_NAME}.${change.column_name} (${t.COLUMN_TYPE})`).join('\n') || '  (없음)'}`;

    const prompt = `당신은 시니어 DB 아키텍트입니다. CRM 시스템의 DB 스키마 변경 사항을 검토하고, 영향 분석 + 사전 조치 가이드를 제공합니다.
${ctx}

다음 JSON 형식으로만 응답하세요 (마크다운/설명 없이 순수 JSON):
{
  "impact_summary": "이 변경의 영향을 한 줄로 (40자 이내)",
  "affected_areas": [
    { "area": "DB / API / 프론트엔드 / 데이터무결성 등 영역", "description": "구체적 영향 (50자 이내)", "risk": "high" | "medium" | "low" }
  ],
  "pre_action_steps": [
    "변경 전 반드시 수행할 사전 조치 1",
    "변경 전 사전 조치 2",
    "..."
  ],
  "post_action_steps": [
    "변경 후 검증할 항목 1",
    "..."
  ],
  "rollback_plan": "롤백이 필요할 때의 절차 (50자 이내)",
  "test_scenarios": [
    "QA에서 반드시 테스트할 시나리오 1",
    "..."
  ]
}

작성 기준:
- 한국어로 작성, 실무적이고 구체적
- pre_action_steps는 2~5개, post_action_steps는 2~4개
- 영향 없는 영역은 affected_areas에 포함하지 않음
- HIGH 변경은 rollback_plan을 반드시 상세하게`;

    const model = genAI.getGenerativeModel({
      model: MODEL_FAST,
      safetySettings: SAFETY_SETTINGS,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.3,
        maxOutputTokens: 1200,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    const r = await model.generateContent(prompt);
    const txt = r.response.text();
    let parsed;
    try {
      parsed = JSON.parse(txt);
    } catch {
      return res
        .status(502)
        .json({ success: false, error: 'AI 파싱 실패', raw: txt.slice(0, 200) });
    }

    res.json({
      success: true,
      data: {
        ...parsed,
        meta: {
          fk_in_count: fkIn.length,
          fk_out_count: fkOut.length,
          same_name_count: sameNameTables.length,
        },
      },
    });
  } catch (err) {
    console.error('Schema coach error:', err.message);
    res.status(500).json({ success: false, error: friendlyError(err) });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /api/admin/dev/schema-relations  — FK + 인덱스 상세 정보 (캐시 30s)
// ══════════════════════════════════════════════════════════════
router.get('/dev/schema-relations', devOnly, async (req, res) => {
  try {
    const force = req.query.refresh === '1';
    if (!force && _schemaCache.relations && Date.now() - _schemaCache.relTs < SCHEMA_TTL) {
      return res.json({ success: true, data: _schemaCache.relations, cached: true });
    }
    const [[dbRow]] = await pool.query('SELECT DATABASE() AS db');
    const dbName = dbRow.db;

    // 3개 쿼리 병렬 실행 (information_schema 직렬 → 병렬, ~90ms → ~35ms)
    const [[fks], [indexes], [colComments]] = await Promise.all([
      pool.query(
        `
        SELECT kcu.TABLE_NAME, kcu.COLUMN_NAME, kcu.CONSTRAINT_NAME,
               kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME,
               rc.UPDATE_RULE, rc.DELETE_RULE
        FROM information_schema.KEY_COLUMN_USAGE kcu
        JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
          ON rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
         AND rc.CONSTRAINT_SCHEMA = kcu.TABLE_SCHEMA
        WHERE kcu.TABLE_SCHEMA = ? AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
        ORDER BY kcu.TABLE_NAME, kcu.COLUMN_NAME`,
        [dbName]
      ),
      pool.query(
        `
        SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME,
               NON_UNIQUE, INDEX_TYPE, SEQ_IN_INDEX
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
        [dbName]
      ),
      pool.query(
        `
        SELECT TABLE_NAME, COLUMN_NAME, COLUMN_COMMENT
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND COLUMN_COMMENT != ''
        ORDER BY TABLE_NAME, ORDINAL_POSITION`,
        [dbName]
      ),
    ]);

    const result = { fks, indexes, colComments };
    _schemaCache.relations = result;
    _schemaCache.relTs = Date.now();
    res.json({ success: true, data: result });
  } catch (err) {
    handleError(res, err);
  }
});

// ══════════════════════════════════════════════════════════════
// POST /api/admin/dev/schema-alter  — DDL 실행 (superadmin, 안전 검증 포함)
// ══════════════════════════════════════════════════════════════
router.post('/dev/schema-alter', devOnly, async (req, res) => {
  try {
    const { sql, dryRun } = req.body;
    if (!sql) return res.status(400).json({ success: false, error: 'SQL이 필요합니다.' });

    const trimmed = sql.trim().toUpperCase();

    // 파괴적 명령 차단
    const BLOCKED = ['DROP TABLE', 'TRUNCATE TABLE', 'DROP DATABASE', 'DROP SCHEMA', 'DELETE FROM'];
    for (const b of BLOCKED) {
      if (trimmed.startsWith(b) || trimmed.includes(' ' + b)) {
        return res.status(400).json({
          success: false,
          error: `'${b}' 명령은 보안상 허용되지 않습니다. DB 관리자에게 문의하세요.`,
        });
      }
    }

    // 허용 명령만 통과
    const ALLOWED = [
      'ALTER TABLE',
      'CREATE TABLE',
      'CREATE INDEX',
      'CREATE UNIQUE INDEX',
      'DROP INDEX',
    ];
    const allowed = ALLOWED.some(a => trimmed.startsWith(a));
    if (!allowed) {
      return res
        .status(400)
        .json({ success: false, error: `허용된 DDL: ALTER TABLE / CREATE TABLE / CREATE INDEX` });
    }

    // Dry-run: 트랜잭션 내 실행 후 ROLLBACK → 실제 변경 없이 구문/권한 검증
    if (dryRun) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.query(sql); // 구문 오류면 여기서 throw
        await conn.rollback(); // 성공해도 즉시 롤백
        return res.json({ success: true, dryRun: true, sql });
      } catch (dryErr) {
        await conn.rollback().catch(() => {});
        return res.status(400).json({ success: false, dryRun: true, error: dryErr.message });
      } finally {
        conn.release();
      }
    }

    await pool.query(sql);

    // 캐시 즉시 무효화 (DDL 변경 후 /schema 재조회 시 최신 반영)
    _schemaCache.ts = 0;
    _schemaCache.relTs = 0;

    // 스키마 변경 웹소켓 브로드캐스트 (영향도 분석 트리거)
    try {
      const { wsBroadcast } = require('../ws');
      wsBroadcast({ type: 'schema_changed', sql, changedAt: new Date().toISOString() });
    } catch (_) {}

    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
