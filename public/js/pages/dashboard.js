// ============================================================
// Dashboard Page — AI Insights 포함
// ============================================================
const DashboardPage = {
  monthlyChart: null,

  async render() {
    const html = `
      <div class="metrics-grid" id="dashboard-metrics">
        <div class="metric-card"><div class="metric-label">로딩...</div></div>
      </div>

      <div class="grid-65 mb-3">
        <div class="card">
          <div class="card-header">
            <div class="card-title">월별 영업기회 추이</div>
            <div style="display:flex;gap:6px;align-items:center">
              <span class="badge badge-amber">● 태양광</span>
              <span class="badge badge-blue">● 전기/ESS</span>
            </div>
          </div>
          <div class="card-body"><div class="chart-wrap"><canvas id="chart-monthly"></canvas></div></div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">파이프라인 단계별 현황</div></div>
          <div class="card-body" id="funnel-body"><div class="loading">로딩...</div></div>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <div class="card-title">최근 영업 활동</div>
            <button class="btn btn-ghost btn-sm" onclick="App.navigate('pipeline')">전체보기</button>
          </div>
          <div class="card-body no-pad" id="activities-body"><div class="loading">로딩...</div></div>
        </div>
        <div class="card">
          <div class="card-header">
            <div class="card-title">🤖 AI 인사이트</div>
            <button class="ai-gen-btn" onclick="DashboardPage.refreshAIInsights()">
              <svg viewBox="0 0 16 16" fill="currentColor" width="11"><path d="M8 3a5 5 0 100 10A5 5 0 008 3zM1 8a7 7 0 1114 0A7 7 0 011 8z"/><path d="M8 5v3l2 1-1 1.73L7 9V5h1z"/></svg>
              AI 분석
            </button>
          </div>
          <div class="card-body no-pad" id="insights-body">
            <div class="loading">AI 인사이트 로딩중...</div>
          </div>
        </div>
      </div>
    `;
    document.getElementById('content').innerHTML = html;
    await this.loadData();
  },

  async loadData() {
    try {
      const [stats, funnel, monthly, activities] = await Promise.all([
        API.dashboard.stats(),
        API.dashboard.funnel(),
        API.dashboard.monthly(),
        API.dashboard.activities()
      ]);
      this.renderMetrics(stats.data);
      this.renderFunnel(funnel.data);
      this.renderMonthlyChart(monthly.data);
      this.renderActivities(activities.data);
      this.loadAIInsights();
    } catch (err) { console.error('Dashboard load error:', err); }
  },

  async loadAIInsights() {
    const el = document.getElementById('insights-body');
    if (!el) return;
    try {
      const res = await API.ai.insights();
      this.renderAIInsights(res.data);
    } catch (err) {
      // AI 키 미설정 시 정적 폴백
      this.renderStaticInsights();
    }
  },

  async refreshAIInsights() {
    const el = document.getElementById('insights-body');
    if (el) el.innerHTML = '<div class="loading">AI 분석 중...</div>';
    await this.loadAIInsights();
  },

  renderAIInsights(text) {
    const el = document.getElementById('insights-body');
    if (!el) return;
    if (!text) { this.renderStaticInsights(); return; }

    const lines = text.split('\n').filter(l => l.trim());
    const icons = { '긴급': { ico: '🚨', cls: 'urgent' }, '주의': { ico: '⚠️', cls: 'warning' }, '정보': { ico: 'ℹ️', cls: 'info' } };

    const items = lines.map(line => {
      let tag = 'info', ico = '📊', content = line.replace(/^\[.*?\]\s*/, '');
      const m = line.match(/^\[(긴급|주의|정보)\]/);
      if (m && icons[m[1]]) { tag = icons[m[1]].cls; ico = icons[m[1]].ico; }
      return `
        <div class="ai-insight-item">
          <div class="insight-icon">${ico}</div>
          <div class="ai-insight-body">
            <span class="ai-insight-tag ${tag}">${tag === 'urgent' ? '긴급' : tag === 'warning' ? '주의' : '정보'}</span>
            <div class="ai-insight-text">${esc(content)}</div>
          </div>
        </div>`;
    }).join('');

    el.innerHTML = items + `
      <div style="padding:10px 14px;border-top:1px solid var(--border)">
        <button class="ai-gen-btn" style="width:100%;justify-content:center" onclick="AI.open();AI.streamReport('weekly')">
          📊 주간 보고서 생성하기
        </button>
      </div>`;
  },

  renderStaticInsights() {
    const el = document.getElementById('insights-body');
    if (!el) return;
    el.innerHTML = `
      <div class="ai-insight-item">
        <div class="insight-icon">⚠️</div>
        <div class="ai-insight-body">
          <span class="ai-insight-tag warning">주의</span>
          <div class="ai-insight-text">원가 변동 알림 — 폴리실리콘 +7.15% 상승, 견적 재검토 필요</div>
        </div>
      </div>
      <div class="ai-insight-item">
        <div class="insight-icon">🚨</div>
        <div class="ai-insight-body">
          <span class="ai-insight-tag urgent">긴급</span>
          <div class="ai-insight-text">입찰 마감 임박 — 한국동서발전 30MW EPC 입찰 진행중</div>
        </div>
      </div>
      <div class="ai-insight-item">
        <div class="insight-icon">🌍</div>
        <div class="ai-insight-body">
          <span class="ai-insight-tag info">정보</span>
          <div class="ai-insight-text">해외 신규 리드 — VPL Corp 50MW · ReNew Power 200MW 진행중</div>
        </div>
      </div>
      <div style="padding:10px 14px;border-top:1px solid var(--border)">
        <button class="ai-gen-btn" style="width:100%;justify-content:center" onclick="AI.open()">
          💬 AI 어시스턴트 열기
        </button>
      </div>`;
  },

  renderMetrics(d) {
    document.getElementById('dashboard-metrics').innerHTML = `
      <div class="metric-card" style="--metric-color:#1664E5">
        <div class="metric-label">이번달 신규 영업기회</div>
        <div class="metric-value">${d.monthlyNew}<span class="metric-value-suffix">건</span></div>
        <div class="metric-sub">국내 ${d.domestic} / 해외 ${d.overseas}</div>
      </div>
      <div class="metric-card" style="--metric-color:#F59C00">
        <div class="metric-label">진행 중 파이프라인</div>
        <div class="metric-value">${d.totalLeads}<span class="metric-value-suffix">건</span></div>
        <div class="metric-sub">입찰 진행 ${d.bidding}건</div>
      </div>
      <div class="metric-card" style="--metric-color:#17A85A">
        <div class="metric-label">올해 수주 금액</div>
        <div class="metric-value" style="font-size:18px">${Fmt.amount(d.wonAmount)}</div>
        <div class="metric-sub">올해 누적</div>
      </div>
      <div class="metric-card" style="--metric-color:#E63329">
        <div class="metric-label">입찰 진행</div>
        <div class="metric-value">${d.bidding}<span class="metric-value-suffix">건</span></div>
        <div class="metric-sub">현재 입찰 단계</div>
      </div>
      <div class="metric-card" style="--metric-color:#7C4DFF">
        <div class="metric-label">연간 수주율</div>
        <div class="metric-value">${d.winRate}<span class="metric-value-suffix">%</span></div>
        <div class="metric-sub">전체 리드 대비 수주</div>
      </div>
    `;
  },

  renderFunnel(data) {
    const stageOrder = ['lead','review','proposal','bidding','negotiation','won'];
    const max = Math.max(...data.map(d => d.count), 1);
    document.getElementById('funnel-body').innerHTML = stageOrder.map(stage => {
      const item = data.find(d => d.stage === stage) || { count: 0, amount: 0 };
      const meta = STAGES[stage] || { label: stage, color: '#ccc' };
      return `
        <div class="funnel-row">
          <div class="funnel-label">
            <span>${meta.label}</span><strong>${item.count}건</strong>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" style="width:${(item.count/max)*100}%;background:${meta.color}"></div>
          </div>
        </div>`;
    }).join('');
  },

  renderMonthlyChart(data) {
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, label: `${d.getMonth()+1}월` });
    }
    const solarData = months.map(m => data.filter(d => d.month===m.key && ['태양광','모듈','EPC'].includes(d.business_type)).reduce((s,d)=>s+d.count,0));
    const elecData  = months.map(m => data.filter(d => d.month===m.key && ['ESS','전기','설치'].includes(d.business_type)).reduce((s,d)=>s+d.count,0));

    const ctx = document.getElementById('chart-monthly');
    if (this.monthlyChart) this.monthlyChart.destroy();
    this.monthlyChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: months.map(m => m.label),
        datasets: [
          { label: '태양광', data: solarData, backgroundColor: '#F59C00', borderRadius: 4 },
          { label: '전기/ESS', data: elecData, backgroundColor: '#1664E5', borderRadius: 4 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11 } } },
          y: { grid: { color: '#E8EAED' }, ticks: { font: { size: 11 } }, beginAtZero: true }
        }
      }
    });
  },

  renderActivities(activities) {
    const el = document.getElementById('activities-body');
    if (!activities.length) { el.innerHTML = '<div class="empty">최근 활동 없음</div>'; return; }
    const iconMap = { 미팅:'🤝', 전화:'📞', 이메일:'✉️', 제안서:'📋', 입찰:'📑', 수주:'🏆', 드롭:'❌', 기타:'📌', note:'📝', meeting:'🤝', call:'📞', email:'✉️', proposal:'📋', site_visit:'🏗' };
    const bgMap = { 미팅:'var(--blue-light)', 전화:'var(--amber-light)', 이메일:'var(--blue-light)', 수주:'var(--green-light)', 드롭:'var(--red-light)', 기타:'var(--gray-light)' };
    el.innerHTML = activities.slice(0,6).map(a => `
      <div class="insight-item">
        <div class="insight-icon" style="background:${bgMap[a.activity_type]||'var(--gray-light)'}">${iconMap[a.activity_type]||'📌'}</div>
        <div style="flex:1">
          <div class="insight-title">${esc(a.title)}</div>
          <div class="insight-text">${a.customer_name ? esc(a.customer_name)+' · ' : ''}담당: ${esc(a.performer_name||'-')} · ${Fmt.relTime(a.performed_at)}</div>
        </div>
      </div>`).join('');
  }
};
