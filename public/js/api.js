// ============================================================
// API Client - 백엔드 통신 모듈
// ============================================================
const API = {
  base: '/api',

  async request(method, path, body = null) {
    const headers = { 'Content-Type': 'application/json' };
    const uid = localStorage.getItem('current_user_id');
    if (uid) headers['X-User-Id'] = uid;
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    try {
      const res = await fetch(this.base + path, opts);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'API Error');
      return data;
    } catch (err) {
      console.error(`API ${method} ${path}:`, err);
      Toast.error(err.message);
      throw err;
    }
  },

  get(path)        { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  put(path, body)  { return this.request('PUT', path, body); },
  patch(path, body){ return this.request('PATCH', path, body); },
  del(path)        { return this.request('DELETE', path); },

  // 대시보드
  dashboard: {
    stats:      () => API.get('/dashboard/stats'),
    funnel:     () => API.get('/dashboard/funnel'),
    monthly:    () => API.get('/dashboard/monthly'),
    activities: () => API.get('/dashboard/activities')
  },

  // 리드
  leads: {
    list:      (params = {}) => {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([_, v]) => v !== '' && v != null)
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
    update: (id, body) => API.put(`/customers/${id}`, body)
  },

  // 활동
  activities: {
    create: (body) => API.post('/activities', body)
  },

  // 알림
  notifications: {
    list: () => API.get('/notifications')
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
    seedDemo: ()        => API.post('/calendar/seed-demo', {})
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
    setTokenLimit:(id, limit)    => API.patch(`/admin/team-members/${id}/token-limit`, { monthly_token_limit: limit })
  },

  // 회의록
  meetings: {
    list:   ()        => API.get('/meetings'),
    get:    (id)      => API.get(`/meetings/${id}`),
    create: (body)    => API.post('/meetings', body),
    delete: (id)      => API.del(`/meetings/${id}`),
    summarize:        (body) => API.post('/meeting/summarize', body),
    registerCalendar: (id, body) => API.post(`/meetings/${id}/register-calendar`, body)
    // transcribe 는 multipart 라 fetch 직접 사용
  },

  // AI (스트리밍은 fetch 직접 사용, 여기선 non-streaming만)
  ai: {
    insights: () => API.get('/ai/insights'),
    chat:     (body) => API.post('/ai/chat', body),
    report:   (type) => API.post('/ai/report', { type }),
    meetingNotes: (body) => API.post('/ai/meeting-notes', body),
    usageToday:   () => API.get('/ai/usage/today')
  }
};
