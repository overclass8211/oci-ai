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
    // vat_included=0 → 부가세 미포함 → 가산 안 함 (사용자 의도)
    expect(Number(res.body.data.vat_amount)).toBe(0);
    expect(Number(res.body.data.total_amount)).toBe(3300000);
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

  // 🐛 사용자 보고 — 공급단가 = 단가 × (1-할인%/100), 제안금액 = 공급단가 × 수량
  it('POST /api/quotes — 공급단가 자동 계산 (할인 0% → 단가와 동일)', async () => {
    const res = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__공급단가_할인0',
        customer_name: '__TEST__',
        quote_date: '2026-05-01',
        items: [
          // 단가 1000, 할인 0%, 수량 3 → 공급단가 1000, 제안금액 3000
          { item_name: 'A', unit_price: 1000, discount_pct: 0, quantity: 3 },
        ],
      });
    expect(res.status).toBe(200);
    const newId = res.body.id;
    createdQuoteIds.push(newId);

    const r2 = await api().get(`/api/quotes/${newId}`).set('X-User-Id', String(TEST_USER_ID));
    const it = r2.body.data.items[0];
    expect(Number(it.supply_price)).toBe(1000); // 할인 0% → 단가와 동일
    expect(Number(it.proposed_amount)).toBe(3000); // 1000 × 3
    expect(Number(r2.body.data.subtotal)).toBe(3000);
  });

  it('POST /api/quotes — 공급단가 자동 계산 (할인 15% 적용)', async () => {
    const res = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__공급단가_할인15',
        customer_name: '__TEST__',
        quote_date: '2026-05-01',
        items: [
          // 단가 2000, 할인 15%, 수량 4 → 공급단가 1700, 제안금액 6800
          { item_name: 'A', unit_price: 2000, discount_pct: 15, quantity: 4 },
        ],
      });
    expect(res.status).toBe(200);
    const newId = res.body.id;
    createdQuoteIds.push(newId);

    const r2 = await api().get(`/api/quotes/${newId}`).set('X-User-Id', String(TEST_USER_ID));
    const it = r2.body.data.items[0];
    expect(Number(it.supply_price)).toBe(1700); // 2000 × 0.85
    expect(Number(it.proposed_amount)).toBe(6800); // 1700 × 4
  });

  it('POST /api/quotes — 사용자가 잘못된 supply_price 보내도 서버가 자동 재계산 (보안)', async () => {
    const res = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__공급단가_조작방어',
        customer_name: '__TEST__',
        quote_date: '2026-05-01',
        items: [
          // 사용자가 supply_price=99999 보내도 서버는 1000 × 0.9 = 900 로 자동 계산
          {
            item_name: 'A',
            unit_price: 1000,
            discount_pct: 10,
            quantity: 1,
            supply_price: 99999, // 조작 시도
          },
        ],
      });
    expect(res.status).toBe(200);
    const newId = res.body.id;
    createdQuoteIds.push(newId);

    const r2 = await api().get(`/api/quotes/${newId}`).set('X-User-Id', String(TEST_USER_ID));
    const it = r2.body.data.items[0];
    expect(Number(it.supply_price)).toBe(900); // 99999 무시, 자동 계산
    expect(Number(it.proposed_amount)).toBe(900); // 900 × 1
  });

  it('POST /api/quotes — lead_id 저장 + 조회 시 반환', async () => {
    const res = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__견적_lead연결',
        customer_name: '__TEST__고객사',
        quote_date: '2026-05-01',
        lead_id: 99999, // FK 없으니 임의 값
        items: [{ item_name: 'L', unit_price: 100, quantity: 1 }],
      });
    expect(res.status).toBe(200);
    const newId = res.body.id;
    createdQuoteIds.push(newId);

    const r2 = await api()
      .get(`/api/quotes/${newId}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(r2.body.data.lead_id).toBe(99999);
  });

  it('PUT /api/quotes/:id — 품목 순서 변경 시 display_order 재계산', async () => {
    // 임시 견적 — 품목 3개
    const create = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__순서변경',
        customer_name: '__TEST__',
        quote_date: '2026-05-01',
        items: [
          { item_name: 'A', unit_price: 100, quantity: 1 },
          { item_name: 'B', unit_price: 200, quantity: 1 },
          { item_name: 'C', unit_price: 300, quantity: 1 },
        ],
      });
    const sortId = create.body.id;
    createdQuoteIds.push(sortId);

    // [C, A, B] 로 재정렬 — Sortable.js 가 _items 배열 reorder 후 PUT
    const put = await api()
      .put(`/api/quotes/${sortId}`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__순서변경',
        customer_name: '__TEST__',
        quote_date: '2026-05-01',
        items: [
          { item_name: 'C', unit_price: 300, quantity: 1 },
          { item_name: 'A', unit_price: 100, quantity: 1 },
          { item_name: 'B', unit_price: 200, quantity: 1 },
        ],
      });
    expect(put.status).toBe(200);

    // GET 재조회 — display_order ASC 정렬 시 [C, A, B] 순
    const r2 = await api()
      .get(`/api/quotes/${sortId}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(r2.body.data.items.map((it) => it.item_name)).toEqual(['C', 'A', 'B']);
    // display_order 가 0, 1, 2 로 재계산됐는지
    expect(r2.body.data.items.map((it) => Number(it.display_order))).toEqual([0, 1, 2]);
  });

  // 🐛 사용자 보고 — 부가세 포함 시 10% 가산 (이전: 반대로 동작)
  it('POST /api/quotes — vat_included=1 → 부가세 10% 가산', async () => {
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
    expect(Number(res.body.data.vat_amount)).toBe(10000); // 10% 가산
    expect(Number(res.body.data.total_amount)).toBe(110000); // 100k + 10k
    createdQuoteIds.push(res.body.id);
  });

  it('POST /api/quotes — vat_included=0 → 부가세 가산 안 함', async () => {
    const res = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__견적_VAT미포함',
        customer_name: '__TEST__고객사',
        quote_date: '2026-05-01',
        vat_included: 0,
        items: [{ item_name: 'A', unit_price: 100000, quantity: 1, discount_pct: 0 }],
      });
    expect(res.status).toBe(200);
    expect(Number(res.body.data.subtotal)).toBe(100000);
    expect(Number(res.body.data.vat_amount)).toBe(0); // 가산 안 함
    expect(Number(res.body.data.total_amount)).toBe(100000); // 소계 = 총합계
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
    // 공급단가 = 200000 * 0.95 = 190,000 / 제안금액 = 190,000 * 5 = 950,000
    // vat_included=0 → 미포함 → vat=0, total = subtotal
    expect(Number(res.body.data.subtotal)).toBe(950000);
    expect(Number(res.body.data.vat_amount)).toBe(0);
    expect(Number(res.body.data.total_amount)).toBe(950000);

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
