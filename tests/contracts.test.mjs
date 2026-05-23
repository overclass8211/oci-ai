/**
 * Contracts API 통합 테스트 — Phase 0 (CRUD + 파일 + history)
 *
 * 검증 대상: /api/contracts
 *   GET    /next-contract-no            — C-YYYY-NNNN 미리보기
 *   GET    /                            — 목록 (페이징 + 필터)
 *   GET    /:id                         — 단건 + files + history
 *   POST   /                            — 생성 (자동채번 + history)
 *   PUT    /:id                         — 수정 (diff history)
 *   DELETE /:id                         — CASCADE 삭제
 *   POST   /:id/files                   — 파일 업로드
 *   GET    /:id/files/:fileId/download  — 다운로드
 *   DELETE /:id/files/:fileId           — 파일 삭제
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { api, pool } from './helpers.mjs';

const TEST_USER_ID = 1;
const createdIds = [];
const TEST_FILE = path.join(process.cwd(), 'tests', '__contract_dummy.pdf');

beforeAll(async () => {
  // 더미 PDF 파일 생성 (PDF header 만 — 실제 분석은 안 함)
  if (!fs.existsSync(TEST_FILE)) {
    const PDF_MIN = Buffer.from(
      '%PDF-1.4\n1 0 obj<<>>endobj\nxref\n0 1\n0000000000 65535 f\ntrailer<</Size 1>>\nstartxref\n50\n%%EOF',
      'utf8'
    );
    fs.writeFileSync(TEST_FILE, PDF_MIN);
  }
});

afterAll(async () => {
  if (createdIds.length > 0) {
    await pool.query('DELETE FROM contracts WHERE id IN (?)', [createdIds]);
  }
  if (fs.existsSync(TEST_FILE)) {
    try {
      fs.unlinkSync(TEST_FILE);
    } catch (_) {
      /* 무시 */
    }
  }
});

describe('Contracts API — Phase 0', () => {
  let createdId;
  let createdNo;

  it('GET /next-contract-no — C-YYYY-NNNN 패턴', async () => {
    const res = await api()
      .get('/api/contracts/next-contract-no?year=2026')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.contract_no).toMatch(/^C-2026-\d{4}$/);
    expect(res.body.data.year).toBe(2026);
  });

  it('POST / — 신규 계약 + 자동채번 + history 기록', async () => {
    const res = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__NDA_A사',
        customer_name: '__TEST__고객사_A',
        contract_type: 'NDA',
        start_date: '2026-05-23',
        end_date: '2027-05-22',
        contract_amount: 30000000,
        currency: 'KRW',
        auto_renewal: true,
        renewal_notice_days: 60,
        notes: '테스트 비고',
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.contract_no).toMatch(/^C-2026-\d{4}$/);
    createdId = res.body.id;
    createdNo = res.body.data.contract_no;
    createdIds.push(createdId);

    // history 자동 기록 확인
    const detail = await api()
      .get(`/api/contracts/${createdId}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(detail.status).toBe(200);
    expect(detail.body.data.contract_no).toBe(createdNo);
    expect(detail.body.data.contract_type).toBe('NDA');
    expect(detail.body.data.auto_renewal).toBe(1);
    const history = detail.body.data.history;
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history.some(h => h.action_type === 'create')).toBe(true);
  });

  it('POST / — 제목 누락 시 400', async () => {
    const res = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ customer_name: '__TEST__' });
    expect(res.status).toBe(400);
  });

  it('POST / — 유효하지 않은 contract_type → etc 로 보정', async () => {
    const res = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__bogus_type',
        customer_name: '__TEST__',
        contract_type: 'invalid_xyz',
      });
    expect(res.status).toBe(200);
    const id = res.body.id;
    createdIds.push(id);
    const detail = await api()
      .get(`/api/contracts/${id}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.contract_type).toBe('etc');
  });

  it('GET / — 목록 검색 (생성한 계약 포함)', async () => {
    const res = await api()
      .get('/api/contracts?search=__TEST__&limit=50')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const found = res.body.data.find(c => c.id === createdId);
    expect(found).toBeDefined();
    expect(found.contract_no).toBe(createdNo);
    expect(Number(found.contract_amount)).toBe(30000000);
  });

  it('GET / — status 필터', async () => {
    const res = await api()
      .get('/api/contracts?status=draft&limit=50')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.data.every(c => c.status === 'draft')).toBe(true);
  });

  it('PUT /:id — 수정 + diff history 자동 기록', async () => {
    const res = await api()
      .put(`/api/contracts/${createdId}`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__NDA_A사_v2',
        status: 'review',
        contract_amount: 35000000,
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const detail = await api()
      .get(`/api/contracts/${createdId}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.title).toBe('__TEST__NDA_A사_v2');
    expect(detail.body.data.status).toBe('review');
    expect(Number(detail.body.data.contract_amount)).toBe(35000000);
    // diff history: title/status/contract_amount 3건이 기록되어야 함
    const history = detail.body.data.history;
    expect(history.some(h => h.field_name === 'title')).toBe(true);
    expect(history.some(h => h.field_name === 'status' && h.action_type === 'status_change')).toBe(
      true
    );
    expect(history.some(h => h.field_name === 'contract_amount')).toBe(true);
  });

  it('PUT /:id — 잘못된 status → 400', async () => {
    const res = await api()
      .put(`/api/contracts/${createdId}`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'bogus_status' });
    expect(res.status).toBe(400);
  });

  it('POST /:id/files — 파일 업로드 + history', async () => {
    const res = await api()
      .post(`/api/contracts/${createdId}/files`)
      .set('X-User-Id', String(TEST_USER_ID))
      .field('file_type', 'contract')
      .field('version_no', '1')
      .field('is_final', '0')
      .attach('files', TEST_FILE);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.uploaded.length).toBe(1);

    const detail = await api()
      .get(`/api/contracts/${createdId}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(Array.isArray(detail.body.data.files)).toBe(true);
    expect(detail.body.data.files.length).toBe(1);
    expect(detail.body.data.files[0].file_type).toBe('contract');
    expect(detail.body.data.history.some(h => h.action_type === 'file_upload')).toBe(true);
  });

  it('GET /:id/files/:fileId/download — 다운로드 200', async () => {
    const detail = await api()
      .get(`/api/contracts/${createdId}`)
      .set('X-User-Id', String(TEST_USER_ID));
    const fileId = detail.body.data.files[0].id;
    const res = await api()
      .get(`/api/contracts/${createdId}/files/${fileId}/download`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
  });

  it('DELETE /:id/files/:fileId — 파일 삭제 + history', async () => {
    const detail = await api()
      .get(`/api/contracts/${createdId}`)
      .set('X-User-Id', String(TEST_USER_ID));
    const fileId = detail.body.data.files[0].id;
    const res = await api()
      .delete(`/api/contracts/${createdId}/files/${fileId}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);

    const detail2 = await api()
      .get(`/api/contracts/${createdId}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(detail2.body.data.files.length).toBe(0);
    expect(detail2.body.data.history.some(h => h.action_type === 'file_delete')).toBe(true);
  });

  it('GET /:id — 존재하지 않는 ID → 404', async () => {
    const res = await api()
      .get('/api/contracts/999999999')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(404);
  });

  it('DELETE /:id — CASCADE 삭제', async () => {
    // 새 계약 생성 후 파일 1건 업로드, 그 후 DELETE → files/history 동반 삭제 확인
    const cr = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__del_cascade',
        customer_name: '__TEST__',
        contract_type: 'service',
        start_date: '2026-05-23',
      });
    const id = cr.body.id;
    createdIds.push(id);

    await api()
      .post(`/api/contracts/${id}/files`)
      .set('X-User-Id', String(TEST_USER_ID))
      .field('file_type', 'contract')
      .attach('files', TEST_FILE);

    const del = await api()
      .delete(`/api/contracts/${id}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(del.status).toBe(200);
    expect(del.body.success).toBe(true);

    const get = await api()
      .get(`/api/contracts/${id}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(get.status).toBe(404);

    // 파일/이력도 CASCADE 로 삭제됐는지
    const [filesAfter] = await pool.query(
      'SELECT id FROM contract_files WHERE contract_id = ?',
      [id]
    );
    expect(filesAfter.length).toBe(0);
    const [historyAfter] = await pool.query(
      'SELECT id FROM contract_history WHERE contract_id = ?',
      [id]
    );
    expect(historyAfter.length).toBe(0);
  });

  // ── Phase 3: 계약 템플릿 라이브러리 ──────────────────────────
  it('GET /templates — 시드 템플릿 5종 + is_seed=true 마크', async () => {
    const res = await api()
      .get('/api/contracts/templates?is_active=1')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const codes = res.body.data.map(t => t.template_code);
    expect(codes).toContain('STD-NDA');
    expect(codes).toContain('STD-MSA');
    expect(codes).toContain('STD-SLA');
    expect(codes).toContain('STD-SOW');
    expect(codes).toContain('STD-SERVICE');
    const nda = res.body.data.find(t => t.template_code === 'STD-NDA');
    expect(nda.is_seed).toBe(true);
    expect(Array.isArray(nda.variables)).toBe(true);
    expect(nda.variables.length).toBeGreaterThan(0);
  });

  it('GET /templates/:id — body_md + variables 포함', async () => {
    const list = await api()
      .get('/api/contracts/templates?is_active=1')
      .set('X-User-Id', String(TEST_USER_ID));
    const ndaId = list.body.data.find(t => t.template_code === 'STD-NDA').id;
    const res = await api()
      .get(`/api/contracts/templates/${ndaId}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.data.body_md).toContain('비밀유지계약서');
    expect(res.body.data.body_md).toContain('{{을_회사명}}');
    expect(res.body.data.is_seed).toBe(true);
  });

  it('POST /templates — 신규 사용자 템플릿 생성', async () => {
    const res = await api()
      .post('/api/contracts/templates')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__나만의템플릿',
        contract_type: 'etc',
        body_md: '# 테스트 템플릿\n안녕 {{회사명}}',
        variables: [{ name: '회사명', label: '회사명', type: 'text', required: true }],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.template_code).toMatch(/^USR-/);

    // 정리
    await pool.query('DELETE FROM contract_templates WHERE id = ?', [res.body.id]);
  });

  it('DELETE /templates/:id — 시드 템플릿 삭제 거부 (403)', async () => {
    const list = await api()
      .get('/api/contracts/templates?is_active=1')
      .set('X-User-Id', String(TEST_USER_ID));
    const stdId = list.body.data.find(t => t.template_code === 'STD-NDA').id;
    const res = await api()
      .delete(`/api/contracts/templates/${stdId}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('시스템 시드');
  });

  it('POST /from-template/:id — 변수 치환 + 계약 자동 생성 + history', async () => {
    const list = await api()
      .get('/api/contracts/templates?is_active=1')
      .set('X-User-Id', String(TEST_USER_ID));
    const ndaTemplate = list.body.data.find(t => t.template_code === 'STD-NDA');

    const res = await api()
      .post(`/api/contracts/from-template/${ndaTemplate.id}`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__템플릿_적용_A사',
        customer_name: '__TEST__A주식회사',
        contract_type: 'NDA',
        start_date: '2026-05-23',
        end_date: '2027-05-22',
        variables: {
          비밀유지_기간_년: 5,
          갑_회사명: '__TEST__우리회사',
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.data.contract_no).toMatch(/^C-\d{4}-\d{4}$/);
    expect(res.body.data.template_id).toBe(ndaTemplate.id);
    expect(res.body.data.applied_variables.비밀유지_기간_년).toBe(5);
    expect(res.body.data.applied_variables.갑_회사명).toBe('__TEST__우리회사');
    expect(res.body.data.applied_variables.을_회사명).toBe('__TEST__A주식회사'); // autofill

    const contractId = res.body.id;
    createdIds.push(contractId);

    // 계약 본문에 변수 치환되었는지 확인
    const detail = await api()
      .get(`/api/contracts/${contractId}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.notes).toContain('__TEST__우리회사');
    expect(detail.body.data.notes).toContain('__TEST__A주식회사');
    expect(detail.body.data.notes).toContain('5년간 존속'); // {{비밀유지_기간_년}} → 5
    expect(detail.body.data.notes).not.toContain('{{비밀유지_기간_년}}'); // 미치환 없음
    expect(detail.body.data.template_id).toBe(ndaTemplate.id);
    // history 에 template_apply 액션
    expect(detail.body.data.history.some(h => h.action_type === 'template_apply')).toBe(true);
  });

  // ── Phase 1: CLM 워크플로우 (상태 전이 검증) ─────────────────
  it('PATCH /:id/status — 정상 전이 (draft → review → negotiation → signing → active)', async () => {
    const cr = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__CLM_normal',
        customer_name: '__TEST__',
        contract_type: 'MSA',
      });
    const id = cr.body.id;
    createdIds.push(id);

    // draft → review
    let res = await api()
      .patch(`/api/contracts/${id}/status`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'review' });
    expect(res.status).toBe(200);
    expect(res.body.data.from).toBe('draft');
    expect(res.body.data.to).toBe('review');

    // review → negotiation
    res = await api()
      .patch(`/api/contracts/${id}/status`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'negotiation' });
    expect(res.status).toBe(200);

    // negotiation → signing
    res = await api()
      .patch(`/api/contracts/${id}/status`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'signing' });
    expect(res.status).toBe(200);

    // signing → active (start_date 자동 채움 검증 — 미리 비워둠)
    await pool.query('UPDATE contracts SET start_date = NULL WHERE id = ?', [id]);
    res = await api()
      .patch(`/api/contracts/${id}/status`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'active' });
    expect(res.status).toBe(200);
    expect(res.body.data.auto_start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // 최종 상태 + history 검증
    const detail = await api()
      .get(`/api/contracts/${id}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.status).toBe('active');
    expect(detail.body.data.start_date).toBeDefined();
    const historyChanges = detail.body.data.history.filter(h => h.action_type === 'status_change');
    expect(historyChanges.length).toBe(4); // 4번의 전이
  });

  it('PATCH /:id/status — 잘못된 전이 (draft → active 직접 점프 금지) → 400', async () => {
    const cr = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__CLM_invalid',
        customer_name: '__TEST__',
        contract_type: 'NDA',
      });
    const id = cr.body.id;
    createdIds.push(id);

    const res = await api()
      .patch(`/api/contracts/${id}/status`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'active' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('잘못된 전이');
    expect(res.body.error).toContain('초안');
    expect(res.body.error).toContain('발효');
  });

  it('PATCH /:id/status — terminated 에서는 어디로도 전이 불가', async () => {
    const cr = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__CLM_terminated',
        customer_name: '__TEST__',
        contract_type: 'NDA',
      });
    const id = cr.body.id;
    createdIds.push(id);

    // draft → terminated (해지 가능)
    let res = await api()
      .patch(`/api/contracts/${id}/status`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'terminated' });
    expect(res.status).toBe(200);

    // terminated 에서 어디로도 전이 시도 → 400
    res = await api()
      .patch(`/api/contracts/${id}/status`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'draft' });
    expect(res.status).toBe(400);

    res = await api()
      .patch(`/api/contracts/${id}/status`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'active' });
    expect(res.status).toBe(400);
  });

  it('PATCH /:id/status — active ↔ renewal 갱신 사이클 + 동일 상태 거부', async () => {
    // 상태를 active 까지 직접 (PUT 으로 셋업 — PUT 은 전이 검증 안함)
    const cr = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__CLM_renewal',
        customer_name: '__TEST__',
        contract_type: 'service',
        status: 'active', // PUT 으로 active 시작
      });
    const id = cr.body.id;
    createdIds.push(id);

    // active → renewal
    let res = await api()
      .patch(`/api/contracts/${id}/status`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'renewal' });
    expect(res.status).toBe(200);

    // renewal → active (갱신 완료)
    res = await api()
      .patch(`/api/contracts/${id}/status`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'active' });
    expect(res.status).toBe(200);

    // 동일 상태 거부 (active → active)
    res = await api()
      .patch(`/api/contracts/${id}/status`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'active' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('이미');

    // active → expired (종료)
    res = await api()
      .patch(`/api/contracts/${id}/status`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'expired' });
    expect(res.status).toBe(200);

    // history 강조 메시지 검증
    const detail = await api()
      .get(`/api/contracts/${id}`)
      .set('X-User-Id', String(TEST_USER_ID));
    const expiredLog = detail.body.data.history.find(
      h => h.action_type === 'status_change' && h.new_value === 'expired'
    );
    expect(expiredLog).toBeDefined();
    expect(expiredLog.description).toContain('만료');
  });

  // ── Phase 2: AI 법무 검토 ─────────────────────────────────
  it('POST /:id/files/:fileId/legal-review — AI 법무 검토 실행 + DB 영속화 + history', async () => {
    // 새 계약 + 파일 1건 업로드
    const cr = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__legal_review_A',
        customer_name: '__TEST__',
        contract_type: 'NDA',
        start_date: '2026-05-23',
      });
    const id = cr.body.id;
    createdIds.push(id);

    const up = await api()
      .post(`/api/contracts/${id}/files`)
      .set('X-User-Id', String(TEST_USER_ID))
      .field('file_type', 'contract')
      .attach('files', TEST_FILE);
    const fileId = up.body.data.uploaded[0].id;

    // AI 법무 검토 실행 (mock 응답 — NODE_ENV=test)
    const res = await api()
      .post(`/api/contracts/${id}/files/${fileId}/legal-review`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.review_score).toBeGreaterThanOrEqual(0);
    expect(res.body.data.review_score).toBeLessThanOrEqual(100);
    expect(['high', 'medium', 'low']).toContain(res.body.data.risk_level);
    expect(Array.isArray(res.body.data.toxic_clauses)).toBe(true);
    expect(Array.isArray(res.body.data.missing_clauses)).toBe(true);
    expect(res.body.data.legal_compliance).toBeDefined();
    expect(res.body.data.legal_compliance.fair_trade_act).toBeDefined();

    // DB 에 영속화 됐는지 + GET /:id 응답에 latest_legal_review 포함되는지
    const detail = await api()
      .get(`/api/contracts/${id}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.latest_legal_review).toBeDefined();
    expect(detail.body.data.latest_legal_review).not.toBeNull();
    expect(detail.body.data.latest_legal_review.target_file_id).toBe(fileId);
    expect(detail.body.data.latest_legal_review.review_score).toBe(res.body.data.review_score);
    // history 에 legal_review 액션 기록
    expect(detail.body.data.history.some(h => h.action_type === 'legal_review')).toBe(true);
    // 메인 테이블에도 score 반영
    expect(detail.body.data.legal_review_score).toBe(res.body.data.review_score);
  });

  it('GET /:id/legal-reviews — 검토 이력 조회 (다중 버전)', async () => {
    const cr = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__legal_history',
        customer_name: '__TEST__',
        contract_type: 'service',
      });
    const id = cr.body.id;
    createdIds.push(id);

    const up = await api()
      .post(`/api/contracts/${id}/files`)
      .set('X-User-Id', String(TEST_USER_ID))
      .field('file_type', 'contract')
      .attach('files', TEST_FILE);
    const fileId = up.body.data.uploaded[0].id;

    // 같은 파일 2번 검토 → 이력 2건
    await api()
      .post(`/api/contracts/${id}/files/${fileId}/legal-review`)
      .set('X-User-Id', String(TEST_USER_ID));
    await api()
      .post(`/api/contracts/${id}/files/${fileId}/legal-review`)
      .set('X-User-Id', String(TEST_USER_ID));

    const list = await api()
      .get(`/api/contracts/${id}/legal-reviews`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBe(2);
    expect(list.body.data[0].target_filename).toBeDefined();
    expect(list.body.data[0].review_score).toBeGreaterThanOrEqual(0);
    expect(list.body.data[0].toxic_clauses).toBeDefined();
    expect(list.body.data[0].legal_compliance.fair_trade_act).toBeDefined();
  });

  it('POST /:id/files/:fileId/legal-review — 존재하지 않는 파일 → 404', async () => {
    const cr = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__no_file',
        customer_name: '__TEST__',
        contract_type: 'NDA',
      });
    const id = cr.body.id;
    createdIds.push(id);

    const res = await api()
      .post(`/api/contracts/${id}/files/999999/legal-review`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(404);
  });

  it('POST / — proposal_id 연결 시 customer 자동 반영', async () => {
    // 임시 proposal 생성 (mock 데이터)
    const propRes = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__계약자동연결',
        customer_name: '__TEST__고객사_연결',
        proposal_date: '2026-05-23',
        expected_amount: 99000000,
        currency: 'KRW',
      });
    const propId = propRes.body.id;

    const res = await api()
      .post('/api/contracts')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        title: '__TEST__계약_자동연결',
        proposal_id: propId,
        contract_type: 'service',
      });
    expect(res.status).toBe(200);
    const contractId = res.body.id;
    createdIds.push(contractId);

    const detail = await api()
      .get(`/api/contracts/${contractId}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.customer_name).toBe('__TEST__고객사_연결');
    expect(Number(detail.body.data.contract_amount)).toBe(99000000);

    // proposal 도 cleanup
    await pool.query('DELETE FROM proposals WHERE id = ?', [propId]);
  });
});
