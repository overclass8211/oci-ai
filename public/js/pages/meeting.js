// ============================================================
// MeetingPage — 미팅 녹음/업로드 → STT → 요약 → 저장 → 캘린더 등록
// ============================================================
const MeetingPage = (() => {
  let mediaRecorder = null;
  let recordedChunks = [];
  let recordedBlob = null;
  let recordingStartTime = 0;
  let recordingTimerId = null;
  let leads = [];

  let _state = {
    transcript: '',
    speakers: [],
    summary: '',
    savedId: null,
    customerName: '',
    leadId: null
  };

  async function fetchLeads() {
    try { const r = await API.leads.list(); leads = r.data || []; }
    catch (_) { leads = []; }
  }

  // ── 1) 페이지 렌더 ─────────────────────────────────────
  async function render() {
    const el = document.getElementById('content');
    el.innerHTML = `
      <div class="filter-bar" style="margin-bottom:16px">
        <div class="card-title" style="margin-right:auto">🎤 회의록 AI</div>
        <button class="btn btn-ghost" onclick="App.navigate('meeting-list')">📋 회의록 목록</button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
        <!-- 실시간 녹음 -->
        <div class="card">
          <div class="card-header"><div class="card-title">🔴 미팅 실시간 녹음</div></div>
          <div class="card-body" style="text-align:center;padding:24px">
            <div id="rec-visual" class="rec-visual"></div>
            <div id="rec-time" class="rec-time">00:00</div>
            <div id="rec-status" style="font-size:12px;color:var(--text-3);margin-bottom:14px">대기 중</div>
            <button class="btn btn-primary" id="rec-start-btn" onclick="MeetingPage.startRecording()">
              ● 녹음 시작
            </button>
            <button class="btn btn-ghost text-danger" id="rec-stop-btn" onclick="MeetingPage.stopRecording()" style="display:none">
              ■ 녹음 중지
            </button>
          </div>
        </div>

        <!-- 파일 업로드 -->
        <div class="card">
          <div class="card-header"><div class="card-title">📁 녹음 파일 업로드</div></div>
          <div class="card-body">
            <div id="audio-dropzone"
                 onclick="document.getElementById('audio-file-input').click()"
                 ondragover="event.preventDefault();this.classList.add('drag-over')"
                 ondragleave="this.classList.remove('drag-over')"
                 ondrop="MeetingPage._handleDrop(event)">
              <div style="font-size:32px;margin-bottom:8px">🎵</div>
              <div style="font-size:13px;font-weight:600">오디오 파일을 드롭하거나 클릭해서 선택</div>
              <div style="font-size:11px;color:var(--text-3);margin-top:4px">
                MP3 / WAV / M4A / WEBM / OGG · 최대 25MB
              </div>
              <input type="file" id="audio-file-input" accept="audio/*" style="display:none"
                     onchange="MeetingPage._handleFile(this.files[0])">
            </div>
            <div id="audio-file-info" style="margin-top:10px"></div>
          </div>
        </div>
      </div>

      <!-- 처리 결과 영역 -->
      <div id="meeting-result" style="display:none">
        <div class="card" style="margin-bottom:14px">
          <div class="card-header">
            <div class="card-title">🗣 음성 인식 결과 (화자 분리)</div>
            <span id="meeting-stats" style="font-size:11px;color:var(--text-3)"></span>
          </div>
          <div id="speakers-list" class="card-body" style="max-height:280px;overflow-y:auto"></div>
        </div>

        <div class="card" style="margin-bottom:14px">
          <div class="card-header">
            <div class="card-title">📝 AI 요약 회의록</div>
            <button class="btn btn-ghost btn-sm" id="meeting-regen-btn" onclick="MeetingPage.regenerateSummary()" style="display:none">
              🔄 다시 생성
            </button>
          </div>
          <div id="meeting-summary" class="card-body markdown-body" style="line-height:1.7;font-size:13px;min-height:120px">
            <span class="ai-cursor">▋</span>
          </div>
        </div>

        <!-- 메타 정보 + 저장 -->
        <div class="card">
          <div class="card-body">
            <div class="form-row-3">
              <div class="form-row">
                <label class="form-label">미팅 제목</label>
                <input class="form-input" id="meeting-title" placeholder="예: 삼성케미칼 분기 정기 미팅">
              </div>
              <div class="form-row">
                <label class="form-label">미팅 일자</label>
                <input type="date" class="form-input" id="meeting-date" value="${new Date().toISOString().slice(0,10)}">
              </div>
              <div class="form-row">
                <label class="form-label">고객사 (선택)</label>
                <input class="form-input" id="meeting-customer" list="meeting-leads-list" placeholder="고객사 또는 빈칸">
                <datalist id="meeting-leads-list"></datalist>
              </div>
            </div>
            <div style="text-align:right;margin-top:14px">
              <button class="btn btn-ghost" onclick="MeetingPage.reset()">초기화</button>
              <button class="btn btn-primary" id="meeting-save-btn" onclick="MeetingPage.save()" disabled>💾 회의록 저장</button>
            </div>
          </div>
        </div>
      </div>
    `;

    await fetchLeads();
    const dl = document.getElementById('meeting-leads-list');
    if (dl) {
      dl.innerHTML = leads.map(l =>
        `<option value="${esc(l.customer_name || '')}">${esc(l.customer_name || '')}${l.project_name ? ' - ' + esc(l.project_name) : ''}</option>`
      ).join('');
    }
  }

  // ── 2) 녹음 ─────────────────────────────────────────────
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm';
      mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
      recordedChunks = [];
      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
      mediaRecorder.onstop = () => {
        recordedBlob = new Blob(recordedChunks, { type: mime });
        stream.getTracks().forEach(t => t.stop());
        document.getElementById('rec-status').textContent = `✅ 녹음 완료 (${(recordedBlob.size / 1024).toFixed(0)} KB)`;
        document.getElementById('rec-visual').classList.remove('recording');
        document.getElementById('rec-start-btn').style.display = '';
        document.getElementById('rec-stop-btn').style.display = 'none';
        clearInterval(recordingTimerId);
        _processAudio(recordedBlob, `recording-${Date.now()}.webm`);
      };
      mediaRecorder.start();
      recordingStartTime = Date.now();
      document.getElementById('rec-status').textContent = '🔴 녹음 중...';
      document.getElementById('rec-visual').classList.add('recording');
      document.getElementById('rec-start-btn').style.display = 'none';
      document.getElementById('rec-stop-btn').style.display = '';
      recordingTimerId = setInterval(() => {
        const sec = Math.floor((Date.now() - recordingStartTime) / 1000);
        const m = String(Math.floor(sec / 60)).padStart(2, '0');
        const s = String(sec % 60).padStart(2, '0');
        document.getElementById('rec-time').textContent = `${m}:${s}`;
      }, 500);
    } catch (err) {
      Toast.error('마이크 접근 권한이 필요합니다: ' + err.message);
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  }

  // ── 3) 파일 업로드 ──────────────────────────────────────
  function _handleDrop(e) {
    e.preventDefault();
    document.getElementById('audio-dropzone').classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f) _handleFile(f);
  }
  function _handleFile(file) {
    if (!file) return;
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|webm|ogg|opus|flac)$/i.test(file.name)) {
      Toast.error('오디오 파일만 업로드 가능합니다');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      Toast.error('파일은 25MB 이하만 가능합니다');
      return;
    }
    document.getElementById('audio-file-info').innerHTML =
      `<div style="font-size:12px;color:var(--text-2);background:var(--surface-2);padding:8px 12px;border-radius:6px">
        🎵 <strong>${esc(file.name)}</strong> (${(file.size / 1024).toFixed(0)} KB)
      </div>`;
    _processAudio(file, file.name);
  }

  // ── 4) STT + 요약 처리 파이프라인 ───────────────────────
  async function _processAudio(blob, filename) {
    document.getElementById('meeting-result').style.display = '';
    const speakersEl = document.getElementById('speakers-list');
    const summaryEl = document.getElementById('meeting-summary');
    const statsEl = document.getElementById('meeting-stats');

    speakersEl.innerHTML = '<div class="loading" style="padding:20px;text-align:center">🎙 음성 인식 중... (수십 초~수 분 소요)</div>';
    summaryEl.innerHTML = '<span class="ai-cursor">▋ 음성 인식 완료 후 요약 시작</span>';
    statsEl.textContent = '';

    try {
      const fd = new FormData();
      fd.append('audio', blob, filename);
      const headers = {};
      const uid = localStorage.getItem('current_user_id');
      if (uid) headers['X-User-Id'] = uid;
      const sttRes = await fetch('/api/meeting/transcribe', { method: 'POST', body: fd, headers });
      const sttJson = await sttRes.json();
      if (!sttJson.success) {
        speakersEl.innerHTML = `<div style="color:var(--oci-red);padding:12px">⚠️ ${esc(sttJson.error)}</div>`;
        summaryEl.innerHTML = '<span style="color:var(--text-3)">음성 인식 실패로 요약 불가</span>';
        return;
      }

      _state.transcript = sttJson.data.transcript;
      _state.speakers = sttJson.data.speakers || [];

      _renderSpeakers();
      statsEl.textContent = `${_state.speakers.length}개 화자 구간 · ${_state.transcript.length}자`;

      summaryEl.innerHTML = '<div class="loading">✏️ AI 요약 생성 중...</div>';
      const customer = document.getElementById('meeting-customer')?.value || '';
      const date = document.getElementById('meeting-date')?.value || '';
      const sumRes = await API.meetings.summarize({
        transcript: _state.transcript,
        speakers: _state.speakers,
        customer_name: customer,
        meeting_date: date
      });

      if (sumRes.success) {
        _state.summary = sumRes.data.summary_md;
        summaryEl.innerHTML = AI.renderMarkdown(_state.summary);
        document.getElementById('meeting-save-btn').disabled = false;
        document.getElementById('meeting-regen-btn').style.display = '';
        const titleEl = document.getElementById('meeting-title');
        if (titleEl && !titleEl.value) {
          const firstAgenda = _state.summary.match(/##\s*미팅 주요 어젠다\s*\n-\s*(.+)/);
          titleEl.value = firstAgenda ? firstAgenda[1].slice(0, 60) : `회의록 ${date}`;
        }
        if (typeof UserPrefs !== 'undefined') UserPrefs.refreshTokens();
      } else {
        summaryEl.innerHTML = `<div style="color:var(--oci-red)">⚠️ ${esc(sumRes.error)}</div>`;
      }
    } catch (err) {
      console.error(err);
      speakersEl.innerHTML = `<div style="color:var(--oci-red);padding:12px">⚠️ ${esc(err.message)}</div>`;
    }
  }

  function _renderSpeakers() {
    const el = document.getElementById('speakers-list');
    if (!_state.speakers.length) {
      el.innerHTML = '<div class="empty">화자 구분 결과가 없습니다</div>';
      return;
    }
    const colors = ['#1664E5', '#00A86B', '#F59C00', '#7C4DFF', '#E63329', '#0EA5E9'];
    el.innerHTML = _state.speakers.map(s => {
      const c = colors[(s.speaker - 1) % colors.length];
      return `
        <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="flex-shrink:0;width:32px;height:32px;border-radius:50%;background:${c};color:#fff;
                      display:flex;align-items:center;justify-content:center;font-weight:600;font-size:12px">
            ${s.speaker}
          </div>
          <div style="flex:1;font-size:13px;line-height:1.6">
            <div style="font-size:11px;font-weight:600;color:${c};margin-bottom:2px">화자 ${s.speaker}</div>
            ${esc(s.text)}
          </div>
        </div>`;
    }).join('');
  }

  // ── 5) 요약 재생성 ──────────────────────────────────────
  async function regenerateSummary() {
    if (!_state.transcript) return;
    const summaryEl = document.getElementById('meeting-summary');
    summaryEl.innerHTML = '<div class="loading">✏️ AI 재요약 중...</div>';
    try {
      const sumRes = await API.meetings.summarize({
        transcript: _state.transcript,
        speakers: _state.speakers,
        customer_name: document.getElementById('meeting-customer')?.value || '',
        meeting_date: document.getElementById('meeting-date')?.value || ''
      });
      if (sumRes.success) {
        _state.summary = sumRes.data.summary_md;
        summaryEl.innerHTML = AI.renderMarkdown(_state.summary);
        if (typeof UserPrefs !== 'undefined') UserPrefs.refreshTokens();
      }
    } catch (err) { Toast.error(err.message); }
  }

  // ── 6) 저장 + 캘린더 등록 플로우 ────────────────────────
  async function save() {
    const title = document.getElementById('meeting-title').value.trim()
                || `회의록 ${new Date().toISOString().slice(0,10)}`;
    const date = document.getElementById('meeting-date').value;
    const customer = document.getElementById('meeting-customer').value.trim();

    try {
      const r = await API.meetings.create({
        title,
        meeting_date: date,
        raw_transcript: _state.transcript,
        speakers_json: _state.speakers,
        summary_md: _state.summary,
        customer_name: customer
      });
      if (r.success) {
        _state.savedId = r.id;
        _state.customerName = customer;
        Toast.success('회의록이 저장되었습니다');
        _askCalendarRegister();
      }
    } catch (err) { Toast.error('저장 실패: ' + err.message); }
  }

  function _askCalendarRegister() {
    Modal.open({
      title: '📅 캘린더 등록',
      width: 460,
      body: `
        <div style="text-align:center;padding:8px 0">
          <div style="font-size:36px;margin-bottom:12px">📅</div>
          <div style="font-size:15px;font-weight:600;color:var(--text-1);margin-bottom:8px">
            미팅록 저장 완료
          </div>
          <div style="font-size:13px;color:var(--text-2);line-height:1.6">
            핵심 영업활동 내용을 캘린더에 등록 하시겠습니까?<br>
            <span style="font-size:11px;color:var(--text-3)">미팅 일정 + 액션 아이템들이 자동으로 캘린더에 등록됩니다</span>
          </div>
        </div>`,
      footer: `
        <button class="btn btn-ghost" onclick="MeetingPage._calendarNo()">아니오</button>
        <button class="btn btn-primary" onclick="MeetingPage._calendarYes()">예, 등록하기</button>`
    });
  }

  function _calendarNo() {
    Modal.close();
    Toast.info('회의록만 저장되었습니다');
    setTimeout(() => App.navigate('meeting-list'), 600);
  }

  function _calendarYes() {
    Modal.close();
    setTimeout(() => _askCustomerOrDeal(), 200);
  }

  function _askCustomerOrDeal() {
    const datalist = leads.map(l =>
      `<option value="${esc(l.customer_name || '')}">${esc(l.customer_name)}${l.project_name ? ' · ' + esc(l.project_name) : ''}</option>`
    ).join('');

    Modal.open({
      title: '🎯 고객사 또는 딜 선택',
      width: 520,
      body: `
        <div style="font-size:13px;color:var(--text-2);margin-bottom:14px;line-height:1.6">
          해당 고객사 또는 딜을 알려주시면 바로 등록을 도와드리겠습니다.<br>
          <span style="font-size:11px;color:var(--text-3)">미팅과 액션 아이템이 선택한 고객사/딜에 연결됩니다</span>
        </div>
        <div class="form-grid">
          <div class="form-row">
            <label class="form-label">고객사명</label>
            <input class="form-input" id="reg-customer" list="reg-leads-list"
                   value="${esc(_state.customerName || '')}" placeholder="예: 삼성케미칼">
            <datalist id="reg-leads-list">${datalist}</datalist>
          </div>
          <div class="form-row">
            <label class="form-label">영업 기회 (딜) — 선택</label>
            <select class="form-input" id="reg-lead">
              <option value="">-- 연결할 딜 선택 (선택사항) --</option>
              ${leads.map(l => `<option value="${l.id}">${esc(l.customer_name)}${l.project_name ? ' · ' + esc(l.project_name) : ''}</option>`).join('')}
            </select>
          </div>
        </div>`,
      footer: `
        <button class="btn btn-ghost" onclick="Modal.close()">취소</button>
        <button class="btn btn-primary" onclick="MeetingPage._registerCalendar()">캘린더에 등록</button>`
    });
  }

  async function _registerCalendar() {
    const customer = document.getElementById('reg-customer').value.trim();
    const leadId = document.getElementById('reg-lead').value || null;
    if (!customer && !leadId) {
      Toast.error('고객사 또는 딜을 입력해주세요');
      return;
    }
    try {
      const r = await API.meetings.registerCalendar(_state.savedId, {
        customer_name: customer,
        lead_id: leadId
      });
      if (r.success) {
        Modal.close();
        Toast.success(`캘린더 등록 완료: 미팅 + 액션 ${r.data.action_events_created}건`);
        setTimeout(() => App.navigate('meeting-list'), 800);
      }
    } catch (err) { Toast.error('등록 실패: ' + err.message); }
  }

  function reset() {
    _state = { transcript:'', speakers:[], summary:'', savedId:null, customerName:'', leadId:null };
    recordedBlob = null;
    document.getElementById('meeting-result').style.display = 'none';
    document.getElementById('audio-file-info').innerHTML = '';
    document.getElementById('rec-time').textContent = '00:00';
    document.getElementById('rec-status').textContent = '대기 중';
    const f = document.getElementById('audio-file-input'); if (f) f.value = '';
  }

  return {
    render, startRecording, stopRecording,
    _handleDrop, _handleFile, regenerateSummary, save,
    _calendarNo, _calendarYes, _registerCalendar, reset
  };
})();
