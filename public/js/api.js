// ============================================================
// API Client - 백엔드 통신 모듈
// ============================================================
const API = {
  base: '/api',
  _refreshing: false,       // 중복 갱신 방지 플래그
  _refreshQueue: [],        // 갱신 대기 큐

  // ── Circuit Breaker: 기능 토글 OFF 시 네트워크 요청 차단 ───
  // 백엔드 featureGuard 가 어차피 403 차단하지만, 클라이언트에서 미리
  // 막아서 ① 불필요한 네트워크 트래픽 절약 ② 일관된 에러 처리 ③ 빠른 UI 응답
  _checkFeature(featureKey) {
    if (typeof Features !== 'undefined' && !Features.isEnabled(featureKey)) {
      const err = new Error(`이 기능은 현재 비활성화 상태입니다 (${featureKey})`);
      err.code = 'FEATURE_DISABLED';
      err.feature = featureKey;
      throw err;
    }
  },

  // ── Access Token 갱신 (Refresh Token 쿠키 사용) ─────────
  async _tryRefresh() {
    if (this._refreshing) {
      // 갱신 중이면 완료 대기
      return new Promise((resolve, reject) => this._refreshQueue.push({ resolve, reject }));
    }
    this._refreshing = true;
    try {
      const res  = await fetch(this.base + '/auth/refresh', {
        method: 'POST', credentials: 'include',   // 쿠키 자동 전송
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok || !data.success || !data.token) throw new Error('refresh_failed');

      // 새 Access Token 저장
      const storage = localStorage.getItem('oci_token') ? localStorage : sessionStorage;
      storage.setItem('oci_token', data.token);

      this._refreshQueue.forEach(p => p.resolve(data.token));
      return data.token;
    } catch (e) {
      this._refreshQueue.forEach(p => p.reject(e));
      throw e;
    } finally {
      this._refreshing = false;
      this._refreshQueue = [];
    }
  },

  async request(method, path, body = null, _isRetry = false) {
    const headers = { 'Content-Type': 'application/json' };
    const uid   = localStorage.getItem('current_user_id');
    const token = localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token');
    if (uid)   headers['X-User-Id']     = uid;
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const opts = { method, headers, credentials: 'include' };
    if (body) opts.body = JSON.stringify(body);
    try {
      const res  = await fetch(this.base + path, opts);
      const data = await res.json();

      // ── 401: Access Token 만료 → 자동 갱신 후 1회 재시도 ──
      if (res.status === 401 && (data.expired || data.revoked) && !_isRetry) {
        try {
          await this._tryRefresh();
          return this.request(method, path, body, true);  // 재시도
        } catch (_) {
          // 갱신 실패 → 로그인 페이지
          this._forceLogout();
          throw new Error('세션이 만료되었습니다. 다시 로그인하세요.');
        }
      }

      if (!data.success) {
        const err = new Error(data.message || data.error || 'API Error');
        Object.assign(err, data, { status: res.status });
        throw err;
      }
      return data;
    } catch (err) {
      if (!err.status) console.error(`API ${method} ${path}:`, err);
      if (!err.duplicate) Toast.error(err.message);
      throw err;
    }
  },

  _forceLogout() {
    localStorage.removeItem('oci_token');
    sessionStorage.removeItem('oci_token');
    localStorage.removeItem('current_user_id');
    window.location.href = '/login';
  },

  get(path)        { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  put(path, body)  { return this.request('PUT', path, body); },
  patch(path, body){ return this.request('PATCH', path, body); },
  del(path)        { return this.request('DELETE', path); },

  // 대시보드
  dashboard: {
    stats:      (year) => API.get(`/dashboard/stats${year ? '?year='+year : ''}`),
    funnel:     (year) => API.get(`/dashboard/funnel${year ? '?year='+year : ''}`),
    monthly:    (year, period) => { const p = new URLSearchParams(); if (year) p.set('year', year); if (period) p.set('period', period); const qs = p.toString(); return API.get('/dashboard/monthly' + (qs ? '?' + qs : '')); },
    activities: (year) => API.get(`/dashboard/activities${year ? '?year='+year : ''}`)
  },

  // 리드
  leads: {
    list:      (params = {}) => {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([_, v]) => v !== '' && v !== null && v !== undefined)
      ).toString();
      return API.get('/leads' + (qs ? '?' + qs : ''));
    },
    get:       (id) => API.get(`/leads/${id}`),
    create:    (body) => API.post('/leads', body),
    update:    (id, body) => API.put(`/leads/${id}`, body),
    setStage:  (id, stage) => API.patch(`/leads/${id}/stage`, { stage }),
    delete:    (id) => API.del(`/leads/${id}`)
  },

  // 상품/원가
  products: {
    list:    () => API.get('/products'),
    create:  (body) => API.post('/products', body),
    update:  (id, body) => API.put(`/products/${id}`, body),
    delete:  (id) => API.del(`/products/${id}`),
    history: (id) => API.get(`/products/${id}/history`)
  },

  // 프로젝트
  projects: {
    list:   () => API.get('/projects'),
    create: (body) => API.post('/projects', body),
    update: (id, body) => API.put(`/projects/${id}`, body),
    delete: (id) => API.del(`/projects/${id}`)
  },

  // 팀
  team: {
    list:   () => API.get('/team'),
    create: (body) => API.post('/team', body),
    update: (id, body) => API.put(`/team/${id}`, body),
    delete: (id) => API.del(`/team/${id}`)
  },

  // 고객사
  customers: {
    list:   () => API.get('/customers'),
    create: (body) => API.post('/customers', body),
    update: (id, body) => API.put(`/customers/${id}`, body),
    // 자동완성 (Smart Ranking 포함) — 캘린더 등에서 사용
    autocomplete: (q, limit = 10) =>
      API.get(`/customers?autocomplete=1&search=${encodeURIComponent(q)}&limit=${limit}`),
  },

  // 활동
  activities: {
    create: (body)        => API.post('/activities', body),
    update: (id, body)    => API.put(`/activities/${id}`, body),
    delete: (id)          => API.del(`/activities/${id}`)
  },

  // 알림 (crm.notifications 토글 가드)
  notifications: {
    list: () => {
      API._checkFeature('crm.notifications');
      return API.get('/notifications');
    },
  },

  // 캘린더
  calendar: {
    list:     (params = {}) => {
      const qs = new URLSearchParams(Object.entries(params).filter(([,v]) => v)).toString();
      return API.get('/calendar/events' + (qs ? '?' + qs : ''));
    },
    create:   (body)    => API.post('/calendar/events', body),
    update:   (id,body) => API.put(`/calendar/events/${id}`, body),
    delete:   (id)      => API.del(`/calendar/events/${id}`),
    seedDemo: ()        => API.post('/calendar/seed-demo', {}),
    // 제목 자동완성 (Step 2) — 과거 이벤트 + 고객사+동사 템플릿
    titleSuggestions: (q, limit = 8) =>
      API.get(`/calendar/title-suggestions?q=${encodeURIComponent(q)}&limit=${limit}`),
  },

  // 게시판
  board: {
    announcements: {
      list:   ()         => API.get('/board/announcements'),
      create: (body)     => API.post('/board/announcements', body),
      update: (id, body) => API.put(`/board/announcements/${id}`, body),
      delete: (id)       => API.del(`/board/announcements/${id}`)
    },
    comments: {
      list:   (refType, refId) => API.get(`/board/comments?ref_type=${refType}&ref_id=${refId}`),
      create: (body)           => API.post('/board/comments', body),
      delete: (id)             => API.del(`/board/comments/${id}`)
    },
    faq: {
      list:   ()     => API.get('/board/faq'),
      create: (body) => API.post('/board/faq', body),
      delete: (id)   => API.del(`/board/faq/${id}`)
    }
  },

  // 관리자
  admin: {
    stats:        ()             => API.get('/admin/stats'),
    logs:         (limit, offset)=> API.get(`/admin/access-logs?limit=${limit||100}&offset=${offset||0}`),
    clearLogs:    ()             => API.del('/admin/access-logs'),
    teamStats:    ()             => API.get('/admin/team-stats'),
    dailyLogs:    ()             => API.get('/admin/daily-logs'),
    topPaths:     ()             => API.get('/admin/top-paths'),
    getSettings:  ()             => API.get('/admin/settings'),
    saveSettings: (body)         => API.put('/admin/settings', body),
    tokenByUser:  ()             => API.get('/admin/token-usage-by-user'),
    setTokenLimit:(id, limit)    => API.patch(`/admin/team-members/${id}/token-limit`, { monthly_token_limit: limit }),
    // 토큰 모니터링
    tokenMonitor: (year, month)  => API.get(`/admin/token-monitor?year=${year||''}&month=${month||''}`),
    saveRechargeSettings: (id, body) => API.put(`/admin/token-recharge-settings/${id}`, body),
    manualRecharge: (id, amount) => API.post(`/admin/token-recharge/${id}`, { amount }),
  },

  // 회의록 (목록/조회는 자유, 생성/요약은 ai.meeting 가드)
  meetings: {
    list:   ()        => API.get('/meetings'),
    get:    (id)      => API.get(`/meetings/${id}`),
    create: (body)    => API.post('/meetings', body),
    delete: (id)      => API.del(`/meetings/${id}`),
    summarize: (body) => {
      API._checkFeature('ai.meeting');
      return API.post('/meeting/summarize', body);
    },
    registerCalendar: (id, body) => API.post(`/meetings/${id}/register-calendar`, body)
    // transcribe 는 multipart 라 fetch 직접 사용
  },

  // AI (각 기능별 토글 가드)
  ai: {
    insights: () => API.get('/ai/insights'),
    chat: (body) => {
      API._checkFeature('ai.assistant');
      return API.post('/ai/chat', body);
    },
    report: (type) => {
      API._checkFeature('ai.assistant');
      return API.post('/ai/report', { type });
    },
    meetingNotes: (body) => {
      API._checkFeature('ai.meeting');
      return API.post('/ai/meeting-notes', body);
    },
    usageToday: () => API.get('/ai/usage/today'),
  },

  // Google Meet 연동
  google: {
    status:       ()          => API.get('/google/status'),
    authUrl:      ()          => API.get('/google/auth-url'),
    disconnect:   ()          => API.del('/google/disconnect'),
    meet: {
      create: (body)          => API.post('/google/meet/create', body),
      list:   ()              => API.get('/google/meet/list'),
      linkMinutes: (id, body) => API.patch(`/google/meet/${id}/link-minutes`, body)
    }
  },

  // ── 로고 관리 ─────────────────────────────────────────────
  logo: {
    get:     ()      => API.get('/system/logo'),
    // upload 는 multipart — 별도 fetch 사용 (settings.js 에서 직접 호출)
    restore: ()      => API.del('/admin/logo'),
  },

  // ── 리포트 빌더 (crm.report_builder 가드) ───────────────────
  reportBuilder: {
    fields:     (datasource)    => { API._checkFeature('crm.report_builder'); return API.get('/report-builder/fields' + (datasource ? `?datasource=${encodeURIComponent(datasource)}` : '')); },
    query:      (config)        => { API._checkFeature('crm.report_builder'); return API.post('/report-builder/query', config); },
    listSaved:  ()              => { API._checkFeature('crm.report_builder'); return API.get('/report-builder/saved'); },
    getSaved:   (id)            => { API._checkFeature('crm.report_builder'); return API.get(`/report-builder/saved/${id}`); },
    save:       (data)          => { API._checkFeature('crm.report_builder'); return API.post('/report-builder/saved', data); },
    update:     (id, data)      => { API._checkFeature('crm.report_builder'); return API.put(`/report-builder/saved/${id}`, data); },
    delete:     (id)            => { API._checkFeature('crm.report_builder'); return API.del(`/report-builder/saved/${id}`); },
  },

  // ── Gmail (G1=gmail.read / G2=gmail.send / G3=gmail.sync) ──
  gmail: {
    scopeStatus: () => API.get('/gmail/scope-status'),  // OAuth 상태 확인은 가드 없음 (UI 분기용)
    messages: (email, limit = 10) => {
      API._checkFeature('gmail.read');
      return API.get(`/gmail/messages?email=${encodeURIComponent(email)}&limit=${limit}`);
    },
    matchLead: (id, limit = 10) => {
      API._checkFeature('gmail.read');
      return API.get(`/gmail/match/lead/${id}?limit=${limit}`);
    },
    matchCustomer: (id, limit = 10) => {
      API._checkFeature('gmail.read');
      return API.get(`/gmail/match/customer/${id}?limit=${limit}`);
    },
    send: (body) => {
      API._checkFeature('gmail.send');
      return API.post('/gmail/send', body);
    },
    // G3 — 자동 동기화
    syncSettings: () => API.get('/gmail/sync-settings'),  // 설정 조회는 가드 없음 (관리자가 켜기 위해 필요)
    setSync: (enabled) => API.put('/gmail/sync-settings', { enabled: !!enabled }),
    syncNow: () => {
      API._checkFeature('gmail.sync');
      return API.post('/gmail/sync-now');
    },
  },

  // ── 엑셀 다운로드 헬퍼 (인증 헤더 포함) — 레거시 ────────────────
  // downloadExport 가 이미 async 라 동일하게 Promise 반환됨
  downloadExcel(path, filename) {
    return this.downloadExport(path, filename, 'xlsx');
  },

  // ── 통합 다운로드 헬퍼 (xlsx/csv/json) ─────────────────────────
  // path 에 ?format= 이 이미 있으면 형식 무시, 없으면 자동 추가
  async downloadExport(path, filename, format = 'xlsx') {
    const fmt = ['xlsx', 'csv', 'json'].includes(format) ? format : 'xlsx';
    const sep = path.includes('?') ? '&' : '?';
    const finalPath = path.includes('format=') ? path : `${path}${sep}format=${fmt}`;
    const token = localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token');
    const uid   = localStorage.getItem('current_user_id');
    const headers = {};
    if (uid)   headers['X-User-Id']     = uid;
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const res = await fetch(this.base + finalPath, { headers });
      if (!res.ok) {
        const text = await res.text();
        let msg = res.status;
        try { msg = JSON.parse(text)?.message || msg; } catch (_) { /* ignore */ }
        Toast.error('다운로드 실패: ' + msg);
        return;
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement('a'), {
        href: url,
        download: filename + '.' + fmt,
      });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { Toast.error('다운로드 오류: ' + e.message); }
  },
};
