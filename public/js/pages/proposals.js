// ============================================================
// ProposalsPage — 제안관리 아카이브 (Phase 1: 목록 + 등록/편집 모달)
// 데이터: /api/proposals
// ============================================================
const ProposalsPage = (() => {
  // ── 모듈 상태 ────────────────────────────────────────────
  let _list = [];
  let _editing = null;
  let _leadsCache = [];
  let _quotesCache = [];
  let _teamCache = [];
  let _comboboxes = [];

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

  // ── 유틸 ─────────────────────────────────────────────────
  function _fmtDate(s) {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d)) return s;
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
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
                <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${r.id}">편집</button>
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

  // ── 모달 (생성/편집) ─────────────────────────────────────
  async function _openModal(id) {
    _editing = null;
    _cleanupInstances();

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
      title: id ? `📝 제안 편집 — ${esc(e.proposal_no)}` : '✏️ 새 제안 등록',
      width: 1080,
      body: _renderModalBody(e),
      footer: `
        <button class="btn btn-ghost" id="pr-cancel-btn">취소</button>
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
        _attachLeadCombobox();
        _attachQuoteCombobox(e.quote_id);
      },
    });
  }

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

  function _renderModalBody(e) {
    return `
      <div class="pr-modal">
        <div class="form-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:14px">
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

          <!-- 영업리드 Combobox -->
          <div class="form-row" style="grid-column:1 / span 2">
            <label class="form-label">💼 영업리드 연결 (선택)</label>
            <input class="form-input" id="pr-f-lead-input"
              value="${esc(_leadInitialText(e.lead_id))}"
              placeholder="🔍 고객사 또는 프로젝트명 1글자 이상 입력 → 자동완성 → 고객사 자동 채움">
            <input type="hidden" id="pr-f-lead_id" value="${e.lead_id || ''}">
            <input type="hidden" id="pr-f-customer_id" value="${e.customer_id || ''}">
          </div>
          <div class="form-row">
            <label class="form-label">담당자</label>
            <select class="form-input" id="pr-f-owner_id">${_teamOptions(e.owner_id)}</select>
          </div>

          <!-- 견적 Combobox -->
          <div class="form-row" style="grid-column:1 / span 2">
            <label class="form-label">📄 연결 견적 (선택)</label>
            <input class="form-input" id="pr-f-quote-input"
              value="${esc(_quoteInitialText(e.quote_id))}"
              placeholder="🔍 견적번호 또는 견적명 1글자 이상 입력 → 자동완성 → 예상금액 자동 반영">
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
                  .map(
                    c =>
                      `<option value="${c}" ${e.currency === c ? 'selected' : ''}>${c}</option>`
                  )
                  .join('')}
              </select>
            </div>
          </div>
          <div class="form-row">
            <label class="form-label" style="font-size:11px;color:var(--text-3)">${e.id ? '리비전 v' + (e.version_no || 1) : ''}</label>
            <div style="font-size:11px;color:var(--text-3);padding-top:8px">
              📁 파일 / 🤖 AI / 📧 이메일은 다음 단계 (Phase 2~5)에서 활성화됩니다.
            </div>
          </div>
        </div>

        <div class="form-row">
          <label class="form-label">📝 비고</label>
          <textarea class="form-input" id="pr-f-remark" rows="3" placeholder="제안 관련 메모 (선택)" style="resize:vertical;font-family:inherit;line-height:1.5">${esc(e.remark || '')}</textarea>
        </div>
      </div>
    `;
  }

  // ── Combobox attach ──────────────────────────────────────
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
        // 자동 채움 (사용자 입력 보존)
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
        // 자동: 예상금액 + 고객사명 채움 (비어있을 때만)
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

  // ── 저장 ─────────────────────────────────────────────────
  async function _save() {
    const title = document.getElementById('pr-f-proposal_title').value.trim();
    const customer = document.getElementById('pr-f-customer_name').value.trim();
    const date = document.getElementById('pr-f-proposal_date').value;
    if (!title) {
      Toast.error('제안명을 입력하세요');
      return;
    }
    if (!customer) {
      Toast.error('고객사명을 입력하세요');
      return;
    }
    if (!date) {
      Toast.error('제안일을 입력하세요');
      return;
    }

    const leadId = document.getElementById('pr-f-lead_id').value.trim();
    const customerId = document.getElementById('pr-f-customer_id').value.trim();
    const quoteId = document.getElementById('pr-f-quote_id').value.trim();
    const dueDate = document.getElementById('pr-f-due_date').value;
    const ownerId = document.getElementById('pr-f-owner_id').value;
    const expected = document.getElementById('pr-f-expected_amount').value;
    const currency = document.getElementById('pr-f-currency').value;
    const status = document.getElementById('pr-f-status').value;
    const remark = document.getElementById('pr-f-remark').value;

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
