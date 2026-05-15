// ============================================================
// Developer Options Page
// — 기능 토글, DFD 시각화, DB 스키마, 성능 모니터, JWT 인스펙터
// ============================================================
const DevPage = {
  activeTab: 'features',
  features:  [],
  schema:    {},
  perfData:  null,
  dfdSelected: null,   // 현재 선택된 DFD 노드

  // ─── Schema Map 상태 ────────────────────────────────────
  schemaMap: {
    visible:   false,          // 연관도 표시 중?
    editMode:  false,          // 편집 모드?
    positions: {},             // { tableName: {x,y} }
    transform: { x:0, y:0, scale:1 },
    fks:       [],             // FK 목록 (schema-relations API)
    indexes:   {},             // { tableName: [{INDEX_NAME,COLUMN_NAME,NON_UNIQUE}] }
    _lastSnap: null,           // 마지막 스냅샷 (변경 감지용)
    _driftTables:   new Set(), // 변경 감지된 테이블 목록 (붉은 하이라이트)
    _pendingChanges: [],       // WS로 수신된 미적용 변경 내역
    _wsConnected:   false,     // WebSocket 연결 상태
    _dragNode: null,           // { el, startMX, startMY, origX, origY, scale }
    _panning:  false,
    _panStart: null,           // { mx, my, tx, ty }
  },

  // ─── DFD 정적 데이터 정의 ────────────────────────────────
  DFD: {
    pages: [
      { id: 'pg-dashboard',  label: '대시보드',      icon: '📊' },
      { id: 'pg-pipeline',   label: '파이프라인',    icon: '🔄' },
      { id: 'pg-leads',      label: '영업 리드',     icon: '📋' },
      { id: 'pg-customers',  label: '고객사',        icon: '🏢' },
      { id: 'pg-calendar',   label: '캘린더',        icon: '📅' },
      { id: 'pg-meeting',    label: '회의록 AI',     icon: '🎙️' },
      { id: 'pg-projects',   label: '프로젝트',      icon: '🏗️' },
      { id: 'pg-team',       label: '팀 현황',       icon: '👥' },
      { id: 'pg-reports',    label: '리포트',        icon: '📈' },
      { id: 'pg-board',      label: '게시판',        icon: '📢' },
      { id: 'pg-admin',      label: '관리자',        icon: '⚙️' },
    ],
    apis: [
      { id: 'api-leads',         label: '/api/leads',         method: 'CRUD' },
      { id: 'api-customers',     label: '/api/customers',     method: 'CRUD' },
      { id: 'api-activities',    label: '/api/activities',    method: 'CRUD' },
      { id: 'api-dashboard',     label: '/api/dashboard',     method: 'GET'  },
      { id: 'api-calendar',      label: '/api/calendar',      method: 'CRUD' },
      { id: 'api-meeting',       label: '/api/meeting',       method: 'CRUD' },
      { id: 'api-projects',      label: '/api/projects',      method: 'CRUD' },
      { id: 'api-team',          label: '/api/team',          method: 'CRUD' },
      { id: 'api-ai',            label: '/api/ai',            method: 'POST' },
      { id: 'api-board',         label: '/api/board',         method: 'CRUD' },
      { id: 'api-auth',          label: '/api/auth',          method: 'POST' },
      { id: 'api-admin',         label: '/api/admin',         method: 'CRUD' },
      { id: 'api-notifications', label: '/api/notifications', method: 'GET'  },
      { id: 'api-products',      label: '/api/products',      method: 'CRUD' },
      { id: 'api-google',        label: '/api/google',        method: 'GET'  },
    ],
    tables: [
      // ── Core CRM (9) ─────────────────────────────────────
      { id: 'tbl-leads',               label: 'leads',               cols: ['id','customer_id','project_name','stage','expected_amount','currency','assigned_to','bidding_deadline'] },
      { id: 'tbl-customers',           label: 'customers',           cols: ['id','name','region','country','industry','contact_person','phone','email'] },
      { id: 'tbl-activities',          label: 'activities',          cols: ['id','lead_id','project_id','activity_type','title','performed_by','performed_at'] },
      { id: 'tbl-projects',            label: 'projects',            cols: ['id','name','customer_id','status','due_date','assigned_to','lead_id'] },
      { id: 'tbl-team',                label: 'team_members',        cols: ['id','name','role','team','email','monthly_token_limit','is_active'] },
      { id: 'tbl-calendar',            label: 'calendar_events',     cols: ['id','title','event_type','start_datetime','lead_id','assigned_to','status'] },
      { id: 'tbl-meetings',            label: 'meeting_minutes',     cols: ['id','title','meeting_date','raw_transcript','summary_md','customer_name','lead_id'] },
      { id: 'tbl-products',            label: 'products',            cols: ['id','name','category','unit','current_price','currency','change_pct'] },
      { id: 'tbl-cost-history',        label: 'cost_history',        cols: ['id','product_id','price','recorded_at','notes'] },
      // ── Board (4) ────────────────────────────────────────
      { id: 'tbl-announcements',       label: 'announcements',       cols: ['id','title','content','is_pinned','created_by','created_at'] },
      { id: 'tbl-announcement-views',  label: 'announcement_views',  cols: ['announcement_id','viewer_id','viewed_at'] },
      { id: 'tbl-comments',            label: 'comments',            cols: ['id','ref_type','ref_id','content','author_name','created_at'] },
      { id: 'tbl-faq',                 label: 'faq',                 cols: ['id','question','answer','category','created_at'] },
      // ── Auth (3) ─────────────────────────────────────────
      { id: 'tbl-users',               label: 'users',               cols: ['id','username','full_name','email','role','is_active','otp_enabled'] },
      { id: 'tbl-refresh-tokens',      label: 'refresh_tokens',      cols: ['id','user_id','token_hash','jti','expires_at','revoked'] },
      { id: 'tbl-token-blacklist',     label: 'token_blacklist',     cols: ['jti','user_id','expires_at','reason'] },
      // ── AI / Admin (5) ───────────────────────────────────
      { id: 'tbl-ai-usage',            label: 'ai_usage',            cols: ['id','user_id','endpoint','prompt_tokens','completion_tokens','total_tokens','model'] },
      { id: 'tbl-token-recharge',      label: 'token_recharge_log',  cols: ['id','user_id','recharge_amount','new_limit','reason','triggered_by'] },
      { id: 'tbl-dev-features',        label: 'dev_features',        cols: ['id','feature_key','feature_name','category','is_enabled','is_experimental'] },
      { id: 'tbl-system-settings',     label: 'system_settings',     cols: ['setting_key','setting_value','updated_at'] },
      { id: 'tbl-access-logs',         label: 'access_logs',         cols: ['id','method','path','status_code','duration_ms','ip','created_at'] },
      // ── Google (2) ───────────────────────────────────────
      { id: 'tbl-google-tokens',       label: 'google_oauth_tokens', cols: ['user_id','access_token','refresh_token','expiry_date','google_email'] },
      { id: 'tbl-google-meet',         label: 'google_meet_sessions',cols: ['id','user_id','meet_link','title','scheduled_at','duration_min'] },
    ],
    // Page → API 연결
    p2a: [
      ['pg-dashboard','api-dashboard'],['pg-dashboard','api-leads'],['pg-dashboard','api-ai'],['pg-dashboard','api-notifications'],
      ['pg-pipeline','api-leads'],
      ['pg-leads','api-leads'],['pg-leads','api-activities'],['pg-leads','api-team'],['pg-leads','api-customers'],['pg-leads','api-calendar'],
      ['pg-customers','api-customers'],['pg-customers','api-leads'],['pg-customers','api-ai'],
      ['pg-calendar','api-calendar'],['pg-calendar','api-leads'],
      ['pg-meeting','api-meeting'],['pg-meeting','api-ai'],['pg-meeting','api-google'],['pg-meeting','api-leads'],['pg-meeting','api-calendar'],
      ['pg-projects','api-projects'],['pg-projects','api-leads'],
      ['pg-team','api-team'],
      ['pg-reports','api-dashboard'],['pg-reports','api-leads'],['pg-reports','api-ai'],
      ['pg-board','api-board'],
      ['pg-admin','api-admin'],['pg-admin','api-auth'],['pg-admin','api-ai'],['pg-admin','api-team'],['pg-admin','api-products'],
    ],
    // API → Table 연결
    a2t: [
      ['api-leads','tbl-leads'],['api-leads','tbl-activities'],['api-leads','tbl-team'],['api-leads','tbl-customers'],
      ['api-customers','tbl-customers'],['api-customers','tbl-leads'],
      ['api-activities','tbl-activities'],['api-activities','tbl-calendar'],['api-activities','tbl-team'],
      ['api-dashboard','tbl-leads'],['api-dashboard','tbl-activities'],['api-dashboard','tbl-team'],
      ['api-calendar','tbl-calendar'],['api-calendar','tbl-leads'],['api-calendar','tbl-activities'],
      ['api-meeting','tbl-meetings'],['api-meeting','tbl-leads'],['api-meeting','tbl-calendar'],
      ['api-projects','tbl-projects'],['api-projects','tbl-leads'],
      ['api-team','tbl-team'],
      ['api-ai','tbl-ai-usage'],
      ['api-board','tbl-announcements'],['api-board','tbl-announcement-views'],['api-board','tbl-comments'],['api-board','tbl-faq'],
      ['api-auth','tbl-users'],['api-auth','tbl-refresh-tokens'],['api-auth','tbl-token-blacklist'],['api-auth','tbl-dev-features'],
      ['api-admin','tbl-users'],['api-admin','tbl-access-logs'],['api-admin','tbl-ai-usage'],['api-admin','tbl-team'],
      ['api-admin','tbl-dev-features'],['api-admin','tbl-system-settings'],['api-admin','tbl-token-recharge'],['api-admin','tbl-announcement-views'],
      ['api-notifications','tbl-leads'],['api-notifications','tbl-calendar'],['api-notifications','tbl-activities'],['api-notifications','tbl-meetings'],
      ['api-products','tbl-products'],['api-products','tbl-cost-history'],
      ['api-google','tbl-google-tokens'],['api-google','tbl-google-meet'],['api-google','tbl-calendar'],
    ],
    // ── 외부 서비스 (3rd-party) ──────────────────────────────
    external: [
      // 지도 / 주소
      { id: 'ext-kakao-maps',     label: '카카오맵 SDK',     category: 'map',     icon: '🗺️', url: 'dapi.kakao.com' },
      { id: 'ext-kakao-postcode', label: '카카오 우편번호',   category: 'map',     icon: '📍', url: 'postcode.map.kakao.com' },
      // 환율
      { id: 'ext-frankfurter',    label: 'Frankfurter (ECB)', category: 'fx',      icon: '💱', url: 'api.frankfurter.app' },
      { id: 'ext-korea-exim',     label: '한국수출입은행',     category: 'fx',      icon: '🏦', url: 'oapi.koreaexim.go.kr' },
      // AI
      { id: 'ext-gemini',         label: 'Google Gemini AI', category: 'ai',      icon: '🤖', url: 'generativelanguage.googleapis.com' },
      // Google
      { id: 'ext-google-oauth',   label: 'Google OAuth',     category: 'auth',    icon: '🔐', url: 'oauth2.googleapis.com' },
      { id: 'ext-google-cal',     label: 'Google Calendar',  category: 'calendar',icon: '📅', url: 'googleapis.com/calendar' },
      { id: 'ext-google-meet',    label: 'Google Meet',      category: 'meeting', icon: '🎥', url: 'meet.google.com' },
      // CDN 라이브러리
      { id: 'ext-cdn-chartjs',    label: 'Chart.js',          category: 'cdn',     icon: '📊', url: 'cdnjs.cloudflare.com (chart.js)' },
      { id: 'ext-cdn-fullcal',    label: 'FullCalendar',      category: 'cdn',     icon: '📆', url: 'cdn.jsdelivr.net (fullcalendar)' },
      { id: 'ext-cdn-quill',      label: 'Quill 에디터',       category: 'cdn',     icon: '✍️', url: 'cdn.jsdelivr.net (quill)' },
      { id: 'ext-cdn-pptxgenjs',  label: 'pptxgenjs',         category: 'cdn',     icon: '📃', url: 'unpkg.com (pptxgenjs)' },
      { id: 'ext-cdn-sortable',   label: 'Sortable.js',       category: 'cdn',     icon: '↕️', url: 'cdn.jsdelivr.net (sortable)' },
      { id: 'ext-cdn-fonts',      label: 'Google Fonts',      category: 'cdn',     icon: '🔤', url: 'fonts.googleapis.com' },
    ],
    // ── API → 외부 서비스 매핑 ────────────────────────────────
    a2e: [
      ['api-exchange',  'ext-frankfurter'],
      ['api-exchange',  'ext-korea-exim'],
      ['api-ai',        'ext-gemini'],
      ['api-auth',      'ext-google-oauth'],
      ['api-google',    'ext-google-oauth'],
      ['api-google',    'ext-google-cal'],
      ['api-google',    'ext-google-meet'],
      ['api-meeting',   'ext-google-meet'],
      ['api-customers', 'ext-kakao-postcode'],
      ['api-customers', 'ext-kakao-maps'],
    ],
  },

  // 추가 제안 기능 목록
  PROPOSALS: [
    {
      icon: '🔬', title: 'DB 라이브 쿼리 콘솔', status: 'planned',
      desc: '읽기 전용 SQL을 UI에서 직접 실행. 결과를 테이블/JSON으로 표시. 프로덕션에선 SELECT만 허용.',
      impact: '고', effort: '중'
    },
    {
      icon: '⚡', title: '목 데이터 자동 생성기', status: 'planned',
      desc: '엔티티별 Faker 기반 테스트 데이터 대량 삽입/정리 기능. 스테이징 환경 세팅 자동화.',
      impact: '고', effort: '중'
    },
    {
      icon: '📡', title: 'API 엔드포인트 라이브 테스터', status: 'planned',
      desc: 'Swagger 없이 브라우저에서 직접 API 호출, 헤더·바디 설정, 응답 확인.',
      impact: '고', effort: '낮'
    },
    {
      icon: '🔐', title: 'JWT 토큰 인스펙터 (현재 구현됨)', status: 'done',
      desc: '임의 JWT 붙여넣기 → Header/Payload/Signature 디코딩 및 만료 시간 확인.',
      impact: '중', effort: '낮'
    },
    {
      icon: '📊', title: '실시간 에러 스트림 (SSE)', status: 'planned',
      desc: '서버 에러 로그를 SSE로 브라우저에 실시간 스트리밍. 4xx/5xx 분류 및 알림.',
      impact: '고', effort: '중'
    },
    {
      icon: '🗺️', title: 'DFD Impact Analyzer (현재 구현됨)', status: 'done',
      desc: '컬럼/테이블 변경 시 영향받는 API·화면을 DFD 그래프에서 하이라이트.',
      impact: '매우 고', effort: '고'
    },
    {
      icon: '🏎️', title: 'DB 슬로우 쿼리 감지기', status: 'planned',
      desc: 'access_logs 기반 응답시간 이상 탐지, N+1 쿼리 패턴 경고, 인덱스 사용 분석.',
      impact: '고', effort: '고'
    },
    {
      icon: '🎭', title: '롤 시뮬레이터', status: 'planned',
      desc: 'superadmin이 다른 역할(manager/team_lead 등)로 UI를 미리보기. RBAC 검증에 유용.',
      impact: '중', effort: '낮'
    },
    {
      icon: '🔄', title: '스키마 마이그레이션 트래커', status: 'planned',
      desc: '테이블 스키마 변경 이력을 자동 감지하고 버전 관리. Spring Boot 전환 준비에 필수.',
      impact: '고', effort: '고'
    },
    {
      icon: '📦', title: 'i18n/다국어 관리 패널', status: 'planned',
      desc: '한국어/영어 텍스트를 UI에서 관리. 글로벌 확장 시 번역 키-값 CRUD.',
      impact: '중', effort: '중'
    },
  ],

  // ─── 테이블/컬럼 한글 이름 맵 ───────────────────────────
  TABLE_KO: {
    leads:'영업 리드', customers:'고객사', activities:'활동 이력',
    projects:'프로젝트', team_members:'팀 멤버', calendar_events:'캘린더',
    meeting_minutes:'회의록', products:'제품/원가', cost_history:'원가 이력',
    announcements:'공지사항', announcement_views:'공지 열람', comments:'댓글',
    faq:'FAQ', users:'사용자', refresh_tokens:'Refresh 토큰',
    token_blacklist:'블랙리스트', ai_usage:'AI 사용량',
    token_recharge_log:'토큰 충전', dev_features:'기능 플래그',
    system_settings:'시스템 설정', access_logs:'접근 로그',
    google_oauth_tokens:'Google OAuth', google_meet_sessions:'Google Meet',
  },

  COLUMN_KO: {
    id:'식별자', created_at:'생성일', updated_at:'수정일', deleted_at:'삭제일',
    user_id:'사용자ID', lead_id:'리드ID', customer_id:'고객사ID',
    project_id:'프로젝트ID', assigned_to:'담당자', created_by:'작성자',
    name:'이름', title:'제목', content:'내용', description:'설명',
    status:'상태', stage:'영업단계', type:'유형', category:'분류',
    email:'이메일', phone:'전화번호', region:'지역', country:'국가',
    industry:'업종', is_active:'활성여부', is_pinned:'고정여부',
    is_enabled:'활성', is_experimental:'실험적',
    start_datetime:'시작일시', end_datetime:'종료일시', meeting_date:'회의일',
    performed_at:'수행일시', bidding_deadline:'입찰마감',
    expected_amount:'예상금액', currency:'통화',
    prompt_tokens:'프롬프트 토큰', completion_tokens:'완성 토큰',
    total_tokens:'총 토큰', model:'모델명',
    token_hash:'토큰해시', jti:'JTI', expires_at:'만료일',
    revoked:'무효화', reason:'사유', ip:'IP주소',
    method:'HTTP메서드', path:'경로', status_code:'상태코드',
    duration_ms:'처리시간(ms)', action:'액션',
    feature_key:'기능키', feature_name:'기능명',
    setting_key:'설정키', setting_value:'설정값',
    recharge_amount:'충전량', new_limit:'새한도', triggered_by:'트리거',
    meet_link:'미팅링크', scheduled_at:'예약일시', duration_min:'시간(분)',
    google_email:'Google이메일', access_token:'액세스토큰',
    refresh_token:'리프레시토큰', expiry_date:'만료일시',
    audio_filename:'오디오파일', summary_md:'요약(MD)',
    raw_transcript:'원본텍스트', customer_name:'고객명',
    current_price:'현재가격', unit:'단위', change_pct:'변동률',
    recorded_at:'기록일', notes:'메모', contact_person:'담당자명',
    otp_secret:'OTP시크릿', otp_enabled:'OTP활성',
    webauthn_cred_id:'WebAuthn ID', last_login:'최근로그인',
    department:'부서', avatar_url:'아바타URL', full_name:'성명',
    username:'사용자명', password_hash:'비밀번호해시', role:'역할',
    monthly_token_limit:'월토큰한도', team:'팀',
    ref_type:'참조유형', ref_id:'참조ID', author_name:'작성자명',
    question:'질문', answer:'답변', announcement_id:'공지ID',
    viewer_id:'열람자ID', viewed_at:'열람일',
    affects_routes:'관련라우트', affects_tables:'관련테이블',
    product_id:'제품ID', price:'가격', color:'색상', recurrence:'반복',
    all_day:'종일', event_type:'이벤트유형', calendar_event_id:'캘린더ID',
    audio_duration_sec:'오디오시간(초)', speakers_json:'발화자JSON',
    agenda:'안건', key_points:'핵심내용', action_items:'액션아이템',
    address:'주소',
  },

  // 테이블별 컬럼 한글명 오버라이드 — 같은 컬럼명이라도 테이블 맥락에 따라 다름
  COLUMN_KO_BY_TABLE: {
    customers: { name:'고객사명' },
    leads:     { name:'프로젝트명', stage:'영업단계' },
    products:  { name:'제품명' },
    projects:  { name:'프로젝트명' },
    team_members: { name:'팀원명', email:'이메일', phone:'전화번호' },
    users:     { name:'성명' },
    activities:{ title:'활동제목', type:'활동유형' },
    pipeline_stages: { label:'단계명' },
  },

  // 헬퍼 — 테이블별 매핑 우선, 없으면 글로벌
  _getColKo(tableName, colName) {
    return (this.COLUMN_KO_BY_TABLE?.[tableName]?.[colName])
        || this.COLUMN_KO[colName]
        || '';
  },

  // ─── 렌더 ────────────────────────────────────────────────
  async render() {
    document.getElementById('content').innerHTML = `
      <div class="dev-options-wrap">
        <!-- 헤더 -->
        <div class="dev-header">
          <div>
            <div class="dev-title">🛠️ Developer Options</div>
            <div class="dev-subtitle">기능 플래그 제어 · 데이터 흐름 시각화 · DB 스키마 · 성능 분석 · 개발 도구</div>
          </div>
          <span class="dev-badge">SUPERADMIN ONLY</span>
        </div>

        <!-- 탭 -->
        <div class="dev-tabs" id="dev-tab-bar">
          <button class="dev-tab active" data-tab="features">⚙️ 기능 토글</button>
          <button class="dev-tab" data-tab="dfd">🗺️ DFD 시각화</button>
          <button class="dev-tab" data-tab="schema">🗄️ DB 스키마</button>
          <button class="dev-tab" data-tab="apidocs">📡 API 관리</button>
          <button class="dev-tab" data-tab="perf">📡 성능 모니터</button>
          <button class="dev-tab" data-tab="jwt">🔐 JWT 인스펙터</button>
          <button class="dev-tab" data-tab="roadmap">🚀 개발 로드맵</button>
        </div>

        <!-- 탭 컨텐츠 -->
        <div id="dev-content">
          <div class="loading" style="padding:60px;text-align:center">로딩 중...</div>
        </div>
      </div>
    `;

    this._bindTabs();
    await this.loadFeatures();
    this.switchTab('features');
  },

  _bindTabs() {
    document.getElementById('dev-tab-bar').addEventListener('click', e => {
      const btn = e.target.closest('[data-tab]');
      if (!btn) return;
      document.querySelectorAll('.dev-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      this.switchTab(btn.dataset.tab);
    });
  },

  async switchTab(tab) {
    this.activeTab = tab;
    const el = document.getElementById('dev-content');
    el.innerHTML = '<div class="loading" style="padding:60px;text-align:center">로딩 중...</div>';

    if (tab === 'features') { await this.loadFeatures(); this.renderFeatures(); }
    else if (tab === 'dfd')  { this.renderDFD(); }
    else if (tab === 'schema') { await this.loadSchema(); this.renderSchema(); }
    else if (tab === 'apidocs') { await this.renderApiDocs(); }
    else if (tab === 'perf')   { await this.loadPerf(); this.renderPerf(); }
    else if (tab === 'jwt')    { this.renderJWT(); }
    else if (tab === 'roadmap'){ this.renderRoadmap(); }
  },

  // ══════════════════════════════════════════════════════════
  // TAB: API 관리 (OpenAPI 통합 뷰)
  // ══════════════════════════════════════════════════════════
  async renderApiDocs() {
    const el = document.getElementById('dev-content');
    try {
      const [opsR, covR] = await Promise.all([
        API.get('/admin/dev/openapi/operations'),
        API.get('/admin/dev/openapi/coverage'),
      ]);
      this._apiOps = opsR.data;
      this._apiCov = covR.data;
    } catch (e) {
      el.innerHTML = `<div class="empty" style="padding:40px;text-align:center;color:var(--text-3)">불러오기 실패: ${esc(e.message || '')}</div>`;
      return;
    }

    const { operations, by_tag, total, documented_count } = this._apiOps;
    const { coverage, totals } = this._apiCov;

    // 메서드별 색상 클래스
    const tagSections = Object.entries(by_tag).map(([tag, ops]) => `
      <details class="apidoc-tag-section" open>
        <summary>
          <span class="apidoc-tag-name">${esc(tag)}</span>
          <span class="apidoc-tag-count">${ops.length}개</span>
          <span class="apidoc-tag-doc">${ops.filter(o=>o.documented).length}/${ops.length} 문서화</span>
        </summary>
        <div class="apidoc-op-list">
          ${ops.map(op => `
            <div class="apidoc-op ${op.documented ? 'is-documented' : 'is-stub'}"
                 data-method="${esc(op.method)}" data-path="${esc(op.path)}"
                 title="${op.documented ? '문서화됨' : '미문서화 — JSDoc 또는 openapi.js 에 정의 필요'}">
              <span class="apidoc-method ${op.method.toLowerCase()}">${op.method}</span>
              <span class="apidoc-path">${esc(op.full_path)}</span>
              <span class="apidoc-summary">${esc(op.summary)}</span>
              ${op.documented ? '<span class="apidoc-doc-badge">📄</span>' : '<span class="apidoc-stub-badge">⚠</span>'}
            </div>
          `).join('')}
        </div>
      </details>
    `).join('');

    const coverageColor = coverage >= 80 ? '#10b981' : coverage >= 50 ? '#f59e0b' : '#ef4444';

    el.innerHTML = `
      <div class="dev-section-header">
        <div>
          <h3 style="margin:0;font-size:15px">📡 API 관리 — OpenAPI 통합 뷰</h3>
          <p style="margin:4px 0 0;font-size:12px;color:var(--text-3)">
            ${total}개 엔드포인트 · 문서화 ${documented_count}/${total}
            <span class="apidoc-coverage-pill" style="background:${coverageColor}22;color:${coverageColor};border-color:${coverageColor}55">
              ${coverage}% 커버리지
            </span>
          </p>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <input type="text" id="apidoc-search" class="search-input" style="width:220px" placeholder="🔍 method/path/summary 검색...">
          <div class="apidoc-download-group">
            <button class="btn btn-secondary btn-sm" id="apidoc-dl-json" title="OpenAPI JSON 다운로드">📄 JSON</button>
            <button class="btn btn-secondary btn-sm" id="apidoc-dl-html" title="단일 HTML 파일로 다운로드 (Phase 3)">🌐 HTML</button>
            <button class="btn btn-secondary btn-sm" id="apidoc-dl-pdf" title="PDF 다운로드 (Phase 3)">📕 PDF</button>
          </div>
        </div>
      </div>

      <!-- 통계 카드 -->
      <div class="apidoc-stats-grid">
        <div class="apidoc-stat">
          <div class="apidoc-stat-label">총 엔드포인트</div>
          <div class="apidoc-stat-value">${total}</div>
        </div>
        <div class="apidoc-stat">
          <div class="apidoc-stat-label">문서화 완료</div>
          <div class="apidoc-stat-value" style="color:#10b981">${documented_count}</div>
        </div>
        <div class="apidoc-stat">
          <div class="apidoc-stat-label">미문서화</div>
          <div class="apidoc-stat-value" style="color:#f59e0b">${totals.undocumented}</div>
        </div>
        <div class="apidoc-stat">
          <div class="apidoc-stat-label">Stale (문서만 있음)</div>
          <div class="apidoc-stat-value" style="color:#ef4444">${totals.stale}</div>
        </div>
      </div>

      <!-- 태그별 섹션 -->
      <div class="apidoc-list">
        ${tagSections}
      </div>
    `;

    this._bindApiDocsEvents(operations);
  },

  _bindApiDocsEvents(operations) {
    const opsByKey = {};
    operations.forEach(op => { opsByKey[`${op.method} ${op.path}`] = op; });

    // 검색 필터
    const search = document.getElementById('apidoc-search');
    search?.addEventListener('input', () => {
      const q = search.value.toLowerCase();
      document.querySelectorAll('.apidoc-op').forEach(el => {
        const matches = !q || el.textContent.toLowerCase().includes(q);
        el.style.display = matches ? '' : 'none';
      });
    });

    // operation 클릭 → 상세 모달
    document.querySelectorAll('.apidoc-op').forEach(el => {
      el.addEventListener('click', () => {
        const key = `${el.dataset.method} ${el.dataset.path}`;
        const op = opsByKey[key];
        if (op) this._showOperationDetail(op);
      });
    });

    // 다운로드 버튼
    document.getElementById('apidoc-dl-json')?.addEventListener('click', () => {
      window.open('/api/admin/dev/openapi/spec', '_blank');
    });
    document.getElementById('apidoc-dl-html')?.addEventListener('click', () => {
      window.open('/api/admin/dev/openapi/export/html', '_blank');
    });
    document.getElementById('apidoc-dl-pdf')?.addEventListener('click', () => {
      Toast.info('PDF 다운로드는 HTML 페이지에서 "PDF로 저장" (Ctrl+P) 을 사용하세요.');
      window.open('/api/admin/dev/openapi/export/html', '_blank');
    });
  },

  _showOperationDetail(op) {
    // Swagger UI 스타일 상세 (재구현)
    const security = op.security && op.security.length > 0 ? '🔒 인증 필요' : '🌐 공개';
    const docBadge = op.documented
      ? '<span class="apidoc-doc-badge">📄 문서화 완료</span>'
      : '<span class="apidoc-stub-badge">⚠ 미문서화 — JSDoc 추가 권장</span>';
    Modal.open({
      title: `<span class="apidoc-method ${op.method.toLowerCase()}">${op.method}</span> ${esc(op.full_path)}`,
      compact: true,
      width: 760,
      confirmOnClose: false,
      body: `
        <div class="apidoc-detail">
          <div class="apidoc-detail-meta">
            <div><strong>태그:</strong> ${esc(op.tag)}</div>
            <div><strong>보안:</strong> ${security}</div>
            <div><strong>상태:</strong> ${docBadge}</div>
          </div>
          <div class="apidoc-detail-section">
            <div class="apidoc-section-label">요약</div>
            <div class="apidoc-section-content">${op.summary || '<span style="color:var(--text-3)">(없음)</span>'}</div>
          </div>
          ${op.description ? `
          <div class="apidoc-detail-section">
            <div class="apidoc-section-label">설명</div>
            <div class="apidoc-section-content">${esc(op.description)}</div>
          </div>` : ''}
          ${op.documented ? '' : `
          <div class="apidoc-detail-section">
            <div class="apidoc-section-label">⚠️ 미문서화 경고</div>
            <div class="apidoc-section-content" style="font-size:12px;color:var(--text-2)">
              이 엔드포인트는 OpenAPI 스펙에 정의되어 있지 않습니다.<br>
              <code>src/docs/openapi.js</code> 에 다음 형식으로 추가하세요:
              <pre class="apidoc-code-example">'${esc(op.path)}': {
  ${op.method.toLowerCase()}: {
    tags: ['${esc(op.tag)}'],
    summary: '...',
    responses: { 200: { description: '...' } }
  }
}</pre>
            </div>
          </div>`}
          <div class="apidoc-detail-section">
            <div class="apidoc-section-label">DFD 연관</div>
            <div class="apidoc-section-content" style="font-size:12px;color:var(--text-2)">
              💡 이 API 의 호출 페이지와 사용 테이블은 <strong>DFD 시각화</strong> 탭에서 확인하세요.
              (Phase 4 에서 양방향 자동 연동 예정)
            </div>
          </div>
        </div>
      `,
      footer: `<button class="btn btn-primary" id="apidoc-detail-close">닫기</button>`,
      bind: { '#apidoc-detail-close': () => Modal.close() },
    });
  },

  // ══════════════════════════════════════════════════════════
  // TAB 1: 기능 토글
  // ══════════════════════════════════════════════════════════
  async loadFeatures() {
    try {
      const r = await API.get('/admin/dev/features');
      this.features = r.data || [];
    } catch (e) { this.features = []; }
  },

  renderFeatures() {
    const categories = {
      ai:          { label: '🤖 AI 기능',        color: '#7C4DFF' },
      auth:        { label: '🔐 인증 & 보안',    color: '#E63329' },
      realtime:    { label: '📡 실시간',          color: '#17A85A' },
      crm:         { label: '📋 CRM 기능',        color: '#1664E5' },
      integration: { label: '🔌 외부 연동',       color: '#F59C00' },
      data:        { label: '📊 데이터 처리',     color: '#0F7A3F' },
      security:    { label: '🛡️ 보안 정책',      color: '#6B7280' },
      dev:         { label: '🛠️ 개발자 도구',    color: '#8B5CF6' },
    };

    const grouped = {};
    this.features.forEach(f => {
      if (!grouped[f.category]) grouped[f.category] = [];
      grouped[f.category].push(f);
    });

    const html = `
      <div class="dev-section-header">
        <div>
          <h3 style="margin:0;font-size:15px">서비스 기능 플래그</h3>
          <p style="margin:4px 0 0;font-size:12px;color:var(--text-3)">
            UI 레벨에서 기능을 즉시 ON/OFF합니다. 변경사항은 DB에 저장되며 전체 사용자에게 즉시 반영됩니다.
          </p>
        </div>
        <!-- id="feat-stats": 토글 후 실시간 업데이트 -->
        <div id="feat-stats" style="font-size:12px;color:var(--text-3)">
          활성: <strong style="color:#17A85A">${this.features.filter(f=>f.is_enabled).length}</strong>
          / 비활성: <strong style="color:#E63329">${this.features.filter(f=>!f.is_enabled).length}</strong>
          / 전체: <strong>${this.features.length}</strong>
        </div>
      </div>

      <div class="dev-feature-grid">
        ${Object.entries(grouped).map(([cat, list]) => {
          const meta = categories[cat] || { label: cat, color: '#888' };
          return `
            <div class="dev-cat-block">
              <div class="dev-cat-title" style="border-left:3px solid ${meta.color}">
                ${meta.label}
              </div>
              ${list.map(f => `
                <div class="dev-feature-row ${f.is_enabled ? '' : 'disabled'}" data-fkey="${f.feature_key}">
                  <div class="dev-feature-info">
                    <div class="dev-feature-name">
                      ${esc(f.feature_name)}
                      ${f.is_experimental ? '<span class="dev-badge-exp">실험적</span>' : ''}
                    </div>
                    <div class="dev-feature-desc">${esc(f.description || '')}</div>
                    <div class="dev-feature-meta">
                      ${f.affects_routes ? `<span class="dev-chip blue">API: ${esc(f.affects_routes)}</span>` : ''}
                      ${f.affects_tables ? `<span class="dev-chip green">Table: ${esc(f.affects_tables)}</span>` : ''}
                    </div>
                  </div>
                  <label class="dev-toggle" title="${f.is_enabled ? 'ON — 클릭하여 비활성화' : 'OFF — 클릭하여 활성화'}">
                    <input type="checkbox" ${f.is_enabled ? 'checked' : ''} data-feature="${f.feature_key}">
                    <span class="dev-toggle-slider"></span>
                  </label>
                </div>
              `).join('')}
            </div>
          `;
        }).join('')}
      </div>
    `;

    const container = document.getElementById('dev-content');
    container.innerHTML = html;

    // ── Bug Fix #1: 중복 이벤트 리스너 방지 ──────────────────
    // 탭 전환 시 #dev-content의 innerHTML만 교체되고 element 자체는 유지됨.
    // 기존 리스너를 제거하지 않으면 탭 재방문마다 리스너가 누적되어
    // 토글 1번에 API N번 호출되는 버그 발생.
    if (this._featChangeHandler) {
      container.removeEventListener('change', this._featChangeHandler);
    }

    this._featChangeHandler = async e => {
      const inp = e.target.closest('input[data-feature]');
      if (!inp) return;
      const key     = inp.dataset.feature;
      const enabled = inp.checked;
      const row     = inp.closest('.dev-feature-row');
      const label   = inp.closest('.dev-toggle');

      // 처리 중 시각적 피드백
      inp.disabled       = true;
      row.style.opacity  = '0.65';

      try {
        await API.put(`/admin/dev/features/${key}`, { is_enabled: enabled });

        // 행 스타일 업데이트
        row.classList.toggle('disabled', !enabled);

        // Bug Fix #2: title 속성 동기화 (hover 툴팁)
        if (label) {
          label.title = enabled ? 'ON — 클릭하여 비활성화' : 'OFF — 클릭하여 활성화';
        }

        // this.features 캐시 업데이트
        const feat = this.features.find(f => f.feature_key === key);
        if (feat) feat.is_enabled = enabled ? 1 : 0;

        // 전역 기능 플래그 즉시 동기화 → DOM 반영 (페이지 새로고침 없이 적용)
        if (typeof Features !== 'undefined') {
          Features._flags[key] = !!enabled;
          Features.apply();
        }

        // Bug Fix #3: 통계 카운터 실시간 업데이트
        const active   = this.features.filter(f => f.is_enabled).length;
        const inactive = this.features.filter(f => !f.is_enabled).length;
        const statsEl  = document.getElementById('feat-stats');
        if (statsEl) {
          statsEl.innerHTML =
            `활성: <strong style="color:#17A85A">${active}</strong>` +
            ` / 비활성: <strong style="color:#E63329">${inactive}</strong>` +
            ` / 전체: <strong>${this.features.length}</strong>`;
        }

        Toast.success(`${enabled ? '✅ 활성화' : '⏹️ 비활성화'}: ${key}`);
      } catch (_err) {
        inp.checked = !enabled;  // 시각적 롤백
        Toast.error('변경에 실패했습니다');
      }

      inp.disabled      = false;
      row.style.opacity = '';
    };

    container.addEventListener('change', this._featChangeHandler);
  },

  // ══════════════════════════════════════════════════════════
  // TAB 2: DFD 시각화
  // ══════════════════════════════════════════════════════════
  async renderDFD() {
    // ── 1) 라이브 데이터 일괄 fetch (스키마 + 모든 매핑/무시 + 라우트) ──
    let liveTables = {};
    let dbMappings = [];     // 테이블 매핑
    let dismissed = [];      // 테이블 무시
    let registeredRoutes = []; // 서버 등록 API 라우트
    let apiMappings = [];    // API 매핑 (API → 페이지)
    let apiDismissed = [];   // API 무시
    let fetchFailed = false;
    try {
      const [r1, r2, r3, r4, r5, r6, r7, r8, r9, r10] = await Promise.all([
        API.get('/admin/dev/schema'),
        API.get('/admin/dev/dfd-mappings').catch(() => ({ data: [] })),
        API.get('/admin/dev/dfd-dismissed').catch(() => ({ data: [] })),
        API.get('/admin/dev/registered-routes').catch(() => ({ data: { routes: [] } })),
        API.get('/admin/dev/dfd-api-mappings').catch(() => ({ data: [] })),
        API.get('/admin/dev/dfd-api-dismissed').catch(() => ({ data: [] })),
        API.get('/admin/dev/external-deps').catch(() => ({ data: { discovered: [] } })),
        API.get('/admin/dev/registered-pages').catch(() => ({ data: { pages: [] } })),
        API.get('/admin/dev/dfd-page-mappings').catch(() => ({ data: [] })),
        API.get('/admin/dev/dfd-page-dismissed').catch(() => ({ data: [] })),
      ]);
      liveTables = r1.data || {};
      dbMappings = r2.data || [];
      dismissed = r3.data || [];
      registeredRoutes = r4.data?.routes || [];
      apiMappings = r5.data || [];
      apiDismissed = r6.data || [];
      this._externalDeps = r7.data?.discovered || [];
      this._registeredPages = r8.data?.pages || [];
      this._pageMappings = r9.data || [];
      this._pageDismissed = r10.data || [];
    } catch (_) {
      fetchFailed = true;
    }
    const dbMappingByTable = {};
    dbMappings.forEach(m => { dbMappingByTable[m.table_name] = m.api_keys || []; });
    const dismissedSet = new Set(dismissed.map(d => d.table_name));
    const apiMappingByApi = {};
    apiMappings.forEach(m => { apiMappingByApi[m.api_id] = m.page_keys || []; });
    const apiDismissedSet = new Set(apiDismissed.map(d => d.api_id));

    // ── 2) DFD 정적 카탈로그와 라이브 테이블 병합 ────────────────
    // 카탈로그에 있는 테이블 = 기존 a2t 매핑 보존
    // DB에만 있는 테이블 = "📌 미분류" 로 자동 추가 (라이브 컬럼 사용)
    const catalogByLabel = {};
    this.DFD.tables.forEach(t => { catalogByLabel[t.label] = t; });

    const liveTableNames = Object.keys(liveTables).sort();
    const liveTableSet = new Set(liveTableNames);
    const mergedTables = [];
    const uncategorized = [];

    // 카탈로그 순서대로 표시 (의미론 그룹 보존)
    this.DFD.tables.forEach(t => {
      if (liveTableSet.has(t.label)) mergedTables.push(t);
      // DB 에 없는 카탈로그 항목은 표시 안 함 (stale)
    });

    // DB 동적 a2t 매핑 (영향도 분석에서 사용)
    const dynamicA2T = [];
    const trulyNew = [];      // 매핑 없음 + 무시 안 됨 = 신규 알림 대상
    const dismissedList = []; // 매핑 없음 + 무시됨 = 조용히 표시

    // DB 에만 있는 테이블 자동 추가
    liveTableNames.forEach(name => {
      if (catalogByLabel[name]) return;
      const cols = (liveTables[name].columns || [])
        .slice(0, 6)
        .map(c => c.COLUMN_NAME);
      const id = 'tbl-auto-' + name.replace(/_/g, '-');
      const dbApis = dbMappingByTable[name];
      const isMapped = Array.isArray(dbApis) && dbApis.length > 0;
      const isDismissed = dismissedSet.has(name);
      const entry = {
        id, label: name, cols,
        _uncategorized: !isMapped,
        _dynamicMapped: isMapped,    // DB 매핑된 항목 (수정/제거 가능)
        _dismissed: isDismissed && !isMapped,  // 무시됨 (매핑 없는 경우에만)
        _trulyNew: !isMapped && !isDismissed,  // 신규 (매핑도 무시도 안 됨)
        _dbApis: dbApis || [],
      };
      mergedTables.push(entry);
      if (isMapped) {
        dbApis.forEach(apiId => dynamicA2T.push([apiId, id]));
      } else {
        uncategorized.push(entry);
        if (isDismissed) dismissedList.push(entry);
        else trulyNew.push(entry);
      }
    });

    // 동적 매핑을 인스턴스에 저장 (영향도 분석·엣지 그리기에서 사용)
    this._dynamicA2T = dynamicA2T;

    // 카탈로그에 있지만 DB에 없는 stale 항목 (드물지만 마이그레이션 후 가능)
    const stale = this.DFD.tables.filter(t => !liveTableSet.has(t.label));

    // ── API 머지 (테이블 머지와 동일 패턴 — 4-state) ─────────────
    // 정적 카탈로그(DFD.apis) + 서버 등록 라우트(registeredRoutes) 병합
    const catalogApiByLabel = {};
    this.DFD.apis.forEach(a => { catalogApiByLabel[a.label] = a; });

    // 서버 라우트 경로(예: /api/leads) → api_id(예: api-leads) 추론
    const _routeToApiId = (route) => {
      // /api/<seg>[/<sub>] → api-<seg> (multi-segment 는 api-<seg>-<sub>)
      const m = route.match(/^\/api\/(.+)$/);
      if (!m) return null;
      const path = m[1].replace(/\//g, '-');
      // 'meeting' 도 그대로 (api-meeting), 'meetings' alias 는 카탈로그와 충돌 → skip
      return 'api-' + path;
    };

    const liveApiIds = new Set();
    const liveRouteByApiId = {};
    registeredRoutes.forEach(route => {
      const id = _routeToApiId(route);
      if (!id) return;
      // /api/meetings 는 /api/meeting alias 이므로 카탈로그에 같은 id 가 없으면 스킵
      if (route === '/api/meetings') return;
      liveApiIds.add(id);
      liveRouteByApiId[id] = route;
    });

    const mergedApis = [];
    const apiTrulyNew = [];
    const apiDismissedList = [];
    const dynamicP2A = [];

    // 카탈로그 순서대로 (의미론 보존)
    this.DFD.apis.forEach(a => {
      if (liveApiIds.has(a.id)) mergedApis.push(a);
      // 카탈로그에 있지만 서버에 없는 라우트는 stale (드물게)
    });

    // 카탈로그에 없는 라우트 자동 추가
    registeredRoutes.forEach(route => {
      const id = _routeToApiId(route);
      if (!id) return;
      if (route === '/api/meetings') return;
      // 카탈로그에 이미 id 가 있으면 스킵
      if (this.DFD.apis.find(a => a.id === id)) return;

      const dbPages = apiMappingByApi[id];
      const isMapped = Array.isArray(dbPages) && dbPages.length > 0;
      const isDismissedApi = apiDismissedSet.has(id);
      const entry = {
        id,
        label: route,
        method: 'CRUD',  // 동적 라우트는 메서드 불명 — 기본값
        _uncategorized: !isMapped,
        _dynamicMapped: isMapped,
        _dismissed: isDismissedApi && !isMapped,
        _trulyNew: !isMapped && !isDismissedApi,
        _dbPages: dbPages || [],
      };
      mergedApis.push(entry);
      if (isMapped) {
        dbPages.forEach(pgId => dynamicP2A.push([pgId, id]));
      } else if (isDismissedApi) {
        apiDismissedList.push(entry);
      } else {
        apiTrulyNew.push(entry);
      }
    });

    this._dynamicP2A = dynamicP2A;

    const apiStale = this.DFD.apis.filter(a => !liveApiIds.has(a.id));

    // ── 페이지 머지 (테이블/API 와 동일 패턴 — 4-state) ─────────
    const catalogPageById = {};
    this.DFD.pages.forEach(p => { catalogPageById[p.id] = p; });
    // 카탈로그 alias 매핑 (meeting-list.js → pg-meeting)
    const CATALOG_PAGE_ALIAS = {
      dashboard: 'pg-dashboard', pipeline: 'pg-pipeline', leads: 'pg-leads',
      customers: 'pg-customers', calendar: 'pg-calendar', meeting: 'pg-meeting',
      'meeting-list': 'pg-meeting', projects: 'pg-projects', team: 'pg-team',
      reports: 'pg-reports', board: 'pg-board', admin: 'pg-admin',
    };
    const pageMappingById = {};
    (this._pageMappings || []).forEach(m => { pageMappingById[m.page_id] = m; });
    const pageDismissedSet = new Set((this._pageDismissed || []).map(d => d.page_id));

    const mergedPages = [];
    const pageTrulyNew = [];
    const pageDismissedList = [];
    const dynamicPageP2A = [];  // 사용자 매핑된 page → API

    // 카탈로그 순서대로 — alias 가 있는 파일은 카탈로그 id 로 통합되어 한 번만 표시
    const seenCatalogIds = new Set();
    (this._registeredPages || []).forEach(p => {
      const aliasId = CATALOG_PAGE_ALIAS[p.base_name];
      if (aliasId && !seenCatalogIds.has(aliasId)) {
        const cat = catalogPageById[aliasId];
        if (cat) {
          mergedPages.push(cat);
          seenCatalogIds.add(aliasId);
        }
      }
    });

    // 동적 페이지 (카탈로그 미매칭)
    (this._registeredPages || []).forEach(p => {
      const aliasId = CATALOG_PAGE_ALIAS[p.base_name];
      if (aliasId) return; // 카탈로그 페이지는 이미 추가됨
      const pageId = p.page_id;
      const mapping = pageMappingById[pageId];
      const isMapped = mapping && (mapping.label || (mapping.api_keys && mapping.api_keys.length > 0));
      const isDismissedPage = pageDismissedSet.has(pageId);
      const entry = {
        id: pageId,
        label: mapping?.label || p.base_name,
        icon: mapping?.icon || '📄',
        _uncategorized: !isMapped,
        _dynamicMapped: !!isMapped,
        _dismissed: isDismissedPage && !isMapped,
        _trulyNew: !isMapped && !isDismissedPage,
        _file: p.file,
      };
      mergedPages.push(entry);
      if (isMapped && mapping.api_keys) {
        mapping.api_keys.forEach(apiId => dynamicPageP2A.push([pageId, apiId]));
      } else if (isDismissedPage) {
        pageDismissedList.push(entry);
      } else {
        pageTrulyNew.push(entry);
      }
    });

    // 카탈로그에 있지만 파일이 없는 페이지도 카탈로그로 표시 (이론상 없음)
    this.DFD.pages.forEach(p => {
      if (!seenCatalogIds.has(p.id)) mergedPages.unshift(p);
    });

    // 동적 매핑을 인스턴스에 저장 (영향도/엣지 그리기에서 사용)
    this._dynamicPageP2A = dynamicPageP2A;

    // ── 3) 경고 배너 HTML ────────────────────────────────────────
    let warningBanner = '';
    if (fetchFailed) {
      warningBanner = `
        <div class="dfd-warn dfd-warn-error">
          ⚠️ 라이브 스키마 조회 실패 — 정적 카탈로그 ${this.DFD.tables.length}개 테이블만 표시됩니다.
        </div>`;
    } else if (
      trulyNew.length > 0 || dismissedList.length > 0 || stale.length > 0 ||
      apiTrulyNew.length > 0 || apiDismissedList.length > 0 || apiStale.length > 0 ||
      pageTrulyNew.length > 0 || pageDismissedList.length > 0 ||
      (this._externalDeps && this._externalDeps.length > 0)
    ) {
      // 3-bucket × 2(테이블/API) — 신규/무시/Stale
      const newList = trulyNew.map(t => esc(t.label)).join(', ');
      const dismissedListStr = dismissedList.map(t => esc(t.label)).join(', ');
      const staleList = stale.map(t => esc(t.label)).join(', ');
      const apiNewList = apiTrulyNew.map(a => esc(a.label)).join(', ');
      const apiDismissedListStr = apiDismissedList.map(a => esc(a.label)).join(', ');
      const apiStaleList = apiStale.map(a => esc(a.label)).join(', ');
      const isAlert = trulyNew.length > 0 || apiTrulyNew.length > 0;
      warningBanner = `
        <details class="dfd-warn ${isAlert ? 'dfd-warn-info' : 'dfd-warn-muted'}" ${isAlert ? 'open' : ''}>
          <summary>
            ${isAlert ? '🆕 신규 미매핑 감지' : 'ℹ️ DFD 상태'}:
            ${trulyNew.length > 0 ? `<strong style="color:#b45309">테이블 ${trulyNew.length}개</strong>` : ''}
            ${trulyNew.length > 0 && apiTrulyNew.length > 0 ? ' · ' : ''}
            ${apiTrulyNew.length > 0 ? `<strong style="color:#0c4a6e">API ${apiTrulyNew.length}개</strong>` : ''}
            ${(trulyNew.length > 0 || apiTrulyNew.length > 0) && (dismissedList.length > 0 || apiDismissedList.length > 0) ? ' · ' : ''}
            ${dismissedList.length > 0 || apiDismissedList.length > 0 ? `<span style="color:var(--text-3)">${dismissedList.length + apiDismissedList.length}개 무시됨</span>` : ''}
            ${(stale.length + apiStale.length) > 0 ? ` · <strong>${stale.length + apiStale.length}개 stale</strong>` : ''}
            <span class="dfd-warn-hint">(클릭하여 상세 보기)</span>
          </summary>
          <div class="dfd-warn-body">
            ${(trulyNew.length + apiTrulyNew.length + pageTrulyNew.length) > 0 ? `
              <div class="dfd-warn-row">
                <strong>🆕 신규 미매핑 (우클릭 → 추가 또는 무시):</strong>
                ${trulyNew.length > 0 ? `<code><strong>🗄 테이블:</strong> ${newList}</code>` : ''}
                ${apiTrulyNew.length > 0 ? `<code><strong>⚡ API:</strong> ${apiNewList}</code>` : ''}
                ${pageTrulyNew.length > 0 ? `<code><strong>🖥️ 페이지:</strong> ${pageTrulyNew.map(p => esc(p.label)).join(', ')}</code>` : ''}
              </div>` : ''}
            ${(dismissedList.length + apiDismissedList.length) > 0 ? `
              <div class="dfd-warn-row">
                <strong>🔕 무시됨 (확인은 했지만 매핑 안 함):</strong>
                ${dismissedList.length > 0 ? `<code><strong>🗄 테이블:</strong> ${dismissedListStr}</code>` : ''}
                ${apiDismissedList.length > 0 ? `<code><strong>⚡ API:</strong> ${apiDismissedListStr}</code>` : ''}
                <div class="dfd-warn-tip">💡 노드 우클릭 → "🔔 다시 알림" 으로 신규로 복원 가능</div>
              </div>` : ''}
            ${(stale.length + apiStale.length) > 0 ? `
              <div class="dfd-warn-row">
                <strong>🗑 Stale (카탈로그에 있지만 서버에 없음):</strong>
                ${stale.length > 0 ? `<code><strong>🗄 테이블:</strong> ${staleList}</code>` : ''}
                ${apiStale.length > 0 ? `<code><strong>⚡ API:</strong> ${apiStaleList}</code>` : ''}
                <div class="dfd-warn-tip">💡 <code>dev.js</code> 의 <code>DFD.tables</code> / <code>DFD.apis</code> 에서 제거 권장</div>
              </div>` : ''}
            ${(() => {
              // 카탈로그(DFD.external)에 없는 외부 호스트가 코드에 있는지 확인
              const catalogHosts = this.DFD.external.map(e => (e.url || '').split(' ')[0].split('/')[0]).filter(Boolean);
              const unmatchedHosts = (this._externalDeps || []).filter(d =>
                !catalogHosts.some(h => h.includes(d.host) || d.host.includes(h))
              );
              if (unmatchedHosts.length === 0) return '';
              const list = unmatchedHosts.slice(0, 20).map(h => `${esc(h.host)} <span style="color:var(--text-3);font-size:10px">(${h.count}회)</span>`).join(', ');
              return `
                <div class="dfd-warn-row">
                  <strong>🌐 카탈로그 미등록 외부 호스트 (${unmatchedHosts.length}개):</strong>
                  <code>${list}${unmatchedHosts.length > 20 ? ' …' : ''}</code>
                  <div class="dfd-warn-tip">
                    💡 <code>dev.js</code> 의 <code>DFD.external</code> 에 추가하면 4번째 컬럼에 표시됩니다.
                    빈도가 낮으면 임시·시험용 URL 일 수 있어요.
                  </div>
                </div>`;
            })()}
          </div>
        </details>`;
    }

    document.getElementById('dev-content').innerHTML = `
      <div class="dev-section-header">
        <div>
          <h3 style="margin:0;font-size:15px">데이터 흐름도 (DFD) — 영향도 분석</h3>
          <p style="margin:4px 0 0;font-size:12px;color:var(--text-3)">
            노드를 클릭하면 해당 화면·API·테이블의 연결 경로를 강조합니다.
            테이블/컬럼 변경 시 영향 범위를 한눈에 파악하세요.
            <span style="color:var(--text-2)">· 총 ${mergedTables.length}개 테이블 표시</span>
          </p>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button id="dfd-infer-btn" class="btn btn-secondary btn-sm" title="src/routes/*.js 의 SQL 쿼리를 분석하여 미분류 테이블의 API 매핑 제안">
            🔮 자동 추론
          </button>
          <input type="text" id="dfd-search" class="search-input" style="width:200px" placeholder="노드 검색...">
        </div>
      </div>

      ${warningBanner}

      <div class="dfd-container">
        <!-- dfd-board: 헤더 + 컬럼을 하나의 그리드로 통합 → CSS가 자동 정렬 -->
        <div class="dfd-board" id="dfd-board">
          <!-- SVG 오버레이 (absolute, 엣지용) -->
          <svg id="dfd-svg" class="dfd-svg"></svg>

          <!-- 헤더 행 (그리드 1행) -->
          <div class="dfd-col-hdr dfd-hdr-page">🖥️ 화면 (Pages)</div>
          <div class="dfd-col-hdr dfd-hdr-api">⚡ API 라우트</div>
          <div class="dfd-col-hdr dfd-hdr-table">🗄️ DB 테이블</div>
          <div class="dfd-col-hdr dfd-hdr-external">🌐 외부 서비스</div>

          <!-- 컬럼 행 (그리드 2행) -->
          <div class="dfd-col" id="dfd-col-pages">
            ${mergedPages.map(p => {
              let cls = '', icon = p.icon || '🖥️', badge = '', tip = '';
              if (p._dynamicMapped) {
                cls = 'dfd-node-dynamic-mapped';
                badge = '<span class="dfd-mapped-badge">매핑됨</span>';
                tip = '사용자 매핑된 페이지 — 우클릭하여 수정/제거';
              } else if (p._dismissed) {
                cls = 'dfd-node-dismissed';
                icon = '🔕';
                badge = '<span class="dfd-dismissed-badge">무시됨</span>';
                tip = '알림 무시 — 우클릭하여 매핑 추가/다시 알림';
              } else if (p._trulyNew) {
                cls = 'dfd-node-uncategorized dfd-node-new';
                icon = '📌';
                badge = '<span class="dfd-uncat-badge">신규</span>';
                tip = `신규 발견 페이지 (${p._file || ''}) — 우클릭하여 매핑 추가`;
              }
              const interactive = (p._uncategorized || p._dynamicMapped) ? 'data-context-menu="dfd-page-mapping"' : '';
              return `
              <div class="dfd-node dfd-node-page ${cls}"
                   data-id="${p.id}" data-type="page" data-page-id="${esc(p.id)}"
                   ${tip ? `title="${esc(tip)}"` : ''} ${interactive}>
                ${icon} ${esc(p.label)}
                ${badge}
              </div>`;
            }).join('')}
          </div>

          <div class="dfd-col" id="dfd-col-apis">
            ${mergedApis.map(a => {
              // 4-state visual (mirror of table nodes)
              let cls = '', icon = '', badge = '', tip = '';
              if (a._dynamicMapped) {
                cls = 'dfd-node-dynamic-mapped';
                icon = '🔗 ';
                badge = '<span class="dfd-mapped-badge">매핑됨</span>';
                tip = '사용자 매핑됨 — 우클릭하여 수정/제거';
              } else if (a._dismissed) {
                cls = 'dfd-node-dismissed';
                icon = '🔕 ';
                badge = '<span class="dfd-dismissed-badge">무시됨</span>';
                tip = '알림 무시 — 우클릭하여 매핑 추가/다시 알림';
              } else if (a._trulyNew) {
                cls = 'dfd-node-uncategorized dfd-node-new';
                icon = '📌 ';
                badge = '<span class="dfd-uncat-badge">신규</span>';
                tip = '신규 미매핑 API — 우클릭하여 페이지 매핑 추가';
              }
              const interactive = (a._uncategorized || a._dynamicMapped) ? 'data-context-menu="dfd-api-mapping"' : '';
              const method = a.method || 'CRUD';
              return `
              <div class="dfd-node dfd-node-api ${cls}"
                   data-id="${a.id}" data-type="api" data-api-id="${esc(a.id)}"
                   ${tip ? `title="${esc(tip)}"` : ''} ${interactive}>
                ${icon}<span class="dfd-method ${method.toLowerCase()}">${method}</span>
                ${esc(a.label)}
                ${badge}
              </div>`;
            }).join('')}
          </div>

          <div class="dfd-col" id="dfd-col-tables">
            ${mergedTables.map(t => {
              // 4-state visual: catalog / dynamic-mapped / dismissed / truly-new
              let cls = '', icon = '🗄', badge = '', tip = '';
              if (t._dynamicMapped) {
                cls = 'dfd-node-dynamic-mapped';
                icon = '🔗';
                badge = '<span class="dfd-mapped-badge">매핑됨</span>';
                tip = '사용자 매핑됨 — 우클릭하여 수정/제거';
              } else if (t._dismissed) {
                cls = 'dfd-node-dismissed';
                icon = '🔕';
                badge = '<span class="dfd-dismissed-badge">무시됨</span>';
                tip = '알림 무시 — 우클릭하여 매핑 추가/다시 알림';
              } else if (t._trulyNew) {
                cls = 'dfd-node-uncategorized dfd-node-new';
                icon = '📌';
                badge = '<span class="dfd-uncat-badge">신규</span>';
                tip = '신규 미매핑 — 우클릭하여 매핑 추가';
              }
              const interactive = (t._uncategorized || t._dynamicMapped) ? 'data-context-menu="dfd-mapping"' : '';
              return `
              <div class="dfd-node dfd-node-table ${cls}"
                   data-id="${t.id}" data-type="table" data-table-name="${esc(t.label)}"
                   ${tip ? `title="${esc(tip)}"` : ''} ${interactive}>
                <span class="dfd-table-icon">${icon}</span> ${esc(t.label)}
                ${badge}
                <div class="dfd-cols-preview">${t.cols.slice(0,4).join(', ')}${t.cols.length>4?'…':''}</div>
              </div>`;
            }).join('')}
          </div>

          <div class="dfd-col" id="dfd-col-external">
            ${this.DFD.external.map(e => {
              // 자동 발견 결과와 매칭 — substring 으로 host 비교
              const matched = (this._externalDeps || []).filter(d =>
                e.url && (e.url.includes(d.host) || d.host.includes(e.url.split(' ')[0].split('/')[0]))
              );
              const isDetected = matched.length > 0;
              const evidenceList = matched.flatMap(m => m.evidence).slice(0, 5);
              return `
              <div class="dfd-node dfd-node-external dfd-ext-cat-${esc(e.category)} ${isDetected ? 'is-detected' : 'is-undetected'}"
                   data-id="${e.id}" data-type="external"
                   data-evidence="${esc(evidenceList.join('|'))}"
                   title="${esc(e.url)}${isDetected ? ' · 코드에서 ' + evidenceList.length + '곳 사용 확인' : ' · 코드에서 사용 미확인'}">
                <span class="dfd-ext-icon">${e.icon}</span>
                <span class="dfd-ext-label">${esc(e.label)}</span>
                ${isDetected
                  ? `<span class="dfd-ext-detected" title="자동 발견됨">✓</span>`
                  : `<span class="dfd-ext-undetected" title="코드에서 사용 미확인">?</span>`}
                <span class="dfd-ext-cat">${esc(e.category)}</span>
              </div>`;
            }).join('')}
          </div>
        </div>

        <!-- 영향도 패널 -->
        <div class="dfd-impact-panel" id="dfd-impact" style="display:none">
          <div class="dfd-impact-title" id="dfd-impact-title">영향도 분석</div>
          <div id="dfd-impact-body"></div>
        </div>
      </div>
    `;

    // 초기 엣지 드로잉: board에 이미 치수가 있으면 즉시 실행,
    // 아직 없으면 ResizeObserver로 첫 레이아웃 완료 시점에 실행
    const _initBoard = document.getElementById('dfd-board');
    const _doInit = () => { this._drawDFDEdges(); this._bindDFDEvents(); };
    if (_initBoard.offsetWidth > 0 && _initBoard.offsetHeight > 0) {
      // 이미 레이아웃 완료 (동기 리플로우) → 즉시 실행
      _doInit();
    } else {
      // 아직 레이아웃 미완료 → ResizeObserver로 대기
      const _initObs = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
            _initObs.disconnect();
            _doInit();
            return;
          }
        }
      });
      _initObs.observe(_initBoard);
    }
  },

  _drawDFDEdges() {
    const svg   = document.getElementById('dfd-svg');
    const board = document.getElementById('dfd-board');
    if (!svg || !board) return;

    // 레이아웃 재계산 강제 (offsetHeight 읽기로 reflow 트리거)
    void board.offsetHeight;

    const bw = board.offsetWidth;
    const bh = board.offsetHeight;
    if (!bw || !bh) return;

    svg.setAttribute('width',   bw);
    svg.setAttribute('height',  bh);
    svg.setAttribute('viewBox', `0 0 ${bw} ${bh}`);

    // ── offsetParent 체인 순회 (스크롤·뷰포트 독립, 항상 정확) ──
    // getBoundingClientRect는 뷰포트 기준이라 스크롤 시 오차 가능
    // offsetTop/offsetLeft는 레이아웃 기준이므로 스크롤에 무관하게 정확
    const getPts = (id) => {
      const el = board.querySelector(`[data-id="${id}"]`);
      if (!el) return null;
      let top = 0, left = 0, cur = el;
      while (cur && cur !== board) {
        top  += cur.offsetTop;
        left += cur.offsetLeft;
        cur   = cur.offsetParent;
      }
      return {
        lx: +(left).toFixed(1),
        rx: +(left + el.offsetWidth).toFixed(1),
        y:  +(top  + el.offsetHeight / 2).toFixed(1),
      };
    };

    // ── 3차 베지어 S-곡선: 양쪽 CP를 midpoint에 배치 ──
    // M x1,y1  C mid,y1  mid,y2  x2,y2
    // · CP1=(mid,y1): 시작점에서 수평으로 출발
    // · CP2=(mid,y2): 도착점에서 수평으로 진입
    // → 클래식 S-커브, 간격이 달라져도 항상 올바른 방향 보장
    const arc = (x1, y1, x2, y2) => {
      const mid = +((x1 + x2) / 2).toFixed(1);
      return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`;
    };

    // ── 화살촉 마커 ──
    const defs = `<defs>
      <marker id="arr-n" viewBox="0 0 8 8" refX="7" refY="4"
        markerWidth="5" markerHeight="5" orient="auto"
        markerUnits="userSpaceOnUse">
        <path d="M0,1 L7,4 L0,7 Z" fill="rgba(140,145,180,0.5)"/>
      </marker>
      <marker id="arr-a" viewBox="0 0 8 8" refX="7" refY="4"
        markerWidth="7" markerHeight="7" orient="auto"
        markerUnits="userSpaceOnUse">
        <path d="M0,1 L7,4 L0,7 Z" fill="#F59C00"/>
      </marker>
      <marker id="arr-r" viewBox="0 0 8 8" refX="7" refY="4"
        markerWidth="6" markerHeight="6" orient="auto"
        markerUnits="userSpaceOnUse">
        <path d="M0,1 L7,4 L0,7 Z" fill="#17A85A"/>
      </marker>
    </defs>`;

    let paths = defs;

    const addEdge = (fromId, toId) => {
      const f = getPts(fromId), t = getPts(toId);
      if (!f || !t) return;
      paths += `<path class="dfd-edge" data-from="${fromId}" data-to="${toId}"
        d="${arc(f.rx, f.y, t.lx, t.y)}" marker-end="url(#arr-n)"/>`;
    };

    this.DFD.p2a.forEach(([p, a]) => addEdge(p, a));
    this.DFD.a2t.forEach(([a, t]) => addEdge(a, t));
    // 외부 서비스 엣지 (API → External)
    (this.DFD.a2e || []).forEach(([a, e]) => addEdge(a, e));
    // 동적 매핑 엣지 (관리자 우클릭 → 카탈로그 추가로 생성된 매핑)
    (this._dynamicA2T || []).forEach(([a, t]) => addEdge(a, t));
    (this._dynamicP2A || []).forEach(([p, a]) => addEdge(p, a));
    // 동적 페이지 매핑 (페이지 → API) — _dynamicPageP2A
    (this._dynamicPageP2A || []).forEach(([p, a]) => addEdge(p, a));

    svg.innerHTML = paths;
  },

  _bindDFDEvents() {
    const board = document.getElementById('dfd-board');
    if (!board) return;

    board.addEventListener('click', e => {
      const node = e.target.closest('.dfd-node');
      if (!node) { this._clearDFDHighlight(); return; }
      const id = node.dataset.id;
      const type = node.dataset.type;
      this.dfdSelected = id;
      this._highlightDFD(id, type);
      this._showImpact(id, type);
    });

    // 우클릭 컨텍스트 메뉴 — 미분류/매핑된 테이블 또는 API 노드
    board.addEventListener('contextmenu', e => {
      // 테이블 노드
      const tableNode = e.target.closest('.dfd-node[data-context-menu="dfd-mapping"]');
      if (tableNode) {
        e.preventDefault();
        this._showDfdContextMenu(e.clientX, e.clientY, tableNode.dataset.tableName, {
          kind: 'table',
          isMapped: tableNode.classList.contains('dfd-node-dynamic-mapped'),
          isDismissed: tableNode.classList.contains('dfd-node-dismissed'),
          isNew: tableNode.classList.contains('dfd-node-new'),
        });
        return;
      }
      // API 노드
      const apiNode = e.target.closest('.dfd-node[data-context-menu="dfd-api-mapping"]');
      if (apiNode) {
        e.preventDefault();
        this._showDfdContextMenu(e.clientX, e.clientY, apiNode.dataset.apiId, {
          kind: 'api',
          isMapped: apiNode.classList.contains('dfd-node-dynamic-mapped'),
          isDismissed: apiNode.classList.contains('dfd-node-dismissed'),
          isNew: apiNode.classList.contains('dfd-node-new'),
        });
        return;
      }
      // 페이지 노드 (신규 발견 페이지)
      const pageNode = e.target.closest('.dfd-node[data-context-menu="dfd-page-mapping"]');
      if (pageNode) {
        e.preventDefault();
        this._showDfdContextMenu(e.clientX, e.clientY, pageNode.dataset.pageId, {
          kind: 'page',
          isMapped: pageNode.classList.contains('dfd-node-dynamic-mapped'),
          isDismissed: pageNode.classList.contains('dfd-node-dismissed'),
          isNew: pageNode.classList.contains('dfd-node-new'),
        });
      }
    });

    // 컨텍스트 메뉴 외부 클릭 시 닫기
    document.addEventListener('click', () => this._hideDfdContextMenu(), { capture: true });

    // 자동 추론 버튼
    document.getElementById('dfd-infer-btn')?.addEventListener('click', () => this._runDfdInference());

    // 검색
    const search = document.getElementById('dfd-search');
    if (search) {
      search.addEventListener('input', () => {
        const q = search.value.toLowerCase();
        document.querySelectorAll('.dfd-node').forEach(n => {
          const match = !q || n.textContent.toLowerCase().includes(q);
          n.style.opacity = match ? '1' : '0.2';
        });
      });
    }

    // 창 리사이즈 시 엣지 재드로잉
    const observer = new ResizeObserver(() => this._drawDFDEdges());
    observer.observe(document.getElementById('dfd-board'));
  },

  // ──────────────────────────────────────────────────────────────
  // DFD 매핑 컨텍스트 메뉴 + 모달
  // ──────────────────────────────────────────────────────────────
  _showDfdContextMenu(x, y, key, state) {
    this._hideDfdContextMenu();
    const menu = document.createElement('div');
    menu.id = '__dfd-ctxmenu';
    menu.className = 'dfd-ctxmenu';
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';
    // state: { kind: 'table'|'api'|'page', isMapped, isDismissed, isNew }
    const labelNoun = state.kind === 'api' ? '페이지 매핑'
                    : state.kind === 'page' ? '페이지 카탈로그'
                    : '카탈로그';
    let items = '';
    if (state.isMapped) {
      items = `
        <div class="dfd-ctxmenu-item" data-action="edit">✏️ 매핑 수정 (${esc(key)})</div>
        <div class="dfd-ctxmenu-item dfd-ctxmenu-danger" data-action="remove">🗑 매핑 제거</div>
      `;
    } else if (state.isDismissed) {
      items = `
        <div class="dfd-ctxmenu-item" data-action="add">📋 ${labelNoun}에 추가 (${esc(key)})</div>
        <div class="dfd-ctxmenu-item" data-action="undismiss">🔔 다시 알림</div>
      `;
    } else {
      items = `
        <div class="dfd-ctxmenu-item" data-action="add">📋 ${labelNoun}에 추가 (${esc(key)})</div>
        <div class="dfd-ctxmenu-item" data-action="dismiss">🔕 무시하기</div>
      `;
    }
    menu.innerHTML = items;
    document.body.appendChild(menu);
    menu.addEventListener('click', e => {
      const item = e.target.closest('.dfd-ctxmenu-item');
      if (!item) return;
      const action = item.dataset.action;
      this._hideDfdContextMenu();
      if (state.kind === 'api') {
        if (action === 'add' || action === 'edit') this._openDfdApiMappingModal(key);
        else if (action === 'remove') this._removeDfdApiMapping(key);
        else if (action === 'dismiss') this._dismissDfdApi(key);
        else if (action === 'undismiss') this._undismissDfdApi(key);
      } else if (state.kind === 'page') {
        if (action === 'add' || action === 'edit') this._openDfdPageMappingModal(key);
        else if (action === 'remove') this._removeDfdPageMapping(key);
        else if (action === 'dismiss') this._dismissDfdPage(key);
        else if (action === 'undismiss') this._undismissDfdPage(key);
      } else {
        if (action === 'add' || action === 'edit') this._openDfdMappingModal(key);
        else if (action === 'remove') this._removeDfdMapping(key);
        else if (action === 'dismiss') this._dismissDfdTable(key);
        else if (action === 'undismiss') this._undismissDfdTable(key);
      }
    });
    // 화면 밖 넘침 방지
    setTimeout(() => {
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth - 8) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
      if (rect.bottom > window.innerHeight - 8) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';
    }, 0);
  },

  _hideDfdContextMenu() {
    document.getElementById('__dfd-ctxmenu')?.remove();
  },

  _openDfdMappingModal(tableName) {
    // 현재 매핑된 API 키 (수정 모드일 때 체크 표시용)
    const existingApis = new Set();
    (this._dynamicA2T || []).forEach(([api, tbl]) => {
      const tblName = tbl.replace(/^tbl-auto-/, '').replace(/-/g, '_');
      if (tblName === tableName) existingApis.add(api);
    });

    const apiCheckboxes = this.DFD.apis.map(a => {
      const checked = existingApis.has(a.id) ? 'checked' : '';
      return `
        <label class="dfd-map-api-item">
          <input type="checkbox" class="dfd-map-api-cb" value="${esc(a.id)}" ${checked}>
          <span class="dfd-map-api-method ${a.method.toLowerCase()}">${a.method}</span>
          <span class="dfd-map-api-label">${esc(a.label)}</span>
        </label>`;
    }).join('');

    Modal.open({
      title: `📋 DFD 매핑 — ${esc(tableName)}`,
      compact: true,
      width: 560,
      confirmOnClose: true,
      body: `
        <div class="dfd-map-body">
          <p style="font-size:12px;color:var(--text-2);margin:0 0 10px;line-height:1.6">
            <strong>${esc(tableName)}</strong> 테이블이 어떤 API 에서 사용되나요?<br>
            해당하는 API 를 모두 체크하세요. 저장하면 영향도 분석에 반영됩니다.
          </p>
          <div class="dfd-map-search-wrap">
            <input type="text" id="dfd-map-search" placeholder="🔍 API 필터..." class="dfd-map-search">
            <span class="dfd-map-count" id="dfd-map-count">${existingApis.size}개 선택됨</span>
          </div>
          <div class="dfd-map-api-list">${apiCheckboxes}</div>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="dfd-map-cancel">취소</button>
        <button class="btn btn-primary" id="dfd-map-save">💾 저장</button>
      `,
      bind: {
        '#dfd-map-cancel': () => Modal.close(),
        '#dfd-map-save': () => this._saveDfdMapping(tableName),
      },
      onOpen: () => {
        // 검색 필터
        const search = document.getElementById('dfd-map-search');
        if (search) {
          search.addEventListener('input', () => {
            const q = search.value.toLowerCase();
            document.querySelectorAll('.dfd-map-api-item').forEach(it => {
              it.style.display = it.textContent.toLowerCase().includes(q) ? '' : 'none';
            });
          });
        }
        // 카운트 업데이트
        document.querySelectorAll('.dfd-map-api-cb').forEach(cb => {
          cb.addEventListener('change', () => {
            const n = document.querySelectorAll('.dfd-map-api-cb:checked').length;
            const elCount = document.getElementById('dfd-map-count');
            if (elCount) elCount.textContent = `${n}개 선택됨`;
          });
        });
      },
    });
  },

  async _saveDfdMapping(tableName) {
    const apiKeys = [...document.querySelectorAll('.dfd-map-api-cb:checked')].map(cb => cb.value);
    if (apiKeys.length === 0) {
      // 빈 매핑 = 제거와 동일 효과지만, UX 일관성을 위해 명시적 제거 권유
      const ok = confirm('선택된 API 가 없습니다. 매핑을 비우면 미분류로 돌아갑니다. 계속할까요?');
      if (!ok) return;
    }
    try {
      await API.request('POST', '/admin/dev/dfd-mappings', {
        table_name: tableName,
        api_keys: apiKeys,
      });
      Modal.close();
      Toast.success(`${tableName} 매핑이 저장되었습니다 (${apiKeys.length}개 API)`);
      await this.renderDFD();
    } catch (e) {
      Toast.error('저장 실패: ' + (e.message || ''));
    }
  },

  _removeDfdMapping(tableName) {
    Modal.confirm(
      `<strong>${esc(tableName)}</strong> 의 DFD 매핑을 제거하시겠어요?<br>` +
      `<span style="font-size:11px;color:var(--text-3)">테이블 자체는 삭제되지 않고, 미분류 그룹으로 돌아갑니다.</span>`,
      async () => {
        try {
          await API.request('DELETE', '/admin/dev/dfd-mappings/' + encodeURIComponent(tableName));
          Toast.success(`${tableName} 매핑이 제거되었습니다`);
          await this.renderDFD();
        } catch (e) {
          Toast.error('제거 실패: ' + (e.message || ''));
        }
      }
    );
  },

  async _dismissDfdTable(tableName) {
    try {
      await API.request('POST', '/admin/dev/dfd-dismissed', { table_name: tableName });
      Toast.success(`${tableName} 알림을 껐습니다 (무시 목록에 추가)`);
      await this.renderDFD();
    } catch (e) {
      Toast.error('실패: ' + (e.message || ''));
    }
  },

  async _undismissDfdTable(tableName) {
    try {
      await API.request('DELETE', '/admin/dev/dfd-dismissed/' + encodeURIComponent(tableName));
      Toast.success(`${tableName} 알림을 다시 활성화했습니다`);
      await this.renderDFD();
    } catch (e) {
      Toast.error('실패: ' + (e.message || ''));
    }
  },

  // ─── API 매핑 핸들러 (테이블 핸들러의 거울 — API → 페이지) ─────
  _openDfdApiMappingModal(apiId) {
    // 현재 매핑된 페이지 키 (수정 모드 시 체크 표시)
    const existingPages = new Set();
    (this._dynamicP2A || []).forEach(([pg, ap]) => {
      if (ap === apiId) existingPages.add(pg);
    });

    const pageCheckboxes = this.DFD.pages.map(p => {
      const checked = existingPages.has(p.id) ? 'checked' : '';
      return `
        <label class="dfd-map-api-item">
          <input type="checkbox" class="dfd-map-page-cb" value="${esc(p.id)}" ${checked}>
          <span class="dfd-map-api-label">${p.icon} ${esc(p.label)}</span>
        </label>`;
    }).join('');

    Modal.open({
      title: `📋 API → 페이지 매핑 — ${esc(apiId)}`,
      compact: true,
      width: 480,
      confirmOnClose: true,
      body: `
        <div class="dfd-map-body">
          <p style="font-size:12px;color:var(--text-2);margin:0 0 10px;line-height:1.6">
            <strong>${esc(apiId)}</strong> 가 어떤 페이지에서 호출되나요?<br>
            해당 페이지를 모두 체크하세요. 저장하면 영향도 분석에 반영됩니다.
          </p>
          <div class="dfd-map-search-wrap">
            <span class="dfd-map-count" id="dfd-map-page-count">${existingPages.size}개 선택됨</span>
          </div>
          <div class="dfd-map-api-list">${pageCheckboxes}</div>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="dfd-map-page-cancel">취소</button>
        <button class="btn btn-primary" id="dfd-map-page-save">💾 저장</button>
      `,
      bind: {
        '#dfd-map-page-cancel': () => Modal.close(),
        '#dfd-map-page-save': () => this._saveDfdApiMapping(apiId),
      },
      onOpen: () => {
        document.querySelectorAll('.dfd-map-page-cb').forEach(cb => {
          cb.addEventListener('change', () => {
            const n = document.querySelectorAll('.dfd-map-page-cb:checked').length;
            const el = document.getElementById('dfd-map-page-count');
            if (el) el.textContent = `${n}개 선택됨`;
          });
        });
      },
    });
  },

  async _saveDfdApiMapping(apiId) {
    const pageKeys = [...document.querySelectorAll('.dfd-map-page-cb:checked')].map(cb => cb.value);
    if (pageKeys.length === 0) {
      const ok = confirm('선택된 페이지가 없습니다. 매핑을 비우면 미분류로 돌아갑니다. 계속할까요?');
      if (!ok) return;
    }
    try {
      await API.request('POST', '/admin/dev/dfd-api-mappings', { api_id: apiId, page_keys: pageKeys });
      Modal.close();
      Toast.success(`${apiId} 매핑이 저장되었습니다 (${pageKeys.length}개 페이지)`);
      await this.renderDFD();
    } catch (e) {
      Toast.error('저장 실패: ' + (e.message || ''));
    }
  },

  _removeDfdApiMapping(apiId) {
    Modal.confirm(
      `<strong>${esc(apiId)}</strong> 의 페이지 매핑을 제거하시겠어요?<br>` +
      `<span style="font-size:11px;color:var(--text-3)">API 자체는 유지되며 미분류로 돌아갑니다.</span>`,
      async () => {
        try {
          await API.request('DELETE', '/admin/dev/dfd-api-mappings/' + encodeURIComponent(apiId));
          Toast.success(`${apiId} 매핑이 제거되었습니다`);
          await this.renderDFD();
        } catch (e) { Toast.error('제거 실패: ' + (e.message || '')); }
      }
    );
  },

  async _dismissDfdApi(apiId) {
    try {
      await API.request('POST', '/admin/dev/dfd-api-dismissed', { api_id: apiId });
      Toast.success(`${apiId} 알림을 껐습니다`);
      await this.renderDFD();
    } catch (e) { Toast.error('실패: ' + (e.message || '')); }
  },

  async _undismissDfdApi(apiId) {
    try {
      await API.request('DELETE', '/admin/dev/dfd-api-dismissed/' + encodeURIComponent(apiId));
      Toast.success(`${apiId} 알림을 다시 활성화했습니다`);
      await this.renderDFD();
    } catch (e) { Toast.error('실패: ' + (e.message || '')); }
  },

  // ─── 페이지 매핑 핸들러 ───────────────────────────────────────
  _openDfdPageMappingModal(pageId) {
    const existing = (this._pageMappings || []).find(m => m.page_id === pageId) || {};
    const existingApis = new Set(existing.api_keys || []);
    const baseName = pageId.replace(/^pg-/, '');
    const apiCheckboxes = this.DFD.apis.map(a => {
      const checked = existingApis.has(a.id) ? 'checked' : '';
      return `
        <label class="dfd-map-api-item">
          <input type="checkbox" class="dfd-page-map-api-cb" value="${esc(a.id)}" ${checked}>
          <span class="dfd-map-api-method ${a.method.toLowerCase()}">${a.method}</span>
          <span class="dfd-map-api-label">${esc(a.label)}</span>
        </label>`;
    }).join('');

    Modal.open({
      title: `📋 페이지 카탈로그 — ${esc(pageId)}`,
      compact: true,
      width: 560,
      confirmOnClose: true,
      body: `
        <div class="dfd-map-body">
          <p style="font-size:12px;color:var(--text-2);margin:0 0 12px;line-height:1.6">
            신규 발견된 페이지 <strong>${esc(baseName)}.js</strong> 를 카탈로그에 추가합니다.
          </p>
          <div class="form-row" style="display:flex;gap:8px;margin-bottom:10px">
            <div style="flex:0 0 70px">
              <label class="form-label" style="font-size:11px">아이콘</label>
              <input type="text" id="dfd-page-icon" maxlength="3" value="${esc(existing.icon || '📄')}" style="width:100%;padding:6px;font-size:18px;text-align:center;border:1px solid var(--border);border-radius:6px">
            </div>
            <div style="flex:1">
              <label class="form-label" style="font-size:11px">표시 라벨</label>
              <input type="text" id="dfd-page-label" maxlength="100" value="${esc(existing.label || baseName)}" placeholder="예: 주문 관리" style="width:100%;padding:6px;font-size:13px;border:1px solid var(--border);border-radius:6px">
            </div>
          </div>
          <div class="dfd-map-search-wrap">
            <span class="dfd-map-count" id="dfd-page-api-count">${existingApis.size}개 API 선택됨</span>
          </div>
          <div class="dfd-map-api-list">${apiCheckboxes}</div>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="dfd-page-cancel">취소</button>
        <button class="btn btn-primary" id="dfd-page-save">💾 저장</button>
      `,
      bind: {
        '#dfd-page-cancel': () => Modal.close(),
        '#dfd-page-save': () => this._saveDfdPageMapping(pageId),
      },
      onOpen: () => {
        document.querySelectorAll('.dfd-page-map-api-cb').forEach(cb => {
          cb.addEventListener('change', () => {
            const n = document.querySelectorAll('.dfd-page-map-api-cb:checked').length;
            const el = document.getElementById('dfd-page-api-count');
            if (el) el.textContent = `${n}개 API 선택됨`;
          });
        });
      },
    });
  },

  async _saveDfdPageMapping(pageId) {
    const label = document.getElementById('dfd-page-label')?.value?.trim() || null;
    const icon  = document.getElementById('dfd-page-icon')?.value?.trim() || null;
    const apiKeys = [...document.querySelectorAll('.dfd-page-map-api-cb:checked')].map(cb => cb.value);
    try {
      await API.request('POST', '/admin/dev/dfd-page-mappings', {
        page_id: pageId, label, icon, api_keys: apiKeys,
      });
      Modal.close();
      Toast.success(`${pageId} 카탈로그 등록 완료 (API ${apiKeys.length}개 연결)`);
      await this.renderDFD();
    } catch (e) { Toast.error('저장 실패: ' + (e.message || '')); }
  },

  _removeDfdPageMapping(pageId) {
    Modal.confirm(
      `<strong>${esc(pageId)}</strong> 페이지 매핑을 제거하시겠어요?<br>` +
      `<span style="font-size:11px;color:var(--text-3)">파일 자체는 유지되며 미분류로 돌아갑니다.</span>`,
      async () => {
        try {
          await API.request('DELETE', '/admin/dev/dfd-page-mappings/' + encodeURIComponent(pageId));
          Toast.success(`${pageId} 매핑이 제거되었습니다`);
          await this.renderDFD();
        } catch (e) { Toast.error('제거 실패: ' + (e.message || '')); }
      }
    );
  },

  async _dismissDfdPage(pageId) {
    try {
      await API.request('POST', '/admin/dev/dfd-page-dismissed', { page_id: pageId });
      Toast.success(`${pageId} 알림을 껐습니다`);
      await this.renderDFD();
    } catch (e) { Toast.error('실패: ' + (e.message || '')); }
  },

  async _undismissDfdPage(pageId) {
    try {
      await API.request('DELETE', '/admin/dev/dfd-page-dismissed/' + encodeURIComponent(pageId));
      Toast.success(`${pageId} 알림을 다시 활성화했습니다`);
      await this.renderDFD();
    } catch (e) { Toast.error('실패: ' + (e.message || '')); }
  },

  // ──────────────────────────────────────────────────────────────
  // 자동 추론 — src/routes/*.js 분석 후 매핑 제안 모달
  // ──────────────────────────────────────────────────────────────
  async _runDfdInference() {
    const btn = document.getElementById('dfd-infer-btn');
    if (btn) { btn.disabled = true; btn.textContent = '🔍 분석 중...'; }
    let result;
    try {
      result = await API.get('/admin/dev/infer-mappings');
    } catch (e) {
      Toast.error('자동 추론 실패: ' + (e.message || ''));
      if (btn) { btn.disabled = false; btn.textContent = '🔮 자동 추론'; }
      return;
    }
    if (btn) { btn.disabled = false; btn.textContent = '🔮 자동 추론'; }

    const tableSuggestions = result?.data?.suggestions || [];
    const apiSuggestions = result?.data?.api_suggestions || [];
    const scanned = result?.data?.scanned || { routes: 0, pages: 0 };

    if (tableSuggestions.length === 0 && apiSuggestions.length === 0) {
      Toast.info(`자동 추론: 라우트 ${scanned.routes}개 + 페이지 ${scanned.pages}개 분석 — 새로운 제안 없음.`);
      return;
    }

    // 카탈로그 lookup
    const apiById = {};
    this.DFD.apis.forEach(a => { apiById[a.id] = a; });
    const pageById = {};
    this.DFD.pages.forEach(p => { pageById[p.id] = p; });

    // a2t 섹션 HTML (테이블 → API들)
    const tableRows = tableSuggestions.map((s, i) => {
      const apisHtml = s.api_keys.map(ak => {
        const a = apiById[ak.api_key];
        const label = a ? a.label : ak.api_key;
        const method = a ? a.method : 'CRUD';
        const ev = (ak.evidence_files || []).slice(0, 3).join(', ');
        return `
          <label class="dfd-infer-api">
            <input type="checkbox" class="dfd-infer-a2t-cb"
              data-suggestion="${i}" value="${esc(ak.api_key)}" checked>
            <span class="dfd-map-api-method ${method.toLowerCase()}">${method}</span>
            <span class="dfd-map-api-label">${esc(label)}</span>
            <span class="dfd-infer-evidence" title="근거 파일">${esc(ev)}</span>
          </label>`;
      }).join('');
      return `
        <div class="dfd-infer-card" data-suggestion="${i}" data-kind="table" data-table-name="${esc(s.table_name)}">
          <div class="dfd-infer-card-head">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" class="dfd-infer-row-cb" data-suggestion="${i}" data-kind="table" checked>
              <span class="dfd-infer-table-name">📌 ${esc(s.table_name)}</span>
              <span class="dfd-infer-count">${s.api_keys.length}개 API 추론됨</span>
            </label>
          </div>
          <div class="dfd-infer-apis">${apisHtml}</div>
        </div>`;
    }).join('');

    // p2a 섹션 HTML (API → 페이지들)
    const apiRows = apiSuggestions.map((s, i) => {
      const pagesHtml = s.page_keys.map(pk => {
        const p = pageById[pk.page_key];
        const label = p ? `${p.icon} ${p.label}` : pk.page_key;
        const ev = (pk.evidence_files || []).slice(0, 3).join(', ');
        return `
          <label class="dfd-infer-api">
            <input type="checkbox" class="dfd-infer-p2a-cb"
              data-suggestion="${i}" value="${esc(pk.page_key)}" checked>
            <span class="dfd-map-api-label">${esc(label)}</span>
            <span class="dfd-infer-evidence" title="근거 파일">${esc(ev)}</span>
          </label>`;
      }).join('');
      return `
        <div class="dfd-infer-card" data-suggestion="${i}" data-kind="api" data-api-id="${esc(s.api_id)}">
          <div class="dfd-infer-card-head">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" class="dfd-infer-row-cb" data-suggestion="${i}" data-kind="api" checked>
              <span class="dfd-infer-table-name">📌 ${esc(s.api_id)}</span>
              <span class="dfd-infer-count">${s.page_keys.length}개 페이지 추론됨</span>
            </label>
          </div>
          <div class="dfd-infer-apis">${pagesHtml}</div>
        </div>`;
    }).join('');

    Modal.open({
      title: `🔮 자동 매핑 추론 (라우트 ${scanned.routes} + 페이지 ${scanned.pages} 파일 분석)`,
      compact: true,
      width: 820,
      confirmOnClose: true,
      body: `
        <div class="dfd-infer-body">
          <p style="font-size:12px;color:var(--text-2);margin:0 0 12px;line-height:1.6">
            💡 라우트 SQL 쿼리 + 페이지 API 호출을 분석한 결과입니다.
            체크된 항목만 일괄 적용되며, 부정확한 추론은 체크 해제하세요.
          </p>
          <div class="dfd-infer-toolbar">
            <button type="button" class="btn btn-ghost btn-sm" id="dfd-infer-select-all">모두 선택</button>
            <button type="button" class="btn btn-ghost btn-sm" id="dfd-infer-select-none">모두 해제</button>
            <span class="dfd-infer-counter" id="dfd-infer-counter"></span>
          </div>
          ${tableSuggestions.length > 0 ? `
            <div class="dfd-infer-section-header">
              🗄 테이블 → API 추론 (${tableSuggestions.length}개)
            </div>
            <div class="dfd-infer-list">${tableRows}</div>
          ` : ''}
          ${apiSuggestions.length > 0 ? `
            <div class="dfd-infer-section-header" style="margin-top:14px">
              ⚡ API → 페이지 추론 (${apiSuggestions.length}개)
            </div>
            <div class="dfd-infer-list">${apiRows}</div>
          ` : ''}
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="dfd-infer-cancel">취소</button>
        <button class="btn btn-primary" id="dfd-infer-apply">✨ 선택한 매핑 일괄 적용</button>
      `,
      bind: {
        '#dfd-infer-cancel': () => Modal.close(),
        '#dfd-infer-apply':  () => this._applyDfdInferenceUnified(tableSuggestions, apiSuggestions),
        '#dfd-infer-select-all':  () => this._toggleDfdInferenceAll(true),
        '#dfd-infer-select-none': () => this._toggleDfdInferenceAll(false),
      },
      onOpen: () => {
        // 행 체크박스 → 내부 체크박스 동기화
        document.querySelectorAll('.dfd-infer-row-cb').forEach(cb => {
          cb.addEventListener('change', e => {
            const card = e.target.closest('.dfd-infer-card');
            const selector = e.target.dataset.kind === 'table' ? '.dfd-infer-a2t-cb' : '.dfd-infer-p2a-cb';
            card.querySelectorAll(selector).forEach(c => { c.checked = e.target.checked; });
            this._updateDfdInferenceCounter();
          });
        });
        document.querySelectorAll('.dfd-infer-a2t-cb, .dfd-infer-p2a-cb').forEach(cb => {
          cb.addEventListener('change', () => this._updateDfdInferenceCounter());
        });
        this._updateDfdInferenceCounter();
      },
    });
  },

  _toggleDfdInferenceAll(value) {
    document.querySelectorAll('.dfd-infer-row-cb, .dfd-infer-a2t-cb, .dfd-infer-p2a-cb').forEach(cb => {
      cb.checked = value;
    });
    this._updateDfdInferenceCounter();
  },

  _updateDfdInferenceCounter() {
    const a2tChecked = document.querySelectorAll('.dfd-infer-a2t-cb:checked').length;
    const a2tTotal   = document.querySelectorAll('.dfd-infer-a2t-cb').length;
    const p2aChecked = document.querySelectorAll('.dfd-infer-p2a-cb:checked').length;
    const p2aTotal   = document.querySelectorAll('.dfd-infer-p2a-cb').length;
    const el = document.getElementById('dfd-infer-counter');
    if (el) {
      const parts = [];
      if (a2tTotal > 0) parts.push(`테이블→API ${a2tChecked}/${a2tTotal}`);
      if (p2aTotal > 0) parts.push(`API→페이지 ${p2aChecked}/${p2aTotal}`);
      el.textContent = '선택: ' + parts.join(' · ');
    }
  },

  async _applyDfdInferenceUnified(tableSuggestions, apiSuggestions) {
    // a2t (테이블 → APIs) 모음
    const a2tToApply = new Map();   // table_name → [api_key]
    document.querySelectorAll('.dfd-infer-a2t-cb:checked').forEach(cb => {
      const idx = parseInt(cb.dataset.suggestion);
      const s = tableSuggestions[idx];
      if (!s) return;
      if (!a2tToApply.has(s.table_name)) a2tToApply.set(s.table_name, []);
      a2tToApply.get(s.table_name).push(cb.value);
    });

    // p2a (API → pages) 모음
    const p2aToApply = new Map();   // api_id → [page_key]
    document.querySelectorAll('.dfd-infer-p2a-cb:checked').forEach(cb => {
      const idx = parseInt(cb.dataset.suggestion);
      const s = apiSuggestions[idx];
      if (!s) return;
      if (!p2aToApply.has(s.api_id)) p2aToApply.set(s.api_id, []);
      p2aToApply.get(s.api_id).push(cb.value);
    });

    if (a2tToApply.size === 0 && p2aToApply.size === 0) {
      Toast.info('선택된 항목이 없습니다.');
      return;
    }

    const btn = document.getElementById('dfd-infer-apply');
    if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }

    let okT = 0, failT = 0, okA = 0, failA = 0;
    for (const [tableName, apiKeys] of a2tToApply) {
      try {
        await API.request('POST', '/admin/dev/dfd-mappings', { table_name: tableName, api_keys: apiKeys });
        okT++;
      } catch (_) { failT++; }
    }
    for (const [apiId, pageKeys] of p2aToApply) {
      try {
        await API.request('POST', '/admin/dev/dfd-api-mappings', { api_id: apiId, page_keys: pageKeys });
        okA++;
      } catch (_) { failA++; }
    }

    Modal.close();
    const summary = [];
    if (okT > 0) summary.push(`테이블 ${okT}개`);
    if (okA > 0) summary.push(`API ${okA}개`);
    if (failT + failA === 0) {
      Toast.success(`자동 추론 완료: ${summary.join(' + ')} 매핑 저장됨`);
    } else {
      Toast.error(`성공: ${summary.join(' + ') || '0건'} · 실패: ${failT + failA}건`);
    }
    await this.renderDFD();
  },

  _highlightDFD(id, type) {
    const board = document.getElementById('dfd-board');
    if (!board) return;

    // 연결 관계 수집
    const related    = new Set();   // 1단계 연결 노드
    const activeEdgeKeys = new Set(); // "fromId→toId" 형태로 활성 엣지 식별

    const p2aAll = this._allP2A();
    const a2tAll = this._allA2T();
    if (type === 'page') {
      p2aAll.filter(([p]) => p === id).forEach(([, a]) => {
        related.add(a);
        activeEdgeKeys.add(`${id}→${a}`);
        a2tAll.filter(([ap]) => ap === a).forEach(([, t]) => {
          related.add(t);
          activeEdgeKeys.add(`${a}→${t}`);
        });
      });
    } else if (type === 'api') {
      p2aAll.filter(([, a]) => a === id).forEach(([p]) => {
        related.add(p);
        activeEdgeKeys.add(`${p}→${id}`);
      });
      a2tAll.filter(([a]) => a === id).forEach(([, t]) => {
        related.add(t);
        activeEdgeKeys.add(`${id}→${t}`);
      });
      // API → 외부 서비스 엣지도 강조
      (this.DFD.a2e || []).filter(([a]) => a === id).forEach(([, e]) => {
        related.add(e);
        activeEdgeKeys.add(`${id}→${e}`);
      });
    } else if (type === 'external') {
      // 외부 서비스 → 어떤 API 가 사용하는지 표시
      (this.DFD.a2e || []).filter(([, e]) => e === id).forEach(([a]) => {
        related.add(a);
        activeEdgeKeys.add(`${a}→${id}`);
        p2aAll.filter(([, ap]) => ap === a).forEach(([p]) => {
          related.add(p);
          activeEdgeKeys.add(`${p}→${a}`);
        });
      });
    } else {
      // table
      a2tAll.filter(([, t]) => t === id).forEach(([a]) => {
        related.add(a);
        activeEdgeKeys.add(`${a}→${id}`);
        p2aAll.filter(([, ap]) => ap === a).forEach(([p]) => {
          related.add(p);
          activeEdgeKeys.add(`${p}→${a}`);
        });
      });
    }

    // ── 노드 클래스 적용 ────────────────────────────────────
    board.querySelectorAll('.dfd-node').forEach(el => {
      const nid = el.dataset.id;
      el.classList.remove('dfd-active', 'dfd-related', 'dfd-dimmed');
      if (nid === id)           el.classList.add('dfd-active');
      else if (related.has(nid)) el.classList.add('dfd-related');
      else                       el.classList.add('dfd-dimmed');
    });

    // ── 엣지 클래스 적용 ────────────────────────────────────
    const svg = document.getElementById('dfd-svg');
    if (svg) {
      svg.querySelectorAll('.dfd-edge').forEach(edge => {
        const key = `${edge.dataset.from}→${edge.dataset.to}`;
        edge.classList.remove('dfd-active', 'dfd-dimmed');
        if (activeEdgeKeys.has(key)) {
          edge.classList.add('dfd-active');
          edge.setAttribute('marker-end', 'url(#arr-a)');
        } else {
          edge.classList.add('dfd-dimmed');
          edge.setAttribute('marker-end', '');
        }
      });
    }
  },

  _clearDFDHighlight() {
    const board = document.getElementById('dfd-board');
    if (board) {
      board.querySelectorAll('.dfd-node').forEach(el =>
        el.classList.remove('dfd-active', 'dfd-related', 'dfd-dimmed'));
    }
    const svg = document.getElementById('dfd-svg');
    if (svg) {
      svg.querySelectorAll('.dfd-edge').forEach(el => {
        el.classList.remove('dfd-active', 'dfd-dimmed');
        el.setAttribute('marker-end', 'url(#arr-n)');
      });
    }
    const impact = document.getElementById('dfd-impact');
    if (impact) impact.style.display = 'none';
    this.dfdSelected = null;
  },

  // 정적 a2t + 동적 a2t 합본 (영향도 분석에서 사용)
  _allA2T() {
    return [...this.DFD.a2t, ...(this._dynamicA2T || [])];
  },
  // 정적 p2a + 동적 p2a 합본 (API→Page 매핑 + Page→API 매핑 모두 포함)
  _allP2A() {
    return [...this.DFD.p2a, ...(this._dynamicP2A || []), ...(this._dynamicPageP2A || [])];
  },
  // tbl-auto-xxx ID 에 대응하는 동적 항목 객체 lookup (catalog 에는 없음)
  _findTableById(id) {
    const fromCatalog = this.DFD.tables.find(t => t.id === id);
    if (fromCatalog) return fromCatalog;
    // 동적 항목은 _dynamicTables 에 저장될 수 있도록 추후 확장 가능
    // 현재는 라벨 추론
    if (id.startsWith('tbl-auto-')) {
      const label = id.slice('tbl-auto-'.length).replace(/-/g, '_');
      return { id, label, cols: [] };
    }
    return null;
  },

  _showImpact(id, type) {
    const panel = document.getElementById('dfd-impact');
    const title = document.getElementById('dfd-impact-title');
    const body  = document.getElementById('dfd-impact-body');
    panel.style.display = '';

    let nodeLabel = '';
    let pages = [], apis = [], tables = [], externals = [];

    const a2tAll = this._allA2T();   // 정적 + 동적 매핑 통합 (a2t)
    const p2aAll = this._allP2A();   // 정적 + 동적 매핑 통합 (p2a)
    const a2eAll = this.DFD.a2e || [];

    // 동적 API 노드를 위한 lookup
    const _findApiById = (apiId) => this.DFD.apis.find(x => x.id === apiId)
      || (apiId.startsWith('api-') ? { id: apiId, label: '/api/' + apiId.slice(4), method: 'CRUD' } : null);
    const _findExtById = (extId) => this.DFD.external?.find(x => x.id === extId);

    if (type === 'page') {
      const pg = this.DFD.pages.find(p=>p.id===id);
      nodeLabel = `${pg?.icon} ${pg?.label}`;
      apis = p2aAll.filter(([p])=>p===id).map(([,a])=>_findApiById(a)).filter(Boolean);
      apis.forEach(a => {
        a2tAll.filter(([ap])=>ap===a.id).forEach(([,t])=>{
          const tbl = this._findTableById(t);
          if (tbl && !tables.find(x=>x.id===t)) tables.push(tbl);
        });
        a2eAll.filter(([ap])=>ap===a.id).forEach(([,e])=>{
          const ext = _findExtById(e);
          if (ext && !externals.find(x=>x.id===e)) externals.push(ext);
        });
      });
    } else if (type === 'api') {
      const ap = _findApiById(id);
      nodeLabel = ap?.label;
      pages = p2aAll.filter(([,a])=>a===id).map(([p])=>this.DFD.pages.find(x=>x.id===p)).filter(Boolean);
      tables = a2tAll.filter(([a])=>a===id).map(([,t])=>this._findTableById(t)).filter(Boolean);
      externals = a2eAll.filter(([a])=>a===id).map(([,e])=>_findExtById(e)).filter(Boolean);
    } else if (type === 'external') {
      const ext = _findExtById(id);
      nodeLabel = `${ext?.icon || '🌐'} ${ext?.label || id}`;
      // 외부 → API → Page 역추적
      const linkedApis = a2eAll.filter(([,e])=>e===id).map(([a])=>_findApiById(a)).filter(Boolean);
      apis = linkedApis;
      linkedApis.forEach(a => {
        p2aAll.filter(([,ap])=>ap===a.id).forEach(([p])=>{
          const pg = this.DFD.pages.find(x=>x.id===p);
          if (pg && !pages.find(x=>x.id===p)) pages.push(pg);
        });
      });
      // 외부는 자체 정보 표시 + 자동 발견된 사용처 파일
      title.textContent = `영향도: ${nodeLabel}`;
      // 사용처 파일 — node element 의 data-evidence 속성에서 추출
      const node = document.querySelector(`.dfd-node-external[data-id="${id}"]`);
      const evidenceFiles = node?.dataset.evidence ? node.dataset.evidence.split('|').filter(Boolean) : [];
      body.innerHTML = `
        <div class="impact-section">
          <div class="impact-label">🌐 외부 서비스 정보</div>
          <div style="font-size:11px;color:var(--text-2);line-height:1.7">
            <strong>카테고리:</strong> ${esc(ext?.category || '-')}<br>
            <strong>URL:</strong> <code style="font-size:10px">${esc(ext?.url || '-')}</code><br>
            <strong>코드 사용처:</strong> ${evidenceFiles.length > 0
              ? `<span style="color:#10b981">✓ ${evidenceFiles.length}개 파일에서 자동 발견</span>`
              : `<span style="color:var(--text-3)">코드에서 사용 미확인</span>`}
          </div>
        </div>
        ${evidenceFiles.length > 0 ? `<div class="impact-section">
          <div class="impact-label">📁 사용 파일</div>
          ${evidenceFiles.map(f=>`<div class="impact-item" style="font-family:monospace;font-size:10px">${esc(f)}</div>`).join('')}
        </div>` : ''}
        ${apis.length ? `<div class="impact-section">
          <div class="impact-label impact-api">⚡ 사용 API (${apis.length}개)</div>
          ${apis.map(a=>`<div class="impact-item">${esc(a.label)}</div>`).join('')}
        </div>` : ''}
        ${pages.length ? `<div class="impact-section">
          <div class="impact-label impact-page">🖥️ 간접 영향 화면 (${pages.length}개)</div>
          ${pages.map(p=>`<div class="impact-item">${p.icon} ${esc(p.label)}</div>`).join('')}
        </div>` : ''}
      `;
      return;
    } else {
      const tbl = this._findTableById(id);
      nodeLabel = `🗄️ ${tbl?.label}`;
      apis = a2tAll.filter(([,t])=>t===id).map(([a])=>_findApiById(a)).filter(Boolean);
      apis.forEach(a => {
        p2aAll.filter(([,ap])=>ap===a.id).forEach(([p])=>{
          const pg = this.DFD.pages.find(x=>x.id===p);
          if (pg && !pages.find(x=>x.id===p)) pages.push(pg);
        });
      });
      // 컬럼 목록
      const colList = tbl?.cols.map(c=>`<span class="dev-chip">${esc(c)}</span>`).join('') || '';
      body.innerHTML = `
        <div class="impact-section"><div class="impact-label">📌 컬럼 목록</div><div>${colList}</div></div>
        <div class="impact-section"><div class="impact-label impact-api">⚡ 영향 API (${apis.length}개)</div>
          ${apis.map(a=>`<div class="impact-item">${esc(a.label)}</div>`).join('')}</div>
        <div class="impact-section"><div class="impact-label impact-page">🖥️ 영향 화면 (${pages.length}개)</div>
          ${pages.map(p=>`<div class="impact-item">${p.icon} ${esc(p.label)}</div>`).join('')}</div>
      `;
      title.textContent = `영향도: ${nodeLabel}`;
      return;
    }

    title.textContent = `영향도: ${nodeLabel}`;
    body.innerHTML = `
      ${pages.length ? `<div class="impact-section">
        <div class="impact-label impact-page">🖥️ 관련 화면 (${pages.length}개)</div>
        ${pages.map(p=>`<div class="impact-item">${p.icon} ${esc(p.label)}</div>`).join('')}
      </div>` : ''}
      ${apis.length ? `<div class="impact-section">
        <div class="impact-label impact-api">⚡ 관련 API (${apis.length}개)</div>
        ${apis.map(a=>`<div class="impact-item">${esc(a.label)}</div>`).join('')}
      </div>` : ''}
      ${tables.length ? `<div class="impact-section">
        <div class="impact-label impact-table">🗄️ 관련 테이블 (${tables.length}개)</div>
        ${tables.map(t=>`<div class="impact-item">${esc(t.label)}</div>`).join('')}
      </div>` : ''}
      ${externals.length ? `<div class="impact-section">
        <div class="impact-label impact-external">🌐 관련 외부 서비스 (${externals.length}개)</div>
        ${externals.map(e=>`<div class="impact-item">${e.icon} ${esc(e.label)} <span style="color:var(--text-3);font-size:10px">(${esc(e.category)})</span></div>`).join('')}
      </div>` : ''}
    `;
  },

  // ══════════════════════════════════════════════════════════
  // TAB 3: DB 스키마 인스펙터
  // ══════════════════════════════════════════════════════════
  async loadSchema() {
    try {
      const r = await API.get('/admin/dev/schema');
      this.schema = r.data || {};
      // 인덱스·FK 정보도 함께 로드 (카드 상세 모달에서 사용)
      // 연관도(🗺️) 버튼을 클릭하지 않아도 "인덱스" 컬럼이 정상 표시되도록
      await this._loadSchemaRelations();
    } catch (e) { this.schema = {}; }
  },

  renderSchema() {
    const tables = Object.entries(this.schema);
    // Reset map state when re-rendering tab
    this.schemaMap.visible  = false;
    this.schemaMap.editMode = false;
    // 이전 오버레이 body에서 제거 (탭 재진입 시 중복 방지)
    document.getElementById('schema-detail-overlay')?.remove();

    // 미분류 테이블 감지 (연관도 레이아웃에 없는 테이블)
    const uncategorized = this._getUncategorizedTables();
    const uncatBanner = uncategorized.length > 0 ? `
      <details class="dfd-warn dfd-warn-info" style="margin-bottom:12px">
        <summary>
          ⚠️ 연관도 카테고리 미분류: <strong>${uncategorized.length}개 테이블</strong>
          <span class="dfd-warn-hint">(클릭하여 상세 보기)</span>
        </summary>
        <div class="dfd-warn-body">
          <div class="dfd-warn-row">
            <strong>📌 카테고리 미정의 테이블:</strong>
            <code>${uncategorized.map(esc).join(', ')}</code>
            <div class="dfd-warn-tip">
              💡 <code>dev.js</code> 의 <code>_SCHEMA_LAYOUT</code> 배열에 추가하면
              카테고리 색상·위치가 적용됩니다. (인스펙터·연관도·DFD 셋 다 자동 반영)
            </div>
          </div>
        </div>
      </details>` : '';

    document.getElementById('dev-content').innerHTML = `
      <div class="dev-section-header">
        <div>
          <h3 style="margin:0;font-size:15px">DB 스키마 인스펙터</h3>
          <p style="margin:4px 0 0;font-size:12px;color:var(--text-3)">
            ${tables.length}개 테이블 · information_schema 실시간 조회
            ${uncategorized.length > 0 ? `<span style="color:#b45309;font-weight:600;margin-left:6px">(미분류 ${uncategorized.length}개)</span>` : ''}
          </p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input type="text" id="schema-search" class="search-input" style="width:180px" placeholder="테이블·컬럼 검색...">
          <!-- WS 상태 표시 + 동기화 버튼 -->
          <span id="schema-ws-status" class="schema-ws-dot" title="WebSocket 연결 상태">
            <span class="schema-ws-indicator"></span>
            <span class="schema-ws-label">연결 확인 중</span>
          </span>
          <button id="schema-sync-btn" class="btn btn-ghost btn-sm schema-sync-btn" title="스키마를 DB와 수동 동기화">
            🔄 스키마 동기화
          </button>
          <button id="schema-history-btn" class="btn btn-ghost btn-sm" title="스키마 변경 이력 조회">
            📜 변경 이력
          </button>
          <button id="schema-map-toggle" class="btn btn-secondary btn-sm" style="display:flex;align-items:center;gap:5px">
            🗺️ 연관도
          </button>
        </div>
      </div>

      ${uncatBanner}

      <!-- ① 리스트 뷰 -->
      <div id="schema-list-wrap">
        <!-- 범례 -->
        <div style="display:flex;gap:14px;font-size:11px;color:var(--text-3);margin:0 4px 10px;flex-wrap:wrap">
          <span>🔑 <strong>PK</strong> 기본키</span>
          <span>🔗 <strong>FK</strong> 외래키 (참조)</span>
          <span><span style="color:#E63329;font-weight:700">*</span> <strong>필수</strong> NOT NULL</span>
          <span><span style="color:#9CA3AF;font-style:italic">null</span> <strong>NULL 허용</strong> (값 없어도 OK)</span>
        </div>
        <div class="schema-grid" id="schema-grid">
          ${tables.map(([tname, tdata]) => {
            // 실제 FK 컬럼 Set
            const _fkCols = new Set(
              (this.schemaMap.fks || []).filter(f => f.TABLE_NAME === tname).map(f => f.COLUMN_NAME)
            );
            return `
            <div class="schema-card" data-table="${esc(tname)}" style="cursor:pointer" title="클릭하여 상세보기">
              <div class="schema-card-header">
                <span class="schema-table-name">🗄️ ${esc(tname)}</span>
                <span class="schema-drift-badge" style="display:none" title="동기화 전 변경 감지됨">변경됨</span>
                <span class="schema-meta">${tdata.columns.length} cols</span>
              </div>
              <div class="schema-cols">
                ${tdata.columns.slice(0,8).map(c => {
                  const isPK = c.COLUMN_KEY === 'PRI';
                  const isFK = _fkCols.has(c.COLUMN_NAME);
                  return `
                  <div class="schema-col ${isPK?'pk':isFK?'fk':''}">
                    <span class="schema-col-name">${isPK?'🔑 ':isFK?'🔗 ':'   '}${esc(c.COLUMN_NAME)}</span>
                    <span class="schema-col-type">${esc(c.COLUMN_TYPE)}</span>
                    <span class="schema-col-null" title="${c.IS_NULLABLE==='YES'?'NULL 허용 (값이 비어도 OK)':'NOT NULL — 필수 입력'}">
                      ${c.IS_NULLABLE==='YES'
                        ? '<span style="color:#9CA3AF;font-size:9px;font-style:italic">null</span>'
                        : '<span style="color:#E63329;font-weight:700" title="필수">*</span>'}
                    </span>
                  </div>`;
                }).join('')}
                ${tdata.columns.length > 8 ? `<div class="schema-col" style="justify-content:center;color:var(--text-3);font-size:11px">+${tdata.columns.length-8}개 더...</div>` : ''}
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>

      <!-- ② 연관도 뷰 (기본 숨김) -->
      <div id="schema-map-wrap" style="display:none;margin-top:12px">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
          <button id="schema-edit-btn" class="btn btn-secondary btn-sm">✏️ 편집</button>
          <button id="schema-zoom-in"    class="btn btn-ghost btn-sm">🔍+</button>
          <button id="schema-zoom-out"   class="btn btn-ghost btn-sm">🔍−</button>
          <button id="schema-zoom-reset" class="btn btn-ghost btn-sm">⟳ 초기화</button>
          <div class="dropdown" style="position:relative;display:inline-block">
            <button id="schema-export-btn" class="btn btn-ghost btn-sm">📥 내보내기 ▾</button>
            <div id="schema-export-menu" style="display:none;position:absolute;top:100%;right:0;
                 margin-top:4px;background:var(--surface);border:1px solid var(--border);border-radius:6px;
                 box-shadow:0 4px 12px rgba(0,0,0,.1);min-width:180px;z-index:100;padding:4px 0">
              <button data-export="pdf"  class="schema-export-item">📄 PDF (스크린샷)</button>
              <button data-export="pptx" class="schema-export-item">📊 PPTX (스크린샷)</button>
              <button data-export="docx" class="schema-export-item">📝 DOCX (정의서)</button>
            </div>
          </div>
          <span id="schema-edit-toolbar" style="display:none;gap:8px">
            <button id="schema-add-col-btn" class="btn btn-primary btn-sm">+ 컬럼 추가</button>
            <button id="schema-edit-exit"   class="btn btn-ghost btn-sm">✕ 편집 종료</button>
          </span>
          <span style="margin-left:auto;font-size:11px;color:var(--text-3);display:flex;align-items:center;gap:14px;flex-wrap:wrap">
            <span style="display:inline-flex;align-items:center;gap:5px">
              <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#1664E5" stroke-width="2"/></svg>
              실제 FK
            </span>
            <span style="display:inline-flex;align-items:center;gap:5px">
              <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#5B8DEF" stroke-width="1.5" stroke-dasharray="5,3"/></svg>
              논리 참조 (FK 미등록)
            </span>
            <span>🖱 스크롤: 줌 · 드래그: 이동</span>
          </span>
        </div>
        <div class="schema-map-viewport" id="schema-map-viewport">
          <div class="schema-map-canvas" id="schema-map-canvas">
            <svg class="schema-map-svg" id="schema-map-svg" style="position:absolute;top:0;left:0;pointer-events:none;overflow:visible"></svg>
          </div>
          <div id="schema-map-loading" style="display:none;position:absolute;inset:0;align-items:center;justify-content:center;gap:10px;background:rgba(0,0,0,.4);color:#fff;font-size:14px;z-index:10">
            ⏳ 연관도 로딩 중...
          </div>
        </div>
        <div style="display:flex;gap:20px;margin-top:8px;font-size:11px;color:var(--text-3);flex-wrap:wrap">
          <span>🟥 CRM 핵심</span><span>🟧 일정/회의</span><span>🟩 게시판</span>
          <span>🟦 인증/사용자</span><span>🟪 AI/관리</span><span>🟫 Google</span>
          <span style="margin-left:auto;color:#1664E5">── 실제 FK</span>
          <span style="color:#5B8DEF">- - 소프트 FK (추론)</span>
        </div>
      </div>

      <!-- ③ 영향도 분석 패널 -->
      <div id="schema-impact-wrap" style="display:none;margin-top:12px"></div>

      <!-- ④ 상세 팝업 (body에 직접 append — z-index 보장) -->
      <div id="schema-detail-overlay" class="schema-detail-overlay" style="display:none" role="dialog">
        <div class="schema-detail-modal">
          <div class="schema-detail-head">
            <div>
              <div id="schema-detail-title" class="schema-detail-title"></div>
              <div id="schema-detail-subtitle" class="schema-detail-subtitle"></div>
            </div>
            <button id="schema-detail-close" class="btn btn-ghost btn-sm" style="font-size:16px;line-height:1">✕</button>
          </div>
          <div id="schema-detail-body" class="schema-detail-body" style="padding:0"></div>
        </div>
      </div>
    `;

    // ── 이벤트 바인딩 ──────────────────────────────────────
    // 검색
    document.getElementById('schema-search')?.addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('.schema-card').forEach(card => {
        card.style.display = (!q || card.textContent.toLowerCase().includes(q)) ? '' : 'none';
      });
    });

    // 리스트 카드 클릭 → 상세 팝업
    document.getElementById('schema-grid')?.addEventListener('click', e => {
      const card = e.target.closest('.schema-card');
      if (card) this.showSchemaDetail(card.dataset.table);
    });

    // 연관도 토글
    document.getElementById('schema-map-toggle')?.addEventListener('click', () => this._toggleSchemaMap());

    // 스키마 동기화 버튼
    document.getElementById('schema-sync-btn')?.addEventListener('click', () => this._syncSchema());
    document.getElementById('schema-history-btn')?.addEventListener('click', () => this._openSchemaHistoryModal());

    // 상세 팝업 → body로 이동 (z-index 완전 보장)
    const _overlay = document.getElementById('schema-detail-overlay');
    if (_overlay) {
      document.body.appendChild(_overlay);
      document.getElementById('schema-detail-close')?.addEventListener('click', () => {
        _overlay.style.display = 'none';
      });
      _overlay.addEventListener('click', e => {
        if (e.target === _overlay) _overlay.style.display = 'none';
      });
    }

    // 초기 스냅샷 저장 + WS 연결 상태 반영
    this._takeSchemaSnap();
    this._updateWsStatus();
  },

  // ══════════════════════════════════════════════════════════
  // 연관도 토글
  // ══════════════════════════════════════════════════════════
  async _toggleSchemaMap() {
    const sm = this.schemaMap;
    sm.visible = !sm.visible;
    const mapWrap   = document.getElementById('schema-map-wrap');
    const listWrap  = document.getElementById('schema-list-wrap');
    const toggleBtn = document.getElementById('schema-map-toggle');
    const searchEl  = document.getElementById('schema-search');

    if (sm.visible) {
      mapWrap.style.display  = '';
      listWrap.style.display = 'none';
      if (searchEl) searchEl.style.display = 'none';
      toggleBtn.textContent = '📋 목록';
      toggleBtn.classList.add('active');

      // 로딩 표시
      const loadEl = document.getElementById('schema-map-loading');
      if (loadEl) loadEl.style.display = 'flex';

      await this._loadSchemaRelations();

      if (loadEl) loadEl.style.display = 'none';

      this._getDefaultPositions();
      this._drawSchemaNodes();
      // ⚠️ 편집 버튼 바인딩은 즉시 (rAF 의존 X → 클릭 안 먹는 문제 해결)
      this._bindSchemaMapButtons();
      // edges after layout settle
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this._drawSchemaEdges();
          this._initSchemaInteractions();
        });
      });
    } else {
      mapWrap.style.display  = 'none';
      listWrap.style.display = '';
      if (searchEl) searchEl.style.display = '';
      toggleBtn.textContent = '🗺️ 연관도';
      toggleBtn.classList.remove('active');
      sm.editMode  = false;
      sm._dragNode = null;
      sm._panning  = false;
    }
  },

  // ── FK·인덱스 로드 ────────────────────────────────────────
  async _loadSchemaRelations() {
    try {
      const r = await API.get('/admin/dev/schema-relations');
      const d = r.data || {};

      // 인덱스 배열 → 테이블별 맵 { tableName: [{...},...] }
      const idxMap = {};
      (d.indexes || []).forEach(idx => {
        if (!idxMap[idx.TABLE_NAME]) idxMap[idx.TABLE_NAME] = [];
        idxMap[idx.TABLE_NAME].push(idx);
      });
      this.schemaMap.indexes = idxMap;

      // ⚠️ 실제 FK + 논리적 추론 FK를 모두 합쳐서 표시 (무결성 시각화)
      // 이전엔 실제 FK가 있으면 추론을 건너뛰어 13개 논리 관계가 누락됨
      const realFks = (d.fks || []).map(f => ({ ...f, _inferred: false }));
      const realKeys = new Set(realFks.map(f => `${f.TABLE_NAME}.${f.COLUMN_NAME}`));
      const inferredAll = this._inferFKRelations();
      const inferredOnly = inferredAll
        .filter(f => !realKeys.has(`${f.TABLE_NAME}.${f.COLUMN_NAME}`))
        .map(f => ({ ...f, _inferred: true }));
      this.schemaMap.fks = [...realFks, ...inferredOnly];
    } catch (e) {
      console.warn('schema-relations 로드 실패:', e);
      this.schemaMap.fks     = this._inferFKRelations();
      this.schemaMap.indexes = {};
    }
  },

  // ── 컬럼명 패턴으로 FK 관계 추론 ─────────────────────────
  // DB에 명시적 FK 제약이 없을 때 fallback으로 사용
  _inferFKRelations() {
    const tables = Object.keys(this.schema);
    const tableSet = new Set(tables);

    // 알려진 컬럼→테이블 매핑 (소프트 FK) — 무결성 검수로 보완
    const KNOWN = {
      lead_id:            { table: 'leads',           col: 'id' },
      customer_id:        { table: 'customers',       col: 'id' },
      project_id:         { table: 'projects',        col: 'id' },
      user_id:            { table: 'users',           col: 'id' },
      product_id:         { table: 'products',        col: 'id' },
      assigned_to:        { table: 'team_members',    col: 'id' },
      created_by:         { table: 'users',           col: 'id' },
      performed_by:       { table: 'team_members',    col: 'id' },
      detected_by:        { table: 'team_members',    col: 'id' },
      generated_by:       { table: 'team_members',    col: 'id' },
      resolved_by:        { table: 'team_members',    col: 'id' },
      calendar_event_id:  { table: 'calendar_events', col: 'id' },
      announcement_id:    { table: 'announcements',   col: 'id' },
      viewer_id:          { table: 'users',           col: 'id' },
      meeting_minutes_id: { table: 'meeting_minutes', col: 'id' },
    };

    const fks = [];
    const seen = new Set();

    tables.forEach(tname => {
      const cols = this.schema[tname]?.columns || [];
      cols.forEach(c => {
        const colName = c.COLUMN_NAME;
        let ref = null;

        if (KNOWN[colName]) {
          ref = KNOWN[colName];
        } else if (colName.endsWith('_id') && colName !== 'id') {
          // xxx_id → 후보 테이블: xxx + 's', xxx
          const base = colName.slice(0, -3);           // strip '_id'
          const candidates = [base + 's', base, base.replace(/_/g, '') + 's'];
          for (const c2 of candidates) {
            if (tableSet.has(c2)) { ref = { table: c2, col: 'id' }; break; }
          }
        }

        if (ref && tableSet.has(ref.table) && ref.table !== tname) {
          const key = `${tname}.${colName}→${ref.table}`;
          if (!seen.has(key)) {
            seen.add(key);
            fks.push({
              TABLE_NAME:             tname,
              COLUMN_NAME:            colName,
              CONSTRAINT_NAME:        `(inferred) ${tname}_${colName}_fk`,
              REFERENCED_TABLE_NAME:  ref.table,
              REFERENCED_COLUMN_NAME: ref.col,
              UPDATE_RULE:            '—',
              DELETE_RULE:            '—',
            });
          }
        }
      });
    });

    return fks;
  },

  // 카테고리 레이아웃 — _getDefaultPositions() 와 renderSchema() 양쪽에서 사용
  _SCHEMA_LAYOUT: [
    ['leads','customers','activities','projects'],
    ['calendar_events','meeting_minutes','products','cost_history'],
    ['announcements','announcement_views','comments','faq'],
    ['users','refresh_tokens','token_blacklist','team_members'],
    ['ai_usage','token_recharge_log','dev_features','system_settings','access_logs','google_oauth_tokens','google_meet_sessions'],
  ],

  // 레이아웃에 정의된 테이블 Set (카테고리화됨)
  _getCategorizedTableSet() {
    return new Set(this._SCHEMA_LAYOUT.flat());
  },

  // 라이브 스키마의 미분류 테이블 (레이아웃에 없는 신규 테이블) 리스트
  _getUncategorizedTables() {
    if (!this.schema) return [];
    const categorized = this._getCategorizedTableSet();
    return Object.keys(this.schema).filter(t => !categorized.has(t)).sort();
  },

  // ── 노드 초기 위치 계산 ───────────────────────────────────
  _getDefaultPositions() {
    const sm = this.schemaMap;
    const STORAGE_KEY = 'oci_schema_positions';
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch(_){}

    // 카테고리별 5열 배치 (단일 출처: _SCHEMA_LAYOUT)
    const layout = this._SCHEMA_LAYOUT;
    const NODE_W = 250, GAP_X = 70, GAP_Y = 40;

    const positions = {};
    layout.forEach((col, ci) => {
      let y = 30;
      col.forEach(tname => {
        const nCols = this.schema[tname]?.columns?.length || 4;
        const h = 40 + Math.min(nCols, 10) * 26 + 12;
        positions[tname] = saved[tname] || { x: 30 + ci * (NODE_W + GAP_X), y };
        y += h + GAP_Y;
      });
    });
    // 레이아웃에 없는 테이블 (신규 추가 테이블): 기존 열 오른쪽에 배치
    const layoutCols = layout.length;
    const fallbackX = 30 + layoutCols * (NODE_W + GAP_X);  // 기존 열 오른쪽
    let fallY = 30;
    Object.keys(this.schema).forEach(tname => {
      if (!positions[tname]) {
        positions[tname] = saved[tname] || { x: fallbackX, y: fallY };
        const nCols = this.schema[tname]?.columns?.length || 4;
        fallY += 40 + Math.min(nCols, 10) * 26 + 12 + GAP_Y;
      }
    });
    sm.positions = positions;
  },

  // ── 노드 DOM 생성 ─────────────────────────────────────────
  _drawSchemaNodes() {
    const sm = this.schemaMap;
    const canvas = document.getElementById('schema-map-canvas');
    if (!canvas) return;

    // 기존 노드 제거
    canvas.querySelectorAll('.schema-map-node').forEach(n => n.remove());

    const COLORS = {
      leads:'#E63329', customers:'#E63329', activities:'#E63329', projects:'#E63329',
      calendar_events:'#F59C00', meeting_minutes:'#F59C00', products:'#F59C00', cost_history:'#F59C00',
      announcements:'#17A85A', announcement_views:'#17A85A', comments:'#17A85A', faq:'#17A85A',
      users:'#1664E5', refresh_tokens:'#1664E5', token_blacklist:'#1664E5', team_members:'#1664E5',
      ai_usage:'#7C4DFF', token_recharge_log:'#7C4DFF', dev_features:'#7C4DFF',
      system_settings:'#6B7280', access_logs:'#6B7280',
      google_oauth_tokens:'#0F7A3F', google_meet_sessions:'#0F7A3F',
    };

    const categorized = this._getCategorizedTableSet();

    Object.entries(this.schema).forEach(([tname, tdata]) => {
      const pos   = sm.positions[tname] || { x:30, y:30 };
      const isUncategorized = !categorized.has(tname);
      const color = COLORS[tname] || (isUncategorized ? '#F59E0B' : '#6B7280');
      // TABLE_KO에 없는 신규 테이블: 테이블명에서 자동 추정 (snake_case → 공백)
      const koName = this.TABLE_KO[tname] || tname.replace(/_/g, ' ');
      const cols   = tdata.columns || [];

      const node = document.createElement('div');
      node.className   = 'schema-map-node' + (isUncategorized ? ' is-uncategorized' : '');
      node.dataset.table = tname;
      if (isUncategorized) node.title = '미분류 테이블 — _SCHEMA_LAYOUT 에 추가하면 색상·위치 분류 가능';
      node.style.cssText = `left:${pos.x}px;top:${pos.y}px`;

      // 실제 FK 컬럼 Set (이 테이블의 진짜 FK만)
      const _fkCols = new Set(
        this.schemaMap.fks.filter(f => f.TABLE_NAME === tname).map(f => f.COLUMN_NAME)
      );
      // 확장 상태 — Set 으로 노드별 expanded 관리
      if (!this.schemaMap._expandedNodes) this.schemaMap._expandedNodes = new Set();
      const isExpanded = this.schemaMap._expandedNodes.has(tname);
      const visibleCols = isExpanded ? cols : cols.slice(0, 10);
      const colRows = visibleCols.map(c => {
        const isPK  = c.COLUMN_KEY === 'PRI';
        const isFK  = _fkCols.has(c.COLUMN_NAME);   // MUL ≠ FK
        const isUNI = c.COLUMN_KEY === 'UNI';
        const badge = isPK  ? '<span class="schema-col-badge pk">PK</span>'
                    : isFK  ? '<span class="schema-col-badge fk">FK</span>'
                    : isUNI ? '<span class="schema-col-badge uni">U</span>' : '';
        const koCol = this._getColKo(tname, c.COLUMN_NAME);
        const colLabel = koCol
          ? `${esc(c.COLUMN_NAME)} <span style="color:var(--text-3);font-size:9px">(${esc(koCol)})</span>`
          : esc(c.COLUMN_NAME);
        const nnMark = (c.IS_NULLABLE === 'NO' && !isPK)
          ? '<span class="schema-col-badge nn" title="NOT NULL">NN</span>' : '';
        return `<div class="schema-map-col${isPK?' pk':isFK?' fk':''}" data-col="${esc(c.COLUMN_NAME)}">
          <span class="schema-map-col-icon">${isPK?'🔑':isFK?'🔗':''}</span>
          ${badge}
          <span class="schema-map-col-name">${colLabel}</span>
          <span class="schema-map-col-type">${esc(c.COLUMN_TYPE.split('(')[0])}</span>
          ${nnMark}
        </div>`;
      }).join('');

      const moreCount = cols.length - 10;
      // 확장 토글 푸터: 접기/펼치기 (단순 텍스트가 아닌 클릭 가능)
      const expandFooter = moreCount > 0 ? `
        <div class="schema-map-node-more" data-expand-table="${esc(tname)}"
             style="cursor:pointer;user-select:none"
             title="${isExpanded ? '컬럼 접기' : '나머지 ' + moreCount + '개 컬럼 보기'}">
          ${isExpanded ? '▲ 접기' : `+${moreCount}개 더... ▼`}
        </div>` : '';
      node.innerHTML = `
        <div class="schema-map-node-header" data-table="${esc(tname)}" style="background:${color}">
          <div>
            <div class="schema-map-node-name">${esc(tname)}</div>
            ${koName ? `<div class="schema-map-node-ko">${esc(koName)}</div>` : ''}
          </div>
          <span class="schema-map-node-badge">${cols.length}</span>
        </div>
        <div class="schema-map-node-cols">
          ${colRows}
          ${expandFooter}
        </div>
      `;
      canvas.appendChild(node);
    });

    // ── "+N개 더..." / "접기" 클릭 위임 (멱등 — 한 번만 바인딩) ──
    if (canvas.dataset.expandBound !== '1') {
      canvas.dataset.expandBound = '1';
      canvas.addEventListener('click', e => {
        const expandEl = e.target.closest('[data-expand-table]');
        if (!expandEl) return;
        e.stopPropagation();
        const tname = expandEl.dataset.expandTable;
        if (this.schemaMap._expandedNodes.has(tname)) {
          this.schemaMap._expandedNodes.delete(tname);
        } else {
          this.schemaMap._expandedNodes.add(tname);
        }
        // 노드 + 화살표 재렌더
        this._drawSchemaNodes();
        requestAnimationFrame(() => requestAnimationFrame(() => this._drawSchemaEdges()));
      });
    }
  },

  // ── FK 엣지 SVG 그리기 ────────────────────────────────────
  _drawSchemaEdges() {
    const sm     = this.schemaMap;
    const canvas = document.getElementById('schema-map-canvas');
    const svg    = document.getElementById('schema-map-svg');
    if (!canvas || !svg) return;

    // 노드 크기 측정 (offsetWidth가 0이면 getBoundingClientRect 사용)
    const getRect = (tname) => {
      const node = canvas.querySelector(`.schema-map-node[data-table="${tname}"]`);
      if (!node) return null;
      const x = parseFloat(node.style.left) || 0;
      const y = parseFloat(node.style.top)  || 0;
      let w = node.offsetWidth;
      let h = node.offsetHeight;
      if (!w || !h) {
        const bcr = node.getBoundingClientRect();
        w = bcr.width  || 220;
        h = bcr.height || 200;
      }
      return { x, y, w: w || 220, h: h || 200 };
    };

    // 캔버스 크기 계산 후 적용
    let maxX = 900, maxY = 700;
    canvas.querySelectorAll('.schema-map-node').forEach(node => {
      const x = (parseFloat(node.style.left) || 0) + (node.offsetWidth  || 220) + 60;
      const y = (parseFloat(node.style.top)  || 0) + (node.offsetHeight || 200) + 60;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    });
    canvas.style.width  = maxX + 'px';
    canvas.style.height = maxY + 'px';
    svg.style.width  = maxX + 'px';
    svg.style.height = maxY + 'px';
    svg.setAttribute('viewBox', `0 0 ${maxX} ${maxY}`);

    // 마커 + 기존 경로 초기화
    svg.innerHTML = `<defs>
      <marker id="smap-arrow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto" markerUnits="strokeWidth">
        <polygon points="0 0, 10 3.5, 0 7" fill="#5B8DEF"/>
      </marker>
    </defs>`;

    // 동일 소스→대상 중복 집계 (offset 처리용)
    const pairCount = {};
    sm.fks.forEach(fk => {
      const key = [fk.TABLE_NAME, fk.REFERENCED_TABLE_NAME].sort().join('|');
      pairCount[key] = (pairCount[key] || 0) + 1;
    });
    const pairIdx = {};

    sm.fks.forEach(fk => {
      const src = getRect(fk.TABLE_NAME);
      const dst = getRect(fk.REFERENCED_TABLE_NAME);
      if (!src || !dst) return;
      if (fk.TABLE_NAME === fk.REFERENCED_TABLE_NAME) return; // self-ref 무시

      const key = [fk.TABLE_NAME, fk.REFERENCED_TABLE_NAME].sort().join('|');
      pairIdx[key] = (pairIdx[key] || 0) + 1;
      const offset = (pairIdx[key] - 1) * 14 - ((pairCount[key] - 1) * 7); // 여러선 분산

      // 상대 위치에 따라 최적 연결점 선택
      const srcCx = src.x + src.w / 2;
      const dstCx = dst.x + dst.w / 2;
      const srcCy = src.y + src.h / 2;
      const dstCy = dst.y + dst.h / 2;

      let x1, y1, x2, y2, cp1x, cp1y, cp2x, cp2y;

      if (Math.abs(srcCx - dstCx) > Math.abs(srcCy - dstCy)) {
        // 주로 수평 배치: 오른쪽/왼쪽 엣지 사용
        if (srcCx < dstCx) {
          x1 = src.x + src.w;  y1 = src.y + src.h / 2 + offset;
          x2 = dst.x;           y2 = dst.y + dst.h / 2 + offset;
        } else {
          x1 = src.x;           y1 = src.y + src.h / 2 + offset;
          x2 = dst.x + dst.w;  y2 = dst.y + dst.h / 2 + offset;
        }
        const bend = Math.max(60, Math.abs(x2 - x1) * 0.4);
        cp1x = x1 + (srcCx < dstCx ?  bend : -bend); cp1y = y1;
        cp2x = x2 + (srcCx < dstCx ? -bend :  bend); cp2y = y2;
      } else {
        // 주로 수직 배치: 위/아래 엣지 사용
        if (srcCy < dstCy) {
          x1 = src.x + src.w / 2 + offset;  y1 = src.y + src.h;
          x2 = dst.x + dst.w / 2 + offset;  y2 = dst.y;
        } else {
          x1 = src.x + src.w / 2 + offset;  y1 = src.y;
          x2 = dst.x + dst.w / 2 + offset;  y2 = dst.y + dst.h;
        }
        const bend = Math.max(60, Math.abs(y2 - y1) * 0.4);
        cp1x = x1; cp1y = y1 + (srcCy < dstCy ?  bend : -bend);
        cp2x = x2; cp2y = y2 + (srcCy < dstCy ? -bend :  bend);
      }

      const isInferred = (fk.CONSTRAINT_NAME || '').startsWith('(inferred)');

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${x1},${y1} C ${cp1x},${cp1y} ${cp2x},${cp2y} ${x2},${y2}`);
      path.setAttribute('stroke', isInferred ? '#5B8DEF' : '#1664E5');
      path.setAttribute('stroke-width', isInferred ? '1.5' : '2');
      path.setAttribute('stroke-dasharray', isInferred ? '5,3' : 'none');
      path.setAttribute('fill', 'none');
      path.setAttribute('opacity', '0.75');
      path.setAttribute('marker-end', 'url(#smap-arrow)');
      path.style.pointerEvents = 'stroke';
      path.style.cursor = 'pointer';

      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `${fk.TABLE_NAME}.${fk.COLUMN_NAME} → ${fk.REFERENCED_TABLE_NAME}.${fk.REFERENCED_COLUMN_NAME}${isInferred ? ' (추론)' : ''}`;
      path.appendChild(title);
      svg.appendChild(path);
    });
  },

  // ── 줌/패닝/드래그 인터랙션 ──────────────────────────────
  _initSchemaInteractions() {
    const sm       = this.schemaMap;
    const viewport = document.getElementById('schema-map-viewport');
    const canvas   = document.getElementById('schema-map-canvas');
    if (!viewport || !canvas) return;

    const applyT = () => {
      canvas.style.transformOrigin = '0 0';
      canvas.style.transform = `translate(${sm.transform.x}px,${sm.transform.y}px) scale(${sm.transform.scale})`;
    };
    applyT();

    // 마우스 휠 → 줌
    viewport.addEventListener('wheel', e => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      sm.transform.scale = Math.min(2.5, Math.max(0.25, sm.transform.scale + delta));
      applyT();
    }, { passive: false });

    // mousedown → 노드 드래그 or 배경 패닝
    const onDown = e => {
      const header = e.target.closest('.schema-map-node-header');
      if (header) {
        e.preventDefault();
        const node = header.closest('.schema-map-node');
        sm._dragNode = {
          el: node,
          startMX: e.clientX,
          startMY: e.clientY,
          origX: parseInt(node.style.left),
          origY: parseInt(node.style.top),
          scale: sm.transform.scale,
        };
        node.style.zIndex = 50;
      } else if (!e.target.closest('.schema-map-node') && !e.target.closest('button')) {
        e.preventDefault();
        sm._panning  = true;
        sm._panStart = { mx: e.clientX, my: e.clientY, tx: sm.transform.x, ty: sm.transform.y };
      }
    };

    const onMove = e => {
      if (sm._dragNode) {
        const d  = sm._dragNode;
        const dx = (e.clientX - d.startMX) / d.scale;
        const dy = (e.clientY - d.startMY) / d.scale;
        const nx = Math.max(0, d.origX + dx);
        const ny = Math.max(0, d.origY + dy);
        d.el.style.left = nx + 'px';
        d.el.style.top  = ny + 'px';
        sm.positions[d.el.dataset.table] = { x: nx, y: ny };
        this._drawSchemaEdges();
      } else if (sm._panning && sm._panStart) {
        const ps = sm._panStart;
        sm.transform.x = ps.tx + (e.clientX - ps.mx);
        sm.transform.y = ps.ty + (e.clientY - ps.my);
        applyT();
      }
    };

    const onUp = () => {
      if (sm._dragNode) {
        sm._dragNode.el.style.zIndex = '';
        // 위치 저장
        try { localStorage.setItem('oci_schema_positions', JSON.stringify(sm.positions)); } catch(_){}
        sm._dragNode = null;
      }
      sm._panning  = false;
      sm._panStart = null;
    };

    viewport.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);

    // 노드 헤더 클릭 → 상세 팝업 (드래그 이동이 없을 때만)
    canvas.addEventListener('click', e => {
      const header = e.target.closest('.schema-map-node-header');
      if (header) {
        const tname = header.dataset.table;
        if (tname) this.showSchemaDetail(tname);
      }
    });

    // 줌 버튼
    document.getElementById('schema-zoom-in')?.addEventListener('click', () => {
      sm.transform.scale = Math.min(2.5, sm.transform.scale + 0.2); applyT();
    });
    document.getElementById('schema-zoom-out')?.addEventListener('click', () => {
      sm.transform.scale = Math.max(0.25, sm.transform.scale - 0.2); applyT();
    });
    document.getElementById('schema-zoom-reset')?.addEventListener('click', () => {
      sm.transform = { x:0, y:0, scale:1 }; applyT();
    });
  },

  // ── 편집 버튼 바인딩 (멱등 — 중복 호출 안전) ─────────────────
  _bindSchemaMapButtons() {
    const btn = document.getElementById('schema-edit-btn');
    if (btn && btn.dataset.bound !== '1') {
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        if (!this.schemaMap.editMode) this._enterEditMode();
        else this._exitEditMode();
      });
    }

    // 내보내기 드롭다운 (멱등)
    const expBtn  = document.getElementById('schema-export-btn');
    const expMenu = document.getElementById('schema-export-menu');
    if (expBtn && expBtn.dataset.bound !== '1') {
      expBtn.dataset.bound = '1';
      expBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        expMenu.style.display = expMenu.style.display === 'none' ? 'block' : 'none';
      });
      document.addEventListener('click', () => { if (expMenu) expMenu.style.display = 'none'; });
      expMenu?.querySelectorAll('[data-export]').forEach(b => {
        b.addEventListener('click', () => {
          expMenu.style.display = 'none';
          this._exportSchema(b.dataset.export);
        });
      });
    }
  },

  // ── 스키마 내보내기 (PDF / PPTX / DOCX) ─────────────────────
  async _exportSchema(fmt) {
    if (fmt === 'docx') return this._exportDocx();
    if (fmt === 'pdf')  return this._exportPdf();
    if (fmt === 'pptx') return this._exportPptx();
  },

  // DOCX — 서버 생성 (표지 + 목차 + 테이블별 상세)
  async _exportDocx() {
    Toast.info('📝 DOCX 정의서 생성 중...');
    try {
      const token = localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token');
      const r = await fetch('/api/admin/dev/schema/export/docx', {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!r.ok) throw new Error('서버 응답 ' + r.status);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `핑거세일즈_AI_DB_테이블_정의서_${new Date().toISOString().slice(0,10)}.docx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      Toast.success('✅ DOCX 다운로드 완료');
    } catch (e) { Toast.error('DOCX 생성 실패: ' + e.message); }
  },

  // 외부 라이브러리 동적 로드 헬퍼
  _loadScript(src) {
    return new Promise((resolve, reject) => {
      const exists = Array.from(document.scripts).find(s => s.src === src);
      if (exists) return resolve();
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('스크립트 로드 실패: ' + src));
      document.head.appendChild(s);
    });
  },

  // 연관도 캔버스를 이미지로 캡처 (PDF/PPTX 공통)
  // ⚠️ 우측 잘림 방지: 모든 노드 정규화 + 충분한 패딩 + SVG 동기화
  async _captureSchemaCanvas() {
    await this._loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    const wrap     = document.getElementById('schema-map-canvas');
    const viewport = document.getElementById('schema-map-viewport');
    const svg      = document.getElementById('schema-map-svg');
    if (!wrap) throw new Error('캔버스를 찾을 수 없습니다');

    // 1) zoom/pan 일시 리셋
    const oldTransform   = wrap.style.transform;
    const oldOverflow    = viewport?.style.overflow;
    const oldWidth       = wrap.style.width;
    const oldHeight      = wrap.style.height;
    const oldSvgW        = svg?.style.width;
    const oldSvgH        = svg?.style.height;
    const oldSvgViewBox  = svg?.getAttribute('viewBox');
    wrap.style.transform = 'none';
    if (viewport) viewport.style.overflow = 'visible';

    const PAD = 60;
    const nodes = wrap.querySelectorAll('.schema-map-node');
    if (!nodes.length) throw new Error('연관도 노드가 없습니다');

    // 2) 모든 노드 좌표 측정 + 정규화 (음수 → 0+pad, 우측까지 모두 포함)
    let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
    const nodeData = [];
    nodes.forEach(n => {
      const x = parseFloat(n.style.left) || 0;
      const y = parseFloat(n.style.top)  || 0;
      const w = n.offsetWidth  || 220;
      const h = n.offsetHeight || 200;
      nodeData.push({ n, x, y, w, h });
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + w > maxX) maxX = x + w;
      if (y + h > maxY) maxY = y + h;
    });

    // 3) 모든 노드를 음수 없는 좌표로 정규화 (offset 적용)
    const offsetX = (-minX) + PAD;
    const offsetY = (-minY) + PAD;
    const totalW  = (maxX - minX) + PAD * 2;
    const totalH  = (maxY - minY) + PAD * 2;

    const originalPos = nodeData.map(d => ({ n: d.n, x: d.x, y: d.y }));
    nodeData.forEach(d => {
      d.n.style.left = (d.x + offsetX - PAD) + 'px';
      d.n.style.top  = (d.y + offsetY - PAD) + 'px';
    });

    // 4) 캔버스 + SVG 크기 강제 (우측까지 모두 포함)
    wrap.style.width  = totalW + 'px';
    wrap.style.height = totalH + 'px';
    if (svg) {
      svg.style.width  = totalW + 'px';
      svg.style.height = totalH + 'px';
      svg.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);
    }

    // 5) 화살표 재렌더 + DOM 안정화 대기
    this._drawSchemaEdges();
    await new Promise(r => setTimeout(r, 200));

    try {
      // 6) 캡처 — windowWidth를 충분히 크게 (우측 잘림 방지)
      const canvas = await window.html2canvas(wrap, {
        backgroundColor: '#ffffff',
        scale: 1.5,
        useCORS: true,
        width:  totalW,
        height: totalH,
        windowWidth:  totalW + 100,    // 여유 공간
        windowHeight: totalH + 100,
        scrollX: 0, scrollY: 0,
        x: 0, y: 0,
        logging: false,
      });
      return { dataUrl: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height };
    } finally {
      // 7) 원래 상태 복원
      wrap.style.transform = oldTransform;
      wrap.style.width  = oldWidth;
      wrap.style.height = oldHeight;
      if (viewport) viewport.style.overflow = oldOverflow || '';
      if (svg) {
        svg.style.width  = oldSvgW;
        svg.style.height = oldSvgH;
        if (oldSvgViewBox) svg.setAttribute('viewBox', oldSvgViewBox);
      }
      originalPos.forEach(({ n, x, y }) => {
        n.style.left = x + 'px';
        n.style.top  = y + 'px';
      });
      this._drawSchemaEdges();
    }
  },

  // PDF — 16:9 와이드 페이지 + contain fit (잘림 0%)
  async _exportPdf() {
    Toast.info('📄 PDF 생성 중... (16:9 와이드)');
    try {
      const { dataUrl } = await this._captureSchemaCanvas();
      await this._loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
      const { jsPDF } = window.jspdf;

      const img = new Image(); img.src = dataUrl;
      await new Promise(r => img.onload = r);

      // ⚠️ 16:9 와이드 페이지 (1920x1080 pt — PowerPoint 와이드와 동일 비율)
      const PAGE_W = 1920, PAGE_H = 1080;
      const TITLE_BAR_H = 60;
      const MARGIN = 30;

      const pdf = new jsPDF({
        orientation: 'l', unit: 'pt',
        format: [PAGE_W, PAGE_H],
        compress: true,
      });

      // ── 표지 페이지 (16:9) ─────────────────────
      pdf.setFillColor(22, 100, 229);
      pdf.rect(0, 0, PAGE_W, PAGE_H, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(72);
      pdf.text('Fingersales AI', PAGE_W/2, PAGE_H/2 - 60, { align:'center' });
      pdf.setFontSize(48);
      pdf.text('DB Schema Relations', PAGE_W/2, PAGE_H/2 + 20, { align:'center' });
      pdf.setFontSize(20);
      pdf.text(new Date().toLocaleString('ko-KR'), PAGE_W/2, PAGE_H/2 + 80, { align:'center' });
      pdf.setFontSize(14);
      pdf.text('Confidential · For Internal Use Only', PAGE_W/2, PAGE_H - 50, { align:'center' });

      // ── 본문 페이지 (16:9) ─────────────────────
      pdf.addPage([PAGE_W, PAGE_H], 'l');
      pdf.setFillColor(255, 255, 255);
      pdf.rect(0, 0, PAGE_W, PAGE_H, 'F');
      pdf.setTextColor(22, 100, 229);
      pdf.setFontSize(24);
      pdf.text('📊 DB Schema Relations', MARGIN, MARGIN + 22);
      pdf.setTextColor(110, 119, 130);
      pdf.setFontSize(12);
      pdf.text(new Date().toLocaleString('ko-KR'), PAGE_W - MARGIN, MARGIN + 22, { align:'right' });

      // contain fit — 이미지 전체를 페이지 안에 비율 유지하며 배치 (잘림 X)
      const availW = PAGE_W - MARGIN * 2;
      const availH = PAGE_H - TITLE_BAR_H - MARGIN;
      const imgRatio  = img.width / img.height;
      const availRatio = availW / availH;
      let drawW, drawH;
      if (imgRatio > availRatio) {
        drawW = availW; drawH = availW / imgRatio;
      } else {
        drawH = availH; drawW = availH * imgRatio;
      }
      const drawX = (PAGE_W - drawW) / 2;
      const drawY = TITLE_BAR_H + (availH - drawH) / 2;
      pdf.addImage(dataUrl, 'PNG', drawX, drawY, drawW, drawH, undefined, 'FAST');

      pdf.save(`핑거세일즈_AI_DB_연관도_${new Date().toISOString().slice(0,10)}.pdf`);
      Toast.success('✅ PDF 다운로드 완료 (16:9 와이드)');
    } catch (e) { Toast.error('PDF 생성 실패: ' + e.message); console.error(e); }
  },

  // PPTX — 16:9 와이드 + contain fit (잘림 0%)
  async _exportPptx() {
    Toast.info('📊 PPTX 생성 중... (16:9 와이드)');
    try {
      const { dataUrl } = await this._captureSchemaCanvas();
      await this._loadScript('https://cdn.jsdelivr.net/gh/gitbrent/pptxgenjs@3.12.0/dist/pptxgen.bundle.js');
      const PptxGen = window.PptxGenJS || window.pptxgen;
      const pptx = new PptxGen();

      const img = new Image(); img.src = dataUrl;
      await new Promise(r => img.onload = r);

      // ⚠️ 16:9 와이드 표준 (13.333 × 7.5 인치 = PowerPoint Widescreen)
      pptx.layout = 'LAYOUT_WIDE';
      const SLIDE_W = 13.333, SLIDE_H = 7.5;
      const TITLE_BAR_H = 0.5;
      const MARGIN = 0.2;

      // ── 슬라이드 1: 표지 ───────────────────────────
      const s1 = pptx.addSlide();
      s1.background = { color: '1664E5' };
      s1.addText('🔥 Fingersales AI', { x:0, y:SLIDE_H/2-1.5, w:SLIDE_W, h:0.9, fontSize:48, bold:true, color:'FFFFFF', align:'center' });
      s1.addText('DB Schema Relations', { x:0, y:SLIDE_H/2-0.4, w:SLIDE_W, h:0.7, fontSize:32, color:'FFFFFF', align:'center' });
      s1.addText('DB 스키마 연관도', { x:0, y:SLIDE_H/2+0.4, w:SLIDE_W, h:0.5, fontSize:20, color:'E5E7EB', align:'center' });
      s1.addText(new Date().toLocaleString('ko-KR'), { x:0, y:SLIDE_H-0.7, w:SLIDE_W, h:0.3, fontSize:14, color:'E5E7EB', align:'center' });
      s1.addText('Confidential · For Internal Use Only', { x:0, y:SLIDE_H-0.4, w:SLIDE_W, h:0.25, fontSize:11, color:'E5E7EB', italic:true, align:'center' });

      // ── 슬라이드 2: 연관도 (16:9 contain fit) ───────
      const s2 = pptx.addSlide();
      s2.background = { color: 'FFFFFF' };
      s2.addText('📊 DB 스키마 연관도', { x:MARGIN, y:0.1, w:SLIDE_W - MARGIN*2 - 3, h:TITLE_BAR_H - 0.1,
        fontSize:22, bold:true, color:'1664E5' });
      s2.addText(new Date().toLocaleString('ko-KR'), { x:SLIDE_W - 3 - MARGIN, y:0.15, w:3, h:0.3,
        fontSize:11, color:'6B7280', align:'right' });

      // contain fit — 비율 유지 + 슬라이드 내부에 잘림 없이
      const availW = SLIDE_W - MARGIN * 2;
      const availH = SLIDE_H - TITLE_BAR_H - MARGIN;
      const imgRatio  = img.width / img.height;
      const availRatio = availW / availH;
      let drawW, drawH;
      if (imgRatio > availRatio) {
        drawW = availW; drawH = availW / imgRatio;
      } else {
        drawH = availH; drawW = availH * imgRatio;
      }
      const drawX = (SLIDE_W - drawW) / 2;
      const drawY = TITLE_BAR_H + (availH - drawH) / 2;
      s2.addImage({ data: dataUrl, x: drawX, y: drawY, w: drawW, h: drawH });

      await pptx.writeFile({ fileName: `핑거세일즈_AI_DB_연관도_${new Date().toISOString().slice(0,10)}.pptx` });
      Toast.success('✅ PPTX 다운로드 완료 (16:9 와이드)');
    } catch (e) { Toast.error('PPTX 생성 실패: ' + e.message); console.error(e); }
  },

  // ── 편집 모드 진입 ───────────────────────────────────────
  _enterEditMode() {
    const sm = this.schemaMap;
    sm.editMode = true;
    const btn     = document.getElementById('schema-edit-btn');
    const toolbar = document.getElementById('schema-edit-toolbar');
    if (btn)     { btn.textContent = '✏️ 편집 중'; btn.classList.add('active'); }
    if (toolbar) toolbar.style.display = 'flex';

    // 각 노드에 컬럼 편집 버튼 추가
    document.querySelectorAll('.schema-map-node').forEach(node => {
      node.classList.add('edit-mode');
      const tname = node.dataset.table;
      node.querySelectorAll('.schema-map-col').forEach(row => {
        if (row.querySelector('.smap-col-edit-btn')) return;
        const eb = document.createElement('button');
        eb.className    = 'smap-col-edit-btn';
        eb.title        = '컬럼 편집';
        eb.textContent  = '✎';
        eb.dataset.table = tname;
        eb.dataset.col   = row.dataset.col;
        row.appendChild(eb);
      });
    });

    // ⚠️ 컬럼 편집·추가·종료 핸들러 — 멱등 바인딩 (한 번만)
    const canvas = document.getElementById('schema-map-canvas');
    if (canvas && canvas.dataset.editBound !== '1') {
      canvas.dataset.editBound = '1';
      canvas.addEventListener('click', e => {
        if (e.target.classList.contains('smap-col-edit-btn')) {
          this._showAlterColumnModal(e.target.dataset.table, e.target.dataset.col);
        }
      });
    }

    const addBtn = document.getElementById('schema-add-col-btn');
    if (addBtn && addBtn.dataset.bound !== '1') {
      addBtn.dataset.bound = '1';
      addBtn.addEventListener('click', () => {
        const tables = Object.keys(this.schema);
        Modal.open({
          title: '컬럼 추가할 테이블 선택',
          body: `<div style="margin-bottom:8px">
            <label class="form-label">테이블</label>
            <select id="add-col-table" class="form-input">
              ${tables.map(t=>`<option value="${esc(t)}">${esc(t)}${this.TABLE_KO[t]?' ('+esc(this.TABLE_KO[t])+')':''}</option>`).join('')}
            </select>
          </div>`,
          footer: `<button class="btn btn-primary" id="add-col-next">다음 →</button>
                   <button class="btn btn-ghost"   id="add-col-cancel">취소</button>`,
          bind: {
            '#add-col-next':   () => { const t = document.getElementById('add-col-table')?.value; if (t) { Modal.close(); this._showAddColumnModal(t); } },
            '#add-col-cancel': () => Modal.close(),
          }
        });
      });
    }

    const exitBtn = document.getElementById('schema-edit-exit');
    if (exitBtn && exitBtn.dataset.bound !== '1') {
      exitBtn.dataset.bound = '1';
      exitBtn.addEventListener('click', () => this._exitEditMode());
    }
  },

  // ── 편집 모드 종료 ───────────────────────────────────────
  _exitEditMode() {
    const sm = this.schemaMap;
    sm.editMode = false;
    const btn     = document.getElementById('schema-edit-btn');
    const toolbar = document.getElementById('schema-edit-toolbar');
    if (btn)     { btn.textContent = '✏️ 편집'; btn.classList.remove('active'); }
    if (toolbar) toolbar.style.display = 'none';
    document.querySelectorAll('.schema-map-node').forEach(n => {
      n.classList.remove('edit-mode');
      n.querySelectorAll('.smap-col-edit-btn').forEach(b => b.remove());
    });
  },

  // ── 컬럼 추가 모달 ───────────────────────────────────────
  _showAddColumnModal(tname) {
    const buildSQL = () => {
      const colName = document.getElementById('add-col-name')?.value?.trim();
      const colType = document.getElementById('add-col-type')?.value;
      const nullable = document.getElementById('add-col-null')?.checked;
      const def = document.getElementById('add-col-default')?.value?.trim();
      if (!colName || !colType) return '';
      const nullStr = nullable ? 'NULL' : 'NOT NULL';
      const defStr  = def ? ` DEFAULT '${def}'` : '';
      return `ALTER TABLE \`${tname}\` ADD COLUMN \`${colName}\` ${colType} ${nullStr}${defStr};`;
    };

    Modal.open({
      title: `➕ ${tname} — 컬럼 추가`,
      body: `<div style="display:grid;gap:12px">
        <div>
          <label class="form-label">컬럼명 <span style="color:var(--oci-red)">*</span></label>
          <input id="add-col-name" class="form-input" placeholder="예: customer_code">
        </div>
        <div>
          <label class="form-label">데이터 타입 <span style="color:var(--oci-red)">*</span></label>
          <select id="add-col-type" class="form-input">
            <option>VARCHAR(100)</option><option>VARCHAR(200)</option><option>VARCHAR(255)</option>
            <option>INT</option><option>BIGINT</option><option>TINYINT(1)</option>
            <option>TEXT</option><option>MEDIUMTEXT</option>
            <option>DATETIME</option><option>DATE</option><option>TIMESTAMP</option>
            <option>DECIMAL(15,2)</option><option>DOUBLE</option><option>JSON</option>
          </select>
        </div>
        <div style="display:flex;gap:16px;align-items:center">
          <label style="display:flex;align-items:center;gap:6px;font-size:13px">
            <input type="checkbox" id="add-col-null" checked> NULL 허용
          </label>
          <div style="flex:1">
            <label class="form-label">기본값 (선택)</label>
            <input id="add-col-default" class="form-input" placeholder="예: 0  또는 빈칸">
          </div>
        </div>
        <div>
          <div class="form-label">생성 SQL 미리보기</div>
          <pre id="add-col-preview" style="background:var(--surface-2);padding:8px;border-radius:6px;font-size:12px;min-height:32px;margin:0;white-space:pre-wrap"></pre>
        </div>
      </div>`,
      footer: `<button class="btn btn-secondary" id="add-col-dry">🔍 검증만</button>
               <button class="btn btn-primary"   id="add-col-exec">✅ 실행</button>
               <button class="btn btn-ghost"     id="add-col-cancel">취소</button>`,
      bind: {
        '#add-col-dry': async () => {
          const sql = buildSQL();
          if (!sql) return Toast.show('컬럼명/타입을 입력하세요', 'warning');
          const r = await this._execDDL(sql, true);
          r.ok ? Toast.show('✅ 검증 통과 — [실행] 을 눌러 적용하세요', 'success')
               : Toast.show('❌ ' + r.error, 'error');
        },
        '#add-col-exec': async () => {
          const sql = buildSQL();
          if (!sql) return Toast.show('컬럼명/타입을 입력하세요', 'warning');
          Modal.close();
          const oldSnap = this.schemaMap._lastSnap ? JSON.parse(JSON.stringify(this.schemaMap._lastSnap)) : null;
          const r = await this._execDDL(sql, false);
          if (r.ok) {
            Toast.show('✅ 컬럼 추가 완료', 'success');
            await this.loadSchema();
            await this._takeSchemaSnap();
            this._refreshSchemaListView();   // 카드 뷰 갱신
            this._drawSchemaNodes();
            requestAnimationFrame(() => requestAnimationFrame(() => this._drawSchemaEdges()));
            if (oldSnap) {
              const changes = this._analyzeSchemaChanges(oldSnap, this.schemaMap._lastSnap);
              if (changes.length > 0) {
                this._showImpactPanel(changes);
                await this._recordSchemaChanges(changes, oldSnap, this.schemaMap._lastSnap);
              }
            }
          } else Toast.show('❌ ' + r.error, 'error');
        },
        '#add-col-cancel': () => Modal.close(),
      }
    });

    // 실시간 SQL 미리보기
    ['add-col-name','add-col-type','add-col-null','add-col-default'].forEach(id => {
      document.getElementById(id)?.addEventListener('input',  () => { const el = document.getElementById('add-col-preview'); if (el) el.textContent = buildSQL(); });
      document.getElementById(id)?.addEventListener('change', () => { const el = document.getElementById('add-col-preview'); if (el) el.textContent = buildSQL(); });
    });
  },

  // ── 컬럼 수정 모달 ───────────────────────────────────────
  _showAlterColumnModal(tname, colName) {
    const col = this.schema[tname]?.columns?.find(c => c.COLUMN_NAME === colName);
    if (!col) return;

    const buildSQL = () => {
      const newType    = document.getElementById('alter-col-type')?.value?.trim() || col.COLUMN_TYPE;
      const nullable   = document.getElementById('alter-col-null')?.checked;
      const def        = document.getElementById('alter-col-default')?.value?.trim();
      const newName    = document.getElementById('alter-col-newname')?.value?.trim() || colName;
      const nullStr    = nullable ? 'NULL' : 'NOT NULL';
      const defStr     = def ? ` DEFAULT '${def}'` : '';
      return `ALTER TABLE \`${tname}\` CHANGE COLUMN \`${colName}\` \`${newName}\` ${newType} ${nullStr}${defStr};`;
    };

    Modal.open({
      title: `✏️ ${tname}.${colName} 수정`,
      body: `<div style="display:grid;gap:12px">
        <div style="background:var(--surface-2);padding:8px 12px;border-radius:6px;font-size:12px">
          <strong>현재:</strong> <code>${esc(col.COLUMN_TYPE)}</code>
          ${col.IS_NULLABLE==='NO'?'<span style="color:var(--oci-red);margin-left:6px">NOT NULL</span>':''}
          ${col.COLUMN_DEFAULT !== null && col.COLUMN_DEFAULT !== undefined ? `<span style="color:var(--text-3);margin-left:6px">DEFAULT ${esc(String(col.COLUMN_DEFAULT))}</span>` : ''}
        </div>
        <div>
          <label class="form-label">새 데이터 타입</label>
          <input id="alter-col-type" class="form-input" value="${esc(col.COLUMN_TYPE)}">
        </div>
        <div style="display:flex;gap:16px;align-items:center">
          <label style="display:flex;align-items:center;gap:6px;font-size:13px">
            <input type="checkbox" id="alter-col-null" ${col.IS_NULLABLE==='YES'?'checked':''}> NULL 허용
          </label>
          <div style="flex:1">
            <label class="form-label">기본값</label>
            <input id="alter-col-default" class="form-input" value="${esc(col.COLUMN_DEFAULT !== null && col.COLUMN_DEFAULT !== undefined ? String(col.COLUMN_DEFAULT) : '')}">
          </div>
        </div>
        <div>
          <label class="form-label">새 컬럼명 (RENAME — 비워두면 유지)</label>
          <input id="alter-col-newname" class="form-input" placeholder="${esc(colName)}">
        </div>
        <div>
          <div class="form-label">변경 SQL 미리보기</div>
          <pre id="alter-col-preview" style="background:var(--surface-2);padding:8px;border-radius:6px;font-size:12px;min-height:32px;margin:0;white-space:pre-wrap"></pre>
        </div>
        <div style="padding:8px 12px;background:#FFF3CD;border-radius:6px;font-size:12px;color:#856404">
          ⚠️ 타입 변경은 기존 데이터 손실 위험이 있습니다. 반드시 백업 후 진행하세요.
        </div>
      </div>`,
      footer: `<button class="btn btn-secondary" id="alter-col-dry">🔍 검증</button>
               <button class="btn btn-danger"    id="alter-col-exec">⚡ 실행</button>
               <button class="btn btn-ghost"     id="alter-col-cancel">취소</button>`,
      bind: {
        '#alter-col-dry': async () => {
          const sql = buildSQL();
          const r = await this._execDDL(sql, true);
          r.ok ? Toast.show('✅ 검증 통과', 'success') : Toast.show('❌ ' + r.error, 'error');
        },
        '#alter-col-exec': async () => {
          const sql = buildSQL();
          Modal.close();
          const oldSnap = this.schemaMap._lastSnap ? JSON.parse(JSON.stringify(this.schemaMap._lastSnap)) : null;
          const r = await this._execDDL(sql, false);
          if (r.ok) {
            Toast.show('✅ 컬럼 변경 완료', 'success');
            await this.loadSchema();
            await this._takeSchemaSnap();
            // ⚠️ 카드 뷰도 갱신 (이전엔 누락되어 stale 상태였음)
            this._refreshSchemaListView();
            this._drawSchemaNodes();
            requestAnimationFrame(() => requestAnimationFrame(() => this._drawSchemaEdges()));
            // 영향도 분석 + 변경 이력 영구 기록
            if (oldSnap) {
              const changes = this._analyzeSchemaChanges(oldSnap, this.schemaMap._lastSnap);
              if (changes.length > 0) {
                this._showImpactPanel(changes);
                await this._recordSchemaChanges(changes, oldSnap, this.schemaMap._lastSnap);
              }
            }
          } else Toast.show('❌ ' + r.error, 'error');
        },
        '#alter-col-cancel': () => Modal.close(),
      }
    });

    // 실시간 미리보기
    ['alter-col-type','alter-col-null','alter-col-default','alter-col-newname'].forEach(id => {
      document.getElementById(id)?.addEventListener('input',  () => { const el = document.getElementById('alter-col-preview'); if (el) el.textContent = buildSQL(); });
      document.getElementById(id)?.addEventListener('change', () => { const el = document.getElementById('alter-col-preview'); if (el) el.textContent = buildSQL(); });
    });
    // 초기 미리보기
    setTimeout(() => { const el = document.getElementById('alter-col-preview'); if (el) el.textContent = buildSQL(); }, 50);
  },

  // ── DDL 실행 ─────────────────────────────────────────────
  async _execDDL(sql, dryRun = false) {
    try {
      const r = await API.post('/admin/dev/schema-alter', { sql, dryRun });
      return { ok: true, data: r };
    } catch (e) {
      return { ok: false, error: e?.response?.data?.error || e.message || String(e) };
    }
  },

  // ══════════════════════════════════════════════════════════
  // 스키마 노드 상세 팝업
  // ══════════════════════════════════════════════════════════
  showSchemaDetail(tname) {
    const tdata = this.schema[tname];
    if (!tdata) return;

    const overlay    = document.getElementById('schema-detail-overlay');
    const titleEl    = document.getElementById('schema-detail-title');
    const subtitleEl = document.getElementById('schema-detail-subtitle');
    const bodyEl     = document.getElementById('schema-detail-body');
    if (!overlay || !titleEl || !bodyEl) return;

    const koName  = this.TABLE_KO[tname] || '';
    const cols    = tdata.columns || [];
    const idxList = this.schemaMap.indexes[tname] || [];
    const fksOut  = this.schemaMap.fks.filter(f => f.TABLE_NAME === tname);
    const fksIn   = this.schemaMap.fks.filter(f => f.REFERENCED_TABLE_NAME === tname);
    // 실제 FK 컬럼명 Set (MUL ≠ FK 구분용)
    const fkColSet = new Set(fksOut.map(f => f.COLUMN_NAME));

    // 컬럼별 인덱스 맵
    const colIdxMap = {};
    idxList.forEach(idx => {
      if (!colIdxMap[idx.COLUMN_NAME]) colIdxMap[idx.COLUMN_NAME] = [];
      colIdxMap[idx.COLUMN_NAME].push(idx);
    });

    titleEl.innerHTML = `🗄️ ${esc(tname)}${koName ? ` <span style="font-size:14px;font-weight:400;color:var(--text-3)">(${esc(koName)})</span>` : ''}`;
    subtitleEl.textContent = `${cols.length}개 컬럼 · 인덱스 ${idxList.length}개 · FK 참조 ${fksOut.length}개 · 참조됨 ${fksIn.length}개`;

    bodyEl.innerHTML = `
      <!-- 컬럼 목록 -->
      <div style="margin-bottom:24px">
        <div style="font-weight:600;font-size:13px;margin-bottom:10px;color:var(--text-2)">📋 컬럼 목록</div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead>
              <tr style="border-bottom:2px solid var(--border)">
                <th style="text-align:left;padding:6px 10px;color:var(--text-3);font-weight:500">#</th>
                <th style="text-align:left;padding:6px 10px;color:var(--text-3);font-weight:500">컬럼명</th>
                <th style="text-align:left;padding:6px 10px;color:var(--text-3);font-weight:500">한글명</th>
                <th style="text-align:left;padding:6px 10px;color:var(--text-3);font-weight:500">타입</th>
                <th style="text-align:center;padding:6px 10px;color:var(--text-3);font-weight:500">NULL</th>
                <th style="text-align:left;padding:6px 10px;color:var(--text-3);font-weight:500">기본값</th>
                <th style="text-align:left;padding:6px 10px;color:var(--text-3);font-weight:500">키</th>
                <th style="text-align:left;padding:6px 10px;color:var(--text-3);font-weight:500">인덱스</th>
              </tr>
            </thead>
            <tbody>
              ${cols.map((c, i) => {
                const isPK  = c.COLUMN_KEY === 'PRI';
                // 실제 FK는 information_schema FK 관계로만 판정 (MUL ≠ FK)
                const isFK  = fkColSet.has(c.COLUMN_NAME);
                const isUNI = c.COLUMN_KEY === 'UNI';
                const isIDX = c.COLUMN_KEY === 'MUL' && !isFK;   // 일반 인덱스
                const koCol = this._getColKo(tname, c.COLUMN_NAME) || '—';
                const keyBadge = isPK  ? '<span class="schema-col-badge pk">PK</span>'
                               : isFK  ? '<span class="schema-col-badge fk">FK</span>'
                               : isUNI ? '<span class="schema-col-badge uni">UNI</span>'
                               : isIDX ? '<span class="schema-col-badge idx" title="일반 인덱스">IDX</span>'
                               : '—';
                const idxEntries = colIdxMap[c.COLUMN_NAME] || [];
                const idxBadges = idxEntries.map(idx =>
                  `<span class="schema-col-badge idx" title="${esc(idx.INDEX_NAME)}">${idx.NON_UNIQUE==0?'🔷':'🔸'}${esc(idx.INDEX_NAME)}</span>`
                ).join(' ') || '—';
                const defVal = (c.COLUMN_DEFAULT !== null && c.COLUMN_DEFAULT !== undefined)
                  ? `<code style="font-size:11px">${esc(String(c.COLUMN_DEFAULT))}</code>` : '—';
                return `<tr style="border-bottom:1px solid var(--border);${isPK?'background:rgba(22,100,229,.06)':''}">
                  <td style="padding:6px 10px;color:var(--text-3);font-size:11px">${i+1}</td>
                  <td style="padding:6px 10px"><code>${esc(c.COLUMN_NAME)}</code></td>
                  <td style="padding:6px 10px;color:var(--text-3)">${esc(koCol)}</td>
                  <td style="padding:6px 10px"><code style="font-size:11px">${esc(c.COLUMN_TYPE)}</code></td>
                  <td style="padding:6px 10px;text-align:center">${c.IS_NULLABLE==='YES'?'<span style="color:#F59C00">YES</span>':'<span style="color:#E63329;font-weight:600">NO</span>'}</td>
                  <td style="padding:6px 10px">${defVal}</td>
                  <td style="padding:6px 10px">${keyBadge}</td>
                  <td style="padding:6px 10px">${idxBadges}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      ${fksOut.length ? `
      <!-- FK 출력 -->
      <div style="margin-bottom:24px">
        <div style="font-weight:600;font-size:13px;margin-bottom:10px;color:var(--text-2)">🔗 FK 제약 (참조 →)</div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead>
              <tr style="border-bottom:2px solid var(--border)">
                <th style="text-align:left;padding:6px 10px;color:var(--text-3);font-weight:500">제약명</th>
                <th style="text-align:left;padding:6px 10px;color:var(--text-3);font-weight:500">컬럼</th>
                <th style="text-align:left;padding:6px 10px;color:var(--text-3);font-weight:500">참조 테이블</th>
                <th style="text-align:left;padding:6px 10px;color:var(--text-3);font-weight:500">참조 컬럼</th>
                <th style="text-align:left;padding:6px 10px;color:var(--text-3);font-weight:500">ON UPDATE</th>
                <th style="text-align:left;padding:6px 10px;color:var(--text-3);font-weight:500">ON DELETE</th>
              </tr>
            </thead>
            <tbody>
              ${fksOut.map(fk => `<tr style="border-bottom:1px solid var(--border)">
                <td style="padding:6px 10px;font-size:11px"><code>${esc(fk.CONSTRAINT_NAME||'')}</code></td>
                <td style="padding:6px 10px"><code>${esc(fk.COLUMN_NAME)}</code></td>
                <td style="padding:6px 10px">
                  <span class="schema-col-badge fk" data-goto="${esc(fk.REFERENCED_TABLE_NAME)}" style="cursor:pointer">
                    ${esc(fk.REFERENCED_TABLE_NAME)}
                  </span>
                </td>
                <td style="padding:6px 10px"><code>${esc(fk.REFERENCED_COLUMN_NAME)}</code></td>
                <td style="padding:6px 10px;color:var(--text-3)">${esc(fk.UPDATE_RULE||'')}</td>
                <td style="padding:6px 10px;color:var(--text-3)">${esc(fk.DELETE_RULE||'')}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>` : ''}

      ${fksIn.length ? `
      <!-- FK 입력 -->
      <div>
        <div style="font-weight:600;font-size:13px;margin-bottom:10px;color:var(--text-2)">🔗 참조됨 (← FK IN)</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${fksIn.map(fk =>
            `<span class="schema-col-badge fk" data-goto="${esc(fk.TABLE_NAME)}" style="cursor:pointer;padding:4px 8px" title="${esc(fk.TABLE_NAME)}.${esc(fk.COLUMN_NAME)} → ${esc(tname)}.${esc(fk.REFERENCED_COLUMN_NAME)}">
              ${esc(fk.TABLE_NAME)}.${esc(fk.COLUMN_NAME)}
            </span>`
          ).join('')}
        </div>
      </div>` : ''}
    `;

    // FK 클릭 → 다른 테이블 상세로 이동
    bodyEl.querySelectorAll('[data-goto]').forEach(el => {
      el.addEventListener('click', () => this.showSchemaDetail(el.dataset.goto));
    });

    overlay.style.display = 'flex';
  },

  // ══════════════════════════════════════════════════════════
  // 수동 스키마 동기화 (폴링 없음 — WS 감지 + 버튼 트리거)
  // ══════════════════════════════════════════════════════════

  // WS schema_changed 수신 시 호출 — 버튼 활성화 + drift 예고
  _onSchemaChangedWs(msg) {
    const sm = this.schemaMap;
    sm._pendingChanges.push(msg);
    this._setSyncBtnState('pending');
    // 탭이 열려 있지 않아도 버튼 뱃지는 유지 (다음 방문 시에도 보임)
  },

  // [스키마 동기화] 버튼 클릭 시 실행
  async _syncSchema() {
    if (this.activeTab !== 'schema') return;
    this._setSyncBtnState('syncing');

    const oldSnap = this.schemaMap._lastSnap
      ? JSON.parse(JSON.stringify(this.schemaMap._lastSnap))
      : null;

    // 서버 캐시 우회하여 최신 스키마 fetch
    await this._takeSchemaSnap();
    const changes = oldSnap
      ? this._analyzeSchemaChanges(oldSnap, this.schemaMap._lastSnap)
      : [];

    // 스키마 데이터 갱신
    await this.loadSchema();

    if (changes.length > 0) {
      // 변경된 테이블 drift 하이라이트
      const changedTables = [...new Set(changes.map(c => c.table))];
      this.schemaMap._driftTables = new Set(changedTables);
      this._markDriftNodes(changedTables);
      this._showImpactPanel(changes);
      // 카드 뷰도 갱신
      this._refreshSchemaListView();

      // 변경 이력 영구 저장 (공통 헬퍼 사용)
      try {
        const r = await this._recordSchemaChanges(changes, oldSnap, this.schemaMap._lastSnap);
        if (r.recorded > 0) {
          Toast.success(`📜 변경 이력 ${r.recorded}건 기록됨`);
        }
      } catch (e) {
        console.warn('스키마 이력 기록 실패:', e.message);
      }
    } else {
      // 변경 없음 — drift 초기화
      this.schemaMap._driftTables = new Set();
      this._clearDriftNodes();
    }

    // 연관도 표시 중이면 노드 재렌더
    if (this.schemaMap.visible) {
      this._drawSchemaNodes();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        this._drawSchemaEdges();
        // 재렌더 후 drift 재적용 (drawSchemaNodes가 클래스를 초기화하므로)
        this._markDriftNodes([...this.schemaMap._driftTables]);
      }));
    }

    this.schemaMap._pendingChanges = [];
    this._setSyncBtnState(changes.length > 0 ? 'changed' : 'clean');
  },

  // 변경된 테이블의 노드·카드에 .schema-drift 클래스 추가
  // ── 스키마 변경 이력 모달 ──────────────────────────────────
  async _openSchemaHistoryModal() {
    Modal.open({
      title: '📜 스키마 변경 이력',
      width: 1080,
      body: `
        <div style="margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <div style="font-size:12px;color:var(--text-3);line-height:1.6">
            🔄 <strong>스키마 동기화</strong> 클릭 시 변경이 감지되면 자동으로 이력에 기록됩니다.<br>
            영향도 색상: <span style="color:#17A85A">●</span> LOW (안전)
            · <span style="color:#F59C00">●</span> MEDIUM (검토)
            · <span style="color:#E63329">●</span> HIGH (위험)
          </div>
          <div style="display:flex;gap:6px;align-items:center">
            <select id="sch-filter-risk" class="form-input form-input-sm" style="width:100px">
              <option value="">전체 영향도</option>
              <option value="HIGH">HIGH</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="LOW">LOW</option>
            </select>
            <select id="sch-filter-type" class="form-input form-input-sm" style="width:140px">
              <option value="">전체 유형</option>
              <option value="new_table">신규 테이블</option>
              <option value="drop_table">테이블 삭제</option>
              <option value="add_col">컬럼 추가</option>
              <option value="drop_col">컬럼 삭제</option>
              <option value="mod_col">컬럼 변경</option>
            </select>
            <button class="btn btn-ghost btn-sm" id="sch-reload">↻ 새로고침</button>
          </div>
        </div>
        <!-- 통계 카드 영역: 높이 고정으로 깜박임 방지 -->
        <div id="sch-history-stats" style="margin-bottom:12px;min-height:62px"></div>
        <!-- 리스트 영역: 고정 높이 + 내부 스크롤 (모달 크기 변동 X) -->
        <div id="sch-history-list-wrap" style="position:relative;height:520px;overflow-y:auto;
                                               border:1px solid var(--border);border-radius:6px">
          <div id="sch-history-list" style="transition:opacity .15s">
            <div class="loading" style="padding:30px;text-align:center">불러오는 중...</div>
          </div>
          <!-- 로딩 오버레이 (필터 변경 시 부드러운 전환) -->
          <div id="sch-history-overlay" style="display:none;position:absolute;inset:0;
               background:rgba(255,255,255,.7);backdrop-filter:blur(2px);align-items:center;
               justify-content:center;font-size:12px;color:var(--text-3);z-index:5">
            <div style="display:flex;align-items:center;gap:8px">
              <div class="sc-spinner" style="width:14px;height:14px"></div>
              <span>업데이트 중...</span>
            </div>
          </div>
        </div>
      `,
      footer: `<button class="btn btn-ghost" id="sch-close">닫기</button>`,
      bind: {
        '#sch-close':  () => Modal.close(),
        '#sch-reload': () => this._loadSchemaHistory(),
        '#sch-filter-risk': () => this._loadSchemaHistory(),
        '#sch-filter-type': () => this._loadSchemaHistory(),
      },
      onOpen: () => this._loadSchemaHistory()
    });
  },

  async _loadSchemaHistory() {
    const listEl    = document.getElementById('sch-history-list');
    const statsEl   = document.getElementById('sch-history-stats');
    const overlayEl = document.getElementById('sch-history-overlay');
    if (!listEl) return;
    const risk = document.getElementById('sch-filter-risk')?.value || '';
    const type = document.getElementById('sch-filter-type')?.value || '';

    // 초기 로드 vs 리로드 구분 — 초기는 loading 표시, 리로드는 오버레이만
    const isInitial = !listEl.dataset.loaded;
    if (isInitial) {
      listEl.innerHTML = '<div class="loading" style="padding:30px;text-align:center">불러오는 중...</div>';
    } else if (overlayEl) {
      overlayEl.style.display = 'flex';
      listEl.style.opacity = '0.45';   // 기존 콘텐츠 흐리게 (사라지지 않음)
    }

    try {
      const q = new URLSearchParams();
      if (risk) q.set('risk', risk);
      if (type) q.set('type', type);
      const r = await API.get('/admin/dev/schema/history?' + q.toString());
      const rows = r.data || [];
      const s = r.stats || {};

      // 통계 카드
      statsEl.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;font-size:12px">
          <div style="padding:8px 12px;background:var(--surface-2);border-radius:6px">
            <div style="color:var(--text-3);font-size:10px">전체</div>
            <div style="font-size:18px;font-weight:700">${s.total || 0}</div>
          </div>
          <div style="padding:8px 12px;background:rgba(230,51,41,.08);border-radius:6px;border-left:3px solid #E63329">
            <div style="color:var(--text-3);font-size:10px">HIGH 위험</div>
            <div style="font-size:18px;font-weight:700;color:#E63329">${s.high_cnt || 0}</div>
          </div>
          <div style="padding:8px 12px;background:rgba(245,156,0,.08);border-radius:6px;border-left:3px solid #F59C00">
            <div style="color:var(--text-3);font-size:10px">MEDIUM 검토</div>
            <div style="font-size:18px;font-weight:700;color:#B97500">${s.medium_cnt || 0}</div>
          </div>
          <div style="padding:8px 12px;background:rgba(23,168,90,.08);border-radius:6px;border-left:3px solid #17A85A">
            <div style="color:var(--text-3);font-size:10px">LOW 안전</div>
            <div style="font-size:18px;font-weight:700;color:#0F7A3F">${s.low_cnt || 0}</div>
          </div>
        </div>
      `;

      if (!rows.length) {
        listEl.innerHTML = `<div class="empty" style="padding:40px;text-align:center;color:var(--text-3)">
          기록된 변경 이력이 없습니다.<br>
          <span style="font-size:11px">스키마 동기화 후 변경이 감지되면 자동으로 기록됩니다.</span>
        </div>`;
        return;
      }

      const typeLabels = {
        new_table: '🆕 신규 테이블',
        drop_table: '🗑 테이블 삭제',
        add_col: '➕ 컬럼 추가',
        drop_col: '➖ 컬럼 삭제',
        mod_col: '✏️ 컬럼 변경',
      };
      const riskColors = { HIGH: '#E63329', MEDIUM: '#F59C00', LOW: '#17A85A' };

      listEl.innerHTML = `
        <table class="data-table" style="font-size:12px">
          <thead><tr>
            <th style="width:130px">변경일자</th>
            <th style="width:80px">영향도</th>
            <th style="width:110px">유형</th>
            <th style="width:140px">테이블·컬럼</th>
            <th>변경 내용</th>
            <th style="width:80px">감지자</th>
            <th style="width:90px">AI 코칭</th>
          </tr></thead>
          <tbody>
            ${rows.map((r, idx) => {
              const dt = new Date(r.changed_at);
              const time = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
              const clr = riskColors[r.risk] || '#999';
              const beforeAfter = (r.before_def || r.after_def)
                ? `<div style="font-family:'SF Mono',monospace;font-size:10px;margin-top:4px;padding:4px 8px;background:var(--surface-2);border-radius:4px">
                     ${r.before_def ? `<span style="color:#E63329">- ${esc(r.before_def)}</span><br>` : ''}
                     ${r.after_def  ? `<span style="color:#17A85A">+ ${esc(r.after_def)}</span>`  : ''}
                   </div>` : '';
              return `
                <tr>
                  <td class="mono" style="font-size:11px">${time}</td>
                  <td><span class="badge" style="background:${clr}15;color:${clr};border:1px solid ${clr}40;font-size:10px">${esc(r.risk)}</span></td>
                  <td>${typeLabels[r.change_type] || r.change_type}</td>
                  <td>
                    <strong>${esc(r.table_name)}</strong>
                    ${r.column_name ? `<br><code style="font-size:10px;color:var(--text-3)">${esc(r.column_name)}</code>` : ''}
                  </td>
                  <td>
                    ${esc(r.message)}
                    ${beforeAfter}
                    ${r.mitigation ? `<div style="font-size:11px;color:var(--text-3);margin-top:4px;line-height:1.5">💡 ${esc(r.mitigation)}</div>` : ''}
                  </td>
                  <td style="font-size:11px;color:var(--text-3)">${esc(r.detected_by_name || '-')}</td>
                  <td><button class="btn btn-sm sch-coach-btn" data-change-id="${r.id}" data-row-idx="${idx}"
                    style="font-size:10px;padding:3px 8px;background:linear-gradient(135deg,#1664E5,#7C4DFF);color:#fff;border:none;border-radius:4px;cursor:pointer">
                    🤖 분석
                  </button></td>
                </tr>
                <tr id="sch-coach-row-${idx}" style="display:none">
                  <td colspan="7" style="padding:0;background:rgba(22,100,229,.04)">
                    <div id="sch-coach-${idx}" style="padding:16px 20px"></div>
                  </td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      `;

      // AI 코칭 버튼 핸들러
      listEl.querySelectorAll('.sch-coach-btn').forEach(btn => {
        btn.addEventListener('click', () => this._runSchemaCoach(
          parseInt(btn.dataset.changeId),
          parseInt(btn.dataset.rowIdx),
          btn,
        ));
      });
      listEl.dataset.loaded = '1';
    } catch (e) {
      listEl.innerHTML = `<div style="color:var(--oci-red);padding:20px">로드 실패: ${esc(e.message)}</div>`;
    } finally {
      if (overlayEl) overlayEl.style.display = 'none';
      listEl.style.opacity = '1';
    }
  },

  // ── 변경 이력 영구 기록 헬퍼 (ALTER 직후 / 동기화 시 공통) ──
  async _recordSchemaChanges(changes, oldSnap, newSnap) {
    if (!Array.isArray(changes) || !changes.length) return { recorded: 0 };
    const payload = changes.map(c => {
      let before = null, after = null;
      if (c.type === 'mod_col' && oldSnap && newSnap) {
        const oldCol = (oldSnap[c.table] || []).find(x => x.name === c.col);
        const newCol = (newSnap[c.table] || []).find(x => x.name === c.col);
        if (oldCol) before = `${oldCol.type} ${oldCol.nullable==='YES'?'NULL':'NOT NULL'}${oldCol.default?' DEFAULT '+oldCol.default:''}`;
        if (newCol) after  = `${newCol.type} ${newCol.nullable==='YES'?'NULL':'NOT NULL'}${newCol.default?' DEFAULT '+newCol.default:''}`;
      } else if (c.type === 'add_col' && newSnap) {
        const newCol = (newSnap[c.table] || []).find(x => x.name === c.col);
        if (newCol) after = `${newCol.type} ${newCol.nullable==='YES'?'NULL':'NOT NULL'}${newCol.default?' DEFAULT '+newCol.default:''}`;
      } else if (c.type === 'drop_col' && oldSnap) {
        const oldCol = (oldSnap[c.table] || []).find(x => x.name === c.col);
        if (oldCol) before = `${oldCol.type} ${oldCol.nullable==='YES'?'NULL':'NOT NULL'}${oldCol.default?' DEFAULT '+oldCol.default:''}`;
      }
      return { ...c, before, after };
    });
    try {
      const r = await API.post('/admin/dev/schema/history', { changes: payload });
      if (r.recorded > 0) Toast.success(`📜 변경 이력 ${r.recorded}건 기록됨`);
      return r;
    } catch (e) {
      console.warn('스키마 이력 기록 실패:', e.message);
      return { recorded: 0, error: e.message };
    }
  },

  // ── 카드 뷰(schema-grid) 부분 재렌더 — 모달/연관도와 정합성 유지 ──
  _refreshSchemaListView() {
    const grid = document.getElementById('schema-grid');
    if (!grid) return;   // 현재 스키마 탭이 활성 상태 아니면 스킵
    // renderSchema는 전체 재렌더 → 검색·연관도 상태 초기화 위험.
    // 대신 schema-grid 안의 카드만 다시 그림 (가장 안전한 부분 재렌더)
    const tables = Object.entries(this.schema);
    grid.innerHTML = tables.map(([tname, tdata]) => {
      const _fkCols = new Set(
        (this.schemaMap.fks || []).filter(f => f.TABLE_NAME === tname).map(f => f.COLUMN_NAME)
      );
      return `
        <div class="schema-card" data-table="${esc(tname)}" style="cursor:pointer" title="클릭하여 상세보기">
          <div class="schema-card-header">
            <span class="schema-table-name">🗄️ ${esc(tname)}</span>
            <span class="schema-drift-badge" style="display:${this.schemaMap._driftTables?.has(tname)?'inline-block':'none'}" title="동기화 전 변경 감지됨">변경됨</span>
            <span class="schema-meta">${tdata.columns.length} cols</span>
          </div>
          <div class="schema-cols">
            ${tdata.columns.slice(0,8).map(c => {
              const isPK = c.COLUMN_KEY === 'PRI';
              const isFK = _fkCols.has(c.COLUMN_NAME);
              return `
              <div class="schema-col ${isPK?'pk':isFK?'fk':''}">
                <span class="schema-col-name">${isPK?'🔑 ':isFK?'🔗 ':'   '}${esc(c.COLUMN_NAME)}</span>
                <span class="schema-col-type">${esc(c.COLUMN_TYPE)}</span>
                <span class="schema-col-null" title="${c.IS_NULLABLE==='YES'?'NULL 허용 (값이 비어도 OK)':'NOT NULL — 필수 입력'}">
                  ${c.IS_NULLABLE==='YES'
                    ? '<span style="color:#9CA3AF;font-size:9px;font-style:italic">null</span>'
                    : '<span style="color:#E63329;font-weight:700">*</span>'}
                </span>
              </div>`;
            }).join('')}
            ${tdata.columns.length > 8 ? `<div class="schema-col" style="justify-content:center;color:var(--text-3);font-size:11px">+${tdata.columns.length-8}개 더...</div>` : ''}
          </div>
        </div>`;
    }).join('');
  },

  async _runSchemaCoach(changeId, rowIdx, btn) {
    const wrapRow  = document.getElementById('sch-coach-row-' + rowIdx);
    const contentEl = document.getElementById('sch-coach-' + rowIdx);
    if (!wrapRow || !contentEl) return;

    // 토글 — 이미 열려있으면 닫기
    if (wrapRow.style.display !== 'none' && contentEl.dataset.loaded) {
      wrapRow.style.display = 'none';
      btn.innerHTML = '🤖 분석';
      return;
    }

    wrapRow.style.display = '';
    btn.disabled = true;
    btn.innerHTML = '⏳ 분석중...';
    contentEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;color:var(--text-3);font-size:13px;padding:20px 0;justify-content:center">
        <div class="sc-spinner"></div>
        <span>AI가 변경 영향과 사전 조치를 분석 중입니다... (약 5초)</span>
      </div>`;

    try {
      const r = await API.post('/admin/dev/schema/coach', { change_id: changeId });
      const d = r.data;
      const riskColors = { high:'#E63329', medium:'#F59C00', low:'#17A85A' };

      contentEl.innerHTML = `
        <div style="background:linear-gradient(135deg,rgba(22,100,229,.08),rgba(124,77,255,.05));
                    border-left:3px solid var(--oci-blue);padding:12px 16px;border-radius:6px;margin-bottom:14px">
          <div style="font-size:13px;font-weight:700;margin-bottom:2px">🎯 영향 요약</div>
          <div style="font-size:13px;line-height:1.5">${esc(d.impact_summary || '')}</div>
          <div style="font-size:11px;color:var(--text-3);margin-top:6px">
            🔗 참조 IN ${d.meta?.fk_in_count || 0} · 참조 OUT ${d.meta?.fk_out_count || 0}
            · 동명 컬럼 ${d.meta?.same_name_count || 0}개 테이블
          </div>
        </div>

        ${d.affected_areas?.length ? `
        <div style="margin-bottom:14px">
          <div style="font-size:12px;font-weight:700;margin-bottom:6px">📍 영향 영역</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:8px">
            ${d.affected_areas.map(a => {
              const clr = riskColors[a.risk] || '#999';
              return `<div style="padding:8px 12px;border:1px solid ${clr}40;border-left:3px solid ${clr};
                                  border-radius:6px;background:${clr}06">
                <div style="font-size:11px;color:${clr};font-weight:700;margin-bottom:3px">
                  [${(a.risk||'').toUpperCase()}] ${esc(a.area || '')}
                </div>
                <div style="font-size:12px">${esc(a.description || '')}</div>
              </div>`;
            }).join('')}
          </div>
        </div>` : ''}

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:12px">
          ${d.pre_action_steps?.length ? `
          <div style="background:rgba(245,156,0,.06);border-left:3px solid #F59C00;padding:10px 14px;border-radius:6px">
            <div style="font-size:12px;font-weight:700;margin-bottom:6px;color:#B97500">🛡 사전 조치</div>
            <ol style="margin:0;padding-left:20px;font-size:12px;line-height:1.7">
              ${d.pre_action_steps.map(s => `<li>${esc(s)}</li>`).join('')}
            </ol>
          </div>` : ''}
          ${d.post_action_steps?.length ? `
          <div style="background:rgba(23,168,90,.06);border-left:3px solid #17A85A;padding:10px 14px;border-radius:6px">
            <div style="font-size:12px;font-weight:700;margin-bottom:6px;color:#0F7A3F">✅ 사후 검증</div>
            <ol style="margin:0;padding-left:20px;font-size:12px;line-height:1.7">
              ${d.post_action_steps.map(s => `<li>${esc(s)}</li>`).join('')}
            </ol>
          </div>` : ''}
        </div>

        ${d.test_scenarios?.length ? `
        <div style="background:rgba(33,150,243,.06);border-left:3px solid #1976D2;padding:10px 14px;border-radius:6px;margin-bottom:10px">
          <div style="font-size:12px;font-weight:700;margin-bottom:6px;color:#1565C0">🧪 QA 테스트 시나리오</div>
          <ul style="margin:0;padding-left:20px;font-size:12px;line-height:1.7">
            ${d.test_scenarios.map(s => `<li>${esc(s)}</li>`).join('')}
          </ul>
        </div>` : ''}

        ${d.rollback_plan ? `
        <div style="background:rgba(230,51,41,.06);border-left:3px solid var(--oci-red);padding:10px 14px;border-radius:6px">
          <div style="font-size:12px;font-weight:700;margin-bottom:4px;color:var(--oci-red)">⏪ 롤백 절차</div>
          <div style="font-size:12px;line-height:1.5">${esc(d.rollback_plan)}</div>
        </div>` : ''}
      `;
      contentEl.dataset.loaded = '1';
      btn.innerHTML = '🤖 닫기';
    } catch (e) {
      contentEl.innerHTML = `<div style="color:var(--oci-red);padding:14px">AI 분석 실패: ${esc(e.message)}</div>`;
      btn.innerHTML = '🤖 재시도';
    } finally {
      btn.disabled = false;
    }
  },

  _markDriftNodes(tableNames) {
    if (!tableNames || tableNames.length === 0) return;
    tableNames.forEach(tname => {
      // 연관도 노드
      const node = document.querySelector(`.schema-map-node[data-table="${tname}"]`);
      if (node) node.classList.add('schema-drift');
      // 리스트 카드
      const card = document.querySelector(`.schema-card[data-table="${tname}"]`);
      if (card) {
        card.classList.add('schema-drift');
        const badge = card.querySelector('.schema-drift-badge');
        if (badge) badge.style.display = '';
      }
    });
  },

  // drift 하이라이트 전체 제거
  _clearDriftNodes() {
    document.querySelectorAll('.schema-drift').forEach(el => {
      el.classList.remove('schema-drift');
    });
    document.querySelectorAll('.schema-drift-badge').forEach(b => {
      b.style.display = 'none';
    });
  },

  // [스키마 동기화] 버튼 상태 전환
  // state: 'idle' | 'pending' | 'syncing' | 'changed' | 'clean'
  _setSyncBtnState(state) {
    const btn = document.getElementById('schema-sync-btn');
    if (!btn) return;
    btn.className = 'btn btn-ghost btn-sm schema-sync-btn';
    btn.disabled = false;
    switch (state) {
      case 'idle':
        btn.innerHTML = '🔄 스키마 동기화';
        break;
      case 'pending':
        btn.classList.add('has-changes');
        btn.innerHTML = '⚠️ 스키마 동기화 <span class="sync-badge">' + this.schemaMap._pendingChanges.length + '</span>';
        break;
      case 'syncing':
        btn.classList.add('syncing');
        btn.disabled = true;
        btn.innerHTML = '<span class="sync-spinner"></span> 동기화 중...';
        break;
      case 'changed':
        btn.classList.add('just-changed');
        btn.innerHTML = '✅ 동기화 완료 · 변경 감지됨';
        setTimeout(() => this._setSyncBtnState('idle'), 3000);
        break;
      case 'clean':
        btn.classList.add('just-clean');
        btn.innerHTML = '✅ 최신 상태';
        setTimeout(() => this._setSyncBtnState('idle'), 2500);
        break;
    }
  },

  // WS 연결 상태 UI 업데이트
  _updateWsStatus() {
    const el = document.getElementById('schema-ws-status');
    if (!el) return;
    const connected = this.schemaMap._wsConnected;
    el.className = 'schema-ws-dot ' + (connected ? 'connected' : 'disconnected');
    el.title = connected ? 'WebSocket 연결됨 — 스키마 변경 실시간 감지 활성' : 'WebSocket 미연결 — 변경 감지 비활성. 수동 동기화로 확인하세요.';
    const label = el.querySelector('.schema-ws-label');
    if (label) label.textContent = connected ? '실시간' : '오프라인';
  },

  async _takeSchemaSnap() {
    try {
      // refresh=1: 서버 캐시 우회
      const r = await API.get('/admin/dev/schema?refresh=1');
      const data = r.data || {};
      const snap = {};
      Object.entries(data).forEach(([tname, tdata]) => {
        snap[tname] = (tdata.columns || []).map(c => ({
          name:     c.COLUMN_NAME,
          type:     c.COLUMN_TYPE,
          nullable: c.IS_NULLABLE,
          default:  c.COLUMN_DEFAULT,
          key:      c.COLUMN_KEY,
        }));
      });
      this.schemaMap._lastSnap = snap;
    } catch(_) {}
  },

  // ── 변경 분석 ────────────────────────────────────────────
  _analyzeSchemaChanges(oldSnap, newSnap) {
    const changes  = [];
    const oldTbls  = new Set(Object.keys(oldSnap));
    const newTbls  = new Set(Object.keys(newSnap));

    // 신규 테이블
    newTbls.forEach(t => {
      if (!oldTbls.has(t)) changes.push({
        type: 'new_table', table: t, risk: 'LOW',
        msg: `신규 테이블 추가: ${t}`,
        mitigation: '기존 코드에 영향 없음. 관련 API 라우트 및 프론트엔드 연동 여부를 확인하세요.',
      });
    });

    // 삭제된 테이블
    oldTbls.forEach(t => {
      if (!newTbls.has(t)) changes.push({
        type: 'drop_table', table: t, risk: 'HIGH',
        msg: `테이블 삭제 감지: ${t}`,
        mitigation: `⛔ ${t} 를 참조하는 모든 API 라우트·프론트엔드·FK를 즉시 점검하세요.`,
      });
    });

    // 컬럼 단위 변경
    oldTbls.forEach(t => {
      if (!newTbls.has(t)) return;
      const oldColMap = {}, newColMap = {};
      oldSnap[t].forEach(c => oldColMap[c.name] = c);
      newSnap[t].forEach(c => newColMap[c.name] = c);

      // 신규 컬럼
      newSnap[t].forEach(c => {
        if (!oldColMap[c.name]) {
          const isNotNull   = c.nullable === 'NO';
          const hasDefault  = c.default !== null && c.default !== undefined;
          const risk = (isNotNull && !hasDefault) ? 'MEDIUM' : 'LOW';
          changes.push({
            type: 'add_col', table: t, col: c.name, risk,
            msg: `${t}.${c.name} 컬럼 추가 (${c.type})`,
            mitigation: risk === 'MEDIUM'
              ? 'NOT NULL + DEFAULT 없음 → 기존 행 INSERT 시 오류 가능. DEFAULT 추가 또는 기존 데이터 마이그레이션 필요.'
              : '신규 컬럼 — 기존 쿼리에 영향 없음.',
          });
        }
      });

      // 삭제된 컬럼
      oldSnap[t].forEach(c => {
        if (!newColMap[c.name]) changes.push({
          type: 'drop_col', table: t, col: c.name, risk: 'HIGH',
          msg: `${t}.${c.name} 컬럼 삭제`,
          mitigation: `⛔ ${t}.${c.name} 을 사용하는 모든 쿼리·ORM·API를 즉시 점검하세요.`,
        });
      });

      // 수정된 컬럼
      oldSnap[t].forEach(c => {
        const nc = newColMap[c.name];
        if (!nc) return;
        if (c.type !== nc.type) {
          changes.push({
            type: 'mod_col', table: t, col: c.name, risk: 'HIGH',
            msg: `${t}.${c.name} 타입 변경: ${c.type} → ${nc.type}`,
            mitigation: '⚠️ 타입 변경은 데이터 손실·형변환 오류 위험. 영향받는 API/프론트에서 검증 로직 재확인 필요.',
          });
        } else if (c.nullable !== nc.nullable) {
          const risk = (nc.nullable === 'NO' && (nc.default === null || nc.default === undefined)) ? 'MEDIUM' : 'LOW';
          changes.push({
            type: 'mod_col', table: t, col: c.name, risk,
            msg: `${t}.${c.name} NULL 속성 변경: ${c.nullable} → ${nc.nullable}`,
            mitigation: risk === 'MEDIUM'
              ? 'NOT NULL 변경 시 NULL 값이 있는 행에서 오류 발생 가능. 사전 데이터 검증 필요.'
              : '영향 최소.',
          });
        }
      });
    });

    return changes;
  },

  // ── 영향도 패널 렌더링 ────────────────────────────────────
  _showImpactPanel(changes) {
    const wrap = document.getElementById('schema-impact-wrap');
    if (!wrap) return;

    const high = changes.filter(c => c.risk === 'HIGH');
    const med  = changes.filter(c => c.risk === 'MEDIUM');
    const low  = changes.filter(c => c.risk === 'LOW');

    const riskColor = { HIGH:'#E63329', MEDIUM:'#F59C00', LOW:'#17A85A' };
    const typeLbl   = { new_table:'NEW TABLE', drop_table:'DROP TABLE', add_col:'ADD COL', drop_col:'DROP COL', mod_col:'MODIFY' };

    const renderItem = c => `
      <div style="padding:10px 14px;border-radius:8px;border:1px solid var(--border);margin-bottom:8px;background:var(--surface)">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700;background:${riskColor[c.risk]};color:#fff">${esc(typeLbl[c.type]||c.type)}</span>
          <span style="font-size:12px;font-weight:600">${esc(c.msg)}</span>
          <span style="margin-left:auto;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700;background:${riskColor[c.risk]}22;color:${riskColor[c.risk]}">${c.risk}</span>
        </div>
        <div style="font-size:11px;color:var(--text-2);background:var(--surface-2);padding:6px 10px;border-radius:5px">💡 ${esc(c.mitigation)}</div>
      </div>`;

    wrap.style.display = '';
    wrap.innerHTML = `
      <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--surface-2);border-bottom:1px solid var(--border)">
          <span style="font-weight:700;font-size:13px">⚡ 스키마 변경 감지 <span style="font-weight:400;color:var(--text-3)">(${changes.length}건)</span></span>
          <div style="display:flex;gap:8px;align-items:center">
            ${high.length ? `<span style="padding:2px 8px;border-radius:4px;font-size:11px;background:#E6332922;color:#E63329;font-weight:700">HIGH ${high.length}</span>` : ''}
            ${med.length  ? `<span style="padding:2px 8px;border-radius:4px;font-size:11px;background:#F59C0022;color:#F59C00;font-weight:700">MED ${med.length}</span>` : ''}
            ${low.length  ? `<span style="padding:2px 8px;border-radius:4px;font-size:11px;background:#17A85A22;color:#17A85A;font-weight:700">LOW ${low.length}</span>` : ''}
            <button class="btn btn-ghost btn-sm" id="impact-panel-close">✕</button>
          </div>
        </div>
        <div style="padding:12px 16px;max-height:320px;overflow-y:auto">
          ${[...high, ...med, ...low].map(renderItem).join('')}
        </div>
      </div>
    `;

    document.getElementById('impact-panel-close')?.addEventListener('click', () => {
      wrap.style.display = 'none';
    });
  },

  // ══════════════════════════════════════════════════════════
  // TAB 4: 성능 모니터
  // ══════════════════════════════════════════════════════════
  async loadPerf() {
    try {
      const r = await API.get('/admin/dev/perf');
      this.perfData = r.data;
    } catch (e) { this.perfData = null; }
  },

  renderPerf() {
    const pd = this.perfData;
    if (!pd) {
      document.getElementById('dev-content').innerHTML =
        '<div class="empty" style="padding:60px">접근 로그 데이터 없음</div>';
      return;
    }

    const { hourly = [], topRoutes = [] } = pd;
    const totalReqs = hourly.reduce((s,h)=>s+parseInt(h.requests),0);
    const avgMs = hourly.length ? Math.round(hourly.reduce((s,h)=>s+parseFloat(h.avg_ms||0),0)/hourly.length) : 0;
    const totalErr = hourly.reduce((s,h)=>s+parseInt(h.srv_err||0)+parseInt(h.cli_err||0),0);

    // 막대 차트 (ascii-style bar)
    const maxReq = Math.max(...hourly.map(h=>parseInt(h.requests)),1);
    const barChart = hourly.map(h => {
      const pct = parseInt(h.requests)/maxReq;
      const barW = Math.round(pct * 120);
      const avgMsVal = parseFloat(h.avg_ms||0);
      const color = avgMsVal > 500 ? '#E63329' : avgMsVal > 200 ? '#F59C00' : '#17A85A';
      return `
        <div class="perf-bar-row">
          <span class="perf-hour">${esc(h.hour)}</span>
          <div class="perf-bar-wrap">
            <div class="perf-bar" style="width:${barW}px;background:${color}"></div>
          </div>
          <span class="perf-req-count">${h.requests}req</span>
          <span class="perf-avg" style="color:${color}">${h.avg_ms}ms</span>
          ${parseInt(h.srv_err||0) ? `<span class="perf-err">5xx:${h.srv_err}</span>` : ''}
        </div>`;
    }).join('');

    document.getElementById('dev-content').innerHTML = `
      <div class="dev-section-header">
        <h3 style="margin:0;font-size:15px">성능 모니터 — 최근 24시간</h3>
      </div>

      <!-- 요약 카드 -->
      <div class="perf-summary-grid">
        <div class="perf-summary-card"><div class="psv">${totalReqs.toLocaleString()}</div><div class="psl">총 요청</div></div>
        <div class="perf-summary-card"><div class="psv">${avgMs}ms</div><div class="psl">평균 응답시간</div></div>
        <div class="perf-summary-card ${totalErr>0?'err':''} perf-err-card" id="perf-err-card" style="cursor:pointer" title="클릭하여 에러 로그 보기"><div class="psv">${totalErr}</div><div class="psl">총 에러 ↗</div></div>
        <div class="perf-summary-card"><div class="psv">${hourly.length}h</div><div class="psl">기간</div></div>
      </div>

      <!-- 시간대별 바 차트 -->
      <div class="card mb-3">
        <div class="card-header"><div class="card-title">시간대별 요청/응답시간</div></div>
        <div class="card-body">
          <div class="perf-legend">
            <span style="color:#17A85A">■</span> &lt;200ms
            <span style="color:#F59C00">■</span> 200~500ms
            <span style="color:#E63329">■</span> &gt;500ms
          </div>
          <div class="perf-bar-chart">${barChart || '<div class="empty">데이터 없음</div>'}</div>
        </div>
      </div>

      <!-- TOP 라우트 -->
      <div class="card">
        <div class="card-header"><div class="card-title">🏆 TOP 20 엔드포인트</div></div>
        <div class="card-body no-pad">
          <table class="data-table">
            <thead><tr>
              <th>Method</th><th>Path</th>
              <th class="text-right">호출수</th>
              <th class="text-right">평균ms</th>
              <th class="text-right">에러</th>
            </tr></thead>
            <tbody>
              ${topRoutes.map(r => `<tr>
                <td><span class="badge badge-blue" style="font-size:10px">${esc(r.method)}</span></td>
                <td class="mono" style="font-size:12px">${esc(r.path)}</td>
                <td class="text-right">${parseInt(r.calls).toLocaleString()}</td>
                <td class="text-right ${parseFloat(r.avg_ms)>300?'text-danger':''}">${r.avg_ms}ms</td>
                <td class="text-right ${parseInt(r.errors)>0?'text-danger':''}">${r.errors||0}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // inline onclick은 모듈 스코프 const에 접근 불가 → addEventListener로 연결
    document.getElementById('perf-err-card')?.addEventListener('click', () => this._showErrorLogs());
  },

  // ══════════════════════════════════════════════════════════
  // 에러 로그 뷰어 (성능 모니터 → 총 에러 카드 클릭)
  // ══════════════════════════════════════════════════════════

  // ── 에러 분류/등급/원인분석/트러블슈팅 정의 ──────────────────
  _classifyError(sc, method, path) {
    const code = parseInt(sc);
    const p    = (path || '').toLowerCase();

    // ── 등급 (severity) ──────────────────────────────────────
    let severity, severityCls;
    if (code >= 500) {
      severity = 'Critical'; severityCls = 'errsev-critical';
    } else if (code === 401 || code === 403 || code === 429) {
      severity = 'Major';    severityCls = 'errsev-major';
    } else {
      severity = 'Minor';    severityCls = 'errsev-minor';
    }

    // ── 유형 (type) ───────────────────────────────────────────
    let type, typeCls;
    if (code >= 500) {
      type = '소스 로직 오류'; typeCls = 'errtype-logic';
    } else if (code === 401) {
      type = '인증 오류'; typeCls = 'errtype-auth';
    } else if (code === 403) {
      type = '권한 오류'; typeCls = 'errtype-auth';
    } else if (code === 404) {
      type = '리소스 없음'; typeCls = 'errtype-notfound';
    } else if (code === 409) {
      type = '데이터 충돌'; typeCls = 'errtype-conflict';
    } else if (code === 429) {
      type = '요청 한도 초과'; typeCls = 'errtype-ratelimit';
    } else if (code === 400 || code === 422) {
      type = '클라이언트 요청 오류'; typeCls = 'errtype-client';
    } else {
      type = '기타 오류'; typeCls = 'errtype-other';
    }

    // ── 원인 분석 + 트러블슈팅 (경로 패턴 기반) ──────────────
    let cause, guide;

    if (code === 401) {
      if (p.includes('/ai/usage') || p.includes('/notifications') || p.includes('/briefing')) {
        cause = '로그인 만료 상태에서 자동 폴링이 계속 실행됨. 토큰 없이 인증 필요 API에 주기적으로 요청 발생.';
        guide = [
          '프론트엔드 폴링 코드에 "로그인 상태 체크 후 실행" 조건 추가',
          '401 응답 수신 시 해당 폴링 인터벌을 즉시 중단 (clearInterval)',
          '로그인 페이지 이동 후 폴링 재개 차단',
          'SKIP_LOG_PATHS에 추가하여 access_logs 누적 방지 (이미 적용된 경로 확인)',
        ];
      } else {
        cause = 'JWT Access Token이 만료되었거나 Authorization 헤더가 누락됨.';
        guide = [
          'Refresh Token으로 자동 갱신 로직 확인 (/api/auth/refresh)',
          '클라이언트 API 인터셉터에서 401 수신 시 토큰 갱신 후 재시도 구현',
          '토큰 만료 시간 설정 확인 (config.jwtExpires)',
        ];
      }
    } else if (code === 403) {
      cause = '인증은 통과했으나 해당 리소스에 대한 권한(RBAC)이 부족함.';
      guide = [
        '요청 사용자의 역할(role) 확인 — admin/superadmin 여부',
        'devOnly 미들웨어 적용 여부 확인 (개발 전용 엔드포인트)',
        '라우트 권한 레벨 설정 검토 (rbac.js)',
      ];
    } else if (code === 404) {
      if (p.match(/\/\d+/) || p.includes('99999') || p.includes('nonexistent')) {
        cause = '존재하지 않는 ID나 경로로 요청. 테스트 데이터나 삭제된 리소스 접근 가능성.';
        guide = [
          '삭제된 리소스 참조 시 프론트엔드에서 graceful 처리 구현',
          '테스트 케이스에서 실제 존재하는 ID 사용',
          '404 응답 시 사용자에게 "리소스를 찾을 수 없습니다" 안내 UI 추가',
        ];
      } else {
        cause = '요청한 API 경로가 서버에 등록되지 않았거나 오타가 있음.';
        guide = [
          '서버 라우트 등록 여부 확인 (server.js)',
          '경로 철자 및 HTTP 메서드 일치 여부 확인',
          'API 문서(/api/docs)에서 올바른 엔드포인트 확인',
        ];
      }
    } else if (code === 400) {
      if (p === '/api/' || p === '/api') {
        cause = '라우트 매칭 실패로 API 루트에 잘못된 요청이 도달. 경로 오류 또는 테스트 코드의 잘못된 base URL 사용.';
        guide = [
          '클라이언트 API baseURL 설정 확인',
          '요청 경로가 /api/ 이하 적절한 엔드포인트를 가리키는지 확인',
          '테스트 코드의 URL 구성 로직 점검',
        ];
      } else {
        cause = '요청 바디 또는 파라미터 형식이 서버 유효성 검사를 통과하지 못함.';
        guide = [
          '요청 Content-Type 헤더 확인 (application/json)',
          '필수 필드 누락 여부 확인',
          'API 문서에서 요청 스키마 확인',
          '날짜/숫자 형식 유효성 검토',
        ];
      }
    } else if (code === 409) {
      cause = '동일한 데이터가 이미 존재하여 중복 삽입 충돌 발생. 동시 요청 또는 재시도 로직 문제.';
      guide = [
        '중복 제출 방지 — 버튼 비활성화 또는 debounce 처리',
        'Upsert(INSERT ... ON DUPLICATE KEY UPDATE) 패턴 검토',
        '클라이언트에서 409 수신 시 "이미 존재합니다" 안내',
      ];
    } else if (code === 429) {
      cause = 'Rate Limiting에 의해 요청이 차단됨. 단시간 내 과도한 API 호출.';
      guide = [
        'API 호출 빈도 조절 (debounce/throttle)',
        'Rate Limit 설정 검토 (server.js apiLimiter/aiLimiter)',
        'AI 기능은 분당 20회 제한 — 일괄 처리 로직 도입 검토',
      ];
    } else if (code === 500) {
      if (p.includes('/insights')) {
        cause = '/api/insights 라우트에서 처리되지 않은 예외 발생. 연결된 외부 서비스 또는 DB 쿼리 오류 가능성.';
        guide = [
          '서버 콘솔 로그에서 /api/insights 스택 트레이스 확인',
          '해당 라우트의 try-catch 처리 여부 점검',
          '의존하는 외부 API(Gemini 등) 응답 상태 확인',
          '응답이 없는 경우 fallback 데이터 반환 처리 추가',
        ];
      } else if (p.includes('schema-alter')) {
        cause = 'DDL 실행 중 서버 오류. 잘못된 SQL 문법이거나 트랜잭션 롤백 처리 미흡.';
        guide = [
          'dry-run 모드로 먼저 SQL 검증 후 실행',
          '스키마 변경 전 DB 백업 수행',
          '서버 로그에서 구체적인 MariaDB 오류 메시지 확인',
        ];
      } else if (p.includes('calendar') || p.includes('transcribe')) {
        cause = '외부 서비스 연동(캘린더 API, 음성 인식) 실패 또는 필수 환경변수 미설정.';
        guide = [
          '.env 파일에서 관련 API 키 및 설정값 확인',
          '외부 API 서비스 상태 및 quota 확인',
          '오류 발생 시 사용자에게 명확한 실패 메시지 반환',
        ];
      } else {
        cause = '예상치 못한 서버 내부 오류. 처리되지 않은 예외(Unhandled Exception) 또는 DB 연결 문제.';
        guide = [
          '서버 콘솔 로그에서 스택 트레이스 확인',
          '해당 라우트 핸들러에 try-catch 추가',
          'DB 연결 풀 상태 확인 (pool.getConnection())',
          '재현 가능한 경우 서버 재시작 후 테스트',
        ];
      }
    } else {
      cause = `HTTP ${code} 응답. 서버가 정상 처리하지 못한 요청.`;
      guide = ['서버 로그 및 요청 파라미터 확인', 'API 문서에서 올바른 요청 형식 확인'];
    }

    return { severity, severityCls, type, typeCls, cause, guide };
  },

  _showErrorLogs() {
    this._errorLogsState = {
      page: 1, filter: 'all', scFilter: null,
      resolvedFilter: 'all', path: '', hours: 24,
    };
    this._renderErrorLogsShell();
    this._fetchErrorLogs();
  },

  _renderErrorLogsShell() {
    document.getElementById('error-log-overlay')?.remove();
    const el = document.createElement('div');
    el.id  = 'error-log-overlay';
    el.className = 'errlog-overlay';
    el.innerHTML = `
      <div class="errlog-modal">
        <!-- ── 헤더 ─────────────────────────────────── -->
        <div class="errlog-header">
          <div>
            <h3 style="margin:0;font-size:16px">🚨 에러 로그</h3>
            <p style="margin:4px 0 0;font-size:12px;color:var(--text-3)">
              HTTP 4xx / 5xx 응답 분석 — 행 클릭 시 원인 분석·트러블슈팅 · 배지 클릭 시 해당 오류 필터
            </p>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="btn btn-sm" id="errlog-detect"
              title="지금 시점으로 핵심 엔드포인트를 즉시 점검하여 신규 오류를 자동 등록"
              style="background:rgba(33,150,243,.12);color:#1976D2;border:1px solid rgba(33,150,243,.35)">
              🔍 에러 탐지
            </button>
            <button class="btn btn-sm errlog-auto-btn" id="errlog-auto-classify"
              title="알려진 패턴을 자동으로 분석하여 조치완료 처리">
              🤖 스마트 자동 분류
            </button>
            <button class="btn btn-sm" id="errlog-resolve-all"
              style="background:rgba(23,168,90,.12);color:#17A85A;border:1px solid rgba(23,168,90,.3)">
              ✅ 잔여 전체 조치완료
            </button>
            <button class="btn btn-ghost btn-sm" id="errlog-close">✕ 닫기</button>
          </div>
        </div>

        <!-- ── 상단 배지 행 (클릭 필터) ─────────────── -->
        <div id="errlog-dist" class="errlog-dist-row">
          <span class="errlog-loading-mini">로드 중...</span>
        </div>

        <!-- ── 필터 바 ────────────────────────────────── -->
        <div class="errlog-filters">
          <div class="errlog-tab-group" id="errlog-tabs">
            <button class="errlog-tab active" data-filter="all">전체</button>
            <button class="errlog-tab" data-filter="4xx">4xx 클라이언트</button>
            <button class="errlog-tab" data-filter="5xx">5xx 서버</button>
          </div>
          <div class="errlog-filter-right">
            <select id="errlog-hours" class="form-input form-input-sm">
              <option value="0">전체 기간</option>
              <option value="1">최근 1시간</option>
              <option value="6">최근 6시간</option>
              <option value="24" selected>최근 24시간</option>
              <option value="72">최근 3일</option>
              <option value="168">최근 7일</option>
            </select>
            <input id="errlog-path" type="text" class="form-input form-input-sm"
              placeholder="경로 검색 (예: /api/ai)" style="width:180px">
            <button class="btn btn-primary btn-sm" id="errlog-search-btn">검색</button>
          </div>
        </div>

        <!-- ── 테이블 ─────────────────────────────────── -->
        <div id="errlog-table-wrap" class="errlog-table-wrap">
          <div class="errlog-loading">불러오는 중...</div>
        </div>

        <!-- ── 페이지네이션 ───────────────────────────── -->
        <div id="errlog-pagination" class="errlog-pagination"></div>
      </div>
    `;
    document.body.appendChild(el);

    // ── 이벤트 바인딩 ────────────────────────────────────────
    el.querySelector('#errlog-close').addEventListener('click', () => el.remove());
    el.addEventListener('click', e => { if (e.target === el) el.remove(); });

    // 탭 (4xx/5xx)
    el.querySelectorAll('.errlog-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        el.querySelectorAll('.errlog-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._errorLogsState.filter   = btn.dataset.filter;
        this._errorLogsState.scFilter = null;   // sc 필터 해제
        this._errorLogsState.page     = 1;
        this._syncActiveBadge();
        this._fetchErrorLogs();
      });
    });

    el.querySelector('#errlog-hours').addEventListener('change', e => {
      this._errorLogsState.hours = parseInt(e.target.value);
      this._errorLogsState.page  = 1;
      this._fetchErrorLogs();
    });
    el.querySelector('#errlog-search-btn').addEventListener('click', () => {
      this._errorLogsState.path = el.querySelector('#errlog-path').value.trim();
      this._errorLogsState.page = 1;
      this._fetchErrorLogs();
    });
    el.querySelector('#errlog-path').addEventListener('keydown', e => {
      if (e.key === 'Enter') el.querySelector('#errlog-search-btn').click();
    });

    // 에러 탐지 버튼 — 핵심 엔드포인트를 즉시 점검하여 신규 오류 자동 등록
    el.querySelector('#errlog-detect').addEventListener('click', async () => {
      const btn = el.querySelector('#errlog-detect');
      const orig = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '⏳ 탐지 중...';
      try {
        const r = await API.post('/admin/dev/error-logs/detect', {});
        if (r.success) {
          const msg = r.failed > 0
            ? `🔍 ${r.tested}건 점검 → 오류 ${r.failed}건 발견 · ${r.registered}건 신규 등록`
            : `🔍 ${r.tested}건 점검 → 정상 (오류 없음)`;
          this._showToast(msg, r.failed > 0 ? 'warn' : 'ok');
          // 상세 결과 로그 (콘솔)
          if (r.errors && r.errors.length) {
            console.group('[에러 탐지] 발견된 오류');
            r.errors.forEach(e => console.warn(`  ${e.endpoint} → ${e.status}${e.error?' ('+e.error+')':''}`));
            console.groupEnd();
          }
          this._fetchErrorLogs();
        }
      } catch (e) {
        this._showToast('탐지 실패: ' + e.message, 'err');
      } finally {
        btn.disabled = false;
        btn.innerHTML = orig;
      }
    });

    // 스마트 자동 분류 버튼
    el.querySelector('#errlog-auto-classify').addEventListener('click', () => {
      this._showAutoClassifyPanel();
    });

    // 잔여 전체 조치완료 버튼
    el.querySelector('#errlog-resolve-all').addEventListener('click', async () => {
      if (!confirm('현재 필터 기준 미조치 에러를 전부 조치완료로 처리하시겠습니까?')) return;
      const { hours, filter } = this._errorLogsState;
      try {
        const r = await API.patch('/admin/dev/error-logs/resolve', { resolveAll: true, hours, filter });
        if (r.success) {
          this._showToast(`✅ ${r.affected}건 조치완료 처리됨`);
          this._fetchErrorLogs();
        }
      } catch (e) { this._showToast('처리 실패: ' + e.message, 'err'); }
    });
  },

  // 상단 배지의 active 클래스 동기화
  _syncActiveBadge() {
    const { scFilter } = this._errorLogsState;
    document.querySelectorAll('.errlog-dist-badge').forEach(b => {
      b.classList.toggle('active', b.dataset.sc === String(scFilter));
    });
    document.querySelectorAll('.errlog-resolved-pill').forEach(b => {
      b.classList.toggle('active', b.dataset.resolved === this._errorLogsState.resolvedFilter);
    });
  },

  // 간단 토스트
  _showToast(msg, type = 'ok') {
    const t = document.createElement('div');
    t.className = 'errlog-toast ' + (type === 'err' ? 'errlog-toast-err' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2800);
  },

  // ── 스마트 자동 분류 패널 ─────────────────────────────────────
  async _showAutoClassifyPanel() {
    // 이미 열려있으면 닫기
    document.getElementById('errlog-auto-panel')?.remove();

    const panel = document.createElement('div');
    panel.id = 'errlog-auto-panel';
    panel.className = 'errlog-auto-overlay';
    panel.innerHTML = `
      <div class="errlog-auto-modal">
        <div class="errlog-auto-header">
          <div>
            <h4 style="margin:0;font-size:15px">🤖 스마트 자동 분류</h4>
            <p style="margin:4px 0 0;font-size:12px;color:var(--text-3)">
              알려진 패턴을 분석하여 실제 조치가 필요 없는 에러를 자동으로 조치완료 처리합니다.
            </p>
          </div>
          <button class="btn btn-ghost btn-sm" id="auto-panel-close">✕</button>
        </div>
        <div id="auto-panel-body" class="errlog-auto-body">
          <div class="errlog-loading">분석 중...</div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    panel.querySelector('#auto-panel-close').addEventListener('click', () => panel.remove());
    panel.addEventListener('click', e => { if (e.target === panel) panel.remove(); });

    // dry-run 미리보기
    try {
      const r = await API.post('/admin/dev/error-logs/auto-classify', { dryRun: true, hours: 24 * 7 });
      const body = document.getElementById('auto-panel-body');
      if (!body) return;

      if (!r.success) { body.innerHTML = `<p class="text-danger">오류: ${esc(r.error)}</p>`; return; }

      const totalPreview = r.totalPreview;
      if (totalPreview === 0) {
        body.innerHTML = `<div class="errlog-auto-empty">
          ✅ 자동 분류 가능한 에러가 없습니다. 모든 항목이 이미 처리되었거나 수동 검토가 필요합니다.
        </div>`;
        return;
      }

      body.innerHTML = `
        <div class="errlog-auto-summary">
          총 <strong>${totalPreview.toLocaleString()}건</strong>의 에러가 아래 기준으로 자동 조치완료 처리될 예정입니다.
        </div>
        <div class="errlog-auto-rules">
          ${r.results.map((rule, i) => `
            <div class="errlog-auto-rule ${rule.count > 0 ? 'has-items' : 'no-items'}">
              <div class="errlog-auto-rule-header">
                <span class="errlog-auto-rule-label">${esc(rule.label)}</span>
                <span class="errlog-auto-rule-cnt ${rule.count > 0 ? 'has-cnt' : ''}">${rule.count.toLocaleString()}건</span>
              </div>
              ${rule.count > 0 ? `<div class="errlog-auto-rule-note">💡 ${esc(rule.note)}</div>` : ''}
            </div>`).join('')}
        </div>
        <div class="errlog-auto-actions">
          <p style="font-size:12px;color:var(--text-3);margin:0 0 10px">
            ⚠️ 이 작업은 되돌릴 수 있습니다. 실수로 처리된 항목은 미조치로 변경 가능합니다.
          </p>
          <div style="display:flex;gap:8px">
            <button class="btn btn-sm" id="auto-apply-btn"
              style="background:rgba(23,168,90,.12);color:#17A85A;border:1px solid rgba(23,168,90,.3);font-weight:600">
              ✅ ${totalPreview.toLocaleString()}건 자동 조치완료 처리
            </button>
            <button class="btn btn-ghost btn-sm" id="auto-cancel-btn">취소</button>
          </div>
        </div>
      `;

      document.getElementById('auto-cancel-btn').addEventListener('click', () => panel.remove());
      document.getElementById('auto-apply-btn').addEventListener('click', async () => {
        const applyBtn = document.getElementById('auto-apply-btn');
        applyBtn.disabled = true;
        applyBtn.textContent = '처리 중...';
        try {
          const res = await API.post('/admin/dev/error-logs/auto-classify', { dryRun: false, hours: 24 * 7 });
          if (res.success) {
            panel.remove();
            this._showToast(`✅ ${res.totalAffected.toLocaleString()}건 자동 분류 완료`);
            this._fetchErrorLogs();
          } else {
            this._showToast('처리 실패: ' + res.error, 'err');
            applyBtn.disabled = false;
            applyBtn.textContent = '다시 시도';
          }
        } catch (e) {
          this._showToast('오류: ' + e.message, 'err');
          applyBtn.disabled = false;
        }
      });

    } catch (e) {
      const body = document.getElementById('auto-panel-body');
      if (body) body.innerHTML = `<p class="text-danger">분석 실패: ${esc(e.message)}</p>`;
    }
  },

  async _fetchErrorLogs() {
    const wrap = document.getElementById('errlog-table-wrap');
    const pag  = document.getElementById('errlog-pagination');
    const dist = document.getElementById('errlog-dist');
    if (!wrap) return;

    const { page, filter, scFilter, resolvedFilter, path, hours } = this._errorLogsState;
    wrap.innerHTML = '<div class="errlog-loading">불러오는 중...</div>';
    if (pag) pag.innerHTML = '';

    try {
      const params = new URLSearchParams({ page, filter, hours, limit: 50, resolved: resolvedFilter });
      if (scFilter)  params.set('sc',   scFilter);
      if (path)      params.set('path', path);
      const r = await API.get('/admin/dev/error-logs?' + params.toString());
      const d = r.data;

      // ── 상단 배지 행 렌더 ──────────────────────────────────
      if (dist) {
        const summary  = d.summary || { pending: 0, resolved: 0 };
        const distBadges = (d.dist || []).map(item => {
          const sc   = parseInt(item.status_code);
          const info = this._classifyError(sc, '', '');
          const cls  = sc >= 500 ? 'errlog-badge-5xx'
                     : sc === 401 ? 'errlog-badge-401'
                     : sc === 404 ? 'errlog-badge-404' : 'errlog-badge-4xx';
          const isActive = scFilter === sc;
          const pending  = parseInt(item.cnt) - parseInt(item.resolved_cnt || 0);
          return `<span class="errlog-dist-badge errlog-badge ${cls} ${isActive?'active':''}"
                        data-sc="${sc}" title="${info.type} — 클릭하여 필터">
            <span class="errlog-badge-sc">${sc}</span>
            <span class="errlog-badge-type">${info.type}</span>
            <span class="errlog-badge-cnt">${parseInt(item.cnt).toLocaleString()}</span>
            ${parseInt(item.resolved_cnt||0) > 0
              ? `<span class="errlog-badge-resolved-mini">✓${parseInt(item.resolved_cnt).toLocaleString()}</span>`
              : ''}
          </span>`;
        }).join('');

        // 잔여/조치완료 필터 알약
        const pills = [
          { key: 'all',      label: '전체',         cnt: (summary.pending + summary.resolved) },
          { key: 'pending',  label: '🔴 잔여 오류',  cnt: summary.pending },
          { key: 'resolved', label: '✅ 조치완료',   cnt: summary.resolved },
        ].map(p => `
          <span class="errlog-resolved-pill ${resolvedFilter === p.key ? 'active' : ''}"
                data-resolved="${p.key}">
            ${p.label} <strong>${parseInt(p.cnt||0).toLocaleString()}</strong>
          </span>`).join('');

        dist.innerHTML = `
          <div class="errlog-dist-badges">${distBadges}</div>
          <div class="errlog-resolved-pills">${pills}</div>
        `;

        // 배지 클릭 → sc 필터
        dist.querySelectorAll('.errlog-dist-badge').forEach(badge => {
          badge.addEventListener('click', () => {
            const sc = parseInt(badge.dataset.sc);
            this._errorLogsState.scFilter = (this._errorLogsState.scFilter === sc) ? null : sc;
            this._errorLogsState.page = 1;
            this._syncActiveBadge();
            this._fetchErrorLogs();
          });
        });

        // 알약 클릭 → resolved 필터
        dist.querySelectorAll('.errlog-resolved-pill').forEach(pill => {
          pill.addEventListener('click', () => {
            this._errorLogsState.resolvedFilter = pill.dataset.resolved;
            this._errorLogsState.page = 1;
            this._syncActiveBadge();
            this._fetchErrorLogs();
          });
        });
      }

      // ── 테이블 ──────────────────────────────────────────────
      if (!d.rows?.length) {
        wrap.innerHTML = `<div class="errlog-empty">
          ${resolvedFilter === 'resolved' ? '✅ 조치완료된 에러가 없습니다.' :
            resolvedFilter === 'pending'  ? '🎉 미조치 에러가 없습니다!' :
            '조건에 맞는 에러 로그가 없습니다.'}
        </div>`;
        return;
      }

      const rows = d.rows;
      // ── 동일 패턴(sc+method+path)별 잔여 카운트 사전 집계 (현재 페이지 기준) ─
      // 페이지네이션 한계로 전체 잔여수는 서버 API로 다시 조회해야 정확하지만,
      // 화면상 잔여 행만으로도 사용자에게 "몇 건이 일괄 처리될지" 직관적 표시 가능
      const _patternPending = {};
      rows.forEach(r => {
        if (!r.resolved) {
          const k = `${r.status_code}|${r.method}|${r.path}`;
          _patternPending[k] = (_patternPending[k] || 0) + 1;
        }
      });
      wrap.innerHTML = `
        <table class="data-table errlog-table">
          <thead><tr>
            <th style="width:110px">시각</th>
            <th style="width:46px">상태</th>
            <th style="width:80px">등급</th>
            <th style="width:120px">유형</th>
            <th style="width:46px">메서드</th>
            <th>경로</th>
            <th style="width:80px">사용자</th>
            <th style="width:55px" class="text-right">ms</th>
            <th style="width:88px" class="text-center">조치 상태</th>
          </tr></thead>
          <tbody id="errlog-tbody">
            ${rows.map((row, idx) => {
              const sc      = parseInt(row.status_code);
              const info    = this._classifyError(sc, row.method, row.path);
              const scCls   = sc >= 500 ? 'errlog-sc-5xx'
                            : sc === 401 ? 'errlog-sc-401'
                            : sc === 404 ? 'errlog-sc-404' : 'errlog-sc-4xx';
              const dt  = new Date(row.created_at);
              const dts = `${dt.getMonth()+1}/${dt.getDate()} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
              const user     = row.user_name
                ? `<span title="${esc(row.user_email||'')}">👤 ${esc(row.user_name)}</span>`
                : '<span style="color:var(--text-4)">—</span>';
              const dur    = parseInt(row.duration_ms || 0);
              const durCls = dur > 1000 ? 'text-danger' : dur > 300 ? 'text-warning' : '';
              const isResolved = !!row.resolved;
              const resolvedBy = row.resolved_by_name ? `${esc(row.resolved_by_name)}` : '';
              const resolvedAt = row.resolved_at
                ? (() => { const d2=new Date(row.resolved_at); return `${d2.getMonth()+1}/${d2.getDate()}`; })()
                : '';
              const statusCell = isResolved
                ? `<div class="errlog-status-cell resolved" data-id="${row.id}" data-resolved="1">
                     <span class="errlog-status-badge resolved" title="조치완료${resolvedBy?' by '+resolvedBy:''}${resolvedAt?' ('+resolvedAt+')':''}">✓ 완료</span>
                   </div>`
                : `<div class="errlog-status-cell pending" data-id="${row.id}" data-resolved="0">
                     <span class="errlog-status-badge pending">미조치</span>
                   </div>`;

              return `
                <tr class="errlog-row ${isResolved?'errlog-row-resolved':''}" data-idx="${idx}" data-id="${row.id}">
                  <td class="mono" style="font-size:11px">${dts}</td>
                  <td><span class="errlog-sc ${scCls}">${sc}</span></td>
                  <td><span class="errsev-pill ${info.severityCls}">${info.severity}</span></td>
                  <td><span class="errtype-pill ${info.typeCls}">${info.type}</span></td>
                  <td><span class="badge badge-blue" style="font-size:10px">${esc(row.method||'')}</span></td>
                  <td class="mono errlog-path" style="font-size:11px" title="${esc(row.path||'')}">${esc(row.path||'')}</td>
                  <td style="font-size:11px">${user}</td>
                  <td class="text-right ${durCls}" style="font-size:11px">${dur}ms</td>
                  <td class="text-center">${statusCell}</td>
                </tr>
                <tr class="errlog-detail-row" id="errlog-detail-${idx}" style="display:none">
                  <td colspan="9" class="errlog-detail-cell">
                    <div class="errlog-analysis">
                      <div class="errlog-analysis-cause">
                        <strong>🔍 원인 분석</strong>
                        <p>${esc(info.cause)}</p>
                      </div>
                      <div class="errlog-analysis-guide">
                        <strong>🛠 트러블슈팅 가이드</strong>
                        <ol>${info.guide.map(g => `<li>${esc(g)}</li>`).join('')}</ol>
                      </div>
                      <div class="errlog-analysis-actions">
                        <strong>⚡ 빠른 조치</strong>
                        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
                          ${isResolved
                            ? `<button class="btn btn-sm errlog-action-btn errlog-unresolve-btn"
                                 data-id="${row.id}">↩ 미조치로 되돌리기</button>`
                            : (() => {
                                const pk = `${sc}|${row.method}|${row.path}`;
                                const pendingCnt = _patternPending[pk] || 1;
                                const cntLabel = pendingCnt > 1 ? ` · 잔여 ${pendingCnt}건` : '';
                                return `<button class="btn btn-sm errlog-action-btn errlog-resolve-btn"
                                   data-id="${row.id}" style="background:rgba(23,168,90,.12);color:#17A85A;border:1px solid rgba(23,168,90,.3)">
                                   ✓ 이 항목만 조치완료 처리</button>
                                 <button class="btn btn-sm errlog-action-btn errlog-resolve-pattern-btn"
                                   data-sc="${sc}" data-method="${esc(row.method)}" data-path="${esc(row.path)}"
                                   data-pending="${pendingCnt}"
                                   style="background:rgba(23,168,90,.07);color:#17A85A;border:1px solid rgba(23,168,90,.2)"
                                   title="동일 패턴(${sc} ${esc(row.method)} ${esc(row.path)})의 모든 미조치 항목을 일괄 처리합니다">
                                   ⚡ 동일 패턴 일괄 처리${cntLabel}</button>`;
                              })()
                          }
                        </div>
                        ${isResolved && resolvedBy
                          ? `<p style="margin:8px 0 0;font-size:11px;color:var(--text-3)">조치완료: ${resolvedBy}${resolvedAt?' · '+resolvedAt:''}</p>`
                          : ''}
                      </div>
                    </div>
                  </td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      `;

      // ── 행 클릭 → 분석 패널 토글 ────────────────────────────
      wrap.querySelectorAll('.errlog-row').forEach(tr => {
        tr.addEventListener('click', e => {
          // 조치 상태 셀 클릭은 별도 처리 → 토글 아님
          if (e.target.closest('.errlog-status-cell')) return;
          const idx    = tr.dataset.idx;
          const detail = document.getElementById(`errlog-detail-${idx}`);
          const isOpen = detail.style.display !== 'none';
          wrap.querySelectorAll('.errlog-detail-row').forEach(d => { d.style.display = 'none'; });
          wrap.querySelectorAll('.errlog-row').forEach(r => r.classList.remove('errlog-row-active'));
          if (!isOpen) { detail.style.display = ''; tr.classList.add('errlog-row-active'); }
        });
      });

      // ── 조치 상태 셀 클릭 (토글) ────────────────────────────
      wrap.querySelectorAll('.errlog-status-cell').forEach(cell => {
        cell.addEventListener('click', e => {
          e.stopPropagation();
          const id         = parseInt(cell.dataset.id);
          const isResolved = cell.dataset.resolved === '1';
          this._toggleResolve(id, !isResolved, cell);
        });
      });

      // ── 분석 패널 내 버튼들 ──────────────────────────────────
      wrap.querySelectorAll('.errlog-resolve-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          const id = parseInt(btn.dataset.id);
          await this._toggleResolve(id, true);
          this._fetchErrorLogs();
        });
      });
      wrap.querySelectorAll('.errlog-unresolve-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          const id = parseInt(btn.dataset.id);
          await this._toggleResolve(id, false);
          this._fetchErrorLogs();
        });
      });
      wrap.querySelectorAll('.errlog-resolve-pattern-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          const { sc, method, path: p, pending } = btn.dataset;
          // 데이터 변경 사고 방지: 사용자 확인 후 진행
          const ok = confirm(
            `동일 패턴 일괄 처리\n\n` +
            `  ${sc} ${method} ${p}\n\n` +
            `현재 화면 잔여 ${pending||'?'}건 (실제 DB 기준 전체 미조치 항목이 처리됩니다)\n\n` +
            `계속하시겠습니까?`
          );
          if (!ok) return;
          try {
            const r = await API.patch('/admin/dev/error-logs/resolve',
              { pattern: { sc: parseInt(sc), method, path: p } });
            if (r.success) {
              this._showToast(`✅ ${r.affected}건 일괄 조치완료`);
              this._fetchErrorLogs();
            }
          } catch (err) { this._showToast('실패: ' + err.message, 'err'); }
        });
      });

      // ── 페이지네이션 ────────────────────────────────────────
      if (pag) {
        const cur   = d.page, tot = d.totalPages;
        const total = parseInt(d.total).toLocaleString();
        if (tot > 1) {
          const range = 2;
          let pages = '';
          for (let i = 1; i <= tot; i++) {
            if (i === 1 || i === tot || (i >= cur - range && i <= cur + range)) {
              pages += `<button class="errlog-page-btn ${i===cur?'active':''}" data-page="${i}">${i}</button>`;
            } else if (i === cur - range - 1 || i === cur + range + 1) {
              pages += `<span class="errlog-page-ellipsis">…</span>`;
            }
          }
          pag.innerHTML = `
            <span class="errlog-total">총 ${total}건 (${tot}페이지)</span>
            <div class="errlog-page-group">
              <button class="errlog-page-btn" data-page="${Math.max(1,cur-1)}" ${cur===1?'disabled':''}>‹</button>
              ${pages}
              <button class="errlog-page-btn" data-page="${Math.min(tot,cur+1)}" ${cur===tot?'disabled':''}>›</button>
            </div>`;
          pag.querySelectorAll('.errlog-page-btn:not([disabled])').forEach(btn => {
            btn.addEventListener('click', () => {
              this._errorLogsState.page = parseInt(btn.dataset.page);
              this._fetchErrorLogs();
            });
          });
        } else {
          pag.innerHTML = `<span class="errlog-total">총 ${total}건</span>`;
        }
      }

    } catch (e) {
      if (wrap) wrap.innerHTML = `<div class="errlog-empty text-danger">오류: ${esc(e.message||String(e))}</div>`;
    }
  },

  // 개별 ID 조치 상태 토글 (셀 즉시 업데이트 + API 호출)
  // ⚠️ 데이터 정합성: 낙관적 업데이트 후 API 실패 시 반드시 롤백
  async _toggleResolve(id, toResolved, cellEl) {
    const setCell = (resolved) => {
      if (!cellEl) return;
      cellEl.dataset.resolved = resolved ? '1' : '0';
      cellEl.className = 'errlog-status-cell ' + (resolved ? 'resolved' : 'pending');
      cellEl.innerHTML = resolved
        ? `<span class="errlog-status-badge resolved" title="조치완료">✓ 완료</span>`
        : `<span class="errlog-status-badge pending">미조치</span>`;
      const tr = cellEl.closest('tr');
      if (tr) tr.classList.toggle('errlog-row-resolved', resolved);
    };

    const prevState = !toResolved;   // 롤백용 이전 상태
    setCell(toResolved);              // 낙관적 업데이트

    try {
      const endpoint = toResolved ? '/admin/dev/error-logs/resolve' : '/admin/dev/error-logs/unresolve';
      const r = await API.patch(endpoint, { ids: [id] });
      if (!r || r.success === false) throw new Error(r?.error || '서버 응답 오류');
      // 상단 요약 재조회로 dist/summary 동기화
      this._fetchErrorLogs();
    } catch (err) {
      // ⚠️ 실패 시 UI 롤백 — 화면-DB 어긋남 방지
      setCell(prevState);
      this._showToast('저장 실패 (변경 취소됨): ' + err.message, 'err');
    }
  },

  // ══════════════════════════════════════════════════════════
  // TAB 5: JWT 인스펙터
  // ══════════════════════════════════════════════════════════
  renderJWT() {
    document.getElementById('dev-content').innerHTML = `
      <div class="dev-section-header">
        <div>
          <h3 style="margin:0;font-size:15px">🔐 JWT 토큰 인스펙터</h3>
          <p style="margin:4px 0 0;font-size:12px;color:var(--text-3)">
            임의의 JWT를 붙여넣어 Header·Payload를 즉시 디코딩합니다.
            Signature 검증은 서버키 없이 불가 (무결성 확인은 서버에서).
          </p>
        </div>
        <button class="btn btn-ghost btn-sm" id="jwt-load-current">현재 토큰 불러오기</button>
      </div>

      <div style="margin-bottom:16px">
        <textarea id="jwt-input" class="form-input" rows="4"
          style="font-family:monospace;font-size:12px;word-break:break-all"
          placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."></textarea>
        <button class="btn btn-primary" id="jwt-decode-btn" style="margin-top:8px">🔍 디코딩</button>
      </div>

      <div id="jwt-result"></div>
    `;

    document.getElementById('jwt-load-current')?.addEventListener('click', () => {
      const tok = localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token') || '';
      const ta = document.getElementById('jwt-input');
      if (ta) ta.value = tok;
    });

    document.getElementById('jwt-decode-btn')?.addEventListener('click', () => {
      const raw = document.getElementById('jwt-input')?.value?.trim() || '';
      this._decodeJWT(raw);
    });

    document.getElementById('jwt-input')?.addEventListener('input', () => {
      const raw = document.getElementById('jwt-input')?.value?.trim() || '';
      if (raw.split('.').length === 3) this._decodeJWT(raw);
    });
  },

  _decodeJWT(raw) {
    const result = document.getElementById('jwt-result');
    if (!result) return;
    if (!raw) { result.innerHTML = ''; return; }

    const parts = raw.split('.');
    if (parts.length !== 3) {
      result.innerHTML = '<div style="color:var(--oci-red)">⚠️ 유효하지 않은 JWT 형식 (점(.)이 3개여야 합니다)</div>';
      return;
    }

    const base64Decode = s => {
      try {
        return JSON.parse(atob(s.replace(/-/g,'+').replace(/_/g,'/')));
      } catch { return null; }
    };

    const header  = base64Decode(parts[0]);
    const payload = base64Decode(parts[1]);

    if (!header || !payload) {
      result.innerHTML = '<div style="color:var(--oci-red)">⚠️ 디코딩 실패</div>';
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const isExpired = payload.exp && payload.exp < now;
    const expDate = payload.exp ? new Date(payload.exp * 1000).toLocaleString('ko-KR') : '-';
    const iatDate = payload.iat ? new Date(payload.iat * 1000).toLocaleString('ko-KR') : '-';
    const remaining = payload.exp ? Math.max(0, payload.exp - now) : null;
    const remStr = remaining !== null
      ? (remaining > 60 ? `${Math.round(remaining/60)}분 남음` : `${remaining}초 남음`)
      : '';

    result.innerHTML = `
      <div class="jwt-status ${isExpired ? 'expired' : 'valid'}">
        ${isExpired ? '⛔ 만료된 토큰' : '✅ 유효한 토큰'} ${remStr ? `— ${remStr}` : ''}
      </div>
      <div class="jwt-grid">
        <div class="jwt-section">
          <div class="jwt-section-title">Header</div>
          <pre class="jwt-pre">${esc(JSON.stringify(header, null, 2))}</pre>
        </div>
        <div class="jwt-section">
          <div class="jwt-section-title">Payload</div>
          <pre class="jwt-pre">${esc(JSON.stringify(payload, null, 2))}</pre>
          <div class="jwt-meta">
            <div>발급: ${esc(iatDate)}</div>
            <div class="${isExpired?'text-danger':''}">만료: ${esc(expDate)}</div>
            ${payload.role ? `<div>역할: <strong>${esc(payload.role)}</strong></div>` : ''}
            ${payload.jti  ? `<div>JTI: <code style="font-size:10px">${esc(payload.jti)}</code></div>` : ''}
          </div>
        </div>
        <div class="jwt-section">
          <div class="jwt-section-title">Signature</div>
          <div style="font-size:12px;color:var(--text-3);padding:12px">
            <code style="word-break:break-all;font-size:10px">${esc(parts[2])}</code>
            <p style="margin-top:8px;font-size:11px">
              ⚠️ Signature 검증은 서버 비밀키가 필요합니다.<br>
              현재 토큰 유효성은 <code>/api/auth/me</code> 호출로 확인하세요.
            </p>
          </div>
        </div>
      </div>
    `;
  },

  // ══════════════════════════════════════════════════════════
  // TAB 6: 개발 로드맵 (제안)
  // ══════════════════════════════════════════════════════════
  renderRoadmap() {
    document.getElementById('dev-content').innerHTML = `
      <div class="dev-section-header">
        <div>
          <h3 style="margin:0;font-size:15px">🚀 개발자 도구 로드맵 & 제안</h3>
          <p style="margin:4px 0 0;font-size:12px;color:var(--text-3)">
            커스텀 개발을 지원하는 추가 기능 후보 목록입니다.
          </p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;font-size:12px">
          <span style="display:flex;align-items:center;gap:4px"><span class="roadmap-dot done"></span>구현완료</span>
          <span style="display:flex;align-items:center;gap:4px"><span class="roadmap-dot planned"></span>계획</span>
        </div>
      </div>

      <div class="roadmap-grid">
        ${this.PROPOSALS.map(p => `
          <div class="roadmap-card ${p.status}">
            <div class="roadmap-card-header">
              <span class="roadmap-icon">${p.icon}</span>
              <div class="roadmap-title">${esc(p.title)}</div>
              <span class="roadmap-status-badge ${p.status}">${p.status === 'done' ? '✅ 완료' : '📋 계획'}</span>
            </div>
            <div class="roadmap-desc">${esc(p.desc)}</div>
            <div class="roadmap-meta">
              <span class="roadmap-chip impact">영향도: <strong>${esc(p.impact)}</strong></span>
              <span class="roadmap-chip effort">공수: <strong>${esc(p.effort)}</strong></span>
            </div>
          </div>
        `).join('')}
      </div>

      <!-- 커스텀 개발 가이드 -->
      <div class="card" style="margin-top:24px">
        <div class="card-header"><div class="card-title">📖 커스텀 개발 빠른 가이드</div></div>
        <div class="card-body">
          <div class="dev-guide-grid">
            <div class="dev-guide-item">
              <div class="dev-guide-title">새 API 라우트 추가</div>
              <pre class="dev-guide-code">// src/routes/myfeature.js
const router = require('express').Router();
router.get('/', async (req, res) => {
  res.json({ success: true, data: [] });
});
module.exports = router;

// server.js
app.use('/api/myfeature',
  require('./src/routes/myfeature'));</pre>
            </div>
            <div class="dev-guide-item">
              <div class="dev-guide-title">새 프론트엔드 페이지 추가</div>
              <pre class="dev-guide-code">// public/js/pages/mypage.js
const MyPage = {
  async render() {
    document.getElementById('content')
      .innerHTML = '&lt;div&gt;내용&lt;/div&gt;';
    await this.loadData();
  },
  async loadData() { ... }
};

// app.js pages 맵에 추가:
mypage: { obj: () => MyPage,
  title: '내 페이지', crumb: '...' }</pre>
            </div>
            <div class="dev-guide-item">
              <div class="dev-guide-title">기능 플래그 체크</div>
              <pre class="dev-guide-code">// 프론트엔드에서 기능 활성화 확인
if (Features.isEnabled('my.feature')) {
  // 기능 표시
}

// 백엔드 라우트에서 확인
const flag = await getFlag('my.feature');
if (!flag) return res.status(403)
  .json({ error: '기능이 비활성화됨' });</pre>
            </div>
            <div class="dev-guide-item">
              <div class="dev-guide-title">Modal 열기 (CSP-safe)</div>
              <pre class="dev-guide-code">Modal.open({
  title: '제목',
  body: '&lt;form id="my-form"&gt;...&lt;/form&gt;',
  footer: '&lt;button id="m-ok"&gt;확인&lt;/button&gt;',
  bind: {
    '#m-ok': () => {
      // 핸들러 (inline onclick 금지)
      Modal.close();
    }
  }
});</pre>
            </div>
          </div>
        </div>
      </div>
    `;
  }
};
