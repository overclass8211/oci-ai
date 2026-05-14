/**
 * Projects API 통합 테스트
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

let createdId;

beforeAll(async () => {
  await pool.query("DELETE FROM projects WHERE name LIKE '__TEST__%'");
});

afterAll(async () => {
  if (createdId) await pool.query('DELETE FROM projects WHERE id = ?', [createdId]);
});

describe('Projects API', () => {
  it('GET /api/projects — 목록 조회', async () => {
    const res = await api().get('/api/projects');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST — 신규 프로젝트 등록', async () => {
    const res = await api().post('/api/projects').send({
      name: '__TEST__태양광 1MW',
      customer_name: '__TEST__고객사',
      project_type: '태양광',
      contract_amount: 1000,
      estimated_cost: 800,
      status: '진행중',
    });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
    createdId = res.body.id;
  });

  it('PUT /:id — 수정 (마진 자동 계산)', async () => {
    const res = await api().put(`/api/projects/${createdId}`).send({
      contract_amount: 1200,
      estimated_cost: 900,
      status: '완료',
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('PUT /:id — 변경 없이 호출해도 200', async () => {
    const res = await api().put(`/api/projects/${createdId}`).send({});
    expect(res.status).toBe(200);
  });

  it('DELETE /:id — 삭제', async () => {
    const res = await api().delete(`/api/projects/${createdId}`);
    expect(res.status).toBe(200);
    createdId = null;
  });
});
