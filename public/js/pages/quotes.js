// ============================================================
// QuotesPage — 견적서 (Phase 1 MVP: 수동 입력 + 자동 채번)
// 데이터: /api/quotes  (헤더 1 + 품목 N)
// ============================================================
const QuotesPage = (() => {
  // ── 모듈 상태 ────────────────────────────────────────────
  let _list = [];
  let _editing = null;       // 수정 중인 견적 (null = 신규)
  let _items = [];           // 모달 내부 품목 배열 (편집 중)
  let _columnLabels = null;  // 컬럼 라벨 커스터마이징 (Phase 2 예정, 현재 미사용)

  // 기본 컬럼 라벨
  const DEFAULT_COLUMNS = {
    item_name:      '품목',
    spec:           '규격',
    unit_price:     '단가',
    discount_pct:   '할인(%)',
    supply_price:   '공급단가',
    quantity:       '수량',
    proposed_amount:'제안금액',
    remark:         'Remark',
  };

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
  function _calcItemAmount(it) {
    const unit = Number(it.unit_price) || 0;
    const qty = Number(it.quantity) || 0;
    const disc = Math.max(0, Math.min(100, Number(it.discount_pct) || 0));
    return Math.round(unit * qty * (1 - disc / 100) * 100) / 100;
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
            <th style="width:200px;text-align:center">작업</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
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
                <button class="btn btn-ghost btn-sm" data-act="duplicate" data-id="${r.id}" title="리비전 복사">📋</button>
                <button class="btn btn-ghost btn-sm" data-act="delete" data-id="${r.id}" style="color:#d93025">삭제</button>
              </td>
            </tr>`).join('')}
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
    document.querySelectorAll('.qt-link').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const id = parseInt(a.dataset.id, 10);
        _openModal(id);
      });
    });
    document.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const id = parseInt(btn.dataset.id, 10);
        const act = btn.dataset.act;
        if (act === 'edit') _openModal(id);
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

  // ── 모달 (생성/편집) ─────────────────────────────────────
  async function _openModal(id) {
    _editing = null;
    _items = [];
    _columnLabels = null;

    if (id) {
      try {
        const res = await API.quotes.get(id);
        _editing = res.data;
        _items = (_editing.items || []).map(it => ({ ...it }));
        _columnLabels = _editing.column_labels || null;
      } catch (err) {
        Toast.error('견적 정보 불러오기 실패: ' + (err.message || err));
        return;
      }
    } else {
      _items = [_blankItem()];
    }

    const e = _editing || {
      quote_no: '(저장 시 자동 생성)',
      name: '',
      customer_name: '',
      quote_date: new Date().toISOString().slice(0, 10),
      vat_included: 0,
      status: 'draft',
      revision_no: 1,
    };

    Modal.open({
      title: id ? `📝 견적서 편집 — ${esc(e.quote_no)}` : '✏️ 새 견적서',
      width: 1180,
      body: _renderModalBody(e),
      footer: `
        <button class="btn btn-ghost" id="qt-cancel-btn">취소</button>
        <button class="btn btn-primary" id="qt-save-btn">💾 저장</button>
      `,
      bind: {
        '#qt-cancel-btn': () => Modal.close(),
        '#qt-save-btn':   () => _save(),
      },
      onOpen: () => {
        _bindModalEvents();
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
              <option value="draft"    ${e.status==='draft'?'selected':''}>초안</option>
              <option value="sent"     ${e.status==='sent'?'selected':''}>발송됨</option>
              <option value="accepted" ${e.status==='accepted'?'selected':''}>수주</option>
              <option value="rejected" ${e.status==='rejected'?'selected':''}>실패</option>
            </select>
          </div>
          <div class="form-row" style="grid-column:1 / span 2">
            <label class="form-label required">견적명</label>
            <input class="form-input" id="qt-f-name" value="${esc(e.name || '')}" placeholder="견적서 제목 입력">
          </div>
          <div class="form-row">
            <label class="form-label">단가구분</label>
            <select class="form-input" id="qt-f-vat_included">
              <option value="0" ${!e.vat_included?'selected':''}>부가세 별도 (10% 자동 가산)</option>
              <option value="1" ${e.vat_included?'selected':''}>부가세 포함</option>
            </select>
          </div>
          <div class="form-row" style="grid-column:1 / span 2">
            <label class="form-label required">고객명</label>
            <input class="form-input" id="qt-f-customer_name" value="${esc(e.customer_name || '')}" placeholder="고객사 / 담당자 명">
          </div>
          <div class="form-row">
            <label class="form-label">영업리드 (선택)</label>
            <input class="form-input" id="qt-f-lead_id" value="${e.lead_id || ''}" placeholder="lead ID (Phase 2 연동)">
          </div>
        </div>

        <!-- 품목 그리드 -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 6px">
          <h4 style="margin:0;font-size:14px;color:var(--text-2)">📦 품목 목록</h4>
          <button class="btn btn-ghost btn-sm" id="qt-add-item-btn" type="button">+ 행 추가</button>
        </div>
        <div style="overflow-x:auto;border:1px solid var(--border);border-radius:6px;background:#fff">
          <table class="data-table" id="qt-items-table" style="margin:0">
            <thead>
              <tr>
                <th style="width:30px"></th>
                <th style="min-width:160px">${esc(cols.item_name)}</th>
                <th style="width:110px">${esc(cols.spec)}</th>
                <th style="width:120px;text-align:right">${esc(cols.unit_price)}</th>
                <th style="width:80px;text-align:right">${esc(cols.discount_pct)}</th>
                <th style="width:120px;text-align:right">${esc(cols.supply_price)}</th>
                <th style="width:80px;text-align:right">${esc(cols.quantity)}</th>
                <th style="width:130px;text-align:right">${esc(cols.proposed_amount)}</th>
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
              <td style="padding:4px 12px;color:var(--text-3);text-align:right">부가세 (10%):</td>
              <td style="padding:4px 12px;text-align:right;font-weight:500" id="qt-vat">₩0</td>
            </tr>
            <tr style="border-top:1px solid var(--border)">
              <td style="padding:8px 12px;font-weight:600;text-align:right">총합계:</td>
              <td style="padding:8px 12px;text-align:right;font-weight:700;color:var(--oci-red);font-size:16px" id="qt-total">₩0</td>
            </tr>
          </table>
        </div>
      </div>
    `;
  }

  function _renderItems() {
    const tbody = document.getElementById('qt-items-tbody');
    if (!tbody) return;
    if (!_items.length) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--text-3)">+ 행 추가 버튼으로 품목을 등록하세요</td></tr>`;
      return;
    }
    tbody.innerHTML = _items.map((it, idx) => `
      <tr data-idx="${idx}">
        <td style="text-align:center;color:var(--text-3);font-size:11px">${idx + 1}</td>
        <td><input class="form-input qt-it-input" data-f="item_name" data-idx="${idx}" value="${esc(it.item_name || '')}" style="padding:4px 6px"></td>
        <td><input class="form-input qt-it-input" data-f="spec" data-idx="${idx}" value="${esc(it.spec || '')}" style="padding:4px 6px"></td>
        <td><input class="form-input qt-it-input" data-f="unit_price" type="number" step="0.01" min="0" data-idx="${idx}" value="${it.unit_price || 0}" style="padding:4px 6px;text-align:right"></td>
        <td><input class="form-input qt-it-input" data-f="discount_pct" type="number" step="0.01" min="0" max="100" data-idx="${idx}" value="${it.discount_pct || 0}" style="padding:4px 6px;text-align:right"></td>
        <td><input class="form-input qt-it-input" data-f="supply_price" type="number" step="0.01" min="0" data-idx="${idx}" value="${it.supply_price || 0}" style="padding:4px 6px;text-align:right"></td>
        <td><input class="form-input qt-it-input" data-f="quantity" type="number" step="0.01" min="0" data-idx="${idx}" value="${it.quantity || 0}" style="padding:4px 6px;text-align:right"></td>
        <td style="text-align:right;font-weight:500;padding:8px 6px" id="qt-it-amount-${idx}">₩${_fmtKRW(_calcItemAmount(it))}</td>
        <td><input class="form-input qt-it-input" data-f="remark" data-idx="${idx}" value="${esc(it.remark || '')}" style="padding:4px 6px"></td>
        <td style="text-align:center"><button class="btn btn-ghost btn-sm qt-it-del" data-idx="${idx}" type="button" title="삭제" style="color:#d93025">×</button></td>
      </tr>
    `).join('');

    // 인풋 → 상태 동기화
    tbody.querySelectorAll('.qt-it-input').forEach(inp => {
      inp.addEventListener('input', _onItemInput);
    });
    tbody.querySelectorAll('.qt-it-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        _items.splice(idx, 1);
        _renderItems();
        _recalcTotals();
      });
    });
  }

  function _onItemInput(e) {
    const inp = e.target;
    const idx = parseInt(inp.dataset.idx, 10);
    const field = inp.dataset.f;
    if (!_items[idx]) return;
    const isNumeric = ['unit_price', 'discount_pct', 'supply_price', 'quantity'].includes(field);
    _items[idx][field] = isNumeric ? Number(inp.value) || 0 : inp.value;
    // 제안금액 즉시 갱신
    if (isNumeric) {
      const amt = _calcItemAmount(_items[idx]);
      _items[idx].proposed_amount = amt;
      const cell = document.getElementById(`qt-it-amount-${idx}`);
      if (cell) cell.textContent = '₩' + _fmtKRW(amt);
      _recalcTotals();
    }
  }

  function _recalcTotals() {
    const subtotal = _items.reduce((s, it) => s + _calcItemAmount(it), 0);
    const vatIncluded = document.getElementById('qt-f-vat_included')?.value === '1';
    const vat = vatIncluded ? 0 : Math.round(subtotal * 0.1 * 100) / 100;
    const total = subtotal + vat;
    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = '₩' + _fmtKRW(v); };
    setText('qt-subtotal', subtotal);
    setText('qt-vat', vat);
    setText('qt-total', total);
  }

  function _bindModalEvents() {
    document.getElementById('qt-add-item-btn')?.addEventListener('click', () => {
      _items.push(_blankItem());
      _renderItems();
      _recalcTotals();
    });
    document.getElementById('qt-f-vat_included')?.addEventListener('change', _recalcTotals);
  }

  // ── 저장 ─────────────────────────────────────────────────
  async function _save() {
    const name         = document.getElementById('qt-f-name').value.trim();
    const customerName = document.getElementById('qt-f-customer_name').value.trim();
    const quoteDate    = document.getElementById('qt-f-quote_date').value;
    const vatIncluded  = document.getElementById('qt-f-vat_included').value === '1';
    const status       = document.getElementById('qt-f-status').value;
    const leadId       = document.getElementById('qt-f-lead_id').value.trim();
    const quoteNo      = document.getElementById('qt-f-quote_no').value.trim();

    if (!name) { Toast.error('견적명을 입력하세요'); return; }
    if (!customerName) { Toast.error('고객명을 입력하세요'); return; }
    if (!quoteDate) { Toast.error('견적일을 입력하세요'); return; }
    if (!_items.length) { Toast.error('품목을 최소 1개 이상 입력하세요'); return; }
    // 비어있는 품목 검사
    const valid = _items.filter(it => it.item_name && it.item_name.trim());
    if (!valid.length) { Toast.error('품목명이 입력된 행이 없습니다'); return; }

    const body = {
      name,
      customer_name: customerName,
      quote_date: quoteDate,
      vat_included: vatIncluded ? 1 : 0,
      status,
      lead_id: leadId ? parseInt(leadId, 10) : null,
      items: valid,
    };
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
      Modal.close();
      await _reload();
    } catch (err) {
      Toast.error('저장 실패: ' + (err.message || err));
    }
  }

  return { render, _openModal };
})();

// 전역 노출 (app.js pages 매핑에서 참조)
window.QuotesPage = QuotesPage;
