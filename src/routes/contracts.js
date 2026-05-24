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
const { analyzeContractLegal } = require('../services/gemini');

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

// ── 자가 마이그레이션 (idempotent) — v6.0.0 슬림화: 4개 핵심 테이블만 ──
// v6.0.0 변경: 8개 → 4개 테이블 (templates / alerts / negotiation / translations 제거)
// 기존 데이터는 DROP TABLE 로 안전하게 삭제 (사용자 승인 완료)
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
        quote_id              INT NULL,
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
        INDEX idx_quote_id        (quote_id),
        INDEX idx_status          (status),
        INDEX idx_end_date        (end_date),
        INDEX idx_parent_contract (parent_contract_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // 기존 contracts 에 quote_id 컬럼 추가 (idempotent — 이미 있으면 무시)
    try {
      await pool.query(`ALTER TABLE contracts ADD COLUMN quote_id INT NULL`);
      await pool.query(`ALTER TABLE contracts ADD INDEX idx_quote_id (quote_id)`);
      console.log('[contracts:migration] quote_id 컬럼 추가 완료');
    } catch (_) {
      /* 이미 존재 */
    }

    // v6.0.0 Phase A1: extracted_meta_json — AI 법무 검토에서 추출한 메타 (등록 폼 자동 채움용)
    try {
      await pool.query(
        `ALTER TABLE contract_legal_reviews ADD COLUMN extracted_meta_json MEDIUMTEXT NULL`
      );
      console.log('[contracts:migration] extracted_meta_json 컬럼 추가 완료');
    } catch (_) {
      /* 이미 존재 */
    }

    // v6.0.0 Phase A3: external_contract_no — 거래처(상대방) 계약번호 (선택, 보조 식별자)
    // 자사 contract_no 와 별개로 거래처가 발급한 번호 (양식 자유)
    try {
      await pool.query(`ALTER TABLE contracts ADD COLUMN external_contract_no VARCHAR(80) NULL`);
      await pool.query(
        `ALTER TABLE contracts ADD INDEX idx_external_contract_no (external_contract_no)`
      );
      console.log('[contracts:migration] external_contract_no 컬럼 추가 완료');
    } catch (_) {
      /* 이미 존재 */
    }

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
    // ④ AI 법무 검토 결과: contract_legal_reviews
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
    } catch (_) {
      /* 이미 존재 — 무시 */
    }
  }

  // v6.0.0 슬림화: 구 Phase 3-6 테이블 DROP (사용자 승인 완료)
  // 기존 데이터 보존이 필요한 경우, 본 블록을 주석 처리하고 별도 백업 후 진행.
  try {
    await pool.query(`DROP TABLE IF EXISTS contract_translations`);
    await pool.query(`DROP TABLE IF EXISTS contract_negotiation_coaches`);
    await pool.query(`DROP TABLE IF EXISTS contract_alerts`);
    await pool.query(`DROP TABLE IF EXISTS contract_templates`);
  } catch (e) {
    console.warn('[contracts:migration] 구 테이블 DROP 실패 (무시):', e.message);
  }

  // 기존 8단계 상태 → 4단계 매핑 (idempotent, 최초 1회)
  // negotiation/renewal → review, signing/active → approved, expired/terminated → completed
  try {
    const [r1] = await pool.query(
      `UPDATE contracts SET status='review' WHERE status IN ('negotiation','renewal')`
    );
    const [r2] = await pool.query(
      `UPDATE contracts SET status='approved' WHERE status IN ('signing','active')`
    );
    const [r3] = await pool.query(
      `UPDATE contracts SET status='completed' WHERE status IN ('expired','terminated')`
    );
    const total = (r1.affectedRows || 0) + (r2.affectedRows || 0) + (r3.affectedRows || 0);
    if (total > 0) {
      console.log(`[contracts:migration] 상태 4단계 변환: ${total}건`);
    }
  } catch (e) {
    console.warn('[contracts:migration] 상태 변환 실패 (무시):', e.message);
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

// 허용 상태값 (v6.0.0 슬림화 — 4단계 CLM)
const ALLOWED_STATUS = [
  'draft', // 초안
  'review', // 검토
  'approved', // 승인
  'completed', // 계약완료
];

// v6.0.0: 4단계 상태 전이 매트릭스
// 정방향: draft → review → approved → completed
// 회귀(수정 요청): review → draft (검토 단계에서만 가능)
// 종료: 임의 단계에서 → completed (관리자 강제 종료 허용)
const STATUS_TRANSITIONS = {
  draft: ['review', 'completed'],
  review: ['draft', 'approved', 'completed'],
  approved: ['review', 'completed'],
  completed: [],
};

// 상태 라벨 (history 메시지용 — 한글)
const STATUS_LABELS_KO = {
  draft: '초안',
  review: '검토',
  approved: '승인',
  completed: '계약완료',
};

// 전이가 유효한지 검증
function _isValidTransition(from, to) {
  if (from === to) return false; // 자기 자신으로 전이 금지
  const allowedTargets = STATUS_TRANSITIONS[from];
  if (!allowedTargets) return false; // 알 수 없는 from
  return allowedTargets.includes(to);
}

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
      quote_id,
      date_from,
      date_to,
      expiring_soon,
    } = req.query;
    const { page, limit, offset } = parsePage(req.query);

    let where = 'WHERE 1=1';
    const params = [];
    if (search) {
      // v6.0.0 Phase A3: 검색 대상에 external_contract_no 추가 (거래처 계약번호로도 찾기)
      where +=
        ' AND (c.title LIKE ? OR c.contract_no LIKE ? OR c.customer_name LIKE ?' +
        ' OR c.external_contract_no LIKE ?)';
      const k = `%${search}%`;
      params.push(k, k, k, k);
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
    if (quote_id) {
      where += ' AND c.quote_id = ?';
      params.push(parseInt(quote_id, 10));
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
        `SELECT c.id, c.contract_no, c.external_contract_no,
                c.title, c.customer_id, c.customer_name,
                c.proposal_id, c.lead_id, c.quote_id, c.contract_type, c.status,
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

    const [[files], [history], [latestReview]] = await Promise.all([
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
      // 최신 AI 법무 검토 결과 (모달 재진입 시 자동 표시)
      pool.query(
        `SELECT clr.*, cf.original_filename AS target_filename
           FROM contract_legal_reviews clr
           LEFT JOIN contract_files cf ON cf.id = clr.target_file_id
          WHERE clr.contract_id = ?
          ORDER BY clr.generated_at DESC LIMIT 1`,
        [id]
      ),
    ]);

    contract.files = files;
    contract.history = history;
    // 최신 법무 검토 풀어서 노출 (JSON 컬럼 → 객체)
    if (latestReview && latestReview[0]) {
      const r = latestReview[0];
      const parseJson = (s, fallback) => {
        if (!s) return fallback;
        try {
          return JSON.parse(s);
        } catch (_) {
          return fallback;
        }
      };
      contract.latest_legal_review = {
        id: r.id,
        target_file_id: r.target_file_id,
        target_filename: r.target_filename,
        review_score: r.review_score,
        risk_level: r.risk_level,
        toxic_clauses: parseJson(r.toxic_clauses_json, []),
        missing_clauses: parseJson(r.missing_clauses_json, []),
        legal_compliance: parseJson(r.legal_compliance_json, {}),
        improvement_suggestions: parseJson(r.improvement_suggestions_json, []),
        overall_assessment: r.overall_assessment,
        extracted_meta: parseJson(r.extracted_meta_json, null), // v6.0.0+
        language: r.language,
        generated_at: r.generated_at,
      };
    } else {
      contract.latest_legal_review = null;
    }
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

    // v6.0.0 Phase A3: 거래처 계약번호 (선택)
    const externalContractNo =
      body.external_contract_no && String(body.external_contract_no).trim()
        ? String(body.external_contract_no).slice(0, 80)
        : null;

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
        (contract_no, external_contract_no, title, customer_id, customer_name,
         proposal_id, lead_id, quote_id, contract_type, status,
         start_date, end_date, contract_amount, currency, language,
         auto_renewal, renewal_notice_days,
         template_id, version_no, parent_contract_id,
         owner_id, owner_name, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        contractNo,
        externalContractNo,
        String(body.title).slice(0, 300),
        customerId || null,
        customerName ? String(customerName).slice(0, 200) : null,
        body.proposal_id || null,
        body.lead_id || null,
        body.quote_id || null,
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
      'contract_no', // v6.0.0 Phase A3: 자동→수동 채번 전환 시 수정 가능
      'external_contract_no', // v6.0.0 Phase A3: 거래처 계약번호
      'title',
      'customer_id',
      'customer_name',
      'proposal_id',
      'lead_id',
      'quote_id',
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
      // v6.0.0 Phase A3: contract_no 수동 변경 시 빈문자 금지 + 길이 제한
      if (f === 'contract_no') {
        const trimmed = body[f] === null ? null : String(body[f]).trim();
        if (!trimmed) {
          await conn.rollback();
          return res.status(400).json({ success: false, error: '계약번호는 비울 수 없습니다' });
        }
        body[f] = trimmed.slice(0, 50);
      }
      // v6.0.0 Phase A3: external_contract_no 길이 제한 + 빈문자 → null
      if (f === 'external_contract_no') {
        if (body[f] === null || body[f] === '' || !String(body[f]).trim()) {
          body[f] = null;
        } else {
          body[f] = String(body[f]).trim().slice(0, 80);
        }
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
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: '계약번호가 이미 존재합니다' });
    }
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

// ── PATCH /:id/status — 상태 전이 (Phase 1 CLM 워크플로우) ───
// 전이 규칙 검증 + 자동 timestamp + history 강조
router.patch('/:id/status', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const id = parseInt(req.params.id, 10);
    if (!id) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    }
    const userId = getUserId(req);
    const newStatus = req.body?.status;
    if (!newStatus || !ALLOWED_STATUS.includes(newStatus)) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: '유효하지 않은 상태값' });
    }

    const [[prev]] = await conn.query(`SELECT id, status, start_date FROM contracts WHERE id = ?`, [
      id,
    ]);
    if (!prev) {
      await conn.rollback();
      return res.status(404).json({ success: false, error: '계약을 찾을 수 없음' });
    }

    const fromStatus = prev.status;
    if (fromStatus === newStatus) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        error: `이미 ${STATUS_LABELS_KO[fromStatus] || fromStatus} 상태입니다`,
      });
    }

    if (!_isValidTransition(fromStatus, newStatus)) {
      await conn.rollback();
      const allowed = STATUS_TRANSITIONS[fromStatus] || [];
      const allowedKo = allowed.map(s => STATUS_LABELS_KO[s] || s).join(', ');
      return res.status(400).json({
        success: false,
        error:
          `잘못된 전이: ${STATUS_LABELS_KO[fromStatus]} → ${STATUS_LABELS_KO[newStatus] || newStatus}` +
          (allowed.length > 0
            ? ` (허용: ${allowedKo})`
            : ' (이 상태에서는 다른 상태로 전이할 수 없습니다)'),
      });
    }

    // 자동 timestamp — signing → active 시 start_date 비어있으면 오늘 채움
    let extraSql = '';
    const extraParams = [];
    if (fromStatus === 'signing' && newStatus === 'active' && !prev.start_date) {
      const today = new Date();
      const p = n => String(n).padStart(2, '0');
      const todayYmd = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
      extraSql = ', start_date = ?';
      extraParams.push(todayYmd);
    }

    await conn.query(`UPDATE contracts SET status = ?${extraSql} WHERE id = ?`, [
      newStatus,
      ...extraParams,
      id,
    ]);

    // history 강조 (전이 종류에 따라 description 다르게)
    let desc;
    if (newStatus === 'terminated') {
      desc = `❌ 해지 처리: ${STATUS_LABELS_KO[fromStatus]} → 해지`;
    } else if (newStatus === 'expired') {
      desc = `⏰ 만료 처리: ${STATUS_LABELS_KO[fromStatus]} → 만료`;
    } else if (fromStatus === 'signing' && newStatus === 'active') {
      desc = `✅ 발효: 서명진행 → 발효` + (extraSql ? ' (start_date 자동 채움)' : '');
    } else if (fromStatus === 'active' && newStatus === 'renewal') {
      desc = `🔄 갱신 시작: 발효 → 갱신중`;
    } else if (fromStatus === 'renewal' && newStatus === 'active') {
      desc = `🔄 갱신 완료: 갱신중 → 발효`;
    } else {
      desc = `상태 변경: ${STATUS_LABELS_KO[fromStatus]} → ${STATUS_LABELS_KO[newStatus]}`;
    }
    await logHistory(conn, id, userId, 'status_change', {
      fieldName: 'status',
      oldValue: fromStatus,
      newValue: newStatus,
      description: desc,
    });

    await conn.commit();

    res.json({
      success: true,
      data: {
        id,
        from: fromStatus,
        to: newStatus,
        auto_start_date: extraSql ? extraParams[0] : null,
      },
    });
  } catch (err) {
    await conn.rollback();
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

// =============================================================
// Phase 2: AI 법무 검토 (analyzeContractLegal)
//
// 정책: team_lead+ 권한 권장 (현재 manager+ 로 열어둠 — Phase 2-PR2 에서 조정)
// AI 비용: 1회 약 500-1000원 (Gemini 2.5 Pro Multimodal)
// =============================================================

// POST /:id/files/:fileId/legal-review — AI 법무 검토 실행 + DB 영속화
router.post('/:id/files/:fileId/legal-review', async (req, res) => {
  try {
    const contractId = parseInt(req.params.id, 10);
    const fileId = parseInt(req.params.fileId, 10);
    if (!contractId || !fileId) {
      return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    }
    const userId = getUserId(req);

    // 계약 존재 확인
    const [[contract]] = await pool.query(`SELECT id FROM contracts WHERE id = ?`, [contractId]);
    if (!contract) {
      return res.status(404).json({ success: false, error: '계약을 찾을 수 없음' });
    }

    // 대상 파일 조회
    const [[file]] = await pool.query(
      `SELECT * FROM contract_files WHERE id = ? AND contract_id = ?`,
      [fileId, contractId]
    );
    if (!file) {
      return res.status(404).json({ success: false, error: '계약서 파일을 찾을 수 없음' });
    }

    console.log(
      `[contracts:legal-review] start contract=${contractId} file=${fileId} (${file.original_filename})`
    );
    const startedAt = Date.now();

    // Gemini 호출 (테스트 환경은 mock)
    const result = await analyzeContractLegal({
      contractPath: file.file_path,
      contractMime: file.mime_type,
      userId,
      endpoint: 'contract_legal_review',
    });

    // DB 영속화 (contract_legal_reviews)
    const [insertResult] = await pool.query(
      `INSERT INTO contract_legal_reviews
        (contract_id, target_file_id, review_score, risk_level,
         toxic_clauses_json, missing_clauses_json, legal_compliance_json,
         improvement_suggestions_json, overall_assessment, extracted_meta_json,
         language, generated_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        contractId,
        fileId,
        result.review_score,
        result.risk_level,
        JSON.stringify(result.toxic_clauses || []),
        JSON.stringify(result.missing_clauses || []),
        JSON.stringify(result.legal_compliance || {}),
        JSON.stringify(result.improvement_suggestions || []),
        result.overall_assessment || null,
        result.extracted_meta ? JSON.stringify(result.extracted_meta) : null,
        req.body?.language || 'ko',
        userId || null,
      ]
    );

    // 메인 contracts 테이블에도 요약 점수 반영 (마지막 검토 결과)
    await pool.query(
      `UPDATE contracts SET legal_review_score = ?, ai_review_summary = ? WHERE id = ?`,
      [result.review_score, result.overall_assessment || null, contractId]
    );

    // history 자동 기록
    await logHistory(null, contractId, userId, 'legal_review', {
      description: `AI 법무 검토 완료 — score=${result.review_score}, risk=${result.risk_level} (${file.original_filename})`,
      newValue: `score=${result.review_score}, risk=${result.risk_level}`,
    });

    console.log(
      `[contracts:legal-review] done contract=${contractId} score=${result.review_score} risk=${result.risk_level} elapsed=${Date.now() - startedAt}ms`
    );

    res.json({
      success: true,
      data: {
        id: insertResult.insertId,
        target_file_id: fileId,
        target_filename: file.original_filename,
        ...result,
        generated_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[contracts:legal-review] failed:', err?.message || err);
    handleError(res, err);
  }
});

// GET /:id/legal-reviews — 법무 검토 이력 조회 (다중 버전)
router.get('/:id/legal-reviews', async (req, res) => {
  try {
    const contractId = parseInt(req.params.id, 10);
    if (!contractId) return res.status(400).json({ success: false, error: '유효한 ID 필요' });

    const [rows] = await pool.query(
      `SELECT clr.*, cf.original_filename AS target_filename,
              tm.name AS generated_by_name
         FROM contract_legal_reviews clr
         LEFT JOIN contract_files cf ON cf.id = clr.target_file_id
         LEFT JOIN team_members tm ON tm.id = clr.generated_by
        WHERE clr.contract_id = ?
        ORDER BY clr.generated_at DESC
        LIMIT 50`,
      [contractId]
    );

    // JSON 컬럼 풀어서 노출
    const parseJson = (s, fallback) => {
      if (!s) return fallback;
      try {
        return JSON.parse(s);
      } catch (_) {
        return fallback;
      }
    };
    const data = rows.map(r => ({
      id: r.id,
      target_file_id: r.target_file_id,
      target_filename: r.target_filename,
      review_score: r.review_score,
      risk_level: r.risk_level,
      toxic_clauses: parseJson(r.toxic_clauses_json, []),
      missing_clauses: parseJson(r.missing_clauses_json, []),
      legal_compliance: parseJson(r.legal_compliance_json, {}),
      improvement_suggestions: parseJson(r.improvement_suggestions_json, []),
      overall_assessment: r.overall_assessment,
      extracted_meta: parseJson(r.extracted_meta_json, null), // v6.0.0+
      language: r.language,
      generated_by: r.generated_by,
      generated_by_name: r.generated_by_name,
      generated_at: r.generated_at,
    }));

    res.json({ success: true, data });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
