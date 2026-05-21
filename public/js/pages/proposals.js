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
  // 탭 정의 (id / 라벨 / 신규 모드 비활성 여부)
  const TABS = [
    { id: 'basic', label: '📋 기본정보', alwaysOn: true },
    { id: 'rfp', label: '📑 RFP', editOnly: true },
    { id: 'ai', label: '🤖 AI 제안전략', editOnly: true },
    { id: 'files', label: '📦 제안자료', editOnly: true },
    { id: 'quote', label: '💰 견적', editOnly: true },
    { id: 'email', label: '📧 이메일/공유', editOnly: true },
    { id: 'history', label: '🕒 리비전/이력', editOnly: true },
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
      case 'basic':
        wrap.innerHTML = _renderBasicTab(e);
        _attachLeadCombobox();
        _attachQuoteCombobox(e.quote_id);
        break;
      case 'rfp':
        wrap.innerHTML = _renderRfpTab(e);
        break;
      case 'ai':
        wrap.innerHTML = _renderAiTab(e);
        break;
      case 'files':
        wrap.innerHTML = _renderFilesTab(e);
        break;
      case 'quote':
        wrap.innerHTML = _renderQuoteTab(e);
        break;
      case 'email':
        wrap.innerHTML = _renderEmailTab(e);
        break;
      case 'history':
        wrap.innerHTML = _renderHistoryTab(e);
        break;
      default:
        wrap.innerHTML = '';
    }
  }

  // ── 탭 1: 기본정보 (Phase 1 폼 재사용) ───────────────────
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
          <input class="form-input" id="pr-f-proposal_title" value="${esc(e.proposal_title || '')}" placeholder="제안서 제목 입력">
        </div>
        <div class="form-row">
          <label class="form-label required">고객사명</label>
          <input class="form-input" id="pr-f-customer_name" value="${esc(e.customer_name || '')}" placeholder="고객사 명">
        </div>

        <div class="form-row" style="grid-column:1 / span 2">
          <label class="form-label">예상금액</label>
          <div style="display:flex;gap:4px">
            <input class="form-input" id="pr-f-expected_amount" type="number" step="0.01" min="0" value="${e.expected_amount || ''}" placeholder="견적 연결 시 자동 반영" style="flex:1">
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

      <div class="form-row" style="margin-top:14px">
        <label class="form-label">📝 비고</label>
        <textarea class="form-input" id="pr-f-remark" rows="3" placeholder="제안 관련 메모 (선택)" style="resize:vertical;font-family:inherit;line-height:1.5">${esc(e.remark || '')}</textarea>
      </div>
    `;
  }

  // ── 탭 2: RFP (메타정보 + 파일은 Phase 3) ────────────────
  function _renderRfpTab(e) {
    return `
      <div style="margin-bottom:16px;padding:10px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:12px;color:#92400e">
        📑 <strong>RFP 메타정보</strong> — 고객사가 보낸 RFP 문서의 핵심 정보를 입력하세요.
        파일 업로드 / drag&drop 은 <strong>Phase 3</strong> 에서 활성화됩니다.
      </div>
      <div class="form-grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:14px">
        <div class="form-row" style="grid-column:1 / span 2">
          <label class="form-label">RFP 제목</label>
          <input class="form-input" id="pr-f-rfp_title" value="${esc(e.rfp_title || '')}" placeholder="고객사 RFP 문서 제목">
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
      <div class="form-row">
        <label class="form-label">📝 RFP 요약 (AI 제안전략 분석의 입력 자료)</label>
        <textarea class="form-input" id="pr-f-rfp_summary" rows="10" placeholder="RFP 핵심 요구사항·평가기준·예산·납기 등을 요약 입력 (AI 분석 시 활용됨)" style="resize:vertical;font-family:inherit;line-height:1.6">${esc(e.rfp_summary || '')}</textarea>
      </div>

      <!-- RFP 파일 영역 placeholder (Phase 3) -->
      <div style="margin-top:18px;padding:24px;border:2px dashed var(--border);border-radius:8px;text-align:center;color:var(--text-3);background:#fafafa">
        <div style="font-size:32px;margin-bottom:8px">📎</div>
        <div style="font-size:13px">RFP 파일 업로드 (drag & drop)</div>
        <div style="font-size:11px;margin-top:4px">Phase 3 에서 활성화됩니다</div>
      </div>
    `;
  }

  // ── 탭 3: AI 제안전략 (Phase 4) ──────────────────────────
  function _renderAiTab(e) {
    const hasResult = e.ai_strategy_md && e.ai_strategy_md.trim();
    return `
      <div style="margin-bottom:16px;padding:10px 14px;background:#f3e8ff;border:1px solid #d8b4fe;border-radius:6px;font-size:12px;color:#6b21a8">
        🤖 <strong>AI 제안 전략 분석</strong> — RFP 요약 + 고객/리드/견적 정보를 바탕으로 한국어 B2B 제안 전략을 markdown 으로 생성합니다.
        <br>실행 버튼은 <strong>Phase 4</strong> 에서 활성화됩니다.
      </div>
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <button class="btn btn-primary" disabled style="opacity:0.5;cursor:not-allowed">🤖 AI 제안 전략 분석하기</button>
        <button class="btn btn-ghost" disabled style="opacity:0.5;cursor:not-allowed">🔁 다시 생성</button>
        <button class="btn btn-ghost" disabled style="opacity:0.5;cursor:not-allowed">📋 복사</button>
        <div style="margin-left:auto;font-size:11px;color:var(--text-3);padding-top:8px">
          ${e.ai_strategy_generated_at ? '최근 분석: ' + _fmtDateTime(e.ai_strategy_generated_at) : '아직 분석 결과 없음'}
        </div>
      </div>

      ${
        hasResult
          ? `<div style="padding:18px;background:#fafafa;border:1px solid var(--border);border-radius:6px;white-space:pre-wrap;font-family:'Malgun Gothic',sans-serif;font-size:13px;line-height:1.7;color:var(--text-1)">${esc(e.ai_strategy_md)}</div>`
          : `<div style="padding:60px 20px;text-align:center;color:var(--text-3);background:#fafafa;border:1px dashed var(--border);border-radius:6px">
              <div style="font-size:48px;margin-bottom:12px">🤖</div>
              <div style="font-size:14px;margin-bottom:6px">아직 AI 분석 결과가 없습니다</div>
              <div style="font-size:12px">RFP 요약을 먼저 입력하고, Phase 4 에서 분석을 실행하세요</div>
            </div>`
      }
    `;
  }

  // ── 탭 4: 제안자료 (Phase 3) ─────────────────────────────
  function _renderFilesTab(e) {
    const files = Array.isArray(e.files) ? e.files : [];
    return `
      <div style="margin-bottom:16px;padding:10px 14px;background:#dbeafe;border:1px solid #93c5fd;border-radius:6px;font-size:12px;color:#1e40af">
        📦 <strong>제안 자료 아카이브</strong> — 제안서 / 회사소개서 / 레퍼런스 / 견적 / 응답서 등 PPT/Word/PDF/HWP 파일을 관리합니다.
        업로드 / 다운로드 / 삭제 기능은 <strong>Phase 3</strong> 에서 활성화됩니다.
      </div>
      <div style="padding:24px;border:2px dashed var(--border);border-radius:8px;text-align:center;color:var(--text-3);background:#fafafa;margin-bottom:14px">
        <div style="font-size:32px;margin-bottom:8px">⬆️</div>
        <div style="font-size:13px">제안 파일 업로드 (drag & drop) — 허용: pdf, ppt, pptx, doc, docx, xls, xlsx, hwp, hwpx, png, jpg</div>
        <div style="font-size:11px;margin-top:4px">Phase 3 에서 활성화됩니다</div>
      </div>

      <div style="font-size:12px;color:var(--text-3);margin-bottom:8px">현재 등록된 파일 (${files.length}건)</div>
      ${
        files.length === 0
          ? `<div style="padding:30px;text-align:center;color:var(--text-3);background:#fafafa;border-radius:6px">등록된 파일 없음</div>`
          : `<table class="data-table" style="font-size:12px">
              <thead><tr>
                <th style="width:90px">유형</th>
                <th>파일명</th>
                <th style="width:60px">Rev</th>
                <th style="width:80px;text-align:center">최종본</th>
                <th style="width:80px;text-align:center">📧 첨부</th>
                <th style="width:110px">크기</th>
                <th style="width:130px">등록일</th>
              </tr></thead>
              <tbody>
                ${files
                  .map(
                    f => `<tr>
                  <td><span class="badge badge-gray">${esc(f.file_type)}</span></td>
                  <td>${esc(f.original_filename)}</td>
                  <td>v${f.revision_no || 1}</td>
                  <td style="text-align:center">${f.is_final ? '✅' : '-'}</td>
                  <td style="text-align:center">${f.include_in_email ? '📧' : '-'}</td>
                  <td>${f.file_size ? (f.file_size / 1024).toFixed(1) + ' KB' : '-'}</td>
                  <td>${_fmtDateTime(f.created_at)}</td>
                </tr>`
                  )
                  .join('')}
              </tbody>
            </table>`
      }
    `;
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

  // ── 탭 6: 이메일/공유 (Phase 5) ─────────────────────────
  function _renderEmailTab(e) {
    const logs = Array.isArray(e.email_logs) ? e.email_logs : [];
    return `
      <div style="margin-bottom:16px;padding:10px 14px;background:#dcfce7;border:1px solid #86efac;border-radius:6px;font-size:12px;color:#166534">
        📧 <strong>이메일 발송 / 공유 링크</strong> — 제안 파일 첨부 이메일 발송 + 내부 관련자 공유 링크 생성.
        Gmail 통합 발송 기능은 <strong>Phase 5</strong> 에서 활성화됩니다.
      </div>
      <div style="padding:24px;border:2px dashed var(--border);border-radius:8px;text-align:center;color:var(--text-3);background:#fafafa;margin-bottom:18px">
        <div style="font-size:32px;margin-bottom:8px">✉️</div>
        <div style="font-size:13px">이메일 발송 폼 (수신자/참조/제목/본문/첨부)</div>
        <div style="font-size:11px;margin-top:4px">Phase 5 에서 활성화됩니다</div>
      </div>

      <div style="font-size:12px;color:var(--text-3);margin-bottom:8px">📬 발송 이력 (${logs.length}건)</div>
      ${
        logs.length === 0
          ? `<div style="padding:30px;text-align:center;color:var(--text-3);background:#fafafa;border-radius:6px">아직 발송 이력 없음</div>`
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
                  <td style="text-align:center"><span class="badge badge-${l.send_status === 'sent' ? 'green' : 'red'}">${esc(l.send_status || 'sent')}</span></td>
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
            <button class="btn btn-ghost btn-sm" disabled style="opacity:0.5;cursor:not-allowed" title="Phase 3 에서 활성화">+ 새 리비전</button>
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
    const date = get('pr-f-proposal_date', e.proposal_date || new Date().toISOString().slice(0, 10));

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
    const dueDate = get('pr-f-due_date', e.due_date || '');
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
    const rfpReceived = get('pr-f-rfp_received_date', e.rfp_received_date || '');
    const rfpDue = get('pr-f-rfp_due_date', e.rfp_due_date || '');
    const rfpSummary = get('pr-f-rfp_summary', e.rfp_summary || '');
    // 편집 모드만 RFP 필드 전송 (신규는 기본정보만)
    if (_editing) {
      body.rfp_title = rfpTitle || null;
      body.rfp_received_date = rfpReceived || null;
      body.rfp_due_date = rfpDue || null;
      body.rfp_summary = rfpSummary || null;
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

  return { render, _openModal };
})();

window.ProposalsPage = ProposalsPage;
