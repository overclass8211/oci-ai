/**
 * Payments API 통합 테스트 — 수금 스케줄 일괄 저장(POST /batch) + 설정(GET/PUT /config)
 *
 * 🐛 회귀 방지: 2026-05-29 사용자 보고
 *   "수금 스케줄 등록 시 POST /api/payments/batch 404 (Not Found)"
 *   → 원인: 구버전 dev 서버 미재시작 (프론트 정적 파일만 갱신, 백엔드 라우트 미반영).
 *   → 본 테스트는 라우트가 in-process 앱에 실제 등록·동작함을 보장 (404 가 아님).
 *
 * 검증 대상: /api/payments
 *   GET  /config   — 수금품목유형 + 기본통화 (기본값 fallback)
 *   PUT  /config   — 유효성 검사 (통화 화이트리스트)
 *   POST /batch    — 계약 1건 → 마일스톤 N행 트랜잭션 저장 (Model A 평면)
 *                    create / upsert(UPDATE) / 유효성 400
 */
import { describe, it, expect, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

const TEST_USER_ID = 1;
const createdIds = [];
const createdTaxIds = [];

afterAll(async () => {
  if (createdIds.length > 0) {
    await pool.query('DELETE FROM payment_records WHERE schedule_id IN (?)', [createdIds]);
    await pool.query('DELETE FROM payment_schedules WHERE id IN (?)', [createdIds]);
  }
  if (createdTaxIds.length > 0) {
    await pool.query('DELETE FROM tax_invoices WHERE id IN (?)', [createdTaxIds]);
  }
});

describe('Payments API — 수금 스케줄 일괄 저장 + 설정', () => {
  // ── GET /config ───────────────────────────────────────────
  it('GET /config — stage_types / default_currency / allowed_currencies 반환', async () => {
    const res = await api().get('/api/payments/config').set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.stage_types)).toBe(true);
    expect(res.body.data.stage_types.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.data.allowed_currencies)).toBe(true);
    expect(res.body.data.allowed_currencies).toContain('KRW');
  });

  // ── POST /batch — 핵심 회귀 (404 아님 + N행 생성) ──────────
  it('POST /batch — 계약 1건 → 마일스톤 3행 생성 (404 아님)', async () => {
    const payload = {
      shared: {
        contract_id: null,
        customer_id: null,
        customer_name: '__TEST__수금고객사',
        contract_name: '__TEST__프로젝트A',
        contract_supply_amount: 10000000,
        currency: 'KRW',
        contract_start_date: '2026-01-01',
        contract_end_date: '2026-12-31',
      },
      milestones: [
        {
          stage_name: '착수금',
          ratio: 20,
          due_date: '2026-06-05',
          supply_amount: 2000000,
          tax_amount: 200000,
          scheduled_amount: 2200000,
          note: '비고',
        },
        {
          stage_name: '중도금',
          ratio: 30,
          due_date: '2026-07-03',
          supply_amount: 3000000,
          tax_amount: 300000,
          scheduled_amount: 3300000,
        },
        {
          stage_name: '잔금',
          ratio: 50,
          due_date: '2026-07-16',
          supply_amount: 5000000,
          tax_amount: 500000,
          scheduled_amount: 5500000,
        },
      ],
      delete_ids: [],
    };

    const res = await api()
      .post('/api/payments/batch')
      .set('X-User-Id', String(TEST_USER_ID))
      .send(payload);

    // 핵심: 404 가 아니라 200 (라우트가 등록·동작함)
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.created).toBe(3);
    expect(res.body.data.ids).toHaveLength(3);
    res.body.data.ids.forEach(id => createdIds.push(id));

    // DB 영속화 + 비정규화(통화/계약명) + VAT 합 확인
    const [rows] = await pool.query(
      `SELECT stage_name, supply_amount, tax_amount, scheduled_amount, currency, contract_name
         FROM payment_schedules WHERE id IN (?) ORDER BY stage_order`,
      [res.body.data.ids]
    );
    expect(rows).toHaveLength(3);
    expect(rows[0].stage_name).toBe('착수금');
    expect(Number(rows[0].scheduled_amount)).toBe(2200000);
    expect(Number(rows[0].tax_amount)).toBe(200000);
    expect(rows[0].currency).toBe('KRW');
    expect(rows[0].contract_name).toBe('__TEST__프로젝트A');
  });

  // ── POST /batch — upsert(UPDATE): 기존 id 전달 시 갱신 (중복 생성 안 함) ──
  it('POST /batch — 기존 id 전달 시 UPDATE (created 0 / updated 1)', async () => {
    const targetId = createdIds[0];
    const res = await api()
      .post('/api/payments/batch')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        shared: { customer_name: '__TEST__수금고객사', currency: 'KRW' },
        milestones: [
          {
            id: targetId,
            stage_name: '착수금(수정)',
            due_date: '2026-06-10',
            supply_amount: 2500000,
            tax_amount: 250000,
            scheduled_amount: 2750000,
          },
        ],
        delete_ids: [],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.created).toBe(0);
    expect(res.body.data.updated).toBe(1);

    const [rows] = await pool.query(
      'SELECT stage_name, scheduled_amount FROM payment_schedules WHERE id = ?',
      [targetId]
    );
    expect(rows[0].stage_name).toBe('착수금(수정)');
    expect(Number(rows[0].scheduled_amount)).toBe(2750000);
  });

  // ── 유효성 검사 ────────────────────────────────────────────
  it('POST /batch — customer_name 누락 → 400', async () => {
    const res = await api()
      .post('/api/payments/batch')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        shared: {},
        milestones: [{ stage_name: '착수금', due_date: '2026-06-05', scheduled_amount: 100 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /batch — 마일스톤 stage_name 누락 → 400', async () => {
    const res = await api()
      .post('/api/payments/batch')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        shared: { customer_name: '__TEST__' },
        milestones: [{ due_date: '2026-06-05', scheduled_amount: 100 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  // ── 날짜 유효성 검사 (2026-05-29 추가) ──────────────────────
  //   ① 계약 시작/종료일 연도 4자리  ② due ≥ 계약 시작일  ③ 착수금 ≤ 중도금 ≤ 잔금
  it('POST /batch — 계약 시작일 연도가 4자리가 아니면 → 400', async () => {
    const res = await api()
      .post('/api/payments/batch')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        shared: { customer_name: '__TEST__연도', currency: 'KRW', contract_start_date: '12026-01-01' },
        milestones: [
          { stage_name: '착수금', due_date: '2026-06-05', supply_amount: 1000000, scheduled_amount: 1100000 },
        ],
        delete_ids: [],
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /batch — 수금예정일이 계약 시작일보다 과거면 → 400', async () => {
    const res = await api()
      .post('/api/payments/batch')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        shared: { customer_name: '__TEST__과거', currency: 'KRW', contract_start_date: '2026-03-01' },
        milestones: [
          { stage_name: '착수금', due_date: '2026-02-01', supply_amount: 1000000, scheduled_amount: 1100000 },
        ],
        delete_ids: [],
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /batch — 중도금이 착수금보다 빠르면 → 400', async () => {
    const res = await api()
      .post('/api/payments/batch')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        shared: { customer_name: '__TEST__순서', currency: 'KRW' },
        milestones: [
          { stage_name: '착수금', due_date: '2026-06-10', supply_amount: 1000000, scheduled_amount: 1100000 },
          { stage_name: '중도금', due_date: '2026-06-05', supply_amount: 1000000, scheduled_amount: 1100000 },
        ],
        delete_ids: [],
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /batch — 잔금이 중도금보다 빠르면 → 400', async () => {
    const res = await api()
      .post('/api/payments/batch')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        shared: { customer_name: '__TEST__순서2', currency: 'KRW' },
        milestones: [
          { stage_name: '착수금', due_date: '2026-06-01', supply_amount: 1000000, scheduled_amount: 1100000 },
          { stage_name: '중도금', due_date: '2026-07-01', supply_amount: 1000000, scheduled_amount: 1100000 },
          { stage_name: '잔금', due_date: '2026-06-15', supply_amount: 1000000, scheduled_amount: 1100000 },
        ],
        delete_ids: [],
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  // ── PUT /config — 허용되지 않은 통화 → 400 (라우트 등록 확인, 부수효과 없음) ──
  it('PUT /config — 허용되지 않은 통화 코드 → 400', async () => {
    const res = await api()
      .put('/api/payments/config')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ default_currency: 'XXX' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ── 세금계산서(tax invoices) — 발행요청 UI 백엔드 (2026-05-31 Phase 2 키 불필요) ──
//   draft(작성중) → requested(발행요청) → issued(발행완료, 수동 기록) → cancelled(취소)
//   ※ 바로빌 자동발행/국세청 전송 아님 — 상태를 수동으로 관리
describe('Payments API — 세금계산서(tax invoices) 발행요청 + 상태 전환', () => {
  let taxId;

  it('POST /tax-invoices — draft 생성 → 200 + id (합계/번호 저장)', async () => {
    const res = await api()
      .post('/api/payments/tax-invoices')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        customer_name: '__TEST__세금고객사',
        invoice_no: 'TEST-0001',
        supply_amount: 1000000,
        tax_amount: 100000,
        issue_date: '2026-06-30',
        note: '테스트 발행요청',
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeTruthy();
    taxId = res.body.data.id;
    createdTaxIds.push(taxId);

    const [[row]] = await pool.query(
      'SELECT status, total_amount, invoice_no FROM tax_invoices WHERE id = ?',
      [taxId]
    );
    expect(row.status).toBe('draft');
    expect(Number(row.total_amount)).toBe(1100000);
    expect(row.invoice_no).toBe('TEST-0001');
  });

  it('POST /tax-invoices — supply_amount 누락 → 400', async () => {
    const res = await api()
      .post('/api/payments/tax-invoices')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ customer_name: '__TEST__무공급가' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('PUT /tax-invoices/:id — 허용되지 않은 상태값 → 400', async () => {
    const res = await api()
      .put(`/api/payments/tax-invoices/${taxId}`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'unknown_status' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('PUT /tax-invoices/:id — 발행완료(issued) 전환 → issued_at 자동 기록', async () => {
    const res = await api()
      .put(`/api/payments/tax-invoices/${taxId}`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'issued' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const [[row]] = await pool.query('SELECT status, issued_at FROM tax_invoices WHERE id = ?', [
      taxId,
    ]);
    expect(row.status).toBe('issued');
    expect(row.issued_at).not.toBeNull();
  });

  it('DELETE /tax-invoices/:id — 발행완료 건은 삭제 차단 → 400', async () => {
    const res = await api()
      .delete(`/api/payments/tax-invoices/${taxId}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('GET /tax-invoices — 목록에 생성 건 포함', async () => {
    const res = await api()
      .get('/api/payments/tax-invoices')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.some(t => t.id === taxId)).toBe(true);
  });

  it('DELETE /tax-invoices/:id — draft 건은 삭제 성공 → 200', async () => {
    const c = await api()
      .post('/api/payments/tax-invoices')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ customer_name: '__TEST__삭제용', supply_amount: 500000, tax_amount: 50000 });
    const delId = c.body.data.id;
    const res = await api()
      .delete(`/api/payments/tax-invoices/${delId}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const [rows] = await pool.query('SELECT id FROM tax_invoices WHERE id = ?', [delId]);
    expect(rows).toHaveLength(0);
  });
});
