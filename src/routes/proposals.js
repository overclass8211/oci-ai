'use strict';
// =============================================================
// /api/proposals — 제안관리 아카이브 (Phase 1: CRUD + 상태 + history)
//
// 기능:
//   - 제안 건 CRUD (헤더만 / 파일/리비전/이메일/AI 는 Phase 3+)
//   - 자동채번 P-YYYY-NNNN (트랜잭션 보호)
//   - 상태 전환 PATCH /status (워크플로우)
//   - proposal_history 자동 기록 (감사 추적)
//   - leads/customers/quotes 연결 (선택)
//
// 권한: 기본 인증 (team_lead+) — autoLevel 미적용 (manager 도 접근 가능)
// 기능 플래그: crm.proposals
//
// 엔드포인트 (Phase 1):
//   GET    /next-proposal-no  — 다음 자동 채번 미리보기
//   GET    /                  — 목록 (페이징, 필터)
//   GET    /:id               — 단건 (history 포함)
//   POST   /                  — 생성 (lead/quote 자동 반영)
//   PUT    /:id               — 수정
//   PATCH  /:id/status        — 상태 전환
//   DELETE /:id               — 삭제 (CASCADE 로 children 자동)
// =============================================================

const router = require('express').Router();
const pool = require('../db');
const { handleError } = require('../middleware/errorHandler');
const { getUserId } = require('../middleware/auth');
const { requireFeature } = require('../middleware/featureGuard');
const { parsePage, pageResult } = require('../utils/routeHelper');

router.use(requireFeature('crm.proposals'));

// ── 자가 마이그레이션 (idempotent) ────────────────────────────
async function ensureSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS proposals (
        id                  INT AUTO_INCREMENT PRIMARY KEY,
        proposal_no         VARCHAR(50) UNIQUE NOT NULL,
        proposal_title      VARCHAR(300) NOT NULL,
        lead_id             INT NULL,
        customer_id         INT NULL,
        customer_name       VARCHAR(200) NOT NULL,
        quote_id            INT NULL,
        quote_no            VARCHAR(50) NULL,
        proposal_date       DATE NOT NULL,
        due_date            DATE NULL,
        status              VARCHAR(30) DEFAULT 'draft',
        owner_id            INT NULL,
        owner_name          VARCHAR(100) NULL,
        expected_amount     DECIMAL(20,2) NULL,
        currency            VARCHAR(10) DEFAULT 'KRW',
        rfp_title           VARCHAR(300) NULL,
        rfp_received_date   DATE NULL,
        rfp_due_date        DATE NULL,
        rfp_summary         MEDIUMTEXT NULL,
        ai_strategy_md      MEDIUMTEXT NULL,
        ai_strategy_generated_at DATETIME NULL,
        share_token         VARCHAR(100) NULL,
        shared_until        DATETIME NULL,
        version_no          INT DEFAULT 1,
        parent_proposal_id  INT NULL,
        sent_at             DATETIME NULL,
        accepted_at         DATETIME NULL,
        rejected_at         DATETIME NULL,
        remark              TEXT NULL,
        created_by          INT NULL,
        created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_proposal_no       (proposal_no),
        INDEX idx_lead_id           (lead_id),
        INDEX idx_customer_id       (customer_id),
        INDEX idx_quote_id          (quote_id),
        INDEX idx_owner_id          (owner_id),
        INDEX idx_status            (status),
        INDEX idx_proposal_date     (proposal_date),
        INDEX idx_due_date          (due_date),
        INDEX idx_share_token       (share_token),
        INDEX idx_parent            (parent_proposal_id),
        INDEX idx_created_by        (created_by)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS proposal_files (
        id                  INT AUTO_INCREMENT PRIMARY KEY,
        proposal_id         INT NOT NULL,
        file_type           VARCHAR(50) NOT NULL,
        original_filename   VARCHAR(300) NOT NULL,
        stored_filename     VARCHAR(300) NOT NULL,
        file_path           VARCHAR(500) NOT NULL,
        file_size           BIGINT NULL,
        mime_type           VARCHAR(100) NULL,
        revision_no         INT DEFAULT 1,
        is_final            TINYINT(1) DEFAULT 0,
        include_in_email    TINYINT(1) DEFAULT 0,
        description         TEXT NULL,
        uploaded_by         INT NULL,
        created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_proposal_type (proposal_id, file_type),
        INDEX idx_proposal_rev  (proposal_id, revision_no),
        CONSTRAINT fk_pf_proposal FOREIGN KEY (proposal_id)
          REFERENCES proposals(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS proposal_revisions (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        proposal_id  INT NOT NULL,
        revision_no  INT NOT NULL,
        title        VARCHAR(300) NULL,
        description  TEXT NULL,
        created_by   INT NULL,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_proposal_rev (proposal_id, revision_no),
        CONSTRAINT fk_pr_proposal FOREIGN KEY (proposal_id)
          REFERENCES proposals(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS proposal_history (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        proposal_id  INT NOT NULL,
        action_type  VARCHAR(50) NOT NULL,
        old_value    TEXT NULL,
        new_value    TEXT NULL,
        description  TEXT NULL,
        created_by   INT NULL,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_proposal_created (proposal_id, created_at),
        INDEX idx_action (action_type),
        CONSTRAINT fk_ph_proposal FOREIGN KEY (proposal_id)
          REFERENCES proposals(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS proposal_email_logs (
        id                    INT AUTO_INCREMENT PRIMARY KEY,
        proposal_id           INT NOT NULL,
        to_emails             TEXT NOT NULL,
        cc_emails             TEXT NULL,
        subject               VARCHAR(300) NOT NULL,
        body                  MEDIUMTEXT NULL,
        attachment_file_ids   TEXT NULL,
        gmail_message_id      VARCHAR(100) NULL,
        sent_by               INT NULL,
        sent_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        send_status           VARCHAR(30) DEFAULT 'sent',
        error_message         TEXT NULL,
        INDEX idx_proposal_sent (proposal_id, sent_at),
        CONSTRAINT fk_pel_proposal FOREIGN KEY (proposal_id)
          REFERENCES proposals(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  } catch (e) {
    // 외래키 실패 시 fallback — FK 없이 재시도 (예: proposals 부재 등)
    console.warn('[proposals:migration] FK 생성 실패 → fallback (FK 없이 재생성):', e.message);
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS proposal_files (
          id INT AUTO_INCREMENT PRIMARY KEY, proposal_id INT NOT NULL,
          file_type VARCHAR(50) NOT NULL, original_filename VARCHAR(300) NOT NULL,
          stored_filename VARCHAR(300) NOT NULL, file_path VARCHAR(500) NOT NULL,
          file_size BIGINT NULL, mime_type VARCHAR(100) NULL, revision_no INT DEFAULT 1,
          is_final TINYINT(1) DEFAULT 0, include_in_email TINYINT(1) DEFAULT 0,
          description TEXT NULL, uploaded_by INT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_proposal_type (proposal_id, file_type)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS proposal_revisions (
          id INT AUTO_INCREMENT PRIMARY KEY, proposal_id INT NOT NULL,
          revision_no INT NOT NULL, title VARCHAR(300) NULL, description TEXT NULL,
          created_by INT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_proposal_rev (proposal_id, revision_no)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS proposal_history (
          id INT AUTO_INCREMENT PRIMARY KEY, proposal_id INT NOT NULL,
          action_type VARCHAR(50) NOT NULL, old_value TEXT NULL, new_value TEXT NULL,
          description TEXT NULL, created_by INT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_proposal_created (proposal_id, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS proposal_email_logs (
          id INT AUTO_INCREMENT PRIMARY KEY, proposal_id INT NOT NULL,
          to_emails TEXT NOT NULL, cc_emails TEXT NULL, subject VARCHAR(300) NOT NULL,
          body MEDIUMTEXT NULL, attachment_file_ids TEXT NULL,
          gmail_message_id VARCHAR(100) NULL, sent_by INT NULL,
          sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          send_status VARCHAR(30) DEFAULT 'sent', error_message TEXT NULL,
          INDEX idx_proposal_sent (proposal_id, sent_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch (_) {
      /* 이미 존재 — 무시 */
    }
  }
}
const _migrationPromise = ensureSchema();

// 첫 요청 안전성 — 마이그레이션 promise await
router.use(async (req, res, next) => {
  try {
    await _migrationPromise;
    next();
  } catch (err) {
    next(err);
  }
});

// ── 자동채번 헬퍼 (P-YYYY-NNNN) ─────────────────────────────
async function generateProposalNo(conn, year) {
  const yyyy = year || new Date().getFullYear();
  const prefix = `P-${yyyy}-`;
  const [[row]] = await conn.query(
    `SELECT proposal_no FROM proposals
      WHERE proposal_no LIKE ?
      ORDER BY proposal_no DESC LIMIT 1`,
    [`${prefix}%`]
  );
  let next = 1;
  if (row && row.proposal_no) {
    const m = row.proposal_no.match(/P-\d{4}-(\d+)/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return prefix + String(next).padStart(4, '0');
}

// ── history 자동 기록 헬퍼 ──────────────────────────────────
async function logHistory(conn, proposalId, userId, actionType, opts = {}) {
  try {
    await (conn || pool).query(
      `INSERT INTO proposal_history
        (proposal_id, action_type, old_value, new_value, description, created_by)
       VALUES (?,?,?,?,?,?)`,
      [
        proposalId,
        String(actionType).slice(0, 50),
        opts.oldValue ? String(opts.oldValue).slice(0, 65000) : null,
        opts.newValue ? String(opts.newValue).slice(0, 65000) : null,
        opts.description ? String(opts.description).slice(0, 65000) : null,
        userId || null,
      ]
    );
  } catch (e) {
    // history 실패는 본 작업에 영향 X (로그만)
    console.warn('[proposals:history] log failed:', e.message);
  }
}

// 허용 상태값 (단일 진실 소스)
const ALLOWED_STATUS = [
  'draft',
  'review',
  'ready',
  'sent',
  'revised',
  'accepted',
  'rejected',
  'expired',
];

// ── GET /next-proposal-no — 다음 자동 채번 미리보기 ──────────
// ⚠️ 반드시 /:id 보다 먼저 선언 (Express 라우트 매칭 순서)
router.get('/next-proposal-no', async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const conn = await pool.getConnection();
    try {
      const next = await generateProposalNo(conn, year);
      res.json({ success: true, data: { proposal_no: next, year } });
    } finally {
      conn.release();
    }
  } catch (err) {
    handleError(res, err);
  }
});

// ── GET / — 목록 (페이징 + 필터) ────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { search, status, customer_id, lead_id, quote_id, date_from, date_to, due_soon } =
      req.query;
    const { page, limit, offset } = parsePage(req.query);

    let where = 'WHERE 1=1';
    const params = [];
    if (search) {
      where += ' AND (p.proposal_title LIKE ? OR p.proposal_no LIKE ? OR p.customer_name LIKE ?)';
      const k = `%${search}%`;
      params.push(k, k, k);
    }
    if (status) {
      where += ' AND p.status = ?';
      params.push(status);
    }
    if (customer_id) {
      where += ' AND p.customer_id = ?';
      params.push(parseInt(customer_id, 10));
    }
    if (lead_id) {
      where += ' AND p.lead_id = ?';
      params.push(parseInt(lead_id, 10));
    }
    if (quote_id) {
      where += ' AND p.quote_id = ?';
      params.push(parseInt(quote_id, 10));
    }
    if (date_from) {
      where += ' AND p.proposal_date >= ?';
      params.push(date_from);
    }
    if (date_to) {
      where += ' AND p.proposal_date <= ?';
      params.push(date_to);
    }
    if (due_soon === '1' || due_soon === 'true') {
      // 마감 7일 이내 (또는 이미 지난 것 중 sent 안 된 것)
      where += ' AND p.due_date IS NOT NULL AND p.due_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)';
    }

    const [[countRow], [rows]] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM proposals p ${where}`, params),
      pool.query(
        `SELECT p.id, p.proposal_no, p.proposal_title, p.customer_name,
                p.lead_id, p.customer_id, p.quote_id, p.quote_no,
                p.expected_amount, p.currency, p.status,
                p.proposal_date, p.due_date, p.owner_id, p.owner_name,
                p.version_no AS latest_revision_no, p.sent_at, p.created_at,
                tm.name AS created_by_name,
                (SELECT COUNT(*) FROM proposal_files pf WHERE pf.proposal_id = p.id) AS file_count
           FROM proposals p
           LEFT JOIN team_members tm ON tm.id = p.created_by
           ${where}
          ORDER BY p.created_at DESC
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

// ── GET /:id — 단건 + 연결 정보 + history ─────────────────────
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });

    const [[proposal]] = await pool.query(
      `SELECT p.*, tm.name AS created_by_name
         FROM proposals p
         LEFT JOIN team_members tm ON tm.id = p.created_by
        WHERE p.id = ?`,
      [id]
    );
    if (!proposal) return res.status(404).json({ success: false, error: '제안을 찾을 수 없음' });

    // 연결된 lead/quote 요약 (있으면)
    const queries = [];
    if (proposal.lead_id) {
      queries.push(
        pool.query(
          `SELECT id, customer_name, project_name, stage, expected_amount, currency, amount_krw
             FROM leads WHERE id = ?`,
          [proposal.lead_id]
        )
      );
    } else {
      queries.push(Promise.resolve([[null]]));
    }
    if (proposal.quote_id) {
      queries.push(
        pool.query(
          `SELECT id, quote_no, name, total_amount, subtotal, vat_amount, vat_included, status
             FROM quotes WHERE id = ?`,
          [proposal.quote_id]
        )
      );
    } else {
      queries.push(Promise.resolve([[null]]));
    }
    queries.push(
      pool.query(`SELECT * FROM proposal_files WHERE proposal_id = ? ORDER BY created_at DESC`, [
        id,
      ]),
      pool.query(
        `SELECT * FROM proposal_revisions WHERE proposal_id = ? ORDER BY revision_no DESC`,
        [id]
      ),
      pool.query(
        `SELECT pel.*, tm.name AS sent_by_name
           FROM proposal_email_logs pel
           LEFT JOIN team_members tm ON tm.id = pel.sent_by
          WHERE pel.proposal_id = ? ORDER BY pel.sent_at DESC LIMIT 100`,
        [id]
      ),
      pool.query(
        `SELECT ph.*, tm.name AS created_by_name
           FROM proposal_history ph
           LEFT JOIN team_members tm ON tm.id = ph.created_by
          WHERE ph.proposal_id = ? ORDER BY ph.created_at DESC LIMIT 200`,
        [id]
      )
    );
    const [[[lead]], [[quote]], [files], [revisions], [emailLogs], [history]] =
      await Promise.all(queries);

    res.json({
      success: true,
      data: { ...proposal, lead, quote, files, revisions, email_logs: emailLogs, history },
    });
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
    if (!body.proposal_title || !String(body.proposal_title).trim()) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: '제안명이 필요합니다' });
    }
    if (!body.proposal_date) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: '제안일이 필요합니다' });
    }
    let customerName = body.customer_name ? String(body.customer_name).trim() : '';

    // lead_id 자동 반영 (customer_name 비어있으면 lead 에서 추출)
    let leadCustomerId = null;
    let leadExpectedAmount = null;
    let leadCurrency = null;
    if (body.lead_id) {
      const [[lead]] = await conn.query(
        `SELECT customer_id, customer_name, expected_amount, currency FROM leads WHERE id = ?`,
        [body.lead_id]
      );
      if (lead) {
        if (!customerName) customerName = lead.customer_name || '';
        leadCustomerId = lead.customer_id || null;
        leadExpectedAmount = lead.expected_amount || null;
        leadCurrency = lead.currency || null;
      }
    }

    // quote_id 자동 반영 (quote_no/expected_amount/currency 추출)
    let quoteNo = body.quote_no || null;
    let quoteTotalAmount = null;
    if (body.quote_id) {
      const [[quote]] = await conn.query(
        `SELECT quote_no, total_amount, customer_name FROM quotes WHERE id = ?`,
        [body.quote_id]
      );
      if (quote) {
        quoteNo = quote.quote_no;
        quoteTotalAmount = quote.total_amount;
        if (!customerName) customerName = quote.customer_name || '';
      }
    }

    if (!customerName) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: '고객명이 필요합니다' });
    }

    // 자동 채번 (수동 입력 가능)
    const year = new Date(body.proposal_date).getFullYear() || new Date().getFullYear();
    let proposalNo = body.proposal_no && String(body.proposal_no).trim();
    if (!proposalNo) proposalNo = await generateProposalNo(conn, year);

    // owner_name 자동 보강 (owner_id 있으면 team_members 에서 조회)
    let ownerName = body.owner_name || null;
    if (body.owner_id && !ownerName) {
      const [[tm]] = await conn.query(`SELECT name FROM team_members WHERE id = ?`, [
        body.owner_id,
      ]);
      ownerName = tm?.name || null;
    }

    // 최종 expected_amount: 명시값 > 견적 총액 > lead 예상금액
    const expectedAmount =
      body.expected_amount !== undefined && body.expected_amount !== null
        ? body.expected_amount
        : quoteTotalAmount || leadExpectedAmount || null;
    const currency = body.currency || leadCurrency || 'KRW';

    const [result] = await conn.query(
      `INSERT INTO proposals
        (proposal_no, proposal_title, lead_id, customer_id, customer_name,
         quote_id, quote_no, proposal_date, due_date, status,
         owner_id, owner_name, expected_amount, currency,
         rfp_title, rfp_received_date, rfp_due_date, rfp_summary,
         version_no, parent_proposal_id, remark, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        proposalNo,
        String(body.proposal_title).slice(0, 300),
        body.lead_id || null,
        body.customer_id || leadCustomerId || null,
        String(customerName).slice(0, 200),
        body.quote_id || null,
        quoteNo,
        body.proposal_date,
        body.due_date || null,
        body.status && ALLOWED_STATUS.includes(body.status) ? body.status : 'draft',
        body.owner_id || null,
        ownerName,
        expectedAmount,
        currency,
        body.rfp_title || null,
        body.rfp_received_date || null,
        body.rfp_due_date || null,
        body.rfp_summary || null,
        Number(body.version_no) || 1,
        body.parent_proposal_id || null,
        body.remark || null,
        userId || null,
      ]
    );
    const proposalId = result.insertId;
    await logHistory(conn, proposalId, userId, 'create', {
      description: `제안 건 생성: ${proposalNo}`,
    });

    // lead_id 가 있으면 activities 에 활동 자동 기록 (best-effort — 실패해도 제안 생성 성공)
    if (body.lead_id) {
      try {
        await conn.query(
          `INSERT INTO activities (lead_id, activity_type, title, content, created_by)
           VALUES (?, '제안', ?, ?, ?)`,
          [
            body.lead_id,
            `제안 건 생성: ${proposalNo}`,
            `제안명: ${body.proposal_title}`,
            userId || null,
          ]
        );
      } catch (_) {
        /* activities 미존재/스키마 차이 — 무시 */
      }
    }

    await conn.commit();
    res.json({
      success: true,
      id: proposalId,
      data: { id: proposalId, proposal_no: proposalNo },
    });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, error: '제안번호가 이미 존재합니다' });
    }
    handleError(res, err);
  } finally {
    conn.release();
  }
});

// ── PUT /:id — 수정 ─────────────────────────────────────────
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

    const [[prev]] = await conn.query(`SELECT * FROM proposals WHERE id = ?`, [id]);
    if (!prev) {
      await conn.rollback();
      return res.status(404).json({ success: false, error: '제안을 찾을 수 없음' });
    }

    // quote_id 변경 시 quote 요약 정보 재반영
    let newQuoteNo = body.quote_no;
    if (body.quote_id !== undefined && body.quote_id !== prev.quote_id) {
      if (body.quote_id) {
        const [[quote]] = await conn.query(
          `SELECT quote_no, total_amount FROM quotes WHERE id = ?`,
          [body.quote_id]
        );
        if (quote) newQuoteNo = quote.quote_no;
      } else {
        newQuoteNo = null;
      }
    }

    const fields = [];
    const values = [];
    const allowed = [
      'proposal_title',
      'customer_name',
      'lead_id',
      'customer_id',
      'quote_id',
      'proposal_date',
      'due_date',
      'status',
      'owner_id',
      'owner_name',
      'expected_amount',
      'currency',
      'rfp_title',
      'rfp_received_date',
      'rfp_due_date',
      'rfp_summary',
      'remark',
    ];
    for (const f of allowed) {
      if (body[f] === undefined) continue;
      if (f === 'status' && !ALLOWED_STATUS.includes(body[f])) {
        await conn.rollback();
        return res.status(400).json({ success: false, error: '유효하지 않은 상태값' });
      }
      fields.push(`${f} = ?`);
      values.push(body[f]);
    }
    // quote_id 변경 시 quote_no 도 반영
    if (body.quote_id !== undefined && newQuoteNo !== undefined) {
      fields.push('quote_no = ?');
      values.push(newQuoteNo);
    }

    // 상태별 timestamp 자동 기록
    if (body.status && body.status !== prev.status) {
      if (body.status === 'sent' && !prev.sent_at) {
        fields.push('sent_at = NOW()');
      } else if (body.status === 'accepted' && !prev.accepted_at) {
        fields.push('accepted_at = NOW()');
      } else if (body.status === 'rejected' && !prev.rejected_at) {
        fields.push('rejected_at = NOW()');
      }
    }

    if (fields.length === 0) {
      await conn.commit();
      return res.json({ success: true, data: { id, unchanged: true } });
    }
    values.push(id);
    await conn.query(`UPDATE proposals SET ${fields.join(', ')} WHERE id = ?`, values);

    // history 기록 (status 변경은 별도 명시)
    if (body.status && body.status !== prev.status) {
      await logHistory(conn, id, userId, 'status_change', {
        oldValue: prev.status,
        newValue: body.status,
        description: `상태 변경: ${prev.status} → ${body.status}`,
      });
    } else {
      await logHistory(conn, id, userId, 'update', {
        description: `필드 변경: ${fields.length}개`,
      });
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

// ── PATCH /:id/status — 상태 전환 (빠른 액션) ────────────────
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
    const status = String(req.body?.status || '').trim();
    if (!ALLOWED_STATUS.includes(status)) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: '유효하지 않은 상태값' });
    }
    const [[prev]] = await conn.query(
      `SELECT id, status, sent_at, accepted_at, rejected_at, lead_id FROM proposals WHERE id = ?`,
      [id]
    );
    if (!prev) {
      await conn.rollback();
      return res.status(404).json({ success: false, error: '제안을 찾을 수 없음' });
    }

    const setParts = ['status = ?'];
    const params = [status];
    if (status === 'sent' && !prev.sent_at) setParts.push('sent_at = NOW()');
    if (status === 'accepted' && !prev.accepted_at) setParts.push('accepted_at = NOW()');
    if (status === 'rejected' && !prev.rejected_at) setParts.push('rejected_at = NOW()');
    params.push(id);

    await conn.query(`UPDATE proposals SET ${setParts.join(', ')} WHERE id = ?`, params);
    await logHistory(conn, id, userId, 'status_change', {
      oldValue: prev.status,
      newValue: status,
      description: `상태 변경: ${prev.status} → ${status}`,
    });

    // lead_id 가 있으면 activities 자동 기록 (best-effort)
    if (prev.lead_id) {
      try {
        await conn.query(
          `INSERT INTO activities (lead_id, activity_type, title, content, created_by)
           VALUES (?, '제안', ?, ?, ?)`,
          [prev.lead_id, `제안 상태: ${status}`, `이전: ${prev.status}`, userId || null]
        );
      } catch (_) {
        /* 무시 */
      }
    }

    await conn.commit();
    res.json({ success: true, data: { id, status } });
  } catch (err) {
    await conn.rollback();
    handleError(res, err);
  } finally {
    conn.release();
  }
});

// ── DELETE /:id — 삭제 (CASCADE 로 children 자동 삭제) ───────
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: '유효한 ID 필요' });
    const [result] = await pool.query(`DELETE FROM proposals WHERE id = ?`, [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: '제안을 찾을 수 없음' });
    }
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

module.exports = router;
module.exports._migrationPromise = _migrationPromise;
module.exports.ALLOWED_STATUS = ALLOWED_STATUS;
