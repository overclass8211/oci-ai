// ============================================================
// AI Assistant — OCI CRM
// Claude API 스트리밍 기반 AI 어시스턴트
// ============================================================
const AI = {
  isOpen: false,
  messages: [],          // { role, content }
  currentStream: null,   // AbortController

  // ── 패널 열기/닫기 ──────────────────────────────────────
  toggle() {
    this.isOpen ? this.close() : this.open();
  },

  open() {
    this.isOpen = true;
    document.getElementById('ai-panel').classList.add('open');
    document.getElementById('ai-overlay').classList.add('show');
    document.getElementById('ai-input').focus();
    if (!this.messages.length) this.addWelcome();
  },

  close() {
    this.isOpen = false;
    document.getElementById('ai-panel').classList.remove('open');
    document.getElementById('ai-overlay').classList.remove('show');
  },

  addWelcome() {
    const ctx = App.currentPage;
    const welcomes = {
      dashboard: '대시보드 현황을 분석해드릴까요? 파이프라인 인사이트나 주요 리스크를 물어보세요.',
      leads:     '영업 리드에 대해 궁금한 점을 물어보세요. 특정 고객사 현황, 단계별 현황 등을 안내해드립니다.',
      pipeline:  '파이프라인 현황 분석을 도와드립니다. 수주 가능성이 높은 리드를 알아볼까요?',
      customers: '고객사 브리핑이나 영업 전략을 도와드립니다.',
      reports:   '주간/월간 보고서를 생성해드릴 수 있습니다. "주간보고서 작성해줘"라고 입력해보세요.',
      default:   'OCI CRM AI 어시스턴트입니다. 영업 현황, 리드 분석, 보고서 작성 등을 도와드립니다.'
    };
    const text = welcomes[ctx] || welcomes.default;
    this.appendBotMessage(text);
  },

  // ── SSE 스트림 공통 처리 ─────────────────────────────────
  async _readStream(response, botDiv, onDone) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // 마지막 불완전 줄 보존

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') { reader.cancel(); break; }
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            botDiv.innerHTML = `<span style="color:#ff6b6b">⚠️ AI 오류: ${esc(parsed.error)}</span>`;
            return fullText;
          }
          if (parsed.text) {
            fullText += parsed.text;
            botDiv.innerHTML = this.renderMarkdown(fullText) + '<span class="ai-cursor">▋</span>';
            botDiv.parentElement.scrollTop = botDiv.parentElement.scrollHeight;
          }
        } catch (_) {}
      }
    }
    botDiv.innerHTML = this.renderMarkdown(fullText);
    if (onDone) onDone(fullText);
    return fullText;
  },

  // ── 메시지 전송 ──────────────────────────────────────────
  async send() {
    const input = document.getElementById('ai-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';

    this.messages.push({ role: 'user', content: text });
    this.appendUserMessage(text);

    if (await this.handleQuickCommand(text)) return;

    const botDiv = this.appendBotMessage('', true);

    try {
      const ctrl = new AbortController();
      this.currentStream = ctrl;

      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: this.messages.slice(-12) }),
        signal: ctrl.signal
      });

      if (!res.ok) throw new Error(`서버 오류 (${res.status})`);

      const fullText = await this._readStream(res, botDiv);
      if (fullText) this.messages.push({ role: 'assistant', content: fullText });
    } catch (err) {
      if (err.name !== 'AbortError') {
        botDiv.innerHTML = `<span style="color:#ff6b6b">⚠️ ${esc(err.message)}</span>`;
      }
    } finally {
      this.currentStream = null;
    }
  },

  // ── 빠른 명령어 ──────────────────────────────────────────
  async handleQuickCommand(text) {
    const t = text.toLowerCase();
    if (t.includes('주간보고') || t.includes('주간 보고')) {
      this.streamReport('weekly'); return true;
    }
    if (t.includes('월간보고') || t.includes('월간 보고')) {
      this.streamReport('monthly'); return true;
    }
    return false;
  },

  async streamReport(type) {
    const label = type === 'weekly' ? '주간' : '월간';
    const botDiv = this.appendBotMessage(`📊 ${label} 보고서를 작성합니다...`, true);
    try {
      const res = await fetch('/api/ai/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type })
      });
      if (!res.ok) throw new Error(`서버 오류 (${res.status})`);
      const fullText = await this._readStream(res, botDiv);
      if (fullText) this.messages.push({ role: 'assistant', content: fullText });
    } catch (err) {
      botDiv.innerHTML = `<span style="color:#ff6b6b">⚠️ 보고서 생성 실패: ${esc(err.message)}</span>`;
    }
  },

  // ── 고객사 브리핑 (외부 호출용) ─────────────────────────
  async briefCustomer(customerId, customerName) {
    this.open();
    this.appendUserMessage(`${customerName} 고객사 브리핑 해줘`);
    const botDiv = this.appendBotMessage('', true);
    try {
      const res = await fetch(`/api/ai/briefing/${customerId}`);
      if (!res.ok) throw new Error(`서버 오류 (${res.status})`);
      const fullText = await this._readStream(res, botDiv);
      if (fullText) this.messages.push({ role: 'assistant', content: fullText });
    } catch (err) {
      botDiv.innerHTML = `<span style="color:#ff6b6b">⚠️ 브리핑 생성 실패: ${esc(err.message)}</span>`;
    }
  },

  // ── 리드 요약 (외부 호출용) ─────────────────────────────
  async summarizeLead(leadId, leadName) {
    this.open();
    this.appendUserMessage(`"${leadName}" 리드 영업 현황 요약해줘`);
    const botDiv = this.appendBotMessage('', true);
    try {
      const res = await fetch(`/api/ai/summary/${leadId}`);
      if (!res.ok) throw new Error(`서버 오류 (${res.status})`);
      const fullText = await this._readStream(res, botDiv);
      if (fullText) this.messages.push({ role: 'assistant', content: fullText });
    } catch (err) {
      botDiv.innerHTML = `<span style="color:#ff6b6b">⚠️ 요약 생성 실패: ${esc(err.message)}</span>`;
    }
  },

  // ── 회의록 요약 ──────────────────────────────────────────
  async processMeetingNotes(text, customerName) {
    const botDiv = this.appendBotMessage('', true);
    try {
      const res = await fetch('/api/ai/meeting-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, customer_name: customerName })
      });
      if (!res.ok) throw new Error(`서버 오류 (${res.status})`);
      const fullText = await this._readStream(res, botDiv);
      if (fullText) this.messages.push({ role: 'assistant', content: fullText });
    } catch (err) {
      botDiv.innerHTML = `<span style="color:#ff6b6b">⚠️ 회의록 처리 실패: ${esc(err.message)}</span>`;
    }
  },

  // ── DOM 헬퍼 ─────────────────────────────────────────────
  appendUserMessage(text) {
    const list = document.getElementById('ai-message-list');
    const div = document.createElement('div');
    div.className = 'ai-msg ai-msg-user';
    div.textContent = text;
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
    return div;
  },

  appendBotMessage(text, isStreaming = false) {
    const list = document.getElementById('ai-message-list');
    const wrap = document.createElement('div');
    wrap.className = 'ai-msg ai-msg-bot';

    const icon = document.createElement('div');
    icon.className = 'ai-bot-icon';
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a2 2 0 012 2v2h2a2 2 0 012 2v1a3 3 0 010 6v1a2 2 0 01-2 2h-2v2a2 2 0 01-4 0v-2H8a2 2 0 01-2-2v-1a3 3 0 010-6V8a2 2 0 012-2h2V4a2 2 0 012-2z"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/></svg>';

    const content = document.createElement('div');
    content.className = 'ai-msg-content';
    if (isStreaming && !text) {
      content.innerHTML = '<span class="ai-cursor">▋</span>';
    } else {
      content.innerHTML = this.renderMarkdown(text);
    }

    wrap.appendChild(icon);
    wrap.appendChild(content);
    list.appendChild(wrap);
    list.scrollTop = list.scrollHeight;
    return content;
  },

  renderMarkdown(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/^## (.+)$/gm, '<h4 class="ai-h4">$1</h4>')
      .replace(/^### (.+)$/gm, '<h5 class="ai-h5">$1</h5>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
      .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      .replace(/^(.)/gm, (m, c) => c);
  },

  clearChat() {
    this.messages = [];
    document.getElementById('ai-message-list').innerHTML = '';
    this.addWelcome();
  },

  copyLastMessage() {
    const msgs = document.querySelectorAll('.ai-msg-bot .ai-msg-content');
    if (!msgs.length) return;
    const last = msgs[msgs.length - 1].innerText;
    navigator.clipboard.writeText(last).then(() => Toast.success('복사되었습니다'));
  }
};

// ── 알림 시스템 ──────────────────────────────────────────────
const Notifications = {
  count: 0,
  items: [],

  async load() {
    try {
      const res = await API.get('/notifications');
      this.items = res.data || [];
      this.count = this.items.length;
      this.updateBadge();
    } catch (_) {}
  },

  updateBadge() {
    const badge = document.getElementById('notif-badge');
    const dot = document.querySelector('.badge-dot');
    if (badge) badge.textContent = this.count || '';
    if (dot) dot.style.display = this.count > 0 ? 'block' : 'none';
  },

  showPanel() {
    const panel = document.getElementById('notif-panel');
    if (!panel) return;
    panel.classList.toggle('show');
    if (panel.classList.contains('show')) this.renderItems(panel);
  },

  renderItems(panel) {
    if (!this.items.length) {
      panel.querySelector('.notif-list').innerHTML = '<div class="empty" style="padding:20px">알림이 없습니다</div>';
      return;
    }
    panel.querySelector('.notif-list').innerHTML = this.items.map(n => `
      <div class="notif-item" onclick="App.navigate('leads')">
        <div class="notif-icon ${n.type === '입찰마감' ? 'red' : 'amber'}">
          ${n.type === '입찰마감' ? '📋' : '⏰'}
        </div>
        <div class="notif-body">
          <div class="notif-title">${esc(n.type)}: ${esc(n.customer_name)}</div>
          <div class="notif-desc">${esc(n.project_name)}</div>
          <div class="notif-date">마감: ${Fmt.date(n.due_date)}</div>
        </div>
      </div>
    `).join('');
  }
};

// ── 퀵 액션 패널 ────────────────────────────────────────────
const QuickActions = [
  { label: '주간 보고서', icon: '📊', action: () => { AI.open(); AI.streamReport('weekly'); } },
  { label: '파이프라인 분석', icon: '🔍', action: () => { AI.open(); document.getElementById('ai-input').value = '현재 파이프라인 분석해줘'; AI.send(); } },
  { label: '수주 리스크', icon: '⚠️', action: () => { AI.open(); document.getElementById('ai-input').value = '수주 가능성이 낮거나 리스크가 있는 리드 알려줘'; AI.send(); } },
  { label: '다음 액션', icon: '🎯', action: () => { AI.open(); document.getElementById('ai-input').value = '이번 주 영업팀이 집중해야 할 액션 아이템 알려줘'; AI.send(); } }
];
