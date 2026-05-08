// ============================================================
// App - 메인 라우터 / 공유 컴포넌트
// ============================================================
const App = {
  currentPage: 'dashboard',
  team: [],
  customers: [],

  // 페이지 매핑
  pages: {
    dashboard: { obj: () => DashboardPage,  title: '대시보드',       crumb: '홈 / 대시보드' },
    pipeline:  { obj: () => PipelinePage,   title: '파이프라인',     crumb: '영업관리 / 파이프라인' },
    leads:     { obj: () => LeadsPage,      title: '영업 리드',       crumb: '영업관리 / 리드' },
    projects:  { obj: () => ProjectsPage,   title: '프로젝트',       crumb: '영업관리 / 프로젝트' },
    customers: { obj: () => CustomersPage,  title: '고객사',         crumb: '영업관리 / 고객사' },
    calendar:  { obj: () => CalendarPage,   title: '영업 캘린더',    crumb: '영업관리 / 캘린더' },
    team:      { obj: () => TeamPage,       title: '팀 현황',        crumb: '분석 / 팀' },
    reports:   { obj: () => ReportsPage,    title: '리포트',         crumb: '분석 / 리포트' },
    board:     { obj: () => BoardPage,      title: '커뮤니케이션',   crumb: '소통 / 게시판' },
    meeting:       { obj: () => MeetingPage,        title: '회의록 AI',      crumb: 'AI 기능 / 회의록' },
    'meeting-list':{ obj: () => MeetingListPage,    title: '회의록 목록',    crumb: 'AI 기능 / 회의록 목록' },
    admin:     { obj: () => AdminPage,      title: '관리자',         crumb: '시스템 / 관리자' },
    settings:  { obj: () => SettingsPage,   title: '설정',           crumb: '시스템 / 설정' }
  },

  async init() {
    // 사이드바 네비
    document.querySelectorAll('.nav-item[data-page]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        this.navigate(el.dataset.page);
      });
    });

    // 상단 + 리드 등록 버튼
    document.getElementById('btn-new-lead').onclick = () => this.openLeadForm();

    // 상단 날짜
    this.updateTopbarDate();

    // 공통 데이터 로드 (담당자/고객사 캐시)
    await this.refreshCommon();

    // 사이드바 카운트 배지
    this.updateNavBadges();

    // 알림 로드
    Notifications.load();
    setInterval(() => Notifications.load(), 5 * 60 * 1000);

    // 알림 패널 외부 클릭 닫기
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.notif-wrap')) {
        document.getElementById('notif-panel')?.classList.remove('show');
      }
    });

    // 첫 페이지 로드
    await this.navigate('dashboard');
  },

  async refreshCommon() {
    try {
      const [teamRes, custRes] = await Promise.all([
        API.team.list(),
        API.customers.list()
      ]);
      this.team = teamRes.data;
      this.customers = custRes.data;
    } catch (err) { console.warn('common data load failed:', err); }
  },

  async updateNavBadges() {
    try {
      const result = await API.leads.list();
      const active = result.data.filter(l =>
        !['won', 'lost', 'dropped'].includes(l.stage)
      ).length;
      const total = result.data.length;
      const elPipe = document.getElementById('nav-pipeline-count');
      const elLeads = document.getElementById('nav-leads-count');
      if (elPipe) elPipe.textContent = active;
      if (elLeads) elLeads.textContent = total;
    } catch (err) { /* silent */ }
  },

  updateTopbarDate() {
    const el = document.getElementById('topbar-date');
    if (!el) return;
    const d = new Date();
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    el.textContent = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} (${days[d.getDay()]})`;
  },

  async navigate(pageId) {
    const page = this.pages[pageId];
    if (!page) {
      Toast.error('알 수 없는 페이지: ' + pageId);
      return;
    }

    this.currentPage = pageId;

    // 사이드바 active 토글
    document.querySelectorAll('.nav-item[data-page]').forEach(el => {
      el.classList.toggle('active', el.dataset.page === pageId);
    });

    // 상단 타이틀/breadcrumb
    document.getElementById('page-title').textContent = page.title;
    document.getElementById('page-breadcrumb').textContent = page.crumb;

    // 컨텐츠 로딩
    document.getElementById('content').innerHTML = '<div class="loading">데이터 로딩중...</div>';

    try {
      await page.obj().render();
    } catch (err) {
      console.error('페이지 렌더링 실패:', err);
      document.getElementById('content').innerHTML = `
        <div class="card"><div class="card-body">
          <div class="empty">
            <div class="empty-icon">⚠</div>
            페이지 로드중 오류가 발생했습니다.<br>
            <span class="text-muted fs-12 mono">${esc(err.message)}</span>
          </div>
        </div></div>
      `;
    }

    // 네비 카운트 갱신
    this.updateNavBadges();
  },

  // ============================================================
  // 리드 등록 / 편집 모달 (LeadsPage / PipelinePage 공유)
  // ============================================================
  async openLeadForm(id = null) {
    let lead = null;
    if (id) {
      try {
        const result = await API.leads.get(id);
        lead = result.data;
      } catch (err) { return; }
    }

    if (!this.team.length) await this.refreshCommon();

    const teamOpts = this.team.map(t =>
      `<option value="${t.id}" ${lead?.assigned_to === t.id ? 'selected' : ''}>${esc(t.name)} (${esc(t.role)})</option>`
    ).join('');

    Modal.open({
      title: lead ? '리드 정보 수정' : '신규 리드 등록',
      width: 640,
      body: `
        <form id="lead-form" class="form-grid">
          <div class="form-row-2">
            <div class="form-row">
              <label class="form-label">고객사 *</label>
              <input class="form-input" name="customer_name" value="${esc(lead?.customer_name || '')}" required list="customer-list">
              <datalist id="customer-list">
                ${this.customers.map(c => `<option value="${esc(c.name)}">`).join('')}
              </datalist>
            </div>
            <div class="form-row">
              <label class="form-label">프로젝트명 *</label>
              <input class="form-input" name="project_name" value="${esc(lead?.project_name || '')}" required>
            </div>
          </div>

          <div class="form-row-3">
            <div class="form-row">
              <label class="form-label">사업 유형</label>
              <select class="form-input" name="business_type">
                <option value="태양광" ${lead?.business_type === '태양광' ? 'selected' : ''}>태양광</option>
                <option value="모듈"   ${lead?.business_type === '모듈' ? 'selected' : ''}>모듈</option>
                <option value="EPC"    ${lead?.business_type === 'EPC' ? 'selected' : ''}>EPC</option>
                <option value="ESS"    ${lead?.business_type === 'ESS' ? 'selected' : ''}>ESS</option>
                <option value="전기"   ${lead?.business_type === '전기' ? 'selected' : ''}>전기</option>
                <option value="설치"   ${lead?.business_type === '설치' ? 'selected' : ''}>설치</option>
              </select>
            </div>
            <div class="form-row">
              <label class="form-label">국내/해외</label>
              <select class="form-input" name="region">
                <option value="국내" ${lead?.region === '국내' ? 'selected' : ''}>국내</option>
                <option value="해외" ${lead?.region === '해외' ? 'selected' : ''}>해외</option>
              </select>
            </div>
            <div class="form-row">
              <label class="form-label">단계</label>
              <select class="form-input" name="stage">
                ${Object.keys(STAGES).map(s =>
                  `<option value="${s}" ${(lead?.stage || 'lead') === s ? 'selected' : ''}>${STAGES[s].label}</option>`
                ).join('')}
              </select>
            </div>
          </div>

          <div class="form-row-3">
            <div class="form-row">
              <label class="form-label">규모 (MW)</label>
              <input type="number" step="0.01" class="form-input" name="capacity_mw" value="${lead?.capacity_mw || ''}">
            </div>
            <div class="form-row">
              <label class="form-label">예상 금액</label>
              <input type="number" step="0.01" class="form-input" name="expected_amount" value="${lead?.expected_amount || ''}" placeholder="단위: 억">
            </div>
            <div class="form-row">
              <label class="form-label">통화</label>
              <select class="form-input" name="currency">
                <option value="KRW" ${(lead?.currency || 'KRW') === 'KRW' ? 'selected' : ''}>KRW (₩)</option>
                <option value="USD" ${lead?.currency === 'USD' ? 'selected' : ''}>USD ($)</option>
                <option value="JPY" ${lead?.currency === 'JPY' ? 'selected' : ''}>JPY (¥)</option>
                <option value="EUR" ${lead?.currency === 'EUR' ? 'selected' : ''}>EUR (€)</option>
                <option value="AUD" ${lead?.currency === 'AUD' ? 'selected' : ''}>AUD (A$)</option>
                <option value="CNY" ${lead?.currency === 'CNY' ? 'selected' : ''}>CNY (¥)</option>
                <option value="VND" ${lead?.currency === 'VND' ? 'selected' : ''}>VND (₫)</option>
              </select>
            </div>
          </div>

          <div class="form-row-3">
            <div class="form-row">
              <label class="form-label">담당자</label>
              <select class="form-input" name="assigned_to">
                <option value="">- 미배정 -</option>
                ${teamOpts}
              </select>
            </div>
            <div class="form-row">
              <label class="form-label">예상 마감일</label>
              <input type="date" class="form-input" name="expected_close_date" value="${lead?.expected_close_date ? Fmt.date(lead.expected_close_date) : ''}">
            </div>
            <div class="form-row">
              <label class="form-label">입찰 마감일</label>
              <input type="date" class="form-input" name="bidding_deadline" value="${lead?.bidding_deadline ? Fmt.date(lead.bidding_deadline) : ''}">
            </div>
          </div>

          <div class="form-row">
            <label class="form-label">메모</label>
            <textarea class="form-input" name="notes" rows="3">${esc(lead?.notes || '')}</textarea>
          </div>
        </form>
      `,
      footer: `
        ${lead ? `<button class="btn btn-ghost text-danger" onclick="App.deleteLead(${lead.id})">삭제</button>` : ''}
        <button class="btn btn-ghost" onclick="Modal.close()">취소</button>
        <button class="btn btn-primary" onclick="App.saveLead(${lead?.id || 'null'})">${lead ? '저장' : '등록'}</button>
      `
    });
  },

  async saveLead(id) {
    const form = document.getElementById('lead-form');
    const fd = new FormData(form);
    const body = {};
    fd.forEach((v, k) => {
      if (v === '') body[k] = null;
      else if (['capacity_mw', 'expected_amount', 'assigned_to'].includes(k)) {
        body[k] = v ? parseFloat(v) : null;
      } else {
        body[k] = v;
      }
    });

    if (!body.customer_name || !body.project_name) {
      return Toast.error('고객사와 프로젝트명은 필수입니다');
    }

    try {
      if (id) {
        await API.leads.update(id, body);
        Toast.success('리드 정보가 수정되었습니다');
      } else {
        await API.leads.create(body);
        Toast.success('신규 리드가 등록되었습니다');
      }
      Modal.close();
      // 현재 페이지 새로고침
      const cur = this.pages[this.currentPage]?.obj();
      if (cur && cur.loadData) cur.loadData();
      this.updateNavBadges();
    } catch (err) { console.error(err); }
  },

  async deleteLead(id) {
    Modal.close();
    Modal.confirm('이 리드를 삭제하시겠습니까? 활동 이력도 함께 삭제됩니다.', async () => {
      try {
        await API.leads.delete(id);
        Toast.success('리드가 삭제되었습니다');
        const cur = this.pages[this.currentPage]?.obj();
        if (cur && cur.loadData) cur.loadData();
        this.updateNavBadges();
      } catch (err) { console.error(err); }
    });
  },

  // ============================================================
  // 리드 상세 모달 (활동이력 포함)
  // ============================================================
  async openLeadDetail(id) {
    try {
      const result = await API.leads.get(id);
      const l = result.data;
      const stage = STAGES[l.stage] || STAGES.lead;
      const days = Fmt.daysLeft(l.expected_close_date);
      const daysBadge = days == null ? '' :
        days < 0 ? `<span class="badge badge-red">${Math.abs(days)}일 경과</span>` :
        days <= 7 ? `<span class="badge badge-amber">D-${days}</span>` :
        `<span class="badge badge-gray">D-${days}</span>`;

      Modal.open({
        title: `${esc(l.customer_name)} · ${esc(l.project_name)}`,
        width: 720,
        body: `
          <div class="detail-header">
            <div class="detail-stage">
              <span class="badge" style="background:${stage.color};color:#fff">${stage.label}</span>
              <span class="badge ${l.region === '해외' ? 'badge-purple' : 'badge-blue'}">${esc(l.region)}</span>
              <span class="badge ${BUSINESS_COLORS[l.business_type] || 'badge-gray'}">${esc(l.business_type)}</span>
              ${daysBadge}
            </div>
            <div class="detail-amount">
              <div class="text-muted fs-12">예상 금액</div>
              <div class="amount-big">${Fmt.amount(l.expected_amount, l.currency)}</div>
            </div>
          </div>

          <div class="kv-grid mb-3">
            <div class="kv-row"><span class="kv-key">담당자</span><span class="kv-val">${esc(l.assigned_name || '미배정')}</span></div>
            <div class="kv-row"><span class="kv-key">규모</span><span class="kv-val mono">${l.capacity_mw ? parseFloat(l.capacity_mw).toFixed(1) + ' MW' : '-'}</span></div>
            <div class="kv-row"><span class="kv-key">예상 마감일</span><span class="kv-val">${Fmt.date(l.expected_close_date)}</span></div>
            <div class="kv-row"><span class="kv-key">입찰 마감일</span><span class="kv-val">${Fmt.date(l.bidding_deadline)}</span></div>
            <div class="kv-row"><span class="kv-key">최초 등록</span><span class="kv-val">${Fmt.date(l.created_at)}</span></div>
            <div class="kv-row"><span class="kv-key">최근 업데이트</span><span class="kv-val">${Fmt.relTime(l.updated_at)}</span></div>
          </div>

          ${l.notes ? `
            <div class="card mb-3">
              <div class="card-header"><div class="card-title">메모</div></div>
              <div class="card-body" style="white-space:pre-line;font-size:13px;line-height:1.6">${esc(l.notes)}</div>
            </div>
          ` : ''}

          <div class="card mb-3">
            <div class="card-header">
              <div class="card-title">활동 이력 (${l.activities?.length || 0}건)</div>
              <button class="btn btn-ghost btn-sm" onclick="App.openActivityForm(${l.id})">+ 활동 추가</button>
            </div>
            <div class="card-body no-pad">
              ${(l.activities && l.activities.length) ? `
                <div class="activity-list">
                  ${l.activities.map(a => `
                    <div class="activity-item">
                      <div class="activity-icon">${this.activityIcon(a.activity_type)}</div>
                      <div class="activity-body">
                        <div class="activity-title">${esc(a.title)}</div>
                        ${a.content ? `<div class="activity-content">${esc(a.content)}</div>` : ''}
                        <div class="activity-meta">${esc(a.performer_name || '시스템')} · ${Fmt.relTime(a.created_at)}</div>
                      </div>
                    </div>
                  `).join('')}
                </div>
              ` : '<div class="empty"><div class="empty-icon">📝</div>활동 이력이 없습니다</div>'}
            </div>
          </div>
        `,
        footer: `
          <button class="ai-gen-btn" onclick="Modal.close();AI.summarizeLead(${l.id},'${esc(l.project_name).replace(/'/g,"\\'")}')">🤖 AI 요약</button>
          <button class="btn btn-ghost" onclick="Modal.close()">닫기</button>
          <button class="btn btn-primary" onclick="Modal.close();App.openLeadForm(${l.id})">편집</button>
        `
      });
    } catch (err) { console.error(err); }
  },

  activityIcon(type) {
    const map = {
      stage_change: '🔄',
      meeting: '🤝',
      call: '📞',
      email: '✉',
      site_visit: '🏗',
      proposal: '📄',
      bidding: '📋',
      contract: '✍',
      note: '📝'
    };
    return map[type] || '●';
  },

  openActivityForm(leadId) {
    Modal.close();
    setTimeout(() => {
      Modal.open({
        title: '활동 추가',
        width: 480,
        body: `
          <form id="activity-form" class="form-grid">
            <input type="hidden" name="lead_id" value="${leadId}">
            <div class="form-row">
              <label class="form-label">활동 유형</label>
              <select class="form-input" name="activity_type">
                <option value="meeting">미팅</option>
                <option value="call">전화</option>
                <option value="email">이메일</option>
                <option value="site_visit">현장방문</option>
                <option value="proposal">제안</option>
                <option value="note">메모</option>
              </select>
            </div>
            <div class="form-row">
              <label class="form-label">제목 *</label>
              <input class="form-input" name="title" required>
            </div>
            <div class="form-row">
              <label class="form-label">내용</label>
              <textarea class="form-input" name="content" rows="4"></textarea>
            </div>
            <div class="form-row">
              <label class="form-label">담당자</label>
              <select class="form-input" name="performed_by">
                <option value="">-</option>
                ${this.team.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}
              </select>
            </div>
          </form>
        `,
        footer: `
          <button class="btn btn-ghost" onclick="Modal.close()">취소</button>
          <button class="btn btn-primary" onclick="App.saveActivity(${leadId})">등록</button>
        `
      });
    }, 100);
  },

  async saveActivity(leadId) {
    const form = document.getElementById('activity-form');
    const fd = new FormData(form);
    const body = {};
    fd.forEach((v, k) => body[k] = v || null);
    body.lead_id = leadId;
    if (!body.title) return Toast.error('제목을 입력하세요');

    try {
      await API.activities.create(body);
      Toast.success('활동이 추가되었습니다');
      Modal.close();
      // 상세 모달 다시 열기
      setTimeout(() => this.openLeadDetail(leadId), 150);
    } catch (err) { console.error(err); }
  }
};

// ============================================================
// 실시간 알림 (WebSocket)
// ============================================================
const WS = {
  socket: null,
  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.socket = new WebSocket(`${proto}://${location.host}`);
    this.socket.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'notification') {
          Toast.info(msg.text || '새 알림이 있습니다');
          Notifications.load();
        }
        if (msg.type === 'announcement') {
          Toast.info(`📢 공지: ${msg.title}`);
          Notifications.load();
        }
      } catch (_) {}
    };
    this.socket.onclose = () => setTimeout(() => this.connect(), 5000);
  }
};

// ============================================================
// 부팅
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  App.init();
  WS.connect();
  UserPrefs.init();
});
