/**
 * Gmail Phase G1 — 라우트 응답 회귀
 *
 * 실제 Gmail API 호출은 외부 의존이므로,
 * 입력 검증 / 미연결 / 404 / 400 응답이 모두 JSON 으로 안전한지 검증.
 *
 * NOTE: 테스트 환경에서는 rbac.js 의 authenticate 미들웨어가 NODE_ENV=test 시 통과 (no req.user).
 * 그러나 gmail 라우트는 google.js#requireAuth 를 별도 사용하므로 JWT 필요.
 * → 라우트 단위 테스트는 "auth 토큰 없이 401" 정도로 그치고,
 *   상세 동작은 통합/E2E 로 검증.
 */
import { describe, it, expect } from 'vitest';
import { api } from './helpers.mjs';

describe('Gmail API — 인증/검증', () => {
  it('GET /api/gmail/scope-status — 토큰 없으면 401', async () => {
    const res = await api().get('/api/gmail/scope-status');
    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.success).toBe(false);
  });

  it('GET /api/gmail/messages — 토큰 없으면 401', async () => {
    const res = await api().get('/api/gmail/messages?email=test@example.com');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('GET /api/gmail/match/lead/:id — 토큰 없으면 401', async () => {
    const res = await api().get('/api/gmail/match/lead/1');
    expect(res.status).toBe(401);
  });

  it('GET /api/gmail/match/customer/:id — 토큰 없으면 401', async () => {
    const res = await api().get('/api/gmail/match/customer/1');
    expect(res.status).toBe(401);
  });

  // Phase G2 — 발송
  it('POST /api/gmail/send — 토큰 없으면 401', async () => {
    const res = await api().post('/api/gmail/send').send({
      to: 'x@example.com', subject: 't', body: 'b',
    });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
