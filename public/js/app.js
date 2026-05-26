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
    dashboard: { obj: () => DashboardPage, title: '대시보드', crumb: '홈 / 대시보드' },
    orders: { obj: () => OrdersPage, title: '주문관리 (OMS)', crumb: 'OMS / 주문관리' },
    cost: { obj: () => CostPage, title: '원가관리', crumb: 'ERP / 원가관리' },
    pipeline: { obj: () => PipelinePage, title: '파이프라인', crumb: '영업관리 / 파이프라인' },
    leads: { obj: () => LeadsPage, title: '영업 리드', crumb: '영업관리 / 리드' },
    projects: { obj: () => ProjectsPage, title: '프로젝트', crumb: '영업관리 / 프로젝트' },
    customers: { obj: () => CustomersPage, title: '고객사', crumb: '영업관리 / 고객사' },
    calendar: { obj: () => CalendarPage, title: '영업 캘린더', crumb: '영업관리 / 캘린더' },
    quotes: { obj: () => QuotesPage, title: '견적서', crumb: '영업관리 / 견적서' },
    proposals: { obj: () => ProposalsPage, title: '제안', crumb: '영업관리 / 제안' },
    contracts: { obj: () => ContractsPage, title: '계약', crumb: '영업관리 / 계약' },
    team: { obj: () => TeamPage, title: '팀 현황', crumb: '분석 / 팀' },
    reports: { obj: () => ReportsPage, title: '리포트', crumb: '분석 / 리포트' },
    'report-builder': {
      obj: () => ReportBuilderPage,
      title: '리포트 빌더',
      crumb: '분석 / 리포트 빌더',
    },
    board: { obj: () => BoardPage, title: '커뮤니케이션', crumb: '소통 / 게시판' },
    meeting: { obj: () => MeetingPage, title: '회의록 AI', crumb: 'AI 기능 / 회의록' },
    'meeting-list': {
      obj: () => MeetingListPage,
      title: '회의록 목록',
      crumb: 'AI 기능 / 회의록 목록',
    },
    admin: { obj: () => AdminPage, title: '관리자', crumb: '시스템 / 관리자' },
    settings: { obj: () => SettingsPage, title: '설정', crumb: '시스템 / 설정' },
    notifications: {
      obj: () => NotificationsListPage,
      title: '알림 전체 목록',
      crumb: '알림 / 전체 목록',
    },
    dev: { obj: () => DevPage, title: '개발자 옵션', crumb: '시스템 / 개발자 옵션' },
  },

  async init() {
    // ── 인증 확인 ──────────────────────────────────────────
    await this.checkAuth();

    // ── 기능 플래그 로드 (RBAC 적용 후 실행해야 nav 요소가 확정된 상태) ──
    await Features.load();
    Features.apply();

    // ── 시스템 로고 로드 (커스텀 로고 적용) ─────────────────
    this._loadLogo();

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

    // 알림 로드 (기능 토글 ON 일 때만)
    if (Features.isEnabled('crm.notifications')) {
      Notifications.load();
      setInterval(
        () => {
          if (Features.isEnabled('crm.notifications')) Notifications.load();
        },
        5 * 60 * 1000
      );
    }

    // 알림 패널 외부 클릭 닫기
    document.addEventListener('click', e => {
      if (!e.target.closest('.notif-wrap')) {
        document.getElementById('notif-panel')?.classList.remove('show');
      }
    });

    // 첫 페이지 로드 — F5 새로고침 시 마지막 페이지로 복귀
    // 우선순위: PWA shortcut action > URL hash > localStorage > dashboard(기본)
    let startPage = 'dashboard';

    // v6.0.0: PWA shortcut 진입 감지 — manifest.json shortcuts ?action=... 처리
    // 예: ?action=scan-card → 고객사 페이지 + OCR 모달 + 카메라 자동
    //     ?action=meeting   → 회의록 AI 페이지 (음성→AI 요약)
    const urlParams = new URLSearchParams(location.search);
    const pwaAction = urlParams.get('action');
    if (pwaAction === 'scan-card') {
      startPage = 'customers';
    } else if (pwaAction === 'meeting') {
      startPage = 'meeting';
    } else {
      const hashPage = location.hash.replace(/^#/, '').trim();
      if (hashPage && this.pages[hashPage]) {
        startPage = hashPage;
      } else {
        try {
          const lastPage = localStorage.getItem('oci_lastPage');
          if (lastPage && this.pages[lastPage]) startPage = lastPage;
        } catch (_) {}
      }
    }
    await this.navigate(startPage);

    // v6.0.0: PWA shortcut 후속 처리 — 모달 자동 오픈 + URL 정리
    if (pwaAction === 'scan-card') {
      setTimeout(() => {
        try {
          if (typeof CustomersPage !== 'undefined' && CustomersPage.openRegisterModal) {
            CustomersPage.openRegisterModal('ocr', { autoCapture: true });
          }
        } catch (e) {
          console.warn('[PWA scan-card] OCR 모달 오픈 실패:', e?.message || e);
        }
        // URL 파라미터 정리 — 새로고침 시 무한 트리거 방지
        try {
          history.replaceState(null, '', location.pathname + location.hash);
        } catch (_) {
          /* skip */
        }
      }, 300);
    } else if (pwaAction === 'meeting') {
      // v6.0.0: 회의록 AI 쇼트컷 — 페이지 진입만 (녹음은 user gesture 필요)
      setTimeout(() => {
        // URL 파라미터 정리 — 새로고침 시 무한 트리거 방지
        try {
          history.replaceState(null, '', location.pathname + location.hash);
        } catch (_) {
          /* skip */
        }
        // 모바일 사용자 가이드 — 녹음 시작 버튼 강조 (3초)
        const recBtn = document.getElementById('rec-start-btn');
        if (recBtn) {
          recBtn.style.animation = 'pulse-attention 1.2s ease-in-out 2';
          recBtn.style.boxShadow = '0 0 0 3px rgba(230,51,41,0.3)';
          setTimeout(() => {
            recBtn.style.boxShadow = '';
            recBtn.style.animation = '';
          }, 3000);
        }
      }, 300);
    }

    // 첫 로그인이면 온보딩 환영 모달 자동 표시 (1초 지연 — 페이지 로딩 안정)
    setTimeout(() => {
      if (typeof Onboarding !== 'undefined') {
        Onboarding.maybeShow();
        // 3일 이상 미접속 + 미완료 단계 있을 때 부드러운 Toast nudge
        // maybeShow 가 자동 표시되는 경우(신규 사용자)는 nudge 가 조건상 자동 skip
        Onboarding.maybeShowNudge?.();
      }
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
    document.addEventListener('click', e => {
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
      } else if (action === 'open-onboarding') {
        e.preventDefault();
        // 사용자 명시적 다시 보기 — localStorage 플래그 무시하고 강제 표시
        if (typeof Onboarding !== 'undefined') Onboarding.reset();
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
    document.getElementById('ai-quick-actions')?.addEventListener('click', e => {
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
      aiInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (typeof AI !== 'undefined') AI.send();
        }
      });
      aiInput.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
      });
    }
  },

  // ── 인증 + RBAC ───────────────────────────────────────────
  async checkAuth() {
    const token = localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token');
    if (!token) {
      window.location.href = '/login';
      return;
    }

    try {
      const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!data.success) {
        this.logout();
        return;
      }

      this.currentUser = data.data;
      localStorage.setItem('current_user_id', data.data.id);
      this.applyRbacToNav(data.data);
      this.renderUserBadge(data.data);
    } catch (_) {
      this.logout();
    }
  },

  logout() {
    // ⚡ 빠른 로그아웃 — 서버 응답을 기다리지 않고 즉시 클라이언트 정리
    // fetch 는 keepalive 로 페이지 이동 후에도 백그라운드로 완료됨
    // (await 하면 서버 응답 지연 시 사용자가 5초+ 대기하는 문제 발생)
    try {
      const token = localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token');
      if (token) {
        fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'include', // Refresh Token 쿠키 전송 → 서버에서 쿠키 삭제
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          keepalive: true, // 페이지 종료 후에도 요청 유지
        }).catch(() => {
          /* 백그라운드 — 오류 무시 */
        });
      }
    } catch (_) {
      /* 클라이언트 정리는 반드시 진행 */
    }
    localStorage.removeItem('oci_token');
    sessionStorage.removeItem('oci_token');
    localStorage.removeItem('oci_user');
    localStorage.removeItem('current_user_id');
    // 세션 종료 시 마지막 페이지 기록도 정리 — 다음 로그인 시 대시보드로 진입하도록
    localStorage.removeItem('oci_lastPage');
    window.location.href = '/login';
  },

  applyRbacToNav(user) {
    const pages = user.pages || [];
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
    const roleLabels = {
      manager: '매니저',
      team_lead: '팀장',
      executive: '경영진',
      admin: 'IT운영관리자',
      superadmin: '시스템담당자',
    };
    el.innerHTML = `
      <div class="ubadge">
        <div class="ubadge-info">
          <span class="ubadge-name">${esc(user.full_name || user.username)}</span>
          <span class="ubadge-role">${roleLabels[user.role] || user.role}</span>
        </div>
        <button class="btn-logout" id="btn-logout-ubadge" data-title-label="topbar.logout" title="로그아웃">
          <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clip-rule="evenodd"/></svg>
          <span data-label="topbar.logout">로그아웃</span>
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
        loadStages(), // 파이프라인 단계 정의 동적 로드 (실패해도 fallback)
      ]);
      this.team = teamRes.data;
      this.customers = custRes.data;
    } catch (err) {
      console.warn('common data load failed:', err);
    }
  },

  async updateNavBadges() {
    try {
      const result = await API.leads.list();
      const active = result.data.filter(l => !['won', 'lost', 'dropped'].includes(l.stage)).length;
      const total = result.data.length;
      const elPipe = document.getElementById('nav-pipeline-count');
      const elLeads = document.getElementById('nav-leads-count');
      if (elPipe) elPipe.textContent = active;
      if (elLeads) elLeads.textContent = total;
    } catch (_) {
      /* nav badge update is non-critical */
    }
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
      const items = Array.isArray(data.items) ? data.items : [];
      if (!sections.length) return; // 데이터 없으면 폴백 유지

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
          const span = [...el.children].find(
            c => c.tagName === 'SPAN' && !c.classList.contains('nav-badge')
          );
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
          if (itemEl) secEl.appendChild(itemEl); // 이미 다른 섹션에 있어도 옮김
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
      items.forEach(it => {
        sectionHasItems[it.section_key] = true;
      });
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

  // ─── 시스템 로고 로드 (사이드바 좌측 상단) ────────────────
  // 커스텀 로고 업로드 시 즉시 반영 (DEV 옵션 / 설정 페이지에서 변경)
  async _loadLogo() {
    const img = document.getElementById('sidebar-logo-img');
    if (!img) return;
    try {
      const r = await API.get('/system/logo');
      const url = r?.data?.url;
      if (url && url !== img.src) {
        img.src = url;
      }
    } catch (_) {
      // 실패 시 기본 로고 유지 (HTML 의 src 그대로)
    }
  },

  // ── 모바일 햄버거 네비게이션 ─────────────────────────────
  toggleMobileNav() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const isOpen = sidebar.classList.contains('mobile-open');
    if (isOpen) {
      this.closeMobileNav();
    } else {
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

    // ── 기능 토글 OFF 페이지 차단 (URL 직접 접근 방어) ───────
    // 사이드바 nav-item 의 data-feature 와 매핑 — UI 와 일관성 확보
    const featureMap = {
      dashboard: 'crm.dashboard',
      pipeline: 'crm.pipeline',
      calendar: 'crm.calendar',
      quotes: 'crm.quotes',
      proposals: 'crm.proposals',
      contracts: 'crm.contracts',
      reports: 'crm.reports',
      'report-builder': 'crm.report_builder',
      board: 'crm.board',
      meeting: 'ai.meeting',
      'meeting-list': 'ai.meeting',
      dev: 'dev.options',
    };
    const featKey = featureMap[pageId];
    if (featKey && typeof Features !== 'undefined' && !Features.isEnabled(featKey)) {
      Toast.warn?.(`"${page.title}" 기능이 비활성화 상태입니다. 관리자에게 문의하세요.`);
      // 대시보드로 자동 이동 (단, dashboard 자체가 OFF 인 경우 leads 로 fallback)
      const fallback = Features.isEnabled('crm.dashboard') ? 'dashboard' : 'leads';
      if (pageId !== fallback) {
        return this.navigate(fallback);
      }
      return;
    }

    // 모바일에서 페이지 이동 시 사이드바 자동 닫기
    this.closeMobileNav();

    this.currentPage = pageId;

    // ⚠️ F5 새로고침 후 같은 페이지로 복귀 — 마지막 페이지 저장
    try {
      localStorage.setItem('oci_lastPage', pageId);
    } catch (_) {}
    // URL hash 동기화 (브라우저 뒤로가기 호환)
    if (location.hash.replace(/^#/, '') !== pageId) {
      history.replaceState(null, '', '#' + pageId);
    }

    // 사이드바 active 토글
    document.querySelectorAll('.nav-item[data-page]').forEach(el => {
      el.classList.toggle('active', el.dataset.page === pageId);
    });

    // 상단 타이틀/breadcrumb — 워드 사전 dictionary 우선, 미설정 시 fallback
    const titleKey = `pages.${pageId}_title`;
    const crumbKey = `pages.${pageId}_crumb`;
    const titleEl = document.getElementById('page-title');
    const crumbEl = document.getElementById('page-breadcrumb');
    titleEl.setAttribute('data-label', titleKey);
    crumbEl.setAttribute('data-label', crumbKey);
    titleEl.textContent =
      typeof Labels !== 'undefined' ? Labels.get(titleKey, page.title) : page.title;
    crumbEl.textContent =
      typeof Labels !== 'undefined' ? Labels.get(crumbKey, page.crumb) : page.crumb;

    // 컨텐츠 로딩
    document.getElementById('content').innerHTML =
      `<div class="loading" data-label="common.loading_data">${
        typeof Labels !== 'undefined'
          ? Labels.get('common.loading_data', '데이터 로딩중...')
          : '데이터 로딩중...'
      }</div>`;

    try {
      await page.obj().render();
      // CSS injection 방식이므로 별도 apply() 불필요 — 렌더된 요소에 CSS 즉시 적용됨

      // 워드 사전 라벨 자동 치환 — [data-label] 마커 요소에 적용
      // applyAsync: dict 미로드 시 ensureLoaded 후 apply (race 방지)
      if (typeof Labels !== 'undefined') {
        Labels.applyAsync().catch(() => {});
      }
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
      } catch (_) {
        return;
      }
    }

    if (!this.team.length) await this.refreshCommon();

    const teamOpts = this.team
      .map(
        t =>
          `<option value="${t.id}" ${lead?.assigned_to === t.id ? 'selected' : ''}>${esc(t.name)} (${esc(t.role)})</option>`
      )
      .join('');

    // v6.0.0 Phase B: 협업자 (collaborator_ids) 초기 선택 IDs
    // collaborators (hydrate 된 객체 배열) 우선, 없으면 collaborator_ids (raw) 파싱
    const initCollabIds = new Set();
    if (lead?.collaborators && Array.isArray(lead.collaborators)) {
      lead.collaborators.forEach(c => c?.id && initCollabIds.add(c.id));
    } else if (lead?.collaborator_ids) {
      try {
        const raw =
          typeof lead.collaborator_ids === 'string'
            ? JSON.parse(lead.collaborator_ids)
            : lead.collaborator_ids;
        if (Array.isArray(raw)) raw.forEach(id => initCollabIds.add(parseInt(id, 10)));
      } catch (_) {
        /* skip */
      }
    }
    const initCollabSet = initCollabIds;

    Modal.open({
      title: lead
        ? typeof Labels !== 'undefined'
          ? Labels.get('leads.modal_edit', '리드 정보 수정')
          : '리드 정보 수정'
        : typeof Labels !== 'undefined'
          ? Labels.get('leads.modal_new', '신규 리드 등록')
          : '신규 리드 등록',
      width: 640,
      body: `
        <form id="lead-form" class="form-grid">
          <div class="form-row-2">
            <div class="form-row">
              <label class="form-label" data-label="leads.customer_name">고객사 *</label>
              <input class="form-input" name="customer_name" id="lead-customer-input"
                     value="${esc(lead?.customer_name || '')}" required autocomplete="off">
              <!-- Combobox 선택 시 customer_id 클라이언트 보관 (백엔드 destructure 에서 무시됨 — 사이드이펙 0) -->
              <input type="hidden" name="customer_id" id="lead-customer-id" value="${esc(lead?.customer_id || '')}">
            </div>
            <div class="form-row">
              <label class="form-label" data-label="leads.project_name">프로젝트명 *</label>
              <input class="form-input" name="project_name" value="${esc(lead?.project_name || '')}" required>
            </div>
          </div>

          <div class="form-row-3">
            <div class="form-row">
              <label class="form-label" data-label="leads.business_type">사업 유형</label>
              <select class="form-input" name="business_type">
                <option value="태양광" data-label="business.solar" ${lead?.business_type === '태양광' ? 'selected' : ''}>태양광</option>
                <option value="모듈"   data-label="business.module" ${lead?.business_type === '모듈' ? 'selected' : ''}>모듈</option>
                <option value="EPC"    data-label="business.epc"    ${lead?.business_type === 'EPC' ? 'selected' : ''}>EPC</option>
                <option value="ESS"    data-label="business.ess"    ${lead?.business_type === 'ESS' ? 'selected' : ''}>ESS</option>
                <option value="전기"   data-label="business.electric" ${lead?.business_type === '전기' ? 'selected' : ''}>전기</option>
                <option value="설치"   data-label="business.install" ${lead?.business_type === '설치' ? 'selected' : ''}>설치</option>
              </select>
            </div>
            <div class="form-row">
              <label class="form-label" data-label="leads.region">국내/해외</label>
              <select class="form-input" name="region">
                <option value="국내" data-label="region.domestic" ${lead?.region === '국내' ? 'selected' : ''}>국내</option>
                <option value="해외" data-label="region.overseas" ${lead?.region === '해외' ? 'selected' : ''}>해외</option>
              </select>
            </div>
            <div class="form-row">
              <label class="form-label" data-label="leads.stage">단계</label>
              <select class="form-input" name="stage">
                ${Object.keys(STAGES)
                  .map(
                    s =>
                      `<option value="${s}" data-label="stages.${s}" ${(lead?.stage || 'lead') === s ? 'selected' : ''}>${STAGES[s].label}</option>`
                  )
                  .join('')}
              </select>
            </div>
          </div>

          <div class="form-row-3">
            <div class="form-row">
              <label class="form-label" data-label="leads.capacity_mw">규모 (MW)</label>
              <input type="number" step="0.01" class="form-input" name="capacity_mw" value="${lead?.capacity_mw || ''}">
            </div>
            <div class="form-row">
              <label class="form-label" data-label="leads.expected_amount">예상 금액</label>
              <input type="number" step="0.01" class="form-input" name="expected_amount" value="${lead?.expected_amount || ''}" placeholder="단위: 원 (예: 366억원 → 36600000000)">
            </div>
            <div class="form-row">
              <label class="form-label" data-label="leads.currency">통화</label>
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
              <label class="form-label" data-label="leads.assigned_to">주 담당자</label>
              <select class="form-input" name="assigned_to" id="lf-assigned-to">
                <option value="" data-label="leads.unassigned">- 미배정 -</option>
                ${teamOpts}
              </select>
            </div>
            <div class="form-row">
              <label class="form-label" data-label="leads.expected_close_date">예상 마감일</label>
              <input type="date" class="form-input" name="expected_close_date" value="${lead?.expected_close_date ? Fmt.date(lead.expected_close_date) : ''}">
            </div>
            <div class="form-row">
              <label class="form-label" data-label="leads.bidding_deadline">입찰 마감일</label>
              <input type="date" class="form-input" name="bidding_deadline" value="${lead?.bidding_deadline ? Fmt.date(lead.bidding_deadline) : ''}">
            </div>
          </div>

          <!-- v6.0.0 Phase B: 협업자 (복수 담당) — 알림 수신 대상 확장 -->
          <div class="form-row" id="lf-collab-row">
            <label class="form-label">
              👥 협업자 <span style="font-weight:400;font-size:11px;color:var(--text-3)">(선택, 복수 가능 — 영업 활동 업데이트 시 함께 알림)</span>
            </label>
            <div id="lf-collab-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;min-height:28px"></div>
            <details style="border:1px solid var(--border);border-radius:6px;background:#fafafa">
              <summary style="cursor:pointer;padding:8px 12px;font-size:12px;color:var(--text-2);user-select:none">
                ➕ 협업자 선택/해제
              </summary>
              <div id="lf-collab-options" style="padding:10px 12px;display:grid;
                          grid-template-columns:repeat(auto-fill,minmax(180px,1fr));
                          gap:6px;max-height:240px;overflow-y:auto;
                          border-top:1px solid var(--border);background:#fff">
                ${this.team
                  .map(
                    t => `<label class="lf-collab-opt" data-id="${t.id}" data-name="${esc(t.name)}"
                                style="display:flex;align-items:center;gap:6px;padding:5px 8px;
                                       border-radius:4px;cursor:pointer;font-size:12px;
                                       transition:background .12s">
                  <input type="checkbox" class="lf-collab-cb" value="${t.id}"
                         data-name="${esc(t.name)}"
                         ${initCollabSet.has(t.id) ? 'checked' : ''}>
                  <span>${esc(t.name)}</span>
                  <span style="color:var(--text-3);font-size:10px">(${esc(t.role || '')})</span>
                </label>`
                  )
                  .join('')}
              </div>
            </details>
          </div>

          <div class="form-row">
            <label class="form-label" data-label="leads.notes">메모</label>
            <textarea class="form-input" name="notes" rows="3">${esc(lead?.notes || '')}</textarea>
          </div>
        </form>

        ${
          lead
            ? `<!-- v6.0.0 Step 2: 연결된 계약 -->
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
          <div id="lc-lead"></div>
        </div>`
            : ''
        }
      `,
      footer: `
        ${lead ? `<button class="btn btn-ghost text-danger" id="lf-delete" data-label="common.delete">삭제</button>` : ''}
        <button class="btn btn-ghost" id="lf-cancel" data-label="common.cancel">취소</button>
        <button class="btn btn-primary" id="lf-save" data-label="${lead ? 'common.save' : 'common.register'}">${lead ? '저장' : '등록'}</button>
      `,
      bind: Object.assign(
        { '#lf-cancel': () => Modal.close(), '#lf-save': () => App.saveLead(lead?.id || null) },
        lead ? { '#lf-delete': () => App.deleteLead(lead.id) } : {}
      ),
      onOpen: () => {
        // v6.0.0 Phase B: 협업자 칩 갱신 + 주담당과 동기화
        const updateCollabChips = () => {
          const chipsEl = document.getElementById('lf-collab-chips');
          const optsEl = document.getElementById('lf-collab-options');
          const assignedEl = document.getElementById('lf-assigned-to');
          const assignedId = parseInt(assignedEl?.value || '', 10);
          if (!chipsEl || !optsEl) return;
          // 주담당으로 선택된 사람은 협업자 선택 불가 (자동 체크 해제 + 비활성)
          optsEl.querySelectorAll('.lf-collab-cb').forEach(cb => {
            const id = parseInt(cb.value, 10);
            const opt = cb.closest('.lf-collab-opt');
            if (assignedId && id === assignedId) {
              cb.checked = false;
              cb.disabled = true;
              if (opt) opt.style.opacity = '0.4';
            } else {
              cb.disabled = false;
              if (opt) opt.style.opacity = '';
            }
          });
          // 선택된 chip 렌더
          const selected = Array.from(optsEl.querySelectorAll('.lf-collab-cb:checked'));
          if (!selected.length) {
            chipsEl.innerHTML = `<span style="font-size:11px;color:var(--text-3)">아직 선택된 협업자가 없습니다 — 아래에서 선택하세요</span>`;
            return;
          }
          chipsEl.innerHTML = selected
            .map(
              cb => `<span class="lf-collab-chip" data-id="${cb.value}"
                          style="display:inline-flex;align-items:center;gap:6px;
                                 padding:4px 10px;background:#dbeafe;color:#1e40af;
                                 border-radius:12px;font-size:11px;font-weight:600">
                👤 ${esc(cb.dataset.name)}
                <button type="button" class="lf-collab-rm" data-id="${cb.value}"
                        style="background:none;border:none;cursor:pointer;color:#1e40af;
                               font-size:13px;line-height:1;padding:0">×</button>
              </span>`
            )
            .join('');
          // chip × 버튼 → 체크박스 해제
          chipsEl.querySelectorAll('.lf-collab-rm').forEach(btn => {
            btn.addEventListener('click', () => {
              const id = btn.dataset.id;
              const cb = optsEl.querySelector(`.lf-collab-cb[value="${id}"]`);
              if (cb) {
                cb.checked = false;
                updateCollabChips();
              }
            });
          });
        };
        document.querySelectorAll('.lf-collab-cb').forEach(cb => {
          cb.addEventListener('change', updateCollabChips);
        });
        document
          .getElementById('lf-assigned-to')
          ?.addEventListener('change', updateCollabChips);
        // 호버 효과
        document.querySelectorAll('.lf-collab-opt').forEach(opt => {
          opt.addEventListener('mouseenter', () => {
            if (!opt.querySelector('input')?.disabled) opt.style.background = '#f3f4f6';
          });
          opt.addEventListener('mouseleave', () => {
            opt.style.background = '';
          });
        });
        updateCollabChips(); // 초기 렌더

        // 통화/금액 변경 시 KRW 환산 실시간 미리보기
        const amtEl = document.querySelector('#lead-form [name="expected_amount"]');
        const curEl = document.getElementById('lf-currency');
        const prevWrap = document.getElementById('lf-krw-preview');
        const prevVal = document.getElementById('lf-krw-value');
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
            prevVal.textContent = Fmt.amount(amt, 'KRW');
            prevRate.textContent = '(원화 입력)';
            return;
          }
          prevWrap.style.display = 'flex';
          prevVal.textContent = '환산 중...';
          prevRate.textContent = '';
          try {
            const r = await API.get(`/exchange/convert?amount=${amt}&currency=${cur}`);
            // 환산 결과는 원 단위 → Fmt.krw 로 표시 (1,488.58 → ₩1,489)
            prevVal.textContent = '≈ ' + Fmt.krw(r.krw);
            prevRate.textContent = `(1 ${cur} = ${Number(r.rate).toLocaleString()} KRW)`;
          } catch (e) {
            prevVal.textContent = '환산 실패';
            prevRate.textContent = `(${e.message})`;
          }
        };
        amtEl?.addEventListener('input', debounce(updatePreview, 400));
        curEl?.addEventListener('change', updatePreview);
        updatePreview(); // 초기 호출

        // ─── 고객사 자동완성 (Combobox) ───────────────────
        // 기존 <datalist> 제거 후 Combobox.attach 로 교체
        // 사이드이펙 방지:
        //  - hidden #lead-customer-id 백엔드 destructure 에서 무시됨 (검증 완료)
        //  - Combobox 미로드 시 일반 input 으로 동작 (graceful degradation)
        //  - 자유 입력 허용 (신규 고객사 등록은 별도 메뉴)
        const custInput = document.getElementById('lead-customer-input');
        const custHidden = document.getElementById('lead-customer-id');
        if (custInput && typeof Combobox !== 'undefined') {
          // 사용자가 input 텍스트 직접 수정 시 hidden id 동기화 해제
          // (JS 로 input.value 변경 시엔 input 이벤트 미발생 — 사용자 타이핑만 트리거)
          custInput.addEventListener('input', () => {
            if (custHidden) custHidden.value = '';
          });
          Combobox.attach({
            inputEl: custInput,
            fetchFn: async q => {
              try {
                const r = await API.customers.autocomplete(q, 10);
                return r.data || [];
              } catch (_) {
                return [];
              }
            },
            renderItem: (item, q, { highlightMatch }) => {
              const meta = [];
              if (item.industry) meta.push(esc(item.industry));
              if (item.region) meta.push(esc(item.region));
              if (item.active_deals_count > 0) {
                meta.push(
                  `<span style="color:var(--oci-red);font-weight:600">진행 ${item.active_deals_count}건</span>`
                );
              }
              const myBadge = item.is_my_customer
                ? `<span style="font-size:9px;background:var(--oci-red-light);color:var(--oci-red);padding:1px 5px;border-radius:3px;font-weight:600;margin-left:4px">본인담당</span>`
                : '';
              return `
                <div class="combobox-item-content">
                  <div class="combobox-item-title">🏢 ${highlightMatch(item.name, q)}${myBadge}</div>
                  ${meta.length ? `<div class="combobox-item-meta">${meta.join(' · ')}</div>` : ''}
                </div>
              `;
            },
            onSelect: item => {
              custInput.value = item.name;
              if (custHidden) custHidden.value = item.id;
            },
            onCustomCreate: query => {
              custInput.value = query;
              if (custHidden) custHidden.value = '';
            },
            minChars: 2,
            debounceMs: 250,
            allowCustom: true,
            customLabel: '+ "X" 그대로 등록 (신규 고객사)',
          });
        }

        // v6.0.0 Step 2: 연결된 계약 (편집 모드만, 신규 등록 시 lead.id 없음)
        if (lead && lead.id && typeof LinkedContracts !== 'undefined') {
          LinkedContracts.render('#lc-lead', 'lead', lead.id).catch(() => {});
        }
      },
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

    // v6.0.0 Phase B: 협업자 체크박스 → 배열로 수집 (FormData 미커버 항목)
    const collabCbs = document.querySelectorAll('.lf-collab-cb:checked');
    body.collaborator_ids = Array.from(collabCbs)
      .map(cb => parseInt(cb.value, 10))
      .filter(x => Number.isFinite(x) && x > 0);

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
    } catch (err) {
      console.error(err);
    }
  },

  deleteLead(id) {
    Modal.close();
    Modal.confirm('이 리드를 삭제하시겠습니까? 활동 이력도 함께 삭제됩니다.', async () => {
      try {
        await API.leads.delete(id);
        Toast.success('리드가 삭제되었습니다');
        const cur = this.pages[this.currentPage]?.obj();
        if (cur && cur.loadData) cur.loadData();
        this.updateNavBadges();
      } catch (err) {
        console.error(err);
      }
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
        openFn = () =>
          typeof CustomersPage !== 'undefined' && CustomersPage.showCustomerModal?.(numId);
        break;
      case 'projects':
        targetPage = 'projects';
        openFn = () => typeof ProjectsPage !== 'undefined' && ProjectsPage.openForm?.(numId);
        break;
      case 'meetings':
        targetPage = 'meeting-list';
        openFn = () =>
          typeof MeetingListPage !== 'undefined' && MeetingListPage.showDetail?.(numId);
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
          openFn = () => typeof ProjectsPage !== 'undefined' && ProjectsPage.openForm?.(pProj);
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

      // v6.0.0: 모달 열림 즉시 NEW 배지 사라지도록 캐시 동기화 (백엔드는 GET 시 자동 mark)
      // LeadsPage._allLeads 의 항목을 markAsReadLocal → renderTable 즉시 재호출
      try {
        if (
          typeof LeadsPage !== 'undefined' &&
          Array.isArray(LeadsPage._allLeads) &&
          typeof ReadReceipts !== 'undefined'
        ) {
          const item = LeadsPage._allLeads.find(x => x && x.id === id);
          if (item && item.is_read !== true) {
            ReadReceipts.markAsReadLocal(item);
            // 필터 적용된 후 렌더링 유지 (현재 렌더 데이터 그대로)
            if (typeof LeadsPage.renderTable === 'function') {
              LeadsPage.renderTable(LeadsPage._allLeads);
            }
            // 사이드바 배지 갱신 (있을 경우)
            if (typeof App !== 'undefined' && App.updateNavBadges) App.updateNavBadges();
          }
        }
      } catch (_) {
        /* read-receipt 캐시 동기화 best-effort */
      }

      const stage = STAGES[l.stage] || STAGES.lead;
      const days = Fmt.daysLeft(l.expected_close_date);
      const daysBadge =
        days === null || days === undefined
          ? ''
          : days < 0
            ? `<span class="badge badge-red">${Math.abs(days)}일 경과</span>`
            : days <= 7
              ? `<span class="badge badge-amber">D-${days}</span>`
              : `<span class="badge badge-gray">D-${days}</span>`;

      // 고객 담당자 정보 (App.customers 캐시 활용)
      const custInfo = (this.customers || []).find(c => c.name === l.customer_name);
      const contactPerson = custInfo?.contact_person || '-';
      const contactPhone = custInfo?.phone || '';
      const contactEmail = custInfo?.email || '';
      const customerId = custInfo?.id || null; // 고객사 모달 연결용

      // v6.0.0 Phase A: activities/meetings 별도 카드 렌더링 제거
      // → 통합 타임라인(_loadTimeline)에서 모두 처리 + 필터/정렬 가능
      Modal.open({
        title: `${esc(l.customer_name)} · ${esc(l.project_name)}`,
        width: 1440,
        wide: true, // v6.0.0 Phase A: 통합 타임라인 + 칩 필터 가독성 위해 반응형 와이드
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
              <span class="kv-key" data-label="leads.customer_name">고객사</span>
              <span class="kv-val">
                ${
                  customerId
                    ? `<a href="#" data-cust-link="${customerId}"
                       style="color:var(--oci-blue);text-decoration:none;font-weight:600;cursor:pointer"
                       title="고객사 상세 보기">🏢 ${esc(l.customer_name)}</a>`
                    : `<span style="font-weight:600">🏢 ${esc(l.customer_name)}</span>
                     <span style="font-size:11px;color:var(--text-4);margin-left:6px">(미등록)</span>`
                }
              </span>
            </div>
            <div class="kv-row">
              <span class="kv-key" data-label="leads.assigned_to">영업 담당자</span>
              <span class="kv-val" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">
                ${
                  l.assigned_name
                    ? `<a href="#" data-assignee-link="${l.assigned_to || ''}"
                       style="color:var(--oci-blue);text-decoration:none;cursor:pointer;font-weight:600"
                       title="팀원 페이지로 이동">👤 ${esc(l.assigned_name)}</a>
                       <span style="font-size:10px;padding:1px 6px;background:#dbeafe;color:#1e40af;border-radius:8px;font-weight:600">주 담당</span>`
                    : '<span style="color:var(--text-4)">미배정</span>'
                }
                ${
                  Array.isArray(l.collaborators) && l.collaborators.length
                    ? l.collaborators
                        .map(
                          c => `<span title="협업자 — 활동 업데이트 시 함께 알림 수신"
                          style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;
                                 background:#e0f2fe;color:#0369a1;border-radius:10px;font-size:11px;font-weight:500">
                        👥 ${esc(c.name)}
                      </span>`
                        )
                        .join('')
                    : ''
                }
              </span>
            </div>${
              Array.isArray(l.collaborators) && l.collaborators.length
                ? `<div class="kv-row"><span class="kv-key">협업자</span><span class="kv-val" style="font-size:11px;color:var(--text-3)">총 ${l.collaborators.length}명 — 댓글/단계 변경 시 함께 알림 발송</span></div>`
                : ''
            }
            <div class="kv-row">
              <span class="kv-key" data-label="leads.contact_person">고객 담당자</span>
              <span class="kv-val">
                ${
                  customerId && contactPerson !== '-'
                    ? `<a href="#" data-contact-link="${customerId}"
                       style="color:var(--oci-blue);text-decoration:none;cursor:pointer"
                       title="고객사 상세 보기">👥 ${esc(contactPerson)}</a>`
                    : `<span>${esc(contactPerson)}</span>`
                }
                ${contactPhone ? ' · <span class="mono" style="font-size:11px">' + esc(contactPhone) + '</span>' : ''}
              </span>
            </div>
            <div class="kv-row"><span class="kv-key" data-label="leads.capacity_mw">규모</span><span class="kv-val mono">${l.capacity_mw ? parseFloat(l.capacity_mw).toFixed(1) + ' MW' : '-'}</span></div>
            <div class="kv-row"><span class="kv-key" data-label="leads.expected_close_date">예상 마감일</span><span class="kv-val">${Fmt.date(l.expected_close_date)}</span></div>
            <div class="kv-row"><span class="kv-key" data-label="leads.bidding_deadline">입찰 마감일</span><span class="kv-val">${Fmt.date(l.bidding_deadline)}</span></div>
            <div class="kv-row"><span class="kv-key" data-label="leads.created_at">최초 등록</span><span class="kv-val">${Fmt.date(l.created_at)}</span></div>
            <div class="kv-row"><span class="kv-key" data-label="leads.updated_at">최근 업데이트</span><span class="kv-val">${Fmt.relTime(l.updated_at)}</span></div>
            ${contactEmail ? `<div class="kv-row"><span class="kv-key">고객 이메일</span><span class="kv-val mono" style="font-size:11px">${esc(contactEmail)}</span></div>` : ''}
          </div>

          ${
            l.notes
              ? `
            <div class="card mb-3">
              <div class="card-header"><div class="card-title">메모</div></div>
              <div class="card-body" style="white-space:pre-line;font-size:13px;line-height:1.6">${esc(l.notes)}</div>
            </div>
          `
              : ''
          }

          <!-- v6.0.0 Phase A: 통합 타임라인 (영업활동/회의록/견적/제안/계약/고객지원) -->
          <div class="card mb-3" id="ld-timeline-card">
            <div class="card-header" style="flex-wrap:wrap;gap:10px;align-items:center">
              <div class="card-title" style="margin-right:auto">
                📊 <span id="ld-timeline-title">활동 이력</span> <span id="ld-timeline-count" style="font-size:11px;color:var(--text-3);font-weight:400">(로딩 중...)</span>
              </div>
              <button class="btn btn-ghost btn-sm" id="ld-tl-sort"
                      title="정렬 방향 전환" style="font-size:12px">📅 최신순 ▼</button>
              <button class="btn btn-ghost btn-sm" id="ld-add-act" title="새 활동 추가">+ 활동</button>
              <button class="btn btn-ghost btn-sm" id="ld-add-support" title="고객지원 항목 추가">+ 지원</button>
            </div>
            <!-- 카테고리 칩 (필터) -->
            <div id="ld-tl-chips" style="display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 12px;border-bottom:1px solid var(--border)">
              <div class="loading" style="padding:6px;color:var(--text-3);font-size:11px">불러오는 중...</div>
            </div>
            <div class="card-body no-pad" id="ld-timeline-body">
              <div class="loading" style="padding:20px;text-align:center;color:var(--text-3);font-size:12px">⏳ 타임라인 로딩 중...</div>
            </div>
          </div>

          <!-- 📧 Gmail 대화 — lazy load (모달 열린 후 fetch) -->
          <div class="card mb-3" id="ld-gmail-card">
            <div class="card-header">
              <div class="card-title">📧 최근 Gmail 대화</div>
              <button class="btn btn-ghost btn-sm" id="ld-gmail-refresh" title="새로고침" style="display:none">🔄</button>
            </div>
            <div class="card-body no-pad" id="ld-gmail-body">
              <div class="loading" style="padding:14px;text-align:center;font-size:12px;color:var(--text-3)">Gmail 대화 로딩 중...</div>
            </div>
          </div>

          <!-- v6.0.0: 💬 검토 코멘트 (계약 모듈 패턴 통일) -->
          <div class="card mb-3">
            <div class="card-header">
              <div class="card-title">💬 검토 코멘트</div>
            </div>
            <div class="card-body">
              <div id="ld-comments-list" style="font-size:12px;margin-bottom:10px">
                <div class="loading" style="padding:10px;color:var(--text-3);text-align:center">불러오는 중...</div>
              </div>
              <div style="padding-top:10px;border-top:1px solid var(--border)">
                <div style="display:flex;gap:6px;align-items:flex-start;flex-wrap:wrap">
                  <select id="ld-comment-type" class="form-input" style="width:130px;font-size:12px">
                    <option value="general">💭 의견</option>
                    <option value="coach">🧭 코칭</option>
                    <option value="question">❓ 질문</option>
                    <option value="urgent">🚨 긴급</option>
                  </select>
                  <textarea id="ld-comment-body" class="form-input" rows="2"
                            placeholder="영업담당자에게 코멘트를 남기세요... (Ctrl+Enter 등록)"
                            style="flex:1;min-width:200px;font-size:12px"></textarea>
                  <button id="ld-comment-submit" type="button" class="btn btn-primary btn-sm">💬 등록</button>
                </div>
                <div style="font-size:10px;color:var(--text-3);margin-top:6px">
                  💡 등록 시 영업담당자 + 이전 댓글 참여자에게 알림 발송 (30초 디바운싱)
                </div>
              </div>
            </div>
          </div>
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
          '#ld-ai': () => {
            Modal.close();
            AI.summarizeLead(l.id, l.project_name);
          },
          '#ld-close': () => Modal.close(),
          '#ld-edit': () => {
            Modal.close();
            App.openLeadForm(l.id);
          },
          '#ld-email': () => {
            if (typeof Email !== 'undefined') {
              Email.open({
                to: contactEmail || '',
                customer: {
                  id: customerId,
                  name: l.customer_name,
                  email: contactEmail,
                  contact_person: contactPerson,
                },
                lead: {
                  id: l.id,
                  project_name: l.project_name,
                  customer_name: l.customer_name,
                  bidding_deadline: l.bidding_deadline,
                },
                defaultCategory: 'lead',
              });
            }
          },
          // ── 고객사/고객담당자 클릭 → 고객사 모달 ──
          '[data-cust-link]': e => {
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
          '[data-contact-link]': e => {
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
          '[data-assignee-link]': e => {
            e.preventDefault();
            Modal.close();
            setTimeout(() => App.navigate('team'), 100);
          },
          // 새 회의록 버튼 (회의록 있을 때만 렌더됨)
          '#ld-new-meeting': () => {
            Modal.close();
            App.navigate('meeting');
          },
          // 활동 → 캘린더 이동 (activity-item 행 클릭)
          '[data-act-cal]': e => {
            if (e.target.closest('[data-link-act]')) return; // 연결 버튼 클릭 시 무시
            const el = e.currentTarget;
            Modal.close();
            App.goToCalendarEvent(parseInt(el.dataset.actCal), el.dataset.actDate);
          },
          // 캘린더 연결 버튼
          '[data-link-act]': e => {
            e.stopPropagation();
            const el = e.currentTarget;
            App.openCalendarLinkPicker(
              parseInt(el.dataset.linkAct),
              l.id,
              el.dataset.actDate,
              l.id
            );
          },
          // 회의록 상세 이동
          '[data-meeting-detail]': e => {
            const mid = parseInt(e.currentTarget.dataset.meetingDetail);
            Modal.close();
            App.navigate('meeting-list');
            setTimeout(() => MeetingListPage.showDetail(mid), 400);
          },
          // v6.0.0: 댓글 등록 (계약 패턴 통일)
          '#ld-comment-submit': () => this._submitLeadComment(l.id),
          // v6.0.0 Phase A: 통합 타임라인 정렬 토글
          '#ld-tl-sort': () => this._toggleTimelineSort(l.id, l.customer_name),
          // 고객지원 항목 추가
          '#ld-add-support': () => this._openSupportForm(l.id),
        },
      });
      // 📧 Gmail 카드 lazy load — modal 렌더 후 비동기
      this._loadGmailForLead(l.id);
      // 💬 댓글 카드 lazy load (modal 렌더 후 비동기)
      this._loadLeadComments(l.id);
      // 📊 v6.0.0 Phase A: 통합 타임라인 lazy load (활동/회의/견적/제안/계약/지원 통합)
      this._loadTimeline(l.id, l.customer_name);
      // Ctrl+Enter 로 댓글 등록 (편의)
      const cBody = document.getElementById('ld-comment-body');
      if (cBody) {
        cBody.addEventListener('keydown', e => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            this._submitLeadComment(l.id);
          }
        });
      }
    } catch (err) {
      console.error(err);
    }
  },

  // ── v6.0.0: 영업리드 댓글 (계약 모듈 패턴 통일) ──────────
  // 타입 매핑 — 라이트한 일관성: 색상은 계약 모듈과 통일 (회색/주황/녹색/빨강)
  _leadCommentTypeMeta(type) {
    const MAP = {
      general: { label: '💭 의견', color: '#6b7280' },
      coach: { label: '🧭 코칭', color: '#16a34a' },
      question: { label: '❓ 질문', color: '#0891b2' },
      urgent: { label: '🚨 긴급', color: '#dc2626' },
    };
    return MAP[type] || MAP.general;
  },

  async _loadLeadComments(leadId) {
    const wrap = document.getElementById('ld-comments-list');
    if (!wrap) return;
    try {
      const r = await API.leads.comments.list(leadId);
      const comments = (r && r.data) || [];
      if (!comments.length) {
        wrap.innerHTML = `<div style="padding:14px;text-align:center;color:var(--text-3);font-size:12px">아직 등록된 댓글이 없습니다 — 첫 코멘트를 남겨보세요</div>`;
        return;
      }
      wrap.innerHTML = comments
        .map(c => {
          const t = this._leadCommentTypeMeta(c.comment_type);
          const author = c.author_name || c.author_email || '내부 작성자';
          const at = c.created_at ? Fmt.relTime(c.created_at) : '';
          return `<div style="padding:10px 12px;background:#fafafa;border-left:3px solid ${t.color};border-radius:4px;margin-bottom:6px">
            <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--text-3);margin-bottom:4px;flex-wrap:wrap;gap:6px">
              <span>
                <strong style="color:var(--text-1)">${esc(author)}</strong>
                <span style="display:inline-block;margin-left:6px;padding:1px 6px;background:${t.color};color:#fff;border-radius:8px;font-size:9px;font-weight:600">${esc(t.label)}</span>
              </span>
              <span title="${esc(c.created_at || '')}">${esc(at)}</span>
            </div>
            <div style="font-size:12px;white-space:pre-wrap;line-height:1.5;color:var(--text-1)">${esc(c.body)}</div>
          </div>`;
        })
        .join('');
    } catch (err) {
      wrap.innerHTML = `<div style="padding:10px;color:#dc2626;font-size:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px">댓글 조회 실패: ${esc(err?.message || err)}</div>`;
    }
  },

  async _submitLeadComment(leadId) {
    const bodyEl = document.getElementById('ld-comment-body');
    const typeEl = document.getElementById('ld-comment-type');
    const btn = document.getElementById('ld-comment-submit');
    if (!bodyEl) return;
    const text = (bodyEl.value || '').trim();
    if (!text) {
      Toast.error?.('댓글 내용을 입력하세요');
      bodyEl.focus();
      return;
    }
    const commentType = typeEl?.value || 'general';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳';
    }
    try {
      await API.leads.comments.create(leadId, { body: text, comment_type: commentType });
      Toast.success?.('댓글 등록됨 — 관련자에게 알림 발송 (30초 디바운싱)');
      bodyEl.value = '';
      this._loadLeadComments(leadId);
    } catch (err) {
      Toast.error?.('댓글 등록 실패: ' + (err?.message || err));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '💬 등록';
      }
    }
  },

  // ── v6.0.0 Phase A: 통합 타임라인 (활동/회의록/견적/제안/계약/고객지원) ────
  // 7개 카테고리 칩 + 정렬 토글 + 카운트 배지
  _tlState: {
    leadId: null,
    items: [], // 통합 타임라인 (전체)
    activeChip: 'all', // 'all'|'activity'|'meeting'|'quote'|'proposal'|'contract'|'support'
    sort: 'desc', // 'desc'(최신) | 'asc'(오래된)
  },

  // 카테고리 메타 (색상/라벨/아이콘) — 이미지 시안 칩 7개와 정렬
  _tlCategoryMeta() {
    return {
      all: { label: '전체', icon: '📋', color: '#ea580c', bg: '#fff7ed' },
      activity: { label: '영업활동', icon: '📌', color: '#86efac', bg: '#f0fdf4' },
      meeting: { label: '회의록', icon: '📝', color: '#4ade80', bg: '#dcfce7' },
      quote: { label: '견적', icon: '💰', color: '#16a34a', bg: '#dcfce7' },
      proposal: { label: '제안', icon: '📄', color: '#15803d', bg: '#bbf7d0' },
      contract: { label: '계약', icon: '📜', color: '#166534', bg: '#bbf7d0' },
      support: { label: '고객지원', icon: '🛟', color: '#475569', bg: '#f1f5f9' },
    };
  },

  // 영업활동 activity_type → 한글 라벨/아이콘 (기존 activityIcon 보완)
  _tlActivitySubLabel(actType) {
    const MAP = {
      미팅: '미팅',
      전화: '전화',
      이메일: '이메일',
      현장방문: '현장방문',
      영업방문: '영업방문',
      메모: '메모',
      입찰: '입찰',
      제안: '제안',
      수주: '수주',
      드롭: '드롭',
      stage_change: '단계변경',
      기타: '기타',
    };
    return MAP[actType] || actType || '활동';
  },

  // 6개 소스 병렬 fetch + merge + sort
  async _loadTimeline(leadId, customerName) {
    this._tlState.leadId = leadId;
    this._tlState.activeChip = 'all';
    this._tlState.sort = 'desc';

    const bodyEl = document.getElementById('ld-timeline-body');
    const chipsEl = document.getElementById('ld-tl-chips');
    if (!bodyEl) return;

    // 6개 소스 병렬 fetch (실패해도 best-effort)
    const [actsR, mtgR, qR, pR, cR, sR] = await Promise.allSettled([
      API.get(`/activities?lead_id=${leadId}&limit=200`),
      API.leads.get(leadId), // l.meetings 활용 (이미 로드됨)
      API.leads.quotes(leadId),
      API.leads.proposals(leadId),
      API.leads.contracts(leadId),
      API.leads.supports.list(leadId),
    ]);

    const merged = [];

    // 1) activities
    const acts = (actsR.value && actsR.value.data) || [];
    for (const a of acts) {
      merged.push({
        category: 'activity',
        sub: this._tlActivitySubLabel(a.activity_type),
        title: a.title || this._tlActivitySubLabel(a.activity_type),
        body: a.content || '',
        date: a.activity_date || a.performed_at || a.created_at,
        meta: a.performer_name || '',
        click: a.calendar_event_id
          ? { type: 'calendar', id: a.calendar_event_id, date: a.activity_date }
          : null,
        raw: a,
      });
    }

    // 2) meetings (l.meetings)
    const meetings = (mtgR.value && mtgR.value.data && mtgR.value.data.meetings) || [];
    for (const m of meetings) {
      const preview = (m.summary_md || '')
        .replace(/#{1,3}\s*/g, '')
        .replace(/\*\*/g, '')
        .replace(/\n+/g, ' ')
        .trim()
        .substring(0, 80);
      merged.push({
        category: 'meeting',
        sub: '회의록',
        title: m.title,
        body: preview,
        date: m.meeting_date || m.created_at,
        meta: m.customer_name || '',
        click: { type: 'meeting', id: m.id },
        raw: m,
      });
    }

    // 3) quotes
    const quotes = (qR.value && qR.value.data) || [];
    for (const q of quotes) {
      merged.push({
        category: 'quote',
        sub: `${q.quote_no || ''}${q.revision_no > 1 ? ` rev${q.revision_no}` : ''}`,
        title: q.name || '(견적명 없음)',
        body: q.total_amount
          ? `${Number(q.total_amount).toLocaleString('ko-KR')} KRW`
          : '',
        date: q.quote_date || q.created_at,
        meta: q.status || '',
        click: { type: 'quote', id: q.id },
        raw: q,
      });
    }

    // 4) proposals
    const proposals = (pR.value && pR.value.data) || [];
    for (const p of proposals) {
      merged.push({
        category: 'proposal',
        sub: p.proposal_no || '',
        title: p.proposal_title || '(제안명 없음)',
        body: p.expected_amount
          ? `예상 ${Number(p.expected_amount).toLocaleString('ko-KR')} ${p.currency || 'KRW'}`
          : '',
        date: p.proposal_date || p.created_at,
        meta: p.status || '',
        click: { type: 'proposal', id: p.id },
        raw: p,
      });
    }

    // 5) contracts
    const contracts = (cR.value && cR.value.data) || [];
    for (const c of contracts) {
      merged.push({
        category: 'contract',
        sub: c.contract_no || '',
        title: c.title || '(계약명 없음)',
        body: c.contract_amount
          ? `${Number(c.contract_amount).toLocaleString('ko-KR')} ${c.currency || 'KRW'}`
          : '',
        date: c.start_date || c.created_at,
        meta: c.status || '',
        click: { type: 'contract', id: c.id },
        raw: c,
      });
    }

    // 6) supports (고객지원)
    const supports = (sR.value && sR.value.data) || [];
    for (const s of supports) {
      merged.push({
        category: 'support',
        sub: s.support_type || 'general',
        title: s.title || '고객지원',
        body: s.body || '',
        date: s.created_at,
        meta: s.author_name || '',
        click: null,
        raw: s,
      });
    }

    this._tlState.items = merged;
    this._tlState.customerName = customerName;
    this._renderTimelineChips(chipsEl);
    this._renderTimelineBody(bodyEl);
  },

  _renderTimelineChips(chipsEl) {
    if (!chipsEl) return;
    const META = this._tlCategoryMeta();
    const items = this._tlState.items;
    // 카운트 집계
    const counts = { all: items.length };
    for (const it of items) counts[it.category] = (counts[it.category] || 0) + 1;
    const order = ['all', 'activity', 'meeting', 'quote', 'proposal', 'contract', 'support'];
    chipsEl.innerHTML = order
      .map(key => {
        const m = META[key];
        const cnt = counts[key] || 0;
        const isActive = this._tlState.activeChip === key;
        const bg = isActive ? m.color : m.bg;
        const fg = isActive ? '#fff' : m.color;
        const border = isActive ? m.color : 'transparent';
        const opacity = !isActive && cnt === 0 ? '0.45' : '1';
        return `<button type="button" class="ld-tl-chip" data-chip="${key}"
          style="display:inline-flex;align-items:center;gap:6px;padding:5px 12px;
                 border:1.5px solid ${border};border-radius:14px;background:${bg};
                 color:${fg};font-size:12px;font-weight:600;cursor:pointer;
                 transition:all .15s;opacity:${opacity}"
          ${cnt === 0 && key !== 'all' ? 'disabled' : ''}>
          ${m.icon} ${esc(m.label)}
          <span style="display:inline-block;padding:1px 6px;background:${isActive ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.08)'};
                       border-radius:8px;font-size:10px;font-weight:700">${cnt}</span>
        </button>`;
      })
      .join('');
    chipsEl.querySelectorAll('.ld-tl-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        this._tlState.activeChip = btn.dataset.chip;
        this._renderTimelineChips(chipsEl); // 활성 칩 재렌더
        this._renderTimelineBody(document.getElementById('ld-timeline-body'));
      });
    });
  },

  _renderTimelineBody(bodyEl) {
    if (!bodyEl) return;
    const META = this._tlCategoryMeta();
    let items = this._tlState.items.slice();
    if (this._tlState.activeChip !== 'all') {
      items = items.filter(it => it.category === this._tlState.activeChip);
    }
    // 정렬
    items.sort((a, b) => {
      const ta = new Date(a.date || 0).getTime();
      const tb = new Date(b.date || 0).getTime();
      return this._tlState.sort === 'desc' ? tb - ta : ta - tb;
    });

    // 카운트/타이틀 갱신
    const titleEl = document.getElementById('ld-timeline-title');
    const cntEl = document.getElementById('ld-timeline-count');
    if (titleEl) {
      const m = META[this._tlState.activeChip] || META.all;
      titleEl.textContent = m.label + ' 이력';
    }
    if (cntEl) cntEl.textContent = `(${items.length}건)`;

    if (!items.length) {
      bodyEl.innerHTML = `<div style="padding:30px;text-align:center;color:var(--text-3);font-size:12px">
        <div style="font-size:32px;margin-bottom:8px;opacity:0.4">📭</div>
        해당 카테고리의 이력이 없습니다
      </div>`;
      return;
    }

    bodyEl.innerHTML = items
      .map(it => {
        const m = META[it.category];
        const dateStr = it.date ? Fmt.relTime(it.date) : '';
        const dateFull = it.date ? String(it.date).slice(0, 16).replace('T', ' ') : '';
        const clickAttr = it.click
          ? `data-tl-click="${it.click.type}" data-tl-id="${it.click.id || ''}" data-tl-date="${it.click.date || ''}" style="cursor:pointer"`
          : '';
        return `<div class="ld-tl-row" ${clickAttr}
          style="display:flex;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);
                 align-items:flex-start;transition:background .12s">
          <!-- 색상 점 (카테고리) -->
          <div style="width:8px;height:8px;border-radius:50%;background:${m.color};margin-top:6px;flex-shrink:0"
               title="${esc(m.label)}"></div>
          <!-- 본문 -->
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px">
              <span style="font-size:12px;font-weight:600;color:var(--text-1)">${esc(it.title)}</span>
              <span style="display:inline-block;padding:1px 7px;background:${m.bg};color:${m.color};
                          border-radius:8px;font-size:10px;font-weight:600">${m.icon} ${esc(m.sub || it.sub || m.label)}</span>
              ${it.meta ? `<span style="font-size:10px;color:var(--text-3)">· ${esc(it.meta)}</span>` : ''}
            </div>
            ${it.body ? `<div style="font-size:11px;color:var(--text-2);line-height:1.5;white-space:pre-wrap">${esc(it.body)}</div>` : ''}
          </div>
          <!-- 날짜 -->
          <div style="font-size:10px;color:var(--text-3);flex-shrink:0;text-align:right" title="${esc(dateFull)}">${esc(dateStr)}</div>
        </div>`;
      })
      .join('');
    // hover 효과 + 클릭 핸들러
    bodyEl.querySelectorAll('.ld-tl-row').forEach(row => {
      row.addEventListener('mouseenter', () => {
        row.style.background = '#fafafa';
      });
      row.addEventListener('mouseleave', () => {
        row.style.background = '';
      });
      if (row.dataset.tlClick) {
        row.addEventListener('click', () => this._onTimelineClick(row.dataset));
      }
    });
  },

  _onTimelineClick(ds) {
    const type = ds.tlClick;
    const id = parseInt(ds.tlId, 10);
    if (!type || !id) return;
    if (type === 'calendar') {
      Modal.close();
      App.goToCalendarEvent(id, ds.tlDate);
    } else if (type === 'meeting') {
      Modal.close();
      App.navigate('meeting-list');
      setTimeout(() => MeetingListPage && MeetingListPage.showDetail?.(id), 400);
    } else if (type === 'quote') {
      Modal.close();
      App.navigate('quotes').then(() => {
        setTimeout(() => QuotesPage && QuotesPage._openModal?.(id), 300);
      });
    } else if (type === 'proposal') {
      Modal.close();
      App.navigate('proposals').then(() => {
        setTimeout(() => ProposalsPage && ProposalsPage._openModal?.(id), 300);
      });
    } else if (type === 'contract') {
      Modal.close();
      App.navigate('contracts').then(() => {
        setTimeout(() => ContractsPage && ContractsPage._openModal?.(id), 300);
      });
    }
  },

  _toggleTimelineSort(_leadId, _customerName) {
    this._tlState.sort = this._tlState.sort === 'desc' ? 'asc' : 'desc';
    const btn = document.getElementById('ld-tl-sort');
    if (btn) {
      btn.textContent =
        this._tlState.sort === 'desc' ? '📅 최신순 ▼' : '📅 오래된순 ▲';
    }
    this._renderTimelineBody(document.getElementById('ld-timeline-body'));
  },

  // 고객지원 항목 추가 모달 (간단)
  _openSupportForm(leadId) {
    Modal.open({
      title: '🛟 고객지원 항목 추가',
      compact: true,
      width: 540,
      body: `
        <form id="ld-sup-form" class="form-grid">
          <div class="form-row">
            <label class="form-label">유형</label>
            <select class="form-input" id="ld-sup-type">
              <option value="general">일반</option>
              <option value="inquiry">문의</option>
              <option value="complaint">컴플레인</option>
              <option value="followup">후속조치</option>
            </select>
          </div>
          <div class="form-row">
            <label class="form-label">제목 (선택)</label>
            <input class="form-input" id="ld-sup-title" placeholder="예: 납기 일정 문의 응대">
          </div>
          <div class="form-row">
            <label class="form-label required">내용</label>
            <textarea class="form-input" id="ld-sup-body" rows="4" placeholder="고객지원 상세 내용..."></textarea>
          </div>
        </form>
      `,
      footer: `
        <button class="btn btn-ghost" id="ld-sup-cancel">취소</button>
        <button class="btn btn-primary" id="ld-sup-save">💾 등록</button>
      `,
      bind: {
        '#ld-sup-cancel': () => Modal.close(),
        '#ld-sup-save': async () => {
          const type = document.getElementById('ld-sup-type').value;
          const title = document.getElementById('ld-sup-title').value.trim();
          const body = document.getElementById('ld-sup-body').value.trim();
          if (!body) {
            Toast.error('내용을 입력하세요');
            return;
          }
          try {
            await API.leads.supports.create(leadId, {
              support_type: type,
              title: title || null,
              body,
            });
            Toast.success('고객지원 항목 추가됨');
            Modal.close();
            // 리드 모달이 닫힌 상태이므로 다시 열어주기 (간단)
            setTimeout(() => this.openLeadDetail(leadId), 100);
          } catch (err) {
            Toast.error('등록 실패: ' + (err?.message || err));
          }
        },
      },
    });
  },

  // ── Gmail 메시지 카드 — 리드 모달용 (lazy) ────────────────
  async _loadGmailForLead(leadId) {
    const body = document.getElementById('ld-gmail-body');
    if (!body) return;
    try {
      const r = await API.gmail.matchLead(leadId, 8);
      this._renderGmailCard(body, r, () => this._loadGmailForLead(leadId));
    } catch (err) {
      // 401/403/500 등 — API 자체에서 던진 에러
      // FEATURE_DISABLED (클라이언트 가드) 도 _renderGmailCard 에서 분기 처리
      this._renderGmailCard(
        body,
        {
          success: false,
          error: err.message || 'Gmail 조회 실패',
          statusCode: err.status || 0,
          code: err.code,
          feature: err.feature,
        },
        () => this._loadGmailForLead(leadId)
      );
    }
  },

  // ── Gmail 카드 렌더 (lead/customer 공용) ───────────────────
  _renderGmailCard(bodyEl, res, retryFn) {
    const refreshBtn =
      document.getElementById('ld-gmail-refresh') || document.getElementById('cust-gmail-refresh');

    // 0) 기능 토글 OFF — Graceful Degradation (에러 X, 친절한 안내)
    if (res && res.code === 'FEATURE_DISABLED') {
      bodyEl.innerHTML = `<div class="feature-disabled-soft" style="padding:14px;font-size:12px;color:var(--text-3);text-align:center">
        📧 <strong>Gmail 기능이 비활성화 상태입니다</strong><br>
        <span style="font-size:11px">사용을 원하시면 관리자에게 문의하세요.</span>
      </div>`;
      if (refreshBtn) refreshBtn.style.display = 'none';
      return;
    }

    // 1) 미연결 / scope 부족 안내
    if (res && res.notConnected) {
      bodyEl.innerHTML = `<div style="padding:14px;font-size:12px;color:var(--text-3)">
        🔌 Google 계정이 연결되지 않았습니다 · 설정 > Google 연동에서 연결하세요.
      </div>`;
      if (refreshBtn) refreshBtn.style.display = 'none';
      return;
    }
    if (res && res.scopeRequired === 'gmail.readonly') {
      bodyEl.innerHTML = `<div style="padding:14px;font-size:12px;color:#92400e;background:#fff8f0">
        ⚠️ Gmail 권한이 없습니다 — 설정 > Google 연동에서 <b>재연결</b>해 권한을 추가하세요.
      </div>`;
      if (refreshBtn) refreshBtn.style.display = 'none';
      return;
    }
    if (!res || res.success === false) {
      bodyEl.innerHTML = `<div style="padding:14px;font-size:12px;color:var(--oci-red)">
        ⚠️ Gmail 조회 실패: ${esc(res?.error || '알 수 없는 오류')}
      </div>`;
      if (refreshBtn) refreshBtn.style.display = '';
      return;
    }

    // 2) contact_email 없음
    if (res.reason === 'no_contact_email') {
      bodyEl.innerHTML = `<div style="padding:14px;font-size:12px;color:var(--text-3)">
        ${esc(res.message || '고객 담당자 이메일이 등록되어 있지 않습니다.')}
      </div>`;
      if (refreshBtn) refreshBtn.style.display = 'none';
      return;
    }

    // 3) 결과 0건
    if (!res.data || !res.data.length) {
      bodyEl.innerHTML = `<div style="padding:14px;font-size:12px;color:var(--text-3)">
        📭 <span class="mono">${esc(res.email || '')}</span> 와의 Gmail 대화가 없습니다.
      </div>`;
      if (refreshBtn) refreshBtn.style.display = '';
      if (refreshBtn) refreshBtn.onclick = retryFn;
      return;
    }

    // 4) 메시지 목록
    bodyEl.innerHTML = `
      <div style="padding:8px 14px;font-size:11px;color:var(--text-3);border-bottom:1px solid var(--border)">
        매칭 이메일: <span class="mono">${esc(res.email)}</span> · ${res.count}건
      </div>
      ${res.data
        .map(m => {
          const dirIcon = m.direction === 'outbound' ? '📤' : '📥';
          const dirLabel = m.direction === 'outbound' ? '보냄' : '받음';
          const dirColor = m.direction === 'outbound' ? '#1664E5' : '#17A85A';
          const dateStr = m.date ? new Date(m.date).toLocaleString('ko-KR') : '';
          return `
          <a href="${esc(m.gmail_url)}" target="_blank" rel="noopener noreferrer"
             style="display:block;padding:10px 14px;border-bottom:1px solid var(--border);text-decoration:none;color:inherit"
             title="Gmail 에서 열기">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
              <span style="font-size:10px;font-weight:600;color:${dirColor};white-space:nowrap">${dirIcon} ${dirLabel}</span>
              <span style="font-size:13px;font-weight:500;color:var(--text-1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">
                ${esc(m.subject)}
              </span>
              <span style="font-size:10px;color:var(--text-3);white-space:nowrap">${esc(dateStr)}</span>
            </div>
            <div style="font-size:11px;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              ${esc(m.snippet)}
            </div>
          </a>
        `;
        })
        .join('')}
    `;
    if (refreshBtn) {
      refreshBtn.style.display = '';
      refreshBtn.onclick = retryFn;
    }
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
      note: '📝',
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

      const EVENT_ICONS = {
        미팅: '🤝',
        영업방문: '🏗',
        입찰: '📋',
        제안: '📄',
        내부: '🗂',
        기타: '📌',
      };
      const STATUS_LABEL = { planned: '계획', completed: '완료' };

      const listHtml = candidates.length
        ? candidates
            .map(c => {
              const dt = c.start_datetime
                ? String(c.start_datetime).slice(0, 16).replace('T', ' ')
                : '-';
              const ico = EVENT_ICONS[c.event_type] || '📌';
              const used = c.already_linked_act
                ? ' <span style="color:#bbb;font-size:10px">(이미 연결됨)</span>'
                : '';
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
            })
            .join('')
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
          '[data-clp-cal]': e => {
            const calId = parseInt(e.currentTarget.dataset.clpCal);
            App._doLinkActivity(activityId, calId, reopenLeadId);
          },
        },
      });
    } catch (e) {
      console.error(e);
      Toast.error('후보 일정을 불러오지 못했습니다');
    }
  },

  async _doLinkActivity(activityId, calEventId, reopenLeadId) {
    try {
      await API.activities.update(activityId, { calendar_event_id: calEventId });
      Toast.success('캘린더 일정과 연결되었습니다');
      Modal.close();
      if (reopenLeadId) setTimeout(() => this.openLeadDetail(reopenLeadId), 150);
    } catch {
      Toast.error('연결에 실패했습니다');
    }
  },

  openActivityForm(leadId, customerName = '') {
    Modal.close();
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const defaultDt = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:00`;
    setTimeout(() => {
      Modal.open({
        title:
          typeof Labels !== 'undefined'
            ? Labels.get('activities.modal_new', '활동 추가')
            : '활동 추가',
        width: 480,
        body: `
          <form id="activity-form" class="form-grid">
            <input type="hidden" name="lead_id" value="${leadId}">
            <input type="hidden" name="customer_name" value="${esc(customerName)}">
            <div class="form-row-2">
              <div class="form-row">
                <label class="form-label" data-label="activities.activity_type">활동 유형</label>
                <select class="form-input" name="activity_type" id="act-type-sel">
                  <option value="meeting"    data-label="activity_type.meeting">미팅</option>
                  <option value="call"       data-label="activity_type.call">전화</option>
                  <option value="email"      data-label="activity_type.email">이메일</option>
                  <option value="site_visit" data-label="activity_type.site_visit">현장방문</option>
                  <option value="proposal"   data-label="activity_type.proposal">제안</option>
                  <option value="note"       data-label="activity_type.note">메모</option>
                </select>
              </div>
              <div class="form-row">
                <label class="form-label" data-label="activities.status">활동 구분</label>
                <select class="form-input" name="status" id="act-status-sel">
                  <option value="planned" data-label="activities.status_planned">📌 계획</option>
                  <option value="done"    data-label="activities.status_done">✅ 완료</option>
                </select>
              </div>
            </div>
            <div class="form-row">
              <label class="form-label" data-label="activities.title">제목 *</label>
              <input class="form-input" name="title" required>
            </div>
            <div class="form-row">
              <label class="form-label" data-label="activities.activity_date">일시</label>
              <input class="form-input" type="datetime-local" name="activity_datetime" value="${defaultDt}">
            </div>
            <div class="form-row">
              <label class="form-label" data-label="activities.content">내용</label>
              <textarea class="form-input" name="content" rows="3"></textarea>
            </div>
            <div class="form-row">
              <label class="form-label" data-label="activities.performer_name">담당자</label>
              <select class="form-input" name="performed_by">
                <option value="">-</option>
                ${this.team.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}
              </select>
            </div>
            <div class="form-row" id="calendar-sync-row" style="align-items:center;gap:8px">
              <label class="form-label" style="margin:0" data-label="activities.sync_calendar">영업 캘린더 등록</label>
              <input type="checkbox" name="sync_calendar" id="sync-calendar-cb" checked style="width:16px;height:16px;cursor:pointer">
            </div>
          </form>
        `,
        footer: `
          <button class="btn btn-ghost" id="af-cancel" data-label="common.cancel">취소</button>
          <button class="btn btn-primary" id="af-save" data-label="common.register">등록</button>
        `,
        bind: {
          '#af-cancel': () => Modal.close(),
          '#af-save': () => App.saveActivity(leadId),
        },
        onOpen: () => {
          const sel = document.getElementById('act-type-sel');
          const statusSel = document.getElementById('act-status-sel');
          // 활동 유형 변경 시 캘린더 동기화 행 토글 + 활동 구분 자동 추천
          if (sel) {
            sel.addEventListener('change', () => {
              App._toggleCalendarSync(sel.value);
              // 메모·이메일·전화는 이미 발생한 사실 → 완료 / 그 외는 계획
              if (statusSel) {
                const auto =
                  sel.value === 'note' || sel.value === 'email' || sel.value === 'call'
                    ? 'done'
                    : 'planned';
                statusSel.value = auto;
              }
            });
          }
        },
      });
    }, 100);
  },

  _toggleCalendarSync(type) {
    const row = document.getElementById('calendar-sync-row');
    if (!row) return;
    // 메모·이메일은 캘린더 등록 불필요 — 숨김
    row.style.display = type === 'note' || type === 'email' ? 'none' : '';
  },

  async saveActivity(leadId) {
    const form = document.getElementById('activity-form');
    const fd = new FormData(form);
    const body = {};
    fd.forEach((v, k) => (body[k] = v || null));
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
        const typeToEvent = {
          meeting: '미팅',
          site_visit: '영업방문',
          proposal: '제안',
          call: '기타',
          bidding: '입찰',
        };
        const typeToColor = {
          meeting: '#3788d8',
          site_visit: '#28a745',
          proposal: '#fd7e14',
          call: '#6c757d',
          bidding: '#e63946',
        };
        const eventType = typeToEvent[body.activity_type] || '기타';
        const color = typeToColor[body.activity_type] || '#6c757d';
        const dt = activityDatetime.replace('T', ' ') + ':00';
        const endDt = (() => {
          const d = new Date(activityDatetime);
          d.setHours(d.getHours() + 1);
          const p = n => String(n).padStart(2, '0');
          return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:00`;
        })();
        try {
          // ② 캘린더 이벤트 생성 → calEventId 확보
          const calResult = await API.calendar.create({
            title: `[${eventType}] ${customerName ? customerName + ' ' : ''}${body.title}`,
            event_type: eventType,
            status: 'planned',
            start_datetime: dt,
            end_datetime: endDt,
            lead_id: leadId || null,
            customer_name: customerName || null,
            color,
          });
          const calId = calResult.id;

          // ③ 활동에 calendar_event_id 역방향 연결 (양방향성 완성)
          if (actId && calId) {
            await API.activities
              .update(actId, { calendar_event_id: calId })
              .catch(e => console.warn('calendar_event_id 역방향 연결 실패:', e));
          }
        } catch (calErr) {
          console.warn('캘린더 등록 실패:', calErr);
          Toast.error('활동은 저장됐으나 캘린더 등록에 실패했습니다');
        }
      }

      Toast.success(
        syncCalendar && activityDatetime ? '활동 추가 + 캘린더 등록 완료' : '활동이 추가되었습니다'
      );
      Modal.close();
      setTimeout(() => this.openLeadDetail(leadId), 150);
    } catch (err) {
      console.error(err);
    }
  },
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
    this.socket.onmessage = e => {
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
          const label =
            msg.stage === 'won'
              ? `🏆 수주 완료! ${msg.customer_name} - ${msg.project_name}`
              : `${msg.icon} ${msg.customer_name} → ${msg.stage_label}`;
          // 클릭 시 파이프라인 이동 + 리드 상세 열기
          const onClick = msg.lead_id
            ? () => {
                App.navigate('pipeline').then(() => {
                  if (msg.lead_id) App.openLeadDetail(msg.lead_id);
                });
              }
            : null;
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
      } catch (_) {
        /* malformed WS message, skip */
      }
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
  },
};

// ============================================================
// 기능 플래그 (Feature Flags) — 프론트엔드 헬퍼
// ============================================================
const Features = {
  _flags: {}, // { 'ai.assistant': true, 'auth.otp': false, ... }
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
      try {
        AI.close();
      } catch (_) {}
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
  },
};

// ============================================================
// 부팅
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  await App.init(); // Features.load() + apply()가 App.init() 내부에서 RBAC 이후 실행됨
  // realtime.ws 플래그가 ON일 때만 WebSocket 연결
  if (Features.isEnabled('realtime.ws')) WS.connect();
  UserPrefs.init();
});
