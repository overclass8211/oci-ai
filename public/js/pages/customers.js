// ============================================================
// Customers Page — 고객사 등록 (직접입력 / 명함 OCR) + AI 인텔리전스
//                + Copy & Paste (그리드 복붙) 기능
// ============================================================
const CustomersPage = {
  data: [],
  selectedCustomer: null,
  _ocrFiles: [],
  _ocrResults: [],
  _activeRegTab: 'direct',
  _view: localStorage.getItem('customers_view') || 'list',

  // Copy & Paste 상태
  _selectedIds: new Set(),
  _allData: [],
  _parsedCustomers: [],
  _pasteHandler: null,

  async render() {
    document.getElementById('content').innerHTML = `
      <div class="filter-bar">
        <input class="search-input" id="cust-search" data-placeholder-label="customers.search_placeholder" placeholder="고객사명, 담당자 검색...">
        <select class="filter-select" id="cust-region">
          <option value="" data-label="common.all">전체 지역</option>
          <option value="국내" data-label="region.domestic">국내</option>
          <option value="해외" data-label="region.overseas">해외</option>
        </select>
        <select class="filter-select" id="cust-industry">
          <option value="" data-label="common.all">전체 산업군</option>
        </select>

        <div style="margin-left:auto;display:flex;align-items:center;gap:8px">
          <button class="btn btn-ghost btn-sm" id="cp-paste-btn-cust"
                  data-feature="data.bulk_paste"
                  title="Ctrl+V" data-label="common.paste_register">
            📥 붙여넣기 등록
          </button>
          <button class="btn btn-ghost btn-sm" id="cust-excel-export-btn"
            data-feature="data.excel_exp"
            title="현재 목록을 엑셀 파일로 다운로드" data-label="common.excel_export">
            📤 엑셀 다운로드
          </button>
          <label class="btn btn-ghost btn-sm" data-feature="data.excel_imp"
            title="엑셀 파일로 일괄 등록" style="cursor:pointer;margin:0">
            <span data-label="common.excel_import">📂 엑셀 가져오기</span>
            <input type="file" id="cust-excel-import-input" accept=".xlsx,.xls" style="display:none">
          </label>
          <div class="view-toggle">
            <button class="view-toggle-btn ${this._view === 'list' ? 'active' : ''}"
                    data-view="list" title="목록 보기">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                <path d="M2 3h12v2H2zM2 7h12v2H2zM2 11h12v2H2z"/>
              </svg>
              <span data-label="customers.view_list">목록</span>
            </button>
            <button class="view-toggle-btn ${this._view === 'card' ? 'active' : ''}"
                    data-view="card" title="카드 보기">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                <path d="M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z"/>
              </svg>
              <span data-label="customers.view_card">카드</span>
            </button>
          </div>
          <button class="btn btn-primary" id="cust-register-btn" data-label="customers.new_button">
            + 고객사 등록
          </button>
        </div>
      </div>

      <div id="customers-view-container" style="margin-bottom:12px">
        <div class="loading" style="padding:40px;text-align:center" data-label="common.loading">로딩...</div>
      </div>

      <!-- 고객사 인텔리전스 패널 -->
      <div id="cust-intel-panel" style="display:none">
        <div class="card">
          <div class="card-header">
            <div class="card-title">
              🎯 <span id="intel-company-name"></span> — AI 고객사 인텔리전스
            </div>
            <div style="display:flex;gap:6px">
              <button class="ai-gen-btn" id="intel-refresh-btn">🔄 재생성</button>
              <button class="btn btn-ghost btn-sm" id="intel-close-btn">✕</button>
            </div>
          </div>
          <div id="intel-content" class="card-body" style="min-height:120px;font-size:13px;line-height:1.7">
            <span class="ai-cursor">▋</span>
          </div>
        </div>
      </div>
    `;
    // bind render() buttons
    document
      .getElementById('cp-paste-btn-cust')
      ?.addEventListener('click', () => this.openPasteModal());
    document
      .getElementById('cust-excel-export-btn')
      ?.addEventListener('click', e => this._openExportMenu(e.currentTarget));
    document
      .getElementById('cust-register-btn')
      ?.addEventListener('click', () => this.openRegisterModal('direct'));
    document
      .getElementById('cust-excel-import-input')
      ?.addEventListener('change', e => this.importExcel(e.target));
    document.querySelector('#cust-intel-panel')?.addEventListener('click', e => {
      if (e.target.id === 'intel-close-btn') this.closeIntel();
    });
    // view toggle delegation
    document.querySelector('.view-toggle')?.addEventListener('click', e => {
      const btn = e.target.closest('.view-toggle-btn');
      if (btn) this.switchView(btn.dataset.view);
    });
    // filter inputs
    document.getElementById('cust-search')?.addEventListener('input', () => this.applyFilter());
    document.getElementById('cust-region')?.addEventListener('change', () => this.applyFilter());
    document.getElementById('cust-industry')?.addEventListener('change', () => this.applyFilter());

    this._bindPasteShortcut();
    await this.loadData();
  },

  async loadData() {
    try {
      const res = await API.customers.list();
      this.data = res.data;
      this._allData = res.data;

      // 산업군 드롭다운 동적 생성
      const industryEl = document.getElementById('cust-industry');
      if (industryEl) {
        const industries = [...new Set(this.data.map(c => c.industry).filter(Boolean))].sort();
        industryEl.innerHTML =
          '<option value="">전체 산업군</option>' +
          industries.map(i => `<option value="${esc(i)}">${esc(i)}</option>`).join('');
      }

      this.applyFilter();
    } catch (err) {
      console.error(err);
    }
  },

  applyFilter() {
    const search = (document.getElementById('cust-search')?.value || '').toLowerCase();
    const region = document.getElementById('cust-region')?.value || '';
    const industry = document.getElementById('cust-industry')?.value || '';
    const filtered = this.data.filter(
      c =>
        (!search ||
          c.name.toLowerCase().includes(search) ||
          (c.contact_person || '').toLowerCase().includes(search)) &&
        (!region || c.region === region) &&
        (!industry || c.industry === industry)
    );
    this._selectedIds.clear();
    this.renderView(filtered);
  },

  switchView(view) {
    if (view === this._view) return;
    this._view = view;
    localStorage.setItem('customers_view', view);
    document.querySelectorAll('.view-toggle-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.view === view);
    });
    this._selectedIds.clear();
    this.applyFilter();
  },

  renderView(data) {
    if (this._view === 'card') this.renderCards(data);
    else this.renderTable(data);
  },

  // 동일 회사명으로 그룹화 — 대표 1행만 보이고 소속 사람들을 chip으로 표시
  _groupByName(data) {
    const map = new Map();
    data.forEach(c => {
      if (!map.has(c.name)) map.set(c.name, []);
      map.get(c.name).push(c);
    });
    return data.map(c => {
      const group = map.get(c.name);
      // 같은 name 그룹의 첫 번째 행만 노출, 나머지는 hidden 처리
      const isPrimary = group[0].id === c.id;
      return { ...c, _group: group, _isPrimary: isPrimary, _groupCount: group.length };
    });
  },

  renderTable(data) {
    const container = document.getElementById('customers-view-container');
    if (!container) return;
    if (!data.length) {
      const hasFilter =
        document.getElementById('cust-search')?.value ||
        document.getElementById('cust-region')?.value ||
        document.getElementById('cust-industry')?.value;
      const presetKey = hasFilter ? 'filter' : 'customers';
      const html =
        typeof EmptyState !== 'undefined'
          ? `<div class="card"><div class="card-body">${EmptyState.preset(presetKey)}</div></div>`
          : '<div class="card"><div class="card-body"><div class="empty">고객사가 없습니다</div></div></div>';
      container.innerHTML = html;
      if (!hasFilter) {
        document
          .getElementById('empty-customers-new')
          ?.addEventListener('click', () => this.openForm?.());
      }
      return;
    }
    const grouped = this._groupByName(data);
    const visible = grouped.filter(c => c._isPrimary); // 같은 name은 대표 1행만
    container.innerHTML = `
      <div class="card">
        <div class="card-header" style="min-height:42px">
          <div id="cp-toolbar-cust" style="display:none" class="cp-toolbar">
            <span class="cp-sel-count" id="cp-sel-count-cust">0개 선택</span>
            <button class="btn btn-sm" data-action="copy-selected">📋 복사</button>
            <button class="btn btn-sm" data-action="clear-selection">✕ 해제</button>
          </div>
          <div id="cp-toolbar-cust-empty" style="font-size:13px;color:var(--text-2)">
            고객사 목록
          </div>
        </div>
        <div class="card-body no-pad">
          <table class="data-table">
            <thead>
              <tr>
                <th class="cp-check-col">
                  <input type="checkbox" class="cp-checkbox" id="cp-check-all-cust">
                </th>
                <th data-label="customers.customer_name">고객사명</th><th data-label="customers.region">지역</th><th>국가</th><th data-label="customers.industry">산업</th>
                <th data-label="customers.contact_person">담당자</th><th data-label="customers.contact_phone">연락처</th><th data-label="customers.contact_email">이메일</th><th data-label="common.actions">액션</th>
              </tr>
            </thead>
            <tbody>
              ${visible
                .map(
                  c => `
                <tr class="clickable${this._selectedIds.has(c.id) ? ' cp-selected' : ''}"
                    data-cust-id="${c.id}"
                    data-cust-name="${esc(c.name).replace(/"/g, '&quot;')}">
                  <td class="cp-check-col" data-stop-propagation="1">
                    <input type="checkbox" class="cp-checkbox cp-row-check"
                           data-id="${c.id}"
                           ${this._selectedIds.has(c.id) ? 'checked' : ''}>
                  </td>
                  <td>
                    <strong>${esc(c.name)}</strong>
                    ${
                      c._groupCount > 1
                        ? `<span class="badge badge-purple" style="font-size:10px;margin-left:6px"
                           title="동일 회사명 ${c._groupCount}명 등록">👥 ${c._groupCount}</span>`
                        : ''
                    }
                  </td>
                  <td><span class="badge ${c.region === '해외' ? 'badge-purple' : 'badge-blue'}">${esc(c.region)}</span></td>
                  <td>${esc(c.country || '-')}</td>
                  <td>${esc(c.industry || '-')}</td>
                  <td>
                    ${
                      c._groupCount > 1
                        ? `
                      <div data-stop-propagation="1" style="display:flex;flex-wrap:wrap;gap:4px">
                        ${c._group
                          .map(
                            m => `
                          <span class="cust-member-chip" data-cust-id="${m.id}"
                                title="${esc(m.email || '')} ${esc(m.phone || '')}"
                                style="cursor:pointer;font-size:11px;background:var(--surface-2);
                                       padding:2px 8px;border-radius:10px;border:1px solid var(--border)">
                            ${esc(m.contact_person || '담당자 미정')}
                          </span>
                        `
                          )
                          .join('')}
                      </div>
                    `
                        : esc(c.contact_person || '-')
                    }
                  </td>
                  <td class="mono">${esc(c.phone || '-')}</td>
                  <td class="mono" style="font-size:11px">${esc(c.email || '-')}</td>
                  <td data-stop-propagation="1" style="white-space:nowrap">
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                      <button class="ai-gen-btn"
                        data-action="ai-brief" data-feature="ai.intelligence"
                        data-id="${c.id}" data-name="${esc(c.name).replace(/"/g, '&quot;')}">
                        🤖 AI 브리핑
                      </button>
                      ${this._briefBadgeHtml(c.id)}
                    </div>
                  </td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    this._updateSelectionUI();

    // event delegation for table
    container.addEventListener('click', e => {
      const stopEl = e.target.closest('[data-stop-propagation]');
      if (stopEl) {
        e.stopPropagation();
      }

      // toolbar buttons
      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        const action = actionBtn.dataset.action;
        if (action === 'copy-selected') {
          this.copySelected();
          return;
        }
        if (action === 'clear-selection') {
          this._clearSelection();
          return;
        }
        if (action === 'ai-brief') {
          // 통합 모달 열고 핵심 브리핑 탭 자동 활성 + 자동 생성
          const id = parseInt(actionBtn.dataset.id);
          this.showCustomerModal(id);
          setTimeout(() => {
            const briefTab = document.querySelector('.cust-mtab[data-mtab="brief"]');
            if (briefTab) briefTab.click();
            const genBtn = document.getElementById('cm-brief-gen');
            if (genBtn) genBtn.click();
          }, 80);
          return;
        }
      }

      // 멤버 chip 클릭 → 해당 고객 모달
      const chip = e.target.closest('.cust-member-chip');
      if (chip) {
        e.stopPropagation();
        this.showCustomerModal(parseInt(chip.dataset.custId));
        return;
      }

      // checkbox row toggle
      const cb = e.target.closest('.cp-row-check');
      if (cb) {
        this._toggleRow(parseInt(cb.dataset.id), cb.checked);
        return;
      }

      // header checkbox toggle-all
      const hdrCb = e.target.closest('#cp-check-all-cust');
      if (hdrCb) {
        this._toggleAll(hdrCb.checked);
        return;
      }

      // row click → 통합 모달 (정보·수정 + 딜 + 브리핑 + 그룹)
      if (!stopEl) {
        const tr = e.target.closest('tr[data-cust-id]');
        if (tr) this.showCustomerModal(parseInt(tr.dataset.custId));
      }
    });
  },

  renderCards(data) {
    const container = document.getElementById('customers-view-container');
    if (!container) return;
    if (!data.length) {
      const hasFilter =
        document.getElementById('cust-search')?.value ||
        document.getElementById('cust-region')?.value ||
        document.getElementById('cust-industry')?.value;
      const presetKey = hasFilter ? 'filter' : 'customers';
      const html =
        typeof EmptyState !== 'undefined'
          ? `<div class="card"><div class="card-body">${EmptyState.preset(presetKey)}</div></div>`
          : '<div class="card"><div class="card-body"><div class="empty">고객사가 없습니다</div></div></div>';
      container.innerHTML = html;
      if (!hasFilter) {
        document
          .getElementById('empty-customers-new')
          ?.addEventListener('click', () => this.openForm?.());
      }
      return;
    }
    // 회사명 첫글자로 아바타 색상 분산
    const palette = [
      '#1664E5',
      '#E63329',
      '#00A86B',
      '#F59C00',
      '#7C4DFF',
      '#0F7A3F',
      '#B5261E',
      '#1A73E8',
    ];
    const avatarColor = name => palette[(name?.charCodeAt(0) || 0) % palette.length];

    container.innerHTML = `
      <div class="cust-card-grid">
        ${data
          .map(
            c => `
          <div class="cust-card" data-cust-id="${c.id}" data-cust-name="${esc(c.name).replace(/"/g, '&quot;')}">
            <div class="cust-card-header">
              <div class="cust-avatar" style="background:${avatarColor(c.name)}">
                ${esc((c.name || '?').charAt(0))}
              </div>
              <div class="cust-card-title">
                <div class="cust-card-name">${esc(c.name)}</div>
                <div class="cust-card-sub">${esc(c.industry || '미분류')}</div>
              </div>
              <span class="badge ${c.region === '해외' ? 'badge-purple' : 'badge-blue'}">${esc(c.region)}</span>
            </div>
            <div class="cust-card-body">
              <div class="cust-card-row">
                <span class="cust-card-icon">🌐</span>
                <span>${esc(c.country || '-')}</span>
              </div>
              <div class="cust-card-row">
                <span class="cust-card-icon">👤</span>
                <span>${esc(c.contact_person || '담당자 미등록')}</span>
              </div>
              <div class="cust-card-row">
                <span class="cust-card-icon">📞</span>
                <span class="mono">${esc(c.phone || '-')}</span>
              </div>
              <div class="cust-card-row">
                <span class="cust-card-icon">✉️</span>
                <span class="mono" style="font-size:11px">${esc(c.email || '-')}</span>
              </div>
            </div>
            <div class="cust-card-footer" data-stop-propagation="1">
              ${(() => {
                const info = this._getBriefedInfo(c.id);
                return info
                  ? `<div class="brief-done-chip" data-brief-card-id="${c.id}">✅ ${info.label}</div>`
                  : `<div data-brief-card-id="${c.id}" style="display:none"></div>`;
              })()}
              <!-- v6.0.0: 모듈별 카운트 통계 바 (옵션 C) — 클릭 시 모달 해당 탭 -->
              <div class="cust-card-stats" data-stop-propagation="1">
                ${this._renderStatChip(c.id, 'deals',     '🤝', '진행딜', c.active_deals_cnt)}
                ${this._renderStatChip(c.id, 'quotes',    '💰', '견적',   c.quotes_cnt)}
                ${this._renderStatChip(c.id, 'proposals', '📄', '제안',   c.proposals_cnt)}
                ${this._renderStatChip(c.id, 'contracts', '📜', '계약',   c.contracts_cnt)}
              </div>
              <button class="ai-gen-btn" style="width:100%;justify-content:center"
                data-action="ai-brief" data-id="${c.id}" data-name="${esc(c.name).replace(/"/g, '&quot;')}">
                🤖 AI 브리핑 생성
              </button>
            </div>
          </div>
        `
          )
          .join('')}
      </div>
    `;

    // event delegation for cards
    container.addEventListener('click', e => {
      const stopEl = e.target.closest('[data-stop-propagation]');

      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        const action = actionBtn.dataset.action;
        if (action === 'ai-brief') {
          // 통합 모달 열고 핵심 브리핑 탭 자동 활성 + 자동 생성
          const id = parseInt(actionBtn.dataset.id);
          this.showCustomerModal(id);
          setTimeout(() => {
            const briefTab = document.querySelector('.cust-mtab[data-mtab="brief"]');
            if (briefTab) briefTab.click();
            const genBtn = document.getElementById('cm-brief-gen');
            if (genBtn) genBtn.click();
          }, 80);
          return;
        }
        // v6.0.0: 통계 칩 클릭 → 모달 + 해당 탭 자동 활성
        if (action === 'open-tab') {
          const id = parseInt(actionBtn.dataset.id);
          const mtab = actionBtn.dataset.mtab;
          this.showCustomerModal(id);
          setTimeout(() => {
            const tab = document.querySelector(`.cust-mtab[data-mtab="${mtab}"]`);
            if (tab) tab.click();
          }, 80);
          return;
        }
      }

      if (!stopEl) {
        const card = e.target.closest('.cust-card[data-cust-id]');
        if (card) this.showCustomerModal(parseInt(card.dataset.custId));
      }
    });
  },

  // ── v6.0.0: 카드 푸터 통계 칩 (옵션 C) ───────────────────
  // 4개 모듈(딜/견적/제안/계약) 카운트를 한 줄에 표시 + 클릭 시 모달 해당 탭
  // 0건은 회색, N건은 컬러로 강조
  _renderStatChip(custId, mtab, icon, label, count) {
    const n = Number(count) || 0;
    const display = n > 99 ? '99+' : String(n);
    const cls = n > 0 ? 'cust-stat-chip active' : 'cust-stat-chip zero';
    return `<button type="button" class="${cls}"
              data-action="open-tab" data-id="${custId}" data-mtab="${mtab}"
              title="${esc(label)} ${n}건 — 클릭하면 ${esc(label)} 탭으로 이동">
      <span class="stat-icon">${icon}</span>
      <span class="stat-label">${esc(label)}</span>
      <span class="stat-count">${display}</span>
    </button>`;
  },

  // ── AI 브리핑 완료 상태 관리 ─────────────────────────────
  _markBriefed(id) {
    localStorage.setItem(`oci_brief_${id}`, new Date().toISOString());
    this._refreshBriefBadge(id);
  },

  _getBriefedInfo(id) {
    const ts = localStorage.getItem(`oci_brief_${id}`);
    if (!ts) return null;
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return { label: '방금 완료', cls: 'brief-badge-fresh' };
    if (diffMins < 60) return { label: `${diffMins}분 전`, cls: 'brief-badge-fresh' };
    if (diffDays === 0) return { label: '오늘 완료', cls: 'brief-badge-today' };
    if (diffDays === 1) return { label: '어제', cls: 'brief-badge-old' };
    if (diffDays < 7) return { label: `${diffDays}일 전`, cls: 'brief-badge-old' };
    return {
      label: d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }),
      cls: 'brief-badge-old',
    };
  },

  _briefBadgeHtml(id) {
    const info = this._getBriefedInfo(id);
    return info
      ? `<span class="brief-done-badge ${info.cls}" data-brief-id="${id}">✅ ${info.label}</span>`
      : `<span class="brief-done-badge" data-brief-id="${id}" style="display:none"></span>`;
  },

  _refreshBriefBadge(id) {
    const info = this._getBriefedInfo(id);
    // 테이블 배지
    document.querySelectorAll(`[data-brief-id="${id}"]`).forEach(el => {
      if (info) {
        el.className = `brief-done-badge ${info.cls}`;
        el.textContent = `✅ ${info.label}`;
        el.style.display = '';
      }
    });
    // 카드 배지
    document.querySelectorAll(`[data-brief-card-id="${id}"]`).forEach(el => {
      if (info) {
        el.className = 'brief-done-chip';
        el.textContent = `✅ ${info.label}`;
        el.style.display = '';
      }
    });
  },

  // ── Copy & Paste 핵심 메서드 ──────────────────────────────

  _bindPasteShortcut() {
    if (this._pasteHandler) document.removeEventListener('keydown', this._pasteHandler);
    this._pasteHandler = e => {
      if (e.ctrlKey && e.key === 'v') {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        this.openPasteModal();
      }
    };
    document.addEventListener('keydown', this._pasteHandler);
  },

  _toggleAll(checked) {
    document.querySelectorAll('.cp-row-check').forEach(cb => {
      const id = parseInt(cb.dataset.id);
      cb.checked = checked;
      const row = cb.closest('tr');
      if (checked) {
        this._selectedIds.add(id);
        row?.classList.add('cp-selected');
      } else {
        this._selectedIds.delete(id);
        row?.classList.remove('cp-selected');
      }
    });
    this._updateSelectionUI();
  },

  _toggleRow(id, checked) {
    if (checked) this._selectedIds.add(id);
    else this._selectedIds.delete(id);
    const row = document.querySelector(`tr[data-cust-id="${id}"]`);
    row?.classList.toggle('cp-selected', checked);

    // 전체선택 체크박스 동기화
    const allCbs = document.querySelectorAll('.cp-row-check');
    const allChecked = allCbs.length > 0 && [...allCbs].every(cb => cb.checked);
    const headerCb = document.getElementById('cp-check-all-cust');
    if (headerCb) headerCb.checked = allChecked;

    this._updateSelectionUI();
  },

  _clearSelection() {
    this._selectedIds.clear();
    document.querySelectorAll('.cp-row-check').forEach(cb => {
      cb.checked = false;
    });
    document.querySelectorAll('tr.cp-selected').forEach(r => r.classList.remove('cp-selected'));
    const hdr = document.getElementById('cp-check-all-cust');
    if (hdr) hdr.checked = false;
    this._updateSelectionUI();
  },

  _updateSelectionUI() {
    const cnt = this._selectedIds.size;
    const toolbar = document.getElementById('cp-toolbar-cust');
    const empty = document.getElementById('cp-toolbar-cust-empty');
    const countEl = document.getElementById('cp-sel-count-cust');
    if (toolbar) toolbar.style.display = cnt ? 'flex' : 'none';
    if (empty) empty.style.display = cnt ? 'none' : '';
    if (countEl) countEl.textContent = `${cnt}개 선택`;
  },

  copySelected() {
    if (!this._selectedIds.size) {
      Toast.warn('선택된 행이 없습니다');
      return;
    }
    const HEADERS = ['고객사명', '지역', '국가', '산업군', '담당자', '연락처', '이메일', '주소'];
    const rows = this._allData.filter(c => this._selectedIds.has(c.id));
    const lines = [HEADERS.join('\t')];
    rows.forEach(c => {
      lines.push(
        [
          c.name || '',
          c.region || '',
          c.country || '',
          c.industry || '',
          c.contact_person || '',
          c.phone || '',
          c.email || '',
          c.address || '',
        ].join('\t')
      );
    });
    const tsv = lines.join('\n');
    if (navigator.clipboard) {
      navigator.clipboard
        .writeText(tsv)
        .then(() => Toast.success(`${rows.length}개 행이 클립보드에 복사되었습니다`))
        .catch(() => this._copyFallback(tsv));
    } else {
      this._copyFallback(tsv);
    }
  },

  _copyFallback(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    Toast.success('클립보드에 복사되었습니다');
  },

  openPasteModal() {
    this._parsedCustomers = [];
    Modal.open({
      title: '📥 고객사 붙여넣기 등록',
      width: 760,
      body: `
        <p style="font-size:13px;color:var(--text-2);margin-bottom:12px;line-height:1.7">
          Excel·Word·이메일에서 복사한 표 데이터를 붙여넣으세요. (Ctrl+V)<br>
          첫 행이 헤더인 경우 자동으로 컬럼을 매핑합니다.
          <span style="color:var(--text-3);font-size:11px">
            지원 컬럼: 고객사명, 지역, 국가, 산업군, 담당자, 연락처/전화번호, 이메일, 주소
          </span>
        </p>
        <textarea id="cp-paste-area-cust" class="cp-paste-textarea" rows="8"
          placeholder="여기에 붙여넣기 (Ctrl+V)…"></textarea>
        <div id="cp-preview-cust" style="margin-top:14px"></div>
      `,
      footer: `
        <button class="btn btn-ghost" id="cp-paste-close-btn">닫기</button>
        <button class="btn btn-primary" id="cp-import-btn-cust" style="display:none">
          ✅ 등록하기
        </button>
      `,
      bind: {
        '#cp-paste-close-btn': () => Modal.close(),
        '#cp-import-btn-cust': () => this._importParsed(),
      },
    });

    // 붙여넣기 이벤트
    setTimeout(() => {
      const ta = document.getElementById('cp-paste-area-cust');
      if (ta) {
        ta.focus();
        ta.addEventListener('paste', e => {
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain');
          ta.value = text;
          this._parsePasteInput(text);
        });
        ta.addEventListener('input', () => this._parsePasteInput(ta.value));
      }
    }, 100);
  },

  _parsePasteInput(raw) {
    const previewEl = document.getElementById('cp-preview-cust');
    const importBtn = document.getElementById('cp-import-btn-cust');
    if (!raw.trim()) {
      if (previewEl) previewEl.innerHTML = '';
      if (importBtn) importBtn.style.display = 'none';
      return;
    }

    const lines = raw
      .trim()
      .split('\n')
      .map(l => l.trimEnd());
    const sep = lines[0].includes('\t') ? '\t' : ',';
    const rows = lines.map(l => l.split(sep).map(c => c.trim().replace(/^"|"$/g, '')));

    // 헤더 매핑 (대소문자·공백 무시)
    const COL_FIELD = {
      고객사명: 'name',
      고객사: 'name',
      회사명: 'name',
      company: 'name',
      지역: 'region',
      국가: 'country',
      country: 'country',
      산업군: 'industry',
      산업: 'industry',
      industry: 'industry',
      담당자: 'contact_person',
      담당자명: 'contact_person',
      연락처: 'phone',
      전화번호: 'phone',
      전화: 'phone',
      phone: 'phone',
      이메일: 'email',
      email: 'email',
      주소: 'address',
      address: 'address',
    };

    let headerRow = null;
    let dataStart = 0;
    const firstNorm = rows[0].map(h => h.toLowerCase().replace(/\s/g, ''));
    if (firstNorm.some(h => COL_FIELD[h] || COL_FIELD[h.replace(/[^a-z가-힣]/g, '')])) {
      headerRow = firstNorm;
      dataStart = 1;
    }

    const parsed = [];
    for (let i = dataStart; i < rows.length; i++) {
      const r = rows[i];
      if (r.every(c => !c)) continue;
      const obj = {};
      if (headerRow) {
        headerRow.forEach((h, ci) => {
          const field = COL_FIELD[h] || COL_FIELD[h.replace(/[^a-z가-힣]/g, '')];
          if (field) obj[field] = r[ci] || '';
        });
      } else {
        // 헤더 없을 때 순서 기본 매핑: 고객사명, 지역, 국가, 산업군, 담당자, 연락처, 이메일, 주소
        const DEF = [
          'name',
          'region',
          'country',
          'industry',
          'contact_person',
          'phone',
          'email',
          'address',
        ];
        DEF.forEach((f, ci) => {
          obj[f] = r[ci] || '';
        });
      }
      parsed.push(obj);
    }

    this._parsedCustomers = parsed;

    if (!parsed.length) {
      if (previewEl)
        previewEl.innerHTML =
          '<div style="color:var(--oci-red);font-size:12px">파싱된 데이터가 없습니다</div>';
      if (importBtn) importBtn.style.display = 'none';
      return;
    }

    // 미리보기 테이블
    const REGION_VALS = new Set(['국내', '해외']);
    const previewRows = parsed
      .map(p => {
        const region = REGION_VALS.has(p.region) ? p.region : p.region ? p.region : '국내';
        const warn = !p.name;
        return `<tr class="${warn ? 'cp-row-warn' : ''}">
        <td>${esc(p.name || '')} ${warn ? '<span style="color:var(--oci-red);font-size:10px">필수</span>' : ''}</td>
        <td>${esc(region)}</td>
        <td>${esc(p.country || '')}</td>
        <td>${esc(p.industry || '')}</td>
        <td>${esc(p.contact_person || '')}</td>
        <td class="mono">${esc(p.phone || '')}</td>
        <td class="mono" style="font-size:11px">${esc(p.email || '')}</td>
        <td style="font-size:11px">${esc(p.address || '')}</td>
      </tr>`;
      })
      .join('');

    const validCount = parsed.filter(p => p.name).length;
    if (previewEl)
      previewEl.innerHTML = `
      <div style="font-size:12px;color:var(--text-2);margin-bottom:8px">
        미리보기 — <strong>${validCount}개</strong> 등록 가능
        ${validCount < parsed.length ? `<span style="color:var(--oci-red)">(${parsed.length - validCount}개 고객사명 없음 — 제외됨)</span>` : ''}
      </div>
      <div style="overflow-x:auto;max-height:260px;overflow-y:auto">
        <table class="data-table" style="font-size:12px">
          <thead><tr>
            <th>고객사명</th><th>지역</th><th>국가</th><th>산업군</th>
            <th>담당자</th><th>연락처</th><th>이메일</th><th>주소</th>
          </tr></thead>
          <tbody>${previewRows}</tbody>
        </table>
      </div>`;

    if (importBtn) importBtn.style.display = validCount ? '' : 'none';
  },

  async _importParsed() {
    const valid = this._parsedCustomers.filter(c => c.name);
    if (!valid.length) {
      Toast.warn('등록 가능한 데이터가 없습니다');
      return;
    }

    const btn = document.getElementById('cp-import-btn-cust');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '등록 중...';
    }

    try {
      const res = await API.post('/customers/bulk', { customers: valid });
      Modal.close();

      const parts = [];
      if (res.inserted) parts.push(`${res.inserted}개 등록 완료`);
      if (res.duplicates) parts.push(`${res.duplicates}개 중복 건너뜀`);
      const failed = (res.errors || []).filter(e => !e.reason?.startsWith('중복')).length;
      if (failed) parts.push(`${failed}개 오류`);

      if (res.inserted) Toast.success(parts.join(' · '));
      else Toast.warn(parts.join(' · ') || '등록된 항목이 없습니다');

      await this.loadData();
      await App.refreshCommon();
    } catch {
      Toast.error('등록 중 오류가 발생했습니다');
      if (btn) {
        btn.disabled = false;
        btn.textContent = '✅ 등록하기';
      }
    }
  },

  // ── 엑셀 내보내기 ────────────────────────────────────────────
  exportExcel() {
    const path = this._buildExportPath();
    API.downloadExport(path, '고객사_' + new Date().toISOString().slice(0, 10), 'xlsx');
  },

  _buildExportPath() {
    const search = document.getElementById('cust-search')?.value || '';
    const region = document.getElementById('cust-region')?.value || '';
    const industry = document.getElementById('cust-industry')?.value || '';
    const qs = new URLSearchParams();
    if (search) qs.set('search', search);
    if (region) qs.set('region', region);
    if (industry) qs.set('industry', industry);
    return '/customers/export' + (qs.toString() ? '?' + qs.toString() : '');
  },

  _openExportMenu(triggerEl) {
    if (typeof ExportMenu === 'undefined') return this.exportExcel();
    ExportMenu.open(
      triggerEl,
      this._buildExportPath(),
      '고객사_' + new Date().toISOString().slice(0, 10)
    );
  },

  // ── 엑셀 가져오기 ────────────────────────────────────────────
  async importExcel(input) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    const token = localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token');
    const headers = {};
    const uid = localStorage.getItem('current_user_id');
    if (uid) headers['X-User-Id'] = uid;
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const res = await fetch('/api/customers/import', { method: 'POST', headers, body: fd });
      const data = await res.json();
      if (data.success) {
        const parts = [];
        if (data.inserted) parts.push(`${data.inserted}개 등록 완료`);
        if (data.duplicates) parts.push(`${data.duplicates}개 중복 건너뜀`);
        const failed = (data.errors || []).filter(e => !e.reason?.startsWith('중복')).length;
        if (failed) parts.push(`${failed}개 오류`);
        if (data.inserted) Toast.success(parts.join(' · '));
        else Toast.warn(parts.join(' · ') || '등록된 항목이 없습니다');
        await this.loadData();
        await App.refreshCommon();
      } else {
        Toast.error(data.message || '가져오기 실패');
      }
    } catch (e) {
      Toast.error('서버 오류: ' + (e.message || ''));
    }
  },

  // ── [통합] 고객 상세 모달 — 정보/수정 + 관련 딜 + 핵심 브리핑 + 그룹 ──
  showCustomerModal(id) {
    const cust = this._allData.find(c => c.id === id) || this.data.find(c => c.id === id);
    if (!cust) {
      Toast.error('고객 정보를 찾을 수 없습니다');
      return;
    }

    Modal.open({
      title: `🏢 ${cust.name}`,
      width: 1080,
      body: `
        <div class="cust-modal-tabs" style="display:flex;gap:0;border-bottom:2px solid var(--border);margin:-8px -8px 16px">
          <button class="cust-mtab active" data-mtab="info"
            style="padding:10px 18px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:500;
                   border-bottom:2px solid var(--oci-red);margin-bottom:-2px;color:var(--oci-red)">
            📋 정보·수정
          </button>
          <button class="cust-mtab" data-mtab="deals"
            style="padding:10px 18px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:500;
                   border-bottom:2px solid transparent;margin-bottom:-2px;color:var(--text-3)">
            🤝 관련 딜 <span id="cm-deals-cnt" class="badge badge-blue" style="font-size:10px">…</span>
          </button>
          <button class="cust-mtab" data-mtab="brief"
            style="padding:10px 18px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:500;
                   border-bottom:2px solid transparent;margin-bottom:-2px;color:var(--text-3)">
            ✨ 핵심 브리핑
          </button>
          <button class="cust-mtab" data-mtab="group"
            style="padding:10px 18px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:500;
                   border-bottom:2px solid transparent;margin-bottom:-2px;color:var(--text-3)">
            👥 소속 고객 <span id="cm-group-cnt" class="badge badge-blue" style="font-size:10px">…</span>
          </button>
          <!-- v6.0.0: 견적 탭 (LinkedQuotes) — crm.quotes off 시 자동 숨김 -->
          <button class="cust-mtab" data-mtab="quotes" data-feature="crm.quotes"
            style="padding:10px 18px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:500;
                   border-bottom:2px solid transparent;margin-bottom:-2px;color:var(--text-3)">
            💰 견적 <span id="cm-quotes-cnt" class="badge badge-blue" style="font-size:10px">…</span>
          </button>
          <!-- v6.0.0: 제안 탭 (LinkedProposals) — crm.proposals off 시 자동 숨김 -->
          <button class="cust-mtab" data-mtab="proposals" data-feature="crm.proposals"
            style="padding:10px 18px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:500;
                   border-bottom:2px solid transparent;margin-bottom:-2px;color:var(--text-3)">
            📄 제안 <span id="cm-proposals-cnt" class="badge badge-blue" style="font-size:10px">…</span>
          </button>
          <!-- v6.0.0 Phase B: 계약 탭 (LinkedContracts 컴포넌트 활용) — crm.contracts off 시 자동 숨김 -->
          <button class="cust-mtab" data-mtab="contracts" data-feature="crm.contracts"
            style="padding:10px 18px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:500;
                   border-bottom:2px solid transparent;margin-bottom:-2px;color:var(--text-3)">
            📜 계약 <span id="cm-contracts-cnt" class="badge badge-blue" style="font-size:10px">…</span>
          </button>
          <!-- v6.0.0: 고객지원 탭 (placeholder) — crm.support off 시 자동 숨김 -->
          <button class="cust-mtab" data-mtab="support" data-feature="crm.support"
            style="padding:10px 18px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:500;
                   border-bottom:2px solid transparent;margin-bottom:-2px;color:var(--text-3)">
            🎫 고객지원
          </button>
        </div>

        <!-- ⚠️ 탭 전환 시 모달 크기 변동 방지: 고정 높이 + 내부 스크롤 -->
        <div id="cm-tab-wrap" style="min-height:720px;max-height:720px;overflow-y:auto;padding-right:4px">

        <!-- 정보·수정 탭 -->
        <div id="cm-tab-info">
          <form id="cm-edit-form" class="form-grid">
            <div class="form-row-2">
              <div class="form-row">
                <label class="form-label">고객사명 <span style="color:var(--oci-red)">*</span></label>
                <input class="form-input" name="name" required value="${esc(cust.name || '')}">
              </div>
              <div class="form-row">
                <label class="form-label">산업군</label>
                <input class="form-input" name="industry" value="${esc(cust.industry || '')}">
              </div>
            </div>
            <div class="form-row-3">
              <div class="form-row">
                <label class="form-label">지역</label>
                <select class="form-input" name="region">
                  <option value="국내" ${cust.region === '국내' ? 'selected' : ''}>국내</option>
                  <option value="해외" ${cust.region === '해외' ? 'selected' : ''}>해외</option>
                </select>
              </div>
              <div class="form-row">
                <label class="form-label">국가</label>
                <input class="form-input" name="country" value="${esc(cust.country || '')}">
              </div>
              <div class="form-row">
                <label class="form-label">담당자</label>
                <input class="form-input" name="contact_person" value="${esc(cust.contact_person || '')}">
              </div>
            </div>
            <div class="form-row-2">
              <div class="form-row">
                <label class="form-label">연락처</label>
                <input class="form-input" name="phone" value="${esc(cust.phone || '')}">
              </div>
              <div class="form-row">
                <label class="form-label">이메일</label>
                <input class="form-input" name="email" type="email" value="${esc(cust.email || '')}">
              </div>
            </div>
            <div class="form-row">
              <label class="form-label">주소</label>
              <div style="display:flex;gap:6px">
                <input class="form-input" name="address" id="cm-addr-input"
                       value="${esc(cust.address || '')}" style="flex:1" placeholder="주소 검색 버튼을 눌러 검색하세요">
                <button type="button" class="btn btn-ghost btn-sm" id="cm-addr-search"
                        style="white-space:nowrap">🔍 주소 검색</button>
              </div>
            </div>
            <div class="form-row">
              <label class="form-label">위치 (카카오맵)</label>
              <div id="cm-kakao-map"
                   style="width:100%;height:280px;border:1px solid var(--border);border-radius:6px;
                          background:var(--surface-2);display:flex;align-items:center;justify-content:center;
                          color:var(--text-3);font-size:13px">
                지도 로딩 중...
              </div>
            </div>
          </form>

          <!-- 📧 Gmail 대화 — lazy load -->
          <div class="card" style="margin-top:16px;margin-bottom:0">
            <div class="card-header">
              <div class="card-title">📧 최근 Gmail 대화</div>
              <button class="btn btn-ghost btn-sm" id="cust-gmail-refresh" title="새로고침" style="display:none">🔄</button>
            </div>
            <div class="card-body no-pad" id="cust-gmail-body">
              <div class="loading" style="padding:14px;text-align:center;font-size:12px;color:var(--text-3)">Gmail 대화 로딩 중...</div>
            </div>
          </div>

          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
            <button class="btn btn-ghost" id="cm-delete-btn" style="margin-right:auto;color:var(--oci-red)">🗑 삭제</button>
            <button class="btn btn-ghost" id="cm-email-btn" title="이메일 보내기">✉️ 이메일</button>
            <button class="btn btn-ghost" id="cm-cancel-btn">취소</button>
            <button class="btn btn-primary" id="cm-save-btn">💾 저장</button>
          </div>
        </div>

        <!-- 관련 딜 탭 -->
        <div id="cm-tab-deals" style="display:none">
          <div id="cm-deals-list"><div class="loading" style="padding:30px;text-align:center">불러오는 중...</div></div>
        </div>

        <!-- 핵심 브리핑 탭 -->
        <div id="cm-tab-brief" style="display:none">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <div style="font-size:12px;color:var(--text-3)">AI가 영업 이력·활동을 분석해 핵심만 추출합니다 (약 5초)</div>
            <button class="ai-gen-btn btn-sm" id="cm-brief-gen">🤖 브리핑 생성</button>
          </div>
          <div id="cm-brief-content" style="min-height:120px">
            <div class="empty" style="padding:30px;text-align:center;color:var(--text-3);font-size:13px">
              위 버튼을 눌러 핵심 브리핑을 생성하세요.
            </div>
          </div>
        </div>

        <!-- 소속 고객 탭 -->
        <div id="cm-tab-group" style="display:none">
          <div id="cm-group-list"><div class="loading" style="padding:30px;text-align:center">불러오는 중...</div></div>
        </div>

        <!-- v6.0.0: 견적 탭 (LinkedQuotes) -->
        <div id="cm-tab-quotes" style="display:none">
          <div id="lq-customer"><div class="loading" style="padding:30px;text-align:center">불러오는 중...</div></div>
        </div>

        <!-- v6.0.0: 제안 탭 (LinkedProposals) -->
        <div id="cm-tab-proposals" style="display:none">
          <div id="lp-customer"><div class="loading" style="padding:30px;text-align:center">불러오는 중...</div></div>
        </div>

        <!-- v6.0.0 Phase B: 계약 탭 -->
        <div id="cm-tab-contracts" style="display:none">
          <div id="lc-customer"><div class="loading" style="padding:30px;text-align:center">불러오는 중...</div></div>
        </div>

        <!-- v6.0.0: 고객지원 탭 (placeholder — 향후 티켓/문의 연동) -->
        <div id="cm-tab-support" style="display:none">
          <div style="padding:40px 24px;text-align:center;color:var(--text-3);background:#fafafa;border-radius:8px;border:1px dashed var(--border)">
            <div style="font-size:42px;margin-bottom:12px;opacity:.7">🎫</div>
            <div style="font-size:14px;font-weight:600;color:var(--text-2);margin-bottom:6px">고객지원 모듈 준비 중</div>
            <div style="font-size:12px">티켓/문의 연동은 다음 단계에서 추가될 예정입니다.</div>
          </div>
        </div>

        </div><!-- /cm-tab-wrap : 고정 높이 wrapper 닫기 -->
      `,
    });

    // 탭 전환
    document.querySelectorAll('.cust-mtab').forEach(t => {
      t.addEventListener('click', () => {
        document.querySelectorAll('.cust-mtab').forEach(b => {
          b.classList.remove('active');
          b.style.color = 'var(--text-3)';
          b.style.borderBottomColor = 'transparent';
        });
        t.classList.add('active');
        t.style.color = 'var(--oci-red)';
        t.style.borderBottomColor = 'var(--oci-red)';
        ['info', 'deals', 'brief', 'group', 'quotes', 'proposals', 'contracts', 'support'].forEach(k => {
          const el = document.getElementById('cm-tab-' + k);
          if (el) el.style.display = k === t.dataset.mtab ? '' : 'none';
        });
      });
    });

    // 저장 / 취소 / 삭제
    document.getElementById('cm-cancel-btn').addEventListener('click', () => Modal.close());
    document
      .getElementById('cm-save-btn')
      .addEventListener('click', () => this._saveCustomerEdit(id));
    document
      .getElementById('cm-delete-btn')
      .addEventListener('click', () => this._deleteCustomer(id, cust.name));
    document.getElementById('cm-email-btn')?.addEventListener('click', () => {
      if (typeof Email !== 'undefined') {
        Email.open({
          customer: cust,
          defaultCategory: 'customer',
        });
      }
    });

    // 브리핑 생성 버튼
    document
      .getElementById('cm-brief-gen')
      .addEventListener('click', () => this._generateBrief(id));

    // 카카오 주소 검색 + 지도
    document
      .getElementById('cm-addr-search')
      .addEventListener('click', () => this._openPostcodeSearch());
    this._initKakaoMap(cust.address);

    // 📧 Gmail 대화 — lazy load
    this._loadGmailForCustomer(id);

    // 비동기로 딜/그룹/브리핑 캐시 로드
    this._loadModalDeals(id);
    this._loadModalGroup(id);
    this._loadCachedBrief(id); // ← 저장된 최신 브리핑 자동 표시

    // v6.0.0 Step 2 + Phase B: 연결된 계약 목록 (best-effort)
    // Phase B: 탭 카운트 배지 갱신 (#cm-contracts-cnt)
    if (typeof LinkedContracts !== 'undefined') {
      LinkedContracts.render('#lc-customer', 'customer', id)
        .then(result => {
          const badge = document.getElementById('cm-contracts-cnt');
          if (badge) badge.textContent = String(result?.count || 0);
        })
        .catch(() => {
          const badge = document.getElementById('cm-contracts-cnt');
          if (badge) badge.textContent = '0';
        });
    }

    // v6.0.0: 연결된 견적 목록 + 카운트 배지 (#cm-quotes-cnt)
    if (typeof LinkedQuotes !== 'undefined') {
      LinkedQuotes.render('#lq-customer', 'customer', id)
        .then(result => {
          const badge = document.getElementById('cm-quotes-cnt');
          if (badge) badge.textContent = String(result?.count || 0);
        })
        .catch(() => {
          const badge = document.getElementById('cm-quotes-cnt');
          if (badge) badge.textContent = '0';
        });
    }

    // v6.0.0: 연결된 제안 목록 + 카운트 배지 (#cm-proposals-cnt)
    if (typeof LinkedProposals !== 'undefined') {
      LinkedProposals.render('#lp-customer', 'customer', id)
        .then(result => {
          const badge = document.getElementById('cm-proposals-cnt');
          if (badge) badge.textContent = String(result?.count || 0);
        })
        .catch(() => {
          const badge = document.getElementById('cm-proposals-cnt');
          if (badge) badge.textContent = '0';
        });
    }
  },

  // ── 카카오 우편번호 SDK 동적 로드 ─────────────────────────
  _loadDaumPostcode() {
    return new Promise((resolve, reject) => {
      if (window.daum && window.daum.Postcode) return resolve();
      const s = document.createElement('script');
      s.src = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('우편번호 서비스 로드 실패'));
      document.head.appendChild(s);
    });
  },

  async _openPostcodeSearch() {
    try {
      await this._loadDaumPostcode();

      // ⚠️ open() 새 창 방식은 우리 서버의 CSP frame-ancestors='none' 에 막힘
      //    → embed() 로 직접 div 안에 띄움
      // 기존 오버레이 제거
      document.getElementById('cm-postcode-overlay')?.remove();

      const overlay = document.createElement('div');
      overlay.id = 'cm-postcode-overlay';
      overlay.style.cssText = `
        position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:10010;
        display:flex; align-items:center; justify-content:center;`;
      overlay.innerHTML = `
        <div style="background:var(--surface); color:var(--text-1); width:min(540px,92vw); height:min(560px,86vh);
                    border-radius:8px; box-shadow:0 12px 40px rgba(0,0,0,.3); overflow:hidden;
                    display:flex; flex-direction:column">
          <div style="display:flex; justify-content:space-between; align-items:center;
                      padding:10px 14px; border-bottom:1px solid var(--border); background:var(--surface-2)">
            <div style="font-size:14px; font-weight:600">📮 주소 검색</div>
            <button id="cm-postcode-close" style="border:none; background:none; cursor:pointer;
                    font-size:18px; color:var(--text-3)">×</button>
          </div>
          <div id="cm-postcode-box" style="flex:1; overflow:auto"></div>
        </div>`;
      document.body.appendChild(overlay);

      const close = () => overlay.remove();
      overlay.querySelector('#cm-postcode-close').addEventListener('click', close);
      overlay.addEventListener('click', e => {
        if (e.target === overlay) close();
      });

      new daum.Postcode({
        oncomplete: data => {
          const addr = data.roadAddress || data.jibunAddress || data.address || '';
          const extra = data.buildingName ? ' (' + data.buildingName + ')' : '';
          const full = addr + extra;
          const input = document.getElementById('cm-addr-input');
          if (input) input.value = full;
          close();
          this._renderKakaoMap(full);
        },
        width: '100%',
        height: '100%',
      }).embed(overlay.querySelector('#cm-postcode-box'));
    } catch (e) {
      Toast.error(e.message);
    }
  },

  // ── 카카오맵 SDK 동적 로드 (Geocoder 포함) ────────────────
  _loadKakaoMapSDK() {
    if (this._kakaoMapPromise) return this._kakaoMapPromise;
    this._kakaoMapPromise = (async () => {
      // 공개 설정에서 키 조회
      let key = window.__OCI_KAKAO_KEY__;
      if (key === undefined) {
        try {
          const r = await fetch('/api/config/public');
          const j = await r.json();
          key = j?.data?.kakaoMapKey || '';
          window.__OCI_KAKAO_KEY__ = key;
        } catch {
          key = '';
        }
      }
      if (!key) throw new Error('NO_KEY');

      if (window.kakao && window.kakao.maps && window.kakao.maps.services) return window.kakao;

      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src =
          'https://dapi.kakao.com/v2/maps/sdk.js?appkey=' +
          encodeURIComponent(key) +
          '&libraries=services&autoload=false';
        s.onload = () => window.kakao.maps.load(() => resolve(window.kakao));
        s.onerror = () => reject(new Error('카카오맵 SDK 로드 실패'));
        document.head.appendChild(s);
      });
    })();
    return this._kakaoMapPromise;
  },

  // 지도에 마커+InfoWindow 렌더
  _renderMapAt(wrap, kakao, lat, lng, originalAddr) {
    const coords = new kakao.maps.LatLng(lat, lng);
    wrap.innerHTML = '';
    const map = new kakao.maps.Map(wrap, { center: coords, level: 3 });
    const marker = new kakao.maps.Marker({ position: coords, map });
    new kakao.maps.InfoWindow({
      content: `<div style="padding:6px 10px;font-size:12px;white-space:nowrap">${String(originalAddr).replace(/</g, '&lt;')}</div>`,
    }).open(map, marker);
  },

  _renderMapFailFallback(wrap, address) {
    wrap.innerHTML = `<div style="text-align:center;color:var(--text-3);font-size:13px;padding:30px">
      주소를 좌표로 변환하지 못했습니다.<br>
      <a href="https://map.kakao.com/link/search/${encodeURIComponent(address)}"
         target="_blank" rel="noopener" style="color:var(--oci-blue);text-decoration:underline;margin-top:8px;display:inline-block">
        🗺 카카오맵에서 보기 →
      </a>
    </div>`;
  },

  // ── 📧 Gmail 대화 lazy load (App._renderGmailCard 재사용) ──
  async _loadGmailForCustomer(customerId) {
    const body = document.getElementById('cust-gmail-body');
    if (!body || typeof App === 'undefined' || !App._renderGmailCard) return;
    try {
      const r = await API.gmail.matchCustomer(customerId, 8);
      App._renderGmailCard(body, r, () => this._loadGmailForCustomer(customerId));
    } catch (err) {
      App._renderGmailCard(
        body,
        {
          success: false,
          error: err.message || 'Gmail 조회 실패',
          code: err.code,
          feature: err.feature,
        },
        () => this._loadGmailForCustomer(customerId)
      );
    }
  },

  async _initKakaoMap(address) {
    const wrap = document.getElementById('cm-kakao-map');
    if (!wrap) return;
    if (!address) {
      wrap.innerHTML = `<div style="text-align:center;color:var(--text-4);font-size:13px">
        주소가 등록되지 않았습니다.<br><span style="font-size:11px">위의 🔍 주소 검색 버튼으로 등록하세요.</span>
      </div>`;
      return;
    }
    await this._renderKakaoMap(address);
  },

  // 주소를 Geocoder가 인식하기 쉽도록 정규화
  // - 앞의 5자리 우편번호 제거 ("06258 서울시..." → "서울시...")
  // - 괄호 안 부가정보 제거 ("(도곡동)", "(부영빌딩 6층)")
  // - 층/호수 등 끝 부분 제거 fallback 후보 생성
  _normalizeAddress(addr) {
    if (!addr) return [];
    let a = String(addr).trim();
    // 우편번호 (5자리)
    a = a.replace(/^\d{5}\s+/, '');
    // 괄호 안 모든 내용
    const noParen = a
      .replace(/\([^)]*\)/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    // 끝에 붙은 층/호/동 (예: "...빌딩 6층")
    const noFloor = noParen.replace(/\s+\S+(층|호|동)\s*$/, '').trim();
    // 마지막 토큰 1개씩 제거한 후보들
    const tokens = noFloor.split(/\s+/);
    const candidates = [a, noParen, noFloor];
    for (let i = tokens.length; i >= 3; i--) {
      candidates.push(tokens.slice(0, i).join(' '));
    }
    // 중복 제거 + 빈값 제외
    return [...new Set(candidates)].filter(Boolean);
  },

  async _renderKakaoMap(address) {
    const wrap = document.getElementById('cm-kakao-map');
    if (!wrap) return;
    wrap.innerHTML = '<div style="color:var(--text-3);font-size:13px">지도 로딩 중...</div>';
    try {
      const kakao = await this._loadKakaoMapSDK();
      const geocoder = new kakao.maps.services.Geocoder();
      const candidates = this._normalizeAddress(address);

      // 후보 주소들을 순차적으로 시도 (Geocoder가 첫 매칭 반환)
      const trySearch = idx => {
        if (idx >= candidates.length) {
          // 모든 후보 실패 → 키워드 검색 fallback (Places)
          if (kakao.maps.services.Places) {
            const places = new kakao.maps.services.Places();
            places.keywordSearch(candidates[0], (result, status) => {
              if (status === kakao.maps.services.Status.OK && result.length) {
                this._renderMapAt(
                  wrap,
                  kakao,
                  parseFloat(result[0].y),
                  parseFloat(result[0].x),
                  address
                );
              } else {
                this._renderMapFailFallback(wrap, address);
              }
            });
          } else {
            this._renderMapFailFallback(wrap, address);
          }
          return;
        }
        geocoder.addressSearch(candidates[idx], (result, status) => {
          if (status === kakao.maps.services.Status.OK && result.length) {
            this._renderMapAt(
              wrap,
              kakao,
              parseFloat(result[0].y),
              parseFloat(result[0].x),
              address
            );
          } else {
            trySearch(idx + 1);
          }
        });
      };
      trySearch(0);
    } catch (e) {
      // 키 없음 → 외부 링크 placeholder
      const fallback =
        e.message === 'NO_KEY'
          ? `<div style="text-align:center;font-size:13px;color:var(--text-3);padding:20px">
            <div style="margin-bottom:8px">🗺 카카오맵 키가 설정되지 않았습니다</div>
            <a href="https://map.kakao.com/link/search/${encodeURIComponent(address)}"
               target="_blank" rel="noopener" style="color:var(--oci-blue);text-decoration:underline">
              카카오맵에서 "${address.replace(/</g, '&lt;').slice(0, 40)}" 보기 →
            </a>
            <div style="margin-top:8px;font-size:11px;color:var(--text-4)">
              .env 파일의 KAKAO_MAP_KEY 를 설정하면 임베드 지도가 표시됩니다
            </div>
          </div>`
          : `<div style="color:var(--oci-red);padding:10px;font-size:13px">지도 오류: ${e.message}</div>`;
      wrap.innerHTML = fallback;
    }
  },

  async _loadModalDeals(id) {
    const wrap = document.getElementById('cm-deals-list');
    try {
      const r = await API.get(`/customers/${id}/deals`);
      const deals = r.data || [];
      document.getElementById('cm-deals-cnt').textContent = deals.length;
      if (!deals.length) {
        wrap.innerHTML = `<div class="empty" style="padding:30px;text-align:center;color:var(--text-3);font-size:13px">관련 딜이 없습니다</div>`;
        return;
      }
      const stageMap = {
        lead: '🔍 리드',
        review: '📋 검토',
        proposal: '📝 제안',
        bidding: '⚔️ 입찰',
        negotiation: '🤝 협상',
        won: '✅ 수주',
        lost: '❌ 실주',
        dropped: '⬇️ 드롭',
      };
      wrap.innerHTML = `
        <table class="data-table" style="font-size:12px">
          <thead><tr>
            <th>프로젝트</th><th>유형</th><th>단계</th>
            <th class="text-right">예상 금액</th><th>최근 업데이트</th>
          </tr></thead>
          <tbody>
            ${deals
              .map(
                d => `
              <tr class="cm-deal-row" data-lead-id="${d.id}" style="cursor:pointer">
                <td><strong>${esc(d.project_name || '-')}</strong></td>
                <td>${esc(d.business_type || '-')}</td>
                <td><span class="badge">${stageMap[d.stage] || esc(d.stage || '-')}</span></td>
                <td class="text-right mono">${d.expected_amount ? Number(d.expected_amount).toLocaleString() + ' ' + (d.currency || '') : '-'}</td>
                <td style="font-size:11px;color:var(--text-3)">${d.updated_at ? new Date(d.updated_at).toLocaleDateString('ko-KR') : '-'}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      `;
      wrap.querySelectorAll('.cm-deal-row').forEach(tr => {
        tr.addEventListener('click', () => {
          const leadId = parseInt(tr.dataset.leadId);
          if (!leadId) return;
          Modal.close();
          // 파이프라인으로 이동 후 해당 리드 상세 모달 열기
          // (WebSocket stage_change 핸들러와 동일 패턴 — app.js 의 검증된 동작)
          setTimeout(() => {
            App.navigate('pipeline').then(() => {
              App.openLeadDetail(leadId);
            });
          }, 100);
        });
      });
    } catch (e) {
      wrap.innerHTML = `<div class="empty" style="color:var(--oci-red);padding:20px">로드 실패: ${esc(e.message)}</div>`;
    }
  },

  async _loadModalGroup(id) {
    const wrap = document.getElementById('cm-group-list');
    try {
      const r = await API.get(`/customers/${id}/group`);
      const members = r.data || [];
      document.getElementById('cm-group-cnt').textContent = members.length;
      if (members.length <= 1) {
        wrap.innerHTML = `<div class="empty" style="padding:30px;text-align:center;color:var(--text-3);font-size:13px">
          이 회사명으로 등록된 고객은 1명입니다 (현재 표시 중).
        </div>`;
        return;
      }
      wrap.innerHTML = `
        <div style="font-size:12px;color:var(--text-3);margin-bottom:10px">
          동일 회사명으로 ${members.length}명이 등록되어 있습니다. 클릭하면 해당 고객 모달로 이동합니다.
        </div>
        <table class="data-table" style="font-size:12px">
          <thead><tr>
            <th>담당자</th><th>이메일</th><th>연락처</th><th>지역</th><th>산업</th>
          </tr></thead>
          <tbody>
            ${members
              .map(
                m => `
              <tr class="cm-grp-row ${m.id === id ? 'cp-selected' : ''}" data-cust-id="${m.id}" style="cursor:pointer">
                <td><strong>${esc(m.contact_person || '-')}</strong>${m.id === id ? ' <span class="badge badge-blue" style="font-size:10px">현재</span>' : ''}</td>
                <td class="mono" style="font-size:11px">${esc(m.email || '-')}</td>
                <td class="mono">${esc(m.phone || '-')}</td>
                <td>${esc(m.region || '-')}</td>
                <td>${esc(m.industry || '-')}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      `;
      wrap.querySelectorAll('.cm-grp-row').forEach(tr => {
        tr.addEventListener('click', () => {
          const targetId = parseInt(tr.dataset.custId);
          if (targetId === id) return;
          Modal.close();
          setTimeout(() => this.showCustomerModal(targetId), 100);
        });
      });
    } catch (e) {
      wrap.innerHTML = `<div class="empty" style="color:var(--oci-red);padding:20px">로드 실패: ${esc(e.message)}</div>`;
    }
  },

  // 모달 열림 시 — DB 캐시된 최신 브리핑 자동 표시 (없으면 안내 유지)
  async _loadCachedBrief(id) {
    try {
      const r = await API.get(`/customers/${id}/brief`);
      if (r.data) {
        this._renderBriefData(id, r.data);
      }
    } catch (_) {
      /* 캐시 없으면 무시 */
    }
  },

  // 브리핑 데이터 → 화면 렌더 (캐시 로드, 신규 생성 공통)
  _renderBriefData(id, d) {
    const wrap = document.getElementById('cm-brief-content');
    if (!wrap) return;
    const s = d.stats || {};
    const genAtFmt = d.generated_at ? this._fmtDateTime(d.generated_at) : '';
    const genBy = d.generated_by_name || '';
    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-size:11px;color:var(--text-3)">
        <span>${d.cached ? '🗂 저장된 브리핑' : '✨ 신규 생성됨'}</span>
        ${
          genAtFmt
            ? `<span title="${esc(new Date(d.generated_at).toLocaleString())}">
          🕐 ${esc(genAtFmt)} ${genBy ? '· ' + esc(genBy) : ''}
        </span>`
            : ''
        }
      </div>
      <div style="background:linear-gradient(135deg,rgba(22,100,229,.08),rgba(124,77,255,.06));
                  border-left:3px solid var(--oci-blue);padding:14px 16px;border-radius:8px;margin-bottom:14px">
        <div style="font-size:14px;font-weight:600;line-height:1.5">${esc(d.headline || '')}</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px;font-size:11px">
        <div class="stat-mini"><div style="color:var(--text-3)">총 딜</div><div style="font-size:18px;font-weight:700">${s.deals || 0}</div></div>
        <div class="stat-mini"><div style="color:var(--text-3)">진행</div><div style="font-size:18px;font-weight:700;color:var(--oci-blue)">${s.open || 0}</div></div>
        <div class="stat-mini"><div style="color:var(--text-3)">수주</div><div style="font-size:18px;font-weight:700;color:#17A85A">${s.won || 0}</div></div>
        <div class="stat-mini"><div style="color:var(--text-3)">누적 금액</div><div style="font-size:14px;font-weight:700">${(s.total_amount || 0).toLocaleString()}</div></div>
      </div>
      <div style="font-size:13px;font-weight:600;margin:8px 0">📍 핵심 포인트</div>
      <ul style="margin:0 0 16px;padding-left:20px;line-height:1.8;font-size:13px">
        ${(d.key_points || []).map(k => `<li>${esc(k)}</li>`).join('')}
      </ul>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px">
        <div style="flex:1;min-width:200px;background:rgba(23,168,90,.08);border-left:3px solid #17A85A;padding:10px 12px;border-radius:6px">
          <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">🎯 이번 주 즉시 실행</div>
          <div style="font-size:13px;font-weight:600">${esc(d.next_action || '-')}</div>
        </div>
        ${
          d.risk
            ? `
        <div style="flex:1;min-width:200px;background:rgba(230,51,41,.08);border-left:3px solid var(--oci-red);padding:10px 12px;border-radius:6px">
          <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">⚠️ 리스크</div>
          <div style="font-size:13px;font-weight:600">${esc(d.risk)}</div>
        </div>`
            : ''
        }
      </div>

      <!-- 변경 이력 영역 -->
      <details id="cm-brief-history-wrap" style="margin-top:16px;border-top:1px solid var(--border);padding-top:12px">
        <summary style="cursor:pointer;font-size:12px;font-weight:600;color:var(--text-2)">
          📚 변경 이력 보기
        </summary>
        <div id="cm-brief-history-list" style="margin-top:10px;font-size:12px">
          <div class="loading" style="padding:10px;color:var(--text-3)">이력 불러오는 중...</div>
        </div>
      </details>
    `;
    this._markBriefed(id);

    // 이력 영역은 펼칠 때 lazy 로드
    const detailsEl = document.getElementById('cm-brief-history-wrap');
    if (detailsEl) {
      detailsEl.addEventListener('toggle', () => {
        if (detailsEl.open && !detailsEl.dataset.loaded) {
          this._loadBriefHistory(id);
          detailsEl.dataset.loaded = '1';
        }
      });
    }

    // 버튼 라벨 갱신
    const btn = document.getElementById('cm-brief-gen');
    if (btn) btn.innerHTML = '🔄 다시 생성';
  },

  async _loadBriefHistory(id) {
    const wrap = document.getElementById('cm-brief-history-list');
    if (!wrap) return;
    try {
      const r = await API.get(`/customers/${id}/brief/history`);
      const list = r.data || [];
      if (list.length <= 1) {
        wrap.innerHTML = `<div style="color:var(--text-3);padding:8px">이전 이력이 없습니다 (현재 브리핑이 최초입니다).</div>`;
        return;
      }
      wrap.innerHTML = `
        <div style="color:var(--text-3);margin-bottom:8px">총 ${list.length}건의 브리핑 이력 (최신순)</div>
        <div style="border-left:2px solid var(--border);padding-left:14px">
          ${list
            .map((h, idx) => {
              const isLatest = idx === 0;
              const time = this._fmtDateTime(h.generated_at);
              const fullTime = new Date(h.generated_at).toLocaleString('ko-KR');
              return `
              <div class="cm-brief-hist-item" style="position:relative;margin-bottom:14px;padding-left:6px">
                <div style="position:absolute;left:-21px;top:4px;width:10px;height:10px;border-radius:50%;
                            background:${isLatest ? 'var(--oci-blue)' : 'var(--text-4)'};border:2px solid var(--surface)"></div>
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px">
                  <span style="font-weight:600">${esc(h.headline || '(요약 없음)')}</span>
                  <span style="font-size:11px;color:var(--text-3);white-space:nowrap" title="${esc(fullTime)}">
                    ${esc(time)}${h.generated_by_name ? ' · ' + esc(h.generated_by_name) : ''}
                    ${isLatest ? ' <span class="badge badge-blue" style="font-size:9px;margin-left:4px">최신</span>' : ''}
                  </span>
                </div>
                <div style="color:var(--text-3);font-size:11px">
                  🎯 ${esc(h.next_action || '-')}${h.risk ? ' · ⚠️ ' + esc(h.risk) : ''}
                </div>
                <div style="font-size:10px;color:var(--text-4);margin-top:2px">
                  딜 ${h.stats?.deals || 0} · 수주 ${h.stats?.won || 0} · 누적 ${(h.stats?.total_amount || 0).toLocaleString()}
                </div>
              </div>`;
            })
            .join('')}
        </div>
      `;
    } catch (e) {
      wrap.innerHTML = `<div style="color:var(--oci-red);padding:8px">이력 로드 실패: ${esc(e.message)}</div>`;
    }
  },

  // 상대 시간 + 절대 시간 포맷 (방금/N분 전/N시간 전/MM-DD HH:mm)
  _fmtDateTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const diffMs = Date.now() - d.getTime();
    const m = Math.floor(diffMs / 60000);
    if (m < 1) return '방금 전';
    if (m < 60) return `${m}분 전`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}시간 전`;
    const day = Math.floor(h / 24);
    if (day < 7) return `${day}일 전`;
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  },

  async _generateBrief(id) {
    const wrap = document.getElementById('cm-brief-content');
    const btn = document.getElementById('cm-brief-gen');
    btn.disabled = true;
    btn.innerHTML = '⏳ 생성 중...';
    wrap.innerHTML = `<div class="loading" style="padding:30px;text-align:center">AI가 분석 중...</div>`;
    try {
      const r = await API.post(`/customers/${id}/brief`, {});
      this._renderBriefData(id, r.data);
    } catch (e) {
      wrap.innerHTML = `<div class="empty" style="color:var(--oci-red);padding:20px">생성 실패: ${esc(e.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = '🔄 다시 생성';
    }
  },

  async _saveCustomerEdit(id) {
    const form = document.getElementById('cm-edit-form');
    if (!form.reportValidity()) return;
    const fd = new FormData(form);
    const body = {};
    fd.forEach((v, k) => (body[k] = String(v).trim() || null));
    try {
      await API.put(`/customers/${id}`, body);
      Toast.success('수정되었습니다');
      Modal.close();
      this.loadData();
    } catch (e) {
      Toast.error('수정 실패: ' + e.message);
    }
  },

  async _deleteCustomer(id, name) {
    if (!confirm(`정말 "${name}" 고객을 삭제하시겠습니까?\n관련 데이터는 영향받지 않습니다.`))
      return;
    try {
      await API.delete(`/customers/${id}`);
      Toast.success('삭제되었습니다');
      Modal.close();
      this.loadData();
    } catch (e) {
      Toast.error('삭제 실패: ' + e.message);
    }
  },

  // ── 고객사 인텔리전스 스트리밍 (레거시 호환) ──────────────
  async showIntel(id, name) {
    this.selectedCustomer = { id, name };
    const panel = document.getElementById('cust-intel-panel');
    panel.style.display = '';
    document.getElementById('intel-company-name').textContent = name;
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const btn = document.getElementById('intel-refresh-btn');
    btn.onclick = () => this.showIntel(id, name);

    await this._streamIntelligence(id);
  },

  closeIntel() {
    document.getElementById('cust-intel-panel').style.display = 'none';
    this.selectedCustomer = null;
  },

  async _streamIntelligence(id) {
    const contentEl = document.getElementById('intel-content');
    contentEl.innerHTML = '<span class="ai-cursor">▋</span>';

    try {
      const token = localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token');
      const res = await fetch(`/api/customers/${id}/intelligence`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`서버 오류 (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            reader.cancel();
            break;
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              contentEl.innerHTML = `<span style="color:var(--oci-red)">⚠️ ${esc(parsed.error)}</span>`;
              return;
            }
            if (parsed.text) {
              fullText += parsed.text;
              contentEl.innerHTML =
                AI.renderMarkdown(fullText) + '<span class="ai-cursor">▋</span>';
              contentEl.parentElement.scrollTop = contentEl.parentElement.scrollHeight;
            }
          } catch (_) {
            /* malformed SSE JSON line, skip */
          }
        }
      }
      if (fullText) {
        contentEl.innerHTML = AI.renderMarkdown(fullText);
        this._markBriefed(id); // ✅ 인라인 인텔리전스 완료 마킹
      }
    } catch (err) {
      contentEl.innerHTML = `<span style="color:var(--oci-red)">⚠️ ${esc(err.message)}</span>`;
    }
  },

  // ── 통합 등록 모달 (직접 입력 / 명함 업로드) ──────────────
  openRegisterModal(defaultTab = 'direct') {
    this._ocrFiles = [];
    this._ocrResults = [];
    this._activeRegTab = defaultTab;

    Modal.open({
      title: '고객사 등록',
      width: 680,
      body: `
        <div style="display:flex;gap:0;border-bottom:2px solid var(--border);margin:-8px -8px 20px">
          <button id="rtab-btn-direct" data-reg-tab="direct"
            style="padding:10px 22px;font-size:13px;font-weight:500;border:none;background:none;
                   cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;
                   transition:all .15s;color:${defaultTab === 'direct' ? 'var(--oci-red)' : 'var(--text-3)'};
                   border-bottom-color:${defaultTab === 'direct' ? 'var(--oci-red)' : 'transparent'}">
            직접 입력
          </button>
          ${
            typeof Features === 'undefined' || Features.isEnabled('ai.ocr')
              ? `
          <button id="rtab-btn-ocr" data-reg-tab="ocr"
            style="padding:10px 22px;font-size:13px;font-weight:500;border:none;background:none;
                   cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;
                   transition:all .15s;color:${defaultTab === 'ocr' ? 'var(--oci-red)' : 'var(--text-3)'};
                   border-bottom-color:${defaultTab === 'ocr' ? 'var(--oci-red)' : 'transparent'}">
            📇 명함 업로드
          </button>`
              : ''
          }
        </div>

        <!-- 직접 입력 탭 -->
        <div id="rtab-content-direct" ${defaultTab !== 'direct' ? 'style="display:none"' : ''}>
          <form id="cust-form" class="form-grid">
            <div class="form-row-2">
              <div class="form-row">
                <label class="form-label">고객사명 <span style="color:var(--oci-red)">*</span></label>
                <input class="form-input" name="name" placeholder="회사명 입력" required>
              </div>
              <div class="form-row">
                <label class="form-label">산업군</label>
                <input class="form-input" name="industry" placeholder="발전, 에너지, 건설...">
              </div>
            </div>
            <div class="form-row-3">
              <div class="form-row">
                <label class="form-label">지역</label>
                <select class="form-input" name="region">
                  <option value="국내">국내</option>
                  <option value="해외">해외</option>
                </select>
              </div>
              <div class="form-row">
                <label class="form-label">국가</label>
                <input class="form-input" name="country" placeholder="대한민국">
              </div>
              <div class="form-row">
                <label class="form-label">담당자명</label>
                <input class="form-input" name="contact_person">
              </div>
            </div>
            <div class="form-row-2">
              <div class="form-row">
                <label class="form-label">전화번호</label>
                <input class="form-input" name="phone">
              </div>
              <div class="form-row">
                <label class="form-label">이메일</label>
                <input type="email" class="form-input" name="email">
              </div>
            </div>
            <div class="form-row">
              <label class="form-label">주소</label>
              <input class="form-input" name="address">
            </div>
          </form>
        </div>

        <!-- 명함 업로드 탭 -->
        <div id="rtab-content-ocr" ${defaultTab !== 'ocr' ? 'style="display:none"' : ''}>
          <p style="font-size:13px;color:var(--text-2);margin-bottom:14px;line-height:1.6">
            명함 이미지(JPG/PNG)를 드래그&드롭하거나 클릭해서 선택하세요.<br>
            Google Vision AI로 텍스트를 인식하고 고객사 정보를 자동 추출합니다.
          </p>

          <div id="card-dropzone">
            <div style="font-size:36px;margin-bottom:10px">📇</div>
            <div style="font-size:14px;font-weight:600;color:var(--text-1)">명함 파일을 여기에 드롭하거나 클릭해서 선택</div>
            <div style="font-size:12px;color:var(--text-3);margin-top:6px">JPG, PNG 지원 · 최대 20장</div>
            <input type="file" id="card-file-input" accept="image/*" multiple style="display:none">
          </div>

          <div id="card-file-list" style="margin-top:12px"></div>
          <div id="card-ocr-results" style="margin-top:8px"></div>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="reg-modal-close-btn">닫기</button>
        <button class="btn btn-primary" id="rtab-footer-direct"
                ${defaultTab !== 'direct' ? 'style="display:none"' : ''}>
          등록
        </button>
        <button class="btn btn-primary" id="card-ocr-start-btn" style="display:none">
          🔍 AI 인식 시작
        </button>
        <button class="btn btn-primary" id="card-save-all-btn" style="display:none">
          💾 전체 저장
        </button>
      `,
      bind: {
        '#reg-modal-close-btn': () => Modal.close(),
        '#rtab-footer-direct': () => this.save(),
        '#card-ocr-start-btn': () => this._runOCR(),
        '#card-save-all-btn': () => this._saveAllOCR(),
      },
    });
    setTimeout(() => this._bindRegTabButtons(), 0);
  },

  _bindRegTabButtons() {
    document.querySelectorAll('[data-reg-tab]').forEach(btn => {
      btn.addEventListener('click', () => this._switchRegTab(btn.dataset.regTab));
    });
    const dropzone = document.getElementById('card-dropzone');
    if (dropzone) {
      dropzone.addEventListener('click', () => document.getElementById('card-file-input')?.click());
      dropzone.addEventListener('dragover', e => {
        e.preventDefault();
        dropzone.classList.add('drag-over');
      });
      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
      dropzone.addEventListener('drop', e => this._handleDrop(e));
    }
    const fileInput = document.getElementById('card-file-input');
    if (fileInput) fileInput.addEventListener('change', () => this._handleFiles(fileInput.files));
  },

  _switchRegTab(tab) {
    this._activeRegTab = tab;

    const tabs = ['direct', 'ocr'];
    tabs.forEach(t => {
      const btn = document.getElementById(`rtab-btn-${t}`);
      const content = document.getElementById(`rtab-content-${t}`);
      const isActive = t === tab;
      if (btn) {
        btn.style.color = isActive ? 'var(--oci-red)' : 'var(--text-3)';
        btn.style.borderBottomColor = isActive ? 'var(--oci-red)' : 'transparent';
      }
      if (content) content.style.display = isActive ? '' : 'none';
    });

    // Footer 버튼 전환
    const footerDirect = document.getElementById('rtab-footer-direct');
    const ocrStart = document.getElementById('card-ocr-start-btn');
    const ocrSave = document.getElementById('card-save-all-btn');

    if (tab === 'direct') {
      if (footerDirect) footerDirect.style.display = '';
      if (ocrStart) ocrStart.style.display = 'none';
      if (ocrSave) ocrSave.style.display = 'none';
    } else {
      if (footerDirect) footerDirect.style.display = 'none';
      // OCR start/save show based on file selection / results
    }
  },

  async save() {
    const fd = new FormData(document.getElementById('cust-form'));
    const body = {};
    fd.forEach((v, k) => {
      body[k] = v || null;
    });
    if (!body.name) return Toast.error('고객사명을 입력하세요');

    // 인라인 경고 초기화
    const existingBanner = document.getElementById('dup-warn-banner');
    if (existingBanner) existingBanner.remove();

    try {
      await API.customers.create(body);
      Toast.success('고객사가 등록되었습니다');
      Modal.close();
      await this.loadData();
      await App.refreshCommon();
    } catch (err) {
      // 중복 409 처리 — 모달 안에 인라인 배너로 표시
      if (err?.status === 409 || err?.duplicate) {
        const msg = err?.message || '이미 등록된 고객사입니다';
        const banner = document.createElement('div');
        banner.id = 'dup-warn-banner';
        banner.style.cssText = `
          background:#fff3cd;border:1.5px solid #ffc107;border-radius:6px;
          padding:10px 14px;margin-bottom:14px;font-size:13px;color:#856404;
          display:flex;align-items:flex-start;gap:8px;line-height:1.5;
        `;
        banner.innerHTML = `<span style="font-size:16px;flex-shrink:0">⚠️</span>
          <div><strong>중복 고객사 감지</strong><br>${esc(msg)}</div>`;
        const form = document.getElementById('cust-form');
        if (form) form.prepend(banner);
      } else {
        Toast.error('등록 중 오류가 발생했습니다');
        console.error(err);
      }
    }
  },

  // ── 명함 파일 처리 ────────────────────────────────────────
  _handleDrop(e) {
    e.preventDefault();
    document.getElementById('card-dropzone').classList.remove('drag-over');
    this._handleFiles(e.dataTransfer.files);
  },

  _handleFiles(files) {
    this._ocrFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    const listEl = document.getElementById('card-file-list');
    if (!this._ocrFiles.length) {
      listEl.innerHTML =
        '<div style="color:var(--oci-red);font-size:12px">이미지 파일이 없습니다</div>';
      return;
    }
    listEl.innerHTML = `
      <div style="font-size:12px;color:var(--text-2);margin-bottom:8px">
        <strong>${this._ocrFiles.length}장</strong> 선택됨
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${this._ocrFiles
          .map(
            f => `
          <div style="display:flex;align-items:center;gap:4px;background:var(--surface-2);
                      border:1px solid var(--border);border-radius:4px;padding:4px 8px;font-size:12px">
            📄 ${esc(f.name)}
            <span style="color:var(--text-3)">(${(f.size / 1024).toFixed(0)}KB)</span>
          </div>
        `
          )
          .join('')}
      </div>`;

    const startBtn = document.getElementById('card-ocr-start-btn');
    if (startBtn) startBtn.style.display = '';
  },

  async _runOCR() {
    const startBtn = document.getElementById('card-ocr-start-btn');
    const resultsEl = document.getElementById('card-ocr-results');
    if (startBtn) {
      startBtn.disabled = true;
      startBtn.textContent = '🔍 인식 중...';
    }
    resultsEl.innerHTML =
      '<div class="loading" style="padding:20px;text-align:center">AI가 명함을 분석 중입니다...</div>';

    try {
      const formData = new FormData();
      this._ocrFiles.forEach(f => formData.append('cards', f));

      const token = localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token');
      const ocrHeaders = {};
      if (token) ocrHeaders['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/customers/ocr', {
        method: 'POST',
        body: formData,
        headers: ocrHeaders,
      });
      const data = await res.json();

      if (!data.success) {
        resultsEl.innerHTML = `<div style="color:var(--oci-red);padding:12px">⚠️ ${esc(data.error)}</div>`;
        if (startBtn) {
          startBtn.disabled = false;
          startBtn.textContent = '🔍 AI 인식 시작';
        }
        return;
      }

      this._ocrResults = data.data;
      this._renderOCRResults();
      const saveBtn = document.getElementById('card-save-all-btn');
      if (saveBtn) saveBtn.style.display = '';
      if (startBtn) startBtn.style.display = 'none';
    } catch (err) {
      resultsEl.innerHTML = `<div style="color:var(--oci-red);padding:12px">⚠️ ${esc(err.message)}</div>`;
      if (startBtn) {
        startBtn.disabled = false;
        startBtn.textContent = '🔍 AI 인식 시작';
      }
    }
  },

  _renderOCRResults() {
    const el = document.getElementById('card-ocr-results');
    if (!this._ocrResults.length) {
      el.innerHTML = '<div style="color:var(--text-3);padding:12px">인식 결과가 없습니다</div>';
      return;
    }
    el.innerHTML = `
      <div style="font-size:13px;font-weight:600;margin-bottom:10px;color:var(--text-1)">
        인식 결과 — 필드를 확인/수정 후 저장하세요
      </div>
      ${this._ocrResults
        .map(
          (r, i) => `
        <div class="ocr-result-card">
          <div style="background:var(--surface-2);padding:8px 12px;font-size:12px;font-weight:600;
                      color:var(--text-2);display:flex;justify-content:space-between;align-items:center;
                      border-bottom:1px solid var(--border)">
            <span>📄 ${esc(r.filename)}</span>
            ${
              r.error
                ? `<span style="color:var(--oci-red)">인식 실패</span>`
                : `<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:400">
                   <input type="checkbox" class="ocr-check" data-idx="${i}" checked> 저장 포함
                 </label>`
            }
          </div>
          ${
            r.error
              ? `<div style="padding:12px;color:var(--oci-red);font-size:12px">${esc(r.error)}</div>`
              : `<div style="padding:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px" id="ocr-form-${i}">
                ${[
                  ['name', '고객사명 *'],
                  ['contact_person', '담당자'],
                  ['industry', '산업군'],
                  ['phone', '전화번호'],
                  ['email', '이메일'],
                  ['country', '국가'],
                  ['address', '주소', 'grid-column:1/-1'],
                ]
                  .map(
                    ([field, label, style = '']) => `
                  <div ${style ? `style="${style}"` : ''}>
                    <div style="font-size:11px;color:var(--text-3);margin-bottom:3px">${label}</div>
                    <input class="form-input" style="font-size:12px;padding:5px 8px"
                           id="ocr-${i}-${field}"
                           value="${esc(r.parsed[field] || '')}"
                           placeholder="${label}">
                  </div>
                `
                  )
                  .join('')}
                <div>
                  <div style="font-size:11px;color:var(--text-3);margin-bottom:3px">지역</div>
                  <select class="form-input" style="font-size:12px;padding:5px 8px" id="ocr-${i}-region">
                    <option value="국내" ${r.parsed.region !== '해외' ? 'selected' : ''}>국내</option>
                    <option value="해외" ${r.parsed.region === '해외' ? 'selected' : ''}>해외</option>
                  </select>
                </div>
              </div>`
          }
        </div>
      `
        )
        .join('')}
    `;
  },

  _collectOCRForm(i) {
    const get = f => (document.getElementById(`ocr-${i}-${f}`)?.value || '').trim() || null;
    return {
      name: get('name'),
      contact_person: get('contact_person'),
      industry: get('industry'),
      phone: get('phone'),
      email: get('email'),
      country: get('country'),
      address: get('address'),
      region: document.getElementById(`ocr-${i}-region`)?.value || '국내',
    };
  },

  async _saveAllOCR() {
    const checks = document.querySelectorAll('.ocr-check:checked');
    if (!checks.length) {
      Toast.error('저장할 항목을 선택하세요');
      return;
    }

    const saveBtn = document.getElementById('card-save-all-btn');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = '저장 중...';
    }

    let saved = 0;
    let duped = 0;
    let failed = 0;
    for (const chk of checks) {
      const i = parseInt(chk.dataset.idx);
      const body = this._collectOCRForm(i);
      if (!body.name) {
        failed++;
        continue;
      }
      try {
        await API.customers.create(body);
        saved++;
      } catch (err) {
        if (err?.status === 409 || err?.duplicate) duped++;
        else failed++;
      }
    }

    Modal.close();
    const parts = [];
    if (saved) parts.push(`${saved}개 등록 완료`);
    if (duped) parts.push(`${duped}개 중복 건너뜀`);
    if (failed) parts.push(`${failed}개 오류`);
    const msg = parts.join(' · ') || '등록된 항목 없음';

    if (saved) Toast.success(msg);
    else if (duped) Toast.warn(`⚠️ 중복 방지: ${msg}`);
    else Toast.error(msg);

    await this.loadData();
    await App.refreshCommon();
  },
};
