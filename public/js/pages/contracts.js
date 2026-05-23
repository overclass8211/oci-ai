// ============================================================
// ContractsPage — 계약 모듈 (Phase 0: 기본 CRUD + 파일 업로드)
// 데이터: /api/contracts  (헤더 + 파일 + history)
//
// Phase 0 범위 (현재):
//   - 목록 (검색 + 상태/유형 필터)
//   - 작성/편집 모달 (기본 필드)
//   - 파일 업로드 / 다운로드 / 삭제
//   - 삭제 (confirm + CASCADE)
//
// Phase 1+ 추가 예정:
//   - CLM 워크플로우 (상태 전이 빠른 액션)
//   - AI 법무 검토 (독소조항/누락/한국법규)
//   - 템플릿 라이브러리
//   - 만료 알림 + 협상 코칭 + 다국어 + 전자서명
// ============================================================
const ContractsPage = (() => {
  let _list = [];
  let _editing = null;
  const _filters = { search: '', status: '', contract_type: '' };

  // ── 상태/유형 메타 ─────────────────────────────────────────
  const STATUS_LABELS = {
    draft: '초안',
    review: '검토중',
    negotiation: '협상중',
    signing: '서명진행',
    active: '발효',
    renewal: '갱신중',
    expired: '만료',
    terminated: '해지',
  };
  const STATUS_COLORS = {
    draft: '#6b7280',
    review: '#3b82f6',
    negotiation: '#a855f7',
    signing: '#0ea5e9',
    active: '#16a34a',
    renewal: '#ca8a04',
    expired: '#9ca3af',
    terminated: '#dc2626',
  };

  // Phase 1: CLM 워크플로우 빠른 액션 매트릭스 (백엔드 STATUS_TRANSITIONS 와 동기화)
  // 각 상태에서 표시할 빠른 액션 버튼 목록
  // { to, label, kind } — kind: primary/ghost/danger
  const QUICK_ACTIONS = {
    draft: [
      { to: 'review', label: '📋 검토 시작', kind: 'primary' },
      { to: 'terminated', label: '❌ 해지', kind: 'danger' },
    ],
    review: [
      { to: 'negotiation', label: '💬 협상 시작', kind: 'primary' },
      { to: 'draft', label: '⬅ 초안 복귀', kind: 'ghost' },
      { to: 'terminated', label: '❌ 해지', kind: 'danger' },
    ],
    negotiation: [
      { to: 'signing', label: '✍ 서명 요청', kind: 'primary' },
      { to: 'review', label: '⬅ 검토 복귀', kind: 'ghost' },
      { to: 'terminated', label: '❌ 해지', kind: 'danger' },
    ],
    signing: [
      { to: 'active', label: '✅ 발효 처리', kind: 'primary' },
      { to: 'negotiation', label: '⬅ 협상 복귀', kind: 'ghost' },
      { to: 'terminated', label: '❌ 해지', kind: 'danger' },
    ],
    active: [
      { to: 'renewal', label: '🔄 갱신 시작', kind: 'primary' },
      { to: 'expired', label: '⏰ 만료 처리', kind: 'ghost' },
      { to: 'terminated', label: '❌ 해지', kind: 'danger' },
    ],
    renewal: [
      { to: 'active', label: '✅ 갱신 완료', kind: 'primary' },
      { to: 'expired', label: '⏰ 만료 처리', kind: 'ghost' },
      { to: 'terminated', label: '❌ 해지', kind: 'danger' },
    ],
    expired: [{ to: 'terminated', label: '❌ 해지', kind: 'danger' }],
    terminated: [], // 종착점 — 빠른 액션 없음
  };

  // Phase 1: 만료 임박 (30일 이내) 체크 — active 상태 + end_date 가 미래 30일 이내
  function _isExpiringSoon(c) {
    if (c.status !== 'active' || !c.end_date) return false;
    const end = new Date(c.end_date);
    if (isNaN(end)) return false;
    const now = new Date();
    const diffDays = Math.floor((end - now) / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays <= 30;
  }
  function _daysUntilEnd(c) {
    if (!c.end_date) return null;
    const end = new Date(c.end_date);
    if (isNaN(end)) return null;
    const now = new Date();
    return Math.floor((end - now) / (1000 * 60 * 60 * 24));
  }
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
  function _esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  const esc = _esc; // alias
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
  async function render(container) {
    container.innerHTML = `
      <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div>
          <h1 style="margin:0;font-size:20px">📜 계약 관리</h1>
          <div style="font-size:12px;color:var(--text-3);margin-top:4px">계약 라이프사이클 + AI 법무 검토 (Phase 0: 기본 CRUD)</div>
        </div>
        <div>
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
    document.getElementById('ct-new-btn').addEventListener('click', () => _openModal(null));
    document.getElementById('ct-refresh-btn').addEventListener('click', () => _refreshList());

    const searchInput = document.getElementById('ct-search');
    let debounceTimer;
    searchInput.addEventListener('input', e => {
      clearTimeout(debounceTimer);
      const val = e.target.value;
      debounceTimer = setTimeout(() => {
        _filters.search = val;
        _refreshList();
      }, 250);
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

  async function _refreshList() {
    const wrap = document.getElementById('ct-list-wrap');
    if (!wrap) return;
    wrap.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-3)">⏳ 불러오는 중...</div>';
    try {
      const res = await API.contracts.list({
        ..._filters,
        limit: 100,
      });
      _list = res?.data || [];
      _renderList();
    } catch (err) {
      console.error('[contracts:list] failed:', err);
      wrap.innerHTML = `<div style="padding:30px;text-align:center;color:#dc2626">목록 로딩 실패: ${esc(err?.message || err)}</div>`;
    }
  }

  function _renderList() {
    const wrap = document.getElementById('ct-list-wrap');
    if (!wrap) return;
    if (!_list.length) {
      wrap.innerHTML = `
        <div style="padding:60px 20px;text-align:center;color:var(--text-3);background:#fafafa;border:1px dashed var(--border);border-radius:8px">
          <div style="font-size:48px;margin-bottom:12px">📜</div>
          <div style="font-size:14px;margin-bottom:6px">등록된 계약이 없습니다</div>
          <div style="font-size:12px">[+ 새 계약] 버튼으로 첫 계약을 등록하세요</div>
        </div>`;
      return;
    }
    wrap.innerHTML = `
      <table class="data-table" style="font-size:13px">
        <thead><tr>
          <th style="width:120px">계약번호</th>
          <th style="width:90px">유형</th>
          <th>계약명</th>
          <th style="width:160px">고객사</th>
          <th style="width:100px">시작일</th>
          <th style="width:100px">종료일</th>
          <th style="width:120px;text-align:right">계약금액</th>
          <th style="width:90px;text-align:center">상태</th>
          <th style="width:60px;text-align:center">파일</th>
          <th style="width:140px;text-align:center">작업</th>
        </tr></thead>
        <tbody>
          ${_list
            .map(
              c => `<tr>
            <td style="font-family:monospace;font-size:12px">${esc(c.contract_no)}</td>
            <td><span class="badge badge-gray" style="font-size:10px">${esc(CONTRACT_TYPE_LABELS[c.contract_type] || c.contract_type || '-')}</span></td>
            <td><strong>${esc(c.title)}</strong></td>
            <td>${esc(c.customer_name || '-')}</td>
            <td style="font-size:12px">${_fmtDate(c.start_date)}</td>
            <td style="font-size:12px">${_fmtDate(c.end_date)}${
              _isExpiringSoon(c)
                ? `<div style="font-size:10px;color:#dc2626;font-weight:600;margin-top:2px">⚠️ D-${_daysUntilEnd(c)} 만료 임박</div>`
                : ''
            }</td>
            <td style="text-align:right;font-family:monospace">${_fmtKRW(c.contract_amount)} ${c.contract_amount ? esc(c.currency || '') : ''}</td>
            <td style="text-align:center">${_statusBadge(c.status)}</td>
            <td style="text-align:center;font-size:12px">${c.file_count > 0 ? `📎 ${c.file_count}` : '-'}</td>
            <td style="text-align:center;white-space:nowrap">
              <button class="btn btn-ghost btn-sm ct-edit-btn" data-id="${c.id}" style="font-size:11px;padding:2px 8px">편집</button>
              <button class="btn btn-ghost btn-sm ct-del-btn" data-id="${c.id}" style="font-size:11px;padding:2px 8px;color:#dc2626">삭제</button>
            </td>
          </tr>`
            )
            .join('')}
        </tbody>
      </table>
    `;
    wrap.querySelectorAll('.ct-edit-btn').forEach(b => {
      b.addEventListener('click', () => _openModal(parseInt(b.dataset.id, 10)));
    });
    wrap.querySelectorAll('.ct-del-btn').forEach(b => {
      b.addEventListener('click', () => _doDelete(parseInt(b.dataset.id, 10)));
    });
  }

  // ── 작성/편집 모달 ─────────────────────────────────────────
  async function _openModal(id) {
    let editing;
    if (id) {
      try {
        const res = await API.contracts.get(id);
        editing = res?.data;
      } catch (err) {
        Toast.error?.('계약 조회 실패: ' + (err.message || err));
        return;
      }
    } else {
      // 신규 — 다음 자동 채번 미리보기
      try {
        const r = await API.contracts.nextContractNo();
        editing = {
          contract_no: r?.data?.contract_no || '',
          contract_type: 'NDA',
          status: 'draft',
          currency: 'KRW',
          language: 'ko',
          auto_renewal: 0,
          renewal_notice_days: 30,
          version_no: 1,
          start_date: _toInputDate(new Date()),
        };
      } catch (_) {
        editing = { contract_type: 'etc', status: 'draft', currency: 'KRW' };
      }
    }
    _editing = editing;

    // Phase 1: 편집 모달 footer 에 빠른 액션 버튼 동적 추가
    const buttons = [{ label: '취소', kind: 'ghost', onClick: () => Modal.close() }];

    if (id) {
      // 현재 상태에서 가능한 빠른 액션 (전이 매트릭스 기반)
      const quickActions = QUICK_ACTIONS[editing.status] || [];
      quickActions.forEach(action => {
        buttons.push({
          label: action.label,
          kind: action.kind,
          onClick: () => _doStatusChange(id, editing.status, action.to, action.label),
        });
      });
    }

    buttons.push({
      label: id ? '💾 저장' : '➕ 등록',
      kind: 'primary',
      onClick: () => _doSave(id),
    });

    Modal.open({
      title: id ? `📜 계약 편집 — ${editing.contract_no}` : '📜 새 계약 등록',
      width: '900px',
      content: _renderForm(editing),
      buttons,
      disableOverlayClose: true,
      onMounted: () => {
        if (id) _bindFileEvents(id);
      },
    });
  }

  // Phase 1: 상태 전이 실행 (confirm + PATCH + 모달 갱신)
  async function _doStatusChange(id, fromStatus, toStatus, label) {
    const fromKo = STATUS_LABELS[fromStatus] || fromStatus;
    const toKo = STATUS_LABELS[toStatus] || toStatus;
    const isDanger = toStatus === 'terminated' || toStatus === 'expired';
    const msg =
      `상태를 변경하시겠습니까?\n\n` +
      `${fromKo}  →  ${toKo}\n\n` +
      (toStatus === 'terminated'
        ? '⚠️ 해지 후에는 다른 상태로 되돌릴 수 없습니다.'
        : toStatus === 'expired'
          ? '⏰ 만료 처리 후에는 해지만 추가로 가능합니다.'
          : toStatus === 'active' && fromStatus === 'signing'
            ? '✅ 발효 시작일(start_date)이 비어있으면 오늘 날짜로 자동 채워집니다.'
            : '');
    if (isDanger && !confirm(msg)) return;
    if (!isDanger && !confirm(msg)) return;
    try {
      const res = await API.contracts.setStatus(id, toStatus);
      const autoDate = res?.data?.auto_start_date;
      Toast.success?.(
        `${label} 완료 — ${fromKo} → ${toKo}` + (autoDate ? ` (start_date 자동 채움: ${autoDate})` : '')
      );
      Modal.close();
      await _refreshList();
      // 모달 다시 열어서 새 상태로 갱신
      await _openModal(id);
    } catch (err) {
      console.error('[contracts:status-change] failed:', err);
      const detail = err?.error || err?.message || String(err);
      Toast.error?.(`상태 변경 실패: ${detail}`, { duration: 6000 });
    }
  }

  function _renderForm(e) {
    e = e || {};
    return `
      <div class="form-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
        <div class="form-row">
          <label class="form-label">계약번호</label>
          <input class="form-input" id="ct-f-contract_no" value="${esc(e.contract_no || '')}"
            ${e.id ? 'readonly style="background:#f5f5f7;color:#666"' : 'placeholder="(저장 시 자동 생성)"'}>
        </div>
        <div class="form-row">
          <label class="form-label">계약 유형</label>
          <select class="form-input" id="ct-f-contract_type">
            ${Object.entries(CONTRACT_TYPE_LABELS)
              .map(([k, v]) => `<option value="${k}" ${e.contract_type === k ? 'selected' : ''}>${esc(v)}</option>`)
              .join('')}
          </select>
        </div>
        <div class="form-row">
          <label class="form-label">상태</label>
          <select class="form-input" id="ct-f-status">
            ${Object.entries(STATUS_LABELS)
              .map(([k, v]) => `<option value="${k}" ${e.status === k ? 'selected' : ''}>${esc(v)}</option>`)
              .join('')}
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

        <div class="form-row">
          <label class="form-label">자동 갱신</label>
          <select class="form-input" id="ct-f-auto_renewal">
            <option value="0" ${!e.auto_renewal ? 'selected' : ''}>No</option>
            <option value="1" ${e.auto_renewal ? 'selected' : ''}>Yes</option>
          </select>
        </div>
        <div class="form-row">
          <label class="form-label">갱신 알림 (일)</label>
          <input class="form-input" id="ct-f-renewal_notice_days" type="number" min="1" max="365"
            value="${e.renewal_notice_days || 30}">
        </div>
        <div class="form-row">
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
              <div style="margin-bottom:10px;padding:8px 12px;background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;font-size:11px;color:#92400e">
                💡 <strong>🤖 AI 법무 검토</strong> — 계약서 PDF/이미지/텍스트 파일에서 사용 가능. Gemini 2.5 Pro 가 한국법(공정거래법·하도급법·개인정보보호법) 관점에서 독소조항·누락조항·수정안을 자동 생성합니다 (약 30-60초 · 1회 약 500-1000원)
              </div>
              <input type="file" id="ct-file-input" multiple style="display:none"
                accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.hwp,.hwpx,.png,.jpg,.jpeg,.txt,.md">
              ${_renderFileList(e.files || [], e.id)}

              <!-- Phase 2: AI 법무 검토 결과 카드 (최신 검토 자동 prefill) -->
              <div id="ct-legal-review-wrap" style="margin-top:14px">
                ${e.latest_legal_review ? _renderLegalReview(e.latest_legal_review) : ''}
              </div>
            </div>`
          : '<div style="margin-top:14px;padding:10px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:12px;color:#92400e">💡 계약 등록 후 파일 첨부 + AI 법무 검토가 가능합니다</div>'
      }
    `;
  }

  // Phase 2: AI 분석 가능 형식 (PDF / 이미지 / 텍스트)
  function _isAnalyzable(filename) {
    if (!filename) return false;
    return /\.(pdf|png|jpe?g|webp|txt|md)$/i.test(filename);
  }

  // Phase 2: 법무 검토 결과 카드 (색상 코드 + 4섹션)
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
      ${
        toxic.length > 0
          ? `<div style="margin-bottom:14px">
              <div style="font-size:12px;font-weight:600;margin-bottom:6px;color:#dc2626">🔴 독소조항 (${toxic.length}건)</div>
              <ul style="margin:0;padding-left:0;list-style:none">
                ${toxic
                  .map(
                    c => `<li style="margin-bottom:10px;padding:10px;background:#fef2f2;border-left:3px solid ${sevColors[c.severity] || '#dc2626'};border-radius:4px">
                  <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                    <strong style="font-size:12px">${esc(c.clause_type)} ${c.location ? `<span style="font-weight:400;color:var(--text-3);font-size:11px">— ${esc(c.location)}</span>` : ''}</strong>
                    <span style="font-size:10px;padding:1px 8px;background:${sevColors[c.severity] || '#6b7280'};color:#fff;border-radius:10px">${esc(sevLabels[c.severity] || c.severity)}</span>
                  </div>
                  ${c.original_text ? `<div style="font-size:11px;color:#7f1d1d;margin:4px 0;padding:6px 8px;background:#fee;border-radius:4px;font-family:serif">"${esc(c.original_text)}"</div>` : ''}
                  ${c.why_problematic ? `<div style="font-size:11px;color:#374151;margin:4px 0">⚠️ ${esc(c.why_problematic)}</div>` : ''}
                  ${c.suggested_fix ? `<div style="font-size:11px;color:#065f46;margin-top:4px;padding:6px 8px;background:#f0fdf4;border-radius:4px">💡 <strong>수정안:</strong> ${esc(c.suggested_fix)}</div>` : ''}
                </li>`
                  )
                  .join('')}
              </ul>
            </div>`
          : ''
      }

      <!-- 누락조항 -->
      ${
        missing.length > 0
          ? `<div style="margin-bottom:14px">
              <div style="font-size:12px;font-weight:600;margin-bottom:6px;color:#ca8a04">🟡 누락 조항 (${missing.length}건)</div>
              <ul style="margin:0;padding-left:0;list-style:none">
                ${missing
                  .map(
                    m => `<li style="margin-bottom:8px;padding:8px 10px;background:#fffbeb;border-left:3px solid ${sevColors[m.importance] || '#ca8a04'};border-radius:4px">
                  <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                    <strong style="font-size:12px">${esc(m.clause_type)}</strong>
                    <span style="font-size:10px;padding:1px 8px;background:${sevColors[m.importance] || '#6b7280'};color:#fff;border-radius:10px">${esc(sevLabels[m.importance] || m.importance)}</span>
                  </div>
                  ${m.suggested_addition ? `<div style="font-size:11px;color:#374151">${esc(m.suggested_addition)}</div>` : ''}
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
          ? `<div style="margin-bottom:14px">
              <div style="font-size:12px;font-weight:600;margin-bottom:6px">💡 개선 제안 (${improve.length}건)</div>
              <ul style="margin:0;padding-left:18px;font-size:12px">
                ${improve.map(s => `<li><strong>${esc(s.section)}</strong>: ${esc(s.suggestion)}</li>`).join('')}
              </ul>
            </div>`
          : ''
      }

      <!-- 종합 평가 (마크다운) -->
      ${
        d.overall_assessment
          ? `<div style="margin-top:14px;padding:10px;background:#fff;border:1px solid var(--border);border-radius:6px">
              <div style="font-size:12px;font-weight:600;margin-bottom:6px">📝 종합 평가</div>
              <div style="font-size:12px;color:#374151;white-space:pre-wrap;line-height:1.6">${esc(d.overall_assessment)}</div>
            </div>`
          : ''
      }
    </div>`;
  }

  function _fmtDateTime(s) {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d)) return s;
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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
        <th style="width:230px;text-align:center">작업</th>
      </tr></thead>
      <tbody>
        ${files
          .map(f => {
            const analyzable = _isAnalyzable(f.original_filename);
            return `<tr>
          <td><span class="badge badge-gray">${esc(f.file_type || '-')}</span></td>
          <td>${esc(f.original_filename)}</td>
          <td>${f.file_size ? (f.file_size / 1024).toFixed(1) + ' KB' : '-'}</td>
          <td>${_fmtDate(f.created_at)}</td>
          <td style="text-align:center;white-space:nowrap">
            ${
              analyzable
                ? `<button class="btn btn-ghost btn-sm ct-legal-btn" data-id="${f.id}" data-name="${esc(f.original_filename)}" type="button" title="AI 법무 검토" style="font-size:11px;padding:2px 6px;color:#7c3aed">🤖 법무</button>`
                : `<span style="display:inline-block;font-size:10px;color:var(--text-3);padding:2px 6px" title="PDF/이미지/텍스트만 AI 분석 가능">—</span>`
            }
            <a class="btn btn-ghost btn-sm" href="${API.contracts.downloadFileUrl(contractId, f.id)}" data-ct-file-download="${f.id}" title="다운로드" style="font-size:11px;padding:2px 6px">다운로드</a>
            <button class="btn btn-ghost btn-sm ct-file-del" data-id="${f.id}" type="button" style="color:#d93025;font-size:11px;padding:2px 6px" title="삭제">삭제</button>
          </td>
        </tr>`;
          })
          .join('')}
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
    // Phase 2: [🤖 법무] AI 법무 검토 실행
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
    // Phase 2: 결과 카드 [✕ 닫기] (latest_legal_review prefill 시에도 동작)
    _bindLegalCloseBtn();
    // 다운로드: GCP CORS 우회를 위한 인증 헤더 fetch (proposals 패턴)
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
          // 파일명: Content-Disposition 파싱 (간단)
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

  async function _reopenModalFresh(contractId) {
    Modal.close();
    await _refreshList();
    await _openModal(contractId);
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
      auto_renewal: document.getElementById('ct-f-auto_renewal')?.value === '1',
      renewal_notice_days:
        parseInt(document.getElementById('ct-f-renewal_notice_days')?.value, 10) || 30,
      language: document.getElementById('ct-f-language')?.value,
      notes: document.getElementById('ct-f-notes')?.value?.trim() || null,
    };
  }

  async function _doSave(id) {
    const body = _collectForm();
    if (!body.title) {
      Toast.error?.('계약명을 입력하세요');
      document.getElementById('ct-f-title')?.focus();
      return;
    }
    try {
      if (id) {
        await API.contracts.update(id, body);
        Toast.success?.('저장됨');
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

  // Phase 2: 법무 검토 카드 닫기 버튼
  function _bindLegalCloseBtn() {
    const closeBtn = document.getElementById('ct-legal-close-btn');
    if (!closeBtn) return;
    closeBtn.addEventListener('click', () => {
      const wrap = document.getElementById('ct-legal-review-wrap');
      if (wrap) wrap.innerHTML = '';
    });
  }

  return { render };
})();
