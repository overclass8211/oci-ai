/**
 * Quotes API 통합 테스트 — Phase 1 (수동 입력 + 자동 채번)
 *
 * 검증 대상: /api/quotes
 *   GET    /              — 목록
 *   POST   /              — 생성 + 자동채번 + 합계 계산
 *   GET    /:id           — 단건 + 품목
 *   PUT    /:id           — 수정 (헤더 + 품목 일괄 교체)
 *   DELETE /:id           — 삭제 (CASCADE 로 품목 자동 삭제)
 *   POST   /:id/duplicate — 리비전 복사
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

const TEST_USER_ID = 1;
const createdQuoteIds = [];

beforeAll(async () => {
  // 마이그레이션 완료 대기
  const { _migrationPromise } = await import('../src/routes/quotes.js').then(m => m.default ?? m).catch(() => ({}));
  if (_migrationPromise) await _migrationPromise;
});

afterAll(async () => {
  if (createdQuoteIds.length > 0) {
    await pool.query('DELETE FROM quotes WHERE id IN (?)', [createdQuoteIds]);
  }
});

describe('Quotes API', () => {
  let createdId;
  let createdQuoteNo;

  it('POST /api/quotes — 신규 견적 + 자동채번 + 합계 계산', async () => {
    const res = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__견적_A',
        customer_name: '__TEST__고객사_A',
        quote_date: '2026-05-01',
        vat_included: 0,
        items: [
          { item_name: '서버 A', unit_price: 1000000, quantity: 2, discount_pct: 10 },
          { item_name: '서버 B', unit_price: 500000,  quantity: 3, discount_pct: 0  },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.quote_no).toMatch(/^Q-2026-\d{4}$/);
    // 합계: (1000000 * 2 * 0.9) + (500000 * 3) = 1,800,000 + 1,500,000 = 3,300,000
    expect(Number(res.body.data.subtotal)).toBe(3300000);
    // VAT: 별도 → 10% 가산 = 330,000
    expect(Number(res.body.data.vat_amount)).toBe(330000);
    expect(Number(res.body.data.total_amount)).toBe(3630000);
    createdId = res.body.id;
    createdQuoteNo = res.body.data.quote_no;
    createdQuoteIds.push(createdId);
  });

  it('POST /api/quotes — 견적명 누락 시 400', async () => {
    const res = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ customer_name: '__TEST__', quote_date: '2026-05-01', items: [] });
    expect(res.status).toBe(400);
  });

  it('POST /api/quotes — 고객명 누락 시 400', async () => {
    const res = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ name: '__TEST__견적_X', quote_date: '2026-05-01', items: [] });
    expect(res.status).toBe(400);
  });

  it('POST /api/quotes — VAT 포함 시 부가세 0', async () => {
    const res = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__견적_VAT포함',
        customer_name: '__TEST__고객사',
        quote_date: '2026-05-01',
        vat_included: 1,
        items: [{ item_name: 'A', unit_price: 100000, quantity: 1, discount_pct: 0 }],
      });
    expect(res.status).toBe(200);
    expect(Number(res.body.data.subtotal)).toBe(100000);
    expect(Number(res.body.data.vat_amount)).toBe(0);
    expect(Number(res.body.data.total_amount)).toBe(100000);
    createdQuoteIds.push(res.body.id);
  });

  it('GET /api/quotes — 목록 (생성한 견적 포함)', async () => {
    const res = await api()
      .get('/api/quotes?search=__TEST__&limit=50')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    const found = res.body.data.find(q => q.id === createdId);
    expect(found).toBeDefined();
    expect(found.quote_no).toBe(createdQuoteNo);
  });

  it('GET /api/quotes/:id — 단건 + 품목', async () => {
    const res = await api()
      .get(`/api/quotes/${createdId}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(createdId);
    expect(res.body.data.items).toBeDefined();
    expect(res.body.data.items.length).toBe(2);
    // proposed_amount 자동 계산 — 서버 A: 1000000 * 2 * 0.9 = 1,800,000
    const serverA = res.body.data.items.find(it => it.item_name === '서버 A');
    expect(Number(serverA.proposed_amount)).toBe(1800000);
  });

  it('GET /api/quotes/:id — 존재하지 않는 ID 404', async () => {
    const res = await api()
      .get('/api/quotes/9999999')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(404);
  });

  it('PUT /api/quotes/:id — 수정 + 품목 교체', async () => {
    const res = await api()
      .put(`/api/quotes/${createdId}`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__견적_A_수정',
        customer_name: '__TEST__고객사_수정',
        quote_date: '2026-05-15',
        vat_included: 0,
        items: [
          { item_name: '신규품목', unit_price: 200000, quantity: 5, discount_pct: 5 },
        ],
      });
    expect(res.status).toBe(200);
    // 200000 * 5 * 0.95 = 950,000 / VAT 별도 → 95,000 → total 1,045,000
    expect(Number(res.body.data.subtotal)).toBe(950000);
    expect(Number(res.body.data.vat_amount)).toBe(95000);
    expect(Number(res.body.data.total_amount)).toBe(1045000);

    // 재조회로 품목 교체 확인
    const r2 = await api()
      .get(`/api/quotes/${createdId}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(r2.body.data.items.length).toBe(1);
    expect(r2.body.data.items[0].item_name).toBe('신규품목');
  });

  it('POST /api/quotes/:id/duplicate — 리비전 복사', async () => {
    const res = await api()
      .post(`/api/quotes/${createdId}/duplicate`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.revision_no).toBeGreaterThan(1);
    expect(res.body.data.quote_no).toMatch(/^Q-2026-\d{4}$/);
    createdQuoteIds.push(res.body.data.id);

    // 복사본의 품목도 복사됐는지 검증
    const r2 = await api()
      .get(`/api/quotes/${res.body.data.id}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(r2.body.data.items.length).toBe(1);
    expect(r2.body.data.parent_quote_id).toBe(createdId);
  });

  it('DELETE /api/quotes/:id — 삭제 (CASCADE 로 품목도 함께)', async () => {
    // 임시 견적 생성
    const create = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__삭제용',
        customer_name: '__TEST__',
        quote_date: '2026-05-01',
        items: [{ item_name: 'X', unit_price: 100, quantity: 1 }],
      });
    const delId = create.body.id;

    const res = await api()
      .delete(`/api/quotes/${delId}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // 품목도 CASCADE 로 삭제됐는지 (직접 DB 확인)
    const [items] = await pool.query('SELECT * FROM quote_items WHERE quote_id = ?', [delId]);
    expect(items.length).toBe(0);
  });

  it('DELETE /api/quotes/:id — 존재하지 않는 ID 404', async () => {
    const res = await api()
      .delete('/api/quotes/9999999')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(404);
  });
});
