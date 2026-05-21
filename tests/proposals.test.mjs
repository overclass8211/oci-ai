/**
 * Proposals API 통합 테스트 — Phase 1 (CRUD + 상태 + history)
 *
 * 검증 대상: /api/proposals
 *   GET    /next-proposal-no — P-YYYY-NNNN 미리보기
 *   GET    /                 — 목록 (페이징 + 필터)
 *   GET    /:id              — 단건 + history
 *   POST   /                 — 생성 (자동채번 + history)
 *   PUT    /:id              — 수정 (status timestamp 자동)
 *   PATCH  /:id/status       — 상태 전환 + history
 *   DELETE /:id              — CASCADE 삭제
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

const TEST_USER_ID = 1;
const createdIds = [];

beforeAll(async () => {
  // 마이그레이션 완료 대기 — server.js 로드 시 자동 트리거
  // (helpers.mjs 가 server.js 로드)
});

afterAll(async () => {
  if (createdIds.length > 0) {
    await pool.query('DELETE FROM proposals WHERE id IN (?)', [createdIds]);
  }
});

describe('Proposals API — Phase 1', () => {
  let createdId;
  let createdNo;

  it('GET /next-proposal-no — P-YYYY-NNNN 패턴', async () => {
    const res = await api()
      .get('/api/proposals/next-proposal-no?year=2026')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.proposal_no).toMatch(/^P-2026-\d{4}$/);
    expect(res.body.data.year).toBe(2026);
  });

  it('POST / — 신규 제안 + 자동채번 + history 기록', async () => {
    const res = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__제안_A',
        customer_name: '__TEST__고객사_A',
        proposal_date: '2026-05-21',
        due_date: '2026-06-20',
        expected_amount: 50000000,
        currency: 'KRW',
        remark: '테스트 비고',
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.proposal_no).toMatch(/^P-2026-\d{4}$/);
    createdId = res.body.id;
    createdNo = res.body.data.proposal_no;
    createdIds.push(createdId);

    // history 자동 기록 검증
    const detail = await api().get(`/api/proposals/${createdId}`).set('X-User-Id', String(TEST_USER_ID));
    const history = detail.body.data.history;
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history.some(h => h.action_type === 'create')).toBe(true);
  });

  it('POST / — 제안명 누락 시 400', async () => {
    const res = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ customer_name: '__TEST__', proposal_date: '2026-05-21' });
    expect(res.status).toBe(400);
  });

  it('POST / — 고객명 누락 시 400 (lead 도 없는 경우)', async () => {
    const res = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ proposal_title: '__TEST__', proposal_date: '2026-05-21' });
    expect(res.status).toBe(400);
  });

  it('GET / — 목록 (생성한 제안 포함)', async () => {
    const res = await api()
      .get('/api/proposals?search=__TEST__&limit=50')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const found = res.body.data.find(p => p.id === createdId);
    expect(found).toBeDefined();
    expect(found.proposal_no).toBe(createdNo);
    expect(Number(found.expected_amount)).toBe(50000000);
  });

  it('GET /:id — 단건 + lead/quote null + files/revisions/history 배열', async () => {
    const res = await api().get(`/api/proposals/${createdId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(createdId);
    expect(res.body.data.lead).toBeNull();
    expect(res.body.data.quote).toBeNull();
    expect(Array.isArray(res.body.data.files)).toBe(true);
    expect(Array.isArray(res.body.data.revisions)).toBe(true);
    expect(Array.isArray(res.body.data.email_logs)).toBe(true);
    expect(Array.isArray(res.body.data.history)).toBe(true);
  });

  it('GET /:id — 존재하지 않는 ID 404', async () => {
    const res = await api().get('/api/proposals/9999999').set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(404);
  });

  it('PUT /:id — 수정 + history update 기록', async () => {
    const res = await api()
      .put(`/api/proposals/${createdId}`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ proposal_title: '__TEST__제안_A_수정', expected_amount: 60000000 });
    expect(res.status).toBe(200);

    const detail = await api().get(`/api/proposals/${createdId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.proposal_title).toBe('__TEST__제안_A_수정');
    expect(Number(detail.body.data.expected_amount)).toBe(60000000);
    expect(detail.body.data.history.some(h => h.action_type === 'update')).toBe(true);
  });

  it('PATCH /:id/status — draft → sent (sent_at 자동 기록) + history', async () => {
    const r1 = await api()
      .patch(`/api/proposals/${createdId}/status`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'sent' });
    expect(r1.status).toBe(200);
    expect(r1.body.data.status).toBe('sent');

    const detail = await api().get(`/api/proposals/${createdId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.status).toBe('sent');
    expect(detail.body.data.sent_at).toBeTruthy();
    expect(
      detail.body.data.history.some(h => h.action_type === 'status_change' && h.new_value === 'sent')
    ).toBe(true);
  });

  it('PATCH /:id/status — sent → accepted (accepted_at 자동 기록)', async () => {
    const r = await api()
      .patch(`/api/proposals/${createdId}/status`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'accepted' });
    expect(r.status).toBe(200);

    const detail = await api().get(`/api/proposals/${createdId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.accepted_at).toBeTruthy();
  });

  it('PATCH /:id/status — 잘못된 상태값 400', async () => {
    const r = await api()
      .patch(`/api/proposals/${createdId}/status`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'INVALID_X' });
    expect(r.status).toBe(400);
  });

  it('POST / + quote_id 자동 반영 — quote_no/expected_amount 자동', async () => {
    // 1) 임시 견적 생성
    const q = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__견적_for_proposal',
        customer_name: '__TEST__quote_cust',
        quote_date: '2026-05-21',
        items: [{ item_name: 'A', unit_price: 1000000, quantity: 5 }],
      });
    const quoteId = q.body.id;

    // 2) 제안 생성 시 quote_id 만 명시 — customer_name/quote_no/expected_amount 자동
    const res = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__제안_quote연결',
        proposal_date: '2026-05-21',
        quote_id: quoteId,
        // customer_name 생략 → 견적에서 자동 추출
      });
    expect(res.status).toBe(200);
    const propId = res.body.id;
    createdIds.push(propId);

    const detail = await api().get(`/api/proposals/${propId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.quote_id).toBe(quoteId);
    expect(detail.body.data.quote_no).toMatch(/^Q-/);
    expect(detail.body.data.customer_name).toBe('__TEST__quote_cust');
    expect(Number(detail.body.data.expected_amount)).toBe(5000000); // 1000000 * 5
    expect(detail.body.data.quote).toBeDefined();
    expect(detail.body.data.quote.id).toBe(quoteId);

    // 정리 — 견적
    await pool.query('DELETE FROM quotes WHERE id = ?', [quoteId]);
  });

  it('DELETE /:id — 삭제 (CASCADE 로 children)', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__삭제용',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const delId = create.body.id;

    const res = await api().delete(`/api/proposals/${delId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);

    // history 도 CASCADE 로 삭제
    const [history] = await pool.query('SELECT * FROM proposal_history WHERE proposal_id = ?', [delId]);
    expect(history.length).toBe(0);
  });

  it('DELETE /:id — 존재하지 않는 ID 404', async () => {
    const r = await api().delete('/api/proposals/9999999').set('X-User-Id', String(TEST_USER_ID));
    expect(r.status).toBe(404);
  });
});
