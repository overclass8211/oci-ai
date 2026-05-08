// ============================================================
// Utilities - 공통 유틸리티
// ============================================================

// ----------- 포맷 -----------
const Fmt = {
  // 금액 포맷 (단위: 억원 / 통화별)
  amount(value, currency = 'KRW') {
    if (value == null || value === '') return '-';
    const n = parseFloat(value);
    if (isNaN(n)) return '-';
    const symbols = { KRW: '₩', USD: '$', JPY: '¥', AUD: 'A$', CNY: '¥', VND: '₫', EUR: '€' };
    const sym = symbols[currency] || '';
    if (currency === 'KRW') return `${sym}${n.toFixed(1)}억`;
    if (currency === 'USD' && n >= 1000) return `${sym}${(n/1000).toFixed(1)}M`;
    if (currency === 'JPY' && n >= 1000) return `${sym}${(n/1000).toFixed(1)}B`;
    return `${sym}${n.toLocaleString()}`;
  },

  number(value) {
    if (value == null) return '-';
    return parseFloat(value).toLocaleString();
  },

  date(value) {
    if (!value) return '-';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '-';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  dateKor(value) {
    if (!value) return '-';
    const d = new Date(value);
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
  },

  relTime(value) {
    if (!value) return '-';
    const now = Date.now();
    const t = new Date(value).getTime();
    const diff = Math.floor((now - t) / 1000);
    if (diff < 60) return '방금 전';
    if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}일 전`;
    return Fmt.date(value);
  },

  pct(value) {
    if (value == null) return '-';
    return `${parseFloat(value).toFixed(1)}%`;
  },

  changeIcon(pct) {
    const p = parseFloat(pct);
    if (isNaN(p) || p === 0) return '<span class="text-muted">— 변동없음</span>';
    if (p > 0) return `<span class="metric-change up">▲ ${Math.abs(p).toFixed(2)}%</span>`;
    return `<span class="metric-change dn">▼ ${Math.abs(p).toFixed(2)}%</span>`;
  },

  daysLeft(date) {
    if (!date) return null;
    const d = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.ceil((d - today) / (1000 * 60 * 60 * 24));
    return diff;
  }
};

// ----------- 단계 메타 정보 -----------
const STAGES = {
  lead:        { label: '리드 발굴',  color: '#93B4F9' },
  review:      { label: '검토/미팅',  color: '#5585F5' },
  proposal:    { label: '제안/견적',  color: '#2357E8' },
  bidding:     { label: '입찰',       color: '#F59C00' },
  negotiation: { label: '협상/계약',  color: '#17A85A' },
  won:         { label: '수주 완료',  color: '#0F7A3F' },
  lost:        { label: '실주',       color: '#6B7280' },
  dropped:     { label: '드롭',       color: '#E63329' }
};

// 사업 유형 색상
const BUSINESS_COLORS = {
  태양광: 'badge-amber',
  모듈: 'badge-amber',
  EPC: 'badge-blue',
  ESS: 'badge-blue',
  전기: 'badge-purple',
  설치: 'badge-purple'
};

// ----------- 모달 -----------
const Modal = {
  open({ title, body, footer, width = 560 }) {
    const overlay = document.getElementById('modal-overlay');
    const box = document.getElementById('modal-box');
    box.style.maxWidth = width + 'px';
    box.innerHTML = `
      <div class="modal-header">
        <div class="modal-title">${title}</div>
        <button class="modal-close" onclick="Modal.close()">×</button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
    `;
    overlay.classList.add('active');
    overlay.onclick = (e) => { if (e.target === overlay) Modal.close(); };
  },
  close() {
    document.getElementById('modal-overlay').classList.remove('active');
  },
  confirm(message, onConfirm) {
    Modal.open({
      title: '확인',
      body: `<p style="font-size:13px;color:var(--text-2);line-height:1.6">${message}</p>`,
      footer: `
        <button class="btn btn-ghost" onclick="Modal.close()">취소</button>
        <button class="btn btn-primary" id="modal-confirm-btn">확인</button>
      `
    });
    document.getElementById('modal-confirm-btn').onclick = () => {
      Modal.close();
      onConfirm();
    };
  }
};

// ----------- 토스트 -----------
const Toast = {
  show(message, type = 'success') {
    const c = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    c.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.3s';
      setTimeout(() => el.remove(), 300);
    }, 2800);
  },
  success(msg) { Toast.show(msg, 'success'); },
  error(msg)   { Toast.show(msg, 'error'); },
  info(msg)    { Toast.show(msg, 'info'); }
};

// ----------- HTML 이스케이프 -----------
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================
// 사용자 환경 설정 (UserPrefs) — 세션 / 토큰 / 테마 / 폰트 / Idle
// ============================================================
const FONT_STEPS = [0.9, 1.0, 1.1, 1.2, 1.3];

const UserPrefs = {
  sessionStart: Date.now(),
  lastActivity: Date.now(),
  idleLimitMin: 0,        // 0 = 비활성화
  warningShownAt: 0,
  _sessionTimer: null,
  _tokenTimer: null,
  _idleTimer: null,

  async init() {
    this.applyTheme(localStorage.getItem('theme') || 'light');
    this.applyFontScale(parseFloat(localStorage.getItem('fontScale')) || 1);
    this.startSessionTimer();
    this.startTokenPolling();
    this.bindControls();
    this.bindActivityTracking();
    await this.loadIdlePolicy();
    this.startIdleWatcher();
  },

  bindControls() {
    const $theme = document.getElementById('theme-toggle');
    const $font  = document.getElementById('font-toggle');
    if ($theme) $theme.addEventListener('click', () => this.toggleTheme());
    if ($font)  $font.addEventListener('click', () => this.cycleFont());
  },

  // ── 세션 타이머 ────────────────────────────────────────────
  startSessionTimer() {
    if (this._sessionTimer) clearInterval(this._sessionTimer);
    const tick = () => {
      const el = document.getElementById('session-time');
      if (!el) return;
      const elapsed = Math.floor((Date.now() - this.sessionStart) / 1000);
      const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
      const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
      const s = String(elapsed % 60).padStart(2, '0');
      el.textContent = `${h}:${m}:${s}`;
    };
    tick();
    this._sessionTimer = setInterval(tick, 1000);
  },

  // ── 토큰 사용량 폴링 ──────────────────────────────────────
  async fetchTokenUsage() {
    const el = document.getElementById('token-count');
    if (!el) return;
    try {
      const r = await API.ai.usageToday();
      if (r.success) {
        const t = r.data.total;
        el.textContent = t >= 1000 ? `${(t / 1000).toFixed(1)}k` : String(t);
        const wrap = document.getElementById('token-widget');
        if (wrap) wrap.title = `오늘 사용 토큰: ${t.toLocaleString()} (요청 ${r.data.calls}회)`;
      }
    } catch (_) {}
  },

  startTokenPolling() {
    if (this._tokenTimer) clearInterval(this._tokenTimer);
    this.fetchTokenUsage();
    this._tokenTimer = setInterval(() => this.fetchTokenUsage(), 30000);
  },

  refreshTokens() { this.fetchTokenUsage(); },

  // ── 테마 ────────────────────────────────────────────────
  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    this.applyTheme(current === 'light' ? 'dark' : 'light');
  },

  applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    const icon = document.getElementById('theme-icon');
    if (icon) {
      icon.innerHTML = theme === 'dark'
        ? '<path d="M12 2.5A6.5 6.5 0 0 0 7 14a6.5 6.5 0 0 1-1-3.5A6.5 6.5 0 0 1 12.5 4 6.5 6.5 0 0 0 12 2.5z" fill="currentColor"/>'
        : '<circle cx="8" cy="8" r="3" fill="currentColor"/><path d="M8 1v2M8 13v2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M1 8h2M13 8h2M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/>';
    }
  },

  // ── 폰트 (단일 버튼 — 사이즈 사이클) ─────────────────────
  cycleFont() {
    const cur = parseFloat(localStorage.getItem('fontScale')) || 1;
    const idx = FONT_STEPS.findIndex(s => Math.abs(s - cur) < 0.01);
    const next = FONT_STEPS[(idx + 1) % FONT_STEPS.length];
    this.applyFontScale(next);
    Toast.info(`폰트 크기: ${Math.round(next * 100)}%`);
  },

  applyFontScale(scale) {
    // body zoom 으로 전체 UI 스케일링 (modern 브라우저 모두 지원)
    document.body.style.zoom = String(scale);
    localStorage.setItem('fontScale', String(scale));
    const label = document.getElementById('font-scale-label');
    if (label) label.textContent = `${Math.round(scale * 100)}%`;
  },

  // ── 활동 추적 ────────────────────────────────────────────
  bindActivityTracking() {
    const reset = () => { this.lastActivity = Date.now(); this.warningShownAt = 0; };
    ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'].forEach(evt => {
      document.addEventListener(evt, reset, { passive: true });
    });
  },

  // ── Idle 정책 로드 ───────────────────────────────────────
  async loadIdlePolicy() {
    try {
      const r = await API.get('/admin/settings');
      if (r.success && r.data) {
        this.idleLimitMin = parseInt(r.data.idle_timeout_min || 0);
      }
    } catch (_) { this.idleLimitMin = 0; }
  },

  // ── Idle 감지 — 매 5초 확인 ─────────────────────────────
  startIdleWatcher() {
    if (this._idleTimer) clearInterval(this._idleTimer);
    this._idleTimer = setInterval(() => this.checkIdle(), 5000);
  },

  checkIdle() {
    if (!this.idleLimitMin || this.idleLimitMin <= 0) return;
    const limitMs = this.idleLimitMin * 60 * 1000;
    const idleMs = Date.now() - this.lastActivity;

    // 만료 30초 전 경고
    if (idleMs >= limitMs - 30000 && idleMs < limitMs && !this.warningShownAt) {
      this.warningShownAt = Date.now();
      Toast.error(`30초 후 자동 로그아웃됩니다. 화면을 클릭하여 세션을 유지하세요.`);
    }

    // 만료
    if (idleMs >= limitMs) {
      clearInterval(this._idleTimer);
      this.showSessionExpired();
    }
  },

  showSessionExpired() {
    if (document.querySelector('.session-expired-overlay')) return;
    const overlay = document.createElement('div');
    overlay.className = 'session-expired-overlay';
    overlay.innerHTML = `
      <div class="session-expired-box">
        <div class="session-expired-icon">⏰</div>
        <div class="session-expired-title">세션이 만료되었습니다</div>
        <div class="session-expired-msg">
          ${this.idleLimitMin}분간 활동이 없어 자동 로그아웃되었습니다.<br>
          계속 사용하려면 다시 시작하세요.
        </div>
        <button class="btn btn-primary" onclick="location.reload()">다시 시작</button>
      </div>`;
    document.body.appendChild(overlay);
  },

  // 관리자 설정 변경 시 호출
  reloadIdlePolicy() { this.loadIdlePolicy(); }
};

// ----------- 디바운스 -----------
function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), ms);
  };
}
