/**
 * Proposals API 통합 테스트 — Phase 1 (CRUD + 상태 + history)
 *
 * 검증 대상: /api/proposals
 *   GET    /next-proposal-no — P-YYYY-NNNN 미리보기
 *   GET    /                 — 목록 (페이징 + 필터)
 *   GET    /:id              — 단건 + history
 *   POST   /                 — 생성 (자동채번 + history)
 *   PUT    /:id              — 수정 (status timestamp 자동)
 *   PATCH  /:id/status       — 상태 전환 + history
 *   DELETE /:id              — CASCADE 삭제
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, pool } from './helpers.mjs';

const TEST_USER_ID = 1;
const createdIds = [];

beforeAll(async () => {
  // 마이그레이션 완료 대기 — server.js 로드 시 자동 트리거
  // (helpers.mjs 가 server.js 로드)
});

afterAll(async () => {
  if (createdIds.length > 0) {
    await pool.query('DELETE FROM proposals WHERE id IN (?)', [createdIds]);
  }
});

describe('Proposals API — Phase 1', () => {
  let createdId;
  let createdNo;

  it('GET /next-proposal-no — P-YYYY-NNNN 패턴', async () => {
    const res = await api()
      .get('/api/proposals/next-proposal-no?year=2026')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.proposal_no).toMatch(/^P-2026-\d{4}$/);
    expect(res.body.data.year).toBe(2026);
  });

  it('POST / — 신규 제안 + 자동채번 + history 기록', async () => {
    const res = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__제안_A',
        customer_name: '__TEST__고객사_A',
        proposal_date: '2026-05-21',
        due_date: '2026-06-20',
        expected_amount: 50000000,
        currency: 'KRW',
        remark: '테스트 비고',
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.proposal_no).toMatch(/^P-2026-\d{4}$/);
    createdId = res.body.id;
    createdNo = res.body.data.proposal_no;
    createdIds.push(createdId);

    // history 자동 기록 검증
    const detail = await api().get(`/api/proposals/${createdId}`).set('X-User-Id', String(TEST_USER_ID));
    const history = detail.body.data.history;
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history.some(h => h.action_type === 'create')).toBe(true);
  });

  it('POST / — 제안명 누락 시 400', async () => {
    const res = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ customer_name: '__TEST__', proposal_date: '2026-05-21' });
    expect(res.status).toBe(400);
  });

  it('POST / — 고객명 누락 시 400 (lead 도 없는 경우)', async () => {
    const res = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ proposal_title: '__TEST__', proposal_date: '2026-05-21' });
    expect(res.status).toBe(400);
  });

  it('GET / — 목록 (생성한 제안 포함)', async () => {
    const res = await api()
      .get('/api/proposals?search=__TEST__&limit=50')
      .set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const found = res.body.data.find(p => p.id === createdId);
    expect(found).toBeDefined();
    expect(found.proposal_no).toBe(createdNo);
    expect(Number(found.expected_amount)).toBe(50000000);
  });

  it('GET /:id — 단건 + lead/quote null + files/revisions/history 배열', async () => {
    const res = await api().get(`/api/proposals/${createdId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(createdId);
    expect(res.body.data.lead).toBeNull();
    expect(res.body.data.quote).toBeNull();
    expect(Array.isArray(res.body.data.files)).toBe(true);
    expect(Array.isArray(res.body.data.revisions)).toBe(true);
    expect(Array.isArray(res.body.data.email_logs)).toBe(true);
    expect(Array.isArray(res.body.data.history)).toBe(true);
  });

  it('GET /:id — 존재하지 않는 ID 404', async () => {
    const res = await api().get('/api/proposals/9999999').set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(404);
  });

  it('PUT /:id — 수정 + history update 기록', async () => {
    const res = await api()
      .put(`/api/proposals/${createdId}`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ proposal_title: '__TEST__제안_A_수정', expected_amount: 60000000 });
    expect(res.status).toBe(200);

    const detail = await api().get(`/api/proposals/${createdId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.proposal_title).toBe('__TEST__제안_A_수정');
    expect(Number(detail.body.data.expected_amount)).toBe(60000000);
    expect(detail.body.data.history.some(h => h.action_type === 'update')).toBe(true);
  });

  it('PATCH /:id/status — draft → sent (sent_at 자동 기록) + history', async () => {
    const r1 = await api()
      .patch(`/api/proposals/${createdId}/status`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'sent' });
    expect(r1.status).toBe(200);
    expect(r1.body.data.status).toBe('sent');

    const detail = await api().get(`/api/proposals/${createdId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.status).toBe('sent');
    expect(detail.body.data.sent_at).toBeTruthy();
    expect(
      detail.body.data.history.some(h => h.action_type === 'status_change' && h.new_value === 'sent')
    ).toBe(true);
  });

  it('PATCH /:id/status — sent → accepted (accepted_at 자동 기록)', async () => {
    const r = await api()
      .patch(`/api/proposals/${createdId}/status`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'accepted' });
    expect(r.status).toBe(200);

    const detail = await api().get(`/api/proposals/${createdId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.accepted_at).toBeTruthy();
  });

  it('PATCH /:id/status — 잘못된 상태값 400', async () => {
    const r = await api()
      .patch(`/api/proposals/${createdId}/status`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ status: 'INVALID_X' });
    expect(r.status).toBe(400);
  });

  it('POST / + quote_id 자동 반영 — quote_no/expected_amount 자동', async () => {
    // 1) 임시 견적 생성
    const q = await api()
      .post('/api/quotes')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        name: '__TEST__견적_for_proposal',
        customer_name: '__TEST__quote_cust',
        quote_date: '2026-05-21',
        items: [{ item_name: 'A', unit_price: 1000000, quantity: 5 }],
      });
    const quoteId = q.body.id;

    // 2) 제안 생성 시 quote_id 만 명시 — customer_name/quote_no/expected_amount 자동
    const res = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__제안_quote연결',
        proposal_date: '2026-05-21',
        quote_id: quoteId,
        // customer_name 생략 → 견적에서 자동 추출
      });
    expect(res.status).toBe(200);
    const propId = res.body.id;
    createdIds.push(propId);

    const detail = await api().get(`/api/proposals/${propId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.quote_id).toBe(quoteId);
    expect(detail.body.data.quote_no).toMatch(/^Q-/);
    expect(detail.body.data.customer_name).toBe('__TEST__quote_cust');
    expect(Number(detail.body.data.expected_amount)).toBe(5000000); // 1000000 * 5
    expect(detail.body.data.quote).toBeDefined();
    expect(detail.body.data.quote.id).toBe(quoteId);

    // 정리 — 견적
    await pool.query('DELETE FROM quotes WHERE id = ?', [quoteId]);
  });

  // Phase 2: RFP 메타정보 저장/조회
  it('PUT /:id — RFP 메타정보 저장 (title/received_date/due_date/summary)', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__RFP메타',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const rfpId = create.body.id;
    createdIds.push(rfpId);

    const summary = 'RFP 요약:\n- 핵심 요구사항\n- 평가 기준\n- 예산 100억';
    await api()
      .put(`/api/proposals/${rfpId}`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        rfp_title: '2026년 클라우드 인프라 구축 RFP',
        rfp_received_date: '2026-05-15',
        rfp_due_date: '2026-06-15',
        rfp_summary: summary,
      });

    const detail = await api().get(`/api/proposals/${rfpId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.rfp_title).toBe('2026년 클라우드 인프라 구축 RFP');
    expect(detail.body.data.rfp_summary).toBe(summary);
    // 날짜는 DATE 타입 — DB 가 ISO 로 반환 + TZ 변환 가능 (KST → UTC -9h)
    // 입력값 ± 1일 범위만 확인 (TZ 무관 round-trip)
    const rcv = new Date(detail.body.data.rfp_received_date).getTime();
    const due = new Date(detail.body.data.rfp_due_date).getTime();
    expect(Math.abs(rcv - new Date('2026-05-15').getTime())).toBeLessThanOrEqual(24 * 3600 * 1000);
    expect(Math.abs(due - new Date('2026-06-15').getTime())).toBeLessThanOrEqual(24 * 3600 * 1000);
  });

  // Phase 3: 파일 업로드 (multipart simulation via supertest .attach)
  it('POST /:id/files — 일반 파일 업로드 + history 기록 + 목록 노출', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__파일_제안',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const propId = create.body.id;
    createdIds.push(propId);

    // 임시 파일 만들기 — 작은 PDF 파일 (헤더만)
    const path = await import('path');
    const fs = await import('fs');
    const os = await import('os');
    const tmpFile = path.join(os.tmpdir(), `__test_proposal_${propId}.pdf`);
    fs.writeFileSync(tmpFile, Buffer.from('%PDF-1.4 dummy proposal file content'));

    const upload = await api()
      .post(`/api/proposals/${propId}/files`)
      .set('X-User-Id', String(TEST_USER_ID))
      .field('file_type', 'proposal')
      .field('description', '테스트 제안서')
      .field('is_final', '1')
      .field('include_in_email', '1')
      .attach('file', tmpFile);
    expect(upload.status).toBe(200);
    expect(upload.body.success).toBe(true);
    expect(upload.body.data.original_filename).toContain('__test_proposal');

    // 상세 조회 — 파일 목록 + history 기록 확인
    const detail = await api().get(`/api/proposals/${propId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.files.length).toBe(1);
    expect(detail.body.data.files[0].file_type).toBe('proposal');
    expect(detail.body.data.files[0].is_final).toBe(1);
    expect(detail.body.data.history.some(h => h.action_type === 'file_upload')).toBe(true);

    // 정리 — 디스크 파일
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  });

  it('POST /:id/rfp — RFP 파일 업로드 + 메타정보 동시 갱신', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__RFP파일',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const propId = create.body.id;
    createdIds.push(propId);

    const path = await import('path');
    const fs = await import('fs');
    const os = await import('os');
    const tmpFile = path.join(os.tmpdir(), `__test_rfp_${propId}.pdf`);
    fs.writeFileSync(tmpFile, Buffer.from('%PDF-1.4 dummy RFP'));

    const upload = await api()
      .post(`/api/proposals/${propId}/rfp`)
      .set('X-User-Id', String(TEST_USER_ID))
      .field('rfp_title', '클라우드 인프라 RFP')
      .field('rfp_received_date', '2026-05-15')
      .field('rfp_due_date', '2026-06-15')
      .attach('file', tmpFile);
    expect(upload.status).toBe(200);

    const detail = await api().get(`/api/proposals/${propId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.rfp_title).toBe('클라우드 인프라 RFP');
    expect(detail.body.data.files.length).toBe(1);
    expect(detail.body.data.files[0].file_type).toBe('rfp');
    expect(detail.body.data.history.some(h => h.action_type === 'rfp_upload')).toBe(true);

    try { fs.unlinkSync(tmpFile); } catch (_) {}
  });

  it('POST /:id/files — 허용 외 확장자 (.exe) 거부', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__bad_ext',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const propId = create.body.id;
    createdIds.push(propId);

    const path = await import('path');
    const fs = await import('fs');
    const os = await import('os');
    const tmpFile = path.join(os.tmpdir(), `__test_bad_${propId}.exe`);
    fs.writeFileSync(tmpFile, Buffer.from('malicious'));

    const upload = await api()
      .post(`/api/proposals/${propId}/files`)
      .set('X-User-Id', String(TEST_USER_ID))
      .attach('file', tmpFile);
    // multer fileFilter cb(null, false) → req.file 미생성 → 400
    expect(upload.status).toBe(400);

    try { fs.unlinkSync(tmpFile); } catch (_) {}
  });

  it('DELETE /:id/files/:fileId — 파일 삭제 + history', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__파일_삭제',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const propId = create.body.id;
    createdIds.push(propId);

    const path = await import('path');
    const fs = await import('fs');
    const os = await import('os');
    const tmpFile = path.join(os.tmpdir(), `__test_del_${propId}.pdf`);
    fs.writeFileSync(tmpFile, Buffer.from('%PDF dummy'));
    const up = await api()
      .post(`/api/proposals/${propId}/files`)
      .set('X-User-Id', String(TEST_USER_ID))
      .field('file_type', 'etc')
      .attach('file', tmpFile);
    const fileId = up.body.data.id;

    const del = await api()
      .delete(`/api/proposals/${propId}/files/${fileId}`)
      .set('X-User-Id', String(TEST_USER_ID));
    expect(del.status).toBe(200);

    const detail = await api().get(`/api/proposals/${propId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.files.length).toBe(0);
    expect(detail.body.data.history.some(h => h.action_type === 'file_delete')).toBe(true);

    try { fs.unlinkSync(tmpFile); } catch (_) {}
  });

  it('POST /:id/revisions — 리비전 생성 + version_no 증가 + history', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__리비전',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const propId = create.body.id;
    createdIds.push(propId);

    // 첫 리비전 생성 — version_no 1 → 2
    const r1 = await api()
      .post(`/api/proposals/${propId}/revisions`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ title: '1차 수정안', description: '가격 5% 인하' });
    expect(r1.status).toBe(200);
    expect(r1.body.data.revision_no).toBe(2);

    // 두 번째 리비전 — version_no 2 → 3
    const r2 = await api()
      .post(`/api/proposals/${propId}/revisions`)
      .set('X-User-Id', String(TEST_USER_ID))
      .send({ title: '최종안' });
    expect(r2.body.data.revision_no).toBe(3);

    const detail = await api().get(`/api/proposals/${propId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(detail.body.data.version_no).toBe(3);
    expect(detail.body.data.revisions.length).toBe(2);
    expect(detail.body.data.history.filter(h => h.action_type === 'revision_create').length).toBe(2);
  });

  it('DELETE /:id — 삭제 (CASCADE 로 children)', async () => {
    const create = await api()
      .post('/api/proposals')
      .set('X-User-Id', String(TEST_USER_ID))
      .send({
        proposal_title: '__TEST__삭제용',
        customer_name: '__TEST__',
        proposal_date: '2026-05-21',
      });
    const delId = create.body.id;

    const res = await api().delete(`/api/proposals/${delId}`).set('X-User-Id', String(TEST_USER_ID));
    expect(res.status).toBe(200);

    // history 도 CASCADE 로 삭제
    const [history] = await pool.query('SELECT * FROM proposal_history WHERE proposal_id = ?', [delId]);
    expect(history.length).toBe(0);
  });

  it('DELETE /:id — 존재하지 않는 ID 404', async () => {
    const r = await api().delete('/api/proposals/9999999').set('X-User-Id', String(TEST_USER_ID));
    expect(r.status).toBe(404);
  });
});
