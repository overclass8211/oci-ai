// ============================================================
// Payments Page — 수금관리 (SFR-011) v8.0.0
// F1. 수금현황  F2. 미수금  F3. 세금계산서  F4. 매출분석
// ============================================================
/* global API, Toast, Modal */
const PaymentsPage = {
  activeTab: 'overview',

  // ── 상태 ────────────────────────────────────────────────────
  _schedules: [],
  _overdue: [],
  _dashboard: null,
  _filter: { status: '', search: '', due_from: '', due_to: '' },
  _sort: { key: 'due_date', dir: 'asc' },
  _filterTimer: null,

  // ── 진입점 ──────────────────────────────────────────────────
  async render() {
    document.getElementById('content').innerHTML = `
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <h2 style="margin:0;font-size:18px;font-weight:700">💰 수금관리</h2>
        <button id="pay-btn-new" class="btn btn-primary btn-sm">+ 수금 스케줄 등록</button>
      </div>

      <!-- KPI 카드 영역 -->
      <div id="pay-kpi" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
        <div class="pay-kpi-card loading-skeleton" style="height:80px;border-radius:8px"></div>
        <div class="pay-kpi-card loading-skeleton" style="height:80px;border-radius:8px"></div>
        <div class="pay-kpi-card loading-skeleton" style="height:80px;border-radius:8px"></div>
        <div class="pay-kpi-card loading-skeleton" style="height:80px;border-radius:8px"></div>
      </div>

      <!-- 탭 바 -->
      <div class="tab-bar" style="margin-bottom:12px">
        <button class="tab-btn ${this.activeTab === 'overview' ? 'active' : ''}" data-tab="overview">💰 수금현황</button>
        <button class="tab-btn ${this.activeTab === 'overdue' ? 'active' : ''}" data-tab="overdue">⚠️ 미수금</button>
        <button class="tab-btn ${this.activeTab === 'tax' ? 'active' : ''}" data-tab="tax">🧾 세금계산서</button>
        <button class="tab-btn ${this.activeTab === 'analysis' ? 'active' : ''}" data-tab="analysis">📊 매출분석</button>
      </div>

      <div id="pay-tab-content"></div>
    `;

    // 탭 이벤트
    document.querySelector('.tab-bar')?.addEventListener('click', e => {
      const btn = e.target.closest('.tab-btn[data-tab]');
      if (!btn) return;
      this.activeTab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this._renderTab();
    });

    // 신규 등록 버튼
    document.getElementById('pay-btn-new')?.addEventListener('click', () => this._openScheduleModal());

    // 필터/정렬 초기화 (페이지 진입 시 리셋)
    this._filter = { status: '', search: '', due_from: '', due_to: '' };
    this._sort   = { key: 'due_date', dir: 'asc' };

    // 데이터 로드
    await Promise.all([this._loadDashboard(), this._loadSchedules()]);
    this._renderTab();
  },

  // ── 탭 렌더 분기 ────────────────────────────────────────────
  _renderTab() {
    switch (this.activeTab) {
      case 'overview':  this._renderOverview();  break;
      case 'overdue':   this._renderOverdue();   break;
      case 'tax':       this._renderTax();       break;
      case 'analysis':  this._renderAnalysis();  break;
    }
  },

  // ── 데이터 로드 ─────────────────────────────────────────────
  async _loadDashboard() {
    try {
      const res = await API.get('/payments/dashboard');
      if (res.success) {
        this._dashboard = res.data;
        this._renderKpi(res.data.kpi);
      }
    } catch (e) {
      console.error('[payments] dashboard 로드 실패', e);
    }
  },

  async _loadSchedules() {
    try {
      const p = new URLSearchParams();
      if (this._filter.status)   p.set('status',   this._filter.status);
      if (this._filter.due_from) p.set('due_from', this._filter.due_from);
      if (this._filter.due_to)   p.set('due_to',   this._filter.due_to);
      const qs = p.toString() ? '?' + p.toString() : '';
      const res = await API.get('/payments' + qs);
      if (res.success) this._schedules = res.data;
    } catch (e) {
      console.error('[payments] 스케줄 로드 실패', e);
    }
  },

  async _loadOverdue() {
    try {
      const res = await API.get('/payments/overdue');
      if (res.success) this._overdue = res.data;
    } catch (e) {
      console.error('[payments] 미수금 로드 실패', e);
    }
  },

  // ── KPI 카드 ────────────────────────────────────────────────
  _renderKpi(kpi) {
    if (!kpi) return;
    const fmt = n => Number(n || 0).toLocaleString('ko-KR');
    document.getElementById('pay-kpi').innerHTML = `
      <div class="pay-kpi-card" style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:14px 16px">
        <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">수주잔액 (미수금)</div>
        <div style="font-size:20px;font-weight:700;color:#1664E5">₩${fmt(kpi.outstanding_amount)}</div>
      </div>
      <div class="pay-kpi-card" style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:14px 16px">
        <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">이번달 예정수금</div>
        <div style="font-size:20px;font-weight:700;color:#0F7A3F">₩${fmt(kpi.this_month_scheduled)}</div>
      </div>
      <div class="pay-kpi-card" style="background:${kpi.overdue_amount > 0 ? '#FFF5F5' : '#fff'};border:1px solid ${kpi.overdue_amount > 0 ? '#FECACA' : 'var(--border)'};border-radius:8px;padding:14px 16px">
        <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">연체 미수금 (${kpi.overdue_count}건)</div>
        <div style="font-size:20px;font-weight:700;color:${kpi.overdue_amount > 0 ? '#E63329' : '#6B7280'}">₩${fmt(kpi.overdue_amount)}</div>
      </div>
      <div class="pay-kpi-card" style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:14px 16px">
        <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">수금 달성률</div>
        <div style="font-size:20px;font-weight:700;color:#7C4DFF">${kpi.collection_rate ?? 0}%</div>
        <div style="height:4px;background:#EDE9FE;border-radius:2px;margin-top:6px">
          <div style="height:100%;width:${Math.min(kpi.collection_rate ?? 0, 100)}%;background:#7C4DFF;border-radius:2px"></div>
        </div>
      </div>
    `;
  },

  // ── F1. 수금현황 탭 ─────────────────────────────────────────
  _renderOverview() {
    const el = document.getElementById('pay-tab-content');
    const STATUS_META = {
      scheduled:   { label: '예정',    color: '#6B7280', bg: '#F3F4F6' },
      invoiced:    { label: '청구',    color: '#1664E5', bg: '#EFF6FF' },
      partial:     { label: '부분수금', color: '#F59C00', bg: '#FFFBEB' },
      collected:   { label: '수금완료', color: '#0F7A3F', bg: '#ECFDF5' },
      overdue:     { label: '연체',    color: '#E63329', bg: '#FFF5F5' },
      written_off: { label: '대손처리', color: '#374151', bg: '#F9FAFB' },
    };

    // 필터+정렬 적용 목록
    const list = this._filteredAndSorted();
    const { key: sKey, dir: sDir } = this._sort;
    const sarr = col => sKey === col ? (sDir === 'asc' ? ' ↑' : ' ↓') : ' ⇅';
    const thS  = 'padding:8px 12px;text-align:left;font-weight:600;cursor:pointer;user-select:none;white-space:nowrap';
    const thSR = 'padding:8px 12px;text-align:right;font-weight:600;cursor:pointer;user-select:none;white-space:nowrap';

    // 기간 프리셋 계산
    const now  = new Date();
    const p2   = n => String(n).padStart(2, '0');
    const thisM1 = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-01`;
    const thisM2 = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    const nxtM1  = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().slice(0, 10);
    const nxtM2  = new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString().slice(0, 10);
    const isThisM = this._filter.due_from === thisM1 && this._filter.due_to === thisM2;
    const isNextM = this._filter.due_from === nxtM1  && this._filter.due_to === nxtM2;
    const isAll   = !this._filter.due_from && !this._filter.due_to;

    const pBtn = (lbl, f, t, on) =>
      `<button class="pay-period btn btn-sm" data-f="${f}" data-t="${t}"
         style="font-size:12px;${on ? 'background:var(--primary,#E63329);color:#fff;border-color:var(--primary,#E63329)' : ''}">${lbl}</button>`;

    // 합계
    const fmt = n => Number(n || 0).toLocaleString('ko-KR');
    const totSch  = list.reduce((s, r) => s + Number(r.scheduled_amount || 0), 0);
    const totPaid = list.reduce((s, r) => s + Number(r.paid_amount || 0), 0);

    // 행 생성
    const rows = list.map(s => {
      const m   = STATUS_META[s.status] || STATUS_META.scheduled;
      const pct = s.scheduled_amount > 0
        ? Math.min(Math.round((Number(s.paid_amount) / Number(s.scheduled_amount)) * 100), 100) : 0;
      const dDay = this._dDay(s.due_date);
      return `
        <tr class="pay-row" data-id="${s.id}" style="cursor:pointer;border-bottom:1px solid var(--border)">
          <td style="padding:10px 12px">
            <div style="font-weight:600;font-size:13px">${this._esc(s.customer_name || '—')}</div>
            <div style="font-size:11px;color:var(--text-3)">${this._esc(s.contract_name || s.contract_no || '—')}</div>
          </td>
          <td style="padding:10px 12px;font-size:13px">${this._esc(s.stage_name)}</td>
          <td style="padding:10px 12px;font-size:13px;text-align:right;font-weight:600">
            ₩${fmt(s.scheduled_amount)}
          </td>
          <td style="padding:10px 12px;font-size:12px;white-space:nowrap">
            ${s.due_date || '—'}
            <span style="margin-left:4px;font-size:11px;font-weight:600;color:${dDay.color}">${dDay.label}</span>
          </td>
          <td style="padding:10px 12px">
            <span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;background:${m.bg};color:${m.color};font-weight:600">${m.label}</span>
          </td>
          <td style="padding:10px 12px;min-width:90px">
            <div style="display:flex;align-items:center;gap:6px">
              <div style="flex:1;height:4px;background:#E5E7EB;border-radius:2px">
                <div style="height:100%;width:${pct}%;background:#1664E5;border-radius:2px"></div>
              </div>
              <span style="font-size:11px;color:var(--text-3);min-width:28px">${pct}%</span>
            </div>
          </td>
          <td style="padding:10px 12px;white-space:nowrap">
            <button class="pay-btn-record btn btn-sm" data-id="${s.id}"
              style="font-size:11px;padding:3px 7px;background:#EFF6FF;color:#1664E5;border:1px solid #BFDBFE;border-radius:6px;margin-right:3px" title="입금 등록">💳</button>
            <button class="pay-btn-edit btn btn-sm" data-id="${s.id}"
              style="font-size:11px;padding:3px 7px;background:#F3F4F6;color:#374151;border:1px solid var(--border);border-radius:6px;margin-right:3px" title="수정">✏️</button>
            <button class="pay-btn-delete btn btn-sm" data-id="${s.id}"
              style="font-size:11px;padding:3px 7px;background:#FFF5F5;color:#E63329;border:1px solid #FECACA;border-radius:6px" title="삭제">🗑️</button>
          </td>
        </tr>`;
    }).join('');

    el.innerHTML = `
      <!-- 필터 바 -->
      <div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:10px 14px;margin-bottom:12px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <div style="display:flex;gap:3px">
            ${pBtn('이번달', thisM1, thisM2, isThisM)}
            ${pBtn('다음달', nxtM1,  nxtM2,  isNextM)}
            ${pBtn('전체',   '',      '',     isAll)}
          </div>
          <div style="width:1px;height:22px;background:var(--border)"></div>
          <select id="pay-fl-status" class="form-input" style="width:110px;font-size:12px;padding:4px 8px">
            <option value="">전체 상태</option>
            <option value="scheduled" ${this._filter.status === 'scheduled' ? 'selected' : ''}>예정</option>
            <option value="invoiced"  ${this._filter.status === 'invoiced'  ? 'selected' : ''}>청구</option>
            <option value="partial"   ${this._filter.status === 'partial'   ? 'selected' : ''}>부분수금</option>
            <option value="collected" ${this._filter.status === 'collected' ? 'selected' : ''}>수금완료</option>
            <option value="overdue"   ${this._filter.status === 'overdue'   ? 'selected' : ''}>연체</option>
          </select>
          <input id="pay-fl-search" class="form-input" placeholder="🔍 고객사/계약명"
            value="${this._esc(this._filter.search)}" style="width:160px;font-size:12px;padding:4px 8px">
          <input id="pay-fl-from" type="date" class="form-input" value="${this._filter.due_from}"
            style="width:130px;font-size:12px;padding:4px 8px">
          <span style="color:var(--text-3);font-size:12px">~</span>
          <input id="pay-fl-to" type="date" class="form-input" value="${this._filter.due_to}"
            style="width:130px;font-size:12px;padding:4px 8px">
          <div style="margin-left:auto;font-size:12px;color:var(--text-3);white-space:nowrap">
            총 <b style="color:var(--text-1)">${list.length}건</b>
            &nbsp;·&nbsp;예정 <b style="color:#1664E5">₩${fmt(totSch)}</b>
            &nbsp;·&nbsp;수금 <b style="color:#0F7A3F">₩${fmt(totPaid)}</b>
          </div>
        </div>
      </div>

      <!-- 테이블 -->
      <div style="background:#fff;border:1px solid var(--border);border-radius:8px;overflow:hidden">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:#F9FAFB;font-size:12px;color:var(--text-3)">
              <th id="pay-th-cust"  style="${thS}">고객사${sarr('customer_name')}</th>
              <th id="pay-th-stage" style="${thS}">단계${sarr('stage_name')}</th>
              <th id="pay-th-amt"   style="${thSR}">수금예정액${sarr('scheduled_amount')}</th>
              <th id="pay-th-due"   style="${thS}">예정일${sarr('due_date')}</th>
              <th style="padding:8px 12px;font-weight:600">상태</th>
              <th style="padding:8px 12px;font-weight:600">진행률</th>
              <th style="padding:8px 12px;width:90px"></th>
            </tr>
          </thead>
          <tbody id="pay-tbody">
            ${rows || `<tr><td colspan="7" style="text-align:center;padding:48px 20px;color:var(--text-3)">
              <div style="font-size:32px;margin-bottom:8px">💰</div>
              <div style="font-weight:600;margin-bottom:4px">수금 스케줄이 없습니다</div>
              <div style="font-size:12px">상단 [+ 수금 스케줄 등록] 버튼을 클릭하세요</div>
            </td></tr>`}
          </tbody>
          ${list.length ? `
          <tfoot>
            <tr style="background:#F0F4FF;font-size:12px;font-weight:600;border-top:2px solid #BFDBFE">
              <td colspan="2" style="padding:8px 12px;color:var(--text-3)">합계 ${list.length}건</td>
              <td style="padding:8px 12px;text-align:right;color:#1664E5">₩${fmt(totSch)}</td>
              <td colspan="4" style="padding:8px 12px;color:#0F7A3F">수금 ₩${fmt(totPaid)}</td>
            </tr>
          </tfoot>` : ''}
        </table>
      </div>
    `;

    // ── 이벤트 바인딩 ──────────────────────────────────────────

    // 기간 프리셋 → 서버 재조회
    el.querySelectorAll('.pay-period').forEach(btn => {
      btn.addEventListener('click', async () => {
        this._filter.due_from = btn.dataset.f;
        this._filter.due_to   = btn.dataset.t;
        await this._reloadAndRender();
      });
    });

    // 상태 필터 → 서버 재조회
    document.getElementById('pay-fl-status')?.addEventListener('change', async e => {
      this._filter.status = e.target.value;
      await this._reloadAndRender();
    });

    // 검색 → 클라이언트 즉시 반영 (200ms debounce)
    document.getElementById('pay-fl-search')?.addEventListener('input', e => {
      this._filter.search = e.target.value;
      clearTimeout(this._filterTimer);
      this._filterTimer = setTimeout(() => this._renderOverview(), 200);
    });

    // 날짜 범위 → 서버 재조회
    document.getElementById('pay-fl-from')?.addEventListener('change', async e => {
      this._filter.due_from = e.target.value;
      await this._reloadAndRender();
    });
    document.getElementById('pay-fl-to')?.addEventListener('change', async e => {
      this._filter.due_to = e.target.value;
      await this._reloadAndRender();
    });

    // 정렬 헤더 클릭
    [['pay-th-cust', 'customer_name'], ['pay-th-stage', 'stage_name'],
     ['pay-th-amt', 'scheduled_amount'], ['pay-th-due', 'due_date']
    ].forEach(([thId, col]) => {
      document.getElementById(thId)?.addEventListener('click', () => this._setSortKey(col));
    });

    // 행 클릭 → 상세
    el.querySelectorAll('.pay-row').forEach(tr => {
      tr.addEventListener('click', e => {
        if (e.target.closest('.pay-btn-record,.pay-btn-edit,.pay-btn-delete')) return;
        this._openScheduleDetail(parseInt(tr.dataset.id, 10));
      });
    });

    // 입금 등록
    el.querySelectorAll('.pay-btn-record').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        this._openRecordModal(parseInt(btn.dataset.id, 10));
      });
    });

    // 수정
    el.querySelectorAll('.pay-btn-edit').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const s = this._schedules.find(x => x.id === parseInt(btn.dataset.id, 10));
        if (s) this._openScheduleModal(s);
      });
    });

    // 삭제
    el.querySelectorAll('.pay-btn-delete').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        this._deleteSchedule(parseInt(btn.dataset.id, 10));
      });
    });
  },

  // ── F3. 미수금 탭 ───────────────────────────────────────────
  async _renderOverdue() {
    await this._loadOverdue();
    const el = document.getElementById('pay-tab-content');
    if (!this._overdue.length) {
      el.innerHTML = `<div style="text-align:center;padding:60px;color:var(--text-3)">
        <div style="font-size:40px;margin-bottom:12px">✅</div>
        <div>현재 연체된 미수금이 없습니다</div>
      </div>`;
      return;
    }
    const rows = this._overdue.map(s => `
      <tr>
        <td style="padding:10px 12px">
          <div style="font-weight:600">${this._esc(s.customer_name || '—')}</div>
          <div style="font-size:11px;color:var(--text-3)">${this._esc(s.stage_name)}</div>
        </td>
        <td style="padding:10px 12px;font-size:13px;color:#E63329;font-weight:700">
          ₩${Number(s.scheduled_amount).toLocaleString('ko-KR')}
        </td>
        <td style="padding:10px 12px;font-size:13px">${s.due_date}</td>
        <td style="padding:10px 12px">
          <span style="background:#FEF2F2;color:#E63329;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700">
            D+${s.overdue_days}일 연체
          </span>
        </td>
        <td style="padding:10px 12px">
          <button class="pay-btn-record btn btn-sm" data-id="${s.id}"
            style="font-size:11px;padding:3px 8px;background:#FFF5F5;color:#E63329;border:1px solid #FECACA;border-radius:6px">
            💳 입금등록
          </button>
        </td>
      </tr>
    `).join('');

    el.innerHTML = `
      <div style="background:#FFF5F5;border:1px solid #FECACA;border-radius:8px;padding:12px 16px;margin-bottom:12px;display:flex;gap:8px;align-items:center">
        <span style="font-size:16px">⚠️</span>
        <span style="font-size:13px;color:#E63329;font-weight:600">연체 ${this._overdue.length}건 — 즉시 수금 조치가 필요합니다</span>
      </div>
      <div style="background:#fff;border:1px solid var(--border);border-radius:8px;overflow:hidden">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:#F9FAFB;font-size:12px;color:var(--text-3)">
              <th style="padding:8px 12px;text-align:left;font-weight:600">고객사 / 단계</th>
              <th style="padding:8px 12px;text-align:left;font-weight:600">연체금액</th>
              <th style="padding:8px 12px;text-align:left;font-weight:600">예정일</th>
              <th style="padding:8px 12px;text-align:left;font-weight:600">연체일수</th>
              <th style="padding:8px 12px"></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    el.querySelectorAll('.pay-btn-record').forEach(btn => {
      btn.addEventListener('click', () => this._openRecordModal(parseInt(btn.dataset.id, 10)));
    });
  },

  // ── F4. 세금계산서 탭 ───────────────────────────────────────
  _renderTax() {
    const el = document.getElementById('pay-tab-content');
    el.innerHTML = `<div style="text-align:center;padding:60px;color:var(--text-3)">
      <div style="font-size:40px;margin-bottom:12px">🧾</div>
      <div style="font-weight:600;margin-bottom:8px">세금계산서 발행 (바로빌 API)</div>
      <div style="font-size:13px">Phase 2에서 바로빌 API 연동 후 활성화 예정입니다</div>
      <div style="margin-top:16px">
        <span style="background:#FFFBEB;color:#F59C00;padding:4px 12px;border-radius:20px;font-size:12px;border:1px solid #FDE68A">
          🔌 바로빌 API 키 등록 후 사용 가능
        </span>
      </div>
    </div>`;
  },

  // ── F5. 매출분석 탭 ─────────────────────────────────────────
  _renderAnalysis() {
    const el = document.getElementById('pay-tab-content');
    const d = this._dashboard;
    if (!d) {
      el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-3)">데이터 로드 중...</div>`;
      return;
    }

    const trend = d.monthly_trend || [];
    const overdueByCust = d.overdue_by_customer || [];
    const fmt = n => Number(n || 0).toLocaleString('ko-KR');

    // 월별 추이 bar
    const maxVal = Math.max(...trend.map(t => Math.max(Number(t.scheduled), Number(t.collected))), 1);
    const trendBars = trend.map(t => {
      const schPct = Math.round((Number(t.scheduled) / maxVal) * 100);
      const colPct = Math.round((Number(t.collected) / maxVal) * 100);
      return `
        <div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1">
          <div style="display:flex;gap:2px;align-items:flex-end;height:80px">
            <div style="width:14px;background:#BFDBFE;border-radius:2px 2px 0 0;height:${schPct}%" title="예정: ₩${fmt(t.scheduled)}"></div>
            <div style="width:14px;background:#1664E5;border-radius:2px 2px 0 0;height:${colPct}%" title="실적: ₩${fmt(t.collected)}"></div>
          </div>
          <div style="font-size:10px;color:var(--text-3)">${t.month?.slice(5)}</div>
        </div>
      `;
    }).join('');

    const overdueRows = overdueByCust.map(c => `
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:13px">${this._esc(c.customer_name)}</span>
        <span style="font-size:13px;font-weight:600;color:#E63329">₩${fmt(c.overdue_amount)}</span>
      </div>
    `).join('') || '<div style="text-align:center;padding:16px;color:var(--text-3)">연체 미수금 없음</div>';

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px">
        <!-- 월별 추이 -->
        <div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:16px">
          <div style="font-weight:600;margin-bottom:12px;font-size:13px">📈 월별 수금 현황 (최근 6개월)</div>
          <div style="display:flex;gap:8px;align-items:flex-end;margin-bottom:8px">
            ${trendBars || '<div style="color:var(--text-3);font-size:12px">데이터 없음</div>'}
          </div>
          <div style="display:flex;gap:12px;font-size:11px;color:var(--text-3)">
            <span><span style="display:inline-block;width:10px;height:10px;background:#BFDBFE;border-radius:1px;margin-right:4px"></span>예정</span>
            <span><span style="display:inline-block;width:10px;height:10px;background:#1664E5;border-radius:1px;margin-right:4px"></span>실적</span>
          </div>
        </div>
        <!-- 고객사별 미수금 TOP 5 -->
        <div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:16px">
          <div style="font-weight:600;margin-bottom:12px;font-size:13px">⚠️ 연체 미수금 TOP 5</div>
          ${overdueRows}
        </div>
      </div>
    `;
  },

  // ── 수금 스케줄 등록 모달 ───────────────────────────────────
  _openScheduleModal(schedule = null) {
    const isEdit = !!schedule;
    Modal.open({
      title: isEdit ? '수금 스케줄 수정' : '수금 스케줄 등록',
      size: 'md',
      body: `
        <div style="display:grid;gap:12px">
          <div>
            <label class="form-label">고객사명 *</label>
            <input id="pay-m-customer" class="form-input" value="${this._esc(schedule?.customer_name || '')}" placeholder="고객사 이름">
          </div>
          <div>
            <label class="form-label">계약/프로젝트명</label>
            <input id="pay-m-contract-name" class="form-input" value="${this._esc(schedule?.contract_name || '')}" placeholder="계약명 또는 프로젝트명">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <label class="form-label">수금 단계 *</label>
              <select id="pay-m-stage" class="form-input">
                <option value="착수금" ${schedule?.stage_name === '착수금' ? 'selected' : ''}>착수금</option>
                <option value="중도금" ${schedule?.stage_name === '중도금' ? 'selected' : ''}>중도금</option>
                <option value="잔금"   ${schedule?.stage_name === '잔금' ? 'selected' : ''}>잔금</option>
                <option value="기타"   ${!['착수금','중도금','잔금'].includes(schedule?.stage_name) ? 'selected' : ''}>기타</option>
              </select>
            </div>
            <div>
              <label class="form-label">수금 예정일 *</label>
              <input id="pay-m-due-date" type="date" class="form-input" value="${schedule?.due_date || ''}">
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <label class="form-label">수금 예정액 (VAT 포함) *</label>
              <input id="pay-m-amount" type="number" class="form-input" value="${schedule?.scheduled_amount || ''}" placeholder="0">
            </div>
            <div>
              <label class="form-label">부가세</label>
              <input id="pay-m-tax" type="number" class="form-input" value="${schedule?.tax_amount || ''}" placeholder="자동 계산">
            </div>
          </div>
          <div>
            <label class="form-label">비고</label>
            <textarea id="pay-m-note" class="form-input" rows="2" placeholder="메모">${this._esc(schedule?.note || '')}</textarea>
          </div>
        </div>
      `,
      footer: `
        <button id="pay-m-cancel" class="btn btn-secondary">취소</button>
        <button id="pay-m-save" class="btn btn-primary">${isEdit ? '저장' : '등록'}</button>
      `,
      onOpen: () => {
        // VAT 자동 계산
        document.getElementById('pay-m-amount')?.addEventListener('input', e => {
          const amt = Number(e.target.value) || 0;
          const tax = Math.round(amt - amt / 1.1);
          document.getElementById('pay-m-tax').value = tax || '';
        });
        document.getElementById('pay-m-cancel')?.addEventListener('click', () => Modal.close());
        document.getElementById('pay-m-save')?.addEventListener('click', () => this._saveSchedule(schedule?.id));
      },
    });
  },

  async _saveSchedule(existingId = null) {
    const customer_name = document.getElementById('pay-m-customer')?.value.trim();
    const contract_name = document.getElementById('pay-m-contract-name')?.value.trim();
    const stage_name = document.getElementById('pay-m-stage')?.value;
    const due_date = document.getElementById('pay-m-due-date')?.value;
    const scheduled_amount = document.getElementById('pay-m-amount')?.value;
    const tax_amount = document.getElementById('pay-m-tax')?.value;
    const note = document.getElementById('pay-m-note')?.value.trim();

    if (!customer_name) { Toast.error?.('고객사명을 입력하세요'); return; }
    if (!scheduled_amount) { Toast.error?.('수금 예정액을 입력하세요'); return; }
    if (!due_date) { Toast.error?.('수금 예정일을 입력하세요'); return; }

    const payload = { customer_name, contract_name, stage_name, due_date,
                      scheduled_amount: Number(scheduled_amount),
                      tax_amount: Number(tax_amount || 0),
                      supply_amount: Math.round(Number(scheduled_amount) / 1.1),
                      note };
    try {
      if (existingId) {
        await API.put(`/payments/${existingId}`, payload);
        Toast.success?.('수금 스케줄이 수정됐습니다');
      } else {
        await API.post('/payments', payload);
        Toast.success?.('수금 스케줄이 등록됐습니다');
      }
      Modal.close();
      await this._loadSchedules();
      await this._loadDashboard();
      this._renderTab();
    } catch (err) {
      Toast.error?.('저장 실패: ' + (err?.message || err));
    }
  },

  // ── 입금 등록 모달 ──────────────────────────────────────────
  _openRecordModal(scheduleId) {
    const schedule = this._schedules.find(s => s.id === scheduleId)
      || this._overdue.find(s => s.id === scheduleId);
    const remaining = schedule
      ? Math.max(0, Number(schedule.scheduled_amount) - Number(schedule.paid_amount || 0))
      : 0;

    Modal.open({
      title: '💳 입금 등록',
      size: 'sm',
      body: `
        <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:6px;padding:10px 12px;margin-bottom:12px;font-size:13px">
          <b>${this._esc(schedule?.customer_name || '')}</b> · ${this._esc(schedule?.stage_name || '')}
          <span style="float:right;color:#0F7A3F;font-weight:700">잔여: ₩${remaining.toLocaleString('ko-KR')}</span>
        </div>
        <div style="display:grid;gap:10px">
          <div>
            <label class="form-label">입금일 *</label>
            <input id="rec-date" type="date" class="form-input" value="${new Date().toISOString().slice(0, 10)}">
          </div>
          <div>
            <label class="form-label">입금액 *</label>
            <div style="display:flex;gap:8px">
              <input id="rec-amount" type="number" class="form-input" placeholder="0" style="flex:1">
              <button type="button" id="rec-full" class="btn btn-sm" style="white-space:nowrap;background:#EFF6FF;color:#1664E5;border:1px solid #BFDBFE">전액</button>
            </div>
          </div>
          <div>
            <label class="form-label">입금 방법</label>
            <select id="rec-method" class="form-input">
              <option value="bank_transfer">계좌이체</option>
              <option value="card">카드</option>
              <option value="cash">현금</option>
              <option value="other">기타</option>
            </select>
          </div>
          <div>
            <label class="form-label">참조번호 (선택)</label>
            <input id="rec-ref" class="form-input" placeholder="입금 이체번호">
          </div>
          <div>
            <label class="form-label">비고</label>
            <input id="rec-note" class="form-input" placeholder="메모">
          </div>
        </div>
      `,
      footer: `
        <button id="rec-cancel" class="btn btn-secondary">취소</button>
        <button id="rec-save" class="btn btn-primary">입금 등록</button>
      `,
      onOpen: () => {
        document.getElementById('rec-full')?.addEventListener('click', () => {
          document.getElementById('rec-amount').value = remaining;
        });
        document.getElementById('rec-cancel')?.addEventListener('click', () => Modal.close());
        document.getElementById('rec-save')?.addEventListener('click', async () => {
          const paid_date = document.getElementById('rec-date')?.value;
          const paid_amount = document.getElementById('rec-amount')?.value;
          if (!paid_date || !paid_amount) { Toast.error?.('입금일과 입금액을 입력하세요'); return; }
          try {
            const res = await API.post(`/payments/${scheduleId}/records`, {
              paid_date,
              paid_amount: Number(paid_amount),
              payment_method: document.getElementById('rec-method')?.value,
              reference_no: document.getElementById('rec-ref')?.value,
              note: document.getElementById('rec-note')?.value,
            });
            Toast.success?.(`입금 등록 완료 — 상태: ${res.data?.new_status || '갱신됨'}`);
            Modal.close();
            await Promise.all([this._loadSchedules(), this._loadDashboard()]);
            this._renderTab();
          } catch (err) {
            Toast.error?.('입금 등록 실패: ' + (err?.message || err));
          }
        });
      },
    });
  },

  // ── 스케줄 상세 모달 ────────────────────────────────────────
  async _openScheduleDetail(scheduleId) {
    try {
      const res = await API.get(`/payments/${scheduleId}`);
      if (!res.success) { Toast.error?.('조회 실패'); return; }
      const s = res.data;
      const fmt = n => Number(n || 0).toLocaleString('ko-KR');
      const records = s.records || [];
      const recRows = records.map(r => `
        <tr>
          <td style="padding:6px 8px;font-size:12px">${r.paid_date}</td>
          <td style="padding:6px 8px;font-size:12px;font-weight:600;color:#0F7A3F">₩${fmt(r.paid_amount)}</td>
          <td style="padding:6px 8px;font-size:12px">${r.payment_method === 'bank_transfer' ? '계좌이체' : r.payment_method}</td>
          <td style="padding:6px 8px;font-size:12px;color:var(--text-3)">${r.reference_no || '—'}</td>
        </tr>
      `).join('') || '<tr><td colspan="4" style="text-align:center;padding:12px;color:var(--text-3);font-size:12px">입금 내역 없음</td></tr>';

      Modal.open({
        title: `📋 수금 상세 — ${s.customer_name || ''}`,
        size: 'md',
        body: `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
            <div style="background:#F9FAFB;border-radius:6px;padding:10px">
              <div style="font-size:11px;color:var(--text-3)">수금 단계</div>
              <div style="font-weight:600">${this._esc(s.stage_name)}</div>
            </div>
            <div style="background:#F9FAFB;border-radius:6px;padding:10px">
              <div style="font-size:11px;color:var(--text-3)">수금 예정일</div>
              <div style="font-weight:600">${s.due_date}</div>
            </div>
            <div style="background:#F9FAFB;border-radius:6px;padding:10px">
              <div style="font-size:11px;color:var(--text-3)">수금 예정액</div>
              <div style="font-weight:600;color:#1664E5">₩${fmt(s.scheduled_amount)}</div>
            </div>
            <div style="background:#F9FAFB;border-radius:6px;padding:10px">
              <div style="font-size:11px;color:var(--text-3)">실제 수금액</div>
              <div style="font-weight:600;color:#0F7A3F">₩${fmt(s.paid_amount)}</div>
            </div>
          </div>
          <div style="font-weight:600;font-size:13px;margin-bottom:8px">입금 이력</div>
          <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border);border-radius:6px;overflow:hidden">
            <thead>
              <tr style="background:#F9FAFB;font-size:11px;color:var(--text-3)">
                <th style="padding:6px 8px;text-align:left">입금일</th>
                <th style="padding:6px 8px;text-align:left">금액</th>
                <th style="padding:6px 8px;text-align:left">방법</th>
                <th style="padding:6px 8px;text-align:left">참조번호</th>
              </tr>
            </thead>
            <tbody>${recRows}</tbody>
          </table>
        `,
        footer: `
          <button class="btn btn-secondary" onclick="Modal.close()">닫기</button>
          <button class="btn btn-primary" id="sd-add-record">💳 입금등록</button>
        `,
        onOpen: () => {
          document.getElementById('sd-add-record')?.addEventListener('click', () => {
            Modal.close();
            this._openRecordModal(scheduleId);
          });
        },
      });
    } catch (err) {
      Toast.error?.('조회 실패: ' + (err?.message || err));
    }
  },

  // ── 필터+정렬 적용 목록 ─────────────────────────────────────
  _filteredAndSorted() {
    const { key, dir } = this._sort;
    const kw = (this._filter.search || '').toLowerCase();
    const list = kw
      ? this._schedules.filter(s =>
          (s.customer_name  || '').toLowerCase().includes(kw) ||
          (s.contract_name  || '').toLowerCase().includes(kw) ||
          (s.stage_name     || '').toLowerCase().includes(kw)
        )
      : this._schedules;

    return [...list].sort((a, b) => {
      let va = a[key], vb = b[key];
      if (key === 'scheduled_amount' || key === 'paid_amount') {
        va = Number(va || 0); vb = Number(vb || 0);
      } else {
        va = String(va || ''); vb = String(vb || '');
      }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return dir === 'asc' ? cmp : -cmp;
    });
  },

  // ── 정렬 키 토글 ─────────────────────────────────────────────
  _setSortKey(key) {
    if (this._sort.key === key) {
      this._sort.dir = this._sort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      this._sort.key = key;
      this._sort.dir = 'asc';
    }
    this._renderTab();
  },

  // ── 서버 재조회 후 탭 재렌더 ─────────────────────────────────
  async _reloadAndRender() {
    await Promise.all([this._loadSchedules(), this._loadDashboard()]);
    this._renderTab();
  },

  // ── 스케줄 삭제 ─────────────────────────────────────────────
  async _deleteSchedule(id) {
    const s    = this._schedules.find(x => x.id === id);
    const name = s ? `${s.customer_name || ''} · ${s.stage_name || ''}` : `#${id}`;
    if (!confirm(`수금 스케줄을 삭제하시겠습니까?\n${name}\n\n⚠️ 입금 이력도 함께 삭제됩니다`)) return;
    try {
      await API.del(`/payments/${id}`);
      Toast.success?.('삭제됐습니다');
      await this._reloadAndRender();
    } catch (err) {
      Toast.error?.('삭제 실패: ' + (err?.message || err));
    }
  },

  // ── 유틸 ─────────────────────────────────────────────────────
  _esc(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  _dDay(dueDateStr) {
    if (!dueDateStr) return { label: '', color: 'var(--text-3)' };
    const diff = Math.ceil((new Date(dueDateStr) - new Date()) / 86400000);
    if (diff < 0) return { label: `D+${Math.abs(diff)}`, color: '#E63329' };
    if (diff === 0) return { label: 'D-Day', color: '#E63329' };
    if (diff <= 7) return { label: `D-${diff}`, color: '#F59C00' };
    return { label: `D-${diff}`, color: 'var(--text-3)' };
  },
};
