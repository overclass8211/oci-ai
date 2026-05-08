// ============================================================
// Customers Page — 고객사 등록 (직접입력 / 명함 OCR) + AI 인텔리전스
// ============================================================
const CustomersPage = {
  data: [],
  selectedCustomer: null,
  _ocrFiles: [],
  _ocrResults: [],
  _activeRegTab: 'direct',
  _view: localStorage.getItem('customers_view') || 'list',

  async render() {
    document.getElementById('content').innerHTML = `
      <div class="filter-bar">
        <input class="search-input" id="cust-search" placeholder="고객사명 검색..."
               oninput="CustomersPage.applyFilter()">
        <select class="filter-select" id="cust-region" onchange="CustomersPage.applyFilter()">
          <option value="">전체 지역</option>
          <option value="국내">국내</option>
          <option value="해외">해외</option>
        </select>

        <div class="view-toggle" style="margin-left:auto">
          <button class="view-toggle-btn ${this._view === 'list' ? 'active' : ''}"
                  data-view="list" onclick="CustomersPage.switchView('list')" title="목록 보기">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
              <path d="M2 3h12v2H2zM2 7h12v2H2zM2 11h12v2H2z"/>
            </svg>
            목록
          </button>
          <button class="view-toggle-btn ${this._view === 'card' ? 'active' : ''}"
                  data-view="card" onclick="CustomersPage.switchView('card')" title="카드 보기">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
              <path d="M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z"/>
            </svg>
            카드
          </button>
        </div>

        <button class="btn btn-primary"
                onclick="CustomersPage.openRegisterModal('direct')">
          + 고객사 등록
        </button>
      </div>

      <div id="customers-view-container" style="margin-bottom:12px">
        <div class="loading" style="padding:40px;text-align:center">로딩...</div>
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
              <button class="btn btn-ghost btn-sm" onclick="CustomersPage.closeIntel()">✕</button>
            </div>
          </div>
          <div id="intel-content" class="card-body" style="min-height:120px;font-size:13px;line-height:1.7">
            <span class="ai-cursor">▋</span>
          </div>
        </div>
      </div>
    `;
    await this.loadData();
  },

  async loadData() {
    try {
      const res = await API.customers.list();
      this.data = res.data;
      this.applyFilter();
    } catch (err) { console.error(err); }
  },

  applyFilter() {
    const search = (document.getElementById('cust-search')?.value || '').toLowerCase();
    const region = document.getElementById('cust-region')?.value || '';
    const filtered = this.data.filter(c =>
      (!search || c.name.toLowerCase().includes(search)) &&
      (!region || c.region === region)
    );
    this.renderView(filtered);
  },

  switchView(view) {
    if (view === this._view) return;
    this._view = view;
    localStorage.setItem('customers_view', view);
    document.querySelectorAll('.view-toggle-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.view === view);
    });
    this.applyFilter();
  },

  renderView(data) {
    if (this._view === 'card') this.renderCards(data);
    else this.renderTable(data);
  },

  renderTable(data) {
    const container = document.getElementById('customers-view-container');
    if (!container) return;
    if (!data.length) {
      container.innerHTML = '<div class="card"><div class="card-body"><div class="empty">고객사가 없습니다</div></div></div>';
      return;
    }
    container.innerHTML = `
      <div class="card">
        <div class="card-body no-pad">
          <table class="data-table">
            <thead>
              <tr>
                <th>고객사명</th><th>지역</th><th>국가</th><th>산업</th>
                <th>담당자</th><th>연락처</th><th>액션</th>
              </tr>
            </thead>
            <tbody>
              ${data.map(c => `
                <tr class="clickable" onclick="CustomersPage.showIntel(${c.id}, '${esc(c.name).replace(/'/g,"\\'")}')">
                  <td><strong>${esc(c.name)}</strong></td>
                  <td><span class="badge ${c.region === '해외' ? 'badge-purple' : 'badge-blue'}">${esc(c.region)}</span></td>
                  <td>${esc(c.country || '-')}</td>
                  <td>${esc(c.industry || '-')}</td>
                  <td>${esc(c.contact_person || '-')}</td>
                  <td class="mono">${esc(c.phone || '-')}</td>
                  <td onclick="event.stopPropagation()">
                    <button class="ai-gen-btn"
                      onclick="AI.briefCustomer(${c.id},'${esc(c.name).replace(/'/g,"\\'")}')">
                      🤖 AI 브리핑
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  renderCards(data) {
    const container = document.getElementById('customers-view-container');
    if (!container) return;
    if (!data.length) {
      container.innerHTML = '<div class="card"><div class="card-body"><div class="empty">고객사가 없습니다</div></div></div>';
      return;
    }
    // 회사명 첫글자로 아바타 색상 분산
    const palette = ['#1664E5', '#E63329', '#00A86B', '#F59C00', '#7C4DFF', '#0F7A3F', '#B5261E', '#1A73E8'];
    const avatarColor = name => palette[(name?.charCodeAt(0) || 0) % palette.length];

    container.innerHTML = `
      <div class="cust-card-grid">
        ${data.map(c => `
          <div class="cust-card" onclick="CustomersPage.showIntel(${c.id}, '${esc(c.name).replace(/'/g,"\\'")}')">
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
            <div class="cust-card-footer" onclick="event.stopPropagation()">
              <button class="ai-gen-btn" style="width:100%;justify-content:center"
                onclick="AI.briefCustomer(${c.id},'${esc(c.name).replace(/'/g,"\\'")}')">
                🤖 AI 브리핑 생성
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  },

  // ── 고객사 인텔리전스 스트리밍 ──────────────────────────
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
      const res = await fetch(`/api/customers/${id}/intelligence`);
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
          if (data === '[DONE]') { reader.cancel(); break; }
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              contentEl.innerHTML = `<span style="color:var(--oci-red)">⚠️ ${esc(parsed.error)}</span>`;
              return;
            }
            if (parsed.text) {
              fullText += parsed.text;
              contentEl.innerHTML = AI.renderMarkdown(fullText) + '<span class="ai-cursor">▋</span>';
              contentEl.parentElement.scrollTop = contentEl.parentElement.scrollHeight;
            }
          } catch (_) {}
        }
      }
      contentEl.innerHTML = AI.renderMarkdown(fullText);
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
          <button id="rtab-btn-direct"
            onclick="CustomersPage._switchRegTab('direct')"
            style="padding:10px 22px;font-size:13px;font-weight:500;border:none;background:none;
                   cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;
                   transition:all .15s;color:${defaultTab==='direct'?'var(--oci-red)':'var(--text-3)'};
                   border-bottom-color:${defaultTab==='direct'?'var(--oci-red)':'transparent'}">
            직접 입력
          </button>
          <button id="rtab-btn-ocr"
            onclick="CustomersPage._switchRegTab('ocr')"
            style="padding:10px 22px;font-size:13px;font-weight:500;border:none;background:none;
                   cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;
                   transition:all .15s;color:${defaultTab==='ocr'?'var(--oci-red)':'var(--text-3)'};
                   border-bottom-color:${defaultTab==='ocr'?'var(--oci-red)':'transparent'}">
            📇 명함 업로드
          </button>
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

          <div id="card-dropzone"
            onclick="document.getElementById('card-file-input').click()"
            ondragover="event.preventDefault();this.classList.add('drag-over')"
            ondragleave="this.classList.remove('drag-over')"
            ondrop="CustomersPage._handleDrop(event)">
            <div style="font-size:36px;margin-bottom:10px">📇</div>
            <div style="font-size:14px;font-weight:600;color:var(--text-1)">명함 파일을 여기에 드롭하거나 클릭해서 선택</div>
            <div style="font-size:12px;color:var(--text-3);margin-top:6px">JPG, PNG 지원 · 최대 20장</div>
            <input type="file" id="card-file-input" accept="image/*" multiple style="display:none"
                   onchange="CustomersPage._handleFiles(this.files)">
          </div>

          <div id="card-file-list" style="margin-top:12px"></div>
          <div id="card-ocr-results" style="margin-top:8px"></div>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" onclick="Modal.close()">닫기</button>
        <button class="btn btn-primary" id="rtab-footer-direct"
                onclick="CustomersPage.save()"
                ${defaultTab !== 'direct' ? 'style="display:none"' : ''}>
          등록
        </button>
        <button class="btn btn-primary" id="card-ocr-start-btn"
                onclick="CustomersPage._runOCR()" style="display:none">
          🔍 AI 인식 시작
        </button>
        <button class="btn btn-primary" id="card-save-all-btn"
                onclick="CustomersPage._saveAllOCR()" style="display:none">
          💾 전체 저장
        </button>
      `
    });
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
    fd.forEach((v, k) => { body[k] = v || null; });
    if (!body.name) return Toast.error('고객사명을 입력하세요');
    try {
      await API.customers.create(body);
      Toast.success('고객사가 등록되었습니다');
      Modal.close();
      await this.loadData();
      await App.refreshCommon();
    } catch (err) { console.error(err); }
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
      listEl.innerHTML = '<div style="color:var(--oci-red);font-size:12px">이미지 파일이 없습니다</div>';
      return;
    }
    listEl.innerHTML = `
      <div style="font-size:12px;color:var(--text-2);margin-bottom:8px">
        <strong>${this._ocrFiles.length}장</strong> 선택됨
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${this._ocrFiles.map(f => `
          <div style="display:flex;align-items:center;gap:4px;background:var(--surface-2);
                      border:1px solid var(--border);border-radius:4px;padding:4px 8px;font-size:12px">
            📄 ${esc(f.name)}
            <span style="color:var(--text-3)">(${(f.size/1024).toFixed(0)}KB)</span>
          </div>
        `).join('')}
      </div>`;

    const startBtn = document.getElementById('card-ocr-start-btn');
    if (startBtn) startBtn.style.display = '';
  },

  async _runOCR() {
    const startBtn = document.getElementById('card-ocr-start-btn');
    const resultsEl = document.getElementById('card-ocr-results');
    if (startBtn) { startBtn.disabled = true; startBtn.textContent = '🔍 인식 중...'; }
    resultsEl.innerHTML = '<div class="loading" style="padding:20px;text-align:center">AI가 명함을 분석 중입니다...</div>';

    try {
      const formData = new FormData();
      this._ocrFiles.forEach(f => formData.append('cards', f));

      const res = await fetch('/api/customers/ocr', { method: 'POST', body: formData });
      const data = await res.json();

      if (!data.success) {
        resultsEl.innerHTML = `<div style="color:var(--oci-red);padding:12px">⚠️ ${esc(data.error)}</div>`;
        if (startBtn) { startBtn.disabled = false; startBtn.textContent = '🔍 AI 인식 시작'; }
        return;
      }

      this._ocrResults = data.data;
      this._renderOCRResults();
      const saveBtn = document.getElementById('card-save-all-btn');
      if (saveBtn) saveBtn.style.display = '';
      if (startBtn) startBtn.style.display = 'none';
    } catch (err) {
      resultsEl.innerHTML = `<div style="color:var(--oci-red);padding:12px">⚠️ ${esc(err.message)}</div>`;
      if (startBtn) { startBtn.disabled = false; startBtn.textContent = '🔍 AI 인식 시작'; }
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
      ${this._ocrResults.map((r, i) => `
        <div class="ocr-result-card">
          <div style="background:var(--surface-2);padding:8px 12px;font-size:12px;font-weight:600;
                      color:var(--text-2);display:flex;justify-content:space-between;align-items:center;
                      border-bottom:1px solid var(--border)">
            <span>📄 ${esc(r.filename)}</span>
            ${r.error
              ? `<span style="color:var(--oci-red)">인식 실패</span>`
              : `<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:400">
                   <input type="checkbox" class="ocr-check" data-idx="${i}" checked> 저장 포함
                 </label>`
            }
          </div>
          ${r.error
            ? `<div style="padding:12px;color:var(--oci-red);font-size:12px">${esc(r.error)}</div>`
            : `<div style="padding:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px" id="ocr-form-${i}">
                ${[
                  ['name','고객사명 *'],
                  ['contact_person','담당자'],
                  ['industry','산업군'],
                  ['phone','전화번호'],
                  ['email','이메일'],
                  ['country','국가'],
                  ['address','주소','grid-column:1/-1']
                ].map(([field, label, style='']) => `
                  <div ${style ? `style="${style}"` : ''}>
                    <div style="font-size:11px;color:var(--text-3);margin-bottom:3px">${label}</div>
                    <input class="form-input" style="font-size:12px;padding:5px 8px"
                           id="ocr-${i}-${field}"
                           value="${esc(r.parsed[field]||'')}"
                           placeholder="${label}">
                  </div>
                `).join('')}
                <div>
                  <div style="font-size:11px;color:var(--text-3);margin-bottom:3px">지역</div>
                  <select class="form-input" style="font-size:12px;padding:5px 8px" id="ocr-${i}-region">
                    <option value="국내" ${r.parsed.region!=='해외'?'selected':''}>국내</option>
                    <option value="해외" ${r.parsed.region==='해외'?'selected':''}>해외</option>
                  </select>
                </div>
              </div>`
          }
        </div>
      `).join('')}
    `;
  },

  _collectOCRForm(i) {
    const get = f => (document.getElementById(`ocr-${i}-${f}`)?.value || '').trim() || null;
    return {
      name:           get('name'),
      contact_person: get('contact_person'),
      industry:       get('industry'),
      phone:          get('phone'),
      email:          get('email'),
      country:        get('country'),
      address:        get('address'),
      region:         document.getElementById(`ocr-${i}-region`)?.value || '국내'
    };
  },

  async _saveAllOCR() {
    const checks = document.querySelectorAll('.ocr-check:checked');
    if (!checks.length) { Toast.error('저장할 항목을 선택하세요'); return; }

    const saveBtn = document.getElementById('card-save-all-btn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '저장 중...'; }

    let saved = 0; let failed = 0;
    for (const chk of checks) {
      const i = parseInt(chk.dataset.idx);
      const body = this._collectOCRForm(i);
      if (!body.name) { failed++; continue; }
      try {
        await API.customers.create(body);
        saved++;
      } catch (_) { failed++; }
    }

    Modal.close();
    if (saved) Toast.success(`${saved}개 고객사가 등록되었습니다`);
    if (failed) Toast.error(`${failed}개 등록 실패 (고객사명 확인 필요)`);
    await this.loadData();
    await App.refreshCommon();
  }
};
