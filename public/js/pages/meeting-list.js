// ============================================================
// MeetingListPage — AI 추출 회의록 목록 / 상세
// ============================================================
const MeetingListPage = {
  data: [],
  selectedId: null,

  async render() {
    document.getElementById('content').innerHTML = `
      <div class="filter-bar" style="margin-bottom:14px">
        <div class="card-title" style="margin-right:auto">📋 AI 회의록 목록</div>
        <input class="search-input" id="ml-search" placeholder="제목 / 고객사 검색..."
               oninput="MeetingListPage.applyFilter()">
        <button class="btn btn-primary" onclick="App.navigate('meeting')">+ 새 회의록</button>
      </div>

      <div style="display:grid;grid-template-columns:1.2fr 2fr;gap:14px">
        <div class="card">
          <div class="card-body no-pad" id="ml-list" style="max-height:calc(100vh - 200px);overflow-y:auto">
            <div class="loading">로딩...</div>
          </div>
        </div>
        <div class="card">
          <div class="card-body" id="ml-detail" style="min-height:400px">
            <div class="empty">왼쪽 목록에서 회의록을 선택하세요</div>
          </div>
        </div>
      </div>
    `;
    await this.loadList();
  },

  async loadList() {
    try {
      const r = await API.meetings.list();
      this.data = r.data || [];
      this.renderList(this.data);
    } catch (err) {
      document.getElementById('ml-list').innerHTML =
        `<div class="empty" style="color:var(--oci-red)">${esc(err.message)}</div>`;
    }
  },

  applyFilter() {
    const q = (document.getElementById('ml-search')?.value || '').toLowerCase();
    const filtered = this.data.filter(m =>
      !q ||
      (m.title || '').toLowerCase().includes(q) ||
      (m.customer_name || '').toLowerCase().includes(q)
    );
    this.renderList(filtered);
  },

  renderList(items) {
    const el = document.getElementById('ml-list');
    if (!items.length) {
      el.innerHTML = '<div class="empty">저장된 회의록이 없습니다</div>';
      return;
    }
    el.innerHTML = items.map(m => `
      <div class="ml-item ${this.selectedId == m.id ? 'active' : ''}"
           onclick="MeetingListPage.showDetail(${m.id})">
        <div class="ml-item-title">${esc(m.title)}</div>
        <div class="ml-item-meta">
          ${m.customer_name ? `<span class="badge badge-blue" style="margin-right:6px">${esc(m.customer_name)}</span>` : ''}
          ${m.calendar_event_id ? '<span class="badge badge-green">📅 캘린더 등록됨</span>' : ''}
        </div>
        <div class="ml-item-preview">${esc((m.summary_preview || '').replace(/[#*]/g, '').slice(0, 100))}...</div>
        <div class="ml-item-date">
          ${esc(Fmt.date(m.meeting_date))} · 작성: ${esc(m.created_by_name || '시스템')} · ${esc(Fmt.relTime(m.created_at))}
        </div>
      </div>
    `).join('');
  },

  async showDetail(id) {
    this.selectedId = id;
    this.renderList(this.data);  // active 표시 갱신
    const detail = document.getElementById('ml-detail');
    detail.innerHTML = '<div class="loading">로딩...</div>';

    try {
      const r = await API.meetings.get(id);
      const m = r.data;

      detail.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border)">
          <div>
            <div style="font-size:17px;font-weight:600;color:var(--text-1);margin-bottom:6px">${esc(m.title)}</div>
            <div style="font-size:12px;color:var(--text-3)">
              ${esc(Fmt.date(m.meeting_date))}
              ${m.customer_name ? ` · ${esc(m.customer_name)}` : ''}
              ${m.created_by_name ? ` · 작성자: ${esc(m.created_by_name)}` : ''}
            </div>
          </div>
          <div style="display:flex;gap:6px">
            ${m.calendar_event_id
              ? '<span class="badge badge-green">📅 캘린더 등록됨</span>'
              : `<button class="btn btn-ghost btn-sm" onclick="MeetingListPage.registerCalendar(${m.id})">📅 캘린더 등록</button>`
            }
            <button class="btn btn-ghost btn-sm text-danger" onclick="MeetingListPage.deleteMeeting(${m.id})">삭제</button>
          </div>
        </div>

        <div class="markdown-body" style="line-height:1.7;font-size:13px;margin-bottom:18px">
          ${AI.renderMarkdown(m.summary_md || '*요약 내용이 없습니다*')}
        </div>

        <details style="margin-top:18px">
          <summary style="cursor:pointer;font-size:12px;font-weight:600;color:var(--text-2);padding:8px 0">
            🗣 화자 분리 원본 보기
          </summary>
          <div id="ml-speakers" style="margin-top:10px"></div>
        </details>

        <details style="margin-top:8px">
          <summary style="cursor:pointer;font-size:12px;font-weight:600;color:var(--text-2);padding:8px 0">
            📜 전체 텍스트 보기
          </summary>
          <pre style="white-space:pre-wrap;background:var(--surface-2);padding:12px;border-radius:6px;
                      font-size:12px;line-height:1.6;margin-top:10px;color:var(--text-2);
                      max-height:400px;overflow-y:auto">${esc(m.raw_transcript || '(전사 텍스트 없음)')}</pre>
        </details>
      `;

      // 화자 렌더링
      try {
        const speakers = m.speakers_json ? JSON.parse(m.speakers_json) : [];
        const colors = ['#1664E5', '#00A86B', '#F59C00', '#7C4DFF', '#E63329', '#0EA5E9'];
        const sEl = document.getElementById('ml-speakers');
        if (speakers.length) {
          sEl.innerHTML = speakers.map(s => {
            const c = colors[(s.speaker - 1) % colors.length];
            return `
              <div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
                <div style="flex-shrink:0;width:28px;height:28px;border-radius:50%;background:${c};color:#fff;
                            display:flex;align-items:center;justify-content:center;font-weight:600;font-size:11px">${s.speaker}</div>
                <div style="flex:1;font-size:12px;line-height:1.6">${esc(s.text)}</div>
              </div>`;
          }).join('');
        } else sEl.innerHTML = '<div class="empty">화자 분리 데이터 없음</div>';
      } catch (_) {}

    } catch (err) {
      detail.innerHTML = `<div class="empty" style="color:var(--oci-red)">${esc(err.message)}</div>`;
    }
  },

  async registerCalendar(id) {
    const customer = prompt('연결할 고객사명을 입력하세요:');
    if (!customer) return;
    try {
      const r = await API.meetings.registerCalendar(id, { customer_name: customer });
      if (r.success) {
        Toast.success(`캘린더 등록 완료: 미팅 + 액션 ${r.data.action_events_created}건`);
        await this.loadList();
        this.showDetail(id);
      }
    } catch (err) { Toast.error(err.message); }
  },

  deleteMeeting(id) {
    Modal.confirm('이 회의록을 삭제하시겠습니까?', async () => {
      try {
        await API.meetings.delete(id);
        Toast.success('삭제되었습니다');
        this.selectedId = null;
        document.getElementById('ml-detail').innerHTML = '<div class="empty">왼쪽 목록에서 회의록을 선택하세요</div>';
        await this.loadList();
      } catch (err) { Toast.error(err.message); }
    });
  }
};
