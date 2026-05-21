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

  // AI 탭 클릭 → ai_strategy_md 표시
  await page.locator('.pr-tab[data-tab="ai"]').click();
  await expect(page.locator('#pr-tab-content')).toContainText('RFP 핵심 요약');
  await expect(page.locator('#pr-tab-content')).toContainText('테스트 결과');

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
