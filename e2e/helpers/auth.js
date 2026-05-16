// =============================================================
// E2E Auth Helper — API 로 로그인 → localStorage 토큰 주입
//
// 이유: GUI 로그인을 매번 거치지 않아 빠르고 안정적
// 사용:
//   const { loginAsAdmin } = require('./helpers/auth');
//   await loginAsAdmin(page);
// =============================================================
'use strict';

const DEFAULT_CREDENTIALS = {
  username: process.env.E2E_USERNAME || 'admin',
  password: process.env.E2E_PASSWORD || 'admin1234!',
};

/**
 * API 로 로그인 후 토큰을 localStorage 에 주입하고 / 로 이동.
 * @param {import('@playwright/test').Page} page
 * @param {{ username?: string, password?: string }} [credentials]
 */
async function loginAsAdmin(page, credentials = {}) {
  const { username, password } = { ...DEFAULT_CREDENTIALS, ...credentials };

  // baseURL 은 playwright.config.js 에서 자동 적용됨
  const resp = await page.request.post('/api/auth/login', {
    data: { username, password },
  });
  if (!resp.ok()) {
    throw new Error(`로그인 실패 (${resp.status()}): ${await resp.text()}`);
  }
  const body = await resp.json();
  if (!body.token) throw new Error('응답에 token 없음: ' + JSON.stringify(body));

  // 페이지 컨텍스트에 토큰 주입 — 앱이 매 요청에 자동 포함
  await page.goto('/');
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('oci_token', token);
    localStorage.setItem('oci_user', JSON.stringify(user));
    if (user?.id) localStorage.setItem('current_user_id', String(user.id));
  }, body);

  // 토큰 적용 상태로 다시 로드 — 앱이 인증된 상태에서 부트스트랩
  await page.goto('/');
  // 메인 페이지 로드 완료 대기 (사이드바 또는 검색 버튼 존재)
  await page.waitForSelector('#global-search-btn', { timeout: 10000 });
}

module.exports = { loginAsAdmin, DEFAULT_CREDENTIALS };
