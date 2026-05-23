'use strict';
// =============================================================
// /api/contracts — 계약관리 모듈 (Phase 0: 기반 인프라)
//
// 기능:
//   - 계약 CRUD + 자동채번 C-YYYY-NNNN
//   - 다중 파일 업로드 / 다운로드 / 삭제 (proposals 패턴 재사용)
//   - contract_history 자동 기록 (Audit Trail — Phase 1 에서 강화)
//   - leads/customers/proposals 연결 (선택)
//
// 권한: 기본 인증 (manager+) — autoLevel 미적용
// 기능 플래그: crm.contracts
//
// 엔드포인트 (Phase 0):
//   GET    /next-contract-no  — 다음 자동 채번 미리보기
//   GET    /                  — 목록 (페이징, 필터)
//   GET    /:id               — 단건 (files + history 포함)
//   POST   /                  — 생성
//   PUT    /:id               — 수정 (diff history 자동 기록)
//   DELETE /:id               — 삭제 (CASCADE)
//   POST   /:id/files         — 파일 업로드 (다중)
//   GET    /:id/files/:fileId/download — 다운로드
//   DELETE /:id/files/:fileId — 파일 삭제
//
// Phase 1+ 추가 예정:
//   PATCH  /:id/status              (CLM 워크플로우)
//   POST   /:id/files/:fileId/review (AI 법무 검토)
//   GET    /templates / POST /templates (계약 템플릿)
//   GET    /alerts (만료 알림 큐)
// =============================================================

const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { getUserId } = require('../middleware/auth');
const { requireFeature } = require('../middleware/featureGuard');
const { parsePage, pageResult } = require('../utils/routeHelper');

router.use(requireFeature('crm.contracts'));

// ── 파일 업로드 인프라 (proposals 패턴 동일) ──────────────────
// 저장 경로: public/uploads/contracts/{contract_id}/{timestamp}_{sanitized}.ext
const CONTRACT_UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'contracts');
if (!fs.existsSync(CONTRACT_UPLOAD_DIR)) fs.mkdirSync(CONTRACT_UPLOAD_DIR, { recursive: true });
const ALLOWED_EXT = /\.(pdf|ppt|pptx|doc|docx|xls|xlsx|png|jpe?g|hwp|hwpx|txt|md)$/i;
const ALLOWED_FILE_TYPES = ['contract', 'draft', 'signed', 'amendment', 'attachment', 'etc'];

function sanitizeFilename(name) {
  return String(name || 'file')
    .replace(/[\\/:*?"<>|-]/g, '_')
    .replace(/\.{2,}/g, '.')
    .slice(0, 200);
}

function decodeOriginalName(originalname) {
  if (!originalname) return 'file';
  try {
    return Buffer.from(originalname, 'latin1').toString('utf8');
  } catch (_) {
    return originalname;
  }
}

function toYMD(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const contractUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const contractId = parseInt(req.params.id, 10);
      if (!contractId) return cb(new Error('contract_id 누락'));
      const dir = path.join(CONTRACT_UPLOAD_DIR, String(contractId));
      try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      } catch (e) {
        cb(e);
      }
    },
    filename: (req, file, cb) => {
      const decoded = decodeOriginalName(file.originalname);
      const safe = sanitizeFilename(decoded);
      const ts = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      cb(null, `${ts}_${safe}`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ALLOWED_EXT.test(file.originalname);
    cb(null, ok);
  },
});

const uploadMixed = contractUpload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'files', maxCount: 10 },
]);

function collectFiles(req) {
  if (!req.files) return [];
  if (Array.isArray(req.files)) return req.files;
  return [...(req.files.file || []), ...(req.files.files || [])];
}

// ── 자가 마이그레이션 (idempotent) — Phase 0 6개 테이블 ─────
async function ensureSchema() {
  try {
    // ① 메인: contracts
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contracts (
        id                    INT AUTO_INCREMENT PRIMARY KEY,
        contract_no           VARCHAR(50) UNIQUE NOT NULL,
        title                 VARCHAR(300) NOT NULL,
        customer_id           INT NULL,
        customer_name         VARCHAR(200) NULL,
        proposal_id           INT NULL,
        lead_id               INT NULL,
        contract_type         VARCHAR(50) DEFAULT 'etc',
        status                VARCHAR(30) DEFAULT 'draft',
        start_date            DATE NULL,
        end_date              DATE NULL,
        contract_amount       DECIMAL(20,2) NULL,
        currency              VARCHAR(10) DEFAULT 'KRW',
        language              VARCHAR(10) DEFAULT 'ko',
        auto_renewal          TINYINT(1) DEFAULT 0,
        renewal_notice_days   INT DEFAULT 30,
        legal_review_score    INT NULL,
        ai_review_summary     MEDIUMTEXT NULL,
        template_id           INT NULL,
        version_no            INT DEFAULT 1,
        parent_contract_id    INT NULL,
        esign_provider        VARCHAR(20) NULL,
        esign_request_id      VARCHAR(100) NULL,
        esign_status          VARCHAR(20) NULL,
        owner_id              INT NULL,
        owner_name            VARCHAR(100) NULL,
        notes                 TEXT NULL,
        created_by            INT NULL,
        created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_contract_no     (contract_no),
        INDEX idx_customer_id     (customer_id),
        INDEX idx_proposal_id     (proposal_id),
        INDEX idx_lead_id         (lead_id),
        INDEX idx_status          (status),
        INDEX idx_end_date        (end_date),
        INDEX idx_parent_contract (parent_contract_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // ② 파일: contract_files
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contract_files (
        id                 INT AUTO_INCREMENT PRIMARY KEY,
        contract_id        INT NOT NULL,
        file_type          VARCHAR(50) DEFAULT 'contract',
        original_filename  VARCHAR(300) NOT NULL,
        stored_filename    VARCHAR(300) NOT NULL,
        file_path          VARCHAR(500) NOT NULL,
        mime_type          VARCHAR(100) NULL,
        file_size          BIGINT NULL,
        version_no         INT DEFAULT 1,
        is_final           TINYINT(1) DEFAULT 0,
        description        TEXT NULL,
        uploaded_by        INT NULL,
        created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_contract_type (contract_id, file_type),
        CONSTRAINT fk_cf_contract FOREIGN KEY (contract_id)
          REFERENCES contracts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // ③ 감사: contract_history
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contract_history (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        contract_id  INT NOT NULL,
        action_type  VARCHAR(50) NOT NULL,
        field_name   VARCHAR(100) NULL,
        old_value    TEXT NULL,
        new_value    TEXT NULL,
        description  TEXT NULL,
        created_by   INT NULL,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_contract_created (contract_id, created_at),
        INDEX idx_action (action_type),
        CONSTRAINT fk_ch_contract FOREIGN KEY (contract_id)
          REFERENCES contracts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // ④ 템플릿: contract_templates (Phase 3 에서 사용 시작)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contract_templates (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        template_code   VARCHAR(50) UNIQUE,
        name            VARCHAR(255) NOT NULL,
        contract_type   VARCHAR(50) DEFAULT 'etc',
        language        VARCHAR(10) DEFAULT 'ko',
        body_md         MEDIUMTEXT NULL,
        variables_json  TEXT NULL,
        version_no      INT DEFAULT 1,
        is_active       TINYINT(1) DEFAULT 1,
        created_by      INT NULL,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_type_active (contract_type, is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // ⑤ AI 법무 검토 결과: contract_legal_reviews (Phase 2 에서 사용 시작)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contract_legal_reviews (
        id                          INT AUTO_INCREMENT PRIMARY KEY,
        contract_id                 INT NOT NULL,
        target_file_id              INT NULL,
        review_score                INT NULL,
        risk_level                  VARCHAR(10) NULL,
        toxic_clauses_json          MEDIUMTEXT NULL,
        missing_clauses_json        MEDIUMTEXT NULL,
        legal_compliance_json       MEDIUMTEXT NULL,
        improvement_suggestions_json MEDIUMTEXT NULL,
        overall_assessment          MEDIUMTEXT NULL,
        language                    VARCHAR(10) DEFAULT 'ko',
        generated_by                INT NULL,
        generated_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_contract_gen (contract_id, generated_at),
        CONSTRAINT fk_clr_contract FOREIGN KEY (contract_id)
          REFERENCES contracts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // ⑥ 알림 큐: contract_alerts (Phase 4 에서 사용 시작)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contract_alerts (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        contract_id   INT NOT NULL,
        alert_type    VARCHAR(30) NOT NULL,
        scheduled_for DATE NOT NULL,
        sent_at       DATETIME NULL,
        status        VARCHAR(20) DEFAULT 'pending',
        channel       VARCHAR(20) DEFAULT 'inapp',
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_status_scheduled (status, scheduled_for),
        INDEX idx_contract (contract_id),
        CONSTRAINT fk_ca_contract FOREIGN KEY (contract_id)
          REFERENCES contracts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  } catch (e) {
    // FK 생성 실패 시 fallback — FK 없이 재시도
    console.warn('[contracts:migration] FK 생성 실패 → fallback:', e.message);
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS contract_files (
          id INT AUTO_INCREMENT PRIMARY KEY, contract_id INT NOT NULL,
          file_type VARCHAR(50) DEFAULT 'contract',
          original_filename VARCHAR(300) NOT NULL, stored_filename VARCHAR(300) NOT NULL,
          file_path VARCHAR(500) NOT NULL, mime_type VARCHAR(100) NULL,
          file_size BIGINT NULL, version_no INT DEFAULT 1,
          is_final TINYINT(1) DEFAULT 0, description TEXT NULL,
          uploaded_by INT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_contract_type (contract_id, file_type)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS contract_history (
          id INT AUTO_INCREMENT PRIMARY KEY, contract_id INT NOT NULL,
          action_type VARCHAR(50) NOT NULL, field_name VARCHAR(100) NULL,
          old_value TEXT NULL, new_value TEXT NULL, description TEXT NULL,
          created_by INT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_contract_created (contract_id, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS contract_legal_reviews (
          id INT AUTO_INCREMENT PRIMARY KEY, contract_id INT NOT NULL,
          target_file_id INT NULL, review_score INT NULL, risk_level VARCHAR(10) NULL,
          toxic_clauses_json MEDIUMTEXT NULL, missing_clauses_json MEDIUMTEXT NULL,
          legal_compliance_json MEDIUMTEXT NULL, improvement_suggestions_json MEDIUMTEXT NULL,
          overall_assessment MEDIUMTEXT NULL, language VARCHAR(10) DEFAULT 'ko',
          generated_by INT NULL, generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_contract_gen (contract_id, generated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS contract_alerts (
          id INT AUTO_INCREMENT PRIMARY KEY, contract_id INT NOT NULL,
          alert_type VARCHAR(30) NOT NULL, scheduled_for DATE NOT NULL,
          sent_at DATETIME NULL, status VARCHAR(20) DEFAULT 'pending',
          channel VARCHAR(20) DEFAULT 'inapp',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_status_scheduled (status, scheduled_for)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch (_) {
      /* 이미 존재 — 무시 */
    }
  }
}
const _migrationPromise = ensureSchema();

router.use(async (req, res, next) => {
  try {
    await _migrationPromise;
    next();
  } catch (err) {
    next(err);
  }
});

// ── 자동채번 헬퍼 (C-YYYY-NNNN) ─────────────────────────────
async function generateContractNo(conn, year) {
  const yyyy = year || new Date().getFullYear();
  const prefix = `C-${yyyy}-`;
  const [[row]] = await conn.query(
    `SELECT contract_no FROM contracts
      WHERE contract_no LIKE ?
      ORDER BY contract_no DESC LIMIT 1`,
    [`${prefix}%`]
  );
  let next = 1;
  if (row && row.contract_no) {
    const m = row.contract_no.match(/C-\d{4}-(\d+)/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return prefix + String(next).padStart(4, '0');
}

// ── history 자동 기록 ──────────────────────────────────────
async function logHistory(conn, contractId, userId, actionType, opts = {}) {
  try {
    await (conn || pool).query(
      `INSERT INTO contract_history
        (contract_id, action_type, field_name, old_value, new_value, description, created_by)
       VALUES (?,?,?,?,?,?,?)`,
      [
        contractId,
        String(actionType).slice(0, 50),
        opts.fieldName ? String(opts.fieldName).slice(0, 100) : null,
        opts.oldValue !== undefined && opts.oldValue !== null
          ? String(opts.oldValue).slice(0, 65000)
          : null,
        opts.newValue !== undefined && opts.newValue !== null
          ? String(opts.newValue).slice(0, 65000)
          : null,
        opts.description ? String(opts.description).slice(0, 65000) : null,
        userId || null,
      ]
    );
  } catch (e) {
    console.warn('[contracts:history] log failed:', e.message);
  }
}

// 허용 상태값 (CLM 워크플로우 — Phase 1 에서 전이 검증 추가)
const ALLOWED_STATUS = [
  'draft', // 초안
  'review', // 검토중
  'negotiation', // 협상중
  'signing', // 서명 진행
  'active', // 발효
  'renewal', // 갱신중
  'expired', // 만료
  'terminated', // 해지
];

const ALLOWED_CONTRACT_TYPES = [
  'NDA', // 비밀유지계약
  'MSA', // 기본거래계약
  'SLA', // 서비스수준계약
  'SOW', // 작업기술서
  'service', // 용역계약
  'purchase', // 구매계약
  'license', // 라이선스
  'employment', // 고용계약
  'etc', // 기타
];

// ── GET /next-contract-no — 다음 자동 채번 미리보기 ─────────
// ⚠️ /:id 보다 먼저 선언
router.get('/next-contract-no', async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const conn = await pool.getConnection();
    try {
      const next = await generateContractNo(conn, year);
      res.json({ success: true, data: { contract_no: next, year } });
    } finally {
      conn.release();
    }
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET / — 목록 (페이징 + 필터) ─────────────────────────────
router.get('/', async (req, res) => {
  try {
    const {
      search,
      status,
      contract_type,
      customer_id,
      proposal_id,
      lead_id,
      date_from,
      date_to,
      expiring_soon,
    } = req.query;
    const { page, limit, offset } = parsePage(req.query);

    let where = 'WHERE 1=1';
    const params = [];
    if (search) {
      where += ' AND (c.title LIKE ? OR c.contract_no LIKE ? OR c.customer_name LIKE ?)';
      const k = `%${search}%`;
      params.push(k, k, k);
    }
    if (status) {
      where += ' AND c.status = ?';
      params.push(status);
    }
    if (contract_type) {
      where += ' AND c.contract_type = ?';
      params.push(contract_type);
    }
    if (customer_id) {
      where += ' AND c.customer_id = ?';
      params.push(parseInt(customer_id, 10));
    }
    if (proposal_id) {
      where += ' AND c.proposal_id = ?';
      params.push(parseInt(proposal_id, 10));
    }
    if (lead_id) {
      where += ' AND c.lead_id = ?';
      params.push(parseInt(lead_id, 10));
    }
    if (date_from) {
      where += ' AND c.start_date >= ?';
      params.push(date_from);
    }
    if (date_to) {
      where += ' AND c.start_date <= ?';
      params.push(date_to);
    }
    // 만료 임박 (status=active 이면서 end_date 가 30일 이내)
    if (expiring_soon === '1' || expiring_soon === 'true') {
      where +=
        " AND c.status = 'active' AND c.end_date IS NOT NULL" +
        ' AND c.end_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)';
    }

    const [[countRow], [rows]] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM contracts c ${where}`, params),
      pool.query(
        `SELECT c.id, c.contract_no, c.title, c.customer_id, c.customer_name,
                c.proposal_id, c.lead_id, c.contract_type, c.status,
                c.start_date, c.end_date, c.contract_amount, c.currency,
                c.auto_renewal, c.renewal_notice_days,
                c.legal_review_score, c.version_no, c.owner_id, c.owner_name,
                c.created_at, c.updated_at,
                tm.name AS created_by_name,
                (SELECT COUNT(*) FROM contract_files cf WHERE cf.contract_id = c.id) AS file_count
           FROM contracts c
           LEFT JOIN team_members tm ON tm.id = c.created_by
           ${where}
          ORDER BY c.created_at DESC
          LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ),
    ]);
    const total = Number(countRow[0]?.total ?? 0);
    res.json(pageResult(rows, total, page, limit));
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET /:id — 단건 + files + history ────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });

    const [[contract]] = await pool.query(
      `SELECT c.*, tm.name AS created_by_name
         FROM contracts c
         LEFT JOIN team_members tm ON tm.id = c.created_by
        WHERE c.id = ?`,
      [id]
    );
    if (!contract) return res.status(404).json({ success: false, error: '계약을 찾을 수 없음' });

    const [[files], [history]] = await Promise.all([
      pool.query(`SELECT * FROM contract_files WHERE contract_id = ? ORDER BY created_at DESC`, [
        id,
      ]),
      pool.query(
        `SELECT ch.*, tm.name AS created_by_name
           FROM contract_history ch
           LEFT JOIN team_members tm ON tm.id = ch.created_by
          WHERE ch.contract_id = ? ORDER BY ch.created_at DESC LIMIT 200`,
        [id]
      ),
    ]);

    contract.files = files;
    contract.history = history;
    res.json({ success: true, data: contract });
  } catch (err) {
    handleError(res, err);
  }
});

// ── POST / — 생성 ───────────────────────────────────────────
router.post('/', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const userId = getUserId(req);
    const body = req.body || {};

    if (!body.title || !String(body.title).trim()) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: '계약명(title)이 필요합니다' });
    }

    // 연결: proposal_id 자동 반영
    let customerName = body.customer_name || null;
    let customerId = body.customer_id || null;
    let contractAmount = body.contract_amount;
    let currency = body.currency || 'KRW';
    if (body.proposal_id) {
      const [[prop]] = await conn.query(
        `SELECT customer_id, customer_name, expected_amount, currency
           FROM proposals WHERE id = ?`,
        [body.proposal_id]
      );
      if (prop) {
        if (!customerId) customerId = prop.customer_id || null;
        if (!customerName) customerName = prop.customer_name || null;
        if (contractAmount === undefined || contractAmount === null) {
          contractAmount = prop.expected_amount || null;
        }
        if (!body.currency && prop.currency) currency = prop.currency;
      }
    }
    if (body.lead_id && !customerId) {
      const [[lead]] = await conn.query(
        `SELECT customer_id, customer_name FROM leads WHERE id = ?`,
        [body.lead_id]
      );
      if (lead) {
        customerId = lead.customer_id || null;
        if (!customerName) customerName = lead.customer_name || null;
      }
    }

    const startDate = toYMD(body.start_date);
    const endDate = toYMD(body.end_date);

    // 자동 채번 (수동 입력 가능)
    const year = startDate ? new Date(startDate).getFullYear() : new Date().getFullYear();
    let contractNo = body.contract_no && String(body.contract_no).trim();
    if (!contractNo) contractNo = await generateContractNo(conn, year);

    const status = body.status && ALLOWED_STATUS.includes(body.status) ? body.status : 'draft';
    const contractType =
      body.contract_type && ALLOWED_CONTRACT_TYPES.includes(body.contract_type)
        ? body.contract_type
        : 'etc';

    let ownerName = body.owner_name || null;
    if (body.owner_id && !ownerName) {
      const [[tm]] = await conn.query(`SELECT name FROM team_members WHERE id = ?`, [
        body.owner_id,
      ]);
      ownerName = tm?.name || null;
    }

    const [result] = await conn.query(
      `INSERT INTO contracts
        (contract_no, title, customer_id, customer_name,
         proposal_id, lead_id, contract_type, status,
         start_date, end_date, contract_amount, currency, language,
         auto_renewal, renewal_notice_days,
         template_id, version_no, parent_contract_id,
         owner_id, owner_name, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        contractNo,
        String(body.title).slice(0, 300),
        customerId || null,
        customerName ? String(customerName).slice(0, 200) : null,
        body.proposal_id || null,
        body.lead_id || null,
        contractType,
        status,
        startDate,
        endDate,
        contractAmount || null,
        currency,
        body.language || 'ko',
        body.auto_renewal ? 1 : 0,
        Number(body.renewal_notice_days) || 30,
        body.template_id || null,
        Number(body.version_no) || 1,
        body.parent_contract_id || null,
        body.owner_id || null,
        ownerName,
        body.notes || null,
        userId || null,
      ]
    );
    const contractId = result.insertId;
    await logHistory(conn, contractId, userId, 'create', {
      description: `계약 생성: ${contractNo} (${body.title})`,
    });

    await conn.commit();
    res.json({
      success: true,
      id: contractId,
      data: { id: contractId, contract_no: contractNo },
    });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: '계약번호가 이미 존재합니다' });
    }
    handleError(res, err);
  } finally {
    conn.release();
  }
});

// ── PUT /:id — 수정 (diff history 자동 기록) ─────────────────
router.put('/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const id = parseInt(req.params.id, 10);
    if (!id) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    }
    const userId = getUserId(req);
    const body = req.body || {};

    const [[prev]] = await conn.query(`SELECT * FROM contracts WHERE id = ?`, [id]);
    if (!prev) {
      await conn.rollback();
      return res.status(404).json({ success: false, error: '계약을 찾을 수 없음' });
    }

    const fields = [];
    const values = [];
    const allowed = [
      'title',
      'customer_id',
      'customer_name',
      'proposal_id',
      'lead_id',
      'contract_type',
      'status',
      'start_date',
      'end_date',
      'contract_amount',
      'currency',
      'language',
      'auto_renewal',
      'renewal_notice_days',
      'template_id',
      'version_no',
      'parent_contract_id',
      'owner_id',
      'owner_name',
      'notes',
    ];
    const DATE_FIELDS = new Set(['start_date', 'end_date']);
    const BOOL_FIELDS = new Set(['auto_renewal']);
    for (const f of allowed) {
      if (body[f] === undefined) continue;
      if (f === 'status' && !ALLOWED_STATUS.includes(body[f])) {
        await conn.rollback();
        return res.status(400).json({ success: false, error: '유효하지 않은 상태값' });
      }
      if (f === 'contract_type' && body[f] && !ALLOWED_CONTRACT_TYPES.includes(body[f])) {
        await conn.rollback();
        return res.status(400).json({ success: false, error: '유효하지 않은 계약 유형' });
      }
      let v = body[f];
      if (DATE_FIELDS.has(f)) v = toYMD(v);
      if (BOOL_FIELDS.has(f)) v = v ? 1 : 0;
      fields.push(`${f} = ?`);
      values.push(v);
    }

    if (fields.length === 0) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: '수정할 항목이 없습니다' });
    }

    values.push(id);
    await conn.query(`UPDATE contracts SET ${fields.join(', ')} WHERE id = ?`, values);

    // diff history (값이 실제로 바뀐 필드만)
    for (const f of allowed) {
      if (body[f] === undefined) continue;
      const oldV = prev[f];
      let newV = body[f];
      if (DATE_FIELDS.has(f)) newV = toYMD(newV);
      if (BOOL_FIELDS.has(f)) newV = newV ? 1 : 0;
      // 단순 비교 (null/string/number 모두 String 으로 비교)
      const ov = oldV === null || oldV === undefined ? '' : String(oldV);
      const nv = newV === null || newV === undefined ? '' : String(newV);
      if (ov !== nv) {
        await logHistory(conn, id, userId, f === 'status' ? 'status_change' : 'update', {
          fieldName: f,
          oldValue: ov,
          newValue: nv,
        });
      }
    }

    await conn.commit();
    res.json({ success: true, data: { id } });
  } catch (err) {
    await conn.rollback();
    handleError(res, err);
  } finally {
    conn.release();
  }
});

// ── DELETE /:id — 삭제 (CASCADE) ────────────────────────────
router.delete('/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });

    // 파일들 디스크에서도 정리
    const [files] = await conn.query(`SELECT file_path FROM contract_files WHERE contract_id = ?`, [
      id,
    ]);
    for (const f of files) {
      try {
        if (f.file_path && fs.existsSync(f.file_path)) fs.unlinkSync(f.file_path);
      } catch (e) {
        console.warn('[contracts:delete] 파일 삭제 실패:', e.message);
      }
    }
    // 계약 디렉토리 자체도 정리 (best-effort)
    try {
      const dir = path.join(CONTRACT_UPLOAD_DIR, String(id));
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {
      /* 무시 */
    }

    const [result] = await conn.query(`DELETE FROM contracts WHERE id = ?`, [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: '계약을 찾을 수 없음' });
    }
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  } finally {
    conn.release();
  }
});

// ── POST /:id/files — 파일 업로드 (다중) ─────────────────────
router.post('/:id/files', uploadMixed, async (req, res) => {
  try {
    const contractId = parseInt(req.params.id, 10);
    if (!contractId) return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    const userId = getUserId(req);

    const [[contract]] = await pool.query(`SELECT id FROM contracts WHERE id = ?`, [contractId]);
    if (!contract) return res.status(404).json({ success: false, error: '계약을 찾을 수 없음' });

    const files = collectFiles(req);
    if (!files.length) return res.status(400).json({ success: false, error: '파일이 없습니다' });

    const fileType =
      req.body.file_type && ALLOWED_FILE_TYPES.includes(req.body.file_type)
        ? req.body.file_type
        : 'contract';
    const versionNo = parseInt(req.body.version_no, 10) || 1;
    const isFinal = req.body.is_final === '1' || req.body.is_final === 'true' ? 1 : 0;
    const description = req.body.description || null;

    const uploaded = [];
    const failed = [];
    for (const file of files) {
      try {
        const decoded = decodeOriginalName(file.originalname);
        const [r] = await pool.query(
          `INSERT INTO contract_files
            (contract_id, file_type, original_filename, stored_filename, file_path,
             mime_type, file_size, version_no, is_final, description, uploaded_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [
            contractId,
            fileType,
            decoded,
            file.filename,
            file.path,
            file.mimetype || null,
            file.size || null,
            versionNo,
            isFinal,
            description,
            userId || null,
          ]
        );
        uploaded.push({
          id: r.insertId,
          original_filename: decoded,
          file_type: fileType,
          file_size: file.size,
        });
        await logHistory(null, contractId, userId, 'file_upload', {
          description: `파일 업로드: ${decoded} (${fileType})`,
          newValue: decoded,
        });
      } catch (e) {
        failed.push({ original_filename: decodeOriginalName(file.originalname), error: e.message });
        // 실패 시 디스크 파일 정리
        try {
          if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
        } catch (_) {
          /* 무시 */
        }
      }
    }

    res.json({ success: true, data: { uploaded, failed } });
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET /:id/files/:fileId/download — 다운로드 ───────────────
router.get('/:id/files/:fileId/download', async (req, res) => {
  try {
    const contractId = parseInt(req.params.id, 10);
    const fileId = parseInt(req.params.fileId, 10);
    if (!contractId || !fileId) {
      return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    }

    const [[file]] = await pool.query(
      `SELECT * FROM contract_files WHERE id = ? AND contract_id = ?`,
      [fileId, contractId]
    );
    if (!file) return res.status(404).json({ success: false, error: '파일을 찾을 수 없음' });
    if (!fs.existsSync(file.file_path)) {
      return res.status(404).json({ success: false, error: '디스크에 파일이 없습니다' });
    }

    res.download(file.file_path, file.original_filename, err => {
      if (err) {
        console.error('[contracts:download] 실패:', err.message);
        if (!res.headersSent) {
          handleError(res, err);
        }
      }
    });
  } catch (err) {
    handleError(res, err);
  }
});

// ── DELETE /:id/files/:fileId — 파일 삭제 ────────────────────
router.delete('/:id/files/:fileId', async (req, res) => {
  try {
    const contractId = parseInt(req.params.id, 10);
    const fileId = parseInt(req.params.fileId, 10);
    if (!contractId || !fileId) {
      return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    }
    const userId = getUserId(req);

    const [[file]] = await pool.query(
      `SELECT * FROM contract_files WHERE id = ? AND contract_id = ?`,
      [fileId, contractId]
    );
    if (!file) return res.status(404).json({ success: false, error: '파일을 찾을 수 없음' });

    // 디스크 정리
    try {
      if (file.file_path && fs.existsSync(file.file_path)) fs.unlinkSync(file.file_path);
    } catch (e) {
      console.warn('[contracts:file-delete] 디스크 삭제 실패:', e.message);
    }

    await pool.query(`DELETE FROM contract_files WHERE id = ?`, [fileId]);
    await logHistory(null, contractId, userId, 'file_delete', {
      description: `파일 삭제: ${file.original_filename}`,
      oldValue: file.original_filename,
    });

    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
