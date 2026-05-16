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

    try {
      await pool.query(
        `ALTER TABLE calendar_events ADD COLUMN status VARCHAR(20) DEFAULT 'planned'`
      );
    } catch (_) {
      /* column may already exist */
    }

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

    try {
      await pool.query(`ALTER TABLE ai_usage ADD COLUMN user_id INT NULL AFTER id`);
    } catch (_) {
      /* column may already exist */
    }
    try {
      await pool.query(`ALTER TABLE ai_usage ADD INDEX idx_user (user_id)`);
    } catch (_) {
      /* index may already exist */
    }

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

    try {
      await pool.query(`ALTER TABLE team_members ADD COLUMN monthly_token_limit INT NULL`);
    } catch (_) {
      /* column may already exist */
    }

    // ── 메뉴 구조 설정 (관리자가 사이드바 순서/가시성/라벨 커스터마이즈) ──
    await pool.query(`CREATE TABLE IF NOT EXISTS menu_sections (
      section_key   VARCHAR(50) PRIMARY KEY,
      section_label VARCHAR(100) NOT NULL,
      display_order INT DEFAULT 0,
      is_visible    TINYINT DEFAULT 1,
      is_system     TINYINT DEFAULT 0,
      updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await pool.query(`CREATE TABLE IF NOT EXISTS menu_items (
      menu_key       VARCHAR(50) PRIMARY KEY,
      section_key    VARCHAR(50) NOT NULL,
      display_order  INT DEFAULT 0,
      is_visible     TINYINT DEFAULT 1,
      label_override VARCHAR(100) DEFAULT NULL,
      is_system      TINYINT DEFAULT 0,
      updated_by     INT NULL,
      updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_section_order (section_key, display_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // ── DFD 동적 매핑 (관리자가 우클릭 → 매핑 추가) ──────────────
    // 정적 카탈로그(DFD.tables/a2t) 외의 신규 테이블을 API 와 연결
    await pool.query(`CREATE TABLE IF NOT EXISTS dfd_mappings (
      table_name VARCHAR(100) PRIMARY KEY,
      api_keys   TEXT NOT NULL COMMENT 'JSON array e.g. ["api-leads","api-admin"]',
      added_by   INT NULL,
      added_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // ── DFD 무시 목록 (관리자가 알림만 끄고 매핑은 안 함) ────────
    // 미분류 테이블 중 "확인은 했지만 매핑할 필요 없음" 으로 표시한 항목
    await pool.query(`CREATE TABLE IF NOT EXISTS dfd_dismissed (
      table_name   VARCHAR(100) PRIMARY KEY,
      dismissed_by INT NULL,
      dismissed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // ── DFD API 동적 매핑 (테이블과 동일 패턴 — API → 페이지) ─────
    await pool.query(`CREATE TABLE IF NOT EXISTS dfd_api_mappings (
      api_id     VARCHAR(100) PRIMARY KEY COMMENT 'e.g. api-leads, api-exchange',
      page_keys  TEXT NOT NULL COMMENT 'JSON array e.g. ["pg-dashboard","pg-admin"]',
      added_by   INT NULL,
      added_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await pool.query(`CREATE TABLE IF NOT EXISTS dfd_api_dismissed (
      api_id       VARCHAR(100) PRIMARY KEY,
      dismissed_by INT NULL,
      dismissed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // ── DFD 페이지 동적 메타 + 매핑 (API/테이블과 동일 패턴) ─────
    // 신규 발견된 페이지 파일에 대한 라벨·아이콘·API 매핑 저장
    await pool.query(`CREATE TABLE IF NOT EXISTS dfd_page_mappings (
      page_id    VARCHAR(100) PRIMARY KEY,
      label      VARCHAR(100) NULL COMMENT '사용자 정의 표시명 (NULL=파일명 기반)',
      icon       VARCHAR(20)  NULL COMMENT '사용자 정의 이모지',
      api_keys   TEXT NULL COMMENT 'JSON array — 이 페이지가 호출하는 API 들',
      added_by   INT NULL,
      added_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await pool.query(`CREATE TABLE IF NOT EXISTS dfd_page_dismissed (
      page_id      VARCHAR(100) PRIMARY KEY,
      dismissed_by INT NULL,
      dismissed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // ── 스키마 스냅샷 영구 저장 (변경 이력 비교 baseline) ──────────
    // 메모리 기반 _lastSnap 의 단점(페이지 새로고침 시 초기화) 해결
    await pool.query(`CREATE TABLE IF NOT EXISTS schema_snapshots (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      snapshot_json LONGTEXT NOT NULL,
      recorded_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      recorded_by   INT NULL,
      INDEX idx_recorded (recorded_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // ── 소스 모니터 스냅샷 (추이 추적용) ──────────────────────
    // Phase 1-3 의 통계를 시계열로 저장 → 그래프/리포트 생성
    await pool.query(`CREATE TABLE IF NOT EXISTS source_monitor_snapshots (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      total_files     INT NOT NULL DEFAULT 0,
      total_loc       INT NOT NULL DEFAULT 0,
      total_size      BIGINT NOT NULL DEFAULT 0,
      total_functions INT NULL,
      avg_complexity  DECIMAL(6,2) NULL,
      max_complexity  INT NULL,
      cx_over_10      INT NULL,
      cx_over_20      INT NULL,
      cx_over_50      INT NULL,
      eslint_errors   INT NULL,
      eslint_warnings INT NULL,
      audit_critical  INT NULL,
      audit_high      INT NULL,
      audit_moderate  INT NULL,
      audit_low       INT NULL,
      audit_total     INT NULL,
      categories_json TEXT NULL,    -- by_category 압축 JSON
      recorded_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      recorded_by     INT NULL,
      note            VARCHAR(200) NULL,
      INDEX idx_recorded (recorded_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // ── 이메일 템플릿 — Mailto 발송용 ─────────────────────────
    // 카테고리: lead | customer | project | general
    // is_system=1 시드 템플릿은 수정/삭제 불가 (UI 에서 제한)
    await pool.query(`CREATE TABLE IF NOT EXISTS email_templates (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      name         VARCHAR(150) NOT NULL,
      category     VARCHAR(20)  NOT NULL DEFAULT 'general',
      subject      VARCHAR(300) NOT NULL,
      body         TEXT         NOT NULL,
      is_system    TINYINT(1)   NOT NULL DEFAULT 0,
      created_by   INT          NULL,
      created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_category (category),
      INDEX idx_system   (is_system)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // 시드 5개 — 한국 B2B 영업 표준 패턴 (시스템 템플릿)
    const { DEFAULT_EMAIL_TEMPLATES } = require('./data/emailTemplateDefaults');
    for (const t of DEFAULT_EMAIL_TEMPLATES) {
      // 이름 + is_system 조합으로 중복 방지 — 멱등성
      await pool.query(
        `INSERT INTO email_templates (name, category, subject, body, is_system)
         SELECT ?, ?, ?, ?, 1
         WHERE NOT EXISTS (
           SELECT 1 FROM email_templates WHERE name = ? AND is_system = 1
         )`,
        [t.name, t.category, t.subject, t.body, t.name]
      );
    }

    // 시드 (INSERT IGNORE 로 멱등성 보장 — 기존 설정 덮어쓰지 않음)
    const { DEFAULT_SECTIONS, DEFAULT_ITEMS } = require('./data/menuDefaults');
    for (const s of DEFAULT_SECTIONS) {
      await pool.query(
        `INSERT IGNORE INTO menu_sections (section_key, section_label, display_order, is_visible, is_system)
         VALUES (?, ?, ?, 1, ?)`,
        [s.section_key, s.section_label, s.display_order, s.is_system]
      );
    }
    for (const it of DEFAULT_ITEMS) {
      await pool.query(
        `INSERT IGNORE INTO menu_items (menu_key, section_key, display_order, is_visible, is_system)
         VALUES (?, ?, ?, 1, ?)`,
        [it.menu_key, it.section_key, it.display_order, it.is_system]
      );
    }

    // 성능 인덱스 (idempotent)
    const idx = [
      `ALTER TABLE calendar_events ADD INDEX idx_start_datetime (start_datetime)`,
      `ALTER TABLE calendar_events ADD INDEX idx_assignee_start (assigned_to, start_datetime)`,
      `ALTER TABLE calendar_events ADD INDEX idx_customer (customer_name)`,
      `ALTER TABLE meeting_minutes ADD INDEX idx_created_at (created_at)`,
      `ALTER TABLE leads ADD INDEX idx_stage_updated (stage, updated_at)`,
      `ALTER TABLE leads ADD INDEX idx_assigned_stage (assigned_to, stage)`,
      `ALTER TABLE activities ADD INDEX idx_lead_performed (lead_id, performed_at)`,
      `ALTER TABLE activities ADD INDEX idx_performed_at (performed_at)`,
    ];
    for (const sql of idx) {
      try {
        await pool.query(sql);
      } catch (e) {
        if (!String(e.message).includes('Duplicate'))
          console.warn('⚠ 인덱스 추가 경고:', e.message);
      }
    }

    // ── PK AUTO_INCREMENT 무결성 보장 (idempotent) ──────────────
    // 과거 외부 마이그레이션으로 AUTO_INCREMENT가 빠진 테이블 자가 복구
    // (예: leads.id AUTO_INCREMENT 누락으로 INSERT 시 "Field 'id' doesn't have a default value" 오류)
    const aiGuards = ['leads'];
    for (const t of aiGuards) {
      try {
        const [cols] = await pool.query('SHOW COLUMNS FROM `' + t + "` WHERE Field='id'");
        if (!cols.length) continue;
        const hasAI = (cols[0].Extra || '').toLowerCase().includes('auto_increment');
        if (!hasAI) {
          const [[m]] = await pool.query('SELECT COALESCE(MAX(id),0)+1 AS next FROM `' + t + '`');
          await pool.query('ALTER TABLE `' + t + '` MODIFY id INT(11) NOT NULL AUTO_INCREMENT');
          await pool.query('ALTER TABLE `' + t + '` AUTO_INCREMENT = ' + m.next);
          console.log('  ✓ ' + t + '.id AUTO_INCREMENT 자가 복구 (시작값=' + m.next + ')');
        }
      } catch (e) {
        console.warn('⚠ AI 가드 경고(' + t + '):', e.message);
      }
    }

    // ── DB 스키마 변경 이력 테이블 ────────────────────────
    await pool.query(`CREATE TABLE IF NOT EXISTS schema_change_log (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      change_type   VARCHAR(20)  NOT NULL,        -- new_table/drop_table/add_col/drop_col/mod_col
      table_name    VARCHAR(100) NOT NULL,
      column_name   VARCHAR(100) DEFAULT NULL,
      risk          VARCHAR(10)  DEFAULT 'LOW',   -- LOW/MEDIUM/HIGH
      message       VARCHAR(500) NOT NULL,
      mitigation    TEXT         DEFAULT NULL,
      before_def    VARCHAR(500) DEFAULT NULL,
      after_def     VARCHAR(500) DEFAULT NULL,
      detected_by   INT          DEFAULT NULL,    -- user id
      changed_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_changed_at (changed_at DESC),
      INDEX idx_table      (table_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // ── 파이프라인 단계 정의 테이블 (사용자 정의) ─────────
    await pool.query(`CREATE TABLE IF NOT EXISTS pipeline_stages (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      stage_key    VARCHAR(50)  NOT NULL UNIQUE,        -- DB 저장 키 (불변)
      label        VARCHAR(100) NOT NULL,                -- 사용자 표시명 (변경 가능)
      role         VARCHAR(20)  NOT NULL DEFAULT 'active',  -- active/won/lost/dropped
      sort_order   INT          NOT NULL DEFAULT 0,
      color        VARCHAR(20)  DEFAULT '#93B4F9',
      is_active    TINYINT(1)   DEFAULT 1,
      created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_sort (sort_order, is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // 기본 시드 (idempotent — stage_key UNIQUE)
    const defaultStages = [
      { key: 'lead', label: '리드 발굴', role: 'active', order: 10, color: '#93B4F9' },
      { key: 'review', label: '검토/미팅', role: 'active', order: 20, color: '#5585F5' },
      { key: 'proposal', label: '제안/견적', role: 'active', order: 30, color: '#2357E8' },
      { key: 'bidding', label: '입찰', role: 'active', order: 40, color: '#F59C00' },
      { key: 'negotiation', label: '협상/계약', role: 'active', order: 50, color: '#17A85A' },
      { key: 'won', label: '수주 완료', role: 'won', order: 90, color: '#0F7A3F' },
      { key: 'lost', label: '실주', role: 'lost', order: 95, color: '#6B7280' },
      { key: 'dropped', label: '드롭', role: 'dropped', order: 99, color: '#E63329' },
    ];
    for (const s of defaultStages) {
      await pool.query(
        `INSERT IGNORE INTO pipeline_stages (stage_key, label, role, sort_order, color)
         VALUES (?,?,?,?,?)`,
        [s.key, s.label, s.role, s.order, s.color]
      );
    }

    // ── leads.stage ENUM → VARCHAR 마이그레이션 (idempotent) ──
    // ENUM은 단계 추가/삭제 불가 → VARCHAR로 변환하여 자유로운 stage_key 허용
    try {
      const [colInfo] = await pool.query("SHOW COLUMNS FROM leads WHERE Field='stage'");
      const colType = colInfo[0]?.Type || '';
      if (/enum/i.test(colType)) {
        await pool.query(`ALTER TABLE leads MODIFY stage VARCHAR(50) DEFAULT 'lead'`);
        console.log('  ✓ leads.stage ENUM → VARCHAR(50) 마이그레이션 완료');
      }
    } catch (e) {
      console.warn('⚠ leads.stage 마이그레이션:', e.message);
    }

    // ── 환율 시계열 캐시 테이블 ──────────────────────────
    // 수출입은행(primary) + frankfurter(fallback) 통합 캐시
    await pool.query(`CREATE TABLE IF NOT EXISTS exchange_rates (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      currency_code VARCHAR(3)    NOT NULL,
      rate_to_krw   DECIMAL(15,4) NOT NULL,
      source        VARCHAR(20)   NOT NULL,         -- 'exim' | 'frankfurter' | 'manual'
      rate_date     DATE          NOT NULL,
      fetched_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_curr_date (currency_code, rate_date),
      INDEX idx_curr_latest (currency_code, rate_date DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // KRW=1 시드 (idempotent)
    await pool.query(`INSERT IGNORE INTO exchange_rates (currency_code, rate_to_krw, source, rate_date)
                      VALUES ('KRW', 1, 'manual', CURRENT_DATE)`);

    // ── leads 통화 환산 확장 컬럼 (idempotent) ─────────
    const leadsFxCols = [
      `ALTER TABLE leads ADD COLUMN IF NOT EXISTS amount_krw     DECIMAL(20,2) DEFAULT NULL`,
      `ALTER TABLE leads ADD COLUMN IF NOT EXISTS fx_rate        DECIMAL(15,4) DEFAULT NULL`,
      `ALTER TABLE leads ADD COLUMN IF NOT EXISTS fx_locked_at   TIMESTAMP    NULL DEFAULT NULL`,
      `ALTER TABLE leads ADD COLUMN IF NOT EXISTS fx_lock_policy VARCHAR(20)  DEFAULT 'live'`,
    ];
    for (const sql of leadsFxCols) {
      try {
        await pool.query(sql);
      } catch (e) {
        if (!String(e.message).includes('Duplicate')) console.warn('⚠ FX 컬럼:', e.message);
      }
    }

    // ── 고객사 AI 브리핑 캐시 + 이력 테이블 ──────────────
    await pool.query(`CREATE TABLE IF NOT EXISTS customer_briefs (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      customer_id   INT          NOT NULL,
      headline      VARCHAR(255) DEFAULT NULL,
      key_points    TEXT         DEFAULT NULL,        -- JSON array
      next_action   VARCHAR(255) DEFAULT NULL,
      risk          VARCHAR(500) DEFAULT NULL,
      stats         TEXT         DEFAULT NULL,        -- JSON object
      generated_by  INT          DEFAULT NULL,
      generated_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_cust_gen (customer_id, generated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // ── 사용자 인증 테이블 ──────────────────────────────
    await pool.query(`CREATE TABLE IF NOT EXISTS users (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      username         VARCHAR(50) UNIQUE NOT NULL,
      email            VARCHAR(100) UNIQUE,
      password_hash    VARCHAR(255) NOT NULL,
      full_name        VARCHAR(100),
      role             ENUM('manager','team_lead','executive','superadmin') DEFAULT 'manager',
      is_active        TINYINT(1) DEFAULT 1,
      otp_secret       VARCHAR(100),
      otp_enabled      TINYINT(1) DEFAULT 0,
      webauthn_cred_id VARCHAR(500),
      last_login       DATETIME,
      department       VARCHAR(100),
      avatar_url       VARCHAR(255),
      created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_username (username),
      INDEX idx_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // 기본 superadmin 계정 생성 (없을 때만)
    const [[adminExists]] = await pool.query(
      `SELECT id FROM users WHERE username = 'admin' LIMIT 1`
    );
    if (!adminExists) {
      const bcrypt = require('bcryptjs');
      const hash = await bcrypt.hash('admin1234!', 12);
      await pool.query(
        `INSERT INTO users (username, email, full_name, password_hash, role)
         VALUES ('admin', 'admin@oci.com', 'IT운영 관리자', ?, 'superadmin')`,
        [hash]
      );
      console.log('✅ 기본 관리자 계정 생성: admin / admin1234!');
    }

    // ── JWT 보안: Refresh Token 관리 테이블 ─────────────────
    await pool.query(`CREATE TABLE IF NOT EXISTS refresh_tokens (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      user_id     INT NOT NULL,
      token_hash  VARCHAR(255) NOT NULL,         -- bcrypt 해시 (원문 미저장)
      jti         VARCHAR(36)  NOT NULL,         -- 연결된 access token JTI
      user_agent  VARCHAR(500),
      ip          VARCHAR(45),
      expires_at  DATETIME NOT NULL,
      revoked     TINYINT(1) DEFAULT 0,
      revoked_at  DATETIME,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user    (user_id),
      INDEX idx_jti     (jti),
      INDEX idx_expires (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // ── JWT 보안: 즉시 무효화 블랙리스트 ────────────────────
    await pool.query(`CREATE TABLE IF NOT EXISTS token_blacklist (
      jti        VARCHAR(36) PRIMARY KEY,
      user_id    INT NOT NULL,
      expires_at DATETIME NOT NULL,            -- 이 시각 이후 자동 정리 가능
      reason     VARCHAR(50) DEFAULT 'logout',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_expires (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // ── 개발자 옵션: 기능 플래그 테이블 ─────────────────────────
    await pool.query(`CREATE TABLE IF NOT EXISTS dev_features (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      feature_key VARCHAR(100) NOT NULL UNIQUE,
      feature_name VARCHAR(200) NOT NULL,
      description TEXT,
      category    VARCHAR(50) DEFAULT 'general',
      is_enabled  TINYINT(1)  DEFAULT 1,
      is_experimental TINYINT(1) DEFAULT 0,
      affects_routes  VARCHAR(500),
      affects_tables  VARCHAR(500),
      updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);

    // 기본 기능 플래그 시드 데이터 (중복 무시)
    await pool.query(`INSERT IGNORE INTO dev_features
      (feature_key, feature_name, description, category, affects_routes, affects_tables, is_experimental) VALUES
      ('ai.assistant',    'AI 어시스턴트 채팅',    'Gemini 기반 AI 채팅 및 보고서 자동 생성', 'ai', '/api/ai', 'ai_usage', 0),
      ('ai.ocr',          '명함 OCR 인식',         'Google Vision AI 기반 명함 자동 파싱',    'ai', '/api/customers/ocr', 'customers', 0),
      ('ai.intelligence', '고객사 AI 인텔리전스',   '고객사별 영업 전략 AI 분석 리포트',       'ai', '/api/customers/:id/intelligence', 'customers', 0),
      ('ai.lead_summary', '리드 AI 요약',           '리드 활동 이력 AI 자동 요약',             'ai', '/api/ai/summarize-lead', 'leads,activities', 0),
      ('ai.meeting',      '회의록 AI 분석',         '음성 녹음 STT + AI 회의록 자동 작성',    'ai', '/api/meeting', 'meeting_minutes', 0),
      ('auth.google',     'Google OAuth 로그인',    'Google 계정 소셜 로그인 연동',            'auth', '/api/google', 'google_oauth_tokens', 0),
      ('auth.otp',        'OTP 2차 인증 (TOTP)',    'Google Authenticator 기반 TOTP 인증',    'auth', '/api/auth/setup-otp', 'users', 0),
      ('auth.biometric',  '생체인증 (WebAuthn)',     'Fingerprint/FaceID 로그인',              'auth', '/api/auth/bio', 'users', 1),
      ('realtime.ws',     'WebSocket 실시간 알림',  '리드 변경사항 브라우저 푸시 알림',        'realtime', '', '', 0),
      ('crm.pipeline',    '파이프라인 칸반보드',    '드래그앤드롭 영업 단계 관리',             'crm', '/api/leads', 'leads', 0),
      ('crm.calendar',    '영업 캘린더',            '일정 등록 및 활동 연동',                  'crm', '/api/calendar', 'calendar_events', 0),
      ('crm.board',       '커뮤니케이션 게시판',    '팀 공지·자유게시판·FAQ',                  'crm', '/api/board', 'announcements,comments,faq,announcement_views', 0),
      ('crm.meeting_rec', '회의록 Google Meet 연동','Google Meet 연결 및 회의록 연동',         'crm', '/api/meeting', 'meeting_minutes,google_meet_sessions', 0),
      ('erp.integration', 'ERP 연동 (OnERP/가온아이)','외부 ERP 시스템 데이터 동기화',         'integration', '/api/products/erp', 'products,cost_history', 1),
      ('data.excel_exp',  '엑셀 내보내기',          '테이블 데이터 Excel 파일 다운로드',       'data', '', '', 0),
      ('data.excel_imp',  '엑셀 가져오기',          'Excel 파일로 데이터 일괄 등록',           'data', '', '', 0),
      ('data.bulk_paste', 'Copy & Paste 일괄 등록', '엑셀 복붙으로 빠른 데이터 등록',          'data', '', '', 0),
      ('security.rate_limit','API Rate Limiting',   '분당 요청 수 제한으로 DDoS 방어',         'security', '', '', 0),
      ('security.csp',    'Content Security Policy','XSS 방어 CSP 헤더 적용',                  'security', '', '', 0),
      ('security.encrypt','토큰/OTP 암호화 저장',   'AES-256-GCM 기반 민감정보 암호화',        'security', '', 'users,google_oauth_tokens', 0),
      ('dev.options',     '개발자 옵션 패널',       '이 화면 자체 (superadmin 전용)',           'dev', '/api/admin/dev', 'dev_features', 0)
    `);

    console.log('✅ DB 확장 테이블 + 인덱스 초기화 완료');
  } catch (err) {
    console.error('❌ DB 초기화 오류:', err.message);
  }
}

module.exports = { initTables };
