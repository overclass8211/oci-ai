// ============================================================
// CalendarPage — 영업 캘린더 (Google Calendar 스타일)
// ============================================================
const CalendarPage = (() => {
  let calendar = null;
  let currentFilter = '';
  let leads = [];

  const TYPE_COLORS = {
    '미팅':    '#1a73e8',
    '영업방문': '#33b679',
    '입찰':    '#d93025',
    '제안':    '#f9ab00',
    '내부':    '#616161',
    '기타':    '#9c27b0',
  };
  const EVENT_TYPES = Object.keys(TYPE_COLORS);

  async function fetchLeads() {
    try {
      const res = await API.leads.list();
      leads = res.data || [];
    } catch (_) { leads = []; }
  }

  async function fetchEvents(fetchInfo, successCallback, failureCallback) {
    try {
      const start = fetchInfo.startStr.slice(0, 10);
      const end   = fetchInfo.endStr.slice(0, 10);
      let qs = `start=${start}&end=${end}`;
      if (currentFilter) qs += `&assigned_to=${encodeURIComponent(currentFilter)}`;
      const res = await API.get(`/calendar/events?${qs}`);
      const events = (res.data || []).map(e => {
        const isDone = e.status === 'completed';
        const baseColor = e.color || TYPE_COLORS[e.event_type] || '#1a73e8';
        const icon = isDone ? '✓' : '●';
        const assignee = e.assignee_name ? ` · ${e.assignee_name}` : '';
        // 제목에 아이콘 + 담당자 직접 포함 (custom eventContent 회피로 안정적 렌더링)
        const composedTitle = `${icon} ${e.title}${assignee}`;
        return {
          id: String(e.id),
          title: composedTitle,
          start: e.start_datetime,
          end: e.end_datetime || undefined,
          allDay: !!e.all_day,
          backgroundColor: baseColor,
          borderColor:     baseColor,
          textColor:       '#fff',
          classNames:      isDone ? ['cal-event-completed'] : [],
          extendedProps:   e,
        };
      });
      successCallback(events);
    } catch (err) {
      failureCallback(err);
    }
  }

  function toLocalDT(dt) {
    if (!dt) return '';
    const d = new Date(dt);
    if (isNaN(d)) return '';
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function toDateStr(dt) {
    if (!dt) return '';
    const d = new Date(dt);
    if (isNaN(d)) return '';
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
  }

  function teamOptions(selectedId) {
    const team = App?.team || [];
    return `<option value="">-- 담당자 선택 --</option>` +
      team.map(m => `<option value="${m.id}" ${String(m.id) === String(selectedId) ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
  }
  function teamFilterOptions() {
    const team = App?.team || [];
    return `<option value="">담당자 전체</option>` +
      team.map(m => `<option value="${m.id}" ${String(m.id) === String(currentFilter) ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
  }
  function leadSelectOptions(selectedId) {
    return `<option value="">-- 영업 기회 연결 안함 --</option>` +
      leads.map(l =>
        `<option value="${l.id}" ${String(l.id) === String(selectedId) ? 'selected' : ''}>${esc(l.customer_name || '')}${l.project_name ? ' - ' + esc(l.project_name) : ''}</option>`
      ).join('');
  }

  function buildEventForm(d = {}) {
    const colorVal = d.color || TYPE_COLORS[d.event_type] || '#1a73e8';
    const status = d.status || 'planned';
    return `
      <form id="cal-event-form" autocomplete="off" class="form-grid">
        <div class="form-row">
          <label class="form-label required">제목</label>
          <input class="form-input" id="cal-title" value="${esc(d.title || '')}"
                 placeholder="예: 삼성케미칼 견적서 발송" required>
        </div>

        <div class="form-row-3">
          <div class="form-row">
            <label class="form-label">유형</label>
            <select class="form-input" id="cal-event-type">
              ${EVENT_TYPES.map(t => `<option value="${t}" ${d.event_type === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>
          <div class="form-row">
            <label class="form-label">상태</label>
            <select class="form-input" id="cal-status">
              <option value="planned"   ${status === 'planned'   ? 'selected' : ''}>○ 계획</option>
              <option value="completed" ${status === 'completed' ? 'selected' : ''}>✓ 완료</option>
            </select>
          </div>
          <div class="form-row">
            <label class="form-label">담당자</label>
            <select class="form-input" id="cal-assigned-to">${teamOptions(d.assigned_to)}</select>
          </div>
        </div>

        <div id="cal-datetime-group">
          <div class="form-row-2" id="cal-datetime-row">
            <div class="form-row">
              <label class="form-label">시작 일시</label>
              <input type="datetime-local" class="form-input" id="cal-start"
                     value="${esc(d.start_datetime ? toLocalDT(d.start_datetime) : (d._start || ''))}">
            </div>
            <div class="form-row">
              <label class="form-label">종료 일시</label>
              <input type="datetime-local" class="form-input" id="cal-end"
                     value="${esc(d.end_datetime ? toLocalDT(d.end_datetime) : (d._end || ''))}">
            </div>
          </div>
          <div class="form-row-2" id="cal-date-row" style="display:none">
            <div class="form-row">
              <label class="form-label">시작일</label>
              <input type="date" class="form-input" id="cal-start-date"
                     value="${esc(d.start_datetime ? toDateStr(d.start_datetime) : (d._startDate || ''))}">
            </div>
            <div class="form-row">
              <label class="form-label">종료일</label>
              <input type="date" class="form-input" id="cal-end-date"
                     value="${esc(d.end_datetime ? toDateStr(d.end_datetime) : (d._endDate || ''))}">
            </div>
          </div>
        </div>

        <div class="form-row-3">
          <div class="form-row">
            <label class="form-check">
              <input type="checkbox" id="cal-allday" ${d.all_day ? 'checked' : ''}> 종일 일정
            </label>
          </div>
          <div class="form-row">
            <label class="form-label">색상</label>
            <input type="color" class="form-input" id="cal-color" value="${colorVal}">
          </div>
          <div class="form-row"><!-- spacer --></div>
        </div>

        <div class="form-row-2">
          <div class="form-row">
            <label class="form-label">고객사</label>
            <input class="form-input" id="cal-customer" value="${esc(d.customer_name || '')}" placeholder="고객사명">
          </div>
          <div class="form-row">
            <label class="form-label">영업 기회 연결</label>
            <select class="form-input" id="cal-lead-id">${leadSelectOptions(d.lead_id)}</select>
          </div>
        </div>

        <div class="form-row">
          <label class="form-label">설명 / 메모</label>
          <textarea class="form-input" id="cal-description" rows="3"
                    placeholder="회의 안건, 준비 사항, 결과 등">${esc(d.description || '')}</textarea>
        </div>
      </form>`;
  }

  function wireAlldayToggle() {
    const chk   = document.getElementById('cal-allday');
    const dtRow = document.getElementById('cal-datetime-row');
    const dRow  = document.getElementById('cal-date-row');
    if (!chk) return;
    const toggle = () => {
      dtRow.style.display = chk.checked ? 'none' : '';
      dRow.style.display  = chk.checked ? '' : 'none';
    };
    toggle();
    chk.addEventListener('change', toggle);
    const typeEl  = document.getElementById('cal-event-type');
    const colorEl = document.getElementById('cal-color');
    if (typeEl && colorEl) {
      typeEl.addEventListener('change', () => {
        const col = TYPE_COLORS[typeEl.value];
        if (col) colorEl.value = col;
      });
    }
  }

  function collectForm() {
    const allDay = document.getElementById('cal-allday').checked;
    const start = allDay
      ? document.getElementById('cal-start-date').value
      : document.getElementById('cal-start').value;
    const end = allDay
      ? (document.getElementById('cal-end-date').value || start)
      : document.getElementById('cal-end').value;
    return {
      title:         document.getElementById('cal-title').value.trim(),
      event_type:    document.getElementById('cal-event-type').value,
      status:        document.getElementById('cal-status').value,
      start_datetime: start,
      end_datetime:  end || null,
      all_day:       allDay ? 1 : 0,
      description:   document.getElementById('cal-description').value.trim(),
      customer_name: document.getElementById('cal-customer').value.trim(),
      lead_id:       document.getElementById('cal-lead-id').value || null,
      assigned_to:   document.getElementById('cal-assigned-to').value || null,
      color:         document.getElementById('cal-color').value,
    };
  }

  function openCreateModal(defaults = {}) {
    Modal.open({
      title: '새 일정 등록', width: 600,
      body: buildEventForm(defaults),
      footer: `<button class="btn btn-ghost" onclick="Modal.close()">취소</button>
               <button class="btn btn-primary" id="cal-save-btn">저장</button>`
    });
    wireAlldayToggle();
    document.getElementById('cal-save-btn').addEventListener('click', async () => {
      const data = collectForm();
      if (!data.title) { Toast.error('제목을 입력하세요'); return; }
      if (!data.start_datetime) { Toast.error('시작 일시를 입력하세요'); return; }
      try {
        await API.post('/calendar/events', data);
        Toast.success('일정이 등록되었습니다');
        Modal.close();
        calendar?.refetchEvents();
      } catch (_) {}
    });
  }

  function openEditModal(eventData) {
    Modal.open({
      title: '일정 수정', width: 600,
      body: buildEventForm(eventData),
      footer: `<button class="btn btn-ghost" onclick="Modal.close()">취소</button>
               <button class="btn btn-primary" id="cal-update-btn">저장</button>`
    });
    wireAlldayToggle();
    document.getElementById('cal-update-btn').addEventListener('click', async () => {
      const data = collectForm();
      if (!data.title) { Toast.error('제목을 입력하세요'); return; }
      try {
        await API.put(`/calendar/events/${eventData.id}`, data);
        Toast.success('일정이 수정되었습니다');
        Modal.close();
        calendar?.refetchEvents();
      } catch (_) {}
    });
  }

  function openDetailModal(ep) {
    const dotStyle = `display:inline-block;width:12px;height:12px;border-radius:50%;background:${esc(ep.color || TYPE_COLORS[ep.event_type] || '#ccc')};margin-right:8px;vertical-align:middle`;
    const startStr = ep.all_day ? Fmt.date(ep.start_datetime) : toLocalDT(ep.start_datetime).replace('T', ' ');
    const endStr   = ep.end_datetime ? (ep.all_day ? Fmt.date(ep.end_datetime) : toLocalDT(ep.end_datetime).replace('T', ' ')) : '-';
    const isDone   = ep.status === 'completed';
    const statusBadge = isDone
      ? `<span class="status-badge completed">✓ 완료</span>`
      : `<span class="status-badge planned">○ 계획</span>`;
    Modal.open({
      title: `<span style="${dotStyle}"></span>${esc(ep.title)}`,
      width: 500,
      body: `
        <div class="kv-grid">
          <div class="kv-row"><span class="kv-key">상태</span><span class="kv-val">${statusBadge}</span></div>
          <div class="kv-row"><span class="kv-key">유형</span><span class="kv-val">${esc(ep.event_type || '-')}</span></div>
          <div class="kv-row"><span class="kv-key">시작</span><span class="kv-val">${esc(startStr)}</span></div>
          <div class="kv-row"><span class="kv-key">종료</span><span class="kv-val">${esc(endStr)}</span></div>
          <div class="kv-row"><span class="kv-key">고객사</span><span class="kv-val">${esc(ep.customer_name || '-')}</span></div>
          <div class="kv-row"><span class="kv-key">담당자</span><span class="kv-val">${esc(ep.assignee_name || '-')}</span></div>
          ${ep.description ? `<div class="kv-row"><span class="kv-key">설명</span><span class="kv-val" style="white-space:pre-wrap">${esc(ep.description)}</span></div>` : ''}
        </div>`,
      footer: `
        <button class="btn btn-ghost text-danger" id="cal-del-btn">삭제</button>
        <button class="btn btn-ghost" onclick="Modal.close()">닫기</button>
        <button class="btn btn-primary" id="cal-edit-btn">수정</button>`
    });
    document.getElementById('cal-edit-btn').addEventListener('click', () => {
      Modal.close();
      setTimeout(() => openEditModal(ep), 80);
    });
    document.getElementById('cal-del-btn').addEventListener('click', () => {
      Modal.confirm(`"${ep.title}" 일정을 삭제하시겠습니까?`, async () => {
        await API.del(`/calendar/events/${ep.id}`);
        Toast.success('일정이 삭제되었습니다');
        Modal.close();
        calendar?.refetchEvents();
      });
    });
  }

  // 데이터 부족 시 자동 시드
  async function ensureSeedData() {
    try {
      const r = await API.get('/calendar/events?start=2026-01-01&end=2026-04-30');
      const count = (r.data || []).length;
      if (count < 100) {
        Toast.info('영업 활동 데이터를 생성하는 중입니다...');
        const seedRes = await API.post('/calendar/seed-massive', {});
        if (seedRes.success) {
          Toast.success(`${seedRes.seeded}개 영업활동이 생성되었습니다`);
        }
      }
    } catch (err) {
      console.error('Seed error:', err);
    }
  }

  async function render() {
    const container = document.getElementById('content');
    container.innerHTML = `
      <div class="cal-page">
        <div class="cal-toolbar">
          <button class="cal-today-btn" id="cal-today">오늘</button>
          <div class="cal-nav-group">
            <button class="cal-arrow-btn" id="cal-prev" title="이전">‹</button>
            <button class="cal-arrow-btn" id="cal-next" title="다음">›</button>
          </div>
          <span id="cal-title-label" class="cal-title"></span>

          <select class="cal-team-filter" id="cal-team-filter">
            ${teamFilterOptions()}
          </select>

          <div class="cal-view-group">
            <button class="cal-view-btn active" data-cal-view="dayGridMonth">월</button>
            <button class="cal-view-btn" data-cal-view="timeGridWeek">주</button>
            <button class="cal-view-btn" data-cal-view="timeGridDay">일</button>
            <button class="cal-view-btn" data-cal-view="listWeek">목록</button>
          </div>

          <button class="cal-add-btn" id="cal-add-btn">+ 일정 만들기</button>
        </div>
        <div class="cal-wrap">
          <div id="cal-calendar"></div>
        </div>
      </div>`;

    await fetchLeads();
    await ensureSeedData();

    if (typeof FullCalendar === 'undefined') {
      document.getElementById('cal-calendar').innerHTML =
        '<div style="padding:40px;text-align:center;color:#d93025">FullCalendar 라이브러리 로드 실패. 페이지를 새로고침하세요.</div>';
      return;
    }

    calendar = new FullCalendar.Calendar(document.getElementById('cal-calendar'), {
      locale: 'ko',
      initialView: 'dayGridMonth',
      initialDate: '2026-02-01',  // 시드 데이터 가운데로 시작
      headerToolbar: false,
      height: '100%',
      events: fetchEvents,
      eventDisplay: 'block',          // 점(dot) 대신 색깔 막대로 강제 렌더링 (월간뷰 핵심)
      displayEventTime: true,
      eventTextColor: '#fff',
      editable: true,
      selectable: true,
      dayMaxEvents: 3,
      moreLinkText: (n) => `+${n}건 더보기`,
      // 한국 로케일이 "1일", "2일"로 표시하는 것을 숫자만으로 변경
      dayCellContent(arg) {
        return { html: `<span class="cal-day-num">${arg.date.getDate()}</span>` };
      },
      nowIndicator: true,
      firstDay: 0, // 일요일 시작 (Google Calendar 기본)
      dayHeaderFormat: { weekday: 'short' },
      eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
      slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
      eventClick(info) { openDetailModal(info.event.extendedProps); },
      dateClick(info) {
        if (info.allDay) {
          openCreateModal({ _startDate: info.dateStr, _endDate: info.dateStr, all_day: true });
        } else {
          const end = new Date(new Date(info.dateStr).getTime() + 3600000);
          openCreateModal({ _start: toLocalDT(info.dateStr), _end: toLocalDT(end.toISOString()) });
        }
      },
      eventDrop(info) {
        const e = info.event;
        API.put(`/calendar/events/${e.extendedProps.id}`, {
          ...e.extendedProps,
          start_datetime: e.startStr.slice(0, 19).replace('T', ' '),
          end_datetime:   (e.endStr || e.startStr).slice(0, 19).replace('T', ' '),
          all_day: e.allDay ? 1 : 0,
        }).catch(() => info.revert());
      },
      eventResize(info) {
        const e = info.event;
        API.put(`/calendar/events/${e.extendedProps.id}`, {
          ...e.extendedProps,
          start_datetime: e.startStr.slice(0, 19).replace('T', ' '),
          end_datetime:   (e.endStr || e.startStr).slice(0, 19).replace('T', ' '),
          all_day: e.allDay ? 1 : 0,
        }).catch(() => info.revert());
      },
      datesSet() {
        const el = document.getElementById('cal-title-label');
        if (el && calendar) el.textContent = calendar.view.title;
      },
    });

    calendar.render();

    const titleEl = document.getElementById('cal-title-label');
    if (titleEl) titleEl.textContent = calendar.view.title;

    document.querySelectorAll('[data-cal-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        calendar.changeView(btn.dataset.calView);
        document.querySelectorAll('[data-cal-view]').forEach(b => b.classList.toggle('active', b === btn));
        if (titleEl) titleEl.textContent = calendar.view.title;
      });
    });

    document.getElementById('cal-prev').addEventListener('click', () => { calendar.prev(); });
    document.getElementById('cal-today').addEventListener('click', () => { calendar.today(); });
    document.getElementById('cal-next').addEventListener('click', () => { calendar.next(); });

    document.getElementById('cal-team-filter').addEventListener('change', e => {
      currentFilter = e.target.value;
      calendar.refetchEvents();
    });
    document.getElementById('cal-add-btn').addEventListener('click', () => openCreateModal({}));

    // 윈도우 리사이즈 시 캘린더 재계산
    setTimeout(() => calendar.updateSize(), 100);
  }

  return { render };
})();
