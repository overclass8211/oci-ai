// =============================================================
// E2E — 견적서 페이지 UI (Phase 1 MVP)
//
// 백엔드 CRUD 는 tests/quotes.test.mjs (vitest + supertest) 에서 검증
// 여기서는 UI 동작만 검증:
//   1) 페이지 진입 → [+ 견적서 작성] 버튼 + 목록 영역
//   2) 작성 모달 → 헤더 입력 + 품목 행 추가 + 합계 자동 계산
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test('견적서 페이지 진입 → [+ 견적서 작성] 버튼 + 목록 영역 표시', async ({ page }) => {
  await page.goto('/#quotes');
  await page.waitForSelector('#qt-new-btn', { timeout: 10000 });

  const newBtn = page.locator('#qt-new-btn');
  await expect(newBtn).toBeVisible();
  await expect(newBtn).toHaveText(/견적서 작성/);

  // 검색바 + 상태 필터 + 목록 wrap 존재
  await expect(page.locator('#qt-search')).toBeVisible();
  await expect(page.locator('#qt-status')).toBeVisible();
  await expect(page.locator('#qt-list-wrap')).toBeVisible();
});

test('작성 모달 진입 → 합계 자동 계산 검증', async ({ page }) => {
  await page.goto('/#quotes');
  await page.waitForSelector('#qt-new-btn', { timeout: 10000 });
  await page.waitForLoadState('networkidle');

  // 작성 모달 직접 호출 (UI 클릭 chain 의 timing 의존성 회피 — 다른 모달 충돌 방지)
  await page.evaluate(() => window.QuotesPage._openModal(null));

  // 모달 입력 필드 표시
  await expect(page.locator('#qt-f-name')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#qt-f-customer_name')).toBeVisible();
  await expect(page.locator('#qt-add-item-btn')).toBeVisible();
  await expect(page.locator('#qt-items-tbody')).toBeVisible();

  // 기본 첫 행이 있음 (blankItem)
  const firstUnitPrice = page.locator('input[data-f="unit_price"][data-idx="0"]');
  const firstQty       = page.locator('input[data-f="quantity"][data-idx="0"]');
  await expect(firstUnitPrice).toBeVisible();

  // 단가 100,000 / 수량 2 → 제안금액 200,000 / 부가세 별도 → 총 220,000
  await firstUnitPrice.fill('100000');
  await firstQty.fill('2');

  // 합계 영역 갱신 — '₩' + 콤마 포맷
  await expect(page.locator('#qt-subtotal')).toHaveText(/200,000/);
  await expect(page.locator('#qt-vat')).toHaveText(/20,000/);
  await expect(page.locator('#qt-total')).toHaveText(/220,000/);
});
