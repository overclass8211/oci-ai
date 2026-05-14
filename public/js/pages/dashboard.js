// ============================================================
// Dashboard Page — AI Insights 포함
// ============================================================
const DashboardPage = {
  monthlyChart: null,
  selectedYear: new Date().getFullYear(),
  selectedPeriod: 'recent6', // annual | quarterly | monthly | recent6

  async render() {
    const curYear = new Date().getFullYear();
    const years = [];
    for (let y = curYear; y >= 2023; y--) years.push(y);

    const html = `
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div style="font-weight:600;font-size:15px;color:var(--text-1)">영업 대시보드</div>
        <div class="year-selector" style="display:flex;align-items:center;gap:6px">
          <span style="font-size:12px;color:var(--text-3)">기준 연도</span>
          <div style="display:flex;gap:4px">
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
        </div>
      </div>

      <div class="metrics-grid" id="dashboard-metrics">
        <div class="metric-card"><div class="metric-label">로딩...</div></div>
      </div>

      <div class="grid-65 mb-3">
        <div class="card">
          <div class="card-header" style="flex-wrap:wrap;gap:8px">
            <div class="card-title" id="monthly-chart-title" style="margin-right:auto">월별 영업기회 추이</div>
            <div style="display:flex;gap:3px;align-items:center">
              ${[
                {key:'annual',   label:'연간'},
                {key:'quarterly',label:'분기'},
                {key:'monthly',  label:'월간'},
                {key:'recent6',  label:'최근 6개월'}
              ].map(p => `
                <button id="period-btn-${p.key}" data-period="${p.key}"
                  style="padding:3px 9px;border-radius:var(--radius);border:1px solid var(--border-2);
                         background:${p.key==='recent6'?'var(--blue)':'var(--bg-2)'};
                         color:${p.key==='recent6'?'#fff':'var(--text-2)'};
                         font-size:11px;cursor:pointer;font-weight:${p.key==='recent6'?'600':'400'};
                         white-space:nowrap">
                  ${p.label}
                </button>`).join('')}
            </div>
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
            <button class="btn btn-ghost btn-sm" id="dash-pipeline-btn">전체보기</button>
          </div>
          <div class="card-body no-pad" id="activities-body"><div class="loading">로딩...</div></div>
        </div>
        <div class="card">
          <div class="card-header">
            <div class="card-title">🤖 AI 인사이트</div>
            <button class="ai-gen-btn" id="dash-ai-refresh-btn">
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

    // year buttons delegation
    document.querySelector('.year-selector')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.year-btn[data-year]');
      if (btn) this.changeYear(parseInt(btn.dataset.year));
    });
    // period buttons delegation
    document.querySelector('.card-header')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-period]');
      if (btn) this.changePeriod(btn.dataset.period);
    });
    document.getElementById('dash-pipeline-btn')?.addEventListener('click', () => App.navigate('pipeline'));
    document.getElementById('dash-ai-refresh-btn')?.addEventListener('click', () => this.refreshAIInsights());

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
    document.getElementById('dashboard-metrics').innerHTML =
      '<div class="metric-card"><div class="metric-label">로딩...</div></div>';
    document.getElementById('funnel-body').innerHTML = '<div class="loading">로딩...</div>';
    document.getElementById('activities-body').innerHTML = '<div class="loading">로딩...</div>';
    await this.loadData();
  },

  async changePeriod(period) {
    this.selectedPeriod = period;
    const periodMeta = {annual:'연간',quarterly:'분기별',monthly:'월간',recent6:'최근 6개월'};
    // 버튼 스타일 업데이트
    Object.keys(periodMeta).forEach(k => {
      const btn = document.getElementById('period-btn-' + k);
      if (!btn) return;
      btn.style.background = k === period ? 'var(--blue)' : 'var(--bg-2)';
      btn.style.color = k === period ? '#fff' : 'var(--text-2)';
      btn.style.fontWeight = k === period ? '600' : '400';
    });
    // 차트만 리로드
    try {
      const res = await API.dashboard.monthly(this.selectedYear, period);
      this.renderMonthlyChart(res.data, this.selectedYear, period);
    } catch (err) { console.error(err); }
  },

  async loadData() {
    try {
      const y = this.selectedYear;
      const p = this.selectedPeriod;
      const [stats, funnel, monthly, activities] = await Promise.all([
        API.dashboard.stats(y),
        API.dashboard.funnel(y),
        API.dashboard.monthly(y, p),
        API.dashboard.activities(y)
      ]);
      this.renderMetrics(stats.data);
      this.renderFunnel(funnel.data);
      this.renderMonthlyChart(monthly.data, y, p);
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
    } catch (_) {
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
      let tag = 'info', ico = '📊'; const content = line.replace(/^\[.*?\]\s*/, '');
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
        <button class="ai-gen-btn" id="dash-weekly-report-btn" style="width:100%;justify-content:center">
          📊 주간 보고서 생성하기
        </button>
      </div>`;
    document.getElementById('dash-weekly-report-btn')?.addEventListener('click', () => { AI.open(); AI.streamReport('weekly'); });
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
        <button class="ai-gen-btn" id="dash-ai-open-btn" style="width:100%;justify-content:center">
          💬 AI 어시스턴트 열기
        </button>
      </div>`;
    document.getElementById('dash-ai-open-btn')?.addEventListener('click', () => AI.open());
  },

  renderMetrics(d) {
    const curYear = new Date().getFullYear();
    const isCurrentYear = (d.year === curYear);
    const monthLabel = isCurrentYear ? '이번달' : `${d.year}년`;
    const wonLabel = `${d.year}년 수주 금액`;
    const pipeLabel = `${d.year}년 파이프라인`;

    document.getElementById('dashboard-metrics').innerHTML = `
      <div class="metric-card" style="--metric-color:#1664E5">
        <div class="metric-label">${monthLabel} 신규 영업기회</div>
        <div class="metric-value">${d.monthlyNew}<span class="metric-value-suffix">건</span></div>
        <div class="metric-sub">파이프라인 국내 ${d.domestic} / 해외 ${d.overseas}</div>
      </div>
      <div class="metric-card" style="--metric-color:#F59C00">
        <div class="metric-label">${pipeLabel}</div>
        <div class="metric-value">${d.totalLeads}<span class="metric-value-suffix">건</span></div>
        <div class="metric-sub">입찰 진행 ${d.bidding}건</div>
      </div>
      <div class="metric-card" style="--metric-color:#17A85A">
        <div class="metric-label">${wonLabel}</div>
        <div class="metric-value" style="font-size:18px">${Fmt.amount(d.wonAmount)}</div>
        <div class="metric-sub">${d.year}년 누적</div>
      </div>
      <div class="metric-card" style="--metric-color:#E63329">
        <div class="metric-label">입찰 진행</div>
        <div class="metric-value">${d.bidding}<span class="metric-value-suffix">건</span></div>
        <div class="metric-sub">입찰 단계 리드</div>
      </div>
      <div class="metric-card" style="--metric-color:#7C4DFF">
        <div class="metric-label">${d.year}년 수주율</div>
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

  renderMonthlyChart(data, year, period) {
    const SOLAR = ['태양광','모듈','EPC'];
    const ELEC  = ['ESS','전기','설치'];
    const titleEl = document.getElementById('monthly-chart-title');
    let labels = [], solarData = [], elecData = [];

    if (period === 'annual') {
      // 연도별: x축 = 연도 목록
      const years = [...new Set(data.map(d => d.yr))].sort();
      labels = years.map(y => `${y}년`);
      solarData = years.map(y => data.filter(d => d.yr==y && SOLAR.includes(d.business_type)).reduce((s,d)=>s+d.count,0));
      elecData  = years.map(y => data.filter(d => d.yr==y && ELEC.includes(d.business_type)).reduce((s,d)=>s+d.count,0));
      if (titleEl) titleEl.textContent = '연도별 영업기회 추이';

    } else if (period === 'quarterly') {
      // 분기별: x축 = Q1~Q4
      labels = ['Q1','Q2','Q3','Q4'];
      solarData = labels.map(q => data.filter(d => d.qtr===q && SOLAR.includes(d.business_type)).reduce((s,d)=>s+d.count,0));
      elecData  = labels.map(q => data.filter(d => d.qtr===q && ELEC.includes(d.business_type)).reduce((s,d)=>s+d.count,0));
      if (titleEl) titleEl.textContent = `${year}년 분기별 영업기회 추이`;

    } else if (period === 'monthly') {
      // 월간: 선택 연도 12개월
      const months = Array.from({length:12}, (_,i) => ({
        key: `${year}-${String(i+1).padStart(2,'0')}`, label:`${i+1}월`
      }));
      labels = months.map(m => m.label);
      solarData = months.map(m => data.filter(d => d.month===m.key && SOLAR.includes(d.business_type)).reduce((s,d)=>s+d.count,0));
      elecData  = months.map(m => data.filter(d => d.month===m.key && ELEC.includes(d.business_type)).reduce((s,d)=>s+d.count,0));
      if (titleEl) titleEl.textContent = `${year}년 월간 영업기회 추이`;

    } else {
      // recent6: 현재 기준 최근 6개월
      const now = new Date();
      const months = Array.from({length:6}, (_,i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (5-i), 1);
        return { key:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, label:`${d.getMonth()+1}월` };
      });
      labels = months.map(m => m.label);
      solarData = months.map(m => data.filter(d => d.month===m.key && SOLAR.includes(d.business_type)).reduce((s,d)=>s+d.count,0));
      elecData  = months.map(m => data.filter(d => d.month===m.key && ELEC.includes(d.business_type)).reduce((s,d)=>s+d.count,0));
      if (titleEl) titleEl.textContent = '영업기회 추이 (최근 6개월)';
    }

    const ctx = document.getElementById('chart-monthly');
    if (this.monthlyChart) this.monthlyChart.destroy();
    this.monthlyChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: '태양광/EPC', data: solarData, backgroundColor: '#F59C00', borderRadius: 4 },
          { label: '전기/ESS',   data: elecData,  backgroundColor: '#1664E5', borderRadius: 4 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              footer: (items) => {
                const total = items.reduce((s,i)=>s+i.raw,0);
                return `합계: ${total}건`;
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11 } } },
          y: { grid: { color: '#E8EAED' }, ticks: { font: { size: 11 }, stepSize: 1 }, beginAtZero: true }
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
