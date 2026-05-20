// ============================================================
// QuotesPage — 견적서 (Phase 2: Combobox 영업리드 + Sortable + 자동계산 + VAT)
// 데이터: /api/quotes  (헤더 1 + 품목 N)
// ============================================================
const QuotesPage = (() => {
  // ── 모듈 상태 ────────────────────────────────────────────
  let _list = [];
  let _editing = null; // 수정 중인 견적 (null = 신규)
  let _items = []; // 모달 내부 품목 배열 (편집 중)
  let _columnLabels = null; // 컬럼 라벨 커스터마이징 (Phase 3 예정)
  let _leadsCache = []; // 영업리드 캐시 (모달 1회 fetch)
  let _comboboxes = []; // Combobox 인스턴스 (destroy 용)
  let _sortable = null; // Sortable 인스턴스 (destroy 용)

  // 기본 컬럼 라벨
  const DEFAULT_COLUMNS = {
    item_name: '품목',
    spec: '규격',
    unit_price: '단가',
    discount_pct: '할인(%)',
    supply_price: '공급단가',
    quantity: '수량',
    proposed_amount: '제안금액',
    remark: 'Remark',
  };

  // 컬럼 메타 — 데이터 타입은 고정, 라벨만 사용자 변경 가능
  const COLUMN_META = {
    item_name: { type: '텍스트' },
    spec: { type: '텍스트' },
    unit_price: { type: '통화 (KRW)' },
    discount_pct: { type: '백분율 0~100' },
    supply_price: { type: '통화 (자동 계산)' },
    quantity: { type: '숫자' },
    proposed_amount: { type: '통화 (자동 계산)' },
    remark: { type: '텍스트' },
  };
  // 그리드 th 인덱스 → 필드 매핑 ([0]drag, [1]idx, ..., [10]delete)
  const TH_FIELD_MAP = [
    '',
    '',
    'item_name',
    'spec',
    'unit_price',
    'discount_pct',
    'supply_price',
    'quantity',
    'proposed_amount',
    'remark',
    '',
  ];

  // ── 유틸 ─────────────────────────────────────────────────
  function _fmtKRW(n) {
    const v = Number(n) || 0;
    return v.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  }
  function _fmtDate(s) {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d)) return s;
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
  }
  function _toInputDate(s) {
    if (!s) return new Date().toISOString().slice(0, 10);
    const d = new Date(s);
    if (isNaN(d)) return new Date().toISOString().slice(0, 10);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  // 공급단가 = 단가 × (1 - 할인%/100)  — 할인 0% 인 경우 단가와 동일
  function _calcSupplyPrice(it) {
    const unit = Number(it.unit_price) || 0;
    const disc = Math.max(0, Math.min(100, Number(it.discount_pct) || 0));
    return Math.round(unit * (1 - disc / 100) * 100) / 100;
  }
  // 제안금액 = 공급단가 × 수량
  function _calcItemAmount(it) {
    const supply = _calcSupplyPrice(it);
    const qty = Number(it.quantity) || 0;
    return Math.round(supply * qty * 100) / 100;
  }

  // ── Phase 4 보강: 공급사 정보 localStorage 캐시 ──────────
  // 매번 입력 부담을 줄이기 위해 마지막 입력값을 브라우저에 저장
  const SUPPLIER_LS_KEY = 'oci_quote_supplier_info';
  function _loadSupplierInfo() {
    try {
      const raw = localStorage.getItem(SUPPLIER_LS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  }
  function _saveSupplierInfo(info) {
    try {
      localStorage.setItem(SUPPLIER_LS_KEY, JSON.stringify(info));
    } catch (_) {
      /* quota 등 무시 */
    }
  }

  // 인스턴스 정리 (모달 닫힘 시)
  function _cleanupInstances() {
    _comboboxes.forEach((c) => {
      try {
        c.destroy?.();
      } catch (_) {}
    });
    _comboboxes = [];
    try {
      _sortable?.destroy?.();
    } catch (_) {}
    _sortable = null;
  }

  // ── 페이지 렌더 ──────────────────────────────────────────
  async function render() {
    const content = document.getElementById('content');
    content.innerHTML = `
      <div class="filter-bar">
        <input class="search-input" id="qt-search" placeholder="견적명·고객명·번호 검색...">
        <select class="filter-select" id="qt-status">
          <option value="">전체 상태</option>
          <option value="draft">초안</option>
          <option value="sent">발송됨</option>
          <option value="accepted">수주</option>
          <option value="rejected">실패</option>
        </select>
        <div style="margin-left:auto;display:flex;gap:8px">
          <button class="btn btn-primary" id="qt-new-btn">+ 견적서 작성</button>
        </div>
      </div>
      <div id="qt-list-wrap">
        <div class="loading" style="padding:40px;text-align:center">로딩...</div>
      </div>
    `;

    document.getElementById('qt-new-btn').addEventListener('click', () => _openModal(null));
    document.getElementById('qt-search').addEventListener('input', _debounce(_reload, 250));
    document.getElementById('qt-status').addEventListener('change', _reload);

    await _reload();
  }

  function _debounce(fn, ms) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  async function _reload() {
    const search = document.getElementById('qt-search')?.value || '';
    const status = document.getElementById('qt-status')?.value || '';
    const wrap = document.getElementById('qt-list-wrap');
    if (!wrap) return;
    try {
      const res = await API.quotes.list({ search, status, limit: 100 });
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
        등록된 견적서가 없습니다. <br>우측 상단의 [+ 견적서 작성] 버튼을 눌러 시작하세요.
      </div>`;
    }
    return `
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:130px">견적번호</th>
            <th>견적명</th>
            <th style="width:160px">고객명</th>
            <th style="width:110px">견적일</th>
            <th style="width:60px;text-align:center">VAT</th>
            <th style="width:140px;text-align:right">총액</th>
            <th style="width:70px;text-align:center">Rev</th>
            <th style="width:80px;text-align:center">상태</th>
            <th style="width:260px;text-align:center">작업</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (r) => `
            <tr data-id="${r.id}">
              <td style="font-family:monospace;font-size:12px">${esc(r.quote_no)}</td>
              <td><a href="#" class="qt-link" data-id="${r.id}" style="color:var(--oci-red);font-weight:500">${esc(r.name)}</a></td>
              <td>${esc(r.customer_name || '')}</td>
              <td>${_fmtDate(r.quote_date)}</td>
              <td style="text-align:center">${r.vat_included ? '포함' : '별도'}</td>
              <td style="text-align:right;font-weight:500">₩${_fmtKRW(r.total_amount)}</td>
              <td style="text-align:center">${r.revision_no || 1}</td>
              <td style="text-align:center"><span class="badge badge-${_statusColor(r.status)}">${_statusLabel(r.status)}</span></td>
              <td style="text-align:center">
                <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${r.id}">편집</button>
                <button class="btn btn-ghost btn-sm" data-act="preview" data-id="${r.id}" title="미리보기">👁</button>
                <button class="btn btn-ghost btn-sm" data-act="pdf" data-id="${r.id}" title="PDF 내보내기">📄</button>
                <button class="btn btn-ghost btn-sm" data-act="duplicate" data-id="${r.id}" title="리비전 복사">📋</button>
                <button class="btn btn-ghost btn-sm" data-act="delete" data-id="${r.id}" style="color:#d93025">삭제</button>
              </td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    `;
  }

  function _statusColor(s) {
    return s === 'accepted' ? 'green' : s === 'rejected' ? 'red' : s === 'sent' ? 'blue' : 'gray';
  }
  function _statusLabel(s) {
    return { draft: '초안', sent: '발송됨', accepted: '수주', rejected: '실패' }[s] || '초안';
  }

  function _bindListEvents() {
    document.querySelectorAll('.qt-link').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const id = parseInt(a.dataset.id, 10);
        _openModal(id);
      });
    });
    document.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const id = parseInt(btn.dataset.id, 10);
        const act = btn.dataset.act;
        if (act === 'edit') _openModal(id);
        else if (act === 'preview') _openPreview(id);
        else if (act === 'pdf') _exportPdf(id);
        else if (act === 'duplicate') _duplicate(id);
        else if (act === 'delete') _delete(id);
      });
    });
  }

  async function _duplicate(id) {
    if (!confirm('이 견적의 리비전 복사본을 만들까요?')) return;
    try {
      const res = await API.quotes.duplicate(id);
      Toast.success(`Rev ${res.data?.revision_no} 생성됨 — ${res.data?.quote_no}`);
      await _reload();
    } catch (err) {
      Toast.error('복사 실패: ' + (err.message || err));
    }
  }
  async function _delete(id) {
    if (!confirm('이 견적서를 삭제하시겠습니까? 품목도 함께 삭제됩니다.')) return;
    try {
      await API.quotes.delete(id);
      Toast.success('삭제됨');
      await _reload();
    } catch (err) {
      Toast.error('삭제 실패: ' + (err.message || err));
    }
  }

  // ── 영업리드 캐시 (모달 1회 fetch) ──────────────────────
  async function _ensureLeads() {
    if (_leadsCache.length > 0) return;
    try {
      const res = await API.leads.list({ limit: 500 });
      _leadsCache = res.data || [];
    } catch (_) {
      _leadsCache = [];
    }
  }

  // ── 모달 (생성/편집) ─────────────────────────────────────
  async function _openModal(id) {
    _editing = null;
    _items = [];
    _columnLabels = null;
    _cleanupInstances();

    // 영업리드 캐시 prefetch (Combobox 용) — 병렬
    const leadsPromise = _ensureLeads();

    if (id) {
      try {
        const res = await API.quotes.get(id);
        _editing = res.data;
        _items = (_editing.items || []).map((it) => ({ ...it }));
        _columnLabels = _editing.column_labels || null;
      } catch (err) {
        Toast.error('견적 정보 불러오기 실패: ' + (err.message || err));
        return;
      }
    } else {
      _items = [_blankItem()];
    }
    await leadsPromise;

    // Phase 4 보강: 신규 작성 시 localStorage 의 공급사 정보 자동 채움 (편의)
    const supplierCache = _editing ? {} : _loadSupplierInfo();
    const e = _editing || {
      quote_no: '(저장 시 자동 생성)',
      name: '',
      customer_name: '',
      customer_contact: '',
      quote_date: new Date().toISOString().slice(0, 10),
      vat_included: 0,
      status: 'draft',
      revision_no: 1,
      lead_id: null,
      supplier_company_name: supplierCache.supplier_company_name || '',
      supplier_address: supplierCache.supplier_address || '',
      supplier_ceo: supplierCache.supplier_ceo || '',
      sales_rep_name: supplierCache.sales_rep_name || '',
      sales_rep_contact: supplierCache.sales_rep_contact || '',
      terms_conditions: '',
    };

    Modal.open({
      title: id ? `📝 견적서 편집 — ${esc(e.quote_no)}` : '✏️ 새 견적서',
      width: 1180,
      body: _renderModalBody(e),
      footer: `
        <button class="btn btn-ghost" id="qt-cancel-btn">취소</button>
        <button class="btn btn-primary" id="qt-save-btn">💾 저장</button>
      `,
      // 🛡 외부 클릭으로 닫히지 않음 — 폼 데이터 보호 (× 버튼/취소 버튼만 허용)
      disableOverlayClose: true,
      bind: {
        '#qt-cancel-btn': () => {
          _cleanupInstances();
          Modal.close();
        },
        '#qt-save-btn': () => _save(),
      },
      onOpen: () => {
        _bindModalEvents();
        _attachLeadCombobox(e.lead_id || null);
        // Phase 3-B: 편집 모드 진입 시 lead 정보 표시
        if (e.lead_id) {
          const linkedLead = _leadsCache.find((l) => String(l.id) === String(e.lead_id));
          if (linkedLead) _showLeadInfo(linkedLead);
        }
        _renderItems();
        _recalcTotals();
      },
    });
  }

  function _blankItem() {
    return {
      item_name: '',
      spec: '',
      unit_price: 0,
      discount_pct: 0,
      supply_price: 0,
      quantity: 1,
      proposed_amount: 0,
      remark: '',
    };
  }

  // 초기 lead_id 가 있을 때 input 에 표시할 텍스트 ("고객사 - 프로젝트")
  function _leadInitialText(leadId) {
    if (!leadId) return '';
    const l = _leadsCache.find((x) => String(x.id) === String(leadId));
    if (!l) return '';
    return `${l.customer_name || ''}${l.project_name ? ' - ' + l.project_name : ''}`;
  }

  function _renderModalBody(e) {
    const cols = _columnLabels || DEFAULT_COLUMNS;
    return `
      <div class="qt-modal">
        <!-- 헤더 정보 -->
        <div class="form-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px">
          <div class="form-row">
            <label class="form-label">견적번호</label>
            <input class="form-input" id="qt-f-quote_no" value="${esc(e.quote_no || '')}"
              ${e.id ? 'readonly style="background:#f5f5f7;color:#666"' : 'placeholder="(저장 시 자동 생성)"'}>
          </div>
          <div class="form-row">
            <label class="form-label required">견적일</label>
            <input class="form-input" id="qt-f-quote_date" type="date" value="${_toInputDate(e.quote_date)}">
          </div>
          <div class="form-row">
            <label class="form-label">상태</label>
            <select class="form-input" id="qt-f-status">
              <option value="draft"    ${e.status === 'draft' ? 'selected' : ''}>초안</option>
              <option value="sent"     ${e.status === 'sent' ? 'selected' : ''}>발송됨</option>
              <option value="accepted" ${e.status === 'accepted' ? 'selected' : ''}>수주</option>
              <option value="rejected" ${e.status === 'rejected' ? 'selected' : ''}>실패</option>
            </select>
          </div>
          <!-- 영업리드 Combobox (선택 시 견적명/고객명 자동 채우기) -->
          <div class="form-row" style="grid-column:1 / span 2">
            <label class="form-label">💼 영업리드 연결 (선택)</label>
            <input class="form-input" id="qt-f-lead-input"
              value="${esc(_leadInitialText(e.lead_id))}"
              placeholder="🔍 고객사 또는 프로젝트명 1글자 이상 입력 → 자동완성 → 선택 시 견적명·고객명 채움">
            <input type="hidden" id="qt-f-lead_id" value="${e.lead_id || ''}">
            <input type="hidden" id="qt-f-customer_id" value="${e.customer_id || ''}">
            <!-- 선택된 lead 정보 패널 (편집 시 / 선택 시 표시) -->
            <div id="qt-lead-info" style="display:none;margin-top:6px;padding:8px 12px;background:#f0f7ff;border:1px solid #d0e3ff;border-radius:4px;font-size:12px;color:var(--text-2)">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
                <div style="display:flex;gap:16px;flex-wrap:wrap">
                  <span id="qt-lead-info-stage">📊 단계: <strong>-</strong></span>
                  <span id="qt-lead-info-amount">💰 예상금액: <strong>₩0</strong></span>
                </div>
                <button class="btn btn-ghost btn-sm" id="qt-lead-clear-btn" type="button" style="color:#d93025;flex-shrink:0">연결 해제</button>
              </div>
            </div>
          </div>
          <div class="form-row">
            <label class="form-label">단가구분</label>
            <select class="form-input" id="qt-f-vat_included">
              <option value="0" ${!e.vat_included ? 'selected' : ''}>부가세 미포함 (가산 안 함)</option>
              <option value="1" ${e.vat_included ? 'selected' : ''}>부가세 포함 (10% 자동 가산)</option>
            </select>
          </div>
          <div class="form-row" style="grid-column:1 / span 2">
            <label class="form-label required">견적명</label>
            <input class="form-input" id="qt-f-name" value="${esc(e.name || '')}" placeholder="견적서 제목 입력">
          </div>
          <div class="form-row">
            <label class="form-label required">고객사명</label>
            <input class="form-input" id="qt-f-customer_name" value="${esc(e.customer_name || '')}" placeholder="고객사 명">
          </div>
          <div class="form-row">
            <label class="form-label">고객사 담당자명</label>
            <input class="form-input" id="qt-f-customer_contact" value="${esc(e.customer_contact || '')}" placeholder="고객사 담당자 이름">
          </div>
        </div>

        <!-- 📑 공급사 정보 (collapsible) — localStorage 자동 채움 -->
        <div style="border:1px solid var(--border);border-radius:6px;background:#fafafa;margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;cursor:pointer" id="qt-supplier-toggle">
            <strong style="font-size:13px;color:var(--text-2)">📑 공급사 정보 — PDF 우측 상단 출력 영역 <span style="color:var(--text-3);font-weight:400">(localStorage 자동 저장)</span></strong>
            <span id="qt-supplier-chevron" style="color:var(--text-3)">▼</span>
          </div>
          <div id="qt-supplier-body" style="padding:12px 14px;border-top:1px solid var(--border);display:none">
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
              <div class="form-row">
                <label class="form-label">회사명</label>
                <input class="form-input" id="qt-f-supplier_company_name" value="${esc(e.supplier_company_name || '')}" placeholder="공급사 회사명">
              </div>
              <div class="form-row" style="grid-column:2 / span 2">
                <label class="form-label">회사 주소</label>
                <input class="form-input" id="qt-f-supplier_address" value="${esc(e.supplier_address || '')}" placeholder="공급사 주소">
              </div>
              <div class="form-row">
                <label class="form-label">대표자</label>
                <input class="form-input" id="qt-f-supplier_ceo" value="${esc(e.supplier_ceo || '')}" placeholder="대표자명">
              </div>
              <div class="form-row">
                <label class="form-label">영업담당</label>
                <input class="form-input" id="qt-f-sales_rep_name" value="${esc(e.sales_rep_name || '')}" placeholder="영업담당자명">
              </div>
              <div class="form-row">
                <label class="form-label">영업담당 연락처 / 이메일</label>
                <input class="form-input" id="qt-f-sales_rep_contact" value="${esc(e.sales_rep_contact || '')}" placeholder="010-0000-0000 / sales@company.co.kr">
              </div>
            </div>
          </div>
        </div>

        <!-- 품목 그리드 -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 6px">
          <h4 style="margin:0;font-size:14px;color:var(--text-2)">📦 품목 목록 <span style="color:var(--text-3);font-weight:400;font-size:12px">— 드래그 핸들(⋮⋮)로 순서 변경</span></h4>
          <div style="display:flex;gap:6px">
            <button class="btn btn-ghost btn-sm" id="qt-col-edit-btn" type="button" title="컬럼 라벨 편집 — 데이터 타입은 고정">✏️ 컬럼 라벨</button>
            <button class="btn btn-ghost btn-sm" id="qt-add-item-btn" type="button">+ 행 추가</button>
          </div>
        </div>
        ${_renderColumnEditPanel()}
        <div style="overflow-x:auto;border:1px solid var(--border);border-radius:6px;background:#fff">
          <table class="data-table" id="qt-items-table" style="margin:0">
            <thead>
              <tr>
                <th style="width:30px"></th>
                <th style="width:30px"></th>
                <th style="min-width:160px">${esc(cols.item_name)}</th>
                <th style="width:110px">${esc(cols.spec)}</th>
                <th style="width:120px;text-align:right">${esc(cols.unit_price)}</th>
                <th style="width:80px;text-align:right">${esc(cols.discount_pct)}</th>
                <th style="width:120px;text-align:right" title="단가 × (1 - 할인%/100) — 자동 계산">${esc(cols.supply_price)} <span style="font-weight:400;color:var(--text-3);font-size:11px">(자동)</span></th>
                <th style="width:80px;text-align:right">${esc(cols.quantity)}</th>
                <th style="width:130px;text-align:right" title="공급단가 × 수량 — 자동 계산">${esc(cols.proposed_amount)} <span style="font-weight:400;color:var(--text-3);font-size:11px">(자동)</span></th>
                <th style="min-width:140px">${esc(cols.remark)}</th>
                <th style="width:40px"></th>
              </tr>
            </thead>
            <tbody id="qt-items-tbody"></tbody>
          </table>
        </div>

        <!-- 합계 -->
        <div style="display:flex;justify-content:flex-end;margin-top:14px">
          <table style="border-collapse:collapse;font-size:13px">
            <tr>
              <td style="padding:4px 12px;color:var(--text-3);text-align:right">소계:</td>
              <td style="padding:4px 12px;text-align:right;font-weight:500;min-width:140px" id="qt-subtotal">₩0</td>
            </tr>
            <tr>
              <td style="padding:4px 12px;color:var(--text-3);text-align:right" id="qt-vat-label">부가세 (10%):</td>
              <td style="padding:4px 12px;text-align:right;font-weight:500" id="qt-vat">₩0</td>
            </tr>
            <tr style="border-top:1px solid var(--border)">
              <td style="padding:8px 12px;font-weight:600;text-align:right">총합계:</td>
              <td style="padding:8px 12px;text-align:right;font-weight:700;color:var(--oci-red);font-size:16px" id="qt-total">₩0</td>
            </tr>
          </table>
        </div>

        <!-- 📝 조건사항 (Remark) — PDF 품목 하단 출력 -->
        <div style="margin-top:16px">
          <label class="form-label" style="display:block;margin-bottom:4px">📝 조건사항 / Remark <span style="color:var(--text-3);font-weight:400;font-size:11px">— PDF 품목 하단에 출력됨</span></label>
          <textarea class="form-input" id="qt-f-terms_conditions" rows="4" placeholder="예) 1. 본 견적의 유효기간은 발행일로부터 30일 입니다.&#10;2. 부가세 별도&#10;3. 납기: 발주 후 4주" style="resize:vertical;font-family:inherit;line-height:1.5">${esc(e.terms_conditions || '')}</textarea>
        </div>
      </div>
    `;
  }

  function _renderItems() {
    const tbody = document.getElementById('qt-items-tbody');
    if (!tbody) return;
    if (!_items.length) {
      tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:30px;color:var(--text-3)">+ 행 추가 버튼으로 품목을 등록하세요</td></tr>`;
      _destroySortable();
      return;
    }
    tbody.innerHTML = _items
      .map(
        (it, idx) => `
      <tr data-idx="${idx}">
        <td class="qt-drag-handle" title="드래그로 순서 변경" style="cursor:grab;text-align:center;color:var(--text-3);user-select:none;font-size:14px">⋮⋮</td>
        <td style="text-align:center;color:var(--text-3);font-size:11px">${idx + 1}</td>
        <td><input class="form-input qt-it-input" data-f="item_name" data-idx="${idx}" value="${esc(it.item_name || '')}" style="padding:4px 6px"></td>
        <td><input class="form-input qt-it-input" data-f="spec" data-idx="${idx}" value="${esc(it.spec || '')}" style="padding:4px 6px"></td>
        <td><input class="form-input qt-it-input" data-f="unit_price" type="number" step="0.01" min="0" data-idx="${idx}" value="${it.unit_price || 0}" style="padding:4px 6px;text-align:right"></td>
        <td><input class="form-input qt-it-input" data-f="discount_pct" type="number" step="0.01" min="0" max="100" data-idx="${idx}" value="${it.discount_pct || 0}" style="padding:4px 6px;text-align:right"></td>
        <td style="text-align:right;color:var(--text-2);padding:8px 6px;background:#fafafa" id="qt-it-supply-${idx}" title="단가 × (1 - 할인%/100) — 자동 계산">₩${_fmtKRW(_calcSupplyPrice(it))}</td>
        <td><input class="form-input qt-it-input" data-f="quantity" type="number" step="0.01" min="0" data-idx="${idx}" value="${it.quantity || 0}" style="padding:4px 6px;text-align:right"></td>
        <td style="text-align:right;font-weight:500;padding:8px 6px" id="qt-it-amount-${idx}" title="공급단가 × 수량 — 자동 계산">₩${_fmtKRW(_calcItemAmount(it))}</td>
        <td><input class="form-input qt-it-input" data-f="remark" data-idx="${idx}" value="${esc(it.remark || '')}" style="padding:4px 6px"></td>
        <td style="text-align:center"><button class="btn btn-ghost btn-sm qt-it-del" data-idx="${idx}" type="button" title="삭제" style="color:#d93025">×</button></td>
      </tr>
    `
      )
      .join('');

    // 인풋 → 상태 동기화
    tbody.querySelectorAll('.qt-it-input').forEach((inp) => {
      inp.addEventListener('input', _onItemInput);
    });
    tbody.querySelectorAll('.qt-it-del').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        _items.splice(idx, 1);
        _renderItems();
        _recalcTotals();
      });
    });

    // Sortable 재초기화 — 드래그앤드롭 행 순서 변경
    _initSortable(tbody);
  }

  // ── Sortable.js — 품목 행 드래그앤드롭 ────────────────────
  function _destroySortable() {
    try {
      _sortable?.destroy?.();
    } catch (_) {}
    _sortable = null;
  }

  function _initSortable(tbody) {
    _destroySortable();
    if (typeof Sortable === 'undefined') return; // Sortable 미로드 시 graceful skip
    _sortable = new Sortable(tbody, {
      animation: 150,
      handle: '.qt-drag-handle',
      ghostClass: 'qt-row-ghost',
      onEnd: (evt) => {
        if (evt.oldIndex === evt.newIndex) return;
        // _items 배열 reorder
        const moved = _items.splice(evt.oldIndex, 1)[0];
        _items.splice(evt.newIndex, 0, moved);
        // display_order 재계산 + 행 re-render (data-idx 갱신 위해)
        _renderItems();
        _recalcTotals();
      },
    });
  }

  // ── Phase 3-A: 컬럼 라벨 편집 패널 ───────────────────────
  // 사용자가 그리드 컬럼 라벨을 견적서마다 자유롭게 변경 가능
  // (데이터 타입은 고정 — varchar/number 등 비즈니스 안정성)
  function _renderColumnEditPanel() {
    const labels = _columnLabels || { ...DEFAULT_COLUMNS };
    return `
      <div id="qt-col-edit-panel" style="display:none;border:1px solid #d0e3ff;background:#f0f7ff;border-radius:6px;padding:12px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <strong style="font-size:13px">📐 컬럼 라벨 편집 — 데이터 타입은 고정</strong>
          <div style="display:flex;gap:6px">
            <button class="btn btn-ghost btn-sm" id="qt-col-reset-btn" type="button">기본값 복원</button>
            <button class="btn btn-ghost btn-sm" id="qt-col-cancel-btn" type="button">닫기</button>
            <button class="btn btn-primary btn-sm" id="qt-col-apply-btn" type="button">적용</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
          ${Object.entries(COLUMN_META)
            .map(
              ([key, meta]) => `
            <div>
              <label style="display:block;font-size:11px;color:var(--text-3);margin-bottom:2px">${esc(meta.type)}</label>
              <input class="form-input qt-col-input" data-col="${key}" value="${esc(labels[key] || DEFAULT_COLUMNS[key])}" style="padding:4px 6px;font-size:12px" maxlength="30">
            </div>
          `
            )
            .join('')}
        </div>
      </div>
    `;
  }

  function _toggleColumnPanel(forceState) {
    const panel = document.getElementById('qt-col-edit-panel');
    if (!panel) return;
    const next = forceState === undefined ? panel.style.display === 'none' : forceState;
    panel.style.display = next ? 'block' : 'none';
  }

  function _resetColumnLabelsInputs() {
    document.querySelectorAll('.qt-col-input').forEach((inp) => {
      inp.value = DEFAULT_COLUMNS[inp.dataset.col] || '';
    });
  }

  function _applyColumnLabels() {
    const newLabels = {};
    document.querySelectorAll('.qt-col-input').forEach((inp) => {
      const key = inp.dataset.col;
      newLabels[key] = (inp.value || '').trim() || DEFAULT_COLUMNS[key];
    });
    _columnLabels = newLabels;
    _updateColumnHeaders();
    _toggleColumnPanel(false);
    Toast.success('컬럼 라벨이 변경되었습니다 (저장 시 함께 반영)');
  }

  // 그리드 thead 의 텍스트만 부분 갱신 (전체 re-render 회피)
  function _updateColumnHeaders() {
    const cols = _columnLabels || DEFAULT_COLUMNS;
    const table = document.getElementById('qt-items-table');
    if (!table) return;
    const ths = table.querySelectorAll('thead th');
    TH_FIELD_MAP.forEach((field, idx) => {
      if (!field) return;
      const th = ths[idx];
      if (!th) return;
      const isAuto = field === 'supply_price' || field === 'proposed_amount';
      th.innerHTML = isAuto
        ? `${esc(cols[field])} <span style="font-weight:400;color:var(--text-3);font-size:11px">(자동)</span>`
        : esc(cols[field]);
    });
  }

  // ── Phase 3-B: 영업딜 정보 표시 ──────────────────────────
  // leads API 필드: expected_amount (원본 통화) / currency / amount_krw (KRW 환산)
  // 표시: 원본 금액 (Fmt.amount) + 외화면 KRW 환산 보조 표시 — pipeline.js 와 동일 패턴
  function _showLeadInfo(item) {
    const info = document.getElementById('qt-lead-info');
    if (!info || !item) return;
    const stageEl = document.getElementById('qt-lead-info-stage');
    const amountEl = document.getElementById('qt-lead-info-amount');
    if (stageEl) stageEl.innerHTML = `📊 단계: <strong>${esc(item.stage || '-')}</strong>`;
    if (amountEl) {
      const cur = item.currency || 'KRW';
      const primary = Fmt.amount(item.expected_amount, cur);
      let html = `💰 예상금액: <strong>${esc(primary)}</strong>`;
      if (cur !== 'KRW' && item.amount_krw) {
        html += ` <span style="color:var(--text-3)">(≈ ${esc(Fmt.krw(item.amount_krw))})</span>`;
      }
      amountEl.innerHTML = html;
    }
    info.style.display = 'block';
  }
  function _hideLeadInfo() {
    const info = document.getElementById('qt-lead-info');
    if (info) info.style.display = 'none';
  }
  function _clearLead() {
    const input = document.getElementById('qt-f-lead-input');
    const hidden = document.getElementById('qt-f-lead_id');
    const custHidden = document.getElementById('qt-f-customer_id');
    if (input) input.value = '';
    if (hidden) hidden.value = '';
    if (custHidden) custHidden.value = '';
    _hideLeadInfo();
  }

  // ── 영업리드 Combobox ────────────────────────────────────
  // 선택 시: hidden lead_id 저장 + 견적명/고객명 자동 채움 (단, 사용자가
  // 이미 입력한 값은 덮어쓰지 않음 — 안전)
  function _attachLeadCombobox(initialLeadId) {
    const input = document.getElementById('qt-f-lead-input');
    const hidden = document.getElementById('qt-f-lead_id');
    if (!input || !hidden || typeof Combobox === 'undefined') return null;

    // 직접 비우면 hidden id 도 초기화
    input.addEventListener('input', () => {
      if (!input.value.trim()) hidden.value = '';
    });

    const cb = Combobox.attach({
      inputEl: input,
      fetchFn: (q) => {
        const ql = (q || '').toLowerCase();
        if (!ql) return _leadsCache.slice(0, 20);
        return _leadsCache
          .filter(
            (l) =>
              (l.customer_name || '').toLowerCase().includes(ql) ||
              (l.project_name || '').toLowerCase().includes(ql)
          )
          .slice(0, 20);
      },
      renderItem: (item, q, { highlightMatch }) => {
        const title = `${highlightMatch(item.customer_name || '', q)}${
          item.project_name ? ' - ' + highlightMatch(item.project_name, q) : ''
        }`;
        const meta = [];
        if (item.stage) meta.push(esc(item.stage));
        // leads API 필드: expected_amount + currency (원본) / amount_krw (KRW 환산)
        if (item.expected_amount) {
          meta.push(esc(Fmt.amount(item.expected_amount, item.currency || 'KRW')));
        }
        return `
          <div class="combobox-item-content">
            <div class="combobox-item-title">💼 ${title}</div>
            ${meta.length ? `<div class="combobox-item-meta">${meta.join(' · ')}</div>` : ''}
          </div>
        `;
      },
      onSelect: (item) => {
        const display = `${item.customer_name || ''}${
          item.project_name ? ' - ' + item.project_name : ''
        }`;
        input.value = display;
        hidden.value = item.id;
        // Phase 3-B: customer_id 도 함께 저장 (편집/조회 시 신뢰성)
        const custIdHidden = document.getElementById('qt-f-customer_id');
        if (custIdHidden) custIdHidden.value = item.customer_id || '';
        // 자동 채움 — 사용자가 이미 입력한 경우는 보존
        const nameEl = document.getElementById('qt-f-name');
        const custEl = document.getElementById('qt-f-customer_name');
        if (nameEl && !nameEl.value.trim()) {
          nameEl.value = item.project_name
            ? `${item.customer_name || ''} - ${item.project_name} 견적`
            : `${item.customer_name || ''} 견적`;
        }
        if (custEl && !custEl.value.trim() && item.customer_name) {
          custEl.value = item.customer_name;
        }
        // Phase 3-B: lead 정보 패널 표시 (단계 + 예상금액)
        _showLeadInfo(item);
      },
      // 🐛 fix: minChars=0 시 focus 만으로 dropdown 열렸다가 닫힘 (반짝 버그)
      //   - 빈 쿼리 시 캐시 미준비/0건 상황에서 즉시 close 됨
      //   - 캘린더 lead picker 와 동일한 minChars:1 로 통일 (안정)
      //   - placeholder 안내문으로 사용자에게 입력 유도
      minChars: 1,
      debounceMs: 100,
      allowCustom: false,
    });
    _comboboxes.push(cb);
    void initialLeadId; // 표시값은 _leadInitialText 가 처리
    return cb;
  }

  function _onItemInput(e) {
    const inp = e.target;
    const idx = parseInt(inp.dataset.idx, 10);
    const field = inp.dataset.f;
    if (!_items[idx]) return;
    // ⚠️ supply_price 는 더 이상 사용자 입력 아님 (자동 계산)
    const isNumeric = ['unit_price', 'discount_pct', 'quantity'].includes(field);
    _items[idx][field] = isNumeric ? Number(inp.value) || 0 : inp.value;
    // 공급단가 + 제안금액 즉시 갱신
    if (isNumeric) {
      const supply = _calcSupplyPrice(_items[idx]);
      _items[idx].supply_price = supply;
      const amt = _calcItemAmount(_items[idx]);
      _items[idx].proposed_amount = amt;
      const supplyCell = document.getElementById(`qt-it-supply-${idx}`);
      if (supplyCell) supplyCell.textContent = '₩' + _fmtKRW(supply);
      const amountCell = document.getElementById(`qt-it-amount-${idx}`);
      if (amountCell) amountCell.textContent = '₩' + _fmtKRW(amt);
      _recalcTotals();
    }
  }

  function _recalcTotals() {
    const subtotal = _items.reduce((s, it) => s + _calcItemAmount(it), 0);
    const vatIncluded = document.getElementById('qt-f-vat_included')?.value === '1';
    // 부가세 포함 = 10% 가산 / 미포함 = 가산 안 함 (사용자 의도)
    const vat = vatIncluded ? Math.round(subtotal * 0.1 * 100) / 100 : 0;
    const total = subtotal + vat;
    const setText = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = '₩' + _fmtKRW(v);
    };
    setText('qt-subtotal', subtotal);
    setText('qt-vat', vat);
    setText('qt-total', total);
    // VAT 라벨 — 포함 시 가산 안내, 미포함 시 가산 안 함 안내
    const lbl = document.getElementById('qt-vat-label');
    if (lbl) lbl.textContent = vatIncluded ? '부가세 (10% 가산):' : '부가세 (미포함):';
  }

  function _bindModalEvents() {
    document.getElementById('qt-add-item-btn')?.addEventListener('click', () => {
      _items.push(_blankItem());
      _renderItems();
      _recalcTotals();
    });
    // VAT 토글 즉시 반영
    document.getElementById('qt-f-vat_included')?.addEventListener('change', _recalcTotals);

    // Phase 3-A: 컬럼 라벨 편집 패널 이벤트
    document.getElementById('qt-col-edit-btn')?.addEventListener('click', () => _toggleColumnPanel());
    document.getElementById('qt-col-cancel-btn')?.addEventListener('click', () => _toggleColumnPanel(false));
    document.getElementById('qt-col-apply-btn')?.addEventListener('click', _applyColumnLabels);
    document.getElementById('qt-col-reset-btn')?.addEventListener('click', _resetColumnLabelsInputs);

    // Phase 3-B: lead 연결 해제 버튼
    document.getElementById('qt-lead-clear-btn')?.addEventListener('click', _clearLead);

    // Phase 4 보강: 공급사 정보 collapsible 토글
    const supToggle = document.getElementById('qt-supplier-toggle');
    if (supToggle) {
      supToggle.addEventListener('click', () => {
        const body = document.getElementById('qt-supplier-body');
        const chev = document.getElementById('qt-supplier-chevron');
        if (!body) return;
        const open = body.style.display === 'none';
        body.style.display = open ? 'block' : 'none';
        if (chev) chev.textContent = open ? '▲' : '▼';
      });
    }
  }

  // ── 저장 ─────────────────────────────────────────────────
  async function _save() {
    const name = document.getElementById('qt-f-name').value.trim();
    const customerName = document.getElementById('qt-f-customer_name').value.trim();
    const quoteDate = document.getElementById('qt-f-quote_date').value;
    const vatIncluded = document.getElementById('qt-f-vat_included').value === '1';
    const status = document.getElementById('qt-f-status').value;
    const leadId = document.getElementById('qt-f-lead_id').value.trim();
    const customerId = document.getElementById('qt-f-customer_id').value.trim();
    const quoteNo = document.getElementById('qt-f-quote_no').value.trim();
    // Phase 4 보강: 공급사/고객사/조건사항
    const supplierCompanyName =
      document.getElementById('qt-f-supplier_company_name')?.value.trim() || '';
    const supplierAddress = document.getElementById('qt-f-supplier_address')?.value.trim() || '';
    const supplierCeo = document.getElementById('qt-f-supplier_ceo')?.value.trim() || '';
    const salesRepName = document.getElementById('qt-f-sales_rep_name')?.value.trim() || '';
    const salesRepContact = document.getElementById('qt-f-sales_rep_contact')?.value.trim() || '';
    const customerContact = document.getElementById('qt-f-customer_contact')?.value.trim() || '';
    const termsConditions = document.getElementById('qt-f-terms_conditions')?.value || '';

    if (!name) {
      Toast.error('견적명을 입력하세요');
      return;
    }
    if (!customerName) {
      Toast.error('고객명을 입력하세요');
      return;
    }
    if (!quoteDate) {
      Toast.error('견적일을 입력하세요');
      return;
    }
    if (!_items.length) {
      Toast.error('품목을 최소 1개 이상 입력하세요');
      return;
    }
    // 비어있는 품목 자동 제거 (저장 시점)
    const valid = _items.filter((it) => it.item_name && it.item_name.trim());
    if (!valid.length) {
      Toast.error('품목명이 입력된 행이 없습니다');
      return;
    }

    const body = {
      name,
      customer_name: customerName,
      quote_date: quoteDate,
      vat_included: vatIncluded ? 1 : 0,
      status,
      lead_id: leadId ? parseInt(leadId, 10) : null,
      customer_id: customerId ? parseInt(customerId, 10) : null, // Phase 3-B
      column_labels: _columnLabels || null, // Phase 3-A — 견적별 라벨 저장
      // Phase 4 보강 — PDF 출력용 공급사/고객사/조건사항
      supplier_company_name: supplierCompanyName || null,
      supplier_address: supplierAddress || null,
      supplier_ceo: supplierCeo || null,
      sales_rep_name: salesRepName || null,
      sales_rep_contact: salesRepContact || null,
      customer_contact: customerContact || null,
      terms_conditions: termsConditions || null,
      items: valid,
    };
    // 공급사 정보 localStorage 저장 (다음 견적서 작성 시 자동 채움)
    if (supplierCompanyName || supplierAddress || supplierCeo || salesRepName || salesRepContact) {
      _saveSupplierInfo({
        supplier_company_name: supplierCompanyName,
        supplier_address: supplierAddress,
        supplier_ceo: supplierCeo,
        sales_rep_name: salesRepName,
        sales_rep_contact: salesRepContact,
      });
    }
    // 신규에서 사용자가 채번을 직접 입력한 경우만 quote_no 전송
    if (!_editing && quoteNo && !quoteNo.startsWith('(')) body.quote_no = quoteNo;

    try {
      if (_editing) {
        await API.quotes.update(_editing.id, body);
        Toast.success('견적서 수정됨');
      } else {
        const res = await API.quotes.create(body);
        Toast.success(`견적서 생성됨 — ${res.data?.quote_no || ''}`);
      }
      _cleanupInstances();
      Modal.close();
      await _reload();
    } catch (err) {
      Toast.error('저장 실패: ' + (err.message || err));
    }
  }

  // ── Phase 4: 미리보기 + PDF 내보내기 ─────────────────────
  // 양식 HTML 빌드 — 모달 미리보기와 PDF 캡처용 임시 DOM 공통 사용
  // 공백 보존을 위해 NBSP (\u00A0) 치환 + 단일 폰트로 한국어/영어 혼합 안정
  function _buildPreviewHtml(q, opts = {}) {
    const cols = (q.column_labels && typeof q.column_labels === 'object'
      ? q.column_labels
      : DEFAULT_COLUMNS);
    const items = Array.isArray(q.items) ? q.items : [];
    const vatIncluded = !!q.vat_included;
    const generatedAt = new Date().toLocaleString('ko-KR');
    const _ps = (s) =>
      esc(String(s === null || s === undefined ? '' : s)).replace(/ /g, '\u00A0');
    const krw = (n) => '₩' + _fmtKRW(n);

    const subtotal = items.reduce((s, it) => s + (Number(it.proposed_amount) || 0), 0);
    const vatAmount = Number(q.vat_amount) || (vatIncluded ? Math.round(subtotal * 0.1 * 100) / 100 : 0);
    const totalAmount = Number(q.total_amount) || subtotal + vatAmount;

    // PDF 캡처 모드 시 외곽 패딩/배경 추가, 미리보기 모드 시 간소화
    const outerStyle = opts.forPdf
      ? `width:1100px;padding:30px 40px;background:#fff;color:#1f2937;font-family:'Malgun Gothic','맑은 고딕',sans-serif;font-size:13px;line-height:1.6;letter-spacing:0;word-spacing:0.08em;text-rendering:geometricPrecision;box-sizing:border-box;`
      : `padding:8px;font-family:'Malgun Gothic','맑은 고딕',sans-serif;font-size:13px;color:#1f2937`;

    return `
      <div style="${outerStyle}">
        <!-- 헤더 -->
        <div style="border-bottom:2px solid #E63329;padding-bottom:14px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:flex-end">
          <div>
            <h1 style="margin:0 0 4px;color:#E63329;font-size:26px;font-weight:700;letter-spacing:0;word-spacing:0.1em">${_ps('견   적   서')}</h1>
            <div style="font-size:11px;color:#666">${_ps('Quotation')}</div>
          </div>
          <div style="text-align:right;font-size:12px;color:#666">
            <div>${_ps('견적번호:')}\u00A0<strong style="color:#1f2937;font-family:monospace">${_ps(q.quote_no || '-')}</strong></div>
            <div>${_ps('견적일:')}\u00A0<strong style="color:#1f2937">${_ps(_fmtDate(q.quote_date))}</strong></div>
            ${q.revision_no && Number(q.revision_no) > 1 ? `<div>${_ps('리비전:')}\u00A0<strong>Rev\u00A0${q.revision_no}</strong></div>` : ''}
          </div>
        </div>

        <!-- 좌측 고객사 / 우측 공급사 (Phase 4 보강) -->
        <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px">
          <tr>
            <!-- 좌측: 고객사 -->
            <td style="width:50%;vertical-align:top;padding:0 6px 0 0">
              <div style="border:1px solid #e5e7eb;border-top:3px solid #1664E5;padding:10px 14px;background:#fff;height:100%;box-sizing:border-box">
                <div style="font-size:11px;color:#1664E5;font-weight:700;margin-bottom:6px;letter-spacing:0.04em">${_ps('고객사 (Customer)')}</div>
                <div style="margin-bottom:4px"><strong style="font-size:14px">${_ps(q.customer_name || '-')}</strong></div>
                ${q.customer_contact ? `<div style="font-size:11px;color:#555">${_ps('담당자:')} ${_ps(q.customer_contact)}</div>` : ''}
              </div>
            </td>
            <!-- 우측: 공급사 -->
            <td style="width:50%;vertical-align:top;padding:0 0 0 6px">
              <div style="border:1px solid #e5e7eb;border-top:3px solid #E63329;padding:10px 14px;background:#fff;height:100%;box-sizing:border-box">
                <div style="font-size:11px;color:#E63329;font-weight:700;margin-bottom:6px;letter-spacing:0.04em">${_ps('공급사 (Supplier)')}</div>
                <div style="margin-bottom:4px"><strong style="font-size:14px">${_ps(q.supplier_company_name || '-')}</strong></div>
                ${q.supplier_address ? `<div style="font-size:11px;color:#555;margin-bottom:2px">${_ps(q.supplier_address)}</div>` : ''}
                ${q.supplier_ceo ? `<div style="font-size:11px;color:#555;margin-bottom:2px">${_ps('대표자:')} ${_ps(q.supplier_ceo)}</div>` : ''}
                ${q.sales_rep_name ? `<div style="font-size:11px;color:#555;margin-bottom:2px">${_ps('영업담당:')} ${_ps(q.sales_rep_name)}</div>` : ''}
                ${q.sales_rep_contact ? `<div style="font-size:11px;color:#555">${_ps(q.sales_rep_contact)}</div>` : ''}
              </div>
            </td>
          </tr>
        </table>

        <!-- 안내문 + 견적명 -->
        <div style="text-align:center;padding:10px 0;margin:8px 0;font-size:13px;font-weight:600;color:#1f2937;border:1px solid #e5e7eb;background:#fffbeb">
          ${_ps('아래와 같이 견적 합니다.')}
        </div>
        <div style="margin:10px 0 8px;font-size:12px;color:#555">
          <strong>${_ps('견적명:')}</strong> ${_ps(q.name || '')}
            |
          <strong>${_ps('단가구분:')}</strong> ${_ps(vatIncluded ? '부가세 포함 (10% 자동 가산)' : '부가세 미포함 (가산 안 함)')}
        </div>

        <!-- 품목 테이블 -->
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead>
            <tr style="background:#E63329;color:#fff">
              <th style="padding:8px 6px;border:1px solid #c52a23;width:30px">#</th>
              <th style="padding:8px 6px;border:1px solid #c52a23;text-align:left">${_ps(cols.item_name)}</th>
              <th style="padding:8px 6px;border:1px solid #c52a23;text-align:left;width:90px">${_ps(cols.spec)}</th>
              <th style="padding:8px 6px;border:1px solid #c52a23;text-align:right;width:90px">${_ps(cols.unit_price)}</th>
              <th style="padding:8px 6px;border:1px solid #c52a23;text-align:right;width:60px">${_ps(cols.discount_pct)}</th>
              <th style="padding:8px 6px;border:1px solid #c52a23;text-align:right;width:100px">${_ps(cols.supply_price)}</th>
              <th style="padding:8px 6px;border:1px solid #c52a23;text-align:right;width:60px">${_ps(cols.quantity)}</th>
              <th style="padding:8px 6px;border:1px solid #c52a23;text-align:right;width:120px">${_ps(cols.proposed_amount)}</th>
              <th style="padding:8px 6px;border:1px solid #c52a23;text-align:left">${_ps(cols.remark)}</th>
            </tr>
          </thead>
          <tbody>
            ${
              items.length === 0
                ? `<tr><td colspan="9" style="padding:20px;text-align:center;color:#888;border:1px solid #e5e7eb">${_ps('등록된 품목이 없습니다')}</td></tr>`
                : items
                    .map(
                      (it, i) => `
              <tr style="background:${i % 2 ? '#f9fafb' : '#fff'}">
                <td style="padding:6px;border:1px solid #e5e7eb;text-align:center">${i + 1}</td>
                <td style="padding:6px 10px;border:1px solid #e5e7eb">${_ps(it.item_name || '')}</td>
                <td style="padding:6px 10px;border:1px solid #e5e7eb">${_ps(it.spec || '')}</td>
                <td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:right">${_ps(krw(it.unit_price))}</td>
                <td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:right">${_ps((Number(it.discount_pct) || 0) + '%')}</td>
                <td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:right">${_ps(krw(it.supply_price))}</td>
                <td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:right">${_ps(_fmtKRW(it.quantity))}</td>
                <td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:right;font-weight:600">${_ps(krw(it.proposed_amount))}</td>
                <td style="padding:6px 10px;border:1px solid #e5e7eb">${_ps(it.remark || '')}</td>
              </tr>`
                    )
                    .join('')
            }
          </tbody>
        </table>

        <!-- 합계 -->
        <div style="display:flex;justify-content:flex-end;margin-top:14px">
          <table style="border-collapse:collapse;font-size:12px;min-width:280px">
            <tr>
              <td style="padding:6px 14px;color:#666;text-align:right">${_ps('소계:')}</td>
              <td style="padding:6px 14px;text-align:right;font-weight:500;background:#f9fafb">${_ps(krw(subtotal))}</td>
            </tr>
            <tr>
              <td style="padding:6px 14px;color:#666;text-align:right">${_ps(vatIncluded ? '부가세 (10% 가산):' : '부가세 (미포함):')}</td>
              <td style="padding:6px 14px;text-align:right;font-weight:500;background:#f9fafb">${_ps(krw(vatAmount))}</td>
            </tr>
            <tr style="border-top:2px solid #E63329">
              <td style="padding:10px 14px;font-weight:700;text-align:right">${_ps('총합계:')}</td>
              <td style="padding:10px 14px;text-align:right;font-weight:700;color:#E63329;font-size:15px;background:#fff5f5">${_ps(krw(totalAmount))}</td>
            </tr>
          </table>
        </div>

        <!-- 조건사항 (Remark) — 사용자 입력 (Phase 4 보강) -->
        ${
          q.terms_conditions && q.terms_conditions.trim()
            ? `<div style="margin-top:18px;border:1px solid #e5e7eb;border-radius:6px;padding:12px 14px;background:#fafafa">
                <div style="font-size:11px;color:#666;font-weight:700;margin-bottom:6px">${_ps('📝 조건사항 (Remark)')}</div>
                <div style="font-size:12px;color:#1f2937;white-space:pre-wrap;line-height:1.6">${_ps(q.terms_conditions)}</div>
              </div>`
            : ''
        }

        <!-- 푸터 -->
        <div style="margin-top:24px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:10px;color:#999;text-align:center">
          ${_ps('OCI CRM Quotation')}\u00A0·\u00A0${_ps('생성:')}\u00A0${_ps(generatedAt)}
          ${q.created_by_name ? `\u00A0·\u00A0${_ps('작성자:')}\u00A0${_ps(q.created_by_name)}` : ''}
        </div>
      </div>
    `;
  }

  // ── 미리보기 모달 ────────────────────────────────────────
  async function _openPreview(id) {
    let quote;
    try {
      const res = await API.quotes.get(id);
      quote = res.data;
    } catch (err) {
      Toast.error('견적 정보 불러오기 실패: ' + (err.message || err));
      return;
    }
    Modal.open({
      title: `👁 미리보기 — ${esc(quote.quote_no || '')}`,
      width: 1180,
      body: `<div id="qt-preview-area">${_buildPreviewHtml(quote)}</div>`,
      footer: `
        <button class="btn btn-ghost" id="qt-prev-close-btn">닫기</button>
        <button class="btn btn-primary" id="qt-prev-pdf-btn">📄 PDF 내보내기</button>
      `,
      confirmOnClose: false, // 미리보기는 dirty 안 됨
      bind: {
        '#qt-prev-close-btn': () => Modal.close(),
        '#qt-prev-pdf-btn': () => _exportPdfFromQuote(quote),
      },
    });
  }

  // ── PDF 내보내기 — html2canvas + jsPDF ───────────────────
  // 리포트빌더 패턴 재사용: 임시 DOM 생성 → 이미지 캡처 → PDF 삽입 → 다운로드
  async function _exportPdf(id) {
    try {
      const res = await API.quotes.get(id);
      await _exportPdfFromQuote(res.data);
    } catch (err) {
      Toast.error('견적 정보 불러오기 실패: ' + (err.message || err));
    }
  }

  async function _exportPdfFromQuote(quote) {
    const jsPDFCtor = window.jspdf?.jsPDF || window.jsPDF;
    if (!jsPDFCtor || typeof window.html2canvas !== 'function') {
      Toast.error('PDF 라이브러리가 로드되지 않았습니다. 페이지 새로고침 후 다시 시도하세요.');
      return;
    }
    let tempDiv = null;
    try {
      Toast.info?.('PDF 생성 중...');
      tempDiv = document.createElement('div');
      tempDiv.style.cssText = 'position:fixed;left:-10000px;top:0;';
      tempDiv.innerHTML = _buildPreviewHtml(quote, { forPdf: true });
      document.body.appendChild(tempDiv);

      // 폰트 로드 + 레이아웃 안정화 대기
      await new Promise((r) => setTimeout(r, 100));
      if (document.fonts?.ready) await document.fonts.ready;

      // html2canvas 캡처 (한국어/영어 혼합 안정)
      const canvas = await window.html2canvas(tempDiv.firstElementChild, {
        scale: 2,
        backgroundColor: '#ffffff',
        logging: false,
        useCORS: true,
        letterRendering: true,
        allowTaint: false,
        windowWidth: 1100,
      });
      const imgData = canvas.toDataURL('image/png');

      // PDF 생성 (A4 세로)
      const doc = new jsPDFCtor({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth(); // 210
      const pageHeight = doc.internal.pageSize.getHeight(); // 297
      const margin = 10;
      const maxImgWidth = pageWidth - margin * 2;
      const maxImgHeight = pageHeight - margin * 2;
      const imgRatio = canvas.width / canvas.height;
      let imgW = maxImgWidth;
      let imgH = imgW / imgRatio;
      if (imgH > maxImgHeight) {
        imgH = maxImgHeight;
        imgW = imgH * imgRatio;
      }
      const x = (pageWidth - imgW) / 2;
      const y = margin;
      doc.addImage(imgData, 'PNG', x, y, imgW, imgH);

      // 파일명: 견적번호_고객명_견적일.pdf
      const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '_');
      const filename = `${safeName(quote.quote_no)}_${safeName(quote.customer_name)}_${safeName(_fmtDate(quote.quote_date))}.pdf`;
      doc.save(filename);
      Toast.success(`"${filename}" 다운로드 완료`);
    } catch (err) {
      Toast.error('PDF 생성 실패: ' + (err.message || ''));
      console.error('[Quote PDF]', err);
    } finally {
      if (tempDiv && tempDiv.parentNode) tempDiv.parentNode.removeChild(tempDiv);
    }
  }

  return { render, _openModal, _openPreview, _exportPdf };
})();

// 전역 노출 (app.js pages 매핑에서 참조)
window.QuotesPage = QuotesPage;
