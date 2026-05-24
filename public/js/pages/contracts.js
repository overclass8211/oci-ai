// ============================================================
// ContractsPage — 계약 모듈 (v6.0.0 슬림화)
// 데이터: /api/contracts  (헤더 + 파일 + history + AI 법무 검토)
//
// 핵심 기능:
//   1. 계약 아카이빙 — CRUD + 히스토리 (4단계 상태)
//   2. 연결: 고객사 / 영업리드 / 견적 / 제안 (선택적)
//   3. 첨부 파일 업로드/다운로드/삭제
//   4. AI 법무 검토 (Gemini 2.5 Pro · 한국법 특화)
//   5. (예정) 전자서명 — 모두싸인 OAuth
// ============================================================
const ContractsPage = (() => {
  let _list = [];
  const _filters = { search: '', status: '', contract_type: '' };

  // ── 상태 메타 (4단계) ──────────────────────────────────────
  const STATUS_LABELS = {
    draft: '초안',
    review: '검토',
    approved: '승인',
    completed: '계약완료',
  };
  const STATUS_COLORS = {
    draft: '#6b7280',
    review: '#3b82f6',
    approved: '#16a34a',
    completed: '#0891b2',
  };

  // CLM 빠른 액션 (4단계 + 수정 액션)
  // { to, label, kind } — kind: primary/ghost/danger
  const QUICK_ACTIONS = {
    draft: [
      { to: 'review', label: '📋 검토 요청', kind: 'primary' },
      { to: 'completed', label: '✕ 종료', kind: 'danger' },
    ],
    review: [
      { to: 'approved', label: '✅ 승인', kind: 'primary' },
      { to: 'draft', label: '✏ 수정 요청', kind: 'ghost' },
      { to: 'completed', label: '✕ 종료', kind: 'danger' },
    ],
    approved: [
      { to: 'completed', label: '🤝 계약 완료', kind: 'primary' },
      { to: 'review', label: '⬅ 재검토', kind: 'ghost' },
    ],
    completed: [], // 종착점
  };

  const CONTRACT_TYPE_LABELS = {
    NDA: 'NDA (비밀유지)',
    MSA: 'MSA (기본거래)',
    SLA: 'SLA (서비스수준)',
    SOW: 'SOW (작업기술서)',
    service: '용역계약',
    purchase: '구매계약',
    license: '라이선스',
    employment: '고용계약',
    etc: '기타',
  };

  // ── 유틸 ──────────────────────────────────────────────────
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function _fmtKRW(n) {
    const v = Number(n);
    if (!v) return '-';
    return v.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  }
  function _fmtDate(s) {
    if (!s) return '-';
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
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d)) return '';
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function _statusBadge(status) {
    const label = STATUS_LABELS[status] || status || '-';
    const color = STATUS_COLORS[status] || '#6b7280';
    return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:${color};color:#fff">${esc(label)}</span>`;
  }

  // ── 페이지 진입점 ─────────────────────────────────────────
  async function render() {
    const container = document.getElementById('content');
    if (!container) {
      console.error('[ContractsPage] #content 컨테이너를 찾을 수 없습니다');
      return;
    }
    container.innerHTML = `
      <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div>
          <h1 style="margin:0;font-size:20px">📜 계약 관리</h1>
          <div style="font-size:12px;color:var(--text-3);margin-top:4px">계약 아카이빙 + 4단계 상태 + 연결 추적 + AI 법무 검토</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary" id="ct-new-btn">+ 새 계약</button>
        </div>
      </div>

      <!-- 필터 -->
      <div class="filter-bar" style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
        <input class="form-input" id="ct-search" placeholder="🔎 계약번호/제목/고객사 검색"
          style="flex:1;min-width:240px" value="${esc(_filters.search)}">
        <select class="form-input" id="ct-filter-status" style="width:140px">
          <option value="">전체 상태</option>
          ${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${_filters.status === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
        </select>
        <select class="form-input" id="ct-filter-type" style="width:160px">
          <option value="">전체 유형</option>
          ${Object.entries(CONTRACT_TYPE_LABELS).map(([k, v]) => `<option value="${k}" ${_filters.contract_type === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
        </select>
        <button class="btn btn-ghost" id="ct-refresh-btn">새로고침</button>
      </div>

      <div id="ct-list-wrap"></div>
    `;

    _bindHeaderEvents();
    await _refreshList();
  }

  function _bindHeaderEvents() {
    document.getElementById('ct-new-btn').addEventListener('click', () => _openNewModeChooser());
    document.getElementById('ct-refresh-btn').addEventListener('click', () => _refreshList());

    const searchInput = document.getElementById('ct-search');
    let debounceTimer;
    searchInput.addEventListener('input', e => {
      clearTimeout(debounceTimer);
      const val = e.target.value;
      debounceTimer = setTimeout(() => {
        _filters.search = val;
        _refreshList();
      }, 300);
    });
    document.getElementById('ct-filter-status').addEventListener('change', e => {
      _filters.status = e.target.value;
      _refreshList();
    });
    document.getElementById('ct-filter-type').addEventListener('change', e => {
      _filters.contract_type = e.target.value;
      _refreshList();
    });
  }

  // ── 목록 fetch + 렌더 ─────────────────────────────────────
  async function _refreshList() {
    const wrap = document.getElementById('ct-list-wrap');
    if (!wrap) return;
    wrap.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-3)">⏳ 불러오는 중...</div>`;
    try {
      const params = {};
      if (_filters.search) params.search = _filters.search;
      if (_filters.status) params.status = _filters.status;
      if (_filters.contract_type) params.contract_type = _filters.contract_type;
      params.limit = 100;
      const res = await API.contracts.list(params);
      _list = res?.data || [];
      _renderList(wrap);
    } catch (err) {
      wrap.innerHTML = `<div class="error-message" style="padding:20px;color:#d93025">목록 조회 실패: ${esc(err.message || err)}</div>`;
    }
  }

  function _renderList(wrap) {
    if (!_list.length) {
      wrap.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-3);background:#fafafa;border-radius:8px;border:1px dashed var(--border)">
        등록된 계약이 없습니다 — 우상단 <strong>[+ 새 계약]</strong> 으로 시작하세요
      </div>`;
      return;
    }
    wrap.innerHTML = `
      <table class="data-table" style="cursor:pointer">
        <thead><tr>
          <th style="width:120px">계약번호</th>
          <th style="width:80px">유형</th>
          <th>계약명</th>
          <th style="width:140px">고객사</th>
          <th style="width:110px">시작일</th>
          <th style="width:110px">종료일</th>
          <th style="width:130px;text-align:right">금액</th>
          <th style="width:100px">상태</th>
          <th style="width:60px;text-align:center">파일</th>
          <th style="width:100px;text-align:center">작업</th>
        </tr></thead>
        <tbody>
          ${_list.map(c => {
            const linkCount =
              (c.customer_id ? 1 : 0) +
              (c.lead_id ? 1 : 0) +
              (c.proposal_id ? 1 : 0) +
              (c.quote_id ? 1 : 0);
            const linkBadge = linkCount > 0
              ? `<span style="display:inline-block;font-size:9px;padding:1px 5px;background:#dbeafe;color:#1e40af;border-radius:8px;margin-left:4px" title="연결: 고객/리드/제안/견적 ${linkCount}건">🔗${linkCount}</span>`
              : '';
            return `<tr data-id="${c.id}" class="ct-row">
              <td style="font-family:monospace;font-size:11px">${esc(c.contract_no)}</td>
              <td><span class="badge badge-gray" style="font-size:10px">${esc(CONTRACT_TYPE_LABELS[c.contract_type]?.split(' ')[0] || c.contract_type || '-')}</span></td>
              <td>${esc(c.title)}${linkBadge}</td>
              <td>${esc(c.customer_name || '-')}</td>
              <td style="font-size:11px">${_fmtDate(c.start_date)}</td>
              <td style="font-size:11px">${_fmtDate(c.end_date)}</td>
              <td style="text-align:right;font-family:monospace">${c.contract_amount ? _fmtKRW(c.contract_amount) + ' ' + (c.currency || 'KRW') : '-'}</td>
              <td>${_statusBadge(c.status)}</td>
              <td style="text-align:center;color:var(--text-3);font-size:11px">${c.file_count > 0 ? `📎 ${c.file_count}` : '-'}</td>
              <td style="text-align:center;white-space:nowrap">
                <button class="btn btn-ghost btn-sm ct-edit" data-id="${c.id}" type="button" style="font-size:11px;padding:2px 6px">편집</button>
                <button class="btn btn-ghost btn-sm ct-del" data-id="${c.id}" type="button" style="font-size:11px;padding:2px 6px;color:#d93025">삭제</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;
    // 행 전체 클릭 → 편집 모달
    wrap.querySelectorAll('.ct-row').forEach(tr => {
      tr.addEventListener('click', e => {
        if (e.target.closest('button')) return; // 버튼 클릭은 별도
        const id = parseInt(tr.dataset.id, 10);
        if (id) _openModal(id);
      });
    });
    wrap.querySelectorAll('.ct-edit').forEach(btn => {
      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        _openModal(parseInt(btn.dataset.id, 10));
      });
    });
    wrap.querySelectorAll('.ct-del').forEach(btn => {
      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        _doDelete(parseInt(btn.dataset.id, 10));
      });
    });
  }

  // ── v6.0.0 Phase A2-1: 등록 모드 선택 모달 ─────────────────
  // "+ 새 계약" 클릭 시 — 사용자가 시작 방식 선택
  //   A. 📎 계약서 받음 — 파일 첨부 → AI 분석 → 자동 채움 (B2B 대표 시나리오)
  //   B. ✏️ 빈 양식 — 직접 입력 (소형, 우리가 작성)
  function _openNewModeChooser() {
    Modal.open({
      title: '➕ 새 계약 등록 — 어떻게 시작하시겠습니까?',
      width: 720,
      body: `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <!-- 모드 A: 파일 우선 (AI 분석) -->
          <button id="ct-mode-file" type="button"
            style="text-align:left;padding:22px 18px;background:linear-gradient(135deg,#faf5ff,#f3e8ff);
                   border:2px solid #7c3aed;border-radius:10px;cursor:pointer;transition:transform .15s">
            <div style="font-size:32px;line-height:1;margin-bottom:10px">📎</div>
            <div style="font-size:15px;font-weight:700;color:#5b21b6;margin-bottom:6px">
              계약서 받음
            </div>
            <div style="font-size:12px;color:#6b21a8;line-height:1.6;margin-bottom:10px">
              <strong>발주처가 보내준 PDF</strong> 또는 협상 중인 초안을 받았을 때<br>
              <span style="color:#7c3aed">① 파일 첨부 → ② AI 법무 분석 → ③ 정보 자동 채움</span>
            </div>
            <div style="font-size:11px;color:#7c3aed;font-weight:600">
              🤖 Gemini 2.5 Pro · 약 30-60초 · 1회 500-1000원
            </div>
          </button>

          <!-- 모드 B: 빈 양식 (직접 입력) -->
          <button id="ct-mode-blank" type="button"
            style="text-align:left;padding:22px 18px;background:#f9fafb;
                   border:2px solid var(--border);border-radius:10px;cursor:pointer;transition:transform .15s">
            <div style="font-size:32px;line-height:1;margin-bottom:10px">✏️</div>
            <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:6px">
              빈 양식부터
            </div>
            <div style="font-size:12px;color:var(--text-3);line-height:1.6;margin-bottom:10px">
              <strong>우리가 직접 작성</strong>하거나 간단한 NDA/SOW 등<br>
              <span>① 양식 입력 → ② 저장 → ③ (선택) 파일 첨부</span>
            </div>
            <div style="font-size:11px;color:var(--text-3);font-weight:600">
              ⚡ 즉시 입력 가능 · AI 분석은 나중에
            </div>
          </button>
        </div>

        <div style="margin-top:14px;padding:10px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:11px;color:#92400e">
          💡 <strong>둘 중 어떤 모드로 시작하든</strong> 등록 후 파일 추가/삭제, AI 법무 검토 재실행, 정보 수정 모두 가능합니다.
        </div>
      `,
      footer: `<button class="btn btn-ghost" id="ct-mode-cancel">취소</button>`,
      bind: {
        '#ct-mode-cancel': () => Modal.close(),
      },
      onOpen: () => {
        const fileBtn = document.getElementById('ct-mode-file');
        const blankBtn = document.getElementById('ct-mode-blank');
        const hoverOn = btn => {
          btn.style.transform = 'translateY(-3px)';
          btn.style.boxShadow = '0 6px 14px rgba(0,0,0,0.08)';
        };
        const hoverOff = btn => {
          btn.style.transform = 'translateY(0)';
          btn.style.boxShadow = 'none';
        };
        fileBtn.addEventListener('mouseenter', () => hoverOn(fileBtn));
        fileBtn.addEventListener('mouseleave', () => hoverOff(fileBtn));
        blankBtn.addEventListener('mouseenter', () => hoverOn(blankBtn));
        blankBtn.addEventListener('mouseleave', () => hoverOff(blankBtn));

        // 모드 B (빈 양식) — 기존 빈 모달 흐름 그대로
        blankBtn.addEventListener('click', () => {
          Modal.close();
          setTimeout(() => _openModal(null), 100);
        });

        // 모드 A (파일 우선) — Phase A2-2: 임시 계약 자동 생성 → 편집 모달 진입
        fileBtn.addEventListener('click', async () => {
          Modal.close();
          await _openModalFileFirst();
        });
      },
    });
  }

  // ── v6.0.0 Phase A2-2: 파일 우선 등록 모드 ──────────────────
  // 임시 계약 자동 생성 → 즉시 편집 모달 진입 → 사용자가 파일 첨부 → AI 분석
  // 모달 close 시 미저장 (= placeholder 그대로) 면 자동 정리
  let _tempContractId = null; // 현재 임시 계약 ID 추적 (close 시 정리용)

  async function _openModalFileFirst() {
    // 1. 임시 계약 자동 생성 (placeholder 값 — 사용자가 저장 시 실제 값으로 교체)
    let tempId;
    try {
      Toast.info?.('임시 계약 생성 중...');
      const res = await API.contracts.create({
        title: '(임시)',
        contract_type: 'etc',
        status: 'draft',
        currency: 'KRW',
      });
      tempId = res?.id || res?.data?.id;
      if (!tempId) throw new Error('임시 계약 ID 누락');
      _tempContractId = tempId;
    } catch (err) {
      Toast.error?.('임시 계약 생성 실패: ' + (err.message || err));
      return;
    }
    // 2. 편집 모달 진입 (파일 첨부 우선 모드)
    await _openModal(tempId, { isTempMode: true });
  }

  // 임시 계약 정리 (사용자가 미저장 close 시)
  async function _cleanupTempContractIfNeeded() {
    if (!_tempContractId) return;
    const id = _tempContractId;
    _tempContractId = null;
    try {
      // 사용자가 실제로 값을 입력했는지 확인
      const r = await API.contracts.get(id);
      const c = r?.data;
      if (!c) return;
      const isStillTemp =
        c.title === '(임시)' &&
        !c.customer_name &&
        !c.customer_id &&
        (!c.files || c.files.length === 0);
      if (isStillTemp) {
        await API.contracts.delete(id);
        console.log(`[contracts:cleanup] 임시 계약 ${id} 자동 삭제`);
      } else {
        // 일부 입력했지만 저장 안한 경우 — confirm
        const proceed = confirm(
          `미저장 임시 계약이 있습니다 (#${id}).\n\n` +
            `유지하려면 [취소] (목록에 남음)\n` +
            `삭제하려면 [확인]`
        );
        if (proceed) {
          await API.contracts.delete(id);
          Toast.info?.(`임시 계약 #${id} 삭제됨`);
        }
      }
      await _refreshList();
    } catch (_) {
      /* best-effort */
    }
  }

  // ── 모달 (생성/편집) ──────────────────────────────────────
  async function _openModal(id, opts = {}) {
    const { isTempMode = false } = opts;
    let entity;
    if (id) {
      try {
        const res = await API.contracts.get(id);
        entity = res?.data || {};
      } catch (err) {
        Toast.error?.('조회 실패: ' + (err.message || err));
        return;
      }
    } else {
      // 신규 — 자동채번 미리보기
      try {
        const r = await API.contracts.nextContractNo();
        entity = { contract_no: r?.data?.next_contract_no, status: 'draft' };
      } catch (_) {
        entity = { status: 'draft' };
      }
    }

    // 임시 모드: placeholder 값 화면에서 빈칸으로 표시 (사용자가 실제 입력 유도)
    if (isTempMode && entity.title === '(임시)') {
      entity.title = '';
    }

    const title = id
      ? isTempMode
        ? `📜 새 계약 등록 (파일 첨부 모드) — ${esc(entity.contract_no || '')}`
        : `📜 계약 편집 — ${esc(entity.contract_no || '')}`
      : '📜 새 계약 등록';
    const actions = id && !isTempMode ? (QUICK_ACTIONS[entity.status] || []) : [];

    // 취소/닫기 핸들러 — 임시 모드 시 cleanup 우선
    const cancelHandler = async () => {
      Modal.close();
      if (isTempMode) {
        await _cleanupTempContractIfNeeded();
      }
    };

    Modal.open({
      title,
      width: 1100,
      body: _formHtml(entity, { isTempMode }),
      footer: `
        ${actions.map(a => {
          const cls = a.kind === 'primary' ? 'btn-primary' : a.kind === 'danger' ? 'btn-danger' : 'btn-ghost';
          return `<button class="btn ${cls} ct-quick-action" data-to="${a.to}" type="button">${esc(a.label)}</button>`;
        }).join('')}
        <span style="flex:1"></span>
        <button class="btn btn-ghost" id="ct-cancel-btn">${isTempMode ? '취소 (삭제)' : '취소'}</button>
        <button class="btn btn-primary" id="ct-save-btn">${id ? '💾 저장' : '➕ 등록'}</button>
      `,
      bind: {
        '#ct-cancel-btn': cancelHandler,
        '#ct-save-btn': () => _doSave(id, { isTempMode }),
      },
      disableOverlayClose: true,
      onOpen: () => {
        // 빠른 액션 버튼 핸들러
        document.querySelectorAll('.ct-quick-action').forEach(btn => {
          btn.addEventListener('click', async () => {
            const newStatus = btn.dataset.to;
            const label = STATUS_LABELS[newStatus] || newStatus;
            if (!confirm(`상태를 "${label}" 로 변경하시겠습니까?`)) return;
            try {
              await API.contracts.setStatus(id, newStatus);
              Toast.success?.(`상태 변경 → ${label}`);
              await _reopenModalFresh(id);
            } catch (err) {
              Toast.error?.('상태 변경 실패: ' + (err?.error || err?.message || err));
            }
          });
        });
        if (id) _bindFileEvents(id);
        _attachLinkComboboxes(); // v6.0.0 Step 2 Commit 4: 4개 연결 Combobox
        _bindLegalCtaBtn(id); // v6.0.0 Step 3: 메인 AI 법무 검토 CTA
      },
    });
  }

  function _formHtml(e, opts = {}) {
    const { isTempMode = false } = opts;
    return `
      ${isTempMode ? _renderTempModeIntro(e) : ''}
      ${e.id ? _renderLegalCtaSection(e) : ''}
      <div class="form-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px">
        <div class="form-row">
          <label class="form-label">계약번호</label>
          <input class="form-input" id="ct-f-contract_no" value="${esc(e.contract_no || '')}" ${e.id ? 'readonly' : ''} style="font-family:monospace">
        </div>
        <div class="form-row">
          <label class="form-label">유형</label>
          <select class="form-input" id="ct-f-contract_type">
            ${Object.entries(CONTRACT_TYPE_LABELS).map(([k, v]) => `<option value="${k}" ${(e.contract_type || 'etc') === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
          </select>
        </div>
        <div class="form-row">
          <label class="form-label">상태</label>
          <select class="form-input" id="ct-f-status">
            ${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${(e.status || 'draft') === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
          </select>
        </div>

        <div class="form-row" style="grid-column:1 / span 3">
          <label class="form-label required">계약명</label>
          <input class="form-input" id="ct-f-title" value="${esc(e.title || '')}" placeholder="예: A사 NDA 계약 (2026년)">
        </div>

        <div class="form-row" style="grid-column:1 / span 2">
          <label class="form-label">고객사명</label>
          <input class="form-input" id="ct-f-customer_name" value="${esc(e.customer_name || '')}" placeholder="고객사 이름">
        </div>
        <div class="form-row">
          <label class="form-label">통화</label>
          <select class="form-input" id="ct-f-currency">
            <option value="KRW" ${(e.currency || 'KRW') === 'KRW' ? 'selected' : ''}>KRW</option>
            <option value="USD" ${e.currency === 'USD' ? 'selected' : ''}>USD</option>
            <option value="JPY" ${e.currency === 'JPY' ? 'selected' : ''}>JPY</option>
            <option value="EUR" ${e.currency === 'EUR' ? 'selected' : ''}>EUR</option>
          </select>
        </div>

        <div class="form-row">
          <label class="form-label">시작일</label>
          <input class="form-input" id="ct-f-start_date" type="date" value="${e.start_date ? _toInputDate(e.start_date) : ''}">
        </div>
        <div class="form-row">
          <label class="form-label">종료일</label>
          <input class="form-input" id="ct-f-end_date" type="date" value="${e.end_date ? _toInputDate(e.end_date) : ''}">
        </div>
        <div class="form-row">
          <label class="form-label">계약금액</label>
          <input class="form-input" id="ct-f-contract_amount" type="number" min="0" step="0.01"
            value="${e.contract_amount !== null && e.contract_amount !== undefined ? e.contract_amount : ''}" placeholder="0">
        </div>

        <!-- 연결: 고객/리드/제안/견적 (Combobox 자동완성) -->
        <div class="form-row">
          <label class="form-label">🔗 고객사</label>
          <input class="form-input" id="ct-f-customer-search" type="text" autocomplete="off"
            value="${esc(e.customer_name || '')}" placeholder="고객사명 2글자 이상 입력">
          <input type="hidden" id="ct-f-customer_id" value="${e.customer_id || ''}">
        </div>
        <div class="form-row">
          <label class="form-label">🔗 영업리드</label>
          <input class="form-input" id="ct-f-lead-search" type="text" autocomplete="off"
            value="${e.lead_id ? '#' + e.lead_id : ''}" placeholder="리드 검색 (프로젝트명/고객사)">
          <input type="hidden" id="ct-f-lead_id" value="${e.lead_id || ''}">
        </div>
        <div class="form-row">
          <label class="form-label">🔗 제안</label>
          <input class="form-input" id="ct-f-proposal-search" type="text" autocomplete="off"
            value="${e.proposal_id ? '#' + e.proposal_id : ''}" placeholder="제안 검색 (번호/제목/고객사)">
          <input type="hidden" id="ct-f-proposal_id" value="${e.proposal_id || ''}">
        </div>
        <div class="form-row">
          <label class="form-label">🔗 견적</label>
          <input class="form-input" id="ct-f-quote-search" type="text" autocomplete="off"
            value="${e.quote_id ? '#' + e.quote_id : ''}" placeholder="견적 검색 (번호/이름/고객사)">
          <input type="hidden" id="ct-f-quote_id" value="${e.quote_id || ''}">
        </div>
        <div class="form-row" style="grid-column:span 2">
          <label class="form-label">언어</label>
          <select class="form-input" id="ct-f-language">
            <option value="ko" ${(e.language || 'ko') === 'ko' ? 'selected' : ''}>한국어</option>
            <option value="en" ${e.language === 'en' ? 'selected' : ''}>English</option>
            <option value="ja" ${e.language === 'ja' ? 'selected' : ''}>日本語</option>
          </select>
        </div>

        <div class="form-row" style="grid-column:1 / span 3">
          <label class="form-label">비고</label>
          <textarea class="form-input" id="ct-f-notes" rows="3" placeholder="(선택)" style="resize:vertical;font-family:inherit">${esc(e.notes || '')}</textarea>
        </div>
      </div>

      ${
        e.id
          ? `<div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border)">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <strong style="font-size:13px">📎 첨부 파일 (${(e.files || []).length}건)</strong>
                <button class="btn btn-ghost btn-sm" id="ct-file-add-btn" type="button">+ 파일 추가</button>
              </div>
              <div style="margin-bottom:10px;padding:6px 10px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;font-size:11px;color:#075985">
                💡 파일 행의 <strong>🤖 법무</strong> 버튼으로 개별 파일에 대해 AI 법무 검토 실행 가능 (PDF/이미지/텍스트만)
              </div>
              <input type="file" id="ct-file-input" multiple style="display:none"
                accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.hwp,.hwpx,.png,.jpg,.jpeg,.txt,.md">
              ${_renderFileList(e.files || [], e.id)}

              <!-- 변경 이력 (최근 10건) -->
              ${_renderHistorySection(e.history || [])}
            </div>`
          : '<div style="margin-top:14px;padding:10px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:12px;color:#92400e">💡 계약 등록 후 파일 첨부 + AI 법무 검토가 가능합니다</div>'
      }
    `;
  }

  // v6.0.0 Phase A2-2: 임시 모드 인트로 (파일 우선 등록 안내)
  function _renderTempModeIntro(e) {
    const hasFile = Array.isArray(e.files) && e.files.length > 0;
    return `<div style="border:2px solid #7c3aed;border-radius:10px;padding:14px 18px;background:linear-gradient(135deg,#faf5ff,#f3e8ff);margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <div style="font-size:24px;line-height:1">📎</div>
        <div>
          <div style="font-size:14px;font-weight:700;color:#5b21b6">
            파일 첨부 → AI 법무 분석 → 자동 채움
          </div>
          <div style="font-size:11px;color:#7c3aed;margin-top:2px">
            임시 계약번호 <code style="background:#fff;padding:1px 6px;border-radius:3px;font-family:monospace">${esc(e.contract_no || '')}</code> 자동 발급됨 (저장 시 확정)
          </div>
        </div>
      </div>
      <ol style="margin:6px 0 0 24px;padding:0;font-size:12px;color:#6b21a8;line-height:1.8">
        <li>${hasFile ? '✅' : '<strong>①</strong>'} 아래 <strong>[+ 파일 추가]</strong> 로 계약서 첨부 (PDF/이미지/TXT)</li>
        <li>${hasFile ? '<strong>②</strong>' : '⬜'} 상단 <strong>[🤖 AI 법무 검토 시작]</strong> 클릭 → 30-60초 대기</li>
        <li>⬜ AI 추출 정보 확인 후 적용 → 필요 시 수정 → 💾 저장</li>
      </ol>
      <div style="margin-top:8px;padding-top:8px;border-top:1px dashed #c4b5fd;font-size:10px;color:#7c3aed">
        💡 미저장 상태로 [취소] 시 임시 계약 자동 삭제 · 정식 저장 시 정상 계약으로 전환
      </div>
    </div>`;
  }

  // Step 3: AI 법무 검토 메인 CTA + 결과 카드 (모달 상단)
  // 파일 없음 → 안내, 파일 있음 + 미검토 → 큰 CTA, 검토 완료 → 결과 카드 + 재검토 버튼
  function _renderLegalCtaSection(e) {
    const files = Array.isArray(e.files) ? e.files : [];
    const analyzableFiles = files.filter(f => _isAnalyzable(f.original_filename));
    const hasReview = !!e.latest_legal_review;
    const hasAnalyzable = analyzableFiles.length > 0;

    // 결과가 있으면 결과 카드 + 재검토 안내 (재검토는 파일 행 [🤖 법무] 버튼으로)
    if (hasReview) {
      return `<div id="ct-legal-review-wrap" style="margin-bottom:16px">
        ${_renderLegalReview(e.latest_legal_review)}
      </div>`;
    }

    // 결과 없음 → 안내 카드
    return `<div id="ct-legal-review-wrap" style="margin-bottom:16px">
      <div style="border:2px dashed #7c3aed;border-radius:10px;padding:18px;background:linear-gradient(135deg,#faf5ff,#f3e8ff);text-align:center">
        <div style="font-size:32px;line-height:1;margin-bottom:8px">🤖</div>
        <div style="font-size:15px;font-weight:700;color:#5b21b6;margin-bottom:6px">
          AI 법무 검토 ${hasAnalyzable ? '준비됨' : '대기'}
        </div>
        ${
          hasAnalyzable
            ? `<div style="font-size:12px;color:#6b21a8;margin-bottom:12px;line-height:1.6">
                Gemini 2.5 Pro 가 한국법(공정거래법·하도급법·개인정보보호법) 관점에서<br>
                <strong>독소조항·누락조항·수정안</strong>을 자동 생성합니다 (약 30-60초 · 1회 약 500-1000원)
              </div>
              <button id="ct-legal-cta-btn" type="button"
                style="padding:12px 28px;background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(124,58,237,0.3);transition:transform .15s">
                🤖 AI 법무 검토 시작 (${analyzableFiles.length}건 파일 사용 가능)
              </button>
              <div style="margin-top:8px;font-size:10px;color:#6b21a8">
                파일이 여러 개인 경우 가장 최근에 업로드한 분석 가능한 파일이 자동 선택됩니다
              </div>`
            : `<div style="font-size:12px;color:#6b21a8;line-height:1.6">
                ⚠️ <strong>분석 가능한 파일 없음</strong><br>
                아래 [+ 파일 추가] 로 계약서를 첨부하세요 (PDF · 이미지 · TXT)
              </div>`
        }
      </div>
    </div>`;
  }

  // 변경 이력 (Audit Trail) — 최근 10건
  function _renderHistorySection(history) {
    if (!history.length) return '';
    const recent = history.slice(0, 10);
    const ACTION_LABELS = {
      create: '🆕 생성',
      update: '✏ 수정',
      status_change: '🔄 상태 변경',
      file_upload: '📎 파일 추가',
      file_delete: '🗑 파일 삭제',
      legal_review: '🤖 법무 검토',
    };
    return `<div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <strong style="font-size:13px">📋 변경 이력 (최근 ${recent.length}건)</strong>
        ${history.length > 10 ? `<span style="font-size:11px;color:var(--text-3)">전체 ${history.length}건 (최근 10건 표시)</span>` : ''}
      </div>
      <table class="data-table" style="font-size:11px">
        <thead><tr>
          <th style="width:140px">시각</th>
          <th style="width:110px">액션</th>
          <th>변경 내용</th>
          <th style="width:100px">담당자</th>
        </tr></thead>
        <tbody>
          ${recent.map(h => `<tr>
            <td style="font-size:10px;color:var(--text-3)">${_fmtDateTime(h.created_at)}</td>
            <td style="font-size:11px">${esc(ACTION_LABELS[h.action_type] || h.action_type)}</td>
            <td style="font-size:11px">${esc(h.description || (h.field_name ? `${h.field_name}: ${h.old_value || '∅'} → ${h.new_value || '∅'}` : '-'))}</td>
            <td style="font-size:11px;color:var(--text-3)">${esc(h.created_by_name || '-')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  }

  // AI 분석 가능 형식 (PDF / 이미지 / 텍스트)
  function _isAnalyzable(filename) {
    if (!filename) return false;
    return /\.(pdf|png|jpe?g|webp|txt|md)$/i.test(filename);
  }

  // AI 법무 검토 결과 카드 (색상 코드 + 4섹션)
  function _renderLegalReview(d) {
    if (!d) return '';
    const score = Math.max(0, Math.min(100, parseInt(d.review_score, 10) || 0));
    const risk = d.risk_level || 'medium';
    const riskColors = { high: '#dc2626', medium: '#ca8a04', low: '#16a34a' };
    const riskLabels = { high: '높은 위험', medium: '중간 위험', low: '낮은 위험' };
    const riskColor = riskColors[risk] || '#6b7280';
    const riskLabel = riskLabels[risk] || risk;

    const toxic = Array.isArray(d.toxic_clauses) ? d.toxic_clauses : [];
    const missing = Array.isArray(d.missing_clauses) ? d.missing_clauses : [];
    const improve = Array.isArray(d.improvement_suggestions) ? d.improvement_suggestions : [];
    const lc = d.legal_compliance || {};
    const sevColors = { high: '#dc2626', medium: '#ca8a04', low: '#6b7280' };
    const sevLabels = { high: '높음', medium: '중간', low: '낮음' };

    const lawRow = (name, key) => {
      const row = lc[key] || {};
      const ok = row.compliant === true;
      const issues = Array.isArray(row.issues) ? row.issues : [];
      const color = ok ? '#16a34a' : '#dc2626';
      const icon = ok ? '✅' : '⚠️';
      return `<div style="padding:8px 12px;background:${ok ? '#f0fdf4' : '#fef2f2'};border:1px solid ${ok ? '#bbf7d0' : '#fecaca'};border-radius:6px;margin-bottom:6px">
        <div style="font-weight:600;color:${color};font-size:12px">${icon} ${esc(name)} ${ok ? '부합' : '위반 가능성'}</div>
        ${issues.length > 0 ? `<ul style="margin:4px 0 0 18px;font-size:11px;color:#374151">${issues.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
      </div>`;
    };

    return `<div class="ct-legal-card" style="border:2px solid ${riskColor};border-radius:8px;padding:14px;background:#fafafa;margin-top:10px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
        <div>
          <div style="font-size:14px;font-weight:600">🤖 AI 법무 검토 결과</div>
          ${d.target_filename ? `<div style="font-size:11px;color:var(--text-3);margin-top:2px">${esc(d.target_filename)}</div>` : ''}
        </div>
        <button class="btn btn-ghost btn-sm" id="ct-legal-close-btn" type="button" title="닫기">✕</button>
      </div>

      <!-- 점수 + 위험도 -->
      <div style="display:grid;grid-template-columns:120px 1fr;gap:14px;margin-bottom:14px">
        <div style="text-align:center;padding:12px;background:#fff;border:2px solid ${riskColor};border-radius:8px">
          <div style="font-size:10px;color:var(--text-3);margin-bottom:4px">안전성 점수</div>
          <div style="font-size:28px;font-weight:700;color:${riskColor}">${score}<span style="font-size:14px;opacity:0.6">/100</span></div>
          <div style="margin-top:6px;display:inline-block;padding:2px 10px;background:${riskColor};color:#fff;border-radius:10px;font-size:11px;font-weight:600">${esc(riskLabel)}</div>
        </div>
        <div style="padding:12px;background:#fff;border:1px solid var(--border);border-radius:8px">
          <div style="font-size:11px;color:var(--text-3);margin-bottom:4px">위험 항목 요약</div>
          <div style="display:flex;gap:14px;font-size:13px">
            <div>🔴 독소조항 <strong>${toxic.length}</strong>건</div>
            <div>🟡 누락조항 <strong>${missing.length}</strong>건</div>
            <div>💡 개선 제안 <strong>${improve.length}</strong>건</div>
          </div>
          ${d.generated_at ? `<div style="margin-top:8px;font-size:10px;color:var(--text-3)">생성: ${_fmtDateTime(d.generated_at)}</div>` : ''}
        </div>
      </div>

      <!-- 한국 법규 부합 -->
      <div style="margin-bottom:14px">
        <div style="font-size:12px;font-weight:600;margin-bottom:6px">🇰🇷 한국 법규 부합 여부</div>
        ${lawRow('공정거래법', 'fair_trade_act')}
        ${lawRow('하도급법', 'subcontract_act')}
        ${lawRow('개인정보보호법', 'privacy_act')}
      </div>

      <!-- 독소조항 -->
      ${toxic.length > 0 ? `<div style="margin-bottom:14px">
        <div style="font-size:12px;font-weight:600;margin-bottom:6px;color:#dc2626">🔴 독소조항 (${toxic.length}건)</div>
        <ul style="margin:0;padding-left:0;list-style:none">
          ${toxic.map(c => `<li style="margin-bottom:10px;padding:10px;background:#fef2f2;border-left:3px solid ${sevColors[c.severity] || '#dc2626'};border-radius:4px">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px">
              <strong style="font-size:12px">${esc(c.clause_type)} ${c.location ? `<span style="font-weight:400;color:var(--text-3);font-size:11px">— ${esc(c.location)}</span>` : ''}</strong>
              <span style="font-size:10px;padding:1px 8px;background:${sevColors[c.severity] || '#6b7280'};color:#fff;border-radius:10px">${esc(sevLabels[c.severity] || c.severity)}</span>
            </div>
            ${c.original_text ? `<div style="font-size:11px;color:#7f1d1d;margin:4px 0;padding:6px 8px;background:#fee;border-radius:4px;font-family:serif">"${esc(c.original_text)}"</div>` : ''}
            ${c.why_problematic ? `<div style="font-size:11px;color:#374151;margin:4px 0">⚠️ ${esc(c.why_problematic)}</div>` : ''}
            ${c.suggested_fix ? `<div style="font-size:11px;color:#065f46;margin-top:4px;padding:6px 8px;background:#f0fdf4;border-radius:4px">💡 <strong>수정안:</strong> ${esc(c.suggested_fix)}</div>` : ''}
          </li>`).join('')}
        </ul>
      </div>` : ''}

      <!-- 누락조항 -->
      ${missing.length > 0 ? `<div style="margin-bottom:14px">
        <div style="font-size:12px;font-weight:600;margin-bottom:6px;color:#ca8a04">🟡 누락 조항 (${missing.length}건)</div>
        <ul style="margin:0;padding-left:0;list-style:none">
          ${missing.map(m => `<li style="margin-bottom:8px;padding:8px 10px;background:#fffbeb;border-left:3px solid ${sevColors[m.importance] || '#ca8a04'};border-radius:4px">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px">
              <strong style="font-size:12px">${esc(m.clause_type)}</strong>
              <span style="font-size:10px;padding:1px 8px;background:${sevColors[m.importance] || '#6b7280'};color:#fff;border-radius:10px">${esc(sevLabels[m.importance] || m.importance)}</span>
            </div>
            ${m.suggested_addition ? `<div style="font-size:11px;color:#374151">${esc(m.suggested_addition)}</div>` : ''}
          </li>`).join('')}
        </ul>
      </div>` : ''}

      <!-- 개선 제안 -->
      ${improve.length > 0 ? `<div style="margin-bottom:14px">
        <div style="font-size:12px;font-weight:600;margin-bottom:6px">💡 개선 제안 (${improve.length}건)</div>
        <ul style="margin:0;padding-left:18px;font-size:12px">
          ${improve.map(s => `<li><strong>${esc(s.section)}</strong>: ${esc(s.suggestion)}</li>`).join('')}
        </ul>
      </div>` : ''}

      <!-- 종합 평가 -->
      ${d.overall_assessment ? `<div style="margin-top:14px;padding:10px;background:#fff;border:1px solid var(--border);border-radius:6px">
        <div style="font-size:12px;font-weight:600;margin-bottom:6px">📝 종합 평가</div>
        <div style="font-size:12px;color:#374151;white-space:pre-wrap;line-height:1.6">${esc(d.overall_assessment)}</div>
      </div>` : ''}
    </div>`;
  }

  function _renderFileList(files, contractId) {
    if (!files.length) {
      return `<div style="padding:14px;text-align:center;color:var(--text-3);background:#fafafa;border-radius:6px;border:1px dashed var(--border);font-size:12px">아직 첨부 파일 없음</div>`;
    }
    return `<table class="data-table" style="font-size:12px">
      <thead><tr>
        <th style="width:90px">유형</th>
        <th>파일명</th>
        <th style="width:90px">크기</th>
        <th style="width:120px">등록일</th>
        <th style="width:200px;text-align:center">작업</th>
      </tr></thead>
      <tbody>
        ${files.map(f => {
          const analyzable = _isAnalyzable(f.original_filename);
          return `<tr>
            <td><span class="badge badge-gray">${esc(f.file_type || '-')}</span></td>
            <td>${esc(f.original_filename)}</td>
            <td>${f.file_size ? (f.file_size / 1024).toFixed(1) + ' KB' : '-'}</td>
            <td>${_fmtDate(f.created_at)}</td>
            <td style="text-align:center;white-space:nowrap">
              ${analyzable
                ? `<button class="btn btn-ghost btn-sm ct-legal-btn" data-id="${f.id}" data-name="${esc(f.original_filename)}" type="button" title="AI 법무 검토" style="font-size:11px;padding:2px 6px;color:#7c3aed">🤖 법무</button>`
                : `<span style="display:inline-block;font-size:10px;color:var(--text-3);padding:2px 6px" title="PDF/이미지/텍스트만 AI 분석 가능">—</span>`}
              <a class="btn btn-ghost btn-sm" href="${API.contracts.downloadFileUrl(contractId, f.id)}" data-ct-file-download="${f.id}" title="다운로드" style="font-size:11px;padding:2px 6px">다운로드</a>
              <button class="btn btn-ghost btn-sm ct-file-del" data-id="${f.id}" type="button" style="color:#d93025;font-size:11px;padding:2px 6px" title="삭제">삭제</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
  }

  function _bindFileEvents(contractId) {
    const addBtn = document.getElementById('ct-file-add-btn');
    const input = document.getElementById('ct-file-input');
    if (addBtn && input) {
      addBtn.addEventListener('click', () => input.click());
      input.addEventListener('change', async ev => {
        const files = Array.from(ev.target.files || []);
        if (!files.length) return;
        const fd = new FormData();
        files.forEach(f => fd.append('files', f));
        fd.append('file_type', 'contract');
        try {
          Toast.info?.(`${files.length}개 파일 업로드 중...`);
          await API.contracts.uploadFile(contractId, fd);
          Toast.success?.(`${files.length}개 파일 업로드 완료`);
          await _reopenModalFresh(contractId);
        } catch (err) {
          Toast.error?.('업로드 실패: ' + (err.message || err));
        }
        ev.target.value = '';
      });
    }
    document.querySelectorAll('.ct-file-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('이 파일을 삭제하시겠습니까?')) return;
        try {
          await API.contracts.deleteFile(contractId, parseInt(btn.dataset.id, 10));
          Toast.success?.('파일 삭제됨');
          await _reopenModalFresh(contractId);
        } catch (err) {
          Toast.error?.('삭제 실패: ' + (err.message || err));
        }
      });
    });

    // [🤖 법무] AI 법무 검토 실행
    document.querySelectorAll('.ct-legal-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const fileId = parseInt(btn.dataset.id, 10);
        const name = btn.dataset.name || '계약서';
        const ok = confirm(
          `🤖 AI 법무 검토를 실행하시겠습니까?\n\n` +
            `대상 파일: ${name}\n\n` +
            `Gemini 2.5 Pro 가 한국법(공정거래법·하도급법·개인정보보호법) 관점에서 ` +
            `독소조항·누락조항·수정안을 분석합니다.\n\n` +
            `• 소요 시간: 약 30-60초\n` +
            `• 예상 비용: 약 500-1000원/회\n\n` +
            `계속하시겠습니까?`
        );
        if (!ok) return;
        const origText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '⏳';
        try {
          Toast.info?.('AI 법무 검토 중... (최대 60초 소요)');
          const res = await API.contracts.legalReview(contractId, fileId);
          const data = res?.data;
          if (!data) throw new Error('응답 비어있음');
          Toast.success?.(
            `AI 법무 검토 완료 — 점수 ${data.review_score}, 위험도 ${data.risk_level}`
          );
          const wrap = document.getElementById('ct-legal-review-wrap');
          if (wrap) {
            wrap.innerHTML = _renderLegalReview(data);
            wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
            _bindLegalCloseBtn();
          }
        } catch (err) {
          console.error('[contracts:legal-review] failed:', err);
          const detail = err?.error || err?.message || String(err);
          Toast.error?.('AI 법무 검토 실패: ' + detail, { duration: 8000 });
        } finally {
          btn.disabled = false;
          btn.innerHTML = origText;
        }
      });
    });
    _bindLegalCloseBtn();

    // 다운로드 (인증 헤더 fetch)
    document.querySelectorAll('[data-ct-file-download]').forEach(a => {
      a.addEventListener('click', async ev => {
        ev.preventDefault();
        const fileId = parseInt(a.dataset.ctFileDownload, 10);
        try {
          const token = localStorage.getItem('oci_token');
          const userId = localStorage.getItem('current_user_id');
          const res = await fetch(API.contracts.downloadFileUrl(contractId, fileId), {
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              ...(userId ? { 'X-User-Id': userId } : {}),
            },
          });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const aDl = document.createElement('a');
          aDl.href = url;
          const cd = res.headers.get('Content-Disposition') || '';
          const m = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)/i);
          aDl.download = m ? decodeURIComponent(m[1]) : 'contract_file';
          document.body.appendChild(aDl);
          aDl.click();
          aDl.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (err) {
          Toast.error?.('다운로드 실패: ' + (err.message || err));
        }
      });
    });
  }

  function _bindLegalCloseBtn() {
    const closeBtn = document.getElementById('ct-legal-close-btn');
    if (!closeBtn) return;
    closeBtn.addEventListener('click', () => {
      const wrap = document.getElementById('ct-legal-review-wrap');
      if (wrap) wrap.innerHTML = '';
    });
  }

  // Step 3: 메인 AI 법무 검토 CTA 버튼 핸들러
  // 모달 상단의 큰 CTA — 가장 최근에 업로드한 분석 가능 파일을 자동 선택
  function _bindLegalCtaBtn(contractId) {
    const btn = document.getElementById('ct-legal-cta-btn');
    if (!btn) return;
    btn.addEventListener('mouseenter', () => {
      btn.style.transform = 'translateY(-2px)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'translateY(0)';
    });
    btn.addEventListener('click', async () => {
      // _list 에는 목록 행이 있지만, files 는 모달 진입 시 entity 에서만 받음
      // 가장 안전한 방법: API.contracts.get 으로 재조회 → 최신 파일 선택
      let entity;
      try {
        const r = await API.contracts.get(contractId);
        entity = r?.data;
      } catch (err) {
        Toast.error?.('계약 정보 조회 실패: ' + (err.message || err));
        return;
      }
      const files = Array.isArray(entity?.files) ? entity.files : [];
      const analyzable = files.filter(f => _isAnalyzable(f.original_filename));
      if (!analyzable.length) {
        Toast.error?.('분석 가능한 파일이 없습니다 (PDF/이미지/TXT)');
        return;
      }
      // 최신 첨부 파일 선택 (목록은 created_at DESC 정렬)
      const target = analyzable[0];
      const ok = confirm(
        `🤖 AI 법무 검토를 실행하시겠습니까?\n\n` +
          `대상 파일: ${target.original_filename}\n\n` +
          `Gemini 2.5 Pro 가 한국법(공정거래법·하도급법·개인정보보호법) 관점에서 ` +
          `독소조항·누락조항·수정안을 분석합니다.\n\n` +
          `• 소요 시간: 약 30-60초\n` +
          `• 예상 비용: 약 500-1000원/회\n\n` +
          `계속하시겠습니까?`
      );
      if (!ok) return;
      const origText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '⏳ AI 분석 중... (최대 60초)';
      try {
        Toast.info?.('AI 법무 검토 중... (최대 60초 소요)');
        const res = await API.contracts.legalReview(contractId, target.id);
        const data = res?.data;
        if (!data) throw new Error('응답 비어있음');
        Toast.success?.(
          `AI 법무 검토 완료 — 점수 ${data.review_score}, 위험도 ${data.risk_level}`
        );
        const wrap = document.getElementById('ct-legal-review-wrap');
        if (wrap) {
          wrap.innerHTML = _renderLegalReview(data);
          wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
          _bindLegalCloseBtn();
        }
      } catch (err) {
        console.error('[contracts:legal-review:cta] failed:', err);
        const detail = err?.error || err?.message || String(err);
        Toast.error?.('AI 법무 검토 실패: ' + detail, { duration: 8000 });
        btn.disabled = false;
        btn.innerHTML = origText;
      }
    });
  }

  async function _reopenModalFresh(contractId) {
    Modal.close();
    await _refreshList();
    // 임시 모드 유지 (사용자가 파일 첨부 후 모달 재진입 시 안내 카드 유지)
    const isTempMode = _tempContractId === contractId;
    await _openModal(contractId, { isTempMode });
  }

  // v6.0.0 Step 2 Commit 4: 4개 연결 Combobox 부착
  // - hidden #ct-f-{type}_id 가 실제 저장값, 표시는 #ct-f-{type}-search 텍스트
  // - 사용자가 텍스트 직접 수정 시 hidden id 해제 (정확한 선택만 저장)
  // - Combobox 미로드 시 graceful skip (이전 ID 그대로 유지)
  function _attachLinkComboboxes() {
    if (typeof Combobox === 'undefined') return;

    const setup = ({ inputId, hiddenId, fetchFn, renderItem, onSelect }) => {
      const inp = document.getElementById(inputId);
      const hid = document.getElementById(hiddenId);
      if (!inp || !hid) return;
      inp.addEventListener('input', () => {
        // 사용자가 텍스트 수정 시 hidden id 해제
        if (hid.value) hid.value = '';
      });
      Combobox.attach({
        inputEl: inp,
        fetchFn,
        renderItem,
        onSelect: item => {
          hid.value = item.id;
          onSelect(item);
        },
        minChars: 2,
        debounceMs: 250,
        allowCustom: false,
        customLabel: '(검색 결과만 선택 가능)',
      });
    };

    // 🏢 고객사
    setup({
      inputId: 'ct-f-customer-search',
      hiddenId: 'ct-f-customer_id',
      fetchFn: async q => {
        try {
          const r = await API.customers.autocomplete(q, 10);
          return r.data || [];
        } catch (_) {
          return [];
        }
      },
      renderItem: (item, q, { highlightMatch }) => {
        const meta = [item.industry, item.region].filter(Boolean).join(' · ');
        return `<div class="combobox-item-content">
          <div class="combobox-item-title">🏢 ${highlightMatch(item.name, q)}</div>
          ${meta ? `<div class="combobox-item-meta">${esc(meta)}</div>` : ''}
        </div>`;
      },
      onSelect: item => {
        document.getElementById('ct-f-customer-search').value = item.name;
        // 고객사명도 함께 자동 채움
        const nameField = document.getElementById('ct-f-customer_name');
        if (nameField) nameField.value = item.name;
      },
    });

    // 📌 영업리드
    setup({
      inputId: 'ct-f-lead-search',
      hiddenId: 'ct-f-lead_id',
      fetchFn: async q => {
        try {
          const r = await API.leads.autocomplete(q, 10);
          return r.data || [];
        } catch (_) {
          return [];
        }
      },
      renderItem: (item, q, { highlightMatch }) => {
        const meta = [item.customer_name, item.stage].filter(Boolean).join(' · ');
        return `<div class="combobox-item-content">
          <div class="combobox-item-title">📌 ${highlightMatch(item.project_name || `리드 #${item.id}`, q)}</div>
          ${meta ? `<div class="combobox-item-meta">${esc(meta)}</div>` : ''}
        </div>`;
      },
      onSelect: item => {
        document.getElementById('ct-f-lead-search').value =
          item.project_name || `리드 #${item.id}`;
        // 고객사 자동 채움 (비어있을 때만)
        if (item.customer_id && !document.getElementById('ct-f-customer_id').value) {
          document.getElementById('ct-f-customer_id').value = item.customer_id;
          if (item.customer_name) {
            document.getElementById('ct-f-customer-search').value = item.customer_name;
            const nameField = document.getElementById('ct-f-customer_name');
            if (nameField) nameField.value = item.customer_name;
          }
        }
      },
    });

    // 📝 제안
    setup({
      inputId: 'ct-f-proposal-search',
      hiddenId: 'ct-f-proposal_id',
      fetchFn: async q => {
        try {
          const r = await API.proposals.autocomplete(q, 10);
          return r.data || [];
        } catch (_) {
          return [];
        }
      },
      renderItem: (item, q, { highlightMatch }) => {
        const meta = [item.customer_name, item.status].filter(Boolean).join(' · ');
        return `<div class="combobox-item-content">
          <div class="combobox-item-title">📝 ${esc(item.proposal_no)} — ${highlightMatch(item.proposal_title, q)}</div>
          ${meta ? `<div class="combobox-item-meta">${esc(meta)}</div>` : ''}
        </div>`;
      },
      onSelect: item => {
        document.getElementById('ct-f-proposal-search').value =
          `${item.proposal_no} — ${item.proposal_title}`;
        // lead_id / customer_id 자동 채움 (비어있을 때만)
        if (item.lead_id && !document.getElementById('ct-f-lead_id').value) {
          document.getElementById('ct-f-lead_id').value = item.lead_id;
        }
        if (item.customer_id && !document.getElementById('ct-f-customer_id').value) {
          document.getElementById('ct-f-customer_id').value = item.customer_id;
          if (item.customer_name) {
            document.getElementById('ct-f-customer-search').value = item.customer_name;
            const nameField = document.getElementById('ct-f-customer_name');
            if (nameField) nameField.value = item.customer_name;
          }
        }
      },
    });

    // 📊 견적
    setup({
      inputId: 'ct-f-quote-search',
      hiddenId: 'ct-f-quote_id',
      fetchFn: async q => {
        try {
          const r = await API.quotes.autocomplete(q, 10);
          return r.data || [];
        } catch (_) {
          return [];
        }
      },
      renderItem: (item, q, { highlightMatch }) => {
        const meta = [item.customer_name, item.status].filter(Boolean).join(' · ');
        const amount = item.total_amount
          ? Number(item.total_amount).toLocaleString('ko-KR') + ' 원'
          : '';
        return `<div class="combobox-item-content">
          <div class="combobox-item-title">📊 ${esc(item.quote_no)} — ${highlightMatch(item.name, q)}</div>
          ${meta || amount ? `<div class="combobox-item-meta">${esc(meta)}${amount ? ` · ${amount}` : ''}</div>` : ''}
        </div>`;
      },
      onSelect: item => {
        document.getElementById('ct-f-quote-search').value =
          `${item.quote_no} — ${item.name}`;
        // lead_id / customer_id 자동 채움 (비어있을 때만)
        if (item.lead_id && !document.getElementById('ct-f-lead_id').value) {
          document.getElementById('ct-f-lead_id').value = item.lead_id;
        }
        if (item.customer_id && !document.getElementById('ct-f-customer_id').value) {
          document.getElementById('ct-f-customer_id').value = item.customer_id;
          if (item.customer_name) {
            document.getElementById('ct-f-customer-search').value = item.customer_name;
            const nameField = document.getElementById('ct-f-customer_name');
            if (nameField) nameField.value = item.customer_name;
          }
        }
        // 금액 자동 채움 (비어있을 때만)
        if (item.total_amount) {
          const amtField = document.getElementById('ct-f-contract_amount');
          if (amtField && !amtField.value) amtField.value = item.total_amount;
        }
      },
    });
  }

  function _collectForm() {
    return {
      contract_no: document.getElementById('ct-f-contract_no')?.value?.trim() || undefined,
      contract_type: document.getElementById('ct-f-contract_type')?.value,
      status: document.getElementById('ct-f-status')?.value,
      title: document.getElementById('ct-f-title')?.value?.trim() || '',
      customer_name: document.getElementById('ct-f-customer_name')?.value?.trim() || null,
      currency: document.getElementById('ct-f-currency')?.value,
      start_date: document.getElementById('ct-f-start_date')?.value || null,
      end_date: document.getElementById('ct-f-end_date')?.value || null,
      contract_amount: document.getElementById('ct-f-contract_amount')?.value || null,
      // 연결 (선택적)
      customer_id: parseInt(document.getElementById('ct-f-customer_id')?.value, 10) || null,
      lead_id: parseInt(document.getElementById('ct-f-lead_id')?.value, 10) || null,
      proposal_id: parseInt(document.getElementById('ct-f-proposal_id')?.value, 10) || null,
      quote_id: parseInt(document.getElementById('ct-f-quote_id')?.value, 10) || null,
      language: document.getElementById('ct-f-language')?.value,
      notes: document.getElementById('ct-f-notes')?.value?.trim() || null,
    };
  }

  async function _doSave(id, opts = {}) {
    const { isTempMode = false } = opts;
    const body = _collectForm();
    if (!body.title) {
      Toast.error?.('계약명을 입력하세요');
      document.getElementById('ct-f-title')?.focus();
      return;
    }
    try {
      if (id) {
        await API.contracts.update(id, body);
        Toast.success?.(isTempMode ? '계약 등록 완료 (정식 저장됨)' : '저장됨');
        // v6.0.0 Phase A2-2: 임시 모드에서 정식 저장 → 임시 추적 ID 해제
        if (isTempMode && _tempContractId === id) {
          _tempContractId = null;
        }
      } else {
        const res = await API.contracts.create(body);
        Toast.success?.(`계약 등록 완료 — ${res?.data?.contract_no || ''}`);
      }
      Modal.close();
      await _refreshList();
    } catch (err) {
      Toast.error?.('저장 실패: ' + (err.message || err));
    }
  }

  async function _doDelete(id) {
    const contract = _list.find(c => c.id === id);
    const label = contract ? `${contract.contract_no} (${contract.title})` : `#${id}`;
    if (!confirm(`이 계약을 삭제하시겠습니까?\n\n${label}\n\n첨부 파일과 이력도 함께 삭제됩니다.`))
      return;
    try {
      await API.contracts.delete(id);
      Toast.success?.('삭제됨');
      await _refreshList();
    } catch (err) {
      Toast.error?.('삭제 실패: ' + (err.message || err));
    }
  }

  return { render };
})();
