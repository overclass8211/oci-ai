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
