const pool = require('./db');

async function initTables() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS calendar_events (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      title          VARCHAR(200) NOT NULL,
      description    TEXT,
      start_datetime DATETIME NOT NULL,
      end_datetime   DATETIME,
      all_day        TINYINT(1) DEFAULT 0,
      event_type     VARCHAR(20) DEFAULT '기타',
      status         VARCHAR(20) DEFAULT 'planned',
      lead_id        INT,
      customer_name  VARCHAR(200),
      assigned_to    INT,
      color          VARCHAR(20) DEFAULT '#e63946',
      recurrence     VARCHAR(100),
      created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    try { await pool.query(`ALTER TABLE calendar_events ADD COLUMN status VARCHAR(20) DEFAULT 'planned'`); } catch (_) {}

    await pool.query(`CREATE TABLE IF NOT EXISTS announcements (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      title      VARCHAR(300) NOT NULL,
      content    TEXT NOT NULL,
      is_pinned  TINYINT(1) DEFAULT 0,
      created_by INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await pool.query(`CREATE TABLE IF NOT EXISTS comments (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      ref_type    VARCHAR(30) NOT NULL,
      ref_id      INT NOT NULL,
      content     TEXT NOT NULL,
      author_name VARCHAR(100),
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ref (ref_type, ref_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await pool.query(`CREATE TABLE IF NOT EXISTS faq (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      question   TEXT NOT NULL,
      answer     TEXT NOT NULL,
      category   VARCHAR(50) DEFAULT '기타',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await pool.query(`CREATE TABLE IF NOT EXISTS access_logs (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      action      VARCHAR(300),
      method      VARCHAR(10),
      path        VARCHAR(500),
      ip          VARCHAR(60),
      status_code INT,
      duration_ms INT,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await pool.query(`CREATE TABLE IF NOT EXISTS meeting_minutes (
      id                 INT AUTO_INCREMENT PRIMARY KEY,
      title              VARCHAR(300) NOT NULL,
      meeting_date       DATE,
      audio_filename     VARCHAR(300),
      audio_duration_sec INT,
      raw_transcript     MEDIUMTEXT,
      speakers_json      MEDIUMTEXT,
      summary_md         MEDIUMTEXT,
      agenda             TEXT,
      key_points         TEXT,
      action_items       TEXT,
      customer_name      VARCHAR(200),
      lead_id            INT NULL,
      calendar_event_id  INT NULL,
      created_by         INT NULL,
      created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_meeting_date (meeting_date),
      INDEX idx_customer (customer_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await pool.query(`CREATE TABLE IF NOT EXISTS ai_usage (
      id                INT AUTO_INCREMENT PRIMARY KEY,
      user_id           INT NULL,
      endpoint          VARCHAR(100),
      prompt_tokens     INT DEFAULT 0,
      completion_tokens INT DEFAULT 0,
      total_tokens      INT DEFAULT 0,
      model             VARCHAR(50),
      created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_created (created_at),
      INDEX idx_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    try { await pool.query(`ALTER TABLE ai_usage ADD COLUMN user_id INT NULL AFTER id`); } catch (_) {}
    try { await pool.query(`ALTER TABLE ai_usage ADD INDEX idx_user (user_id)`); } catch (_) {}

    await pool.query(`CREATE TABLE IF NOT EXISTS system_settings (
      setting_key   VARCHAR(50) PRIMARY KEY,
      setting_value VARCHAR(255),
      updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await pool.query(
      `INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES
        ('idle_timeout_min', '30'),
        ('default_monthly_token_limit', '500000')`
    );

    try { await pool.query(`ALTER TABLE team_members ADD COLUMN monthly_token_limit INT NULL`); } catch (_) {}

    // 성능 인덱스 (idempotent)
    const idx = [
      `ALTER TABLE calendar_events ADD INDEX idx_start_datetime (start_datetime)`,
      `ALTER TABLE calendar_events ADD INDEX idx_assignee_start (assigned_to, start_datetime)`,
      `ALTER TABLE calendar_events ADD INDEX idx_customer (customer_name)`,
      `ALTER TABLE meeting_minutes ADD INDEX idx_created_at (created_at)`,
      `ALTER TABLE leads ADD INDEX idx_stage_updated (stage, updated_at)`,
      `ALTER TABLE leads ADD INDEX idx_assigned_stage (assigned_to, stage)`,
      `ALTER TABLE activities ADD INDEX idx_lead_performed (lead_id, performed_at)`,
      `ALTER TABLE activities ADD INDEX idx_performed_at (performed_at)`
    ];
    for (const sql of idx) {
      try { await pool.query(sql); } catch (e) {
        if (!String(e.message).includes('Duplicate')) console.warn('⚠ 인덱스 추가 경고:', e.message);
      }
    }

    console.log('✅ DB 확장 테이블 + 인덱스 초기화 완료');
  } catch (err) {
    console.error('❌ DB 초기화 오류:', err.message);
  }
}

module.exports = { initTables };
