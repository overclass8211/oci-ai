// =============================================================
// E2E — 수금관리 > 매출분석 탭 Chart.js 차트
//
// 백엔드 무변 — 기존 /payments/dashboard 데이터를 Chart.js 로 시각화.
// 검증 (API 모킹):
//   1) 매출분석 탭 진입 → 3개 캔버스(월별/상태별/연체) + 섹션 헤더
//   2) 탭 왕복(분석→현황→분석) 후에도 차트 재생성 정상 (인스턴스 파기/재생성)
// =============================================================
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers/auth');

const DASHBOARD = {
  kpi: { outstanding_amount: 14000000, this_month_scheduled: 6000000, overdue_amount: 11000000, overdue_count: 3, collection_rate: 42 },
  monthly_trend: [
    { month: '2026-03', scheduled: 5000000, collected: 5000000 },
    { month: '2026-04', scheduled: 8000000, collected: 3000000 },
    { month: '2026-05', scheduled: 6000000, collected: 0 },
  ],
  overdue_by_customer: [
    { customer_name: '감마건설', overdue_amount: 8000000, count: 2 },
    { customer_name: '델타상사', overdue_amount: 3000000, count: 1 },
  ],
};

const SCHEDULES = [
  { id: 1, contract_id: 101, customer_name: 'ACME전자', contract_name: '스마트팩토리', stage_name: '착수금', scheduled_amount: 2000000, paid_amount: 2000000, due_date: '2026-03-05', status: 'collected', currency: 'KRW' },
  { id: 2, contract_id: 101, customer_name: 'ACME전자', contract_name: '스마트팩토리', stage_name: '중도금', scheduled_amount: 3000000, paid_amount: 1500000, due_date: '2026-04-03', status: 'partial', currency: 'KRW' },
  { id: 3, contract_id: 102, customer_name: '감마건설', contract_name: '태양광 EPC', stage_name: '착수금', scheduled_amount: 8000000, paid_amount: 0, due_date: '2026-04-20', status: 'overdue', currency: 'KRW' },
  { id: 4, contract_id: 103, customer_name: '베타물산', contract_name: 'ESS 납품', stage_name: '잔금', scheduled_amount: 6000000, paid_amount: 0, due_date: '2026-05-16', status: 'scheduled', currency: 'KRW' },
];

async function mockPayments(page) {
  await page.route('**/api/payments**', async (route, request) => {
    const url = request.url();
    const method = request.method();
    const json = obj =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });
    if (/\/dashboard/.test(url)) return json({ success: true, data: DASHBOARD });
    if (/\/config/.test(url))
      return json({ success: true, data: { stage_types: ['착수금', '중도금', '잔금', '기타'], default_currency: 'KRW', allowed_currencies: ['KRW'] } });
    if (/\/overdue/.test(url)) return json({ success: true, data: [] });
    if (/\/tax-invoices/.test(url)) return json({ success: true, data: [] });
    if (method === 'GET') return json({ success: true, data: SCHEDULES });
    return route.fallback();
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('oci_onboarding_done', '1');
    } catch (_) {
      /* 무시 */
    }
  });
  await mockPayments(page);
  await loginAsAdmin(page);
});

test('매출분석 탭 — 3개 Chart.js 캔버스 + 섹션 헤더', async ({ page }) => {
  await page.goto('/#payments');
  await page.waitForSelector('#pay-btn-new', { timeout: 20000 });
  await page.click('.tab-bar .tab-btn[data-tab="analysis"]');
  await page.waitForSelector('#pay-chart-trend', { timeout: 10000 });

  await expect(page.locator('#pay-chart-trend')).toBeVisible();
  await expect(page.locator('#pay-chart-status')).toBeVisible();
  await expect(page.locator('#pay-chart-overdue')).toBeVisible();

  await expect(page.locator('#pay-tab-content')).toContainText('월별 수금 현황');
  await expect(page.locator('#pay-tab-content')).toContainText('상태별 수금예정액 비중');
  await expect(page.locator('#pay-tab-content')).toContainText('연체 미수금 TOP 5');
});

test('탭 왕복(분석→현황→분석) 후 차트 재생성 정상', async ({ page }) => {
  await page.goto('/#payments');
  await page.waitForSelector('#pay-btn-new', { timeout: 20000 });

  await page.click('.tab-bar .tab-btn[data-tab="analysis"]');
  await page.waitForSelector('#pay-chart-trend', { timeout: 10000 });

  // 수금현황으로 이동 → 차트 파기
  await page.click('.tab-bar .tab-btn[data-tab="overview"]');
  await page.waitForSelector('#pay-view-group', { timeout: 10000 });
  await expect(page.locator('#pay-chart-trend')).toHaveCount(0);

  // 다시 매출분석 → 차트 재생성
  await page.click('.tab-bar .tab-btn[data-tab="analysis"]');
  await page.waitForSelector('#pay-chart-trend', { timeout: 10000 });
  await expect(page.locator('#pay-chart-trend')).toBeVisible();
});

test('손익 시뮬레이터 — 매출 기본값 + 원가율 변경 시 영업이익 실시간 반영', async ({ page }) => {
  await page.goto('/#payments');
  await page.waitForSelector('#pay-btn-new', { timeout: 20000 });
  await page.click('.tab-bar .tab-btn[data-tab="analysis"]');
  await page.waitForSelector('#pnl-rev', { timeout: 10000 });

  // 기본 매출 = 수금 예정 합계 (2,000,000+3,000,000+8,000,000+6,000,000 = 19,000,000)
  await expect(page.locator('#pnl-rev')).toHaveValue('19000000');
  await expect(page.locator('#pnl-out')).toContainText('영업이익');
  // 시나리오 비교(보수/기본/낙관) 표시
  await expect(page.locator('#pnl-out')).toContainText('시나리오 비교');
  await expect(page.locator('#pnl-out')).toContainText('보수');
  await expect(page.locator('#pnl-out')).toContainText('낙관');

  // 원가율 90 + 판관비율 10 → 영업이익 0원 (영업이익률 0.0%) 실시간 반영
  await page.fill('#pnl-cost', '90');
  await page.fill('#pnl-sga', '10');
  await expect(page.locator('#pnl-out')).toContainText('0.0%');
});
