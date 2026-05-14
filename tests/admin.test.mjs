/**
 * 관리자 + AI 사용량 API 통합 테스트.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { api } from './helpers.mjs';


describe('Admin & AI Usage API', () => {
  it('GET /api/admin/settings — idle/token 정책 키 존재', async () => {
    const res = await api().get('/api/admin/settings');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('idle_timeout_min');
    expect(res.body.data).toHaveProperty('default_monthly_token_limit');
  });

  it('PUT — 변경 → 조회 → 원복', async () => {
    const original = (await api().get('/api/admin/settings')).body.data;
    const newVal = String(parseInt(original.idle_timeout_min) === 99 ? 30 : 99);

    const put = await api().put('/api/admin/settings').send({ idle_timeout_min: newVal });
    expect(put.status).toBe(200);

    const verify = (await api().get('/api/admin/settings')).body.data;
    expect(verify.idle_timeout_min).toBe(newVal);

    await api().put('/api/admin/settings').send({ idle_timeout_min: original.idle_timeout_min });
  });

  it('GET /api/admin/token-usage-by-user — 사용자 + defaultLimit', async () => {
    const res = await api().get('/api/admin/token-usage-by-user');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.defaultLimit).toBe('number');
  });

  it('GET /api/ai/usage/today — 오늘 누계 (숫자)', async () => {
    const res = await api().get('/api/ai/usage/today');
    expect(res.status).toBe(200);
    expect(typeof res.body.data.total).toBe('number');
    expect(typeof res.body.data.calls).toBe('number');
  });
});
