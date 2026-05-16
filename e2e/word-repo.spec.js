// =============================================================
// E2E — 워드 사전(Word Repository)
//
// 검증 시나리오:
//   1. 어드민이 관리자 페이지 진입 → "🗂 워드 사전" 탭 표시
//   2. 라벨 편집 → 저장 → 즉시 영업리드 페이지 헤더에 반영
//   3. 도메인별 초기화 → 기본값 복원
//   4. 변경 이력 모달 표시
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

// API 직접 호출 — 깨끗한 상태 보장
async function resetLeads(page) {
  const token =
    (await page.evaluate(() => localStorage.getItem('oci_token'))) || '';
  await page.request.post('/api/admin/labels/reset', {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: { scope: 'leads' },
  });
}

test('시나리오 1 — 어드민 페이지에 워드 사전 탭 표시', async ({ page }) => {
  await page.goto('/#admin');
  // 탭 버튼 존재
  await expect(page.locator('.tab-btn[data-tab="word-repo"]')).toBeVisible({ timeout: 10000 });
});

test('시나리오 2 — 라벨 편집 → 저장 → 영업리드 헤더 즉시 반영', async ({ page }) => {
  await resetLeads(page);

  await page.goto('/#admin');
  await page.click('.tab-btn[data-tab="word-repo"]');
  // 패널 로드 대기
  await page.waitForSelector('.wr-input', { timeout: 8000 });

  // 'leads.customer_name' 행 인풋 찾기
  const input = page.locator('tr[data-scope="leads"][data-key="customer_name"] .wr-input');
  await expect(input).toBeVisible();
  await input.fill('거래처');

  // 저장 버튼 표시 + 클릭
  await expect(page.locator('#wr-save')).toBeVisible();
  await page.click('#wr-save');

  // 저장 후 영업리드 페이지로 이동 — 헤더가 '거래처' 로 치환되어야 함
  await page.goto('/#leads');
  // 컬럼 헤더 [data-label="leads.customer_name"]
  const th = page.locator('th[data-label="leads.customer_name"]');
  await expect(th).toBeVisible({ timeout: 10000 });
  await expect(th).toHaveText('거래처', { timeout: 8000 });

  // cleanup
  await resetLeads(page);
});

test('시나리오 3 — 도메인별 초기화 → 기본값 복원', async ({ page }) => {
  // 사전 조건: 라벨 1개 변경
  const token = (await page.evaluate(() => localStorage.getItem('oci_token'))) || '';
  await page.request.put('/api/admin/labels/leads/customer_name', {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: { label: 'TestClient' },
  });

  await page.goto('/#admin');
  await page.click('.tab-btn[data-tab="word-repo"]');
  await page.waitForSelector('.wr-input', { timeout: 8000 });

  // 변경된 값 표시 확인
  await expect(
    page.locator('tr[data-scope="leads"][data-key="customer_name"] .wr-input')
  ).toHaveValue('TestClient');

  // 초기화 버튼 클릭 + Modal 확인
  await page.click('#wr-reset-scope-btn');
  // Modal.confirm — '#modal-cfm-ok'
  await page.click('#modal-cfm-ok');

  // 토스트 또는 reload 후 input 이 기본값(고객사) 으로
  await page.waitForTimeout(800);
  await expect(
    page.locator('tr[data-scope="leads"][data-key="customer_name"] .wr-input')
  ).toHaveValue('고객사', { timeout: 5000 });
});

test('시나리오 4 — 변경 이력 모달 표시', async ({ page }) => {
  // 사전 조건: 변경 1건 만들기
  const token = (await page.evaluate(() => localStorage.getItem('oci_token'))) || '';
  await page.request.put('/api/admin/labels/leads/project_name', {
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    data: { label: 'E2E_AUDIT' },
  });

  await page.goto('/#admin');
  await page.click('.tab-btn[data-tab="word-repo"]');
  await page.waitForSelector('#wr-audit-btn', { timeout: 8000 });
  await page.click('#wr-audit-btn');

  // 모달 표시 + 'E2E_AUDIT' 라벨 행 존재
  await expect(page.locator('.modal-overlay.active')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.modal-overlay.active')).toContainText('E2E_AUDIT', { timeout: 5000 });

  await resetLeads(page);
});
