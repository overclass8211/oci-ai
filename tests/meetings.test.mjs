/**
 * 회의록 API 통합 테스트 — STT 우회, DB 직접 검증.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { api, pool, teardown } from './helpers.mjs';

let createdMeetingId;

afterAll(async () => {
  if (createdMeetingId) {
    await pool.query('DELETE FROM meeting_minutes WHERE id = ?', [createdMeetingId]);
  }
  
});

describe('Meetings API', () => {
  it('GET /api/meetings — 목록', async () => {
    const res = await api().get('/api/meetings');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST — 회의록 직접 저장 (STT 우회)', async () => {
    const res = await api().post('/api/meetings').send({
      title:          '__TEST__ 통합 테스트 회의록',
      meeting_date:   '2026-05-09',
      raw_transcript: '테스트 전사 텍스트입니다.',
      speakers_json:  [{ speaker: 1, text: '안녕하세요' }],
      summary_md:     '## 미팅 주요 어젠다\n- 테스트',
      customer_name:  '__TEST__고객사'
    });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
    createdMeetingId = res.body.id;
  });

  it('GET /:id — 상세 (요약 보존)', async () => {
    const res = await api().get(`/api/meetings/${createdMeetingId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('__TEST__ 통합 테스트 회의록');
    expect(res.body.data.summary_md).toContain('미팅 주요 어젠다');
  });

  it('DELETE /:id — 회의록 삭제', async () => {
    const res = await api().delete(`/api/meetings/${createdMeetingId}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    createdMeetingId = null;
  });
});
