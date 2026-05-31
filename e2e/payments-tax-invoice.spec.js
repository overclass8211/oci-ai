// =============================================================
// E2E — 수금관리 > 세금계산서 탭 (Phase 2, 바로빌 키 불필요 부분)
//
// 백엔드는 tests/payments.test.mjs (vitest) 에서 검증.
// 여기서는 UI 동작만 (API 는 라우트 모킹으로 결정적 검증):
//   1) 세금계산서 탭 진입 → 안내 배너 + [+ 발행요청 생성] + 빈 목록
//   2) 발행요청 생성 → 작성중 → 발행요청 → 발행완료(수동) 상태 전환 흐름
//
// ※ "발행완료" 는 수동 상태 기록 (바로빌 자동발행/국세청 전송 아님)
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

// /api/payments** 전체를 하나의 핸들러로 모킹 (세금계산서는 인메모리 상태 저장)
async function mockPayments(page) {
  let taxStore = [];
  let nextId = 1;

  await page.route('**/api/payments**', async (route, request) => {
    const method = request.method();
    const url = request.url();
    const json = (obj, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });

    // ── 세금계산서 (상태 저장형 모킹) ──
    if (/\/tax-invoices/.test(url)) {
      const idMatch = url.match(/tax-invoices\/(\d+)/);
      if (method === 'GET') return json({ success: true, data: taxStore });
      if (method === 'POST') {
        const d = request.postDataJSON() || {};
        const row = {
          id: nextId++,
          status: 'draft',
          customer_name: d.customer_name,
          invoice_no: d.invoice_no || null,
          supply_amount: Number(d.supply_amount || 0),
          tax_amount: Number(d.tax_amount || 0),
          total_amount: Number(d.supply_amount || 0) + Number(d.tax_amount || 0),
          issue_date: d.issue_date || null,
        };
        taxStore.unshift(row);
        return json({ success: true, data: { id: row.id } });
      }
      if (method === 'PUT' && idMatch) {
        const id = Number(idMatch[1]);
        const d = request.postDataJSON() || {};
        const row = taxStore.find(r => r.id === id);
        if (row) Object.assign(row, d);
        return json({ success: true, data: { id, status: d.status || (row && row.status) } });
      }
      if (method === 'DELETE' && idMatch) {
        const id = Number(idMatch[1]);
        taxStore = taxStore.filter(r => r.id !== id);
        return json({ success: true });
      }
      return route.fallback();
    }

    // ── KPI / 설정 / 미수금 / 목록 ──
    if (/\/dashboard/.test(url))
      return json({
        success: true,
        data: {
          kpi: {
            outstanding_amount: 0,
            this_month_scheduled: 0,
            overdue_amount: 0,
            overdue_count: 0,
            collection_rate: 0,
          },
          monthly_trend: [],
          overdue_by_customer: [],
        },
      });
    if (/\/config/.test(url))
      return json({
        success: true,
        data: {
          stage_types: ['착수금', '중도금', '잔금', '기타'],
          default_currency: 'KRW',
          allowed_currencies: ['KRW', 'USD'],
        },
      });
    if (/\/overdue/.test(url)) return json({ success: true, data: [] });
    if (method === 'GET') return json({ success: true, data: [] });
    return route.fallback();
  });
}

test.beforeEach(async ({ page }) => {
  // 온보딩 가이드 투어 억제 (다른 e2e 와 동일 — 오버레이가 클릭 가로채는 것 방지)
  await page.addInitScript(() => {
    try {
      localStorage.setItem('oci_onboarding_done', '1');
    } catch (_) {
      /* localStorage 접근 제한 — 무시 */
    }
  });
  await loginAsAdmin(page);
});

test('세금계산서 탭 진입 → 안내 배너 + [+ 발행요청 생성] + 빈 목록', async ({ page }) => {
  await mockPayments(page);

  await page.goto('/#payments');
  await page.waitForSelector('#pay-btn-new', { timeout: 15000 });

  // 세금계산서 탭 클릭
  await page.click('.tab-bar .tab-btn[data-tab="tax"]');
  await page.waitForSelector('#tax-btn-new', { timeout: 5000 });

  // 수동 상태 관리 안내 (바로빌 자동발행 아님)
  await expect(page.locator('#pay-tab-content')).toContainText('수동으로 기록');
  await expect(page.locator('#pay-tab-content')).toContainText('API 키 등록 후');
  await expect(page.locator('#tax-btn-new')).toBeVisible();

  // 빈 목록 안내
  await expect(page.locator('#pay-tab-content')).toContainText('세금계산서가 없습니다');
});

test('발행요청 생성 → 작성중 → 발행요청 → 발행완료(수동) 상태 전환', async ({ page }) => {
  await mockPayments(page);
  // confirm() 대화상자 자동 수락 (발행완료/취소 전환 시)
  page.on('dialog', dialog => dialog.accept());

  await page.goto('/#payments');
  await page.waitForSelector('#pay-btn-new', { timeout: 15000 });
  await page.click('.tab-bar .tab-btn[data-tab="tax"]');
  await page.waitForSelector('#tax-btn-new', { timeout: 5000 });

  // [+ 발행요청 생성] → 모달
  await page.click('#tax-btn-new');
  await page.waitForSelector('#tax-cust', { timeout: 5000 });
  await page.fill('#tax-cust', 'E2E세금상사');
  await page.fill('#tax-supply', '1000000');
  await page.click('#tax-vat10'); // 세액 자동 10% (100,000)
  await expect(page.locator('#tax-tax')).toHaveValue('100000');
  await page.click('#tax-save');

  // 목록에 행 표시 + 작성중 배지
  await expect(page.locator('#pay-tab-content')).toContainText('E2E세금상사', { timeout: 5000 });
  await expect(page.locator('#pay-tab-content')).toContainText('작성중');
  await expect(page.locator('.tax-act[data-to="requested"]')).toBeVisible();

  // 발행요청 전환 (확인창 없음)
  await page.click('.tax-act[data-to="requested"]');
  await expect(page.locator('#pay-tab-content')).toContainText('발행요청', { timeout: 5000 });
  await expect(page.locator('.tax-act[data-to="issued"]')).toBeVisible();

  // 발행완료(수동) 전환 (확인창 수락)
  await page.click('.tax-act[data-to="issued"]');
  await expect(page.locator('#pay-tab-content')).toContainText('발행완료', { timeout: 5000 });
  // 발행완료 건은 삭제 버튼 없음
  await expect(page.locator('.tax-del')).toHaveCount(0);
});
