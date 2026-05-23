// ============================================================
// ProposalsPage — 제안관리 아카이브
//   Phase 1: 목록 + 등록/편집 (1탭)
//   Phase 2: 7개 탭 상세 모달 + RFP 메타정보 + 견적/리비전/이력 표시
//            (RFP 파일 / AI / 자료 / 이메일은 Phase 3~5)
// ============================================================
const ProposalsPage = (() => {
  // ── 모듈 상태 ────────────────────────────────────────────
  let _list = [];
  let _editing = null;
  let _leadsCache = [];
  let _quotesCache = [];
  let _teamCache = [];
  let _comboboxes = [];
  let _activeTab = 'basic'; // 현재 활성 탭

  // 상태 → 한국어 라벨 / 색상
  const STATUS_LABEL = {
    draft: '준비중',
    review: '내부검토',
    ready: '제출준비완료',
    sent: '발송완료',
    revised: '수정요청',
    accepted: '채택',
    rejected: '거절',
    expired: '만료',
  };
  const STATUS_COLOR = {
    draft: 'gray',
    review: 'blue',
    ready: 'blue',
    sent: 'blue',
    revised: 'orange',
    accepted: 'green',
    rejected: 'red',
    expired: 'gray',
  };
  // Phase 8-C: 3-탭 구조 — 새 워크플로우 (RFP 업로드→AI 분석→폼 자동채움)
  //   1. 기본정보 (RFP 섹션 상단 + 제안 기본정보 + AI 제안전략 요약 [비고 자리])
  //   2. 자료 & 견적 (파일 + AI 평가/수주확률)
  //   3. 발송 & 이력 (이메일/공유 + 리비전/이력)
  // 이전 4탭의 'ai' 탭은 기본정보 탭에 통합됨 (DB 컬럼/API 무변경)
  const TABS = [
    { id: 'basic', label: '📋 기본정보', alwaysOn: true },
    { id: 'content', label: '📦 자료 & 견적', editOnly: true },
    { id: 'send', label: '📤 발송 & 이력', editOnly: true },
  ];

  // ── 유틸 ─────────────────────────────────────────────────
  function _fmtDate(s) {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d)) return s;
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
  }
  function _fmtDateTime(s) {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d)) return s;
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function _toInputDate(s) {
    if (!s) return new Date().toISOString().slice(0, 10);
    const d = new Date(s);
    if (isNaN(d)) return new Date().toISOString().slice(0, 10);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function _statusLabel(s) {
    return STATUS_LABEL[s] || s || '준비중';
  }
  function _statusColor(s) {
    return STATUS_COLOR[s] || 'gray';
  }
  function _debounce(fn, ms) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }
  function _cleanupInstances() {
    _comboboxes.forEach(c => {
      try {
        c.destroy?.();
      } catch (_) {}
    });
    _comboboxes = [];
  }

  // ── 캐시 prefetch ────────────────────────────────────────
  async function _ensureLeads() {
    if (_leadsCache.length > 0) return;
    try {
      const r = await API.leads.list({ limit: 500 });
      _leadsCache = r.data || [];
    } catch (_) {
      _leadsCache = [];
    }
  }
  async function _ensureQuotes() {
    if (_quotesCache.length > 0) return;
    try {
      const r = await API.quotes.list({ limit: 500 });
      _quotesCache = r.data || [];
    } catch (_) {
      _quotesCache = [];
    }
  }
  async function _ensureTeam() {
    if (_teamCache.length > 0) return;
    try {
      const r = await API.team.list();
      _teamCache = r.data || [];
    } catch (_) {
      _teamCache = [];
    }
  }

  // ── 페이지 렌더 ──────────────────────────────────────────
  async function render() {
    const content = document.getElementById('content');
    content.innerHTML = `
      <div class="filter-bar">
        <input class="search-input" id="pr-search" placeholder="제안명·고객사·번호 검색...">
        <select class="filter-select" id="pr-status">
          <option value="">전체 상태</option>
          ${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
        </select>
        <label style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--text-2)">
          <input type="checkbox" id="pr-due-soon"> 마감임박 (7일)
        </label>
        <div style="margin-left:auto;display:flex;gap:8px">
          <button class="btn btn-primary" id="pr-new-btn">+ 제안 등록</button>
        </div>
      </div>
      <div id="pr-list-wrap">
        <div class="loading" style="padding:40px;text-align:center">로딩...</div>
      </div>
    `;

    document.getElementById('pr-new-btn').addEventListener('click', () => _openModal(null));
    document.getElementById('pr-search').addEventListener('input', _debounce(_reload, 250));
    document.getElementById('pr-status').addEventListener('change', _reload);
    document.getElementById('pr-due-soon').addEventListener('change', _reload);

    await _reload();
  }

  async function _reload() {
    const search = document.getElementById('pr-search')?.value || '';
    const status = document.getElementById('pr-status')?.value || '';
    const dueSoon = document.getElementById('pr-due-soon')?.checked ? 1 : '';
    const wrap = document.getElementById('pr-list-wrap');
    if (!wrap) return;
    try {
      const res = await API.proposals.list({ search, status, due_soon: dueSoon, limit: 100 });
      _list = res.data || [];
      wrap.innerHTML = _renderList(_list);
      _bindListEvents();
    } catch (err) {
      wrap.innerHTML = `<div style="padding:40px;text-align:center;color:#d93025">불러오기 실패: ${esc(err.message || err)}</div>`;
    }
  }

  function _renderList(rows) {
    if (!rows.length) {
      return `<div style="padding:60px;text-align:center;color:var(--text-3)">
        등록된 제안이 없습니다. <br>우측 상단의 [+ 제안 등록] 버튼을 눌러 시작하세요.
      </div>`;
    }
    return `
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:130px">제안번호</th>
            <th>제안명</th>
            <th style="width:140px">고객사</th>
            <th style="width:110px">연결견적</th>
            <th style="width:130px;text-align:right">예상금액</th>
            <th style="width:80px;text-align:center">파일</th>
            <th style="width:90px;text-align:center">상태</th>
            <th style="width:100px">제출기한</th>
            <th style="width:110px">담당자</th>
            <th style="width:240px;text-align:center">액션</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(r => {
              const due = r.due_date ? _fmtDate(r.due_date) : '-';
              const overdue =
                r.due_date && new Date(r.due_date) < new Date() && r.status !== 'accepted'
                  ? 'style="color:#d93025;font-weight:600"'
                  : '';
              return `
            <tr data-id="${r.id}">
              <td style="font-family:monospace;font-size:12px">${esc(r.proposal_no)}</td>
              <td><a href="#" class="pr-link" data-id="${r.id}" style="color:var(--oci-red);font-weight:500">${esc(r.proposal_title)}</a></td>
              <td>${esc(r.customer_name || '')}</td>
              <td style="font-family:monospace;font-size:11px;color:var(--text-3)">${esc(r.quote_no || '-')}</td>
              <td style="text-align:right;font-weight:500">${r.expected_amount ? esc(Fmt.amount(r.expected_amount, r.currency || 'KRW')) : '-'}</td>
              <td style="text-align:center">${r.file_count > 0 ? `<span class="badge badge-blue">${r.file_count}</span>` : '-'}</td>
              <td style="text-align:center"><span class="badge badge-${_statusColor(r.status)}">${_statusLabel(r.status)}</span></td>
              <td ${overdue}>${due}</td>
              <td>${esc(r.owner_name || '-')}</td>
              <td style="text-align:center">
                <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${r.id}">상세</button>
                <button class="btn btn-ghost btn-sm" data-act="delete" data-id="${r.id}" style="color:#d93025">삭제</button>
              </td>
            </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    `;
  }

  function _bindListEvents() {
    document.querySelectorAll('.pr-link').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        const id = parseInt(a.dataset.id, 10);
        _openModal(id);
      });
    });
    document.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        const id = parseInt(btn.dataset.id, 10);
        const act = btn.dataset.act;
        if (act === 'edit') _openModal(id);
        else if (act === 'delete') _delete(id);
      });
    });
  }

  async function _delete(id) {
    if (!confirm('이 제안을 삭제하시겠습니까? 관련 파일/리비전/이력도 함께 삭제됩니다.')) return;
    try {
      await API.proposals.delete(id);
      Toast.success('삭제됨');
      await _reload();
    } catch (err) {
      Toast.error('삭제 실패: ' + (err.message || err));
    }
  }

  // ── 모달 (Phase 2: 7개 탭 구조) ──────────────────────────
  async function _openModal(id) {
    _editing = null;
    _cleanupInstances();
    _activeTab = 'basic'; // 항상 기본정보 탭으로 시작

    // 캐시 prefetch (병렬)
    await Promise.all([_ensureLeads(), _ensureQuotes(), _ensureTeam()]);

    if (id) {
      try {
        const r = await API.proposals.get(id);
        _editing = r.data;
      } catch (err) {
        Toast.error('제안 정보 불러오기 실패: ' + (err.message || err));
        return;
      }
    }

    const e = _editing || {
      proposal_no: '(저장 시 자동 생성)',
      proposal_title: '',
      customer_name: '',
      proposal_date: new Date().toISOString().slice(0, 10),
      status: 'draft',
      lead_id: null,
      customer_id: null,
      quote_id: null,
      due_date: '',
      owner_id: null,
      expected_amount: '',
      currency: 'KRW',
      remark: '',
    };

    Modal.open({
      title: id ? `📝 제안 상세 — ${esc(e.proposal_no)} (${_statusLabel(e.status)})` : '✏️ 새 제안 등록',
      width: 1180,
      body: _renderModalBody(e),
      footer: `
        <button class="btn btn-ghost" id="pr-cancel-btn">닫기</button>
        <button class="btn btn-primary" id="pr-save-btn">💾 저장</button>
      `,
      disableOverlayClose: true,
      bind: {
        '#pr-cancel-btn': () => {
          _cleanupInstances();
          Modal.close();
        },
        '#pr-save-btn': () => _save(),
      },
      onOpen: () => {
        _bindTabEvents();
        _renderActiveTab(e);
      },
    });
  }

  function _renderModalBody(e) {
    const isNew = !e.id;
    return `
      <div class="pr-modal">
        <!-- 탭 헤더 -->
        <div class="pr-tabs" style="display:flex;gap:0;border-bottom:2px solid var(--border);margin:-8px -8px 16px;overflow-x:auto">
          ${TABS.map(t => {
            const disabled = isNew && t.editOnly;
            const active = t.id === _activeTab;
            return `<button class="pr-tab ${active ? 'active' : ''}" data-tab="${t.id}" type="button"
              ${disabled ? 'disabled' : ''}
              style="padding:10px 16px;border:none;background:none;cursor:${disabled ? 'not-allowed' : 'pointer'};
                     font-size:13px;font-weight:500;flex-shrink:0;
                     border-bottom:2px solid ${active ? 'var(--oci-red)' : 'transparent'};
                     margin-bottom:-2px;
                     color:${disabled ? 'var(--text-3)' : active ? 'var(--oci-red)' : 'var(--text-2)'};
                     opacity:${disabled ? '0.4' : '1'}">${t.label}</button>`;
          }).join('')}
        </div>

        <!-- 탭 컨텐츠 영역 -->
        <div id="pr-tab-content" style="min-height:520px;max-height:580px;overflow-y:auto;padding:4px 4px 20px">
          <!-- 동적 렌더 -->
        </div>
      </div>
    `;
  }

  function _bindTabEvents() {
    document.querySelectorAll('.pr-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const tab = btn.dataset.tab;
        if (tab === _activeTab) return;
        _activeTab = tab;
        // 탭 active 시각적 갱신
        document.querySelectorAll('.pr-tab').forEach(b => {
          const isActive = b.dataset.tab === tab;
          b.classList.toggle('active', isActive);
          b.style.borderBottomColor = isActive ? 'var(--oci-red)' : 'transparent';
          b.style.color = b.disabled
            ? 'var(--text-3)'
            : isActive
              ? 'var(--oci-red)'
              : 'var(--text-2)';
        });
        // _editing 사용 (이미 로드됨)
        _cleanupInstances();
        _renderActiveTab(_editing || {});
      });
    });
  }

  function _renderActiveTab(e) {
    const wrap = document.getElementById('pr-tab-content');
    if (!wrap) return;
    switch (_activeTab) {
      // ── 탭 1: 기본정보 ─────────────────────────────────────
      // Phase 8-C 신규 워크플로우:
      //   ① 상단: RFP 등록 (파일 + 메타 + AI 분석 버튼)
      //   ② 중단: 제안 기본정보 (AI 자동채움 가능)
      //   ③ 하단: AI 제안전략 요약 (6섹션, 비고 자리 통합)
      case 'basic':
        wrap.innerHTML =
          (e && e.id
            ? `<div class="pr-tab-divider">📑 RFP 등록 & AI 분석</div>` +
              _renderRfpTab(e) +
              `<div class="pr-tab-divider">📋 제안 기본정보</div>`
            : '') +
          _renderBasicTab(e) +
          (e && e.id
            ? `<div class="pr-tab-divider">🤖 AI 제안전략 요약 (6섹션)</div>` +
              _renderAiStrategySection(e)
            : '');
        _attachLeadCombobox();
        _attachQuoteCombobox(e.quote_id);
        if (e && e.id) {
          _bindFileEvents(e, 'rfp');
          _bindAiTabEvents(e); // RFP 섹션의 AI 분석 버튼 + AI 요약 섹션의 복사
        }
        break;
      // ── 탭 2: 자료 & 견적 (Phase 8-D: 3섹션 명확 분리) ──
      //   ① 📦 제안 자료 (파일 업로드 + 목록)
      //   ② 📊 AI 평가 (수주확률 + 정성 메트릭 + 승리/리스크 요인)
      //   ③ 💰 연결 견적 (조회 전용)
      case 'content':
        wrap.innerHTML =
          _renderFilesTab(e) +
          `<div class="pr-tab-divider">📊 AI 평가 (수주확률 + 정성 메트릭)</div>` +
          _renderEvalSection() +
          `<div class="pr-tab-divider">💰 연결 견적</div>` +
          _renderQuoteTab(e);
        _bindFileEvents(e, 'files');
        break;
      // ── 탭 3: 발송 & 이력 ────────────────────────────────
      // 이메일/공유 + 리비전/히스토리 통합
      case 'send':
        wrap.innerHTML =
          _renderEmailTab(e) +
          `<div class="pr-tab-divider">🕒 리비전 & 이력</div>` +
          _renderHistoryTab(e);
        _bindEmailTabEvents(e);
        _bindHistoryEvents(e);
        break;
      default:
        wrap.innerHTML = '';
    }
  }

  // ── 탭 1: 기본정보 (Phase 1 폼 재사용) ───────────────────
  // Phase 8-C: 비고 필드는 AI 제안전략 요약 섹션으로 통합 (별도 textarea)
  function _renderBasicTab(e) {
    return `
      <div class="form-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
        <div class="form-row">
          <label class="form-label">제안번호</label>
          <input class="form-input" id="pr-f-proposal_no" value="${esc(e.proposal_no || '')}"
            ${e.id ? 'readonly style="background:#f5f5f7;color:#666"' : 'placeholder="(저장 시 자동 생성)"'}>
        </div>
        <div class="form-row">
          <label class="form-label required">제안일</label>
          <input class="form-input" id="pr-f-proposal_date" type="date" value="${_toInputDate(e.proposal_date)}">
        </div>
        <div class="form-row">
          <label class="form-label">제출기한</label>
          <input class="form-input" id="pr-f-due_date" type="date" value="${e.due_date ? _toInputDate(e.due_date) : ''}">
        </div>

        <div class="form-row" style="grid-column:1 / span 2">
          <label class="form-label">💼 영업리드 연결 (선택)</label>
          <input class="form-input" id="pr-f-lead-input"
            value="${esc(_leadInitialText(e.lead_id))}"
            placeholder="🔍 고객사 또는 프로젝트명 1글자 이상 입력 → 자동완성">
          <input type="hidden" id="pr-f-lead_id" value="${e.lead_id || ''}">
          <input type="hidden" id="pr-f-customer_id" value="${e.customer_id || ''}">
        </div>
        <div class="form-row">
          <label class="form-label">담당자</label>
          <select class="form-input" id="pr-f-owner_id">${_teamOptions(e.owner_id)}</select>
        </div>

        <div class="form-row" style="grid-column:1 / span 2">
          <label class="form-label">📄 연결 견적 (선택)</label>
          <input class="form-input" id="pr-f-quote-input"
            value="${esc(_quoteInitialText(e.quote_id))}"
            placeholder="🔍 견적번호 또는 견적명 1글자 이상 입력 → 자동완성">
          <input type="hidden" id="pr-f-quote_id" value="${e.quote_id || ''}">
        </div>
        <div class="form-row">
          <label class="form-label">상태</label>
          <select class="form-input" id="pr-f-status">
            ${Object.entries(STATUS_LABEL)
              .map(
                ([k, v]) =>
                  `<option value="${k}" ${e.status === k ? 'selected' : ''}>${v}</option>`
              )
              .join('')}
          </select>
        </div>

        <div class="form-row" style="grid-column:1 / span 2">
          <label class="form-label required">제안명</label>
          <input class="form-input" id="pr-f-proposal_title" value="${esc(e.proposal_title || '')}" placeholder="제안서 제목 입력 (AI 분석 시 자동 채움)">
        </div>
        <div class="form-row">
          <label class="form-label required">고객사명</label>
          <input class="form-input" id="pr-f-customer_name" value="${esc(e.customer_name || '')}" placeholder="고객사 명">
        </div>

        <div class="form-row" style="grid-column:1 / span 2">
          <label class="form-label">예상금액 <span style="font-size:11px;color:var(--text-3);font-weight:normal">(AI 분석 시 자동 채움)</span></label>
          <div style="display:flex;gap:4px">
            <input class="form-input" id="pr-f-expected_amount" type="number" step="0.01" min="0" value="${e.expected_amount || ''}" placeholder="견적 연결 / AI 분석 시 자동 반영" style="flex:1">
            <select class="form-input" id="pr-f-currency" style="width:90px;flex-shrink:0">
              ${['KRW', 'USD', 'EUR', 'JPY', 'CNY']
                .map(c => `<option value="${c}" ${e.currency === c ? 'selected' : ''}>${c}</option>`)
                .join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <label class="form-label">버전</label>
          <input class="form-input" id="pr-f-version_no" value="v${e.version_no || 1}" readonly style="background:#f5f5f7;color:#666">
        </div>
      </div>

      <!-- Phase 8-C: 비고 필드는 하단 AI 제안전략 요약 섹션으로 이동 (편집 모드 한정) -->
      ${
        !e || !e.id
          ? `<div class="form-row" style="margin-top:14px">
              <label class="form-label">📝 비고</label>
              <textarea class="form-input" id="pr-f-remark" rows="3" placeholder="제안 관련 메모 (선택) — 저장 후 RFP 업로드 + AI 분석으로 전환됩니다" style="resize:vertical;font-family:inherit;line-height:1.5">${esc(e.remark || '')}</textarea>
            </div>`
          : `<input type="hidden" id="pr-f-remark" value="${esc(e.remark || '')}">`
      }
    `;
  }

  // ── RFP 섹션 (Phase 8-C: 기본정보 탭 상단으로 이동) ───────
  // 흐름: 메타 입력 → 파일 업로드 → [🤖 AI 분석] → 기본정보 + AI 제안전략 요약 자동 채움
  function _renderRfpTab(e) {
    const rfpFiles = (e.files || []).filter(f => f.file_type === 'rfp');
    const analyzableFiles = rfpFiles.filter(f => _isAnalyzable(f.original_filename));
    const canAnalyze = analyzableFiles.length > 0;
    const hasRfpButUnanalyzable = rfpFiles.length > 0 && analyzableFiles.length === 0;
    return `
      <div style="margin-bottom:16px;padding:10px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:12px;color:#92400e">
        📑 <strong>1단계 — RFP 등록 & AI 분석</strong> — RFP 파일을 업로드한 뒤 [🤖 AI 분석] 버튼을 누르면, 제안 기본정보 + AI 제안전략 요약(6섹션)이 자동으로 채워집니다.
      </div>
      <div class="form-grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:14px">
        <div class="form-row" style="grid-column:1 / span 2">
          <label class="form-label">RFP 제목</label>
          <input class="form-input" id="pr-f-rfp_title" value="${esc(e.rfp_title || '')}" placeholder="고객사 RFP 문서 제목 (AI 분석 시 자동 채움)">
        </div>
        <div class="form-row">
          <label class="form-label">RFP 접수일</label>
          <input class="form-input" id="pr-f-rfp_received_date" type="date" value="${e.rfp_received_date ? _toInputDate(e.rfp_received_date) : ''}">
        </div>
        <div class="form-row">
          <label class="form-label">RFP 제출마감일</label>
          <input class="form-input" id="pr-f-rfp_due_date" type="date" value="${e.rfp_due_date ? _toInputDate(e.rfp_due_date) : ''}">
        </div>
      </div>
      <div class="form-row" style="margin-bottom:18px">
        <label class="form-label">📝 RFP 요약 (AI 분석 보조 입력)</label>
        <textarea class="form-input" id="pr-f-rfp_summary" rows="5" placeholder="RFP 핵심 요구사항·평가기준·예산·납기 등을 요약 입력 (AI 분석 결과로 자동 채움 가능)" style="resize:vertical;font-family:inherit;line-height:1.6">${esc(e.rfp_summary || '')}</textarea>
      </div>

      <!-- RFP 파일 업로드 — Phase 4-C 드롭존 (다중 + drag/drop) -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <strong style="font-size:13px">📎 RFP 파일 (${rfpFiles.length}건)</strong>
        <span style="font-size:11px;color:var(--text-3)">여러 파일 동시 등록 · drag &amp; drop · AI 분석 가능 형식: PDF / 이미지 / 텍스트</span>
      </div>
      <div id="pr-rfp-dropzone" class="pr-dropzone" data-source="rfp" tabindex="0" role="button" aria-label="RFP 파일 추가">
        <div class="pr-dropzone-icon">📥</div>
        <div class="pr-dropzone-title">파일 추가</div>
        <div class="pr-dropzone-hint">이 영역을 클릭하거나 파일을 끌어다 놓으세요<br>(pdf · ppt · doc · xls · hwp · 이미지 — 최대 100MB / 파일)</div>
        <input type="file" id="pr-rfp-upload-input" multiple style="display:none" accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.hwp,.hwpx,.png,.jpg,.jpeg">
      </div>
      <div style="margin-top:14px">
        ${_renderFileList(rfpFiles, e.id, 'rfp')}
      </div>

      <!-- Phase 8-C: 통합 AI 분석 트리거 (RFP → 기본정보 + AI 요약 자동 채움) -->
      <div style="margin-top:14px;padding:12px 14px;background:#f3e8ff;border:1px solid #d8b4fe;border-radius:8px;display:flex;align-items:center;justify-content:space-between;gap:12px">
        <div style="flex:1;font-size:12px;color:#6b21a8">
          🤖 <strong>RFP 자동 분석</strong> —
          ${
            canAnalyze
              ? `${analyzableFiles.length}건의 분석 가능 파일 중 <strong>첫 번째 파일</strong>을 Gemini 2.5 Pro 로 분석합니다.`
              : hasRfpButUnanalyzable
                ? '⚠️ 등록된 RFP 파일이 분석 불가 형식입니다. PDF / 이미지(PNG·JPG·WEBP) / 텍스트 만 지원.'
                : '⚠️ 분석 가능한 RFP 파일을 먼저 업로드하세요.'
          }
        </div>
        <button class="btn btn-primary" id="pr-ai-analyze-btn" type="button"
          ${canAnalyze ? '' : 'disabled style="opacity:0.5;cursor:not-allowed"'}>
          🤖 AI 분석 ${e.ai_strategy_md ? '(다시 생성)' : ''}
        </button>
      </div>
    `;
  }

  // ── Phase 4-D: 간단 Markdown → HTML 렌더링 ────────────────
  // 외부 라이브러리 없이 ## h2, ### h3, **bold**, *italic*, - 리스트, 1. 번호리스트 지원.
  // 보안: esc() 로 먼저 escape 후 mark-up 만 복원. (XSS 안전)
  function _renderMarkdown(md) {
    if (!md) return '';
    // 1) HTML escape
    let html = esc(md);
    // 2) Headings (## , ### )
    html = html.replace(/^###\s+(.+)$/gm, '<h3 class="md-h3">$1</h3>');
    html = html.replace(/^##\s+(.+)$/gm, '<h2 class="md-h2">$1</h2>');
    html = html.replace(/^#\s+(.+)$/gm, '<h2 class="md-h2">$1</h2>');
    // 3) bold / italic
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
    // 4) 줄 단위 처리 — 리스트 그루핑
    const lines = html.split(/\n/);
    const out = [];
    let inUl = false;
    let inOl = false;
    const closeLists = () => {
      if (inUl) {
        out.push('</ul>');
        inUl = false;
      }
      if (inOl) {
        out.push('</ol>');
        inOl = false;
      }
    };
    for (const line of lines) {
      const ulMatch = line.match(/^[-*]\s+(.+)$/);
      const olMatch = line.match(/^\d+\.\s+(.+)$/);
      if (ulMatch) {
        if (inOl) {
          out.push('</ol>');
          inOl = false;
        }
        if (!inUl) {
          out.push('<ul class="md-ul">');
          inUl = true;
        }
        out.push(`<li>${ulMatch[1]}</li>`);
      } else if (olMatch) {
        if (inUl) {
          out.push('</ul>');
          inUl = false;
        }
        if (!inOl) {
          out.push('<ol class="md-ol">');
          inOl = true;
        }
        out.push(`<li>${olMatch[1]}</li>`);
      } else if (/^\s*$/.test(line)) {
        closeLists();
        out.push('');
      } else if (/^<h[123]/.test(line)) {
        closeLists();
        out.push(line);
      } else {
        closeLists();
        out.push(`<p class="md-p">${line}</p>`);
      }
    }
    closeLists();
    return out.join('\n');
  }

  // Gemini Multimodal 직접 지원 파일 (PDF / 이미지 / 텍스트)
  // PPT/DOC/HWP 등 Office 문서는 PDF 로 변환 필요
  const AI_ANALYZABLE_RE = /\.(pdf|png|jpe?g|webp|txt)$/i;
  function _isAnalyzable(filename) {
    return AI_ANALYZABLE_RE.test(String(filename || ''));
  }

  // ── AI 제안전략 요약 섹션 (Phase 8-C: 비고 자리에 통합) ───
  // 편집 가능한 textarea (markdown) + 미리보기 토글 + 복사 버튼
  // 6섹션 가이드: 제안목표 / 주요 일정 / 핵심사항 / 준비사항(체크리스트) / 예상 리스크 / 독소조항 회피방안
  function _renderAiStrategySection(e) {
    const hasResult = e.ai_strategy_md && e.ai_strategy_md.trim();
    const placeholder = [
      '## 제안 목표',
      '- (RFP 업로드 후 [🤖 AI 분석] 버튼을 누르면 자동 채움)',
      '',
      '## 제안 주요 일정',
      '- ',
      '',
      '## 제안 핵심사항',
      '- ',
      '',
      '## 제안 준비사항 (체크리스트)',
      '- [ ] ',
      '',
      '## 예상 리스크',
      '- ',
      '',
      '## 독소조항 회피방안',
      '- ',
    ].join('\n');
    return `
      <div style="margin-bottom:10px;padding:10px 14px;background:#f3e8ff;border:1px solid #d8b4fe;border-radius:6px;font-size:12px;color:#6b21a8;display:flex;align-items:center;justify-content:space-between;gap:8px">
        <div>
          🧠 <strong>2단계 — AI 제안전략 요약</strong> — Markdown 으로 6섹션 작성. 직접 편집 가능. 상단 [🤖 AI 분석] 으로 자동 생성.
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" id="pr-ai-preview-btn" type="button" title="미리보기 토글">👁️ 미리보기</button>
          ${hasResult ? '<button class="btn btn-ghost btn-sm" id="pr-ai-copy-btn" type="button" title="markdown 복사">📋 복사</button>' : ''}
        </div>
      </div>
      <div class="form-row" style="margin-bottom:6px">
        <textarea class="form-input" id="pr-f-ai_strategy_md" rows="14" placeholder="${esc(placeholder)}" style="resize:vertical;font-family:'Consolas','Monaco',monospace;font-size:12px;line-height:1.6">${esc(e.ai_strategy_md || '')}</textarea>
      </div>
      <div style="font-size:11px;color:var(--text-3);text-align:right">
        ${e.ai_strategy_generated_at ? '최근 AI 분석: ' + _fmtDateTime(e.ai_strategy_generated_at) : '아직 AI 분석 결과 없음 — 수동 입력 가능'}
      </div>
      <!-- 미리보기 영역 (토글 시 표시) -->
      <div id="pr-ai-md-render" class="pr-ai-md" style="display:none;margin-top:12px;padding:14px 16px;background:#fafafa;border:1px solid var(--border);border-radius:6px"></div>
    `;
  }

  // ── 탭 4: 제안자료 (Phase 3 활성) ────────────────────────
  function _renderFilesTab(e) {
    const files = (e.files || []).filter(f => f.file_type !== 'rfp');
    return `
      <div style="margin-bottom:16px;padding:10px 14px;background:#dbeafe;border:1px solid #93c5fd;border-radius:6px;font-size:12px;color:#1e40af">
        📦 <strong>제안 자료 아카이브</strong> — 제안서 / 회사소개서 / 레퍼런스 / 견적 / 응답서 등 PPT/Word/PDF/HWP 파일을 관리합니다.
      </div>

      <!-- 메타 입력 (모든 파일에 공통 적용) -->
      <div style="background:#fafafa;border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:14px">
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:10px">
          <div class="form-row">
            <label class="form-label" style="font-size:11px">파일 유형</label>
            <select class="form-input" id="pr-file-type" style="font-size:12px">
              <option value="proposal">제안서</option>
              <option value="company_profile">회사소개서</option>
              <option value="reference">레퍼런스</option>
              <option value="quote">견적</option>
              <option value="response_form">응답서</option>
              <option value="etc">기타</option>
            </select>
          </div>
          <div class="form-row">
            <label class="form-label" style="font-size:11px">리비전 번호</label>
            <input class="form-input" id="pr-file-rev" type="number" min="1" value="${e.version_no || 1}" style="font-size:12px">
          </div>
          <div class="form-row">
            <label class="form-label" style="font-size:11px">&nbsp;</label>
            <label style="display:flex;align-items:center;gap:4px;padding:6px;font-size:12px">
              <input type="checkbox" id="pr-file-final"> ✅ 최종본
            </label>
          </div>
          <div class="form-row">
            <label class="form-label" style="font-size:11px">&nbsp;</label>
            <label style="display:flex;align-items:center;gap:4px;padding:6px;font-size:12px">
              <input type="checkbox" id="pr-file-email"> 📧 이메일 첨부
            </label>
          </div>
        </div>
        <input class="form-input" id="pr-file-desc" placeholder="설명 (선택)" style="font-size:12px">
      </div>

      <!-- Phase 4-C 드롭존 (다중 + drag/drop) -->
      <div id="pr-files-dropzone" class="pr-dropzone" data-source="files" tabindex="0" role="button" aria-label="제안 자료 추가">
        <div class="pr-dropzone-icon">📥</div>
        <div class="pr-dropzone-title">파일 추가</div>
        <div class="pr-dropzone-hint">이 영역을 클릭하거나 파일을 끌어다 놓으세요<br>(pdf · ppt · doc · xls · hwp · 이미지 — 최대 100MB / 파일)</div>
        <input type="file" id="pr-file-upload-input" multiple style="display:none" accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.hwp,.hwpx,.png,.jpg,.jpeg">
      </div>

      <div style="font-size:12px;color:var(--text-3);margin:14px 0 8px">📂 등록된 파일 (${files.length}건)</div>
      ${_renderFileList(files, e.id, 'files')}
    `;
  }

  // Phase 8-D: AI 평가 섹션 — 자료 행에서 [📊] 클릭 시 채워짐
  // 빈 상태에서도 안내 표시 (수주확률/메트릭 등 신규 기능 노출)
  function _renderEvalSection() {
    return `
      <div style="margin-bottom:10px;padding:10px 14px;background:#ecfeff;border:1px solid #67e8f9;border-radius:6px;font-size:12px;color:#155e75">
        📊 <strong>AI 평가</strong> — 위 자료의 [📊] 버튼을 누르면 RFP 와 자동 비교하여 <strong>수주확률 + 정성 메트릭 + 승리/리스크 요인</strong>을 생성합니다. (Gemini Pro 호출 — 약 10-30초)
      </div>
      <div id="pr-eval-result"></div>
    `;
  }

  // Phase 6-C + 8-D: AI 평가 결과 카드 렌더링
  //   - 수주확률 + 정성 메트릭 (Phase 8-D 신규)
  //   - 커버율 / 충족 / 누락 / 개선 / 승리요인 / 리스크요인
  function _renderEvalResult(data) {
    if (!data) return '';
    const score = Math.max(0, Math.min(100, parseInt(data.coverage_score, 10) || 0));
    const scoreColor = score >= 80 ? '#16a34a' : score >= 60 ? '#ca8a04' : '#dc2626';
    const sevLabel = { high: '높음', medium: '중간', low: '낮음' };
    const sevColor = { high: '#dc2626', medium: '#ca8a04', low: '#6b7280' };

    const covered = Array.isArray(data.covered_items) ? data.covered_items : [];
    const missing = Array.isArray(data.missing_items) ? data.missing_items : [];
    const improve = Array.isArray(data.improvement_suggestions) ? data.improvement_suggestions : [];

    // Phase 8-D: 수주확률 + 정성 메트릭 + 승리/리스크 요인
    const winProb = Math.max(0, Math.min(100, parseInt(data.win_probability, 10) || 0));
    const winColor = winProb >= 70 ? '#16a34a' : winProb >= 40 ? '#ca8a04' : '#dc2626';
    const winLabel = winProb >= 70 ? '높음' : winProb >= 40 ? '보통' : '낮음';
    const qm = data.quality_metrics || {};
    const metrics = [
      { key: 'clarity', label: '명확성', value: parseInt(qm.clarity, 10) || 0 },
      { key: 'completeness', label: '완결성', value: parseInt(qm.completeness, 10) || 0 },
      { key: 'differentiation', label: '차별성', value: parseInt(qm.differentiation, 10) || 0 },
      { key: 'feasibility', label: '실현가능성', value: parseInt(qm.feasibility, 10) || 0 },
      { key: 'price_competitiveness', label: '가격경쟁력', value: parseInt(qm.price_competitiveness, 10) || 0 },
    ];
    const winFactors = Array.isArray(data.win_factors) ? data.win_factors.filter(Boolean) : [];
    const riskFactors = Array.isArray(data.risk_factors) ? data.risk_factors.filter(Boolean) : [];

    return `<div class="pr-eval-card" id="pr-eval-card">
      <div class="pr-eval-header">
        <div>
          <div class="pr-eval-title">📊 AI 평가 결과</div>
          <div class="pr-eval-subtitle">
            ${esc(data.target_filename || '')} <span style="opacity:0.6">vs</span> ${esc(data.rfp_filename || '')}
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" id="pr-eval-close-btn" type="button" title="닫기">✕</button>
      </div>

      <!-- Phase 8-D: 수주확률 카드 (대형) + 정성 메트릭 (5바) -->
      <div class="pr-eval-winprob-row">
        <div class="pr-eval-winprob-card" style="border-color:${winColor}">
          <div class="pr-eval-winprob-label">🎯 예상 수주확률</div>
          <div class="pr-eval-winprob-num" style="color:${winColor}">${winProb}<span class="pr-eval-winprob-unit">%</span></div>
          <div class="pr-eval-winprob-badge" style="background:${winColor}">${winLabel}</div>
        </div>
        <div class="pr-eval-metrics-card">
          <div class="pr-eval-metrics-label">📈 정성 메트릭 (10점 만점)</div>
          ${metrics
            .map(m => {
              const pct = (m.value / 10) * 100;
              const col = m.value >= 7 ? '#16a34a' : m.value >= 4 ? '#ca8a04' : '#dc2626';
              return `<div class="pr-eval-metric-row">
                <div class="pr-eval-metric-name">${esc(m.label)}</div>
                <div class="pr-eval-metric-bar">
                  <div class="pr-eval-metric-fill" style="width:${pct}%;background:${col}"></div>
                </div>
                <div class="pr-eval-metric-val" style="color:${col}">${m.value}</div>
              </div>`;
            })
            .join('')}
        </div>
      </div>

      <!-- Phase 8-D: 승리 요인 + 리스크 요인 (좌우 2-칼럼) -->
      ${
        winFactors.length > 0 || riskFactors.length > 0
          ? `<div class="pr-eval-factors-row">
              ${
                winFactors.length > 0
                  ? `<div class="pr-eval-factor-card pr-eval-factor-win">
                      <div class="pr-eval-factor-title">✅ 승리 요인 (${winFactors.length}건)</div>
                      <ul class="pr-eval-factor-list">
                        ${winFactors.map(f => `<li>${esc(f)}</li>`).join('')}
                      </ul>
                    </div>`
                  : ''
              }
              ${
                riskFactors.length > 0
                  ? `<div class="pr-eval-factor-card pr-eval-factor-risk">
                      <div class="pr-eval-factor-title">⚠️ 리스크 요인 (${riskFactors.length}건)</div>
                      <ul class="pr-eval-factor-list">
                        ${riskFactors.map(f => `<li>${esc(f)}</li>`).join('')}
                      </ul>
                    </div>`
                  : ''
              }
            </div>`
          : ''
      }

      <!-- 커버율 진행바 (기존) -->
      <div class="pr-eval-score">
        <div class="pr-eval-score-label">RFP 커버율</div>
        <div class="pr-eval-score-bar">
          <div class="pr-eval-score-fill" style="width:${score}%;background:${scoreColor}"></div>
        </div>
        <div class="pr-eval-score-num" style="color:${scoreColor}">${score}%</div>
        <div class="pr-eval-score-meta">
          <span>충족 ${data.covered_count || covered.length}건</span>
          <span style="color:#dc2626">누락 ${data.missing_count || missing.length}건</span>
        </div>
      </div>

      <!-- 충족 요구사항 -->
      ${
        covered.length > 0
          ? `<div class="pr-eval-section">
              <div class="pr-eval-section-title">✅ 충족 요구사항 (${covered.length}건)</div>
              <ul class="pr-eval-list pr-eval-covered">
                ${covered
                  .map(
                    c => `<li>
                  <strong>${esc(c.requirement)}</strong>
                  <span class="pr-eval-evidence">→ ${esc(c.evidence)}</span>
                </li>`
                  )
                  .join('')}
              </ul>
            </div>`
          : ''
      }

      <!-- 누락/부족 항목 -->
      ${
        missing.length > 0
          ? `<div class="pr-eval-section">
              <div class="pr-eval-section-title" style="color:#dc2626">⚠️ 누락 / 부족 항목 (${missing.length}건)</div>
              <ul class="pr-eval-list pr-eval-missing">
                ${missing
                  .map(
                    m => `<li>
                  <span class="pr-eval-sev" style="background:${sevColor[m.severity] || '#6b7280'}">${esc(sevLabel[m.severity] || m.severity)}</span>
                  <strong>${esc(m.requirement)}</strong>
                  <div class="pr-eval-suggestion">💡 ${esc(m.suggestion)}</div>
                </li>`
                  )
                  .join('')}
              </ul>
            </div>`
          : ''
      }

      <!-- 개선 제안 -->
      ${
        improve.length > 0
          ? `<div class="pr-eval-section">
              <div class="pr-eval-section-title">💡 개선 제안 (${improve.length}건)</div>
              <ul class="pr-eval-list">
                ${improve
                  .map(
                    s => `<li>
                  <strong>${esc(s.section)}</strong>: ${esc(s.suggestion)}
                </li>`
                  )
                  .join('')}
              </ul>
            </div>`
          : ''
      }

      <!-- 종합 평가 (마크다운) -->
      ${
        data.overall_assessment
          ? `<div class="pr-eval-section">
              <div class="pr-eval-section-title">📝 종합 평가</div>
              <div class="pr-eval-md">${_renderMarkdown(data.overall_assessment)}</div>
            </div>`
          : ''
      }

      <div class="pr-eval-footer">
        ${data.generated_at ? `생성: ${_fmtDateTime(data.generated_at)}` : ''}
      </div>
    </div>`;
  }

  // 파일 목록 + 다운로드/삭제 버튼 (공통)
  function _renderFileList(files, proposalId, source) {
    if (!files.length) {
      return `<div style="padding:18px;text-align:center;color:var(--text-3);background:#fafafa;border-radius:6px;border:1px dashed var(--border);font-size:12px">등록된 파일 없음 — 위 영역에서 파일을 추가하세요</div>`;
    }
    return `<table class="data-table" style="font-size:12px">
      <thead><tr>
        <th style="width:90px">유형</th>
        <th>파일명</th>
        <th style="width:60px">Rev</th>
        <th style="width:80px;text-align:center">최종본</th>
        <th style="width:80px;text-align:center">📧 첨부</th>
        <th style="width:110px">크기</th>
        <th style="width:130px">등록일</th>
        <th style="width:${source === 'rfp' || source === 'files' ? '180' : '140'}px;text-align:center">작업</th>
      </tr></thead>
      <tbody>
        ${files
          .map(
            f => `<tr>
          <td><span class="badge badge-gray">${esc(f.file_type)}</span></td>
          <td>${esc(f.original_filename)}${f.description ? `<div style="font-size:10px;color:var(--text-3)">${esc(f.description)}</div>` : ''}</td>
          <td>v${f.revision_no || 1}</td>
          <td style="text-align:center">${f.is_final ? '✅' : '-'}</td>
          <td style="text-align:center">${f.include_in_email ? '📧' : '-'}</td>
          <td>${f.file_size ? (f.file_size / 1024).toFixed(1) + ' KB' : '-'}</td>
          <td>${_fmtDateTime(f.created_at)}</td>
          <td style="text-align:center;white-space:nowrap">
            ${
              source === 'rfp'
                ? _isAnalyzable(f.original_filename)
                  ? `<button class="btn btn-ghost btn-sm pr-file-ai" data-id="${f.id}" type="button" title="이 파일로 AI 분석 (Gemini)" style="color:#7c3aed">🤖</button>`
                  : `<span title="PDF / 이미지 / 텍스트만 분석 가능" style="font-size:11px;color:var(--text-3);padding:0 4px">—</span>`
                : ''
            }
            ${
              source === 'files'
                ? _isAnalyzable(f.original_filename)
                  ? `<button class="btn btn-ghost btn-sm pr-file-evaluate" data-id="${f.id}" type="button" title="RFP 대비 평가 (AI 코칭)" style="color:#0891b2">📊</button>`
                  : `<span title="PDF / 이미지 / 텍스트만 평가 가능" style="font-size:11px;color:var(--text-3);padding:0 4px">—</span>`
                : ''
            }
            <a class="btn btn-ghost btn-sm" href="${API.proposals.downloadFileUrl(proposalId, f.id)}" data-pr-file-download="${f.id}" title="다운로드">⬇️</a>
            <button class="btn btn-ghost btn-sm pr-file-del" data-id="${f.id}" data-source="${source}" type="button" style="color:#d93025" title="삭제">🗑️</button>
          </td>
        </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
  }

  // ── 탭 5: 견적 (백엔드 데이터 표시 — Phase 2 활성) ─────────
  function _renderQuoteTab(e) {
    const q = e.quote;
    if (!q) {
      return `
        <div style="padding:60px 20px;text-align:center;color:var(--text-3);background:#fafafa;border:1px dashed var(--border);border-radius:6px">
          <div style="font-size:48px;margin-bottom:12px">📄</div>
          <div style="font-size:14px;margin-bottom:6px">연결된 견적이 없습니다</div>
          <div style="font-size:12px">기본정보 탭의 "연결 견적" 필드에서 견적을 선택하세요</div>
        </div>
      `;
    }
    return `
      <div style="margin-bottom:16px;padding:10px 14px;background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;font-size:12px;color:#92400e">
        💰 <strong>연결된 견적 정보</strong> — 견적 내용 수정은 견적 모듈에서 처리하세요. 여기서는 조회만 가능합니다.
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr>
          <td style="background:#f9fafb;padding:10px 14px;border:1px solid var(--border);font-weight:600;width:120px">견적번호</td>
          <td style="padding:10px 14px;border:1px solid var(--border);font-family:monospace">${esc(q.quote_no || '-')}</td>
          <td style="background:#f9fafb;padding:10px 14px;border:1px solid var(--border);font-weight:600;width:120px">견적명</td>
          <td style="padding:10px 14px;border:1px solid var(--border)">${esc(q.name || '-')}</td>
        </tr>
        <tr>
          <td style="background:#f9fafb;padding:10px 14px;border:1px solid var(--border);font-weight:600">단가구분</td>
          <td style="padding:10px 14px;border:1px solid var(--border)">${q.vat_included ? '부가세 포함 (10% 가산)' : '부가세 미포함'}</td>
          <td style="background:#f9fafb;padding:10px 14px;border:1px solid var(--border);font-weight:600">상태</td>
          <td style="padding:10px 14px;border:1px solid var(--border)">${esc(q.status || '-')}</td>
        </tr>
        <tr>
          <td style="background:#f9fafb;padding:10px 14px;border:1px solid var(--border);font-weight:600">소계</td>
          <td style="padding:10px 14px;border:1px solid var(--border);text-align:right;font-family:monospace">${esc(Fmt.amount(q.subtotal, 'KRW'))}</td>
          <td style="background:#f9fafb;padding:10px 14px;border:1px solid var(--border);font-weight:600">부가세</td>
          <td style="padding:10px 14px;border:1px solid var(--border);text-align:right;font-family:monospace">${esc(Fmt.amount(q.vat_amount, 'KRW'))}</td>
        </tr>
        <tr>
          <td style="background:#fff5f5;padding:14px;border:1px solid var(--border);font-weight:700;color:var(--oci-red)" colspan="3">총합계</td>
          <td style="padding:14px;border:1px solid var(--border);text-align:right;font-weight:700;font-size:16px;color:var(--oci-red);background:#fff5f5">${esc(Fmt.amount(q.total_amount, 'KRW'))}</td>
        </tr>
      </table>

      <div style="margin-top:16px;display:flex;gap:8px">
        <button class="btn btn-ghost" id="pr-quote-goto" type="button">📄 견적 모듈로 이동</button>
        <button class="btn btn-ghost" disabled style="opacity:0.5;cursor:not-allowed">📥 견적 PDF 다운로드 (Phase 5)</button>
      </div>
      <script>
        // 인라인 — onclick 등록 (CSP 정책상 main bind 에서 처리해야 함)
      </script>
    `;
  }

  // 기본 이메일 본문 템플릿 생성 (제안 정보 기반)
  function _defaultEmailBody(e) {
    const customer = e.customer_name || '담당자';
    const title = e.proposal_title || '제안서';
    const no = e.proposal_no || '';
    return [
      `${customer} 담당자님,`,
      ``,
      `안녕하세요. 요청하신 제안 자료를 송부드립니다.`,
      ``,
      `■ 제안명: ${title}`,
      no ? `■ 제안번호: ${no}` : null,
      ``,
      `첨부 파일을 확인해 주시고, 추가 문의사항이 있으시면 회신 부탁드립니다.`,
      ``,
      `감사합니다.`,
    ]
      .filter(x => x !== null)
      .join('\n');
  }

  // 공유 링크 URL 생성 (현재 origin 기반)
  function _buildShareUrl(token) {
    if (!token) return '';
    const origin = window.location.origin;
    return `${origin}/proposal-share.html?t=${encodeURIComponent(token)}`;
  }

  // ── 탭 6: 이메일/공유 (Phase 5-D 활성) ────────────────────
  function _renderEmailTab(e) {
    const logs = Array.isArray(e.email_logs) ? e.email_logs : [];
    const files = Array.isArray(e.files) ? e.files : [];
    // 기본 첨부 — include_in_email = 1 인 파일들
    // (없으면 사용자가 직접 체크)
    const defaultAttach = new Set(files.filter(f => f.is_final || f.include_in_email).map(f => f.id));

    const hasShare = !!e.share_token;
    const shareUrl = hasShare ? _buildShareUrl(e.share_token) : '';

    return `
      <div style="margin-bottom:16px;padding:10px 14px;background:#dcfce7;border:1px solid #86efac;border-radius:6px;font-size:12px;color:#166534">
        📧 <strong>이메일 발송 / 공유 링크</strong> — 제안 파일을 Gmail 로 발송하거나, 외부 접근 가능한 공유 링크를 생성합니다.
      </div>

      <!-- ━━━━━━━━━━ 이메일 발송 폼 ━━━━━━━━━━ -->
      <div class="pr-email-section">
        <div class="pr-email-title">📨 이메일 발송</div>
        <div class="form-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
          <div class="form-row">
            <label class="form-label">받는사람 *</label>
            <input class="form-input" id="pr-email-to" type="email" multiple placeholder="client@company.com (콤마로 여러 명)">
          </div>
          <div class="form-row">
            <label class="form-label">참조 (CC)</label>
            <input class="form-input" id="pr-email-cc" type="text" placeholder="manager@company.com">
          </div>
        </div>
        <div class="form-row" style="margin-bottom:10px">
          <label class="form-label">제목 *</label>
          <input class="form-input" id="pr-email-subject" type="text" value="${esc(`[제안서 송부] ${e.proposal_title || ''}`)}" placeholder="제안서 송부 안내">
        </div>
        <div class="form-row" style="margin-bottom:10px">
          <label class="form-label">본문</label>
          <textarea class="form-input" id="pr-email-body" rows="7" style="resize:vertical;font-family:inherit;line-height:1.6">${esc(_defaultEmailBody(e))}</textarea>
        </div>

        <!-- 첨부 파일 선택 -->
        <div class="form-row" style="margin-bottom:10px">
          <label class="form-label">📎 첨부 파일 (${files.length}건 중 선택)</label>
          ${
            files.length === 0
              ? `<div style="padding:12px;text-align:center;color:var(--text-3);font-size:12px;background:#fafafa;border:1px dashed var(--border);border-radius:6px">첨부 가능한 파일 없음 — 자료 탭에서 먼저 업로드하세요</div>`
              : `<div class="pr-email-attach-list">
                  ${files
                    .map(
                      f => `<label class="pr-email-attach-item">
                    <input type="checkbox" class="pr-email-file" value="${f.id}" ${defaultAttach.has(f.id) ? 'checked' : ''}>
                    <span class="badge badge-gray" style="font-size:10px">${esc(f.file_type)}</span>
                    <span class="pr-email-attach-name">${esc(f.original_filename)}</span>
                    <span class="pr-email-attach-size">${f.file_size ? (f.file_size / 1024).toFixed(1) + ' KB' : '-'}</span>
                  </label>`
                    )
                    .join('')}
                </div>`
          }
        </div>

        <div style="display:flex;justify-content:flex-end;gap:8px">
          <button class="btn btn-primary" id="pr-email-send-btn" type="button">📨 이메일 발송</button>
        </div>
        <div id="pr-email-status" class="pr-email-status"></div>
      </div>

      <!-- ━━━━━━━━━━ 공유 링크 ━━━━━━━━━━ -->
      <div class="pr-share-section">
        <div class="pr-email-title">🔗 외부 공유 링크</div>
        ${
          hasShare
            ? `<div class="pr-share-active">
                <div style="font-size:12px;color:var(--text-2);margin-bottom:4px">
                  ${
                    e.shared_until
                      ? `⏳ 만료: <strong>${_fmtDateTime(e.shared_until)}</strong>`
                      : '♾️ 만료 없음'
                  }
                </div>
                <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">
                  <input class="form-input" id="pr-share-url" type="text" readonly value="${esc(shareUrl)}" style="font-family:monospace;font-size:11px;background:#f9fafb">
                  <button class="btn btn-ghost btn-sm" id="pr-share-copy-btn" type="button" title="링크 복사">📋</button>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <span style="font-size:11px;color:var(--text-3)">⚠️ 외부 노출: 제목/요약/include_in_email 파일만</span>
                  <div style="display:flex;gap:6px">
                    <button class="btn btn-ghost btn-sm" id="pr-share-renew-btn" type="button">🔁 재발급</button>
                    <button class="btn btn-ghost btn-sm" id="pr-share-revoke-btn" type="button" style="color:#d93025">🗑️ 무효화</button>
                  </div>
                </div>
              </div>`
            : `<div class="pr-share-empty">
                <div style="font-size:13px;color:var(--text-2);margin-bottom:8px">아직 공유 링크가 발급되지 않았습니다</div>
                <div style="display:flex;gap:8px;align-items:center;justify-content:center">
                  <label style="font-size:12px;color:var(--text-3)">만료일</label>
                  <select class="form-input" id="pr-share-expires" style="width:120px;font-size:12px">
                    <option value="7" selected>7일</option>
                    <option value="14">14일</option>
                    <option value="30">30일</option>
                    <option value="0">무제한</option>
                  </select>
                  <button class="btn btn-primary btn-sm" id="pr-share-create-btn" type="button">🔗 링크 생성</button>
                </div>
              </div>`
        }
      </div>

      <!-- ━━━━━━━━━━ 발송 이력 ━━━━━━━━━━ -->
      <div style="font-size:12px;color:var(--text-3);margin:14px 0 8px">📬 발송 이력 (${logs.length}건)</div>
      ${
        logs.length === 0
          ? `<div style="padding:18px;text-align:center;color:var(--text-3);background:#fafafa;border-radius:6px;font-size:12px">아직 발송 이력 없음</div>`
          : `<table class="data-table" style="font-size:12px">
              <thead><tr>
                <th style="width:140px">발송 시각</th>
                <th>수신자</th>
                <th>제목</th>
                <th style="width:80px;text-align:center">상태</th>
                <th style="width:110px">발송자</th>
              </tr></thead>
              <tbody>
                ${logs
                  .map(
                    l => `<tr>
                  <td>${_fmtDateTime(l.sent_at)}</td>
                  <td style="font-family:monospace;font-size:11px">${esc(l.to_emails || '')}</td>
                  <td>${esc(l.subject || '')}</td>
                  <td style="text-align:center"><span class="badge badge-${l.send_status === 'sent' ? 'green' : l.send_status === 'failed' ? 'red' : 'gray'}">${esc(l.send_status || 'sent')}</span></td>
                  <td>${esc(l.sent_by_name || '-')}</td>
                </tr>`
                  )
                  .join('')}
              </tbody>
            </table>`
      }
    `;
  }

  // ── 탭 7: 리비전/이력 (Phase 2 활성) ─────────────────────
  function _renderHistoryTab(e) {
    const revs = Array.isArray(e.revisions) ? e.revisions : [];
    const hist = Array.isArray(e.history) ? e.history : [];

    const actionIcon = type =>
      ({
        create: '🆕',
        update: '✏️',
        status_change: '🔄',
        rfp_upload: '📑',
        ai_strategy: '🤖',
        file_upload: '📦',
        file_download: '⬇️',
        file_delete: '🗑️',
        email_send: '📧',
        share_create: '🔗',
        revision_create: '🌿',
        quote_link: '💰',
      })[type] || '•';

    return `
      <div style="display:grid;grid-template-columns:1fr 1.5fr;gap:14px">
        <!-- 리비전 목록 -->
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <strong style="font-size:13px">🌿 리비전 목록 (${revs.length}건)</strong>
            <button class="btn btn-ghost btn-sm" id="pr-rev-new-btn" type="button">+ 새 리비전</button>
          </div>
          ${
            revs.length === 0
              ? `<div style="padding:24px;text-align:center;color:var(--text-3);background:#fafafa;border:1px dashed var(--border);border-radius:6px;font-size:12px">
                  아직 리비전이 없습니다 (v${e.version_no || 1} 만 존재)
                </div>`
              : `<div style="border:1px solid var(--border);border-radius:6px;overflow:hidden">
                  ${revs
                    .map(
                      r => `<div style="padding:10px 14px;border-bottom:1px solid var(--border);background:#fff">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                      <strong style="font-size:13px;color:var(--oci-red)">🌿 v${r.revision_no}</strong>
                      <span style="font-size:11px;color:var(--text-3)">${_fmtDateTime(r.created_at)}</span>
                    </div>
                    ${r.title ? `<div style="font-size:12px;color:var(--text-1);margin-bottom:2px">${esc(r.title)}</div>` : ''}
                    ${r.description ? `<div style="font-size:11px;color:var(--text-3);white-space:pre-wrap">${esc(r.description)}</div>` : ''}
                  </div>`
                    )
                    .join('')}
                </div>`
          }
        </div>

        <!-- 이력 타임라인 -->
        <div>
          <strong style="font-size:13px;display:block;margin-bottom:8px">🕒 변경 이력 (${hist.length}건)</strong>
          ${
            hist.length === 0
              ? `<div style="padding:24px;text-align:center;color:var(--text-3);background:#fafafa;border:1px dashed var(--border);border-radius:6px;font-size:12px">
                  이력이 없습니다
                </div>`
              : `<div style="border:1px solid var(--border);border-radius:6px;max-height:480px;overflow-y:auto">
                  ${hist
                    .map(
                      (h, i) => `<div style="padding:10px 14px;border-bottom:${i < hist.length - 1 ? '1px solid var(--border)' : 'none'};background:#fff;display:flex;gap:10px;align-items:flex-start">
                    <div style="font-size:18px;flex-shrink:0">${actionIcon(h.action_type)}</div>
                    <div style="flex:1;min-width:0">
                      <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:2px">
                        <strong style="font-size:12px;color:var(--text-1)">${esc(h.action_type)}</strong>
                        <span style="font-size:11px;color:var(--text-3);flex-shrink:0">${_fmtDateTime(h.created_at)}</span>
                      </div>
                      ${h.description ? `<div style="font-size:12px;color:var(--text-2);margin-bottom:2px">${esc(h.description)}</div>` : ''}
                      ${
                        h.old_value || h.new_value
                          ? `<div style="font-size:11px;color:var(--text-3);font-family:monospace">${h.old_value ? esc(h.old_value) + ' → ' : ''}${h.new_value ? esc(h.new_value) : ''}</div>`
                          : ''
                      }
                      ${h.created_by_name ? `<div style="font-size:10px;color:var(--text-3);margin-top:2px">by ${esc(h.created_by_name)}</div>` : ''}
                    </div>
                  </div>`
                    )
                    .join('')}
                </div>`
          }
        </div>
      </div>
    `;
  }

  // ── 유틸 (Combobox/Team 옵션) ────────────────────────────
  function _leadInitialText(leadId) {
    if (!leadId) return '';
    const l = _leadsCache.find(x => String(x.id) === String(leadId));
    if (!l) return '';
    return `${l.customer_name || ''}${l.project_name ? ' - ' + l.project_name : ''}`;
  }
  function _quoteInitialText(quoteId) {
    if (!quoteId) return '';
    const q = _quotesCache.find(x => String(x.id) === String(quoteId));
    if (!q) return '';
    return `${q.quote_no || ''} — ${q.name || ''}`;
  }
  function _teamOptions(selectedId) {
    return (
      `<option value="">-- 담당자 선택 --</option>` +
      _teamCache
        .map(
          m =>
            `<option value="${m.id}" ${String(m.id) === String(selectedId) ? 'selected' : ''}>${esc(m.name)}</option>`
        )
        .join('')
    );
  }

  // ── Combobox attach (기본정보 탭) ────────────────────────
  function _attachLeadCombobox() {
    const input = document.getElementById('pr-f-lead-input');
    const hidden = document.getElementById('pr-f-lead_id');
    const custHidden = document.getElementById('pr-f-customer_id');
    if (!input || !hidden || typeof Combobox === 'undefined') return;

    input.addEventListener('input', () => {
      if (!input.value.trim()) {
        hidden.value = '';
        if (custHidden) custHidden.value = '';
      }
    });

    const cb = Combobox.attach({
      inputEl: input,
      fetchFn: q => {
        const ql = (q || '').toLowerCase();
        if (!ql) return _leadsCache.slice(0, 20);
        return _leadsCache
          .filter(
            l =>
              (l.customer_name || '').toLowerCase().includes(ql) ||
              (l.project_name || '').toLowerCase().includes(ql)
          )
          .slice(0, 20);
      },
      renderItem: (item, q, { highlightMatch }) => {
        const title = `${highlightMatch(item.customer_name || '', q)}${item.project_name ? ' - ' + highlightMatch(item.project_name, q) : ''}`;
        const meta = [];
        if (item.stage) meta.push(esc(item.stage));
        if (item.expected_amount)
          meta.push(esc(Fmt.amount(item.expected_amount, item.currency || 'KRW')));
        return `<div class="combobox-item-content">
            <div class="combobox-item-title">💼 ${title}</div>
            ${meta.length ? `<div class="combobox-item-meta">${meta.join(' · ')}</div>` : ''}
          </div>`;
      },
      onSelect: item => {
        input.value = `${item.customer_name || ''}${item.project_name ? ' - ' + item.project_name : ''}`;
        hidden.value = item.id;
        if (custHidden) custHidden.value = item.customer_id || '';
        const titleEl = document.getElementById('pr-f-proposal_title');
        const custEl = document.getElementById('pr-f-customer_name');
        if (titleEl && !titleEl.value.trim()) {
          titleEl.value = item.project_name
            ? `${item.customer_name || ''} ${item.project_name} 제안서`
            : `${item.customer_name || ''} 제안서`;
        }
        if (custEl && !custEl.value.trim() && item.customer_name) {
          custEl.value = item.customer_name;
        }
      },
      minChars: 1,
      debounceMs: 100,
      allowCustom: false,
    });
    _comboboxes.push(cb);
  }

  function _attachQuoteCombobox(_initialId) {
    const input = document.getElementById('pr-f-quote-input');
    const hidden = document.getElementById('pr-f-quote_id');
    if (!input || !hidden || typeof Combobox === 'undefined') return;

    input.addEventListener('input', () => {
      if (!input.value.trim()) hidden.value = '';
    });

    const cb = Combobox.attach({
      inputEl: input,
      fetchFn: q => {
        const ql = (q || '').toLowerCase();
        if (!ql) return _quotesCache.slice(0, 20);
        return _quotesCache
          .filter(
            x =>
              (x.quote_no || '').toLowerCase().includes(ql) ||
              (x.name || '').toLowerCase().includes(ql) ||
              (x.customer_name || '').toLowerCase().includes(ql)
          )
          .slice(0, 20);
      },
      renderItem: (item, q, { highlightMatch }) => {
        const title = `${highlightMatch(item.quote_no || '', q)} — ${highlightMatch(item.name || '', q)}`;
        const meta = [];
        if (item.customer_name) meta.push(esc(item.customer_name));
        if (item.total_amount) meta.push(esc(Fmt.amount(item.total_amount, 'KRW')));
        return `<div class="combobox-item-content">
            <div class="combobox-item-title">📄 ${title}</div>
            ${meta.length ? `<div class="combobox-item-meta">${meta.join(' · ')}</div>` : ''}
          </div>`;
      },
      onSelect: item => {
        input.value = `${item.quote_no || ''} — ${item.name || ''}`;
        hidden.value = item.id;
        const amtEl = document.getElementById('pr-f-expected_amount');
        const custEl = document.getElementById('pr-f-customer_name');
        if (amtEl && !amtEl.value && item.total_amount) {
          amtEl.value = item.total_amount;
        }
        if (custEl && !custEl.value.trim() && item.customer_name) {
          custEl.value = item.customer_name;
        }
      },
      minChars: 1,
      debounceMs: 100,
      allowCustom: false,
    });
    _comboboxes.push(cb);
  }

  // ── 저장 (기본정보 + RFP 메타정보 통합 저장) ──────────────
  async function _save() {
    // 기본정보 탭 필수 필드 (탭 전환 후 DOM 에 없을 수도 있음 → 신규 등록 시는 반드시 기본정보 탭에서 시작)
    // 편집 모드에서 다른 탭 활성 시: 기본정보 필드는 미존재 → _editing 값 fallback
    const get = (id, fallback = '') => {
      const el = document.getElementById(id);
      return el ? el.value : fallback;
    };
    const e = _editing || {};

    const title = (get('pr-f-proposal_title', e.proposal_title || '') || '').trim();
    const customer = (get('pr-f-customer_name', e.customer_name || '') || '').trim();
    // proposal_date — DOM 이 없으면 _editing 의 ISO/DateTime 을 'YYYY-MM-DD' 로 정규화
    const date = get('pr-f-proposal_date', '') || _toInputDate(e.proposal_date);

    if (!title) {
      Toast.error('제안명을 입력하세요 (기본정보 탭)');
      _activeTab = 'basic';
      _renderActiveTab(e);
      return;
    }
    if (!customer) {
      Toast.error('고객사명을 입력하세요 (기본정보 탭)');
      _activeTab = 'basic';
      _renderActiveTab(e);
      return;
    }
    if (!date) {
      Toast.error('제안일을 입력하세요 (기본정보 탭)');
      _activeTab = 'basic';
      _renderActiveTab(e);
      return;
    }

    const leadId = get('pr-f-lead_id', e.lead_id || '');
    const customerId = get('pr-f-customer_id', e.customer_id || '');
    const quoteId = get('pr-f-quote_id', e.quote_id || '');
    // due_date — DOM 없을 때 _editing 의 ISO/DateTime 을 'YYYY-MM-DD' 로 정규화 (빈값 유지)
    const dueDate = get('pr-f-due_date', '') || (e.due_date ? _toInputDate(e.due_date) : '');
    const ownerId = get('pr-f-owner_id', e.owner_id || '');
    const expected = get('pr-f-expected_amount', e.expected_amount || '');
    const currency = get('pr-f-currency', e.currency || 'KRW');
    const status = get('pr-f-status', e.status || 'draft');
    const remark = get('pr-f-remark', e.remark || '');

    const body = {
      proposal_title: title,
      customer_name: customer,
      proposal_date: date,
      due_date: dueDate || null,
      lead_id: leadId ? parseInt(leadId, 10) : null,
      customer_id: customerId ? parseInt(customerId, 10) : null,
      quote_id: quoteId ? parseInt(quoteId, 10) : null,
      owner_id: ownerId ? parseInt(ownerId, 10) : null,
      expected_amount: expected ? Number(expected) : null,
      currency: currency || 'KRW',
      status: status || 'draft',
      remark: remark || null,
    };

    // RFP 메타정보 (탭에서 입력됐으면 함께 저장)
    const rfpTitle = get('pr-f-rfp_title', e.rfp_title || '');
    // RFP 날짜 — DOM 없을 때 _editing 의 ISO/DateTime 을 'YYYY-MM-DD' 로 정규화 (빈값 유지)
    const rfpReceived =
      get('pr-f-rfp_received_date', '') ||
      (e.rfp_received_date ? _toInputDate(e.rfp_received_date) : '');
    const rfpDue =
      get('pr-f-rfp_due_date', '') || (e.rfp_due_date ? _toInputDate(e.rfp_due_date) : '');
    const rfpSummary = get('pr-f-rfp_summary', e.rfp_summary || '');
    // Phase 8-C: AI 제안전략 요약 textarea (편집 가능 — 비고 자리에 통합됨)
    const aiStrategyMd = get('pr-f-ai_strategy_md', e.ai_strategy_md || '');
    // 편집 모드만 RFP/AI 필드 전송 (신규는 기본정보만)
    if (_editing) {
      body.rfp_title = rfpTitle || null;
      body.rfp_received_date = rfpReceived || null;
      body.rfp_due_date = rfpDue || null;
      body.rfp_summary = rfpSummary || null;
      // Phase 8-C: textarea 에서 직접 읽음 (사용자 편집 + AI 결과 모두 반영)
      body.ai_strategy_md = aiStrategyMd || null;
    }

    try {
      if (_editing) {
        await API.proposals.update(_editing.id, body);
        Toast.success('제안 수정됨');
      } else {
        const res = await API.proposals.create(body);
        Toast.success(`제안 생성됨 — ${res.data?.proposal_no || ''}`);
      }
      _cleanupInstances();
      Modal.close();
      await _reload();
    } catch (err) {
      Toast.error('저장 실패: ' + (err.message || err));
    }
  }

  // ── Phase 3+4-C: 파일 업로드/삭제 + AI 분석 ─────────────────
  function _bindFileEvents(e, source) {
    if (!e || !e.id) return; // 신규 모드는 파일 기능 없음
    const dropzoneId = source === 'rfp' ? 'pr-rfp-dropzone' : 'pr-files-dropzone';
    const inputId = source === 'rfp' ? 'pr-rfp-upload-input' : 'pr-file-upload-input';
    const dropzone = document.getElementById(dropzoneId);
    const fileInput = document.getElementById(inputId);

    // (1) 클릭 → 파일 다이얼로그
    if (dropzone && fileInput) {
      dropzone.addEventListener('click', ev => {
        if (ev.target.tagName === 'INPUT') return;
        fileInput.click();
      });
      dropzone.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          fileInput.click();
        }
      });

      // (2) Drag & Drop
      ['dragenter', 'dragover'].forEach(evt =>
        dropzone.addEventListener(evt, ev => {
          ev.preventDefault();
          ev.stopPropagation();
          dropzone.classList.add('is-dragover');
        })
      );
      ['dragleave', 'drop'].forEach(evt =>
        dropzone.addEventListener(evt, ev => {
          ev.preventDefault();
          ev.stopPropagation();
          dropzone.classList.remove('is-dragover');
        })
      );
      dropzone.addEventListener('drop', async ev => {
        const files = Array.from(ev.dataTransfer?.files || []);
        if (files.length === 0) return;
        await _doUploadFiles(e.id, files, source);
      });

      // (3) input change (다중)
      fileInput.addEventListener('change', async ev => {
        const files = Array.from(ev.target.files || []);
        if (files.length === 0) return;
        await _doUploadFiles(e.id, files, source);
        ev.target.value = ''; // reset for re-upload
      });
    }

    // (4) 파일 삭제 버튼
    document.querySelectorAll('.pr-file-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const fileId = parseInt(btn.dataset.id, 10);
        if (!confirm('이 파일을 삭제하시겠습니까? 디스크에서도 함께 제거됩니다.')) return;
        try {
          await API.proposals.deleteFile(e.id, fileId);
          Toast.success('파일 삭제됨');
          await _refreshDetail(e.id);
        } catch (err) {
          Toast.error('삭제 실패: ' + (err.message || err));
        }
      });
    });

    // (5) Phase 4-C — AI 분석 버튼 (RFP 파일 행에서만 렌더링됨)
    document.querySelectorAll('.pr-file-ai').forEach(btn => {
      btn.addEventListener('click', async () => {
        const fileId = parseInt(btn.dataset.id, 10);
        await _doAnalyzeRfp(e.id, fileId, btn);
      });
    });

    // (6) Phase 6-C — AI 평가 버튼 (자료 파일 행에서만 렌더링됨)
    document.querySelectorAll('.pr-file-evaluate').forEach(btn => {
      btn.addEventListener('click', async () => {
        const fileId = parseInt(btn.dataset.id, 10);
        await _doEvaluateProposal(e.id, fileId, btn);
      });
    });

    // 다운로드는 href 직접 — history 기록은 백엔드 자동
  }

  // Phase 6-C: AI 제안서 평가 + 결과 카드 표시
  async function _doEvaluateProposal(propId, fileId, btn) {
    // 기존 평가 결과가 화면에 있으면 덮어쓰기 confirm
    const existingCard = document.getElementById('pr-eval-card');
    if (existingCard) {
      const ok = confirm(
        '기존 평가 결과를 새로운 평가로 교체하시겠습니까?\n(약 10-30초 소요, 비용 발생)'
      );
      if (!ok) return;
    } else {
      // 첫 평가도 비용 발생 confirm (사용자 의식적 클릭)
      const ok = confirm(
        'AI 평가를 진행하시겠습니까?\nGemini Pro 호출 — 약 10-30초 소요, 1회 약 300-500원 발생'
      );
      if (!ok) return;
    }

    const origText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '⏳';
    }
    const resultWrap = document.getElementById('pr-eval-result');
    if (resultWrap) {
      resultWrap.innerHTML = `<div class="pr-eval-loading">
        <div class="pr-eval-spinner"></div>
        <div>📊 AI 평가 진행 중... (RFP 와 제안서 비교, 최대 30초 소요)</div>
      </div>`;
      resultWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    try {
      Toast.info?.('AI 평가 시작 — RFP 자동 선택 (file_type=rfp 첫 파일)');
      const res = await API.proposals.evaluate(propId, fileId);
      const data = res?.data || {};
      if (resultWrap) {
        resultWrap.innerHTML = _renderEvalResult(data);
        // 닫기 버튼 바인딩
        const closeBtn = document.getElementById('pr-eval-close-btn');
        if (closeBtn) {
          closeBtn.addEventListener('click', () => {
            resultWrap.innerHTML = '';
          });
        }
        resultWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      Toast.success(
        `평가 완료 — 커버율 ${data.coverage_score}% (충족 ${data.covered_count} / 누락 ${data.missing_count})`
      );
    } catch (err) {
      console.error('[proposals:evaluate] failed:', err);
      const detail =
        err?.error || err?.message || (err?.status ? `HTTP ${err.status}` : null) || String(err);
      Toast.error('AI 평가 실패: ' + detail, { duration: 8000 });
      if (resultWrap) {
        resultWrap.innerHTML = `<div class="pr-eval-error">❌ ${esc(detail)}</div>`;
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origText;
      }
    }
  }

  // Phase 4-C — 다중 파일 업로드 (드롭존 / multi input 공통)
  async function _doUploadFiles(propId, files, source) {
    if (!files || !files.length) return;
    const fd = new FormData();
    files.forEach(file => fd.append('files', file));

    try {
      if (source === 'rfp') {
        // RFP 메타도 함께 (현재 탭 입력값)
        const title = document.getElementById('pr-f-rfp_title')?.value || '';
        const recv = document.getElementById('pr-f-rfp_received_date')?.value || '';
        const due = document.getElementById('pr-f-rfp_due_date')?.value || '';
        if (title) fd.append('rfp_title', title);
        if (recv) fd.append('rfp_received_date', recv);
        if (due) fd.append('rfp_due_date', due);
        Toast.info?.(`RFP ${files.length}개 파일 업로드 중...`);
        const res = await API.proposals.uploadRfp(propId, fd);
        _reportUploadResult(res, 'RFP');
      } else {
        const type = document.getElementById('pr-file-type')?.value || 'etc';
        const rev = document.getElementById('pr-file-rev')?.value || '1';
        const isFinal = document.getElementById('pr-file-final')?.checked ? '1' : '0';
        const inEmail = document.getElementById('pr-file-email')?.checked ? '1' : '0';
        const desc = document.getElementById('pr-file-desc')?.value || '';
        fd.append('file_type', type);
        fd.append('revision_no', rev);
        fd.append('is_final', isFinal);
        fd.append('include_in_email', inEmail);
        if (desc) fd.append('description', desc);
        Toast.info?.(`${files.length}개 파일 업로드 중...`);
        const res = await API.proposals.uploadFile(propId, fd);
        _reportUploadResult(res, '파일');
      }
      await _refreshDetail(propId);
    } catch (err) {
      Toast.error('업로드 실패: ' + (err.message || err));
    }
  }

  // 다중 업로드 결과 보고 (uploaded / failed 집계 Toast)
  function _reportUploadResult(res, label) {
    const data = res?.data || {};
    const uploaded = (data.uploaded || []).length;
    const failed = (data.failed || []).length;
    if (uploaded > 0 && failed === 0) {
      Toast.success(`${label} ${uploaded}개 업로드 완료`);
    } else if (uploaded > 0 && failed > 0) {
      Toast.error(`${label} ${uploaded}개 성공 / ${failed}개 실패`);
      // 실패 파일명 첫 1건 추가 알림
      const first = data.failed[0];
      if (first) Toast.error(`실패: ${first.original_filename} — ${first.error}`);
    } else if (uploaded === 0 && failed > 0) {
      Toast.error(`${label} 업로드 모두 실패 (${failed}건)`);
    }
  }

  // Phase 4-C — AI RFP 분석 + 폼 미리채움 (DB 자동 저장 X)
  // 4-D 보강: 상세 에러 표시 + console.error + 타임아웃 안내
  async function _doAnalyzeRfp(propId, fileId, btn) {
    const origText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '⏳';
    }
    try {
      Toast.info?.('AI 분석 중... (최대 60초 소요)');
      const res = await API.proposals.analyzeRfp(propId, fileId);
      const d = res?.data || {};
      _applyAnalysisToForm(d);
      Toast.success('AI 분석 완료 — 폼에 결과가 채워졌습니다. 검토 후 [저장] 누르세요');
    } catch (err) {
      // 디버깅용 콘솔 (개발자도구 확인 가능)
      console.error('[proposals:analyze] failed:', err);
      // 상세 메시지 추출 — err.error / err.message / err.status
      const detail =
        err?.error || err?.message || (err?.status ? `HTTP ${err.status}` : null) || String(err);
      Toast.error('AI 분석 실패: ' + detail, { duration: 8000 });
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origText;
      }
    }
  }

  // 분석 결과를 기본정보 탭 폼에 미리채움 + _editing 캐시 동기화 (DB 미반영)
  // Phase 8-C: ai_strategy_md textarea + 제안 기본정보 (제안명/예상금액/통화/일정) 자동 채움
  function _applyAnalysisToForm(d) {
    // 비어있지 않을 때만 덮어쓰기 (사용자 입력값 보존)
    const setIfEmpty = (id, v) => {
      const el = document.getElementById(id);
      if (el && v !== null && v !== undefined && v !== '' && !el.value) el.value = v;
    };
    // 무조건 덮어쓰기 (AI 분석 결과 우선 — RFP 메타 + ai_strategy_md)
    const setForce = (id, v) => {
      const el = document.getElementById(id);
      if (el && v !== null && v !== undefined && v !== '') el.value = v;
    };
    // ── RFP 메타 (항상 덮어쓰기 — AI 가 더 정확) ──
    if (d.rfp_title) setForce('pr-f-rfp_title', d.rfp_title);
    if (d.rfp_received_date) setForce('pr-f-rfp_received_date', d.rfp_received_date);
    if (d.rfp_due_date) setForce('pr-f-rfp_due_date', d.rfp_due_date);
    if (d.rfp_summary) setForce('pr-f-rfp_summary', d.rfp_summary);
    // ── AI 제안전략 요약 (textarea 항상 덮어쓰기) ──
    if (d.ai_strategy_md) setForce('pr-f-ai_strategy_md', d.ai_strategy_md);
    // ── Phase 8-A: 제안 기본정보 (사용자 입력값 보존 — empty 시만) ──
    if (d.proposal_title) setIfEmpty('pr-f-proposal_title', d.proposal_title);
    if (d.expected_amount) setIfEmpty('pr-f-expected_amount', d.expected_amount);
    // currency 는 select — 옵션이 일치하면 강제 (KRW 기본값 보호)
    if (d.currency) {
      const sel = document.getElementById('pr-f-currency');
      if (sel && Array.from(sel.options).some(o => o.value === d.currency)) {
        sel.value = d.currency;
      }
    }
    // 제안일/제출기한 — 비어있을 때 RFP 일정으로 채움
    if (d.rfp_received_date) setIfEmpty('pr-f-proposal_date', d.rfp_received_date);
    if (d.rfp_due_date) setIfEmpty('pr-f-due_date', d.rfp_due_date);

    // _editing 캐시도 동기화 — 탭 전환해도 결과 유지
    if (_editing) {
      if (d.rfp_title) _editing.rfp_title = d.rfp_title;
      if (d.rfp_received_date) _editing.rfp_received_date = d.rfp_received_date;
      if (d.rfp_due_date) _editing.rfp_due_date = d.rfp_due_date;
      if (d.rfp_summary) _editing.rfp_summary = d.rfp_summary;
      if (d.ai_strategy_md) _editing.ai_strategy_md = d.ai_strategy_md;
      if (d.proposal_title && !_editing.proposal_title)
        _editing.proposal_title = d.proposal_title;
      if (d.expected_amount && !_editing.expected_amount)
        _editing.expected_amount = d.expected_amount;
      if (d.currency) _editing.currency = d.currency;
    }
  }

  async function _refreshDetail(propId) {
    try {
      const r = await API.proposals.get(propId);
      _editing = r.data;
      _renderActiveTab(_editing);
    } catch (_) {
      /* 무시 */
    }
  }

  // ── Phase 8-C: AI 분석 + 미리보기 + 복사 (기본정보 탭 통합) ─
  // 분석 버튼은 RFP 섹션에 있고, 미리보기/복사는 AI 제안전략 요약 섹션에 있음
  function _bindAiTabEvents(e) {
    if (!e || !e.id) return;
    const rfpFiles = (e.files || []).filter(f => f.file_type === 'rfp');
    const analyzableFiles = rfpFiles.filter(f => _isAnalyzable(f.original_filename));

    // (1) 분석 / 재생성 버튼 (RFP 섹션) — 결과를 폼에 자동 채움
    const analyzeBtn = document.getElementById('pr-ai-analyze-btn');
    if (analyzeBtn) {
      analyzeBtn.addEventListener('click', async () => {
        if (analyzableFiles.length === 0) {
          if (rfpFiles.length > 0) {
            Toast.error(
              '분석 가능한 형식이 아닙니다 — PDF / 이미지 / 텍스트만 지원 (PPT/DOC/HWP 는 PDF 로 변환)'
            );
          } else {
            Toast.error('RFP 파일이 없습니다. 먼저 업로드하세요.');
          }
          return;
        }
        const currentMd = (
          document.getElementById('pr-f-ai_strategy_md')?.value ||
          e.ai_strategy_md ||
          ''
        ).trim();
        if (currentMd) {
          const ok = confirm(
            '기존 AI 제안전략 요약을 덮어쓰시겠습니까?\n(저장 전이면 [닫기]로 취소 가능합니다)'
          );
          if (!ok) return;
        }
        await _doAnalyzeRfp(e.id, analyzableFiles[0].id, analyzeBtn);
        // Phase 8-C: 분석 결과를 폼에 즉시 채움 (textarea + 제안 기본정보)
        // _doAnalyzeRfp 내부에서 _applyAnalysisToForm 호출됨
      });
    }

    // (2) 미리보기 토글 — textarea ↔ rendered markdown
    const previewBtn = document.getElementById('pr-ai-preview-btn');
    const renderWrap = document.getElementById('pr-ai-md-render');
    const ta = document.getElementById('pr-f-ai_strategy_md');
    if (previewBtn && renderWrap && ta) {
      previewBtn.addEventListener('click', () => {
        const isShown = renderWrap.style.display !== 'none';
        if (isShown) {
          renderWrap.style.display = 'none';
          previewBtn.innerHTML = '👁️ 미리보기';
        } else {
          renderWrap.innerHTML = _renderMarkdown(ta.value || '');
          renderWrap.style.display = '';
          previewBtn.innerHTML = '📝 편집 보기';
        }
      });
    }

    // (3) 복사 버튼 — clipboard.writeText (textarea 의 현재 값)
    const copyBtn = document.getElementById('pr-ai-copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const md = (document.getElementById('pr-f-ai_strategy_md')?.value || '').trim();
        if (!md) {
          Toast.error('복사할 내용이 없습니다');
          return;
        }
        try {
          await navigator.clipboard.writeText(md);
          Toast.success('마크다운 클립보드에 복사됨');
        } catch (_) {
          // fallback — textarea 임시 사용
          const tmp = document.createElement('textarea');
          tmp.value = md;
          tmp.style.position = 'fixed';
          tmp.style.left = '-9999px';
          document.body.appendChild(tmp);
          tmp.select();
          try {
            document.execCommand('copy');
            Toast.success('마크다운 클립보드에 복사됨');
          } catch (_) {
            Toast.error('복사 실패 — 수동 선택 후 복사하세요');
          }
          document.body.removeChild(tmp);
        }
      });
    }
  }

  // ── Phase 5-D: 이메일/공유 탭 이벤트 ───────────────────────
  function _bindEmailTabEvents(e) {
    if (!e || !e.id) return;

    // (1) 이메일 발송 버튼
    const sendBtn = document.getElementById('pr-email-send-btn');
    if (sendBtn) {
      sendBtn.addEventListener('click', async () => {
        const to = (document.getElementById('pr-email-to')?.value || '').trim();
        const cc = (document.getElementById('pr-email-cc')?.value || '').trim();
        const subject = (document.getElementById('pr-email-subject')?.value || '').trim();
        const body = (document.getElementById('pr-email-body')?.value || '').trim();
        const fileIds = Array.from(document.querySelectorAll('.pr-email-file:checked')).map(el =>
          parseInt(el.value, 10)
        );

        if (!to || !/@/.test(to)) {
          Toast.error('받는사람 이메일 주소를 입력하세요');
          return;
        }
        if (!subject) {
          Toast.error('제목을 입력하세요');
          return;
        }

        // 첨부 합계 크기 사전 표시 (백엔드도 검증)
        const files = (e.files || []).filter(f => fileIds.includes(f.id));
        const totalBytes = files.reduce((sum, f) => sum + (f.file_size || 0), 0);
        if (totalBytes > 25 * 1024 * 1024) {
          Toast.error(
            `첨부 합계 ${(totalBytes / 1024 / 1024).toFixed(1)}MB — 25MB 한도 초과. 일부 파일 제외 후 재시도`
          );
          return;
        }

        const origText = sendBtn.innerHTML;
        sendBtn.disabled = true;
        sendBtn.innerHTML = '⏳ 발송 중...';
        const statusEl = document.getElementById('pr-email-status');
        if (statusEl) statusEl.innerHTML = '⏳ Gmail 발송 중...';
        try {
          const res = await API.proposals.sendEmail(e.id, {
            to,
            cc,
            subject,
            body,
            file_ids: fileIds,
          });
          const d = res?.data || {};
          Toast.success(
            `발송 완료 — 첨부 ${d.attachment_count}개 (${((d.total_bytes || 0) / 1024).toFixed(1)}KB)`
          );
          if (statusEl) {
            statusEl.innerHTML = `✅ 발송 완료 — message_id: <code>${esc(d.message_id || '-')}</code>`;
          }
          // 발송 이력 갱신
          await _refreshDetail(e.id);
        } catch (err) {
          console.error('[proposals:email send] failed:', err);
          const detail =
            err?.error || err?.message || (err?.status ? `HTTP ${err.status}` : null) || String(err);
          Toast.error('이메일 발송 실패: ' + detail, { duration: 8000 });
          if (statusEl) statusEl.innerHTML = `❌ 실패: ${esc(detail)}`;
          // Gmail 미연결 안내
          if (err?.notConnected || /Google 인증|gmail/i.test(detail)) {
            Toast.error('Google 계정을 먼저 연결하세요 (설정 → Google 연동)', { duration: 8000 });
          }
        } finally {
          sendBtn.disabled = false;
          sendBtn.innerHTML = origText;
        }
      });
    }

    // (2) 공유 링크 생성
    const createBtn = document.getElementById('pr-share-create-btn');
    if (createBtn) {
      createBtn.addEventListener('click', async () => {
        const days = parseInt(document.getElementById('pr-share-expires')?.value, 10);
        const origText = createBtn.innerHTML;
        createBtn.disabled = true;
        createBtn.innerHTML = '⏳';
        try {
          await API.proposals.createShare(e.id, Number.isFinite(days) ? days : 7);
          Toast.success('공유 링크 발급 완료');
          await _refreshDetail(e.id);
        } catch (err) {
          console.error('[proposals:share create] failed:', err);
          Toast.error('공유 링크 발급 실패: ' + (err?.error || err?.message || err));
          createBtn.disabled = false;
          createBtn.innerHTML = origText;
        }
      });
    }

    // (3) 공유 링크 재발급 — 기존 토큰 무효화 + 새 발급
    const renewBtn = document.getElementById('pr-share-renew-btn');
    if (renewBtn) {
      renewBtn.addEventListener('click', async () => {
        const ok = confirm(
          '공유 링크를 재발급하시겠습니까?\n현재 링크는 즉시 무효화되고, 새 링크가 생성됩니다.'
        );
        if (!ok) return;
        try {
          await API.proposals.createShare(e.id, 7);
          Toast.success('공유 링크 재발급 완료');
          await _refreshDetail(e.id);
        } catch (err) {
          Toast.error('재발급 실패: ' + (err?.error || err?.message || err));
        }
      });
    }

    // (4) 공유 링크 무효화
    const revokeBtn = document.getElementById('pr-share-revoke-btn');
    if (revokeBtn) {
      revokeBtn.addEventListener('click', async () => {
        const ok = confirm('공유 링크를 무효화하시겠습니까?\n외부 접근이 즉시 차단됩니다.');
        if (!ok) return;
        try {
          await API.proposals.revokeShare(e.id);
          Toast.success('공유 링크 무효화됨');
          await _refreshDetail(e.id);
        } catch (err) {
          Toast.error('무효화 실패: ' + (err?.error || err?.message || err));
        }
      });
    }

    // (5) 공유 URL 클립보드 복사
    const copyBtn = document.getElementById('pr-share-copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const url = document.getElementById('pr-share-url')?.value || '';
        if (!url) {
          Toast.error('복사할 URL 이 없습니다');
          return;
        }
        try {
          await navigator.clipboard.writeText(url);
          Toast.success('공유 링크가 클립보드에 복사됨');
        } catch (_) {
          // fallback
          const ta = document.createElement('textarea');
          ta.value = url;
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          try {
            document.execCommand('copy');
            Toast.success('공유 링크가 클립보드에 복사됨');
          } catch (_) {
            Toast.error('복사 실패 — 수동 선택 후 복사하세요');
          }
          document.body.removeChild(ta);
        }
      });
    }
  }

  function _bindHistoryEvents(e) {
    const btn = document.getElementById('pr-rev-new-btn');
    if (!btn) return;
    btn.addEventListener('click', () => _openRevisionModal(e));
  }

  // ── 리비전 생성 모달 (작은 nested-ish — Modal.open 사용) ─────
  function _openRevisionModal(e) {
    const nextRev = (e.version_no || 1) + 1;
    Modal.open({
      title: `🌿 새 리비전 생성 — v${nextRev}`,
      width: 560,
      compact: true,
      confirmOnClose: false,
      body: `
        <div class="form-row" style="margin-bottom:10px">
          <label class="form-label">리비전 제목 (선택)</label>
          <input class="form-input" id="pr-rev-title" placeholder="예: 1차 수정안 / 가격 협상안" value="v${nextRev}">
        </div>
        <div class="form-row">
          <label class="form-label">변경 내용 / 설명 (선택)</label>
          <textarea class="form-input" id="pr-rev-desc" rows="4" placeholder="이 리비전에서 변경된 주요 내용 (예: 가격 5% 인하, 일정 2주 단축)" style="resize:vertical;font-family:inherit"></textarea>
        </div>
        <div style="font-size:11px;color:var(--text-3);margin-top:6px">
          ⚠️ 새 리비전 생성 후 제안의 version_no 가 v${nextRev} 로 갱신됩니다.
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="pr-rev-cancel-btn">취소</button>
        <button class="btn btn-primary" id="pr-rev-save-btn">💾 리비전 생성</button>
      `,
      bind: {
        '#pr-rev-cancel-btn': () => Modal.close(),
        '#pr-rev-save-btn': async () => {
          const title = document.getElementById('pr-rev-title').value.trim();
          const desc = document.getElementById('pr-rev-desc').value.trim();
          try {
            await API.proposals.createRevision(e.id, { title, description: desc });
            Toast.success(`리비전 v${nextRev} 생성됨`);
            Modal.close();
            // 부모 모달이 닫혔으니 목록만 reload + 상세 다시 열기는 사용자가 선택
            await _reload();
            // 상세 모달 다시 열기 (사용자 흐름 보존)
            setTimeout(() => _openModal(e.id), 200);
          } catch (err) {
            Toast.error('리비전 생성 실패: ' + (err.message || err));
          }
        },
      },
    });
  }

  return { render, _openModal };
})();

window.ProposalsPage = ProposalsPage;
