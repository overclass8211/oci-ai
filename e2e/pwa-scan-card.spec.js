// =============================================================
// E2E — PWA Shortcut: ?action=scan-card → 명함 촬영 OCR 모달 자동 오픈
//
// 검증 시나리오:
//   1. URL ?action=scan-card 로 진입 → 고객사 페이지로 이동
//   2. OCR 모달 자동 오픈 (title "📇 명함 촬영")
//   3. 파일 입력에 capture="environment" 속성 존재 (모바일 후면 카메라 호출)
//   4. URL 파라미터가 자동 정리됨 (?action 제거)
//
// 배경:
//   PWA manifest.json shortcuts 에 "명함 촬영" 등록 →
//   Android 홈화면 long-press → 쇼트컷 탭 → /?action=scan-card 로 진입
//   이 진입 흐름이 끊기지 않도록 회귀 방지.
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
});

test('PWA shortcut — ?action=scan-card 진입 → 고객사 페이지 + OCR 모달 자동', async ({ page }) => {
  // 명함 촬영 쇼트컷 URL 로 진입 (loginAsAdmin 이후 재진입)
  await page.goto('/?action=scan-card', { waitUntil: 'domcontentloaded' });

  // 1) 고객사 페이지로 라우팅
  await page.waitForFunction(() => location.hash === '#customers', { timeout: 8000 });

  // 2) OCR 모달이 자동으로 열림 — 명함 촬영 타이틀
  const modalTitle = page.locator('.modal-header').filter({ hasText: '명함 촬영' });
  await expect(modalTitle).toBeVisible({ timeout: 5000 });

  // 3) 파일 입력에 capture="environment" 속성 — 모바일 후면 카메라 호출
  const fileInput = page.locator('#card-file-input');
  await expect(fileInput).toHaveAttribute('capture', 'environment');
  await expect(fileInput).toHaveAttribute('accept', /image/);

  // 4) URL 의 ?action 파라미터가 정리됨 (재진입 시 무한 트리거 방지)
  await page.waitForFunction(() => !new URLSearchParams(location.search).has('action'), {
    timeout: 3000,
  });
});

test('PWA shortcut — manifest.json 에 shortcuts 정의가 존재함', async ({ page }) => {
  // PWA manifest 직접 확인 — Android 홈화면 long-press 쇼트컷 동작 보장
  const resp = await page.request.get('/manifest.json');
  expect(resp.ok()).toBeTruthy();
  const manifest = await resp.json();
  expect(Array.isArray(manifest.shortcuts)).toBeTruthy();
  expect(manifest.shortcuts.length).toBeGreaterThanOrEqual(1);

  const scanShortcut = manifest.shortcuts.find(s => s.url && s.url.includes('action=scan-card'));
  expect(scanShortcut).toBeTruthy();
  expect(scanShortcut.name).toBe('명함 촬영');
  // 아이콘 정의 확인
  expect(scanShortcut.icons?.[0]?.src).toBe('/assets/shortcut-scan.svg');
});
