// =============================================================
// E2E — 제안 페이지 UI (Phase 1 + Phase 2)
//
// 백엔드 CRUD 는 tests/proposals.test.mjs (vitest) 에서 검증
// 여기서는 UI 동작만:
//   1) 페이지 진입 → [+ 제안 등록] 버튼 + 목록 영역
//   2) 신규 모달 → 기본정보 탭만 활성 (나머지 탭 disabled)
//   3) 편집 모달 (모듈 직접 호출) — 7개 탭 표시 + 탭 전환
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test('제안 페이지 진입 → [+ 제안 등록] 버튼 + 목록 영역 표시', async ({ page }) => {
  await page.goto('/#proposals');
  await page.waitForSelector('#pr-new-btn', { timeout: 15000 });

  await expect(page.locator('#pr-new-btn')).toBeVisible();
  await expect(page.locator('#pr-new-btn')).toContainText('제안 등록');
  await expect(page.locator('#pr-search')).toBeVisible();
  await expect(page.locator('#pr-status')).toBeVisible();
  await expect(page.locator('#pr-due-soon')).toBeVisible();
  await expect(page.locator('#pr-list-wrap')).toBeVisible();
});

test('Phase 2 — 신규 등록 모달: 7개 탭 표시 + 기본정보 외 탭 disabled', async ({ page }) => {
  await page.goto('/#proposals');
  await page.waitForSelector('#pr-new-btn', { timeout: 15000 });
  await page.waitForLoadState('networkidle');

  await page.evaluate(() => window.ProposalsPage._openModal(null));
  await expect(page.locator('#pr-f-proposal_title')).toBeVisible({ timeout: 5000 });

  // 7개 탭 모두 표시
  await expect(page.locator('.pr-tab')).toHaveCount(7);

  // 기본정보 탭은 활성
  await expect(page.locator('.pr-tab.active')).toContainText('기본정보');

  // 신규 모드 — 나머지 6개 탭은 disabled
  const disabledTabs = ['rfp', 'ai', 'files', 'quote', 'email', 'history'];
  for (const id of disabledTabs) {
    const tab = page.locator(`.pr-tab[data-tab="${id}"]`);
    await expect(tab).toBeDisabled();
  }
});

test('Phase 2 — 편집 모달: 모든 탭 활성 + 탭 전환 동작', async ({ page }) => {
  // route mock — 완전한 제안 상세 (lead/quote/files/history/email_logs/revisions)
  await page.route('**/api/proposals/77001', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: 77001,
          proposal_no: 'P-2026-7001',
          proposal_title: '__E2E_TAB__제안',
          customer_name: '__E2E_TAB__고객사',
          proposal_date: '2026-05-21',
          status: 'review',
          version_no: 1,
          currency: 'KRW',
          expected_amount: 50000000,
          rfp_title: '__E2E__RFP_타이틀',
          rfp_summary: 'RFP 핵심 요약 텍스트',
          rfp_received_date: '2026-05-15',
          rfp_due_date: '2026-06-15',
          ai_strategy_md: '## 1. RFP 핵심 요약\n- 테스트 결과',
          ai_strategy_generated_at: '2026-05-20T10:00:00',
          lead: null,
          quote: {
            id: 999,
            quote_no: 'Q-2026-9999',
            name: '__E2E__견적명',
            total_amount: 110000000,
            subtotal: 100000000,
            vat_amount: 10000000,
            vat_included: 1,
            status: 'sent',
          },
          files: [
            {
              id: 1,
              file_type: 'proposal',
              original_filename: 'proposal_v1.pdf',
              revision_no: 1,
              is_final: 1,
              include_in_email: 1,
              file_size: 1024000,
              created_at: '2026-05-20T10:00:00',
            },
            {
              id: 2,
              file_type: 'rfp',
              original_filename: 'rfp_doc.pdf',
              revision_no: 1,
              is_final: 0,
              include_in_email: 0,
              file_size: 204800,
              created_at: '2026-05-19T10:00:00',
            },
          ],
          revisions: [
            { id: 1, revision_no: 1, title: '초안', description: '첫 작성', created_at: '2026-05-20T10:00:00' },
          ],
          email_logs: [],
          history: [
            { id: 1, action_type: 'create', description: '제안 생성', created_at: '2026-05-20T10:00:00', created_by_name: '관리자' },
            { id: 2, action_type: 'status_change', old_value: 'draft', new_value: 'review', description: '상태 변경', created_at: '2026-05-20T11:00:00' },
          ],
        },
      }),
    });
  });

  await page.goto('/#proposals');
  await page.waitForSelector('#pr-new-btn', { timeout: 30000 });
  await page.waitForLoadState('networkidle');

  await page.evaluate(() => window.ProposalsPage._openModal(77001));
  await expect(page.locator('.pr-tab')).toHaveCount(7);
  // 모든 탭이 활성 (편집 모드)
  const allTabs = await page.locator('.pr-tab:not([disabled])').count();
  expect(allTabs).toBe(7);

  // RFP 탭 클릭 → RFP 메타 입력 표시
  await page.locator('.pr-tab[data-tab="rfp"]').click();
  await expect(page.locator('#pr-f-rfp_title')).toBeVisible();
  await expect(page.locator('#pr-f-rfp_title')).toHaveValue('__E2E__RFP_타이틀');

  // 견적 탭 클릭 → 견적 정보 표시
  await page.locator('.pr-tab[data-tab="quote"]').click();
  await expect(page.locator('#pr-tab-content')).toContainText('Q-2026-9999');
  await expect(page.locator('#pr-tab-content')).toContainText('__E2E__견적명');

  // AI 탭 클릭 → ai_strategy_md 마크다운 렌더링 (Phase 4-D)
  await page.locator('.pr-tab[data-tab="ai"]').click();
  await expect(page.locator('#pr-ai-md-render')).toBeVisible();
  // ## 1. RFP 핵심 요약 → <h2> 로 렌더
  await expect(page.locator('#pr-ai-md-render .md-h2')).toContainText('RFP 핵심 요약');
  // - 테스트 결과 → <li> 로 렌더
  await expect(page.locator('#pr-ai-md-render .md-ul li')).toContainText('테스트 결과');
  // 분석 버튼 — RFP 파일 1건 있으므로 활성
  await expect(page.locator('#pr-ai-analyze-btn')).toBeEnabled();
  // [📋 복사] 버튼 — 결과 있으면 노출
  await expect(page.locator('#pr-ai-copy-btn')).toBeVisible();

  // 자료 탭 클릭 → 파일 1건 표시
  await page.locator('.pr-tab[data-tab="files"]').click();
  await expect(page.locator('#pr-tab-content')).toContainText('proposal_v1.pdf');

  // 리비전/이력 탭 클릭 → 리비전 + 히스토리 표시
  await page.locator('.pr-tab[data-tab="history"]').click();
  await expect(page.locator('#pr-tab-content')).toContainText('v1');
  await expect(page.locator('#pr-tab-content')).toContainText('초안');
  await expect(page.locator('#pr-tab-content')).toContainText('status_change');

  await page.unroute('**/api/proposals/77001');
});

test('Phase 4-C — RFP/자료 탭 드롭존 + AI 분석 버튼 표시', async ({ page }) => {
  // mock — RFP 파일 1건 + 일반 파일 1건
  await page.route('**/api/proposals/77002', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: 77002,
          proposal_no: 'P-2026-7002',
          proposal_title: '__E2E_DZ__제안',
          customer_name: '__E2E_DZ__고객',
          proposal_date: '2026-05-21',
          status: 'draft',
          version_no: 1,
          currency: 'KRW',
          lead: null,
          quote: null,
          files: [
            {
              id: 11,
              file_type: 'rfp',
              original_filename: 'rfp_korean_한글.pdf',
              revision_no: 1,
              is_final: 0,
              include_in_email: 0,
              file_size: 102400,
              created_at: '2026-05-20T10:00:00',
            },
            {
              id: 12,
              file_type: 'proposal',
              original_filename: 'proposal_v1.pdf',
              revision_no: 1,
              is_final: 0,
              include_in_email: 0,
              file_size: 51200,
              created_at: '2026-05-20T11:00:00',
            },
          ],
          revisions: [],
          email_logs: [],
          history: [],
        },
      }),
    });
  });

  await page.goto('/#proposals');
  await page.waitForSelector('#pr-new-btn', { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => window.ProposalsPage._openModal(77002));

  // RFP 탭 → 드롭존 + AI 버튼 (RFP 파일 행에만)
  await page.locator('.pr-tab[data-tab="rfp"]').click();
  await expect(page.locator('#pr-rfp-dropzone')).toBeVisible();
  await expect(page.locator('#pr-rfp-dropzone')).toContainText('파일 추가');
  await expect(page.locator('#pr-rfp-dropzone')).toContainText('끌어다 놓으세요');
  // RFP 파일은 AI 분석 버튼 노출
  await expect(page.locator('.pr-file-ai[data-id="11"]')).toBeVisible();
  // 한글 파일명 그대로 표시 (latin1 → utf8 디코딩 회귀 방지)
  await expect(page.locator('#pr-tab-content')).toContainText('rfp_korean_한글.pdf');

  // 자료 탭 → 드롭존 + 일반 파일 (AI 버튼 없음)
  await page.locator('.pr-tab[data-tab="files"]').click();
  await expect(page.locator('#pr-files-dropzone')).toBeVisible();
  await expect(page.locator('#pr-files-dropzone')).toContainText('파일 추가');
  await expect(page.locator('#pr-tab-content')).toContainText('proposal_v1.pdf');
  // 일반 파일은 AI 분석 버튼 없음
  await expect(page.locator('.pr-file-ai[data-id="12"]')).toHaveCount(0);

  await page.unroute('**/api/proposals/77002');
});

test('Phase 4-D — AI 탭: RFP 파일 없으면 분석 버튼 비활성 + 빈 상태 안내', async ({ page }) => {
  // mock — RFP 파일 없음 + ai_strategy_md 도 없음
  await page.route('**/api/proposals/77003', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: 77003,
          proposal_no: 'P-2026-7003',
          proposal_title: '__E2E_AI__빈',
          customer_name: '__E2E_AI__고객',
          proposal_date: '2026-05-21',
          status: 'draft',
          version_no: 1,
          currency: 'KRW',
          lead: null,
          quote: null,
          files: [],
          revisions: [],
          email_logs: [],
          history: [],
        },
      }),
    });
  });

  await page.goto('/#proposals');
  await page.waitForSelector('#pr-new-btn', { timeout: 30000 });
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => window.ProposalsPage._openModal(77003));

  await page.locator('.pr-tab[data-tab="ai"]').click();
  // RFP 파일 없음 안내
  await expect(page.locator('#pr-tab-content')).toContainText('RFP 탭에서 파일을 먼저 업로드');
  // 분석 버튼 비활성
  await expect(page.locator('#pr-ai-analyze-btn')).toBeDisabled();
  // 결과 없음 → 복사 버튼 미노출
  await expect(page.locator('#pr-ai-copy-btn')).toHaveCount(0);
  // 빈 상태 placeholder
  await expect(page.locator('#pr-tab-content')).toContainText('아직 AI 분석 결과가 없습니다');

  await page.unroute('**/api/proposals/77003');
});
