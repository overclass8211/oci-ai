// ============================================================
// Projects Page
// ============================================================
const ProjectsPage = {
  async render() {
    document.getElementById('content').innerHTML = `
      <div class="filter-bar">
        <input type="text" class="search-input" placeholder="프로젝트 검색..." id="proj-search">
        <button class="btn btn-primary" onclick="ProjectsPage.openForm()">+ 프로젝트 등록</button>
      </div>
      <div class="card">
        <div class="card-body no-pad" id="projects-table-wrap">
          <div class="loading">로딩중...</div>
        </div>
      </div>
    `;
    await this.loadData();
  },

  async loadData() {
    try {
      const result = await API.projects.list();
      this.renderTable(result.data);
    } catch (err) { console.error(err); }
  },

  renderTable(projects) {
    if (!projects.length) {
      document.getElementById('projects-table-wrap').innerHTML =
        '<div class="empty"><div class="empty-icon">📁</div>등록된 프로젝트가 없습니다</div>';
      return;
    }
    const statusBadge = {
      '진행중': 'blue', '제조중': 'blue', '납기지연': 'amber',
      '완료': 'green', '취소': 'gray'
    };
    const html = `
      <table class="data-table">
        <thead>
          <tr>
            <th>프로젝트명</th>
            <th>고객사</th>
            <th>유형</th>
            <th class="text-right">계약금액</th>
            <th class="text-right">산정 원가</th>
            <th class="text-right">마진율</th>
            <th>상태</th>
            <th>납기일</th>
            <th>담당</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${projects.map(p => {
            const margin = parseFloat(p.margin_pct);
            const marginColor = margin >= 20 ? 'var(--green)' :
                               margin >= 15 ? 'var(--amber)' : 'var(--red)';
            return `
              <tr>
                <td><strong>${esc(p.name)}</strong></td>
                <td>${esc(p.customer_name || '-')}</td>
                <td><span class="badge badge-blue">${esc(p.project_type || '-')}</span></td>
                <td class="text-right mono">${Fmt.amount(p.contract_amount)}</td>
                <td class="text-right mono">${Fmt.amount(p.estimated_cost)}</td>
                <td class="text-right" style="color:${marginColor};font-weight:600">${margin ? margin.toFixed(2) + '%' : '-'}</td>
                <td><span class="badge badge-${statusBadge[p.status] || 'gray'}">${esc(p.status)}</span></td>
                <td>${Fmt.date(p.due_date)}</td>
                <td>${esc(p.assigned_name || '-')}</td>
                <td><button class="btn btn-ghost btn-sm" onclick="ProjectsPage.openForm(${p.id})">편집</button></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
    document.getElementById('projects-table-wrap').innerHTML = html;
  },

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
            <input class="form-control" id="p-customer" value="${esc(project.customer_name || '')}">
          </div>
          <div class="form-field">
            <label class="form-label">유형</label>
            <select class="form-control" id="p-type">
              <option ${project.project_type==='태양광'?'selected':''}>태양광</option>
              <option ${project.project_type==='ESS'?'selected':''}>ESS</option>
              <option ${project.project_type==='모듈'?'selected':''}>모듈</option>
              <option ${project.project_type==='EPC'?'selected':''}>EPC</option>
              <option ${project.project_type==='전기'?'selected':''}>전기</option>
            </select>
          </div>
          <div class="form-field">
            <label class="form-label">계약금액 (억원)</label>
            <input class="form-control mono" id="p-amount" type="number" step="0.01" value="${project.contract_amount || ''}">
          </div>
          <div class="form-field">
            <label class="form-label">산정 원가 (억원)</label>
            <input class="form-control mono" id="p-cost" type="number" step="0.01" value="${project.estimated_cost || ''}">
          </div>
          <div class="form-field">
            <label class="form-label">상태</label>
            <select class="form-control" id="p-status">
              <option ${project.status==='진행중'?'selected':''}>진행중</option>
              <option ${project.status==='제조중'?'selected':''}>제조중</option>
              <option ${project.status==='납기지연'?'selected':''}>납기지연</option>
              <option ${project.status==='완료'?'selected':''}>완료</option>
              <option ${project.status==='취소'?'selected':''}>취소</option>
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
              ${team.data.map(t => `<option value="${t.id}" ${project.assigned_to==t.id?'selected':''}>${esc(t.name)} (${t.role})</option>`).join('')}
            </select>
          </div>
          <div class="form-field full">
            <label class="form-label">메모</label>
            <textarea class="form-control" id="p-notes">${esc(project.notes || '')}</textarea>
          </div>
        </div>
      `,
      footer: `
        ${id ? '<button class="btn btn-danger" onclick="ProjectsPage.deleteProject(' + id + ')">삭제</button>' : ''}
        <button class="btn btn-ghost" onclick="Modal.close()">취소</button>
        <button class="btn btn-primary" onclick="ProjectsPage.save(${id || 'null'})">저장</button>
      `
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
      notes: document.getElementById('p-notes').value
    };
    if (!body.name) return Toast.error('프로젝트명을 입력해주세요');
    try {
      if (id) await API.projects.update(id, body);
      else    await API.projects.create(body);
      Toast.success(id ? '프로젝트가 수정되었습니다' : '프로젝트가 등록되었습니다');
      Modal.close();
      this.loadData();
    } catch (err) {}
  },

  deleteProject(id) {
    Modal.confirm('이 프로젝트를 삭제하시겠습니까?', async () => {
      await API.projects.delete(id);
      Toast.success('삭제되었습니다');
      this.loadData();
    });
  }
};
