// ============================================================
// App - 메인 라우터 / 공유 컴포넌트
// ============================================================
const App = {
  currentPage: 'dashboard',
  team: [],
  customers: [],
  currentUser: null,

  // 페이지 매핑
  pages: {
    dashboard: { obj: () => DashboardPage,  title: '대시보드',       crumb: '홈 / 대시보드' },
    orders:    { obj: () => OrdersPage,     title: '주문관리 (OMS)', crumb: 'OMS / 주문관리' },
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
    admin:         { obj: () => AdminPage,             title: '관리자',         crumb: '시스템 / 관리자' },
    settings:      { obj: () => SettingsPage,          title: '설정',           crumb: '시스템 / 설정' },
    notifications: { obj: () => NotificationsListPage, title: '알림 전체 목록', crumb: '알림 / 전체 목록' },
    dev:           { obj: () => DevPage,               title: '개발자 옵션',    crumb: '시스템 / 개발자 옵션' }
  },

  async init() {
    // ── 인증 확인 ──────────────────────────────────────────
    await this.checkAuth();

    // ── 기능 플래그 로드 (RBAC 적용 후 실행해야 nav 요소가 확정된 상태) ──
    await Features.load();
    Features.apply();

    // ── 전역 이벤트 위임 (CSP: 인라인 onclick 제거) ─────────
    this._initEventDelegation();

    // 상단 날짜
    this.updateTopbarDate();

    // 모바일 UI 초기화 (햄버거 버튼)
    this.initMobileUI();

    // 공통 데이터 로드 (담당자/고객사 캐시)
    await this.refreshCommon();

    // 사이드바 카운트 배지
    this.updateNavBadges();

    // 사이드바 메뉴 구조 동적 적용 (관리자 설정 반영)
    // — 비동기, 실패 시 하드코딩 폴백으로 안전하게 유지
    this.applyMenuConfig();

    // 알림 로드
    Notifications.load();
    setInterval(() => Notifications.load(), 5 * 60 * 1000);

    // 알림 패널 외부 클릭 닫기
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.notif-wrap')) {
        document.getElementById('notif-panel')?.classList.remove('show');
      }
    });

    // 첫 페이지 로드 — F5 새로고침 시 마지막 페이지로 복귀
    // 우선순위: URL hash > localStorage > dashboard(기본)
    let startPage = 'dashboard';
    const hashPage = location.hash.replace(/^#/, '').trim();
    if (hashPage && this.pages[hashPage]) {
      startPage = hashPage;
    } else {
      try {
        const lastPage = localStorage.getItem('oci_lastPage');
        if (lastPage && this.pages[lastPage]) startPage = lastPage;
      } catch (_) {}
    }
    await this.navigate(startPage);

    // 첫 로그인이면 온보딩 환영 모달 자동 표시 (1초 지연 — 페이지 로딩 안정)
    setTimeout(() => {
      if (typeof Onboarding !== 'undefined') Onboarding.maybeShow();
    }, 1000);

    // 브라우저 뒤로/앞으로 버튼 지원
    window.addEventListener('hashchange', () => {
      const p = location.hash.replace(/^#/, '').trim();
      if (p && this.pages[p] && p !== this.currentPage) this.navigate(p);
    });
  },

  // ── 이벤트 위임 핸들러 (인라인 onclick 대체) ──────────────
  _initEventDelegation() {
    // 1) 네비게이션 (data-action="navigate" + data-page="...")
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const action = el.dataset.action;

      if (action === 'navigate') {
        e.preventDefault();
        const page = el.dataset.page;
        if (page) this.navigate(page);
      } else if (action === 'ai-open') {
        e.preventDefault();
        if (typeof AI !== 'undefined') AI.open();
      } else if (action === 'ai-close') {
        e.preventDefault();
        if (typeof AI !== 'undefined') AI.close();
      } else if (action === 'close-nav') {
        this.closeMobileNav();
      } else if (action === 'toggle-nav') {
        this.toggleMobileNav();
      } else if (action === 'open-search') {
        e.preventDefault();
        if (typeof SearchModal !== 'undefined') SearchModal.show();
      }
    });

    // 2) 알림 버튼
    document.getElementById('notif-btn')?.addEventListener('click', () => {
      if (typeof Notifications !== 'undefined') Notifications.showPanel();
    });

    // 3) 알림 전체보기 버튼
    document.getElementById('notif-all-btn')?.addEventListener('click', () => {
      if (typeof Notifications !== 'undefined') Notifications.showPanel();
      this.navigate('notifications');
    });

    // 4) AI 어시스턴트 토글
    document.getElementById('btn-ai-toggle')?.addEventListener('click', () => {
      if (typeof AI !== 'undefined') AI.toggle();
    });

    // 5) AI 패널 버튼들
    document.getElementById('ai-btn-copy')?.addEventListener('click', () => {
      if (typeof AI !== 'undefined') AI.copyLastMessage();
    });
    document.getElementById('ai-btn-clear')?.addEventListener('click', () => {
      if (typeof AI !== 'undefined') AI.clearChat();
    });
    document.getElementById('ai-btn-close')?.addEventListener('click', () => {
      if (typeof AI !== 'undefined') AI.close();
    });
    document.getElementById('ai-send-btn')?.addEventListener('click', () => {
      if (typeof AI !== 'undefined') AI.send();
    });

    // 6) AI 퀵 액션 버튼 (data-ai-report, data-ai-prompt)
    document.getElementById('ai-quick-actions')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.ai-quick-btn');
      if (!btn || typeof AI === 'undefined') return;
      if (btn.dataset.aiReport) {
        AI.streamReport(btn.dataset.aiReport);
      } else if (btn.dataset.aiPrompt) {
        const input = document.getElementById('ai-input');
        if (input) input.value = btn.dataset.aiPrompt;
        AI.send();
      }
    });

    // 7) AI 입력창 키 이벤트 (Enter: 전송, Shift+Enter: 줄바꿈)
    const aiInput = document.getElementById('ai-input');
    if (aiInput) {
      aiInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (typeof AI !== 'undefined') AI.send();
        }
      });
      aiInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
      });
    }
  },

  // ── 인증 + RBAC ───────────────────────────────────────────
  async checkAuth() {
    const token = localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token');
    if (!token) { window.location.href = '/login'; return; }

    try {
      const res  = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!data.success) { this.logout(); return; }

      this.currentUser = data.data;
      localStorage.setItem('current_user_id', data.data.id);
      this.applyRbacToNav(data.data);
      this.renderUserBadge(data.data);
    } catch (_) {
      this.logout();
    }
  },

  async logout() {
    try {
      const token = localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token');
      if (token) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'include',   // Refresh Token 쿠키 전송 → 서버에서 쿠키 삭제
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
      }
    } catch (_) { /* 서버 오류여도 클라이언트 정리는 반드시 진행 */ }
    localStorage.removeItem('oci_token');
    sessionStorage.removeItem('oci_token');
    localStorage.removeItem('oci_user');
    localStorage.removeItem('current_user_id');
    // 세션 종료 시 마지막 페이지 기록도 정리 — 다음 로그인 시 대시보드로 진입하도록
    localStorage.removeItem('oci_lastPage');
    window.location.href = '/login';
  },

  applyRbacToNav(user) {
    const pages   = user.pages || [];
    const allAccess = pages.includes('*');
    document.querySelectorAll('.nav-item[data-page]').forEach(el => {
      const page = el.dataset.page;
      // 개발자 옵션: superadmin 전용
      if (page === 'dev') {
        el.style.display = user.role === 'superadmin' ? '' : 'none';
        return;
      }
      if (!allAccess && !pages.includes(page)) {
        el.style.display = 'none';
      }
    });
  },

  renderUserBadge(user) {
    const el = document.getElementById('user-badge');
    if (!el) return;
    const roleLabels = { manager:'매니저', team_lead:'팀장', executive:'경영진', admin:'IT운영관리자', superadmin:'시스템담당자' };
    el.innerHTML = `
      <div class="ubadge">
        <div class="ubadge-info">
          <span class="ubadge-name">${esc(user.full_name || user.username)}</span>
          <span class="ubadge-role">${roleLabels[user.role] || user.role}</span>
        </div>
        <button class="btn-logout" id="btn-logout-ubadge" title="로그아웃">
          <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clip-rule="evenodd"/></svg>
          로그아웃
        </button>
      </div>
    `;
    const logoutBtn = document.getElementById('btn-logout-ubadge');
    if (logoutBtn) logoutBtn.addEventListener('click', () => App.logout());
  },

  async refreshCommon() {
    try {
      const [teamRes, custRes] = await Promise.all([
        API.team.list(),
        API.customers.list(),
        loadStages(),  // 파이프라인 단계 정의 동적 로드 (실패해도 fallback)
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
    } catch (_) { /* nav badge update is non-critical */ }
  },

  // ─────────────────────────────────────────────────────────────
  // applyMenuConfig — DB의 메뉴 설정(/api/menu/sidebar)으로 사이드바 재구성
  //   1) 라벨 오버라이드 적용
  //   2) 섹션 내부 항목 순서 재배치 + 섹션 간 이동 반영
  //   3) 섹션 자체 순서 재배치
  //   4) is_visible=0 항목/섹션 숨김
  // 실패 시 하드코딩 사이드바 그대로 유지 (안전 폴백)
  // ─────────────────────────────────────────────────────────────
  async applyMenuConfig() {
    try {
      const r = await API.request('GET', '/menu/sidebar');
      const data = r?.data || {};
      const sections = Array.isArray(data.sections) ? data.sections : [];
      const items    = Array.isArray(data.items)    ? data.items    : [];
      if (!sections.length) return;  // 데이터 없으면 폴백 유지

      const navEl = document.querySelector('.sidebar-nav');
      if (!navEl) return;

      // 현재 DOM 의 섹션/항목을 key 로 매핑
      const sectionEls = {};
      document.querySelectorAll('.sidebar-nav .nav-section[data-section-key]').forEach(el => {
        sectionEls[el.dataset.sectionKey] = el;
      });
      const itemEls = {};
      document.querySelectorAll('.sidebar-nav .nav-item[data-menu-key]').forEach(el => {
        itemEls[el.dataset.menuKey] = el;
      });

      // 1) 항목별: 라벨 오버라이드 + 섹션별로 그룹화
      const itemsBySection = {};
      items.forEach(it => {
        const el = itemEls[it.menu_key];
        if (!el) return;
        // 라벨 오버라이드: 첫 번째 .nav-badge 가 아닌 span 교체
        if (it.label_override) {
          const span = [...el.children].find(c => c.tagName === 'SPAN' && !c.classList.contains('nav-badge'));
          if (span) span.textContent = it.label_override;
        }
        if (!itemsBySection[it.section_key]) itemsBySection[it.section_key] = [];
        itemsBySection[it.section_key].push(it.menu_key);
      });

      // 2) 각 섹션 내부에 항목을 순서대로 append (cross-section 이동도 자동 처리)
      sections.forEach(s => {
        const secEl = sectionEls[s.section_key];
        if (!secEl) return;
        const keys = itemsBySection[s.section_key] || [];
        keys.forEach(k => {
          const itemEl = itemEls[k];
          if (itemEl) secEl.appendChild(itemEl);  // 이미 다른 섹션에 있어도 옮김
        });
      });

      // 3) 섹션 자체 순서 적용 (display_order ASC)
      [...sections]
        .sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
        .forEach(s => {
          const secEl = sectionEls[s.section_key];
          if (secEl) navEl.appendChild(secEl);
        });

      // 4) 응답에 없는 항목은 숨김 (서버가 is_visible=1 만 보냄)
      const visibleItemKeys = new Set(items.map(it => it.menu_key));
      Object.keys(itemEls).forEach(k => {
        const el = itemEls[k];
        // 개발자 옵션은 별도 RBAC 토글로 처리됨 (style.display 보존)
        if (k === 'dev') return;
        if (!visibleItemKeys.has(k)) {
          el.style.display = 'none';
        } else if (el.style.display === 'none') {
          el.style.display = '';
        }
      });

      // 5) 응답에 없거나 비어있는 섹션 숨김
      const visibleSectionKeys = new Set(sections.map(s => s.section_key));
      const sectionHasItems = {};
      items.forEach(it => { sectionHasItems[it.section_key] = true; });
      Object.keys(sectionEls).forEach(k => {
        const el = sectionEls[k];
        const empty = !sectionHasItems[k];
        if (!visibleSectionKeys.has(k) || empty) {
          el.style.display = 'none';
        } else if (el.style.display === 'none') {
          el.style.display = '';
        }
      });
    } catch (_) {
      // API 실패 시 하드코딩 사이드바 그대로 유지 (안전 폴백)
    }
  },

  updateTopbarDate() {
    const el = document.getElementById('topbar-date');
    if (!el) return;
    const d = new Date();
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    el.textContent = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} (${days[d.getDay()]})`;
  },

  // ── 모바일 햄버거 네비게이션 ─────────────────────────────
  toggleMobileNav() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const isOpen  = sidebar.classList.contains('mobile-open');
    if (isOpen) { this.closeMobileNav(); }
    else {
      sidebar.classList.add('mobile-open');
      overlay.classList.add('active');
    }
  },
  closeMobileNav() {
    document.querySelector('.sidebar')?.classList.remove('mobile-open');
    document.getElementById('sidebar-overlay')?.classList.remove('active');
  },

  // 모바일 여부 판단 + 햄버거 버튼 표시
  initMobileUI() {
    const check = () => {
      const isMobile = window.innerWidth <= 768;
      const btn = document.getElementById('mobile-menu-btn');
      if (btn) btn.style.display = isMobile ? 'flex' : 'none';
    };
    check();
    window.addEventListener('resize', check);
  },

  async navigate(pageId) {
    const page = this.pages[pageId];
    if (!page) {
      Toast.error('알 수 없는 페이지: ' + pageId);
      return;
    }

    // 모바일에서 페이지 이동 시 사이드바 자동 닫기
    this.closeMobileNav();

    this.currentPage = pageId;

    // ⚠️ F5 새로고침 후 같은 페이지로 복귀 — 마지막 페이지 저장
    try { localStorage.setItem('oci_lastPage', pageId); } catch (_) {}
    // URL hash 동기화 (브라우저 뒤로가기 호환)
    if (location.hash.replace(/^#/, '') !== pageId) {
      history.replaceState(null, '', '#' + pageId);
    }

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
      // CSS injection 방식이므로 별도 apply() 불필요 — 렌더된 요소에 CSS 즉시 적용됨
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

    // 필터바 sticky 감지 초기화
    if (typeof initStickyFilterBar === 'function') initStickyFilterBar();

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
      } catch (_) { return; }
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
              <input type="number" step="0.01" class="form-input" name="expected_amount" value="${lead?.expected_amount || ''}" placeholder="단위: 원 (예: 366억원 → 36600000000)">
            </div>
            <div class="form-row">
              <label class="form-label">통화</label>
              <select class="form-input" name="currency" id="lf-currency">
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
          <!-- KRW 환산 미리보기 -->
          <div id="lf-krw-preview" class="lf-krw-preview" style="display:none">
            <span class="lf-krw-label">📊 원화 환산</span>
            <span id="lf-krw-value" class="lf-krw-value">—</span>
            <span id="lf-krw-rate" class="lf-krw-rate"></span>
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
        ${lead ? `<button class="btn btn-ghost text-danger" id="lf-delete">삭제</button>` : ''}
        <button class="btn btn-ghost" id="lf-cancel">취소</button>
        <button class="btn btn-primary" id="lf-save">${lead ? '저장' : '등록'}</button>
      `,
      bind: Object.assign(
        { '#lf-cancel': () => Modal.close(),
          '#lf-save':   () => App.saveLead(lead?.id || null) },
        lead ? { '#lf-delete': () => App.deleteLead(lead.id) } : {}
      ),
      onOpen: () => {
        // 통화/금액 변경 시 KRW 환산 실시간 미리보기
        const amtEl = document.querySelector('#lead-form [name="expected_amount"]');
        const curEl = document.getElementById('lf-currency');
        const prevWrap = document.getElementById('lf-krw-preview');
        const prevVal  = document.getElementById('lf-krw-value');
        const prevRate = document.getElementById('lf-krw-rate');

        const updatePreview = async () => {
          const amt = parseFloat(amtEl?.value);
          const cur = curEl?.value || 'KRW';
          if (!Number.isFinite(amt) || amt <= 0) {
            prevWrap.style.display = 'none';
            return;
          }
          if (cur === 'KRW') {
            prevWrap.style.display = 'flex';
            // KRW expected_amount는 "억 단위" 정책 — 그대로 표시
            prevVal.textContent  = Fmt.amount(amt, 'KRW');
            prevRate.textContent = '(원화 입력)';
            return;
          }
          prevWrap.style.display = 'flex';
          prevVal.textContent  = '환산 중...';
          prevRate.textContent = '';
          try {
            const r = await API.get(`/exchange/convert?amount=${amt}&currency=${cur}`);
            // 환산 결과는 원 단위 → Fmt.krw 로 표시 (1,488.58 → ₩1,489)
            prevVal.textContent  = '≈ ' + Fmt.krw(r.krw);
            prevRate.textContent = `(1 ${cur} = ${Number(r.rate).toLocaleString()} KRW)`;
          } catch (e) {
            prevVal.textContent  = '환산 실패';
            prevRate.textContent = `(${e.message})`;
          }
        };
        amtEl?.addEventListener('input', debounce(updatePreview, 400));
        curEl?.addEventListener('change', updatePreview);
        updatePreview();  // 초기 호출
      }
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
  // ============================================================
  // 통합 상세 열기 — 검색·딥링크 등에서 단일 진입점으로 사용
  //   type: 'leads' | 'customers' | 'projects' | 'meetings' | 'activities'
  //   id:   엔티티 PK
  //   parent: { leadId?, projectId? } — activities 처리용
  //
  // 페이지가 이미 로드되어 있으면 즉시 상세 열기,
  // 아니면 먼저 해당 페이지로 navigate 후 렌더 완료 대기 후 상세 열기.
  // ============================================================
  async openDetail(type, id, parent = {}) {
    const numId = parseInt(id, 10);
    if (!type || (Number.isNaN(numId) && type !== 'activities')) return;

    // type 별 타깃 페이지 + 상세 메서드 매핑
    let targetPage, openFn;
    switch (type) {
      case 'leads':
        targetPage = 'leads';
        openFn = () => this.openLeadDetail(numId);
        break;
      case 'customers':
        targetPage = 'customers';
        openFn = () => (typeof CustomersPage !== 'undefined') && CustomersPage.showCustomerModal?.(numId);
        break;
      case 'projects':
        targetPage = 'projects';
        openFn = () => (typeof ProjectsPage !== 'undefined') && ProjectsPage.openForm?.(numId);
        break;
      case 'meetings':
        targetPage = 'meeting-list';
        openFn = () => (typeof MeetingListPage !== 'undefined') && MeetingListPage.showDetail?.(numId);
        break;
      case 'activities': {
        // 활동은 부모(리드 또는 프로젝트) 상세를 연다
        const pLead = parseInt(parent.leadId, 10);
        const pProj = parseInt(parent.projectId, 10);
        if (Number.isFinite(pLead)) {
          targetPage = 'leads';
          openFn = () => this.openLeadDetail(pLead);
        } else if (Number.isFinite(pProj)) {
          targetPage = 'projects';
          openFn = () => (typeof ProjectsPage !== 'undefined') && ProjectsPage.openForm?.(pProj);
        } else {
          return;
        }
        break;
      }
      default:
        return;
    }

    // 페이지 이동 (필요 시)
    if (this.currentPage !== targetPage) {
      await this.navigate(targetPage);
      // 페이지 렌더 + 이벤트 바인딩 완료까지 짧게 대기
      // (vanilla SPA 라 렌더 끝나는 신호가 명확하지 않음 — 다음 프레임 2회 정도면 충분)
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    openFn();
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

      // 고객 담당자 정보 (App.customers 캐시 활용)
      const custInfo = (this.customers || []).find(c => c.name === l.customer_name);
      const contactPerson = custInfo?.contact_person || '-';
      const contactPhone  = custInfo?.phone  || '';
      const contactEmail  = custInfo?.email  || '';
      const customerId    = custInfo?.id || null;          // 고객사 모달 연결용

      // 활동 이력 HTML 생성 (data 속성으로 CSP-safe 이벤트 준비)
      const activitiesHtml = (l.activities && l.activities.length) ? `
        <div class="activity-list">
          ${l.activities.map(a => {
            const dateStr = a.activity_date ? String(a.activity_date).slice(0,10)
                          : a.performed_at  ? String(a.performed_at).slice(0,10) : '';
            const isLinkable = !a.calendar_event_id
              && a.activity_type
              && !['stage_change','수주','드롭'].includes(a.activity_type);
            return `
            <div class="activity-item ${a.calendar_event_id ? 'has-calendar' : ''}"
                 ${a.calendar_event_id
                   ? `data-act-cal="${a.calendar_event_id}" data-act-date="${dateStr}" style="cursor:pointer"`
                   : ''}>
              <div class="activity-icon">${this.activityIcon(a.activity_type)}</div>
              <div class="activity-body">
                <div class="activity-title" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                  <span>${esc(a.title)}</span>
                  ${a.status === 'done'
                    ? '<span class="badge" style="background:rgba(23,168,90,.12);color:#17A85A;font-size:10px;padding:1px 7px">✅ 완료</span>'
                    : a.status === 'planned'
                      ? '<span class="badge" style="background:rgba(33,150,243,.12);color:#1976D2;font-size:10px;padding:1px 7px">📌 계획</span>'
                      : ''}
                  ${a.calendar_event_id
                    ? '<span class="activity-cal-badge">📅 캘린더</span>'
                    : isLinkable
                      ? `<button class="btn btn-ghost btn-sm" style="font-size:10px;padding:1px 6px;border-color:#ccc;color:#888;white-space:nowrap"
                               data-link-act="${a.id}" data-act-date="${dateStr}">📅 연결</button>`
                      : ''}
                </div>
                ${a.content ? `<div class="activity-content">${esc(a.content)}</div>` : ''}
                <div class="activity-meta">${esc(a.performer_name || '시스템')} · ${Fmt.relTime(a.activity_date || a.performed_at)}</div>
              </div>
            </div>`;
          }).join('')}
        </div>
      ` : '<div class="empty"><div class="empty-icon">📝</div>활동 이력이 없습니다</div>';

      // 회의록 HTML 생성
      const meetingsHtml = (l.meetings && l.meetings.length) ? `
        <div class="card mb-3">
          <div class="card-header">
            <div class="card-title">📋 연결된 회의록 (${l.meetings.length}건)</div>
            <button class="btn btn-ghost btn-sm" id="ld-new-meeting">+ 새 회의록</button>
          </div>
          <div class="card-body no-pad">
            <div class="activity-list">
              ${l.meetings.map(m => {
                const preview = (m.summary_md || '')
                  .replace(/#{1,3}\s*/g, '').replace(/\*\*/g, '').replace(/\n+/g, ' ').trim()
                  .substring(0, 60);
                return `
                <div class="activity-item" style="cursor:pointer" data-meeting-detail="${m.id}">
                  <div class="activity-icon">📝</div>
                  <div class="activity-body">
                    <div class="activity-title">
                      ${esc(m.title)}
                      ${m.calendar_event_id ? '<span class="activity-cal-badge">📅 캘린더</span>' : ''}
                    </div>
                    ${preview ? `<div class="activity-content">${esc(preview)}${(m.summary_md||'').length > 60 ? '...' : ''}</div>` : ''}
                    <div class="activity-meta">${Fmt.date(m.meeting_date)} · ${esc(m.customer_name || '')}</div>
                  </div>
                </div>`;
              }).join('')}
            </div>
          </div>
        </div>
      ` : '';

      Modal.open({
        title: `${esc(l.customer_name)} · ${esc(l.project_name)}`,
        width: 1080,
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
            <div class="kv-row">
              <span class="kv-key">고객사</span>
              <span class="kv-val">
                ${customerId
                  ? `<a href="#" data-cust-link="${customerId}"
                       style="color:var(--oci-blue);text-decoration:none;font-weight:600;cursor:pointer"
                       title="고객사 상세 보기">🏢 ${esc(l.customer_name)}</a>`
                  : `<span style="font-weight:600">🏢 ${esc(l.customer_name)}</span>
                     <span style="font-size:11px;color:var(--text-4);margin-left:6px">(미등록)</span>`}
              </span>
            </div>
            <div class="kv-row">
              <span class="kv-key">영업 담당자</span>
              <span class="kv-val">
                ${l.assigned_name
                  ? `<a href="#" data-assignee-link="${l.assigned_to || ''}"
                       style="color:var(--oci-blue);text-decoration:none;cursor:pointer"
                       title="팀원 페이지로 이동">👤 ${esc(l.assigned_name)}</a>`
                  : '<span style="color:var(--text-4)">미배정</span>'}
              </span>
            </div>
            <div class="kv-row">
              <span class="kv-key">고객 담당자</span>
              <span class="kv-val">
                ${customerId && contactPerson !== '-'
                  ? `<a href="#" data-contact-link="${customerId}"
                       style="color:var(--oci-blue);text-decoration:none;cursor:pointer"
                       title="고객사 상세 보기">👥 ${esc(contactPerson)}</a>`
                  : `<span>${esc(contactPerson)}</span>`}
                ${contactPhone ? ' · <span class="mono" style="font-size:11px">' + esc(contactPhone) + '</span>' : ''}
              </span>
            </div>
            <div class="kv-row"><span class="kv-key">규모</span><span class="kv-val mono">${l.capacity_mw ? parseFloat(l.capacity_mw).toFixed(1) + ' MW' : '-'}</span></div>
            <div class="kv-row"><span class="kv-key">예상 마감일</span><span class="kv-val">${Fmt.date(l.expected_close_date)}</span></div>
            <div class="kv-row"><span class="kv-key">입찰 마감일</span><span class="kv-val">${Fmt.date(l.bidding_deadline)}</span></div>
            <div class="kv-row"><span class="kv-key">최초 등록</span><span class="kv-val">${Fmt.date(l.created_at)}</span></div>
            <div class="kv-row"><span class="kv-key">최근 업데이트</span><span class="kv-val">${Fmt.relTime(l.updated_at)}</span></div>
            ${contactEmail ? `<div class="kv-row"><span class="kv-key">고객 이메일</span><span class="kv-val mono" style="font-size:11px">${esc(contactEmail)}</span></div>` : ''}
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
              <button class="btn btn-ghost btn-sm" id="ld-add-act">+ 활동 추가</button>
            </div>
            <div class="card-body no-pad">${activitiesHtml}</div>
          </div>

          ${meetingsHtml}
        `,
        footer: `
          <button class="ai-gen-btn" id="ld-ai" data-feature="ai.lead_summary">🤖 AI 요약</button>
          <button class="btn btn-ghost" id="ld-email">✉️ 이메일</button>
          <button class="btn btn-ghost" id="ld-close">닫기</button>
          <button class="btn btn-primary" id="ld-edit">편집</button>
        `,
        bind: {
          // 푸터 버튼
          '#ld-add-act': () => App.openActivityForm(l.id, l.customer_name),
          '#ld-ai':      () => { Modal.close(); AI.summarizeLead(l.id, l.project_name); },
          '#ld-close':   () => Modal.close(),
          '#ld-edit':    () => { Modal.close(); App.openLeadForm(l.id); },
          '#ld-email':   () => {
            if (typeof Email !== 'undefined') {
              Email.open({
                to:       contactEmail || '',
                customer: { id: customerId, name: l.customer_name,
                            email: contactEmail, contact_person: contactPerson },
                lead:     { id: l.id, project_name: l.project_name,
                            customer_name: l.customer_name,
                            bidding_deadline: l.bidding_deadline },
                defaultCategory: 'lead',
              });
            }
          },
          // ── 고객사/고객담당자 클릭 → 고객사 모달 ──
          '[data-cust-link]': (e) => {
            e.preventDefault();
            const cid = parseInt(e.currentTarget.dataset.custLink);
            if (!cid) return;
            Modal.close();
            setTimeout(() => {
              App.navigate('customers').then(() => {
                if (typeof CustomersPage !== 'undefined' && CustomersPage.showCustomerModal) {
                  CustomersPage.showCustomerModal(cid);
                }
              });
            }, 100);
          },
          '[data-contact-link]': (e) => {
            e.preventDefault();
            const cid = parseInt(e.currentTarget.dataset.contactLink);
            if (!cid) return;
            Modal.close();
            setTimeout(() => {
              App.navigate('customers').then(() => {
                if (typeof CustomersPage !== 'undefined' && CustomersPage.showCustomerModal) {
                  CustomersPage.showCustomerModal(cid);
                }
              });
            }, 100);
          },
          // ── 영업 담당자 클릭 → 팀 페이지 ──
          '[data-assignee-link]': (e) => {
            e.preventDefault();
            Modal.close();
            setTimeout(() => App.navigate('team'), 100);
          },
          // 새 회의록 버튼 (회의록 있을 때만 렌더됨)
          '#ld-new-meeting': () => { Modal.close(); App.navigate('meeting'); },
          // 활동 → 캘린더 이동 (activity-item 행 클릭)
          '[data-act-cal]': (e) => {
            if (e.target.closest('[data-link-act]')) return; // 연결 버튼 클릭 시 무시
            const el = e.currentTarget;
            Modal.close();
            App.goToCalendarEvent(parseInt(el.dataset.actCal), el.dataset.actDate);
          },
          // 캘린더 연결 버튼
          '[data-link-act]': (e) => {
            e.stopPropagation();
            const el = e.currentTarget;
            App.openCalendarLinkPicker(parseInt(el.dataset.linkAct), l.id, el.dataset.actDate, l.id);
          },
          // 회의록 상세 이동
          '[data-meeting-detail]': (e) => {
            const mid = parseInt(e.currentTarget.dataset.meetingDetail);
            Modal.close();
            App.navigate('meeting-list');
            setTimeout(() => MeetingListPage.showDetail(mid), 400);
          }
        }
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

  // 활동이력 → 캘린더 이벤트로 이동
  goToCalendarEvent(eventId, dateStr) {
    App.navigate('calendar');
    // CalendarPage 렌더 완료 후 이벤트 하이라이트
    setTimeout(() => {
      if (typeof CalendarPage !== 'undefined') {
        CalendarPage.openEventById(eventId, dateStr);
      }
    }, 600);
  },

  // 수동 캘린더 연결 picker (과거 활동 → 캘린더 이벤트 연결)
  async openCalendarLinkPicker(activityId, leadId, dateStr, reopenLeadId) {
    try {
      const r = await API.get(`/activities/${activityId}/calendar-candidates`);
      const candidates = r.data || [];

      const EVENT_ICONS = { '미팅':'🤝', '영업방문':'🏗', '입찰':'📋', '제안':'📄', '내부':'🗂', '기타':'📌' };
      const STATUS_LABEL = { planned:'계획', completed:'완료' };

      const listHtml = candidates.length
        ? candidates.map(c => {
            const dt  = c.start_datetime ? String(c.start_datetime).slice(0, 16).replace('T', ' ') : '-';
            const ico  = EVENT_ICONS[c.event_type] || '📌';
            const used = c.already_linked_act ? ' <span style="color:#bbb;font-size:10px">(이미 연결됨)</span>' : '';
            return `
              <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--border);
                          border-radius:8px;margin-bottom:6px;${c.already_linked_act ? 'opacity:.5' : 'cursor:pointer'}"
                   ${!c.already_linked_act ? `data-clp-cal="${c.id}"` : ''}>
                <span style="font-size:18px">${ico}</span>
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;font-weight:500;color:var(--text-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.title)}${used}</div>
                  <div style="font-size:11px;color:var(--text-3)">${dt} · ${esc(c.event_type)} · ${STATUS_LABEL[c.status] || c.status}</div>
                </div>
                ${!c.already_linked_act ? '<span style="font-size:11px;color:#1a73e8;white-space:nowrap">연결 →</span>' : ''}
              </div>`;
          }).join('')
        : `<div class="empty" style="padding:20px 0">
             <div class="empty-icon">📅</div>
             <div>같은 리드의 ±7일 이내 캘린더 일정이 없습니다</div>
             <div style="font-size:12px;color:var(--text-3);margin-top:4px">
               캘린더에서 일정을 먼저 등록하거나, 활동 추가 시 캘린더 동기화를 사용하세요
             </div>
           </div>`;

      Modal.open({
        title: '📅 캘린더 일정 연결',
        width: 480,
        body: `
          <p style="font-size:13px;color:var(--text-2);margin-bottom:12px">
            이 활동과 연결할 캘린더 일정을 선택하세요 (±7일 이내)
          </p>
          ${listHtml}`,
        footer: `<button class="btn btn-ghost" id="clp-cancel">취소</button>`,
        bind: {
          '#clp-cancel': () => Modal.close(),
          '[data-clp-cal]': (e) => {
            const calId = parseInt(e.currentTarget.dataset.clpCal);
            App._doLinkActivity(activityId, calId, reopenLeadId);
          }
        }
      });
    } catch (e) { console.error(e); Toast.error('후보 일정을 불러오지 못했습니다'); }
  },

  async _doLinkActivity(activityId, calEventId, reopenLeadId) {
    try {
      await API.activities.update(activityId, { calendar_event_id: calEventId });
      Toast.success('캘린더 일정과 연결되었습니다');
      Modal.close();
      if (reopenLeadId) setTimeout(() => this.openLeadDetail(reopenLeadId), 150);
    } catch (e) { Toast.error('연결에 실패했습니다'); }
  },

  openActivityForm(leadId, customerName = '') {
    Modal.close();
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const defaultDt = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:00`;
    setTimeout(() => {
      Modal.open({
        title: '활동 추가',
        width: 480,
        body: `
          <form id="activity-form" class="form-grid">
            <input type="hidden" name="lead_id" value="${leadId}">
            <input type="hidden" name="customer_name" value="${esc(customerName)}">
            <div class="form-row-2">
              <div class="form-row">
                <label class="form-label">활동 유형</label>
                <select class="form-input" name="activity_type" id="act-type-sel">
                  <option value="meeting">미팅</option>
                  <option value="call">전화</option>
                  <option value="email">이메일</option>
                  <option value="site_visit">현장방문</option>
                  <option value="proposal">제안</option>
                  <option value="note">메모</option>
                </select>
              </div>
              <div class="form-row">
                <label class="form-label">활동 구분</label>
                <select class="form-input" name="status" id="act-status-sel">
                  <option value="planned">📌 계획</option>
                  <option value="done">✅ 완료</option>
                </select>
              </div>
            </div>
            <div class="form-row">
              <label class="form-label">제목 *</label>
              <input class="form-input" name="title" required>
            </div>
            <div class="form-row">
              <label class="form-label">일시</label>
              <input class="form-input" type="datetime-local" name="activity_datetime" value="${defaultDt}">
            </div>
            <div class="form-row">
              <label class="form-label">내용</label>
              <textarea class="form-input" name="content" rows="3"></textarea>
            </div>
            <div class="form-row">
              <label class="form-label">담당자</label>
              <select class="form-input" name="performed_by">
                <option value="">-</option>
                ${this.team.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}
              </select>
            </div>
            <div class="form-row" id="calendar-sync-row" style="align-items:center;gap:8px">
              <label class="form-label" style="margin:0">영업 캘린더 등록</label>
              <input type="checkbox" name="sync_calendar" id="sync-calendar-cb" checked style="width:16px;height:16px;cursor:pointer">
            </div>
          </form>
        `,
        footer: `
          <button class="btn btn-ghost" id="af-cancel">취소</button>
          <button class="btn btn-primary" id="af-save">등록</button>
        `,
        bind: {
          '#af-cancel': () => Modal.close(),
          '#af-save':   () => App.saveActivity(leadId)
        },
        onOpen: () => {
          const sel       = document.getElementById('act-type-sel');
          const statusSel = document.getElementById('act-status-sel');
          // 활동 유형 변경 시 캘린더 동기화 행 토글 + 활동 구분 자동 추천
          if (sel) {
            sel.addEventListener('change', () => {
              App._toggleCalendarSync(sel.value);
              // 메모·이메일·전화는 이미 발생한 사실 → 완료 / 그 외는 계획
              if (statusSel) {
                const auto = (sel.value === 'note' || sel.value === 'email' || sel.value === 'call') ? 'done' : 'planned';
                statusSel.value = auto;
              }
            });
          }
        }
      });
    }, 100);
  },

  _toggleCalendarSync(type) {
    const row = document.getElementById('calendar-sync-row');
    if (!row) return;
    // 메모·이메일은 캘린더 등록 불필요 — 숨김
    row.style.display = (type === 'note' || type === 'email') ? 'none' : '';
  },

  async saveActivity(leadId) {
    const form = document.getElementById('activity-form');
    const fd = new FormData(form);
    const body = {};
    fd.forEach((v, k) => body[k] = v || null);
    body.lead_id = leadId;
    const syncCalendar = document.getElementById('sync-calendar-cb')?.checked;
    const activityDatetime = body.activity_datetime;
    delete body.activity_datetime;
    delete body.sync_calendar;
    delete body.customer_name;
    if (!body.title) return Toast.error('제목을 입력하세요');

    const customerName = form.querySelector('[name="customer_name"]')?.value || '';

    try {
      // ① 활동 먼저 등록 → insertId 확보
      const actResult = await API.activities.create(body);
      const actId = actResult.id;

      if (syncCalendar && activityDatetime) {
        const typeToEvent = { meeting:'미팅', site_visit:'영업방문', proposal:'제안', call:'기타', bidding:'입찰' };
        const typeToColor = { meeting:'#3788d8', site_visit:'#28a745', proposal:'#fd7e14', call:'#6c757d', bidding:'#e63946' };
        const eventType = typeToEvent[body.activity_type] || '기타';
        const color     = typeToColor[body.activity_type] || '#6c757d';
        const dt = activityDatetime.replace('T', ' ') + ':00';
        const endDt = (() => {
          const d = new Date(activityDatetime);
          d.setHours(d.getHours() + 1);
          const p = n => String(n).padStart(2,'0');
          return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:00`;
        })();
        try {
          // ② 캘린더 이벤트 생성 → calEventId 확보
          const calResult = await API.calendar.create({
            title:          `[${eventType}] ${customerName ? customerName + ' ' : ''}${body.title}`,
            event_type:     eventType,
            status:         'planned',
            start_datetime: dt,
            end_datetime:   endDt,
            lead_id:        leadId || null,
            customer_name:  customerName || null,
            color,
          });
          const calId = calResult.id;

          // ③ 활동에 calendar_event_id 역방향 연결 (양방향성 완성)
          if (actId && calId) {
            await API.activities.update(actId, { calendar_event_id: calId }).catch(e =>
              console.warn('calendar_event_id 역방향 연결 실패:', e)
            );
          }
        } catch (calErr) {
          console.warn('캘린더 등록 실패:', calErr);
          Toast.error('활동은 저장됐으나 캘린더 등록에 실패했습니다');
        }
      }

      Toast.success(syncCalendar && activityDatetime ? '활동 추가 + 캘린더 등록 완료' : '활동이 추가되었습니다');
      Modal.close();
      setTimeout(() => this.openLeadDetail(leadId), 150);
    } catch (err) { console.error(err); }
  }
};

// ============================================================
// 실시간 알림 (WebSocket)
// ============================================================
const WS = {
  socket: null,
  _retryDelay: 1000,
  _maxDelay: 30000,
  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    // JWT 토큰을 쿼리스트링으로 전달 (WebSocket은 Authorization 헤더 불가)
    const token = localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token') || '';
    const wsUrl = `${proto}://${location.host}${token ? '?token=' + encodeURIComponent(token) : ''}`;
    this.socket = new WebSocket(wsUrl);
    this.socket.onopen = () => {
      this._retryDelay = 1000;
      if (typeof DevPage !== 'undefined') {
        DevPage.schemaMap._wsConnected = true;
        DevPage._updateWsStatus?.();
      }
    };
    this.socket.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);

        // ── 공지사항 등록 ──────────────────────────────────
        if (msg.type === 'announcement') {
          const pinMark = msg.is_pinned ? '📌 ' : '';
          Toast.info(`📢 ${pinMark}새 공지: ${msg.title}`);
          // 공지 페이지 보고 있으면 즉시 리프레시
          if (App.currentPage === 'board') BoardPage?.loadAnnouncements?.();
          Notifications.load();
          WS._showBadgePulse();
        }

        // ── 댓글 등록 ──────────────────────────────────────
        if (msg.type === 'comment') {
          const where = msg.ref_title ? ` [${msg.ref_title}]` : '';
          Toast.info(`💬 ${msg.author}님이 댓글을 남겼습니다${where}`);
          if (App.currentPage === 'board') BoardPage?.loadAnnouncements?.();
          Notifications.load();
          WS._showBadgePulse();
        }

        // ── FAQ 등록 ───────────────────────────────────────
        if (msg.type === 'faq') {
          Toast.info(`❓ 새 FAQ 등록 [${msg.category}]: ${msg.question}`);
          if (App.currentPage === 'board') BoardPage?.loadFaq?.();
        }

        // ── 리드 단계 변경 ─────────────────────────────────
        if (msg.type === 'stage_change') {
          const label = msg.stage === 'won'
            ? `🏆 수주 완료! ${msg.customer_name} - ${msg.project_name}`
            : `${msg.icon} ${msg.customer_name} → ${msg.stage_label}`;
          // 클릭 시 파이프라인 이동 + 리드 상세 열기
          const onClick = msg.lead_id ? () => {
            App.navigate('pipeline').then(() => {
              if (msg.lead_id) App.openLeadDetail(msg.lead_id);
            });
          } : null;
          if (msg.stage === 'won') Toast.success(label, onClick);
          else Toast.info(label, onClick);
          Notifications.load();
          WS._showBadgePulse();
        }

        // ── 레거시 호환 ────────────────────────────────────
        if (msg.type === 'notification') {
          Toast.info(msg.text || '새 알림이 있습니다');
          Notifications.load();
        }

        // ── 헬스맵 실시간 스냅샷 ──────────────────────────
        if (msg.type === 'healthmap-snapshot') {
          if (typeof DevPage !== 'undefined' && DevPage.activeTab === 'healthmap') {
            DevPage._hmOnSnapshot?.(msg.data);
          }
        }

        // ── 스키마 변경 (DDL 실행 후 브로드캐스트) ────────
        // 자동 리로드 없이 [스키마 동기화] 버튼 활성화 + 알림만 표시
        if (msg.type === 'schema_changed') {
          if (typeof DevPage !== 'undefined') {
            // DevPage에 변경 신호 전달 → 버튼 배지 활성화
            DevPage._onSchemaChangedWs?.(msg);
            // 스키마 탭에 있으면 WS 상태 업데이트
            if (DevPage.activeTab === 'schema') {
              DevPage._updateWsStatus?.();
            }
          }
          // 알림 Toast (탭 위치 무관)
          if (App.currentPage === 'dev') {
            Toast.info('🔔 스키마 변경이 감지되었습니다. [스키마 동기화]를 눌러 반영하세요.');
          }
        }
      } catch (_) { /* malformed WS message, skip */ }
    };
    this.socket.onclose = () => {
      if (typeof DevPage !== 'undefined') {
        DevPage.schemaMap._wsConnected = false;
        DevPage._updateWsStatus?.();
      }
      const delay = this._retryDelay;
      this._retryDelay = Math.min(this._retryDelay * 2, this._maxDelay);
      setTimeout(() => this.connect(), delay);
    };
  },
  _showBadgePulse() {
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    badge.classList.remove('pulse-anim');
    // reflow trick to restart animation
    void badge.offsetWidth;
    badge.classList.add('pulse-anim');
    setTimeout(() => badge.classList.remove('pulse-anim'), 1200);
  }
};

// ============================================================
// 기능 플래그 (Feature Flags) — 프론트엔드 헬퍼
// ============================================================
const Features = {
  _flags: {},     // { 'ai.assistant': true, 'auth.otp': false, ... }
  _loaded: false,

  // 앱 초기화 직후 호출 — /api/admin/dev/features/public 에서 플래그 로드
  async load() {
    try {
      const res = await API.get('/admin/dev/features/public');
      this._flags = res.data || {};
      this._loaded = true;
    } catch (_) {
      this._loaded = true; // 실패 시 모든 플래그 기본 활성화로 처리
    }
  },

  // 기능 활성화 여부 확인 (로드 전이면 true 반환 — 안전 기본값)
  isEnabled(key) {
    if (!this._loaded) return true;
    return this._flags[key] !== false; // undefined(=미정의)도 활성화로 처리
  },

  // 플래그 값에 따라 실제 DOM 요소를 숨기거나 복원
  apply() {
    if (!this._loaded) return;

    // ── ① CSS injection: data-feature 요소는 CSS로 즉시 숨김 (플래시 없음) ──
    // JS DOM 조작은 렌더 후 적용되어 깜박임 발생 → <style> 태그로 CSS 규칙 주입
    // CSS는 브라우저 렌더링 파이프라인 초기에 적용되므로 요소 출현 전부터 숨겨짐
    let css = '';
    Object.entries(this._flags).forEach(([key, enabled]) => {
      if (!enabled) css += `[data-feature="${key}"]{display:none!important}\n`;
    });
    let styleEl = document.getElementById('ff-override');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'ff-override';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = css;

    // ── ② ai.assistant 비활성화 시 열려있는 패널 닫기 ──
    if (!this.isEnabled('ai.assistant')) {
      try { AI.close(); } catch (_) {}
    }

    // ── ③ nav 섹션: 모든 nav 아이템이 숨겨질 때만 섹션 타이틀 숨김 ──
    // data-feature 없는 아이템은 항상 표시 → 그 아이템이 있는 섹션은 숨기지 않음
    document.querySelectorAll('.sidebar-nav .nav-section').forEach(section => {
      if (section.dataset.feature) return; // 이미 data-feature로 제어 중
      const allItems = section.querySelectorAll('.nav-item');
      if (allItems.length === 0) return;
      const allHidden = Array.from(allItems).every(el => {
        if (!el.dataset.feature) return false; // 플래그 없는 항목 → 항상 표시
        return this._flags[el.dataset.feature] === false;
      });
      section.style.display = allHidden ? 'none' : '';
    });
  }
};

// ============================================================
// 부팅
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  await App.init();  // Features.load() + apply()가 App.init() 내부에서 RBAC 이후 실행됨
  // realtime.ws 플래그가 ON일 때만 WebSocket 연결
  if (Features.isEnabled('realtime.ws')) WS.connect();
  UserPrefs.init();
});
