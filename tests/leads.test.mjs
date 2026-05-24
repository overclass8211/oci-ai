/**
 * 리드(Lead) API 통합 테스트 — 라이프사이클 + 정리.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool, teardown } from './helpers.mjs';

let createdLeadId;

beforeAll(async () => {
  await pool.query("DELETE FROM leads WHERE customer_name LIKE '__TEST__%'");
});

afterAll(async () => {
  if (createdLeadId) {
    await pool.query('DELETE FROM activities WHERE lead_id = ?', [createdLeadId]);
    await pool.query('DELETE FROM leads WHERE id = ?', [createdLeadId]);
  }
});

describe('Leads API', () => {
  it('GET /api/leads — 목록 조회', async () => {
    const res = await api().get('/api/leads');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET ?stage=bidding — 필터 적용', async () => {
    const res = await api().get('/api/leads?stage=bidding');
    expect(res.status).toBe(200);
    res.body.data.forEach(l => expect(l.stage).toBe('bidding'));
  });

  it('POST — 신규 등록', async () => {
    const res = await api().post('/api/leads').send({
      customer_name: '__TEST__고객사',
      project_name: '__TEST__테스트 프로젝트',
      business_type: '태양광',
      region: '국내',
      capacity_mw: 10,
      expected_amount: 5,
      currency: 'KRW',
      stage: 'lead',
    });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
    createdLeadId = res.body.id;
  });

  it('PATCH /:id/stage — 단계 변경 + 활동 자동 기록', async () => {
    const res = await api().patch(`/api/leads/${createdLeadId}/stage`).send({ stage: 'review' });
    expect(res.status).toBe(200);

    const [acts] = await pool.query(
      'SELECT title FROM activities WHERE lead_id = ? ORDER BY id DESC LIMIT 1',
      [createdLeadId]
    );
    expect(acts[0].title).toContain('단계 변경');
  });

  it('GET /:id — 상세 (활동 포함)', async () => {
    const res = await api().get(`/api/leads/${createdLeadId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(createdLeadId);
    expect(Array.isArray(res.body.data.activities)).toBe(true);
  });

  // ── v6.0.0 Step 2: 연결된 계약 역방향 조회 ────────────────
  it('GET /:id/contracts — lead_id 로 연결된 계약 조회', async () => {
    const cr = await api().post('/api/contracts').set('X-User-Id', '1').send({
      title: '__TEST__contracts_by_lead',
      lead_id: createdLeadId,
      customer_name: '__TEST__고객사',
      contract_type: 'service',
    });
    expect(cr.status).toBe(200);
    const contractId = cr.body.id;

    const res = await api().get(`/api/leads/${createdLeadId}/contracts`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const found = res.body.data.find(c => c.id === contractId);
    expect(found).toBeDefined();
    expect(found.title).toBe('__TEST__contracts_by_lead');

    await pool.query('DELETE FROM contracts WHERE id = ?', [contractId]);
  });

  it('GET /:id/contracts — 존재하지 않는 리드 → 404', async () => {
    const res = await api().get('/api/leads/9999999/contracts');
    expect(res.status).toBe(404);
  });
});
