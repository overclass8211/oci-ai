// =============================================================
// Onboarding — 첫 로그인 환영 모달 + 5단계 체크리스트
//
// 동작:
//   • 첫 로그인 감지 → 환영 모달 자동 표시
//   • 사용자가 "시작하기" 클릭 → localStorage 에 완료 플래그
//   • 사용자가 "다시 보지 않기" 클릭 → 동일하게 플래그
//   • 사용자 옵션: 우상단 사용자 메뉴에서 다시 열기 가능
//
// 외부 진입점:
//   Onboarding.maybeShow()    — 첫 로그인이면 자동 표시
//   Onboarding.show()         — 강제 표시
// =============================================================
'use strict';

const Onboarding = {
  FLAG_KEY: 'oci_onboarding_done',
  _initialized: false,

  STEPS: [
    {
      icon: '🏢',
      title: '1. 고객사 등록',
      desc: '거래처를 등록하세요. 명함을 스캔하면 AI 가 자동으로 정보를 추출합니다.',
      target: 'customers',
    },
    {
      icon: '🎯',
      title: '2. 영업 리드 추가',
      desc: '잠재 사업 기회를 리드로 등록하고 단계 (검토 → 제안 → 입찰 → 수주) 를 관리하세요.',
      target: 'leads',
    },
    {
      icon: '📅',
      title: '3. 미팅 일정 등록',
      desc: '입찰 마감일과 미팅을 캘린더에 추가하면 자동 알림이 갑니다.',
      target: 'calendar',
    },
    {
      icon: '🎙️',
      title: '4. AI 회의록 활용',
      desc: '미팅 녹음을 업로드하면 AI 가 요약 + 액션 아이템을 자동 추출합니다.',
      target: 'meeting',
    },
    {
      icon: '📊',
      title: '5. 대시보드로 분석',
      desc: '리드 · 매출 · 팀 실적을 대시보드에서 한눈에 확인하세요.',
      target: 'dashboard',
    },
  ],

  // 첫 로그인 자동 표시 진입점
  maybeShow() {
    try {
      if (localStorage.getItem(this.FLAG_KEY)) return; // 이미 완료
      // 모달 인프라가 준비된 후 표시 (다음 프레임)
      requestAnimationFrame(() => {
        if (typeof Modal === 'undefined') return;
        this.show();
      });
    } catch (_) { /* localStorage 차단 시 무시 */ }
  },

  show() {
    if (typeof Modal === 'undefined') return;

    Modal.open({
      title: '🎉 OCI CRM에 오신 것을 환영합니다',
      width: 640,
      body: this._buildBody(),
      footer: `
        <button class="btn btn-ghost" id="onb-skip">다시 보지 않기</button>
        <button class="btn btn-primary" id="onb-start">시작하기</button>
      `,
      bind: {
        '#onb-skip':  () => { this._markDone(); Modal.close(); },
        '#onb-start': () => { this._markDone(); Modal.close(); this._gotoFirst(); },
        '[data-onb-goto]': (e) => {
          const tgt = e.currentTarget.dataset.onbGoto;
          this._markDone();
          Modal.close();
          if (typeof App !== 'undefined' && App.navigate) App.navigate(tgt);
        },
      },
    });
  },

  _buildBody() {
    return `
      <div class="onboarding-intro">
        <p style="margin:0 0 8px;font-size:13px;color:var(--text-2);line-height:1.7">
          영업 활동의 시작부터 분석까지, <strong>5단계로 빠르게 시작</strong>해 보세요.<br>
          각 항목을 클릭하면 해당 페이지로 이동합니다.
        </p>
      </div>
      <div class="onboarding-steps">
        ${this.STEPS.map(s => `
          <button class="onboarding-step" data-onb-goto="${this._esc(s.target)}"
                  type="button">
            <span class="onboarding-step-icon">${this._esc(s.icon)}</span>
            <div class="onboarding-step-text">
              <div class="onboarding-step-title">${this._esc(s.title)}</div>
              <div class="onboarding-step-desc">${this._esc(s.desc)}</div>
            </div>
            <span class="onboarding-step-arrow">→</span>
          </button>
        `).join('')}
      </div>
      <div class="onboarding-tips">
        💡 단축키: <kbd>?</kbd> 도움말 · <kbd>N</kbd> 새 리드 · <kbd>/</kbd> 검색 · <kbd>Ctrl+K</kbd> 통합 검색
      </div>
    `;
  },

  _markDone() {
    try { localStorage.setItem(this.FLAG_KEY, String(Date.now())); }
    catch (_) { /* ignore */ }
  },

  _gotoFirst() {
    if (typeof App !== 'undefined' && App.navigate && App.pages?.customers) {
      App.navigate('customers');
    }
  },

  // 사용자 요청으로 다시 보기 — 플래그 초기화 후 표시
  reset() {
    try { localStorage.removeItem(this.FLAG_KEY); }
    catch (_) { /* ignore */ }
    this.show();
  },

  _esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },
};
