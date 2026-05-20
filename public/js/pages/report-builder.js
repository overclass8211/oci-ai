'use strict';
// =============================================================
// 리포트 빌더 (Phase 1 MVP) — public/js/pages/report-builder.js
//
// 기능:
//   - 좌측 필드 카탈로그 (차원 / 지표) — HTML5 native drag&drop
//   - 4 drop zones: Row(행) / Column(열) / Filter / Measure(지표)
//   - 자동 차트 추천 (Bar / Pie / Line / Stacked Bar)
//   - 본인 리포트 저장 / 조회 / 수정 / 삭제
//
// 데이터 소스: leads 단일 (Phase 1)
// 권한: team_lead(level 2) 이상만 — RBAC 미들웨어에서 처리
// =============================================================

const ReportBuilderPage = {
  // ─── 상태 ──────────────────────────────────────────────
  _state: {
    fields: null,                       // 서버에서 fetch 한 필드 카탈로그
    config: {
      datasource: 'leads',
      rows: [],
      columns: [],
      filters: [],
      measures: [],
      chartType: 'auto',
    },
    savedReports: [],                   // 본인 저장 리포트 목록
    currentId: null,                    // 현재 편집 중인 저장 리포트 ID
    chart: null,                        // Chart.js 인스턴스
    queryResult: null,                  // 마지막 쿼리 결과
    // Phase 2-A: 사이드바 패널 상태
    savedPanelOpen: false,              // 우측 저장 리포트 패널 열림 여부
    savedSearchQuery: '',               // 검색어 (이름/설명 필터)
    _searchDebounce: null,              // 검색 디바운스 타이머
  },

  // ─── 진입점 ────────────────────────────────────────────
  async render() {
    const root = document.getElementById('content');
    if (!root) return;

    root.innerHTML = this._html();

    try {
      // 필드 카탈로그 + 저장 리포트 목록 병렬 fetch
      const [fieldsRes, savedRes] = await Promise.all([
        API.reportBuilder.fields(),
        API.reportBuilder.listSaved().catch(() => ({ data: [] })),
      ]);
      this._state.fields = fieldsRes.data;
      this._state.savedReports = savedRes.data || [];
      this._renderFieldsPanel();
      this._renderSavedList();
      this._updateSavedCountBadge();
      this._bindEvents();
      // Phase 2-A: 저장된 리포트 있으면 자동 펼침 (사용자 결정)
      if (this._state.savedReports.length > 0) {
        this._toggleSavedPanel(true);
      }
      // 초기 미리보기 — 기본 차원 1개 + count
      this._state.config.rows = ['stage'];
      this._state.config.measures = ['count'];
      this._renderDropZones();
      await this._runQuery();
    } catch (err) {
      Toast.error('필드 카탈로그 로드 실패: ' + (err.message || ''));
    }
  },

  // ─── 레이아웃 HTML ────────────────────────────────────
  _html() {
    return `
      <div class="rb-container">
        <!-- 상단 툴바 -->
        <div class="rb-toolbar">
          <div class="rb-toolbar-left">
            <h2 style="margin:0;font-size:18px;font-weight:600">📊 리포트 빌더</h2>
            <span class="rb-hint">필드를 드래그하여 영역에 놓으세요</span>
          </div>
          <div class="rb-toolbar-right">
            <button class="btn btn-ghost btn-sm" id="rb-load-btn" title="저장된 리포트 목록 토글">📂 내 리포트 <span id="rb-saved-count-badge" style="display:none"></span></button>
            <button class="btn btn-ghost btn-sm" id="rb-reset-btn">🔄 초기화</button>
            <button class="btn btn-primary btn-sm" id="rb-save-btn">💾 저장</button>
          </div>
        </div>

        <!-- 본문 (Phase 2-A: 저장 패널 토글 가능 — rb-body--with-panel 클래스로 4-컬럼 grid) -->
        <div class="rb-body" id="rb-body">
          <!-- 좌측: 필드 카탈로그 -->
          <aside class="rb-sidebar" id="rb-fields-panel">
            <div class="rb-loading">필드 로딩 중...</div>
          </aside>

          <!-- 중앙: drop zones -->
          <main class="rb-main">
            <div class="rb-dropzones">
              <div class="rb-zone" data-zone="rows">
                <div class="rb-zone-title">📋 행 (Row)</div>
                <div class="rb-zone-body" id="rb-zone-rows"></div>
                <div class="rb-zone-hint">차원을 드래그 (1개)</div>
              </div>
              <div class="rb-zone" data-zone="columns">
                <div class="rb-zone-title">📊 열 (Column)</div>
                <div class="rb-zone-body" id="rb-zone-columns"></div>
                <div class="rb-zone-hint">차원을 드래그 (선택, 1개)</div>
              </div>
              <div class="rb-zone" data-zone="filters">
                <div class="rb-zone-title">🔍 필터 (Filter)</div>
                <div class="rb-zone-body" id="rb-zone-filters"></div>
                <div class="rb-zone-hint">차원을 드래그 (여러 개)</div>
              </div>
              <div class="rb-zone" data-zone="measures">
                <div class="rb-zone-title">📈 지표 (Measure)</div>
                <div class="rb-zone-body" id="rb-zone-measures"></div>
                <div class="rb-zone-hint">지표를 드래그 (최대 3개)</div>
              </div>
            </div>

            <!-- 차트 미리보기 -->
            <div class="rb-preview">
              <div class="rb-preview-header">
                <h3 style="margin:0;font-size:14px;font-weight:600">📉 미리보기</h3>
                <select id="rb-chart-type" class="form-input" style="width:auto;font-size:12px">
                  <option value="auto">🪄 자동</option>
                  <option value="bar">막대 (Bar)</option>
                  <option value="pie">원형 (Pie)</option>
                  <option value="line">선형 (Line)</option>
                  <option value="stacked-bar">누적 막대 (Stacked Bar)</option>
                </select>
              </div>
              <div class="rb-chart-wrapper">
                <canvas id="rb-chart"></canvas>
              </div>
              <div id="rb-data-table" class="rb-data-table"></div>
            </div>
          </main>

          <!-- Phase 2-A: 저장된 리포트 사이드 패널 (토글 가능) -->
          <aside class="rb-saved-panel" id="rb-saved-panel" style="display:none">
            <div class="rb-saved-header">
              <div class="rb-saved-title">📂 내 리포트 <span class="rb-saved-count" id="rb-saved-count"></span></div>
              <button class="rb-saved-close" id="rb-saved-close" title="패널 닫기" aria-label="패널 닫기">×</button>
            </div>
            <div class="rb-saved-search">
              <input type="text" id="rb-saved-search-input" placeholder="🔍 이름/설명 검색..." autocomplete="off" />
            </div>
            <div class="rb-saved-list" id="rb-saved-list"></div>
          </aside>
        </div>
      </div>
    `;
  },

  // ─── 좌측 필드 패널 렌더 ──────────────────────────────
  _renderFieldsPanel() {
    const panel = document.getElementById('rb-fields-panel');
    if (!panel || !this._state.fields) return;

    const { dimensions, measures } = this._state.fields;

    panel.innerHTML = `
      <div class="rb-section">
        <div class="rb-section-title">📁 데이터 소스</div>
        <div class="rb-datasource">📋 영업 리드</div>
      </div>
      <div class="rb-section">
        <div class="rb-section-title">📐 차원 (Dimensions)</div>
        ${dimensions.map(d => `
          <div class="rb-field rb-field-dim" draggable="true" data-field-key="${esc(d.key)}" data-field-type="dimension">
            <span class="rb-field-icon">${d.dataType === 'date' ? '📅' : '🏷'}</span>
            <span class="rb-field-label">${esc(d.label)}</span>
          </div>
        `).join('')}
      </div>
      <div class="rb-section">
        <div class="rb-section-title">📊 지표 (Measures)</div>
        ${measures.map(m => `
          <div class="rb-field rb-field-measure" draggable="true" data-field-key="${esc(m.key)}" data-field-type="measure">
            <span class="rb-field-icon">🔢</span>
            <span class="rb-field-label">${esc(m.label)}</span>
          </div>
        `).join('')}
      </div>
    `;

    // 드래그 시작
    panel.querySelectorAll('.rb-field').forEach(el => {
      el.addEventListener('dragstart', e => {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', JSON.stringify({
          key: el.dataset.fieldKey,
          type: el.dataset.fieldType,
        }));
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
    });
  },

  // ─── 드롭존 렌더 ───────────────────────────────────────
  _renderDropZones() {
    const fieldsMap = this._fieldsByKey();
    const cfg = this._state.config;

    // Row
    document.getElementById('rb-zone-rows').innerHTML = cfg.rows.map(k => this._chipHtml(k, fieldsMap[k], 'rows')).join('');
    document.getElementById('rb-zone-columns').innerHTML = cfg.columns.map(k => this._chipHtml(k, fieldsMap[k], 'columns')).join('');
    document.getElementById('rb-zone-measures').innerHTML = cfg.measures.map(k => this._chipHtml(k, fieldsMap[k], 'measures')).join('');

    // Filter — 좀 더 복잡 (op + value)
    document.getElementById('rb-zone-filters').innerHTML = cfg.filters.map((f, idx) => {
      const fld = fieldsMap[f.field];
      if (!fld) return '';
      return `
        <div class="rb-chip rb-chip-filter" data-zone="filters" data-idx="${idx}">
          <span class="rb-chip-label">${esc(fld.label)}</span>
          <select class="rb-chip-op" data-idx="${idx}">
            ${['eq','ne','like','gt','lt','gte','lte'].map(op =>
              `<option value="${op}" ${f.op===op?'selected':''}>${this._opLabel(op)}</option>`
            ).join('')}
          </select>
          <input class="rb-chip-value" data-idx="${idx}" type="text" value="${esc(f.value || '')}" placeholder="값" />
          <button class="rb-chip-remove" data-zone="filters" data-idx="${idx}" title="제거">✕</button>
        </div>
      `;
    }).join('');

    // 칩 제거 이벤트
    document.querySelectorAll('.rb-chip-remove').forEach(btn => {
      btn.onclick = () => this._removeField(btn.dataset.zone, parseInt(btn.dataset.idx));
    });

    // 필터 변경 이벤트
    document.querySelectorAll('.rb-chip-op').forEach(sel => {
      sel.onchange = () => {
        const idx = parseInt(sel.dataset.idx);
        this._state.config.filters[idx].op = sel.value;
        this._runQuery();
      };
    });
    document.querySelectorAll('.rb-chip-value').forEach(inp => {
      let debTimer = null;
      inp.oninput = () => {
        const idx = parseInt(inp.dataset.idx);
        this._state.config.filters[idx].value = inp.value;
        clearTimeout(debTimer);
        debTimer = setTimeout(() => this._runQuery(), 500);
      };
    });
  },

  _chipHtml(key, fld, zone) {
    if (!fld) return '';
    const idx = this._state.config[zone].indexOf(key);
    return `
      <div class="rb-chip rb-chip-${zone}">
        <span class="rb-chip-label">${esc(fld.label)}</span>
        <button class="rb-chip-remove" data-zone="${zone}" data-idx="${idx}" title="제거">✕</button>
      </div>
    `;
  },

  _opLabel(op) {
    return { eq:'=', ne:'≠', like:'포함', gt:'>', lt:'<', gte:'≥', lte:'≤' }[op] || op;
  },

  // ─── 필드 맵 (key → meta) ─────────────────────────────
  _fieldsByKey() {
    if (!this._state.fields) return {};
    const map = {};
    this._state.fields.dimensions.forEach(d => { map[d.key] = { ...d, type: 'dimension' }; });
    this._state.fields.measures.forEach(m => { map[m.key] = { ...m, type: 'measure' }; });
    return map;
  },

  // ─── 이벤트 바인딩 ─────────────────────────────────────
  _bindEvents() {
    // 4개 drop zone
    ['rows','columns','filters','measures'].forEach(zone => {
      const el = document.querySelector(`.rb-zone[data-zone="${zone}"]`);
      if (!el) return;
      el.ondragover = e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        el.classList.add('drag-over');
      };
      el.ondragleave = () => el.classList.remove('drag-over');
      el.ondrop = e => {
        e.preventDefault();
        el.classList.remove('drag-over');
        try {
          const payload = JSON.parse(e.dataTransfer.getData('text/plain'));
          this._handleDrop(zone, payload);
        } catch (_) { /* invalid payload */ }
      };
    });

    // 차트 타입 변경
    document.getElementById('rb-chart-type').onchange = e => {
      this._state.config.chartType = e.target.value;
      this._runQuery();
    };

    // 툴바
    document.getElementById('rb-save-btn').onclick = () => this._openSaveModal();
    // Phase 2-A: 모달 → 사이드바 패널 토글로 변경
    document.getElementById('rb-load-btn').onclick = () => this._toggleSavedPanel();
    document.getElementById('rb-reset-btn').onclick = () => this._reset();

    // Phase 2-A: 사이드바 닫기 버튼
    document.getElementById('rb-saved-close')?.addEventListener('click', () => this._toggleSavedPanel(false));

    // Phase 2-A: 검색 디바운스
    const searchInput = document.getElementById('rb-saved-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', e => {
        clearTimeout(this._state._searchDebounce);
        this._state._searchDebounce = setTimeout(() => {
          this._state.savedSearchQuery = e.target.value;
          this._renderSavedList();
        }, 200);
      });
    }
  },

  // ─── 드롭 처리 ─────────────────────────────────────────
  _handleDrop(zone, payload) {
    const cfg = this._state.config;
    const { key, type } = payload;

    // 타입 매칭 검증
    if (zone === 'measures' && type !== 'measure') {
      Toast.warn('지표 영역에는 측정값만 놓을 수 있습니다');
      return;
    }
    if (zone !== 'measures' && type !== 'dimension') {
      Toast.warn('이 영역에는 차원만 놓을 수 있습니다');
      return;
    }

    if (zone === 'rows') {
      cfg.rows = [key]; // 1개만
    } else if (zone === 'columns') {
      cfg.columns = [key]; // 1개만
    } else if (zone === 'measures') {
      if (cfg.measures.includes(key)) return;
      if (cfg.measures.length >= 3) {
        Toast.warn('지표는 최대 3개까지 추가할 수 있습니다');
        return;
      }
      cfg.measures.push(key);
    } else if (zone === 'filters') {
      // 동일 필드 중복 방지
      if (cfg.filters.find(f => f.field === key)) {
        Toast.warn('이미 추가된 필터입니다');
        return;
      }
      cfg.filters.push({ field: key, op: 'eq', value: '' });
    }

    this._renderDropZones();
    this._runQuery();
  },

  _removeField(zone, idx) {
    const cfg = this._state.config;
    if (zone === 'rows' || zone === 'columns') {
      cfg[zone] = [];
    } else if (zone === 'measures') {
      cfg.measures.splice(idx, 1);
    } else if (zone === 'filters') {
      cfg.filters.splice(idx, 1);
    }
    this._renderDropZones();
    this._runQuery();
  },

  // ─── 쿼리 실행 ─────────────────────────────────────────
  async _runQuery() {
    const cfg = this._state.config;
    // 빈 필터(value 없음) 제외
    const queryConfig = {
      ...cfg,
      filters: cfg.filters.filter(f => f.value !== '' && f.value !== null),
    };

    if (queryConfig.rows.length === 0 && queryConfig.measures.length === 0) {
      this._clearChart();
      document.getElementById('rb-data-table').innerHTML =
        '<div class="rb-empty">행(Row) 또는 지표(Measure)를 추가하세요</div>';
      return;
    }

    try {
      const r = await API.reportBuilder.query(queryConfig);
      this._state.queryResult = r.data;
      this._renderChart(r.data);
      this._renderDataTable(r.data);
    } catch (err) {
      Toast.error('쿼리 실패: ' + (err.message || ''));
      this._clearChart();
    }
  },

  // ─── 차트 렌더링 ───────────────────────────────────────
  _renderChart(result) {
    const canvas = document.getElementById('rb-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    const ctx = canvas.getContext('2d');

    if (this._state.chart) {
      this._state.chart.destroy();
      this._state.chart = null;
    }

    const { rows, config } = result;
    if (!rows || rows.length === 0) {
      document.getElementById('rb-data-table').innerHTML = '<div class="rb-empty">조회된 데이터가 없습니다</div>';
      return;
    }

    const chartType = config.chartType;
    const fieldsMap = this._fieldsByKey();
    const measureKeys = config.measures;
    const colKey = config.columns[0];

    // ── chart.js 설정 ─────────────────────────────────
    const colors = [
      '#E63329', '#1A73E8', '#34A853', '#FBBC04', '#9C27B0',
      '#FF6B35', '#00BCD4', '#8BC34A', '#FF5722', '#673AB7',
    ];

    let chartConfig;

    if (chartType === 'pie') {
      // Pie: rows = labels, 첫 measure = values
      const labels = rows.map(r => String(r.row_key || '(없음)'));
      const data = rows.map(r => Number(r[measureKeys[0]] || 0));
      chartConfig = {
        type: 'doughnut',
        data: {
          labels,
          datasets: [{ data, backgroundColor: colors }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'right' } },
        },
      };
    } else if (chartType === 'line') {
      const labels = rows.map(r => String(r.row_key || ''));
      chartConfig = {
        type: 'line',
        data: {
          labels,
          datasets: measureKeys.map((m, i) => ({
            label: fieldsMap[m]?.label || m,
            data: rows.map(r => Number(r[m] || 0)),
            borderColor: colors[i],
            backgroundColor: colors[i] + '33',
            tension: 0.3,
          })),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'top' } },
        },
      };
    } else if (chartType === 'stacked-bar' && colKey) {
      // pivot: row_key → 행, col_key → 스택
      const rowKeys = [...new Set(rows.map(r => String(r.row_key)))];
      const colKeys = [...new Set(rows.map(r => String(r.col_key)))];
      const m = measureKeys[0];
      const pivot = {};
      for (const rk of rowKeys) pivot[rk] = {};
      for (const r of rows) pivot[String(r.row_key)][String(r.col_key)] = Number(r[m] || 0);
      chartConfig = {
        type: 'bar',
        data: {
          labels: rowKeys,
          datasets: colKeys.map((ck, i) => ({
            label: ck,
            data: rowKeys.map(rk => pivot[rk][ck] || 0),
            backgroundColor: colors[i % colors.length],
          })),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'top' } },
          scales: { x: { stacked: true }, y: { stacked: true } },
        },
      };
    } else {
      // bar (default)
      const labels = rows.map(r => String(r.row_key || ''));
      chartConfig = {
        type: 'bar',
        data: {
          labels,
          datasets: measureKeys.map((m, i) => ({
            label: fieldsMap[m]?.label || m,
            data: rows.map(r => Number(r[m] || 0)),
            backgroundColor: colors[i],
          })),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'top' } },
        },
      };
    }

    this._state.chart = new Chart(ctx, chartConfig);
  },

  _clearChart() {
    if (this._state.chart) {
      this._state.chart.destroy();
      this._state.chart = null;
    }
  },

  // ─── 데이터 테이블 (차트 하단) ─────────────────────────
  _renderDataTable(result) {
    const el = document.getElementById('rb-data-table');
    if (!el) return;
    const { rows } = result;
    if (!rows || rows.length === 0) {
      el.innerHTML = '<div class="rb-empty">데이터 없음</div>';
      return;
    }
    const columns = Object.keys(rows[0]);
    el.innerHTML = `
      <details class="rb-table-details">
        <summary>📋 데이터 테이블 (${rows.length}건)</summary>
        <table class="data-table" style="margin-top:8px">
          <thead>
            <tr>${columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr>
          </thead>
          <tbody>
            ${rows.slice(0, 50).map(r => `
              <tr>${columns.map(c => `<td>${esc(String(r[c] ?? ''))}</td>`).join('')}</tr>
            `).join('')}
          </tbody>
        </table>
        ${rows.length > 50 ? `<div style="padding:8px;color:var(--text-3);font-size:11px">...총 ${rows.length}건 중 50건 표시</div>` : ''}
      </details>
    `;
  },

  // ─── 저장 모달 ────────────────────────────────────────
  // 🛡 안전 우선 설계: 편집 중인 리포트가 있어도 기본값은 "새 리포트로 저장"
  //    사용자가 명시적으로 라디오 변경 시만 update (덮어쓰기)
  //    → 무심코 [저장] 클릭해서 기존 리포트 덮어쓰는 사고 방지
  _openSaveModal() {
    const cfg = this._state.config;
    if (cfg.rows.length === 0 && cfg.measures.length === 0) {
      Toast.warn('저장할 내용이 없습니다 — 행 또는 지표를 추가하세요');
      return;
    }
    const hasCurrent = !!this._state.currentId;
    const currentName = hasCurrent
      ? (this._state.savedReports.find(r => r.id === this._state.currentId)?.name || '현재 리포트')
      : '';

    // 모드 선택 라디오 (편집 중인 리포트 있을 때만 표시)
    const modeSelector = hasCurrent ? `
      <div class="rb-save-mode" style="grid-column:1 / -1;padding:10px 12px;background:var(--surface-2);border-radius:6px;font-size:12px">
        <div style="margin-bottom:6px;color:var(--text-2)">
          ⓘ 현재 편집 중: <strong>"${esc(currentName)}"</strong>
        </div>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:4px 0">
          <input type="radio" name="rb-save-mode" value="new" checked />
          <span>새 리포트로 저장 <span style="color:var(--text-3)">(기본, 안전)</span></span>
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:4px 0">
          <input type="radio" name="rb-save-mode" value="update" />
          <span>"${esc(currentName)}" 수정 <span style="color:var(--oci-red)">(덮어쓰기)</span></span>
        </label>
      </div>
    ` : '';

    Modal.open({
      title: '💾 리포트 저장',
      width: 480,
      body: `
        <div class="form-grid" style="grid-template-columns:90px 1fr;gap:10px 12px;align-items:center">
          ${modeSelector}
          <label class="form-label">이름 *</label>
          <input type="text" class="form-input" id="rb-save-name" maxlength="150" placeholder="예: 단계별 수주액 추이" />
          <label class="form-label">설명</label>
          <textarea class="form-input" id="rb-save-desc" maxlength="500" rows="2" placeholder="(선택)"></textarea>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="rb-save-cancel">취소</button>
        <button class="btn btn-primary" id="rb-save-ok">저장</button>
      `,
      bind: {
        '#rb-save-cancel': () => Modal.close(),
        '#rb-save-ok': async () => {
          const name = document.getElementById('rb-save-name').value.trim();
          const description = document.getElementById('rb-save-desc').value.trim();
          if (!name) { Toast.warn('이름을 입력하세요'); return; }

          // 라디오에서 'update' 선택 시만 덮어쓰기 (없으면 기본 'new')
          const modeEl = document.querySelector('input[name="rb-save-mode"]:checked');
          const isUpdate = hasCurrent && modeEl && modeEl.value === 'update';

          try {
            const data = { name, description, config_json: this._state.config };
            if (isUpdate) {
              await API.reportBuilder.update(this._state.currentId, data);
              Toast.success(`"${name}" 수정되었습니다`);
            } else {
              const r = await API.reportBuilder.save(data);
              this._state.currentId = r.data.id;
              Toast.success(`"${name}" 새 리포트로 저장되었습니다`);
            }
            Modal.close();
            await this._refreshSaved();
            this._renderSavedList();  // 편집중 ⭐ 표시 갱신
          } catch (err) {
            Toast.error('저장 실패: ' + (err.message || ''));
          }
        },
      },
      onOpen: () => {
        // 모드 변경 시 저장 버튼 라벨 업데이트 (시각적 피드백)
        if (!hasCurrent) return;
        const updateLabel = () => {
          const modeEl = document.querySelector('input[name="rb-save-mode"]:checked');
          const okBtn = document.getElementById('rb-save-ok');
          if (!okBtn || !modeEl) return;
          okBtn.textContent = modeEl.value === 'update' ? '수정 (덮어쓰기)' : '새 리포트로 저장';
        };
        document.querySelectorAll('input[name="rb-save-mode"]').forEach(r => {
          r.addEventListener('change', updateLabel);
        });
        updateLabel();
      },
    });
  },

  // ─── 불러오기 모달 ────────────────────────────────────
  _openLoadModal() {
    const rows = this._state.savedReports;
    Modal.open({
      title: '📂 내 리포트',
      width: 560,
      body: rows.length === 0 ? `
        <div style="padding:30px;text-align:center;color:var(--text-3)">
          저장된 리포트가 없습니다.<br>
          좌측에서 리포트를 구성한 후 💾 저장 버튼을 눌러보세요.
        </div>
      ` : `
        <table class="data-table">
          <thead>
            <tr>
              <th>이름</th>
              <th style="width:180px">최근 수정</th>
              <th style="width:140px;text-align:right">작업</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td>
                  <strong>${esc(r.name)}</strong>
                  ${r.description ? `<div style="font-size:11px;color:var(--text-3)">${esc(r.description)}</div>` : ''}
                </td>
                <td style="font-size:12px;color:var(--text-2)">${new Date(r.updated_at).toLocaleString('ko-KR')}</td>
                <td style="text-align:right;white-space:nowrap">
                  <button class="btn btn-ghost btn-sm" data-rb-load="${r.id}">📂 불러오기</button>
                  <button class="btn btn-ghost btn-sm" data-rb-del="${r.id}" style="color:var(--oci-red)">🗑</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `,
      footer: `<button class="btn btn-ghost" id="rb-load-close">닫기</button>`,
      bind: {
        '#rb-load-close': () => Modal.close(),
      },
    });

    // 동적 이벤트 — Modal.open 후
    setTimeout(() => {
      document.querySelectorAll('[data-rb-load]').forEach(btn => {
        btn.onclick = async () => {
          const id = parseInt(btn.dataset.rbLoad);
          try {
            const r = await API.reportBuilder.getSaved(id);
            const tpl = r.data;
            const cfg = typeof tpl.config_json === 'string' ? JSON.parse(tpl.config_json) : tpl.config_json;
            this._state.config = {
              datasource: cfg.datasource || 'leads',
              rows: cfg.rows || [],
              columns: cfg.columns || [],
              filters: cfg.filters || [],
              measures: cfg.measures || [],
              chartType: cfg.chartType || 'auto',
            };
            this._state.currentId = tpl.id;
            document.getElementById('rb-chart-type').value = this._state.config.chartType;
            this._renderDropZones();
            await this._runQuery();
            Modal.close();
            Toast.success(`"${tpl.name}" 불러오기 완료`);
          } catch (err) {
            Toast.error('불러오기 실패: ' + (err.message || ''));
          }
        };
      });
      document.querySelectorAll('[data-rb-del]').forEach(btn => {
        btn.onclick = async () => {
          const id = parseInt(btn.dataset.rbDel);
          if (!confirm('이 리포트를 삭제하시겠습니까?')) return;
          try {
            await API.reportBuilder.delete(id);
            Toast.success('삭제되었습니다');
            if (this._state.currentId === id) this._state.currentId = null;
            await this._refreshSaved();
            Modal.close();
            this._openLoadModal();
          } catch (err) {
            Toast.error('삭제 실패: ' + (err.message || ''));
          }
        };
      });
    }, 50);
  },

  async _refreshSaved() {
    try {
      const r = await API.reportBuilder.listSaved();
      this._state.savedReports = r.data || [];
      this._renderSavedList();
      this._updateSavedCountBadge();
    } catch (_) { /* ignore */ }
  },

  // ─── Phase 2-A: 사이드바 패널 토글 ────────────────────
  _toggleSavedPanel(forceState) {
    const panel = document.getElementById('rb-saved-panel');
    const body = document.getElementById('rb-body');
    if (!panel || !body) return;
    const next = typeof forceState === 'boolean' ? forceState : !this._state.savedPanelOpen;
    this._state.savedPanelOpen = next;
    if (next) {
      panel.style.display = 'flex';
      body.classList.add('rb-body--with-panel');
    } else {
      panel.style.display = 'none';
      body.classList.remove('rb-body--with-panel');
    }
  },

  _updateSavedCountBadge() {
    const badge = document.getElementById('rb-saved-count-badge');
    const headerCount = document.getElementById('rb-saved-count');
    const n = this._state.savedReports.length;
    if (badge) {
      if (n > 0) {
        badge.style.display = '';
        badge.textContent = `(${n})`;
        badge.style.cssText = 'display:inline;background:var(--surface-2);padding:1px 6px;border-radius:8px;font-size:10px;margin-left:4px;color:var(--text-2)';
      } else {
        badge.style.display = 'none';
      }
    }
    if (headerCount) headerCount.textContent = n > 0 ? `(${n})` : '';
  },

  // ─── Phase 2-A: 사이드바 카드 렌더링 ───────────────────
  _renderSavedList() {
    const list = document.getElementById('rb-saved-list');
    if (!list) return;
    const q = (this._state.savedSearchQuery || '').toLowerCase().trim();
    const reports = q
      ? this._state.savedReports.filter(r =>
          (r.name || '').toLowerCase().includes(q) ||
          (r.description || '').toLowerCase().includes(q))
      : this._state.savedReports;

    if (this._state.savedReports.length === 0) {
      list.innerHTML = `
        <div class="rb-saved-empty">
          <div class="rb-saved-empty-icon">📭</div>
          <div>아직 저장된 리포트가 없습니다.</div>
          <div style="font-size:11px;margin-top:6px">상단의 <strong>💾 저장</strong> 버튼으로<br>현재 구성을 저장해보세요.</div>
        </div>
      `;
      return;
    }
    if (reports.length === 0) {
      list.innerHTML = `
        <div class="rb-saved-empty">
          <div class="rb-saved-empty-icon">🔍</div>
          <div>"${esc(q)}" 검색 결과 없음</div>
        </div>
      `;
      return;
    }

    list.innerHTML = reports.map(r => this._savedCardHtml(r)).join('');

    // 카드 이벤트 바인딩
    list.querySelectorAll('[data-rb-saved-card]').forEach(card => {
      const id = parseInt(card.dataset.rbSavedCard, 10);
      // 카드 본체 클릭 = 불러오기
      card.addEventListener('click', e => {
        if (e.target.closest('[data-rb-card-action]')) return; // 액션 버튼은 별도 처리
        this._loadSavedById(id);
      });
    });
    list.querySelectorAll('[data-rb-card-action]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id, 10);
        const action = btn.dataset.rbCardAction;
        if (action === 'load') this._loadSavedById(id);
        else if (action === 'rename') this._openRenameModal(id);
        else if (action === 'delete') this._deleteSavedById(id);
      });
    });
  },

  _savedCardHtml(r) {
    const isActive = this._state.currentId === r.id;
    const cfg = (() => {
      try { return typeof r.config_json === 'string' ? JSON.parse(r.config_json) : (r.config_json || {}); }
      catch (_) { return {}; }
    })();
    const fieldsMap = this._fieldsByKey();
    const rowsLabel = (cfg.rows || []).map(k => fieldsMap[k]?.label || k).join(', ');
    const measLabel = (cfg.measures || []).map(k => fieldsMap[k]?.label || k).join(', ');
    const meta = [];
    if (rowsLabel) meta.push(`<span>📋 ${esc(rowsLabel)}</span>`);
    if (measLabel) meta.push(`<span>📐 ${esc(measLabel)}</span>`);

    return `
      <div class="rb-saved-card ${isActive ? 'rb-saved-card--active' : ''}" data-rb-saved-card="${r.id}" role="button" tabindex="0" title="클릭하여 불러오기">
        <div class="rb-saved-card-title">
          ${esc(r.name)}
          ${isActive ? '<span class="rb-saved-card-active-badge">편집중</span>' : ''}
        </div>
        ${r.description ? `<div class="rb-saved-card-desc">${esc(r.description)}</div>` : ''}
        ${meta.length ? `<div class="rb-saved-card-meta">${meta.join('')}</div>` : ''}
        <div class="rb-saved-card-time">${esc(this._relativeTime(r.updated_at))}</div>
        <div class="rb-saved-card-actions">
          <button data-rb-card-action="load" data-id="${r.id}" title="불러오기">📂 열기</button>
          <button data-rb-card-action="rename" data-id="${r.id}" title="이름/설명 변경">✏️</button>
          <button class="rb-del-btn" data-rb-card-action="delete" data-id="${r.id}" title="삭제">🗑</button>
        </div>
      </div>
    `;
  },

  _relativeTime(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d)) return '';
    const diff = Date.now() - d.getTime();
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return '방금 전';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}분 전`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}시간 전`;
    const days = Math.floor(hr / 24);
    if (days < 7) return `${days}일 전`;
    return d.toLocaleDateString('ko-KR');
  },

  // ─── Phase 2-A: 카드 액션 — 불러오기/삭제/이름변경 ─────
  async _loadSavedById(id) {
    try {
      const r = await API.reportBuilder.getSaved(id);
      const tpl = r.data;
      const cfg = typeof tpl.config_json === 'string' ? JSON.parse(tpl.config_json) : tpl.config_json;
      this._state.config = {
        datasource: cfg.datasource || 'leads',
        rows:       cfg.rows       || [],
        columns:    cfg.columns    || [],
        filters:    cfg.filters    || [],
        measures:   cfg.measures   || [],
        chartType:  cfg.chartType  || 'auto',
      };
      this._state.currentId = tpl.id;
      const ctype = document.getElementById('rb-chart-type');
      if (ctype) ctype.value = this._state.config.chartType;
      this._renderDropZones();
      await this._runQuery();
      this._renderSavedList();  // active 표시 갱신
      Toast.success(`"${tpl.name}" 불러오기 완료`);
    } catch (err) {
      Toast.error('불러오기 실패: ' + (err.message || ''));
    }
  },

  async _deleteSavedById(id) {
    const r = this._state.savedReports.find(x => x.id === id);
    if (!confirm(`"${r?.name || '리포트'}" 을(를) 삭제하시겠습니까?`)) return;
    try {
      await API.reportBuilder.delete(id);
      if (this._state.currentId === id) this._state.currentId = null;
      Toast.success('삭제되었습니다');
      await this._refreshSaved();
    } catch (err) {
      Toast.error('삭제 실패: ' + (err.message || ''));
    }
  },

  _openRenameModal(id) {
    const r = this._state.savedReports.find(x => x.id === id);
    if (!r) return;
    Modal.open({
      title: '✏️ 리포트 이름 변경',
      width: 440,
      body: `
        <div class="form-grid" style="grid-template-columns:90px 1fr;gap:10px 12px;align-items:center">
          <label class="form-label">이름 *</label>
          <input type="text" class="form-input" id="rb-rename-name" maxlength="150" value="${esc(r.name || '')}" />
          <label class="form-label">설명</label>
          <textarea class="form-input" id="rb-rename-desc" maxlength="500" rows="2">${esc(r.description || '')}</textarea>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="rb-rename-cancel">취소</button>
        <button class="btn btn-primary" id="rb-rename-ok">저장</button>
      `,
      bind: {
        '#rb-rename-cancel': () => Modal.close(),
        '#rb-rename-ok': async () => {
          const name = document.getElementById('rb-rename-name').value.trim();
          const description = document.getElementById('rb-rename-desc').value.trim();
          if (!name) { Toast.warn('이름을 입력하세요'); return; }
          try {
            // config_json 그대로 보내야 백엔드가 보존 — listSaved 응답에 config_json 포함
            const cfgJson = typeof r.config_json === 'string' ? JSON.parse(r.config_json) : (r.config_json || {});
            await API.reportBuilder.update(id, { name, description, config_json: cfgJson });
            Toast.success('이름이 변경되었습니다');
            Modal.close();
            await this._refreshSaved();
          } catch (err) {
            Toast.error('저장 실패: ' + (err.message || ''));
          }
        },
      },
    });
  },

  // ─── 초기화 ───────────────────────────────────────────
  _reset() {
    if (!confirm('현재 구성을 초기화하시겠습니까?')) return;
    this._state.config = {
      datasource: 'leads',
      rows: [],
      columns: [],
      filters: [],
      measures: [],
      chartType: 'auto',
    };
    this._state.currentId = null;
    document.getElementById('rb-chart-type').value = 'auto';
    this._renderDropZones();
    this._clearChart();
    document.getElementById('rb-data-table').innerHTML = '';
  },
};

window.ReportBuilderPage = ReportBuilderPage;
