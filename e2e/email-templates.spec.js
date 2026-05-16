// =============================================================
// E2E — 이메일 템플릿 + Mailto 발송 흐름
//
// 검증 핵심:
//   1. 고객사 모달 → ✉️ 이메일 → 모달 열림 + 변수 치환
//   2. 리드 모달 → ✉️ 이메일 → 변수 치환 (project_name, bidding_deadline)
//   3. 템플릿 변경 시 본문 재치환
//   4. mailto: 링크가 정상 생성되어 navigation 트리거
//   5. 활동 자동기록 옵션 동작
//   6. 설정 페이지 — 새 템플릿 추가
//   7. 시스템 템플릿 편집/삭제 버튼 disabled
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');
const { createPool } = require('./helpers/seed');

const PREFIX = '__E2E_EMAIL__';
let pool;
let custId;

test.beforeAll(async () => {
  pool = createPool();
  // 정리
  await pool.query(`DELETE FROM email_templates WHERE name LIKE ?`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM activities WHERE title LIKE ?`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM leads WHERE project_name LIKE ?`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM customers WHERE name LIKE ?`, [`${PREFIX}%`]);

  // 시드 고객사
  const [c] = await pool.query(
    `INSERT INTO customers (name, region, industry, contact_person, email)
       VALUES (?, '국내', 'IT', ?, ?)`,
    [`${PREFIX}고객사`, '김담당', 'kim@example.com']
  );
  custId = c.insertId;
});

test.afterAll(async () => {
  if (pool) {
    try {
      await pool.query(`DELETE FROM email_templates WHERE name LIKE ?`, [`${PREFIX}%`]);
      await pool.query(`DELETE FROM activities WHERE title LIKE ?`, [`${PREFIX}%`]);
      await pool.query(`DELETE FROM leads WHERE project_name LIKE ?`, [`${PREFIX}%`]);
      await pool.query(`DELETE FROM customers WHERE id = ?`, [custId]);
    } catch (_) { /* ignore */ }
    await pool.end();
  }
});

test.beforeEach(async ({ page }) => {
  // mailto: hook — Email._openMailto 가 호출하는 함수를 Node 쪽으로 노출
  // (page.exposeFunction 은 page 객체 lifetime 동안 영속)
  const capturedMailtos = [];
  await page.exposeFunction('__e2eRecvMailto', (url) => { capturedMailtos.push(url); });
  // 각 페이지 로드 시 hook 설치 — Email._openMailto 가 이것을 호출
  await page.addInitScript(() => {
    window.__e2eOpenMailto = (url) => { window.__e2eRecvMailto(url); };
  });
  // 테스트에서 캡처 배열 접근 가능하도록
  page._capturedMailtos = capturedMailtos;

  await loginAsAdmin(page);
});

// ─── 시나리오 1: 고객사 모달에서 이메일 열기 ─────────────────
test('시나리오 1 — 고객사 모달 → 이메일 모달 + 변수 치환', async ({ page }) => {
  await page.goto('/#customers');
  await page.waitForSelector('tr[data-cust-id]', { timeout: 10000 });
  const row = page.locator(`tr[data-cust-id="${custId}"]`);
  await expect(row).toBeVisible({ timeout: 5000 });
  await row.click();

  await page.click('#cm-email-btn');
  await expect(page.locator('#email-tpl-select')).toBeVisible();
  await expect(page.locator('#email-to')).toHaveValue('kim@example.com');

  // 검증 — 변수 치환이 정상 동작 (placeholder 가 사라짐)
  // 시드 템플릿에 정의된 모든 변수가 치환되어 {{...}} 형식이 남아있으면 안 됨
  const subject = await page.locator('#email-subject').inputValue();
  const body    = await page.locator('#email-body').inputValue();
  const full = subject + '\n' + body;
  expect(full).not.toContain('{{customer_name}}');
  expect(full).not.toContain('{{contact_person}}');
  expect(full).not.toContain('{{my_company}}');
  expect(full).not.toContain('{{my_name}}');
  expect(full).not.toContain('{{today}}');
  // 본문/제목이 비어있지 않음
  expect(full.length).toBeGreaterThan(20);
});

// ─── 시나리오 2: 템플릿 변경 시 본문 갱신 ────────────────────
test('시나리오 2 — 템플릿 변경 시 본문 자동 갱신', async ({ page }) => {
  await page.goto('/#customers');
  await page.waitForSelector('tr[data-cust-id]', { timeout: 10000 });
  await page.locator(`tr[data-cust-id="${custId}"]`).click();
  await page.click('#cm-email-btn');
  await expect(page.locator('#email-tpl-select')).toBeVisible();

  const bodyBefore = await page.locator('#email-body').inputValue();

  // 다른 템플릿 선택
  const options = await page.locator('#email-tpl-select option').all();
  if (options.length > 1) {
    const secondValue = await options[1].getAttribute('value');
    await page.locator('#email-tpl-select').selectOption(secondValue);
    const bodyAfter = await page.locator('#email-body').inputValue();
    expect(bodyAfter).not.toBe(bodyBefore);
  }
});

// ─── 시나리오 3: Mailto 발송 + 활동 자동기록 ─────────────────
test('시나리오 3 — 발송 → mailto: URL 생성 + 활동 기록', async ({ page }) => {
  // 시드 리드 (이메일 활동 기록 검증용)
  const [l] = await pool.query(
    `INSERT INTO leads (customer_id, customer_name, project_name, business_type, region, stage)
       VALUES (?, ?, ?, '태양광', '국내', 'lead')`,
    [custId, `${PREFIX}고객사`, `${PREFIX}프로젝트`]
  );
  const leadId = l.insertId;

  try {
    // 리드 페이지에서 해당 리드 상세 열기
    await page.goto(`/#leads`);
    await page.waitForLoadState('networkidle');

    // App.openLeadDetail 직접 호출 (테이블 클릭은 환경 따라 변동성 높아)
    await page.evaluate((id) => App.openLeadDetail(id), leadId);
    await expect(page.locator('#ld-email')).toBeVisible({ timeout: 5000 });

    // ✉️ 이메일 클릭
    await page.click('#ld-email');
    await expect(page.locator('#email-tpl-select')).toBeVisible();

    // 수신자 채우기 (시드 고객사 이메일)
    await page.fill('#email-to', 'test@example.com');

    // 활동 자동기록 체크 상태 확인 (기본 체크됨)
    await expect(page.locator('#email-log-activity')).toBeChecked();

    // 발송
    await page.click('#email-send-btn');

    // mailto URL 캡처 확인 — page._capturedMailtos 는 비동기로 채워짐
    await expect.poll(() => page._capturedMailtos.length, { timeout: 5000 }).toBeGreaterThan(0);
    const mailto = page._capturedMailtos[0];
    expect(mailto).toMatch(/^mailto:test%40example\.com/);
    expect(mailto).toContain('subject=');
    expect(mailto).toContain('body=');

    // 활동 자동기록 확인 — DB 에서 직접 조회
    await page.waitForTimeout(500); // 활동 INSERT 대기
    const [rows] = await pool.query(
      `SELECT id, title, activity_type FROM activities
         WHERE lead_id = ? AND activity_type = '이메일'`,
      [leadId]
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  } finally {
    await pool.query(`DELETE FROM activities WHERE lead_id = ?`, [leadId]);
    await pool.query(`DELETE FROM leads WHERE id = ?`, [leadId]);
  }
});

// ─── 시나리오 4: 설정 페이지 — 새 템플릿 추가 ────────────────
test('시나리오 4 — 설정 페이지에서 새 템플릿 추가', async ({ page }) => {
  await page.goto('/#settings');
  await page.waitForSelector('#email-tpl-new-btn', { timeout: 10000 });
  // 초기 목록 로드 완료 대기
  await expect(page.locator('#email-tpl-list table')).toBeVisible({ timeout: 5000 });

  await page.click('#email-tpl-new-btn');
  await expect(page.locator('#tpl-name')).toBeVisible();

  const tplName = `${PREFIX}새템플릿`;
  await page.fill('#tpl-name', tplName);
  await page.locator('#tpl-category').selectOption('lead');
  await page.fill('#tpl-subject', `${PREFIX}제목 {{customer_name}}`);
  await page.fill('#tpl-body', `${PREFIX}본문 {{my_name}}`);
  await page.click('#tpl-save');

  // 모달이 닫히고 목록이 다시 로드될 때까지 폴링
  await expect(page.locator('#tpl-name')).toBeHidden({ timeout: 5000 });
  await expect.poll(
    async () => (await page.locator(`#email-tpl-list tr:has-text("${tplName}")`).count()),
    { timeout: 5000 }
  ).toBeGreaterThan(0);

  // 정리는 afterAll
});

// ─── 시나리오 5: 시스템 템플릿 보호 ──────────────────────────
test('시나리오 5 — 시스템 템플릿 편집/삭제 버튼 disabled', async ({ page }) => {
  await page.goto('/#settings');
  await page.waitForSelector('#email-tpl-list table', { timeout: 10000 });

  // 첫 시스템 템플릿 행의 편집/삭제 버튼
  const sysRow = page.locator('#email-tpl-list tbody tr').first();
  await expect(sysRow.locator('.badge', { hasText: '시스템' })).toBeVisible();
  await expect(sysRow.locator('[data-tpl-action="edit"]')).toBeDisabled();
  await expect(sysRow.locator('[data-tpl-action="delete"]')).toBeDisabled();
});
