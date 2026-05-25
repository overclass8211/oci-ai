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
    // v6.0.0: lead_comments 정리 (FK CASCADE 가 동작하지만 안전망)
    try {
      await pool.query('DELETE FROM lead_comments WHERE lead_id = ?', [createdLeadId]);
    } catch (_) {
      /* table may not exist */
    }
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

  // ── v6.0.0: 댓글 (계약 패턴 통일) ─────────────────────────
  it('GET /:id/comments — 빈 목록 (자가 마이그레이션 검증)', async () => {
    const res = await api().get(`/api/leads/${createdLeadId}/comments`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST /:id/comments — 댓글 등록 + 응답 형식 검증', async () => {
    const r = await api()
      .post(`/api/leads/${createdLeadId}/comments`)
      .set('X-User-Id', '1')
      .send({ body: '테스트 댓글 (vitest)', comment_type: 'coach' });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.data.id).toBeGreaterThan(0);
    expect(r.body.data.comment_type).toBe('coach');
  });

  it('POST /:id/comments — 빈 본문 → 400', async () => {
    const r = await api()
      .post(`/api/leads/${createdLeadId}/comments`)
      .send({ body: '' });
    expect(r.status).toBe(400);
    expect(r.body.success).toBe(false);
  });

  it('POST /:id/comments — 잘못된 comment_type → general 로 fallback', async () => {
    const r = await api()
      .post(`/api/leads/${createdLeadId}/comments`)
      .send({ body: '타입 검증', comment_type: 'invalid_type' });
    expect(r.status).toBe(200);
    expect(r.body.data.comment_type).toBe('general');
  });

  it('GET /:id/comments — 등록한 댓글 목록 반환 (ORDER BY created_at ASC)', async () => {
    const res = await api().get(`/api/leads/${createdLeadId}/comments`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    const types = res.body.data.map(c => c.comment_type);
    expect(types).toContain('coach');
    expect(types).toContain('general');
  });

  it('POST /:id/comments — 존재하지 않는 리드 → 404', async () => {
    const r = await api()
      .post('/api/leads/9999999/comments')
      .send({ body: '존재 안함' });
    expect(r.status).toBe(404);
  });
});
