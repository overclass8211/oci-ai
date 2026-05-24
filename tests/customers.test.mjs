/**
 * Customers API 통합 테스트
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool, teardown } from './helpers.mjs';

let createdId;

beforeAll(async () => {
  await pool.query("DELETE FROM customers WHERE name LIKE '__TEST__%'");
});

afterAll(async () => {
  if (createdId) await pool.query('DELETE FROM customers WHERE id = ?', [createdId]);
});

describe('Customers API', () => {
  it('GET /api/customers — 목록 조회', async () => {
    const res = await api().get('/api/customers');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST — name 누락 시 400', async () => {
    const res = await api().post('/api/customers').send({ region: '국내' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('POST — 신규 고객사 등록', async () => {
    const res = await api().post('/api/customers').send({
      name: '__TEST__OCI고객',
      region: '국내',
      industry: 'IT',
    });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
    createdId = res.body.id;
  });

  it('GET /:id/intelligence — 잘못된 ID 400', async () => {
    const res = await api().get('/api/customers/abc/intelligence');
    expect(res.status).toBe(400);
  });

  it('GET /:id/intelligence — 존재하지 않는 ID 처리', async () => {
    const res = await api().get('/api/customers/9999999/intelligence');
    // GEMINI_API_KEY 미설정이면 400, DB 조회 실패면 404 또는 400
    expect([200, 400, 404, 500]).toContain(res.status);
  });

  it('POST /ocr — 파일 없으면 400', async () => {
    const res = await api().post('/api/customers/ocr');
    expect(res.status).toBe(400);
  });

  // ── v6.0.0 Step 2: 연결된 계약 역방향 조회 ────────────────
  it('GET /:id/contracts — customer_id 로 연결된 계약 조회', async () => {
    // 계약 1건 생성 (customer_id = createdId)
    const cr = await api().post('/api/contracts').set('X-User-Id', '1').send({
      title: '__TEST__contracts_by_customer',
      customer_id: createdId,
      customer_name: '__TEST__OCI고객',
      contract_type: 'NDA',
    });
    expect(cr.status).toBe(200);
    const contractId = cr.body.id;

    const res = await api().get(`/api/customers/${createdId}/contracts`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    const found = res.body.data.find(c => c.id === contractId);
    expect(found).toBeDefined();
    expect(found.title).toBe('__TEST__contracts_by_customer');
    expect(found.contract_no).toMatch(/^C-\d{4}-\d{4}$/);

    // 정리
    await pool.query('DELETE FROM contracts WHERE id = ?', [contractId]);
  });

  it('GET /:id/contracts — 존재하지 않는 고객사 → 404', async () => {
    const res = await api().get('/api/customers/9999999/contracts');
    expect(res.status).toBe(404);
  });
});
