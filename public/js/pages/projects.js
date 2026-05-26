// ============================================================
// Projects Page (테이블 + Copy & Paste)
// ============================================================
const ProjectsPage = {
  _allProjects: [],
  _selectedIds: new Set(),
  // v6.0.0: 붙여넣기 파싱/등록 공통 BulkPaste 컴포넌트로 이관
  _pasteHandler: null,

  async render() {
    document.getElementById('content').innerHTML = `
      <div class="filter-bar">
        <input type="text" class="search-input" data-placeholder-label="projects.search_placeholder" placeholder="프로젝트 검색..." id="proj-search">
        <button class="btn btn-primary" id="proj-open-form-btn" data-label="projects.new_button">+ 프로젝트 등록</button>
      </div>
      <div class="card">
        <div class="card-header">
          <div class="card-title"><span data-label="projects.list_title">프로젝트 목록</span> <span class="text-muted fs-12" id="proj-count"></span></div>
          <div style="display:flex;align-items:center;gap:8px">
            <div class="cp-toolbar" id="cp-toolbar-proj" style="display:none">
              <span class="cp-sel-count" id="cp-sel-count-proj" data-label="common.selected_count">0건 선택</span>
              <button class="btn btn-ghost btn-sm" id="proj-copy-btn" title="Excel·Word에 붙여넣기 가능한 형식으로 복사" data-label="common.copy">📋 복사</button>
              <button class="btn btn-ghost btn-sm" id="proj-clear-sel-btn" data-label="common.clear_selection">선택 해제</button>
            </div>
            <button class="btn btn-ghost btn-sm" id="proj-paste-modal-btn"
              data-feature="data.bulk_paste"
              title="Excel·Word·이메일에서 복사한 데이터를 붙여넣기로 일괄 등록"
              data-label="common.paste_register">
              📥 붙여넣기 등록
            </button>
            <button class="btn btn-ghost btn-sm" id="proj-export-btn"
              data-feature="data.excel_exp"
              title="현재 목록을 엑셀 파일로 다운로드" data-label="common.excel_export">
              📤 엑셀 다운로드
            </button>
            <label class="btn btn-ghost btn-sm" data-feature="data.excel_imp"
              title="엑셀 파일로 일괄 등록" style="cursor:pointer;margin:0">
              <span data-label="common.excel_import">📂 엑셀 가져오기</span>
              <input type="file" id="proj-import-input" accept=".xlsx,.xls" style="display:none">
            </label>
          </div>
        </div>
        <div class="card-body no-pad" id="projects-table-wrap">
          <div class="loading" data-label="common.loading">로딩중...</div>
        </div>
      </div>
    `;

    document.getElementById('proj-search').addEventListener(
      'input',
      debounce(e => {
        const q = e.target.value.toLowerCase();
        const filtered = this._allProjects.filter(
          p => p.name?.toLowerCase().includes(q) || p.customer_name?.toLowerCase().includes(q)
        );
        this.renderTable(filtered);
      }, 300)
    );

    document.getElementById('proj-open-form-btn')?.addEventListener('click', () => this.openForm());
    document.getElementById('proj-copy-btn')?.addEventListener('click', () => this.copySelected());
    document
      .getElementById('proj-clear-sel-btn')
      ?.addEventListener('click', () => this._clearSelection());
    document
      .getElementById('proj-paste-modal-btn')
      ?.addEventListener('click', () => this.openPasteModal());
    document
      .getElementById('proj-export-btn')
      ?.addEventListener('click', e => this._openExportMenu(e.currentTarget));
    document
      .getElementById('proj-import-input')
      ?.addEventListener('change', e => this.importExcel(e.target));

    this._bindPasteShortcut();
    await this.loadData();
  },

  _bindPasteShortcut() {
    if (this._pasteHandler) document.removeEventListener('keydown', this._pasteHandler);
    this._pasteHandler = e => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        this.openPasteModal();
      }
    };
    document.addEventListener('keydown', this._pasteHandler);
  },

  async loadData() {
    try {
      const result = await API.projects.list();
      this._allProjects = result.data;
      this.renderTable(result.data);
    } catch (err) {
      console.error(err);
    }
  },

  renderTable(projects) {
    const countEl = document.getElementById('proj-count');
    if (countEl) countEl.textContent = `(총 ${projects.length}건)`;

    if (!projects.length) {
      const hasFilter = !!document.getElementById('proj-search')?.value;
      const presetKey = hasFilter ? 'filter' : 'projects';
      const html =
        typeof EmptyState !== 'undefined'
          ? EmptyState.preset(presetKey)
          : '<div class="empty"><div class="empty-icon">📁</div>등록된 프로젝트가 없습니다</div>';
      document.getElementById('projects-table-wrap').innerHTML = html;
      if (!hasFilter) {
        document
          .getElementById('empty-projects-new')
          ?.addEventListener('click', () => this.openForm?.());
      }
      return;
    }
    const statusBadge = {
      진행중: 'blue',
      제조중: 'blue',
      납기지연: 'amber',
      완료: 'green',
      취소: 'gray',
    };
    const html = `
      <table class="data-table">
        <thead>
          <tr>
            <th class="cp-check-col">
              <input type="checkbox" class="cp-checkbox" id="cp-check-all-proj" title="전체 선택">
            </th>
            <th data-label="projects.name">프로젝트명</th>
            <th data-label="projects.customer_name">고객사</th>
            <th data-label="projects.business_type">유형</th>
            <th class="text-right" data-label="projects.contract_amount">계약금액</th>
            <th class="text-right" data-label="projects.estimated_cost">산정 원가</th>
            <th class="text-right" data-label="projects.margin_pct">마진율</th>
            <th data-label="projects.status">상태</th>
            <th data-label="projects.due_date">납기일</th>
            <th data-label="projects.manager">담당</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${projects
            .map(p => {
              const margin = parseFloat(p.margin_pct);
              const marginColor =
                margin >= 20 ? 'var(--green)' : margin >= 15 ? 'var(--amber)' : 'var(--red)';
              return `
              <tr data-proj-id="${p.id}" class="${this._selectedIds.has(p.id) ? 'cp-selected' : ''}">
                <td class="cp-check-col" data-stop-propagation="1">
                  <input type="checkbox" class="cp-checkbox" data-id="${p.id}"
                    ${this._selectedIds.has(p.id) ? 'checked' : ''}>
                </td>
                <td><strong>${esc(p.name)}</strong></td>
                <td>${esc(p.customer_name || '-')}</td>
                <td><span class="badge badge-blue">${esc(p.project_type || '-')}</span></td>
                <td class="text-right mono">${Fmt.amount(p.contract_amount)}</td>
                <td class="text-right mono">${Fmt.amount(p.estimated_cost)}</td>
                <td class="text-right" style="color:${marginColor};font-weight:600">${margin ? margin.toFixed(2) + '%' : '-'}</td>
                <td><span class="badge badge-${statusBadge[p.status] || 'gray'}">${esc(p.status)}</span></td>
                <td>${Fmt.date(p.due_date)}</td>
                <td>${esc(p.assigned_name || '-')}</td>
                <td><button class="btn btn-ghost btn-sm" data-action="edit-proj" data-pid="${p.id}">편집</button></td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    `;
    const wrap = document.getElementById('projects-table-wrap');
    wrap.innerHTML = html;
    this._updateSelectionUI();

    wrap.addEventListener('click', e => {
      const stopEl = e.target.closest('[data-stop-propagation]');
      if (stopEl) {
        e.stopPropagation();
      }

      const actionBtn = e.target.closest('[data-action="edit-proj"]');
      if (actionBtn) {
        this.openForm(parseInt(actionBtn.dataset.pid));
        return;
      }

      const cb = e.target.closest('.cp-checkbox[data-id]');
      if (cb) {
        this._toggleRow(parseInt(cb.dataset.id), cb.checked);
        return;
      }

      const hdrCb = e.target.closest('#cp-check-all-proj');
      if (hdrCb) {
        this._toggleAll(hdrCb.checked);
        return;
      }
    });
  },

  // ── 체크박스 선택 ────────────────────────────────────────────
  _toggleAll(checked) {
    this._allProjects.forEach(p => {
      if (checked) this._selectedIds.add(p.id);
      else this._selectedIds.delete(p.id);
    });
    document.querySelectorAll('.cp-checkbox[data-id]').forEach(cb => (cb.checked = checked));
    document
      .querySelectorAll('tr[data-proj-id]')
      .forEach(tr => tr.classList.toggle('cp-selected', checked));
    this._updateSelectionUI();
  },

  _toggleRow(id, checked) {
    if (checked) this._selectedIds.add(id);
    else this._selectedIds.delete(id);
    const tr = document.querySelector(`tr[data-proj-id="${id}"]`);
    if (tr) {
      tr.classList.toggle('cp-selected', checked);
      const cb = tr.querySelector('.cp-checkbox[data-id]');
      if (cb) cb.checked = checked;
    }
    const all = document.getElementById('cp-check-all-proj');
    if (all)
      all.checked =
        this._selectedIds.size === this._allProjects.length && this._allProjects.length > 0;
    this._updateSelectionUI();
  },

  _clearSelection() {
    this._selectedIds.clear();
    document.querySelectorAll('.cp-checkbox').forEach(cb => (cb.checked = false));
    document.querySelectorAll('tr[data-proj-id]').forEach(tr => tr.classList.remove('cp-selected'));
    this._updateSelectionUI();
  },

  _updateSelectionUI() {
    const n = this._selectedIds.size;
    const toolbar = document.getElementById('cp-toolbar-proj');
    const count = document.getElementById('cp-sel-count-proj');
    if (toolbar) toolbar.style.display = n > 0 ? 'flex' : 'none';
    if (count) count.textContent = `${n}건 선택`;
  },

  // ── 복사 ────────────────────────────────────────────────────
  copySelected() {
    const selected = this._allProjects.filter(p => this._selectedIds.has(p.id));
    if (!selected.length) {
      Toast.info('복사할 항목을 선택하세요');
      return;
    }
    const headers = [
      '프로젝트명',
      '고객사',
      '유형',
      '계약금액(억)',
      '산정원가(억)',
      '마진율(%)',
      '상태',
      '납기일',
      '담당자',
      '메모',
    ];
    const rows = selected.map(p =>
      [
        p.name || '',
        p.customer_name || '',
        p.project_type || '',
        p.contract_amount !== null && p.contract_amount !== undefined ? p.contract_amount : '',
        p.estimated_cost !== null && p.estimated_cost !== undefined ? p.estimated_cost : '',
        p.margin_pct !== null && p.margin_pct !== undefined
          ? parseFloat(p.margin_pct).toFixed(2)
          : '',
        p.status || '',
        p.due_date ? String(p.due_date).slice(0, 10) : '',
        p.assigned_name || '',
        p.notes || '',
      ].map(v => String(v).replace(/\t/g, ' '))
    );
    const tsv = [headers, ...rows].map(r => r.join('\t')).join('\n');
    navigator.clipboard
      .writeText(tsv)
      .then(() =>
        Toast.success(`${selected.length}건 복사 완료 — Excel·Word에 Ctrl+V로 붙여넣기 하세요`)
      )
      .catch(() => {
        const ta = Object.assign(document.createElement('textarea'), {
          value: tsv,
          style: 'position:fixed;opacity:0',
        });
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        Toast.success(`${selected.length}건 복사 완료`);
      });
  },

  // ── 붙여넣기 모달 ────────────────────────────────────────────
  // ── 붙여넣기 등록 (공통 BulkPaste 컴포넌트 사용 — v6.0.0) ──────
  openPasteModal() {
    if (typeof BulkPaste === 'undefined') {
      Toast.error('BulkPaste 컴포넌트 로드 실패');
      return;
    }
    BulkPaste.open({
      entityType: 'project',
      title: '📥 프로젝트 붙여넣기 등록',
      endpoint: '/projects/bulk',
      payloadKey: 'projects',
      columns: [
        { key: 'name', label: '프로젝트명', required: true, maxLength: 200 },
        { key: 'customer_name', label: '고객사', maxLength: 200 },
        { key: 'project_type', label: '유형', default: '태양광', maxLength: 50 },
        {
          key: 'contract_amount',
          label: '계약금액',
          transform: v => {
            if (v === null || v === undefined || v === '') return null;
            const s = String(v);
            const isEok = /억/.test(s);
            const n = parseFloat(s.replace(/[,₩$¥억\s]/g, ''));
            if (isNaN(n)) return null;
            return isEok ? Math.round(n * 1e8) : n;
          },
        },
        {
          key: 'estimated_cost',
          label: '산정원가',
          transform: v => {
            if (v === null || v === undefined || v === '') return null;
            const s = String(v);
            const isEok = /억/.test(s);
            const n = parseFloat(s.replace(/[,₩$¥억\s]/g, ''));
            if (isNaN(n)) return null;
            return isEok ? Math.round(n * 1e8) : n;
          },
        },
        { key: 'status', label: '상태', default: '진행중', maxLength: 30 },
        { key: 'due_date', label: '납기일', validate: 'date' },
        { key: 'assigned_to', label: '담당자', maxLength: 100 },
        { key: 'notes', label: '메모', maxLength: 2000 },
      ],
      headerAliases: {
        프로젝트명: 'name',
        프로젝트: 'name',
        project: 'name',
        project_name: 'name',
        name: 'name',
        고객사: 'customer_name',
        customer: 'customer_name',
        customer_name: 'customer_name',
        유형: 'project_type',
        사업유형: 'project_type',
        type: 'project_type',
        project_type: 'project_type',
        계약금액: 'contract_amount',
        '계약금액(억)': 'contract_amount',
        금액: 'contract_amount',
        amount: 'contract_amount',
        contract: 'contract_amount',
        contract_amount: 'contract_amount',
        원가: 'estimated_cost',
        산정원가: 'estimated_cost',
        '산정원가(억)': 'estimated_cost',
        cost: 'estimated_cost',
        estimated_cost: 'estimated_cost',
        상태: 'status',
        status: 'status',
        납기일: 'due_date',
        납기: 'due_date',
        due: 'due_date',
        due_date: 'due_date',
        담당자: 'assigned_to',
        담당: 'assigned_to',
        assigned: 'assigned_to',
        assigned_to: 'assigned_to',
        메모: 'notes',
        비고: 'notes',
        notes: 'notes',
      },
      duplicateField: 'name',
      onSuccess: async () => {
        await this.loadData();
      },
    });
  },

  // ── (v6.0.0) 붙여넣기 파싱/등록은 BulkPaste 컴포넌트로 이관 ──────

  // ── 엑셀 내보내기 ────────────────────────────────────────────
  exportExcel() {
    const path = this._buildExportPath();
    API.downloadExport(path, '프로젝트_' + new Date().toISOString().slice(0, 10), 'xlsx');
  },

  _buildExportPath() {
    const search = document.getElementById('proj-search')?.value || '';
    const qs = new URLSearchParams();
    if (search) qs.set('search', search);
    return '/projects/export' + (qs.toString() ? '?' + qs.toString() : '');
  },

  _openExportMenu(triggerEl) {
    if (typeof ExportMenu === 'undefined') return this.exportExcel();
    ExportMenu.open(
      triggerEl,
      this._buildExportPath(),
      '프로젝트_' + new Date().toISOString().slice(0, 10)
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
      const res = await fetch('/api/projects/import', { method: 'POST', headers, body: fd });
      const data = await res.json();
      if (data.success) {
        const errMsg = data.errors?.length ? ` (${data.errors.length}건 오류)` : '';
        Toast.success(`${data.inserted}건 등록 완료${errMsg}`);
        await this.loadData();
      } else {
        Toast.error(data.message || '가져오기 실패');
      }
    } catch (e) {
      Toast.error('서버 오류: ' + (e.message || ''));
    }
  },

  // ── 기존 편집/저장/삭제 ──────────────────────────────────────
  async openForm(id = null) {
    let project = { contract_amount: '', estimated_cost: '' };
    if (id) {
      const result = await API.projects.list();
      project = result.data.find(p => p.id === id) || project;
    }
    const team = await API.team.list();
    Modal.open({
      title: id ? '프로젝트 편집' : '신규 프로젝트 등록',
      body: `
        <div class="form-grid">
          <div class="form-field full">
            <label class="form-label required">프로젝트명</label>
            <input class="form-control" id="p-name" value="${esc(project.name || '')}">
          </div>
          <div class="form-field">
            <label class="form-label">고객사</label>
            <input class="form-control" id="p-customer" value="${esc(project.customer_name || '')}" autocomplete="off">
            <!-- Combobox 선택 시 customer_id 클라이언트 보관 (백엔드 destructure 에서 무시됨 — 사이드이펙 0) -->
            <input type="hidden" id="p-customer-id" value="${esc(project.customer_id || '')}">
          </div>
          <div class="form-field">
            <label class="form-label">유형</label>
            <select class="form-control" id="p-type">
              <option ${project.project_type === '태양광' ? 'selected' : ''}>태양광</option>
              <option ${project.project_type === 'ESS' ? 'selected' : ''}>ESS</option>
              <option ${project.project_type === '모듈' ? 'selected' : ''}>모듈</option>
              <option ${project.project_type === 'EPC' ? 'selected' : ''}>EPC</option>
              <option ${project.project_type === '전기' ? 'selected' : ''}>전기</option>
            </select>
          </div>
          <div class="form-field">
            <label class="form-label">계약금액 <span style="font-size:11px;color:var(--text-3)">(원 단위)</span></label>
            <input class="form-control mono" id="p-amount" type="number" step="1" placeholder="예: 1840000000"
                   value="${project.contract_amount || ''}">
            <div id="p-amount-preview" style="font-size:11px;color:var(--oci-blue);margin-top:2px"></div>
          </div>
          <div class="form-field">
            <label class="form-label">산정 원가 <span style="font-size:11px;color:var(--text-3)">(원 단위)</span></label>
            <input class="form-control mono" id="p-cost" type="number" step="1" placeholder="예: 1420000000"
                   value="${project.estimated_cost || ''}">
            <div id="p-cost-preview" style="font-size:11px;color:var(--oci-blue);margin-top:2px"></div>
          </div>
          <div class="form-field">
            <label class="form-label">상태</label>
            <select class="form-control" id="p-status">
              <option ${project.status === '진행중' ? 'selected' : ''}>진행중</option>
              <option ${project.status === '제조중' ? 'selected' : ''}>제조중</option>
              <option ${project.status === '납기지연' ? 'selected' : ''}>납기지연</option>
              <option ${project.status === '완료' ? 'selected' : ''}>완료</option>
              <option ${project.status === '취소' ? 'selected' : ''}>취소</option>
            </select>
          </div>
          <div class="form-field">
            <label class="form-label">납기일</label>
            <input class="form-control" id="p-due" type="date" value="${project.due_date ? project.due_date.split('T')[0] : ''}">
          </div>
          <div class="form-field">
            <label class="form-label">담당자</label>
            <select class="form-control" id="p-assigned">
              <option value="">선택</option>
              ${team.data.map(t => `<option value="${t.id}" ${project.assigned_to === t.id ? 'selected' : ''}>${esc(t.name)} (${t.role})</option>`).join('')}
            </select>
          </div>
          <div class="form-field full">
            <label class="form-label">메모</label>
            <textarea class="form-control" id="p-notes">${esc(project.notes || '')}</textarea>
          </div>
        </div>
      `,
      footer: `
        ${id ? '<button class="btn btn-danger" id="proj-delete-btn">삭제</button>' : ''}
        <button class="btn btn-ghost" id="proj-form-cancel-btn">취소</button>
        <button class="btn btn-primary" id="proj-form-save-btn">저장</button>
      `,
      bind: {
        ...(id ? { '#proj-delete-btn': () => this.deleteProject(id) } : {}),
        '#proj-form-cancel-btn': () => Modal.close(),
        '#proj-form-save-btn': () => this.save(id || null),
      },
      onOpen: () => {
        // 입력값 → KRW 단위 변환 미리보기 실시간 업데이트
        const setupPreview = (inputId, previewId) => {
          const inp = document.getElementById(inputId);
          const prv = document.getElementById(previewId);
          if (!inp || !prv) return;
          const update = () => {
            const v = parseFloat(inp.value);
            prv.textContent = Number.isFinite(v) && v > 0 ? '≈ ' + Fmt.amount(v, 'KRW') : '';
          };
          inp.addEventListener('input', update);
          update();
        };
        setupPreview('p-amount', 'p-amount-preview');
        setupPreview('p-cost', 'p-cost-preview');

        // ─── 고객사 자동완성 (Combobox) ─────────────────
        // 사이드이펙 방지:
        //  - hidden #p-customer-id 는 save() 의 body 객체에 포함되지 않음 (변경 0)
        //  - Combobox 미로드 시 일반 input 동작 (graceful degradation)
        //  - 자유 입력 허용 (신규 고객사 등록은 별도 메뉴)
        const custInput = document.getElementById('p-customer');
        const custHidden = document.getElementById('p-customer-id');
        if (custInput && typeof Combobox !== 'undefined') {
          // 사용자가 input 텍스트 직접 수정 시 hidden id 동기화 해제
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
      },
    });
  },

  async save(id) {
    const body = {
      name: document.getElementById('p-name').value.trim(),
      customer_name: document.getElementById('p-customer').value.trim(),
      project_type: document.getElementById('p-type').value,
      contract_amount: parseFloat(document.getElementById('p-amount').value) || null,
      estimated_cost: parseFloat(document.getElementById('p-cost').value) || null,
      status: document.getElementById('p-status').value,
      due_date: document.getElementById('p-due').value || null,
      assigned_to: document.getElementById('p-assigned').value || null,
      notes: document.getElementById('p-notes').value,
    };
    if (!body.name) return Toast.error('프로젝트명을 입력해주세요');
    try {
      if (id) await API.projects.update(id, body);
      else await API.projects.create(body);
      Toast.success(id ? '프로젝트가 수정되었습니다' : '프로젝트가 등록되었습니다');
      Modal.close();
      this.loadData();
    } catch (_) {}
  },

  deleteProject(id) {
    Modal.confirm('이 프로젝트를 삭제하시겠습니까?', async () => {
      await API.projects.delete(id);
      Toast.success('삭제되었습니다');
      this.loadData();
    });
  },
};
