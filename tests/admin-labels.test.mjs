/**
 * 워드 사전(Word Repository) API 테스트
 *
 * 검증:
 *   - GET  /api/admin/labels           — 도메인 목록 + 라벨 dict + 기본값/현재값
 *   - PUT  /api/admin/labels/:scope/:k — 단건 저장 + audit 기록
 *   - PUT  /api/admin/labels (bulk)    — 일괄 저장
 *   - POST /api/admin/labels/reset     — scope 단위 / 전체 초기화
 *   - GET  /api/admin/labels/audit     — 변경 이력 조회
 *   - GET  /api/labels (public)        — 평탄화된 dict (모든 인증 사용자)
 *   - 알 수 없는 scope/key 거부 (400)
 *   - 빈 라벨 거부 (400)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

beforeAll(async () => {
  // 테스트 영향 격리 — 영업리드 도메인 오버라이드/이력 제거
  await pool.query("DELETE FROM admin_labels WHERE scope = 'leads'");
  await pool.query("DELETE FROM admin_label_audit WHERE scope = 'leads'");
});

afterAll(async () => {
  await pool.query("DELETE FROM admin_labels WHERE scope = 'leads'");
  await pool.query("DELETE FROM admin_label_audit WHERE scope = 'leads'");
});

describe('Word Repository — /api/admin/labels', () => {
  it('GET / — 도메인 목록 + 기본값 dict 반환', async () => {
    const r = await api().get('/api/admin/labels');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data.scopes)).toBe(true);
    expect(r.body.data.scopes).toContain('leads');
    expect(r.body.data.labels.leads.customer_name).toBeDefined();
    expect(r.body.data.labels.leads.customer_name.default).toBe('고객사');
    expect(r.body.data.labels.leads.customer_name.current).toBe('고객사');
    expect(r.body.data.labels.leads.customer_name.overridden).toBe(false);
  });

  it('GET /scope/:scope — 특정 도메인만', async () => {
    const r = await api().get('/api/admin/labels/scope/leads');
    expect(r.status).toBe(200);
    expect(r.body.data.customer_name).toBeDefined();
  });

  it('GET /scope/UNKNOWN — 404', async () => {
    const r = await api().get('/api/admin/labels/scope/__nope__');
    expect(r.status).toBe(404);
  });

  it('PUT /:scope/:key — 단건 저장 + audit 기록', async () => {
    const r = await api()
      .put('/api/admin/labels/leads/customer_name')
      .send({ label: '거래처' });
    expect(r.status).toBe(200);
    expect(r.body.changed).toBe(true);

    // overridden 반영 확인
    const g = await api().get('/api/admin/labels/scope/leads');
    expect(g.body.data.customer_name.current).toBe('거래처');
    expect(g.body.data.customer_name.overridden).toBe(true);

    // audit 1건 이상
    const a = await api().get('/api/admin/labels/audit?limit=10');
    expect(a.status).toBe(200);
    const last = a.body.data.find(x => x.scope === 'leads' && x.key_name === 'customer_name');
    expect(last).toBeDefined();
    expect(last.new_label).toBe('거래처');
  });

  it('PUT / (bulk) — 여러 라벨 일괄 저장', async () => {
    const r = await api()
      .put('/api/admin/labels')
      .send({
        items: [
          { scope: 'leads', key: 'project_name',   label: '사업명' },
          { scope: 'leads', key: 'business_type',  label: '제품군' },
        ],
      });
    expect(r.status).toBe(200);
    expect(r.body.changed).toBe(2);

    const g = await api().get('/api/admin/labels/scope/leads');
    expect(g.body.data.project_name.current).toBe('사업명');
    expect(g.body.data.business_type.current).toBe('제품군');
  });

  it('PUT — 알 수 없는 scope.key 거부 (400)', async () => {
    const r = await api()
      .put('/api/admin/labels/leads/__nope__')
      .send({ label: 'X' });
    expect(r.status).toBe(400);
  });

  it('PUT — 빈 라벨 거부 (400)', async () => {
    const r = await api()
      .put('/api/admin/labels/leads/customer_name')
      .send({ label: '   ' });
    expect(r.status).toBe(400);
  });

  it('POST /reset — scope 단위 초기화', async () => {
    // 사전 조건: 위에서 overridden 상태
    const r = await api().post('/api/admin/labels/reset').send({ scope: 'leads' });
    expect(r.status).toBe(200);
    expect(r.body.reset).toBeGreaterThan(0);

    const g = await api().get('/api/admin/labels/scope/leads');
    expect(g.body.data.customer_name.current).toBe('고객사');
    expect(g.body.data.customer_name.overridden).toBe(false);
  });

  it('GET /api/labels (public) — 평탄화 dict', async () => {
    // 오버라이드 1건 다시 적용
    await api().put('/api/admin/labels/leads/customer_name').send({ label: '거래처' });

    const r = await api().get('/api/labels');
    expect(r.status).toBe(200);
    expect(r.body.data.leads.customer_name).toBe('거래처');
    expect(r.body.data.leads.project_name).toBe('프로젝트');
    expect(typeof r.body.ts).toBe('number');
  });
});
