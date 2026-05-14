// ============================================================
// Reports Page - 영업 리포트 / 분석
// ============================================================
const ReportsPage = {
  charts: {},
  selectedYear: new Date().getFullYear(),

  async render() {
    const curYear = new Date().getFullYear();
    const years = [];
    for (let y = curYear; y >= 2023; y--) years.push(y);

    const html = `
      <div class="filter-bar">
        <div class="card-title" style="margin-right:auto" id="reports-title">영업 리포트 (${this.selectedYear}년)</div>
        <div style="display:flex;gap:4px;align-items:center">
          ${years.map(y => `
            <button class="year-btn ${y === this.selectedYear ? 'active' : ''}"
              data-year="${y}"
              style="padding:4px 10px;border-radius:var(--radius);border:1px solid var(--border-2);
                     background:${y === this.selectedYear ? 'var(--blue)' : 'var(--bg-2)'};
                     color:${y === this.selectedYear ? '#fff' : 'var(--text-2)'};
                     font-size:12px;cursor:pointer;font-weight:${y === this.selectedYear ? '600' : '400'}">
              ${y}
            </button>`).join('')}
        </div>
        <button class="ai-gen-btn" id="reports-weekly-btn">📊 주간보고서 AI생성</button>
        <button class="ai-gen-btn" id="reports-monthly-btn">📈 월간보고서 AI생성</button>
        <button class="btn btn-ghost btn-sm" id="reports-export-btn">CSV 내보내기</button>
      </div>

      <!-- AI 보고서 출력 영역 -->
      <div class="card mb-3" id="ai-report-card" style="display:none">
        <div class="card-header">
          <div class="card-title" id="ai-report-title">🤖 AI 보고서</div>
          <div style="display:flex;gap:6px">
            <button class="ai-gen-btn" id="reports-copy-btn">📋 복사</button>
            <button class="btn btn-ghost btn-sm" id="reports-close-report-btn">닫기</button>
          </div>
        </div>
        <div class="card-body" id="ai-report-body" style="font-size:13px;line-height:1.8;white-space:pre-wrap;max-height:400px;overflow-y:auto"></div>
      </div>

      <div class="metrics-grid mb-3" id="reports-kpis">
        <div class="metric-card"><div class="metric-label">로딩...</div></div>
      </div>

      <div class="grid-2 mb-3">
        <div class="card">
          <div class="card-header">
            <div class="card-title">국내 / 해외 비중</div>
          </div>
          <div class="card-body">
            <div class="chart-wrap" style="height:280px"><canvas id="chart-region"></canvas></div>
          </div>
        </div>
        <div class="card">
          <div class="card-header">
            <div class="card-title">사업유형별 매출 기여</div>
          </div>
          <div class="card-body">
            <div class="chart-wrap" style="height:280px"><canvas id="chart-business"></canvas></div>
          </div>
        </div>
      </div>

      <div class="grid-2 mb-3">
        <div class="card">
          <div class="card-header">
            <div class="card-title">단계별 전환율 (Funnel)</div>
          </div>
          <div class="card-body" id="reports-funnel">
            <div class="loading">로딩...</div>
          </div>
        </div>
        <div class="card">
          <div class="card-header">
            <div class="card-title">담당자별 수주 실적 TOP 5</div>
          </div>
          <div class="card-body no-pad" id="reports-top">
            <div class="loading">로딩...</div>
          </div>
        </div>
      </div>
    `;
    document.getElementById('content').innerHTML = html;

    // year buttons delegation
    document.querySelector('.filter-bar')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.year-btn[data-year]');
      if (btn) this.changeYear(parseInt(btn.dataset.year));
    });
    document.getElementById('reports-weekly-btn')?.addEventListener('click', () => this.generateWeekly());
    document.getElementById('reports-monthly-btn')?.addEventListener('click', () => this.generateMonthly());
    document.getElementById('reports-export-btn')?.addEventListener('click', () => this.exportCsv());
    document.getElementById('reports-copy-btn')?.addEventListener('click', () => this.copyReport());
    document.getElementById('reports-close-report-btn')?.addEventListener('click', () => {
      document.getElementById('ai-report-card').style.display = 'none';
    });

    await this.loadData();
  },

  async changeYear(year) {
    this.selectedYear = year;
    document.querySelectorAll('.year-btn').forEach(btn => {
      const btnYear = parseInt(btn.textContent.trim());
      btn.style.background = btnYear === year ? 'var(--blue)' : 'var(--bg-2)';
      btn.style.color = btnYear === year ? '#fff' : 'var(--text-2)';
      btn.style.fontWeight = btnYear === year ? '600' : '400';
    });
    const titleEl = document.getElementById('reports-title');
    if (titleEl) titleEl.textContent = `영업 리포트 (${year}년)`;
    document.getElementById('reports-kpis').innerHTML = '<div class="metric-card"><div class="metric-label">로딩...</div></div>';
    document.getElementById('reports-funnel').innerHTML = '<div class="loading">로딩...</div>';
    document.getElementById('reports-top').innerHTML = '<div class="loading">로딩...</div>';
    await this.loadData();
  },

  async loadData() {
    try {
      const y = this.selectedYear;
      // 해당 연도 리드만 가져오기
      const [statsRes, leadsRes, teamRes, funnelRes] = await Promise.all([
        API.dashboard.stats(y),
        API.leads.list({ date_from: `${y}-01-01`, date_to: `${y}-12-31`, date_field: 'created' }),
        API.team.list(),
        API.dashboard.funnel(y)
      ]);
      this.renderKpis(statsRes.data, leadsRes.data);
      this.renderRegionChart(leadsRes.data);
      this.renderBusinessChart(leadsRes.data);
      this.renderFunnel(funnelRes.data);
      this.renderTopTeam(teamRes.data);
    } catch (err) { console.error(err); }
  },

  renderKpis(stats, leads) {
    const yearTarget = 1500; // 연 목표 1,500억
    const wonAmount  = parseFloat(stats.wonAmount || 0);
    const wonLeads   = leads.filter(l => l.stage === 'won');
    const wonCount   = wonLeads.length;
    const totalCount = leads.length;
    const droppedCount = leads.filter(l => l.stage === 'dropped' || l.stage === 'lost').length;
    const dropRate = totalCount ? (droppedCount / totalCount * 100) : 0;
    const avgWon = wonCount ? (wonAmount / wonCount) : 0;
    const achievement = (wonAmount / yearTarget * 100);
    const curYear = new Date().getFullYear();
    const monthDivisor = this.selectedYear === curYear ? Math.max(new Date().getMonth() + 1, 1) : 12;

    document.getElementById('reports-kpis').innerHTML = `
      <div class="metric-card">
        <div class="metric-label">연간 목표 달성률</div>
        <div class="metric-value">${achievement.toFixed(1)}<span class="metric-unit">%</span></div>
        <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(achievement,100)}%"></div></div>
        <div class="metric-sub">목표 ${yearTarget}억 / 누적 ${Fmt.amount(wonAmount)}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">${this.selectedYear}년 수주 건수</div>
        <div class="metric-value">${wonCount}<span class="metric-unit">건</span></div>
        <div class="metric-sub">월평균 ${(wonCount / monthDivisor).toFixed(1)}건</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">평균 수주 단가</div>
        <div class="metric-value">${Fmt.amount(avgWon)}</div>
        <div class="metric-sub">건당 평균</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">드롭 / 실주율</div>
        <div class="metric-value">${dropRate.toFixed(1)}<span class="metric-unit">%</span></div>
        <div class="metric-sub">총 ${droppedCount} / ${totalCount}건</div>
      </div>
    `;
  },

  renderRegionChart(leads) {
    const wonLeads = leads.filter(l => l.stage === 'won');
    const domestic = wonLeads.filter(l => l.region === '국내').length;
    const overseas = wonLeads.filter(l => l.region === '해외').length;
    const ctx = document.getElementById('chart-region').getContext('2d');
    if (this.charts.region) this.charts.region.destroy();
    this.charts.region = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['국내', '해외'],
        datasets: [{
          data: [domestic, overseas],
          backgroundColor: ['#2357E8', '#A855F7'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } },
        cutout: '60%'
      }
    });
  },

  renderBusinessChart(leads) {
    const wonLeads = leads.filter(l => l.stage === 'won');
    const groups = {};
    wonLeads.forEach(l => {
      const key = l.business_type || '기타';
      groups[key] = (groups[key] || 0) + parseFloat(l.expected_amount || 0);
    });
    const labels = Object.keys(groups);
    const data = labels.map(k => groups[k]);
    const colors = ['#F59C00', '#2357E8', '#A855F7', '#17A85A', '#E63329', '#6B7280'];

    const ctx = document.getElementById('chart-business').getContext('2d');
    if (this.charts.business) this.charts.business.destroy();
    this.charts.business = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: '수주 금액 (억)',
          data,
          backgroundColor: labels.map((_, i) => colors[i % colors.length]),
          borderRadius: 6
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, grid: { color: '#F1F2F4' } } }
      }
    });
  },

  renderFunnel(funnel) {
    const order = ['lead', 'review', 'proposal', 'bidding', 'negotiation', 'won'];
    const map = {};
    funnel.forEach(f => map[f.stage] = parseInt(f.count) || 0);
    const max = Math.max(...order.map(s => map[s] || 0), 1);

    const html = order.map(s => {
      const c = map[s] || 0;
      const pct = (c / max * 100);
      return `
        <div class="funnel-row">
          <div class="funnel-label">${STAGES[s].label}</div>
          <div class="funnel-bar-wrap">
            <div class="funnel-bar" style="width:${pct}%;background:${STAGES[s].color}"></div>
          </div>
          <div class="funnel-count">${c}건</div>
        </div>
      `;
    }).join('');

    document.getElementById('reports-funnel').innerHTML = html;
  },

  renderTopTeam(team) {
    const sorted = [...team].sort((a, b) =>
      parseFloat(b.won_amount || 0) - parseFloat(a.won_amount || 0)
    ).slice(0, 5);

    if (!sorted.length || !sorted[0].won_amount) {
      document.getElementById('reports-top').innerHTML =
        '<div class="empty"><div class="empty-icon">📊</div>수주 실적이 없습니다</div>';
      return;
    }

    const html = `
      <table class="data-table">
        <thead>
          <tr><th>순위</th><th>담당자</th><th>역할</th><th class="text-right">수주건수</th><th class="text-right">수주금액</th></tr>
        </thead>
        <tbody>
          ${sorted.map((m, i) => `
            <tr>
              <td><strong>#${i + 1}</strong></td>
              <td><strong>${esc(m.name)}</strong></td>
              <td><span class="badge badge-gray">${esc(m.role)}</span></td>
              <td class="text-right mono">${m.won_count || 0}</td>
              <td class="text-right mono"><strong>${Fmt.amount(m.won_amount)}</strong></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    document.getElementById('reports-top').innerHTML = html;
  },

  async generateWeekly() { await this._generateReport('weekly', '주간 보고서'); },
  async generateMonthly() { await this._generateReport('monthly', '월간 보고서'); },

  async _generateReport(type, label) {
    const card = document.getElementById('ai-report-card');
    const body = document.getElementById('ai-report-body');
    const title = document.getElementById('ai-report-title');
    card.style.display = 'block';
    title.textContent = `🤖 AI ${label} 생성중...`;
    body.innerHTML = '<span style="color:var(--text-3)">AI가 보고서를 작성하고 있습니다...</span>';
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });

    let fullText = '';
    try {
      const token = localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token');
      const res = await fetch('/api/ai/report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ type })
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      body.innerHTML = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value).split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') break;
          try { const { text } = JSON.parse(data); fullText += text; body.textContent = fullText; body.scrollTop = body.scrollHeight; } catch (_) { /* skip */ }
        }
      }
      title.textContent = `✅ AI ${label} 완료`;
    } catch (err) {
      body.innerHTML = `<span style="color:var(--red)">보고서 생성 실패: ${esc(err.message)}</span>`;
    }
  },

  copyReport() {
    const text = document.getElementById('ai-report-body').textContent;
    navigator.clipboard.writeText(text).then(() => Toast.success('보고서가 클립보드에 복사되었습니다'));
  },

  async exportCsv() {
    try {
      const y = this.selectedYear;
      const result = await API.leads.list({ date_from: `${y}-01-01`, date_to: `${y}-12-31`, date_field: 'created' });
      const rows = result.data;
      const headers = ['고객사', '프로젝트', '사업유형', '지역', '단계', '담당자', '예상금액', '통화', '예상마감일'];
      const lines = [headers.join(',')];
      rows.forEach(r => {
        lines.push([
          r.customer_name, r.project_name, r.business_type, r.region,
          STAGES[r.stage]?.label || r.stage, r.assigned_name || '',
          r.expected_amount || '', r.currency || '', r.expected_close_date || ''
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
      });
      const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `OCI_Power_영업리포트_${y}_${Fmt.date(new Date())}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      Toast.success('CSV 파일이 다운로드되었습니다');
    } catch (err) { console.error(err); }
  }
};
