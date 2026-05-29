'use strict';
// =============================================================
// /api/payments — 수금관리 모듈 (SFR-011)
//
// F1. 수금 스케줄 관리  — 계약 연계, 단계별 수금 계획
// F2. 수금 실적 등록    — 실제 입금 처리 (전액/부분수금)
// F3. 미수금 관리       — 연체 추적 + 자동 알림
// F4. 세금계산서 관리   — 발행 요청·이력 (바로빌 API — Phase 2)
// F5. 매출 대시보드     — 예상 vs 실적, 손익, KPI
//
// 기능 플래그: crm.payments
// RBAC: team_lead 이상 (재무 민감 정보 보호)
// =============================================================

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireFeature } = require('../middleware/featureGuard');

// ─── 자가 마이그레이션 ─────────────────────────────────────────
async function runMigrations() {
  // ① 수금 스케줄 (계약 1개 → N개 단계)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_schedules (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      contract_id      INT NULL,
      customer_id      INT NULL,
      customer_name    VARCHAR(200) NULL,
      contract_name    VARCHAR(200) NULL,
      stage_name       VARCHAR(50) NOT NULL COMMENT '착수금|중도금|잔금|기타',
      stage_order      INT DEFAULT 1,
      ratio            DECIMAL(5,2) NULL       COMMENT '비율 % (30.00)',
      scheduled_amount DECIMAL(20,2) NOT NULL  COMMENT '예정 수금액 (VAT 포함)',
      supply_amount    DECIMAL(20,2) NULL       COMMENT '공급가액 (VAT 제외)',
      tax_amount       DECIMAL(20,2) DEFAULT 0 COMMENT '부가세',
      due_date         DATE NOT NULL            COMMENT '수금 예정일',
      invoice_date     DATE NULL                COMMENT '계산서 발행 예정일',
      status           VARCHAR(20) DEFAULT 'scheduled'
                       COMMENT 'scheduled|invoiced|partial|collected|overdue|written_off',
      note             TEXT NULL,
      created_by       INT NULL,
      created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_contract  (contract_id),
      INDEX idx_customer  (customer_id),
      INDEX idx_due_date  (due_date),
      INDEX idx_status    (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ② 실제 입금 기록 (1 스케줄 → N 입금)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_records (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      schedule_id    INT NOT NULL,
      contract_id    INT NULL,
      customer_id    INT NULL,
      paid_amount    DECIMAL(20,2) NOT NULL,
      paid_date      DATE NOT NULL,
      payment_method VARCHAR(30) DEFAULT 'bank_transfer'
                     COMMENT 'bank_transfer|card|cash|other',
      bank_account   VARCHAR(100) NULL,
      reference_no   VARCHAR(100) NULL COMMENT '입금 참조번호',
      note           TEXT NULL,
      registered_by  INT NULL,
      created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_schedule  (schedule_id),
      INDEX idx_paid_date (paid_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ③ 세금계산서 (스케줄과 연동 — 바로빌 API Phase 2)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tax_invoices (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      schedule_id    INT NULL,
      contract_id    INT NULL,
      customer_id    INT NULL,
      customer_name  VARCHAR(200) NULL,
      invoice_no     VARCHAR(100) NULL   COMMENT '자사 발행번호',
      supply_amount  DECIMAL(20,2) NOT NULL,
      tax_amount     DECIMAL(20,2) NOT NULL,
      total_amount   DECIMAL(20,2) NOT NULL,
      issue_date     DATE NULL,
      status         VARCHAR(20) DEFAULT 'draft'
                     COMMENT 'draft|requested|issued|cancelled',
      barobill_id    VARCHAR(200) NULL   COMMENT '바로빌 발행 ID (Phase 2)',
      nts_result     VARCHAR(50) NULL    COMMENT '국세청 전송 결과 (Phase 2)',
      issued_at      DATETIME NULL,
      note           TEXT NULL,
      raw_response   MEDIUMTEXT NULL     COMMENT 'API 응답 원문 (Phase 2)',
      created_by     INT NULL,
      created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_contract (contract_id),
      INDEX idx_customer (customer_id),
      INDEX idx_status   (status),
      INDEX idx_issue    (issue_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // ④ 수금 비율 템플릿 (자주 쓰는 착수금/중도금/잔금 패턴 저장)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_templates (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      name        VARCHAR(100) NOT NULL COMMENT '템플릿명 (예: 3단계 표준)',
      stages_json MEDIUMTEXT NOT NULL   COMMENT '[{name, ratio, offset_days, note}]',
      is_default  TINYINT(1) DEFAULT 0,
      created_by  INT NULL,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // 기본 템플릿 시드 (idempotent)
  const [existing] = await pool.query(
    `SELECT id FROM payment_templates WHERE is_default = 1 LIMIT 1`
  );
  if (existing.length === 0) {
    await pool.query(`
      INSERT INTO payment_templates (name, stages_json, is_default, created_by) VALUES
      ('3단계 표준 (착수30/중도40/잔금30)',
       '[{"name":"착수금","ratio":30,"offset_days":0,"note":"계약일 즉시"},{"name":"중도금","ratio":40,"offset_days":60,"note":"계약 후 60일"},{"name":"잔금","ratio":30,"offset_days":0,"note":"납품 완료 후"}]',
       1, NULL),
      ('2단계 (선금50/잔금50)',
       '[{"name":"선금","ratio":50,"offset_days":0,"note":"계약일 즉시"},{"name":"잔금","ratio":50,"offset_days":0,"note":"납품 완료 후"}]',
       0, NULL),
      ('단일 수금 (100%)',
       '[{"name":"수금","ratio":100,"offset_days":30,"note":"납품 후 30일"}]',
       0, NULL)
    `);
    console.log('[payments:migration] 기본 템플릿 시드 완료');
  }

  // ⑤ 총계약금 + 품목내역 컬럼 추가 (Phase 1-B — idempotent)
  await pool.query(`
    ALTER TABLE payment_schedules
      ADD COLUMN IF NOT EXISTS contract_supply_amount DECIMAL(20,2) NULL
        COMMENT '총계약금(VAT별도)',
      ADD COLUMN IF NOT EXISTS items_json MEDIUMTEXT NULL
        COMMENT '품목 내역 JSON'
  `);

  // ⑥ 통화 단위 + 계약 기간 컬럼 추가 (수금 모달 재설계 — idempotent)
  //    model A(평면) 정책: 계약 단위 정보를 각 마일스톤 행에 비정규화 저장
  await pool.query(`
    ALTER TABLE payment_schedules
      ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'KRW'
        COMMENT '통화 단위 (KRW|USD|JPY|EUR|GBP|CNY|AUD ...)',
      ADD COLUMN IF NOT EXISTS contract_start_date DATE NULL
        COMMENT '계약 시작일 (계약 단위, 비정규화)',
      ADD COLUMN IF NOT EXISTS contract_end_date DATE NULL
        COMMENT '계약 종료일 (계약 단위, 비정규화)'
  `);

  console.log('[payments:migration] 자가 마이그레이션 완료 (4개 테이블 + 5개 컬럼)');
}

runMigrations().catch(err => console.error('[payments:migration] 오류:', err));

// ─── Feature guard ─────────────────────────────────────────────
router.use(requireFeature('crm.payments'));

// ─── 헬퍼 ─────────────────────────────────────────────────────
// 연체 상태 자동 갱신 (due_date 경과 + status = 'scheduled'|'invoiced')
async function syncOverdueStatus() {
  await pool.query(`
    UPDATE payment_schedules
       SET status = 'overdue'
     WHERE status IN ('scheduled','invoiced')
       AND due_date < CURDATE()
  `);
}

// 스케줄별 실제 수금 합계 계산
async function calcCollectedAmount(scheduleId) {
  const [[row]] = await pool.query(
    `SELECT COALESCE(SUM(paid_amount),0) AS total FROM payment_records WHERE schedule_id = ?`,
    [scheduleId]
  );
  return Number(row.total);
}

// ─── F5. 매출 대시보드 KPI ─────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  try {
    await syncOverdueStatus();

    const now = new Date();
    const thisMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      .toISOString()
      .slice(0, 10);

    // 전체 수주잔액 (미수금 = 미수금+예정)
    const [[totalRow]] = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN status IN ('scheduled','invoiced','partial') THEN scheduled_amount ELSE 0 END),0) AS outstanding_amount,
        COALESCE(SUM(CASE WHEN status = 'collected' THEN scheduled_amount ELSE 0 END),0)                        AS collected_amount,
        COALESCE(SUM(CASE WHEN status = 'overdue' THEN scheduled_amount ELSE 0 END),0)                          AS overdue_amount,
        COUNT(CASE WHEN status = 'overdue' THEN 1 END)                                                          AS overdue_count,
        COALESCE(SUM(scheduled_amount),0)                                                                       AS total_scheduled
      FROM payment_schedules
    `);

    // 이번달 예정 수금
    const [[thisMonthRow]] = await pool.query(
      `
      SELECT COALESCE(SUM(scheduled_amount),0) AS this_month_scheduled
      FROM payment_schedules
      WHERE due_date BETWEEN ? AND ?
        AND status IN ('scheduled','invoiced','partial')
    `,
      [thisMonthStart, thisMonthEnd]
    );

    // 월별 추이 (최근 6개월 예정 vs 실제)
    const [monthlyTrend] = await pool.query(`
      SELECT
        DATE_FORMAT(ps.due_date, '%Y-%m') AS month,
        SUM(ps.scheduled_amount)          AS scheduled,
        COALESCE(SUM(pr.paid_amount), 0)  AS collected
      FROM payment_schedules ps
      LEFT JOIN payment_records pr ON pr.schedule_id = ps.id
        AND DATE_FORMAT(pr.paid_date, '%Y-%m') = DATE_FORMAT(ps.due_date, '%Y-%m')
      WHERE ps.due_date >= DATE_SUB(CURDATE(), INTERVAL 5 MONTH)
      GROUP BY DATE_FORMAT(ps.due_date, '%Y-%m')
      ORDER BY month ASC
    `);

    // 고객사별 미수금 TOP 5
    const [overdueByCustomer] = await pool.query(`
      SELECT customer_name,
             SUM(scheduled_amount) AS overdue_amount,
             COUNT(*) AS count
      FROM payment_schedules
      WHERE status = 'overdue'
        AND customer_name IS NOT NULL
      GROUP BY customer_name
      ORDER BY overdue_amount DESC
      LIMIT 5
    `);

    const total = Number(totalRow.total_scheduled) || 1; // 0 나눗셈 방지
    const rate = Math.round((Number(totalRow.collected_amount) / total) * 100);

    res.json({
      success: true,
      data: {
        kpi: {
          outstanding_amount: Number(totalRow.outstanding_amount),
          collected_amount: Number(totalRow.collected_amount),
          overdue_amount: Number(totalRow.overdue_amount),
          overdue_count: Number(totalRow.overdue_count),
          this_month_scheduled: Number(thisMonthRow.this_month_scheduled),
          collection_rate: rate,
        },
        monthly_trend: monthlyTrend,
        overdue_by_customer: overdueByCustomer,
      },
    });
  } catch (err) {
    console.error('[payments] dashboard 오류:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── F3. 미수금 목록 ───────────────────────────────────────────
router.get('/overdue', async (req, res) => {
  try {
    await syncOverdueStatus();
    const [rows] = await pool.query(`
      SELECT ps.*,
             DATEDIFF(CURDATE(), ps.due_date) AS overdue_days,
             COALESCE(SUM(pr.paid_amount), 0) AS paid_amount
      FROM payment_schedules ps
      LEFT JOIN payment_records pr ON pr.schedule_id = ps.id
      WHERE ps.status = 'overdue'
      GROUP BY ps.id
      ORDER BY ps.due_date ASC
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── F4. 세금계산서 목록 ──────────────────────────────────────
router.get('/tax-invoices', async (req, res) => {
  try {
    const { status, contract_id } = req.query;
    let sql = `SELECT ti.*, c.contract_no FROM tax_invoices ti
               LEFT JOIN contracts c ON c.id = ti.contract_id
               WHERE 1=1`;
    const params = [];
    if (status) {
      sql += ` AND ti.status = ?`;
      params.push(status);
    }
    if (contract_id) {
      sql += ` AND ti.contract_id = ?`;
      params.push(Number(contract_id));
    }
    sql += ` ORDER BY ti.created_at DESC LIMIT 200`;
    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 세금계산서 생성 (draft)
router.post('/tax-invoices', async (req, res) => {
  try {
    const {
      schedule_id,
      contract_id,
      customer_id,
      customer_name,
      supply_amount,
      tax_amount,
      issue_date,
      note,
    } = req.body;
    if (!supply_amount)
      return res.status(400).json({ success: false, error: 'supply_amount 필수' });
    const total = Number(supply_amount) + Number(tax_amount || 0);
    const [result] = await pool.query(
      `
      INSERT INTO tax_invoices
        (schedule_id, contract_id, customer_id, customer_name,
         supply_amount, tax_amount, total_amount, issue_date, status, note, created_by)
      VALUES (?,?,?,?,?,?,?,?,  'draft', ?,?)
    `,
      [
        schedule_id || null,
        contract_id || null,
        customer_id || null,
        customer_name || null,
        supply_amount,
        tax_amount || 0,
        total,
        issue_date || null,
        note || null,
        req.user?.id || null,
      ]
    );
    res.json({ success: true, data: { id: result.insertId } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── 수금 비율 템플릿 ──────────────────────────────────────────
router.get('/templates', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM payment_templates ORDER BY is_default DESC, id ASC`
    );
    const parsed = rows.map(r => ({ ...r, stages: JSON.parse(r.stages_json || '[]') }));
    res.json({ success: true, data: parsed });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/templates', async (req, res) => {
  try {
    const { name, stages } = req.body;
    if (!name || !stages?.length)
      return res.status(400).json({ success: false, error: 'name, stages 필수' });
    const [result] = await pool.query(
      `INSERT INTO payment_templates (name, stages_json, created_by) VALUES (?,?,?)`,
      [name, JSON.stringify(stages), req.user?.id || null]
    );
    res.json({ success: true, data: { id: result.insertId } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── 수금 설정 (품목유형 + 기본 통화) — system_settings key-value ──
//    supplier-info 패턴 동일. 페이지(team_lead+) 에서 직접 관리 가능.
const PAYMENT_STAGE_TYPES_KEY = 'payment_stage_types';
const PAYMENT_DEFAULT_CUR_KEY = 'payment_default_currency';
const DEFAULT_STAGE_TYPES = ['착수금', '중도금', '잔금', '기타'];
const DEFAULT_CURRENCY = 'KRW';
const ALLOWED_CURRENCIES = ['KRW', 'USD', 'JPY', 'EUR', 'GBP', 'CNY', 'AUD', 'SGD', 'HKD', 'VND'];

router.get('/config', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN (?, ?)`,
      [PAYMENT_STAGE_TYPES_KEY, PAYMENT_DEFAULT_CUR_KEY]
    );
    const map = {};
    rows.forEach(r => {
      map[r.setting_key] = r.setting_value;
    });

    let stageTypes = DEFAULT_STAGE_TYPES;
    if (map[PAYMENT_STAGE_TYPES_KEY]) {
      try {
        const parsed = JSON.parse(map[PAYMENT_STAGE_TYPES_KEY]);
        if (Array.isArray(parsed) && parsed.length) {
          stageTypes = parsed.map(s => String(s).slice(0, 50)).filter(Boolean);
        }
      } catch (_e) {
        /* 손상된 값 — 기본값 사용 */
      }
    }
    const defaultCurrency = ALLOWED_CURRENCIES.includes(map[PAYMENT_DEFAULT_CUR_KEY])
      ? map[PAYMENT_DEFAULT_CUR_KEY]
      : DEFAULT_CURRENCY;

    res.json({
      success: true,
      data: {
        stage_types: stageTypes,
        default_currency: defaultCurrency,
        allowed_currencies: ALLOWED_CURRENCIES,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/config', async (req, res) => {
  try {
    const { stage_types, default_currency } = req.body || {};
    const updates = [];

    if (stage_types !== undefined) {
      if (!Array.isArray(stage_types) || !stage_types.length)
        return res
          .status(400)
          .json({ success: false, error: 'stage_types 는 비어있지 않은 배열이어야 합니다' });
      const cleaned = [
        ...new Set(
          stage_types
            .map(s =>
              String(s || '')
                .trim()
                .slice(0, 50)
            )
            .filter(Boolean)
        ),
      ];
      if (!cleaned.length)
        return res.status(400).json({ success: false, error: '유효한 품목유형이 없습니다' });
      updates.push([PAYMENT_STAGE_TYPES_KEY, JSON.stringify(cleaned)]);
    }
    if (default_currency !== undefined) {
      if (!ALLOWED_CURRENCIES.includes(default_currency))
        return res.status(400).json({ success: false, error: '허용되지 않은 통화 코드입니다' });
      updates.push([PAYMENT_DEFAULT_CUR_KEY, default_currency]);
    }
    if (!updates.length)
      return res.status(400).json({ success: false, error: '저장할 항목이 없습니다' });

    for (const [key, value] of updates) {
      await pool.query(
        `INSERT INTO system_settings (setting_key, setting_value) VALUES (?,?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [key, value]
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── 수금 스케줄 일괄 저장 (계약 1건 → 마일스톤 N행) ────────────
//    model A(평면): shared(계약 단위) 정보를 각 마일스톤 행에 비정규화.
//    create + update(upsert) + delete 를 1 트랜잭션으로 원자 처리.
router.post('/batch', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { shared = {}, milestones = [], delete_ids = [] } = req.body || {};

    const customerName = String(shared.customer_name || '').trim();
    if (!customerName) {
      await conn.rollback();
      return res
        .status(400)
        .json({ success: false, error: '고객사명(customer_name)은 필수입니다' });
    }
    if (!Array.isArray(milestones)) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: 'milestones 는 배열이어야 합니다' });
    }
    const delIds = (Array.isArray(delete_ids) ? delete_ids : [])
      .map(n => parseInt(n, 10))
      .filter(n => Number.isInteger(n) && n > 0);
    if (!milestones.length && !delIds.length) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: '저장할 마일스톤이 없습니다' });
    }

    // 계약 단위 비정규화 공통 필드
    const currency = ALLOWED_CURRENCIES.includes(shared.currency) ? shared.currency : 'KRW';
    const sharedCols = {
      contract_id: shared.contract_id || null,
      customer_id: shared.customer_id || null,
      customer_name: customerName,
      contract_name: shared.contract_name ? String(shared.contract_name).slice(0, 200) : null,
      contract_supply_amount:
        shared.contract_supply_amount !== null &&
        shared.contract_supply_amount !== undefined &&
        shared.contract_supply_amount !== ''
          ? Number(shared.contract_supply_amount)
          : null,
      currency,
      contract_start_date: shared.contract_start_date || null,
      contract_end_date: shared.contract_end_date || null,
    };

    // ── 날짜 유효성 검사 (프론트와 동일 규칙을 서버에서도 방어적으로 검증) ──
    //   ① 계약 시작/종료일 연도 4자리  ② 수금예정일 ≥ 계약 시작일
    //   ③ 단계 순서: 착수금 ≤ 중도금 ≤ 잔금 (기본 유형에 한함)
    const YMD = /^\d{4}-\d{2}-\d{2}$/;
    const startDate = sharedCols.contract_start_date
      ? String(sharedCols.contract_start_date).slice(0, 10)
      : null;
    const endDate = sharedCols.contract_end_date
      ? String(sharedCols.contract_end_date).slice(0, 10)
      : null;
    if (startDate && !YMD.test(startDate)) {
      await conn.rollback();
      return res
        .status(400)
        .json({ success: false, error: '계약 시작일의 연도는 4자리여야 합니다' });
    }
    if (endDate && !YMD.test(endDate)) {
      await conn.rollback();
      return res
        .status(400)
        .json({ success: false, error: '계약 종료일의 연도는 4자리여야 합니다' });
    }
    const downArr = [],
      interimArr = [],
      finalArr = [];
    for (let i = 0; i < milestones.length; i++) {
      const raw = milestones[i] && milestones[i].due_date ? String(milestones[i].due_date) : '';
      const dd = raw.slice(0, 10);
      if (!dd) continue; // due_date 필수 검증은 아래 upsert 루프에서 처리
      if (!YMD.test(dd)) {
        await conn.rollback();
        return res
          .status(400)
          .json({
            success: false,
            error: `${i + 1}번째 마일스톤: 수금예정일의 연도는 4자리여야 합니다`,
          });
      }
      if (startDate && YMD.test(startDate) && dd < startDate) {
        await conn.rollback();
        return res
          .status(400)
          .json({
            success: false,
            error: `${i + 1}번째 마일스톤: 수금예정일은 계약 시작일 이후여야 합니다`,
          });
      }
      const sn = String(milestones[i].stage_name || '').trim();
      if (sn === '착수금') downArr.push(dd);
      else if (sn === '중도금') interimArr.push(dd);
      else if (sn === '잔금') finalArr.push(dd);
    }
    downArr.sort();
    interimArr.sort();
    finalArr.sort();
    const downMax = downArr.length ? downArr[downArr.length - 1] : null;
    const interimMin = interimArr.length ? interimArr[0] : null;
    const interimMax = interimArr.length ? interimArr[interimArr.length - 1] : null;
    const finalMin = finalArr.length ? finalArr[0] : null;
    if (downMax && interimMin && interimMin < downMax) {
      await conn.rollback();
      return res
        .status(400)
        .json({ success: false, error: '중도금 수금예정일은 착수금보다 빠를 수 없습니다' });
    }
    if (downMax && finalMin && finalMin < downMax) {
      await conn.rollback();
      return res
        .status(400)
        .json({ success: false, error: '잔금 수금예정일은 착수금보다 빠를 수 없습니다' });
    }
    if (interimMax && finalMin && finalMin < interimMax) {
      await conn.rollback();
      return res
        .status(400)
        .json({ success: false, error: '잔금 수금예정일은 중도금보다 빠를 수 없습니다' });
    }

    // 1) 삭제 (제거된 마일스톤) — 입금기록도 함께 정리
    let deleted = 0;
    if (delIds.length) {
      const ph = delIds.map(() => '?').join(',');
      await conn.query(`DELETE FROM payment_records WHERE schedule_id IN (${ph})`, delIds);
      const [r] = await conn.query(`DELETE FROM payment_schedules WHERE id IN (${ph})`, delIds);
      deleted = r.affectedRows || 0;
    }

    // 2) upsert (id 있으면 UPDATE, 없으면 INSERT)
    const createdIds = [];
    let updated = 0;
    for (let i = 0; i < milestones.length; i++) {
      const m = milestones[i] || {};
      const stageName = String(m.stage_name || '').trim();
      if (!stageName) {
        await conn.rollback();
        return res
          .status(400)
          .json({ success: false, error: `${i + 1}번째 마일스톤: 수금품목유형(stage_name) 필수` });
      }
      if (!m.due_date) {
        await conn.rollback();
        return res
          .status(400)
          .json({ success: false, error: `${i + 1}번째 마일스톤: 수금예정일(due_date) 필수` });
      }
      const supply = Number(m.supply_amount) || 0;
      const tax =
        m.tax_amount !== null && m.tax_amount !== undefined
          ? Number(m.tax_amount)
          : Math.round(supply * 0.1);
      const scheduled =
        m.scheduled_amount !== null && m.scheduled_amount !== undefined
          ? Number(m.scheduled_amount)
          : supply + tax;
      if (!scheduled) {
        await conn.rollback();
        return res
          .status(400)
          .json({ success: false, error: `${i + 1}번째 마일스톤: 수금예정액 필수` });
      }
      const ratio =
        m.ratio !== null && m.ratio !== undefined && m.ratio !== '' ? Number(m.ratio) : null;
      const stageOrder = i + 1;
      const note = m.note ? String(m.note).slice(0, 2000) : null;

      const existingId = parseInt(m.id, 10);
      if (Number.isInteger(existingId) && existingId > 0) {
        await conn.query(
          `UPDATE payment_schedules SET
             contract_id=?, customer_id=?, customer_name=?, contract_name=?,
             contract_supply_amount=?, currency=?, contract_start_date=?, contract_end_date=?,
             stage_name=?, stage_order=?, ratio=?,
             scheduled_amount=?, supply_amount=?, tax_amount=?, due_date=?, note=?
           WHERE id=?`,
          [
            sharedCols.contract_id,
            sharedCols.customer_id,
            sharedCols.customer_name,
            sharedCols.contract_name,
            sharedCols.contract_supply_amount,
            sharedCols.currency,
            sharedCols.contract_start_date,
            sharedCols.contract_end_date,
            stageName,
            stageOrder,
            ratio,
            scheduled,
            supply,
            tax,
            m.due_date,
            note,
            existingId,
          ]
        );
        updated++;
      } else {
        const [result] = await conn.query(
          `INSERT INTO payment_schedules
             (contract_id, customer_id, customer_name, contract_name,
              contract_supply_amount, currency, contract_start_date, contract_end_date,
              stage_name, stage_order, ratio,
              scheduled_amount, supply_amount, tax_amount, due_date, status, note, created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'scheduled', ?,?)`,
          [
            sharedCols.contract_id,
            sharedCols.customer_id,
            sharedCols.customer_name,
            sharedCols.contract_name,
            sharedCols.contract_supply_amount,
            sharedCols.currency,
            sharedCols.contract_start_date,
            sharedCols.contract_end_date,
            stageName,
            stageOrder,
            ratio,
            scheduled,
            supply,
            tax,
            m.due_date,
            note,
            req.user?.id || null,
          ]
        );
        createdIds.push(result.insertId);
      }
    }

    await conn.commit();
    res.json({
      success: true,
      data: { created: createdIds.length, updated, deleted, ids: createdIds },
    });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.release();
  }
});

// ─── F1. 수금 스케줄 목록 ─────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    await syncOverdueStatus();
    const { status, contract_id, customer_id, due_from, due_to, search } = req.query;
    let sql = `
      SELECT ps.*,
             COALESCE(SUM(pr.paid_amount), 0) AS paid_amount,
             c.contract_no
      FROM payment_schedules ps
      LEFT JOIN payment_records pr ON pr.schedule_id = ps.id
      LEFT JOIN contracts c ON c.id = ps.contract_id
      WHERE 1=1`;
    const params = [];
    if (status) {
      sql += ` AND ps.status = ?`;
      params.push(status);
    }
    if (contract_id) {
      sql += ` AND ps.contract_id = ?`;
      params.push(Number(contract_id));
    }
    if (customer_id) {
      sql += ` AND ps.customer_id = ?`;
      params.push(Number(customer_id));
    }
    if (due_from) {
      sql += ` AND ps.due_date >= ?`;
      params.push(due_from);
    }
    if (due_to) {
      sql += ` AND ps.due_date <= ?`;
      params.push(due_to);
    }
    if (search) {
      sql += ` AND (ps.customer_name LIKE ? OR ps.contract_name LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }
    sql += ` GROUP BY ps.id ORDER BY ps.due_date ASC LIMIT 500`;
    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── F1. 수금 스케줄 생성 ─────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const {
      contract_id,
      customer_id,
      customer_name,
      contract_name,
      stage_name,
      stage_order,
      ratio,
      contract_supply_amount,
      scheduled_amount,
      supply_amount,
      tax_amount,
      due_date,
      invoice_date,
      note,
      items_json,
    } = req.body;
    if (!stage_name || !scheduled_amount || !due_date)
      return res
        .status(400)
        .json({ success: false, error: 'stage_name, scheduled_amount, due_date 필수' });

    const [result] = await pool.query(
      `
      INSERT INTO payment_schedules
        (contract_id, customer_id, customer_name, contract_name,
         stage_name, stage_order, ratio, contract_supply_amount,
         scheduled_amount, supply_amount, tax_amount,
         due_date, invoice_date, status, note, items_json, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'scheduled', ?,?,?)
    `,
      [
        contract_id || null,
        customer_id || null,
        customer_name || null,
        contract_name || null,
        stage_name,
        stage_order || 1,
        ratio || null,
        contract_supply_amount || null,
        scheduled_amount,
        supply_amount || null,
        tax_amount || 0,
        due_date,
        invoice_date || null,
        note || null,
        items_json || null,
        req.user?.id || null,
      ]
    );
    res.json({ success: true, data: { id: result.insertId } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── 계약 → 수금 스케줄 자동 생성 ────────────────────────────
router.post('/from-contract/:contractId', async (req, res) => {
  try {
    const contractId = parseInt(req.params.contractId, 10);
    const { template_id, stages } = req.body; // stages: [{name, ratio, due_date, note}]

    // 계약 정보 조회
    const [[contract]] = await pool.query(
      `SELECT c.*, cu.name AS customer_name
       FROM contracts c
       LEFT JOIN customers cu ON cu.id = c.customer_id
       WHERE c.id = ?`,
      [contractId]
    );
    if (!contract)
      return res.status(404).json({ success: false, error: '계약을 찾을 수 없습니다' });

    // 템플릿 or 직접 stages 사용
    let stageList = stages;
    if (!stageList?.length && template_id) {
      const [[tmpl]] = await pool.query(`SELECT stages_json FROM payment_templates WHERE id = ?`, [
        template_id,
      ]);
      stageList = tmpl ? JSON.parse(tmpl.stages_json) : [];
    }
    if (!stageList?.length)
      return res.status(400).json({ success: false, error: 'stages 또는 template_id 필수' });

    const totalAmount = Number(contract.contract_amount) || 0;
    const insertIds = [];
    for (let i = 0; i < stageList.length; i++) {
      const s = stageList[i];
      const amount = s.amount || Math.round((totalAmount * (s.ratio || 0)) / 100);
      const supplyAmt = Math.round(amount / 1.1);
      const taxAmt = amount - supplyAmt;
      const [result] = await pool.query(
        `
        INSERT INTO payment_schedules
          (contract_id, customer_id, customer_name, contract_name,
           stage_name, stage_order, ratio,
           scheduled_amount, supply_amount, tax_amount,
           due_date, status, note, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,  'scheduled', ?,?)
      `,
        [
          contractId,
          contract.customer_id || null,
          contract.customer_name || null,
          contract.title || contract.contract_no,
          s.name,
          i + 1,
          s.ratio || null,
          amount,
          supplyAmt,
          taxAmt,
          s.due_date,
          s.note || null,
          req.user?.id || null,
        ]
      );
      insertIds.push(result.insertId);
    }
    res.json({ success: true, data: { created: insertIds.length, ids: insertIds } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── F1. 스케줄 상세 ──────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [[schedule]] = await pool.query(
      `SELECT ps.*, COALESCE(SUM(pr.paid_amount),0) AS paid_amount, c.contract_no
       FROM payment_schedules ps
       LEFT JOIN payment_records pr ON pr.schedule_id = ps.id
       LEFT JOIN contracts c ON c.id = ps.contract_id
       WHERE ps.id = ?
       GROUP BY ps.id`,
      [id]
    );
    if (!schedule)
      return res.status(404).json({ success: false, error: '스케줄을 찾을 수 없습니다' });

    const [records] = await pool.query(
      `SELECT * FROM payment_records WHERE schedule_id = ? ORDER BY paid_date DESC`,
      [id]
    );
    res.json({ success: true, data: { ...schedule, records } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── F1. 스케줄 수정 ──────────────────────────────────────────
const ALLOWED_SCHEDULE_FIELDS = [
  'stage_name',
  'stage_order',
  'ratio',
  'contract_supply_amount',
  'scheduled_amount',
  'supply_amount',
  'tax_amount',
  'due_date',
  'invoice_date',
  'status',
  'note',
  'customer_name',
  'contract_name',
  'items_json',
  'currency',
  'contract_start_date',
  'contract_end_date',
];

router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const updates = {};
    for (const k of ALLOWED_SCHEDULE_FIELDS) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }
    if (!Object.keys(updates).length)
      return res.status(400).json({ success: false, error: '변경 필드 없음' });

    const sets = Object.keys(updates)
      .map(k => `${k} = ?`)
      .join(', ');
    await pool.query(`UPDATE payment_schedules SET ${sets} WHERE id = ?`, [
      ...Object.values(updates),
      id,
    ]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── F1. 스케줄 삭제 ──────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await pool.query(`DELETE FROM payment_records WHERE schedule_id = ?`, [id]);
    await pool.query(`DELETE FROM payment_schedules WHERE id = ?`, [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── F2. 실제 입금 등록 ───────────────────────────────────────
router.post('/:id/records', async (req, res) => {
  try {
    const scheduleId = parseInt(req.params.id, 10);
    const { paid_amount, paid_date, payment_method, bank_account, reference_no, note } = req.body;
    if (!paid_amount || !paid_date)
      return res.status(400).json({ success: false, error: 'paid_amount, paid_date 필수' });

    // 스케줄 정보 조회
    const [[schedule]] = await pool.query(`SELECT * FROM payment_schedules WHERE id = ?`, [
      scheduleId,
    ]);
    if (!schedule)
      return res.status(404).json({ success: false, error: '스케줄을 찾을 수 없습니다' });

    const [result] = await pool.query(
      `
      INSERT INTO payment_records
        (schedule_id, contract_id, customer_id,
         paid_amount, paid_date, payment_method,
         bank_account, reference_no, note, registered_by)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `,
      [
        scheduleId,
        schedule.contract_id,
        schedule.customer_id,
        paid_amount,
        paid_date,
        payment_method || 'bank_transfer',
        bank_account || null,
        reference_no || null,
        note || null,
        req.user?.id || null,
      ]
    );

    // 수금 상태 자동 갱신
    const collected = await calcCollectedAmount(scheduleId);
    const scheduled = Number(schedule.scheduled_amount);
    let newStatus = schedule.status;
    if (collected >= scheduled) {
      newStatus = 'collected';
    } else if (collected > 0) {
      newStatus = 'partial';
    }
    if (newStatus !== schedule.status) {
      await pool.query(`UPDATE payment_schedules SET status = ? WHERE id = ?`, [
        newStatus,
        scheduleId,
      ]);
    }

    res.json({ success: true, data: { id: result.insertId, new_status: newStatus, collected } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── F2. 입금 이력 조회 ───────────────────────────────────────
router.get('/:id/records', async (req, res) => {
  try {
    const scheduleId = parseInt(req.params.id, 10);
    const [rows] = await pool.query(
      `SELECT * FROM payment_records WHERE schedule_id = ? ORDER BY paid_date DESC`,
      [scheduleId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── F2. 입금 기록 삭제 (오입력 정정) ─────────────────────────
router.delete('/:id/records/:rid', async (req, res) => {
  try {
    const scheduleId = parseInt(req.params.id, 10);
    await pool.query(`DELETE FROM payment_records WHERE id = ? AND schedule_id = ?`, [
      parseInt(req.params.rid, 10),
      scheduleId,
    ]);

    // 상태 재계산
    const [[schedule]] = await pool.query(`SELECT * FROM payment_schedules WHERE id = ?`, [
      scheduleId,
    ]);
    if (schedule) {
      const collected = await calcCollectedAmount(scheduleId);
      const scheduled = Number(schedule.scheduled_amount);
      let newStatus = 'scheduled';
      if (collected >= scheduled) newStatus = 'collected';
      else if (collected > 0) newStatus = 'partial';
      await pool.query(`UPDATE payment_schedules SET status = ? WHERE id = ?`, [
        newStatus,
        scheduleId,
      ]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
