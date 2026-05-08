// ============================================================
// Pipeline Page (Kanban with drag & drop)
// ============================================================
const PipelinePage = {
  filters: { search: '', region: '', business_type: '', assigned_to: '' },
  team: [],

  async render() {
    const html = `
      <div class="filter-bar">
        <input type="text" class="search-input" id="pipe-search" placeholder="고객사, 프로젝트명 검색...">
        <select class="filter-select" id="pipe-region">
          <option value="">전체 지역</option>
          <option value="국내">국내</option>
          <option value="해외">해외</option>
        </select>
        <select class="filter-select" id="pipe-business">
          <option value="">전체 사업</option>
          <option value="태양광">태양광</option>
          <option value="모듈">모듈</option>
          <option value="EPC">EPC</option>
          <option value="ESS">ESS</option>
          <option value="전기">전기</option>
          <option value="설치">설치</option>
        </select>
        <select class="filter-select" id="pipe-assigned">
          <option value="">전체 담당자</option>
        </select>
        <button class="btn btn-primary" onclick="App.openLeadForm()">+ 리드 추가</button>
      </div>

      <div class="card mb-3">
        <div class="card-body" style="padding:12px 16px">
          <div class="flex gap-4" style="align-items:center">
            <div>
              <div class="fs-11 text-muted">파이프라인 총액</div>
              <div style="font-size:20px;font-weight:700" class="mono" id="pipe-total">₩0억</div>
            </div>
            <div class="flex-1">
              <div class="flex gap-2 fs-11 text-muted">
                <span>💡 칸반 카드를 드래그하여 단계를 변경할 수 있습니다</span>
              </div>
            </div>
            <div class="text-right">
              <div class="fs-11 text-muted">진행 건수</div>
              <div style="font-size:20px;font-weight:700" id="pipe-active-count">0</div>
            </div>
          </div>
        </div>
      </div>

      <div class="kanban-board" id="kanban-board">
        <div class="loading">로딩중...</div>
      </div>
    `;
    document.getElementById('content').innerHTML = html;

    // 팀원 로드
    const team = await API.team.list();
    this.team = team.data;
    const sel = document.getElementById('pipe-assigned');
    sel.innerHTML = '<option value="">전체 담당자</option>' +
      this.team.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');

    // 이벤트 바인딩
    document.getElementById('pipe-search').oninput = debounce((e) => {
      this.filters.search = e.target.value;
      this.loadData();
    }, 300);
    ['pipe-region', 'pipe-business', 'pipe-assigned'].forEach(id => {
      document.getElementById(id).onchange = (e) => {
        const key = id.replace('pipe-', '').replace('region', 'region')
          .replace('business', 'business_type').replace('assigned', 'assigned_to');
        this.filters[key] = e.target.value;
        this.loadData();
      };
    });

    await this.loadData();
  },

  async loadData() {
    try {
      const result = await API.leads.list(this.filters);
      this.renderBoard(result.data);
    } catch (err) { console.error(err); }
  },

  renderBoard(leads) {
    const stages = ['lead', 'review', 'proposal', 'bidding', 'negotiation', 'won', 'dropped'];
    const grouped = {};
    stages.forEach(s => grouped[s] = []);
    leads.forEach(l => { if (grouped[l.stage]) grouped[l.stage].push(l); });

    // 통계
    const activeStages = ['lead', 'review', 'proposal', 'bidding', 'negotiation'];
    const activeCount = leads.filter(l => activeStages.includes(l.stage)).length;
    const totalAmount = leads
      .filter(l => activeStages.includes(l.stage) && l.currency === 'KRW')
      .reduce((sum, l) => sum + parseFloat(l.expected_amount || 0), 0);
    document.getElementById('pipe-total').textContent = Fmt.amount(totalAmount, 'KRW');
    document.getElementById('pipe-active-count').textContent = activeCount;

    // 칸반 컬럼
    const board = document.getElementById('kanban-board');
    board.innerHTML = stages.map(stage => {
      const meta = STAGES[stage];
      const items = grouped[stage] || [];
      return `
        <div class="kanban-col" style="--col-color:${meta.color}" data-stage="${stage}">
          <div class="kanban-col-header">
            <div class="kanban-col-title">${meta.label}</div>
            <div class="kanban-count">${items.length}</div>
          </div>
          <div class="kanban-cards">
            ${items.map(l => this.renderCard(l)).join('')}
          </div>
        </div>
      `;
    }).join('');

    // 드래그앤드롭 바인딩
    this.bindDragDrop();
  },

  renderCard(lead) {
    const meta = STAGES[lead.stage];
    const days = Fmt.daysLeft(lead.bidding_deadline);
    const urgent = days != null && days >= 0 && days <= 7;
    return `
      <div class="kanban-card" draggable="true"
           data-id="${lead.id}" data-stage="${lead.stage}"
           style="--card-accent:${meta.color}"
           onclick="App.openLeadDetail(${lead.id})">
        <div class="kc-company">${esc(lead.customer_name)}</div>
        <div class="kc-project">${esc(lead.project_name)}</div>
        <div class="kc-meta">
          <span class="kc-amount">${Fmt.amount(lead.expected_amount, lead.currency)}</span>
          <span class="kc-date">${lead.bidding_deadline ? '마감 ' + Fmt.date(lead.bidding_deadline).substring(5) : (lead.expected_close_date ? Fmt.date(lead.expected_close_date).substring(5) : '')}</span>
        </div>
        <div class="kc-tags">
          ${urgent ? `<span class="kc-tag urgent">D-${days}</span>` : ''}
          <span class="kc-tag">${esc(lead.business_type)}</span>
          <span class="kc-tag">${esc(lead.region)}</span>
          ${lead.assigned_name ? `<span class="kc-tag">${esc(lead.assigned_name)}</span>` : ''}
        </div>
      </div>
    `;
  },

  bindDragDrop() {
    let draggingId = null;
    document.querySelectorAll('.kanban-card').forEach(card => {
      card.ondragstart = (e) => {
        draggingId = card.dataset.id;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      };
      card.ondragend = () => card.classList.remove('dragging');
    });

    document.querySelectorAll('.kanban-col').forEach(col => {
      col.ondragover = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
      col.ondrop = async (e) => {
        e.preventDefault();
        if (!draggingId) return;
        const newStage = col.dataset.stage;
        try {
          await API.leads.setStage(draggingId, newStage);
          Toast.success(`단계가 "${STAGES[newStage].label}"(으)로 변경되었습니다`);
          this.loadData();
        } catch (err) {}
        draggingId = null;
      };
    });
  }
};
