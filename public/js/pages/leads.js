// ============================================================
// Leads Page (테이블 + CRUD)
// ============================================================
const LeadsPage = {
  filters: { search: '', stage: '', region: '', assigned_to: '' },
  team: [],

  async render() {
    const html = `
      <div class="filter-bar">
        <input type="text" class="search-input" id="leads-search" placeholder="고객사, 프로젝트명 검색...">
        <select class="filter-select" id="leads-stage">
          <option value="">전체 단계</option>
          <option value="lead">리드 발굴</option>
          <option value="review">검토/미팅</option>
          <option value="proposal">제안/견적</option>
          <option value="bidding">입찰</option>
          <option value="negotiation">협상/계약</option>
          <option value="won">수주</option>
          <option value="lost">실주</option>
          <option value="dropped">드롭</option>
        </select>
        <select class="filter-select" id="leads-region">
          <option value="">국내/해외</option>
          <option value="국내">국내</option>
          <option value="해외">해외</option>
        </select>
        <select class="filter-select" id="leads-assigned">
          <option value="">전체 담당자</option>
        </select>
        <button class="btn btn-primary" onclick="App.openLeadForm()">+ 리드 등록</button>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">영업 리드 목록 <span class="text-muted fs-12" id="leads-count"></span></div>
        </div>
        <div class="card-body no-pad" id="leads-table-wrap">
          <div class="loading">로딩중...</div>
        </div>
      </div>
    `;
    document.getElementById('content').innerHTML = html;

    const team = await API.team.list();
    this.team = team.data;
    const sel = document.getElementById('leads-assigned');
    sel.innerHTML = '<option value="">전체 담당자</option>' +
      this.team.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');

    document.getElementById('leads-search').oninput = debounce((e) => {
      this.filters.search = e.target.value;
      this.loadData();
    }, 300);
    ['leads-stage', 'leads-region', 'leads-assigned'].forEach(id => {
      document.getElementById(id).onchange = (e) => {
        const key = id.replace('leads-', '')
          .replace('stage', 'stage')
          .replace('region', 'region')
          .replace('assigned', 'assigned_to');
        this.filters[key] = e.target.value;
        this.loadData();
      };
    });

    await this.loadData();
  },

  async loadData() {
    try {
      const result = await API.leads.list(this.filters);
      this.renderTable(result.data);
    } catch (err) { console.error(err); }
  },

  renderTable(leads) {
    document.getElementById('leads-count').textContent = `(총 ${leads.length}건)`;

    if (!leads.length) {
      document.getElementById('leads-table-wrap').innerHTML =
        '<div class="empty"><div class="empty-icon">📋</div>등록된 리드가 없습니다</div>';
      return;
    }

    const stageBadge = (stage) => {
      const map = {
        lead: 'gray', review: 'gray', proposal: 'blue',
        bidding: 'amber', negotiation: 'green',
        won: 'green', lost: 'gray', dropped: 'red'
      };
      return `<span class="badge badge-${map[stage]}">${STAGES[stage].label}</span>`;
    };

    const html = `
      <table class="data-table">
        <thead>
          <tr>
            <th>고객사</th>
            <th>프로젝트명</th>
            <th>사업유형</th>
            <th class="text-right">규모(MW)</th>
            <th class="text-right">예상금액</th>
            <th>상태</th>
            <th>구분</th>
            <th>담당자</th>
            <th>예상 마감일</th>
            <th>최종 활동</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${leads.map(l => `
            <tr class="clickable" onclick="App.openLeadDetail(${l.id})">
              <td><strong>${esc(l.customer_name)}</strong></td>
              <td>${esc(l.project_name)}</td>
              <td><span class="badge ${BUSINESS_COLORS[l.business_type] || 'badge-gray'}">${esc(l.business_type)}</span></td>
              <td class="text-right mono">${l.capacity_mw ? parseFloat(l.capacity_mw).toFixed(0) : '-'}</td>
              <td class="text-right mono">${Fmt.amount(l.expected_amount, l.currency)}</td>
              <td>${stageBadge(l.stage)}</td>
              <td><span class="badge ${l.region === '해외' ? 'badge-purple' : 'badge-blue'}">${esc(l.region)}</span></td>
              <td>${esc(l.assigned_name || '-')}</td>
              <td>${Fmt.date(l.expected_close_date)}</td>
              <td class="text-muted fs-11">${Fmt.relTime(l.updated_at)}</td>
              <td onclick="event.stopPropagation()">
                <button class="btn btn-ghost btn-sm" onclick="LeadsPage.editLead(${l.id})">편집</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    document.getElementById('leads-table-wrap').innerHTML = html;
  },

  async editLead(id) {
    App.openLeadForm(id);
  }
};
