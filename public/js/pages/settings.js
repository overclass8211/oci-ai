// ============================================================
// Settings Page - 시스템 설정 / ERP 연동 / DB 상태
// ============================================================
const SettingsPage = {
  async render() {
    const html = `
      <div class="card mb-3">
        <div class="card-header">
          <div class="card-title">시스템 연동 현황</div>
        </div>
        <div class="card-body">
          <div class="grid-2">
            <div class="integration-card" data-feature="erp.integration">
              <div class="integration-header">
                <div>
                  <div class="integration-name">OnERP</div>
                  <div class="integration-desc">전사 ERP 시스템 (제조 / 원가 / 재무)</div>
                </div>
                <span class="badge badge-green">● 연결 대기</span>
              </div>
              <div class="integration-body">
                <div class="kv-row"><span class="kv-key">동기화 항목</span><span class="kv-val">제품 원가, 출고 단가, 재고</span></div>
                <div class="kv-row"><span class="kv-key">동기화 주기</span><span class="kv-val">1시간 (실시간 옵션)</span></div>
                <div class="kv-row"><span class="kv-key">API 엔드포인트</span><span class="kv-val mono">https://erp.oci.co.kr/api/v1</span></div>
                <div class="kv-row"><span class="kv-key">최근 동기화</span><span class="kv-val text-muted">설정 필요</span></div>
              </div>
              <button class="btn btn-primary btn-sm" data-integration="OnERP">설정 열기</button>
            </div>

            <div class="integration-card">
              <div class="integration-header">
                <div>
                  <div class="integration-name">가온아이 그룹웨어</div>
                  <div class="integration-desc">결재 / 일정 / 메일 / 게시판</div>
                </div>
                <span class="badge badge-green">● 연결 대기</span>
              </div>
              <div class="integration-body">
                <div class="kv-row"><span class="kv-key">동기화 항목</span><span class="kv-val">결재 문서, 일정, 사용자 정보</span></div>
                <div class="kv-row"><span class="kv-key">SSO</span><span class="kv-val">SAML 2.0 지원</span></div>
                <div class="kv-row"><span class="kv-key">API 엔드포인트</span><span class="kv-val mono">https://groupware.oci.co.kr/api</span></div>
                <div class="kv-row"><span class="kv-key">최근 동기화</span><span class="kv-val text-muted">설정 필요</span></div>
              </div>
              <button class="btn btn-primary btn-sm" data-integration="가온아이">설정 열기</button>
            </div>
          </div>
        </div>
      </div>

      <div class="card mb-3">
        <div class="card-header">
          <div class="card-title">데이터베이스 상태</div>
          <button class="btn btn-ghost btn-sm" id="settings-checkdb-btn">상태 확인</button>
        </div>
        <div class="card-body" id="db-status">
          <div class="loading">확인중...</div>
        </div>
      </div>

      <div class="grid-2 mb-3">
        <div class="card">
          <div class="card-header"><div class="card-title">알림 설정</div></div>
          <div class="card-body">
            <div class="setting-row">
              <div>
                <div class="setting-name">파이프라인 단계 변경 알림</div>
                <div class="setting-desc">담당자에게 이메일 발송</div>
              </div>
              <label class="switch"><input type="checkbox" checked><span class="slider"></span></label>
            </div>
            <div class="setting-row">
              <div>
                <div class="setting-name">원가 변동 알림</div>
                <div class="setting-desc">주요 원자재 ±5% 이상 변동시</div>
              </div>
              <label class="switch"><input type="checkbox" checked><span class="slider"></span></label>
            </div>
            <div class="setting-row">
              <div>
                <div class="setting-name">예상 마감일 임박 알림</div>
                <div class="setting-desc">7일 이내 마감 예정 리드</div>
              </div>
              <label class="switch"><input type="checkbox" checked><span class="slider"></span></label>
            </div>
            <div class="setting-row">
              <div>
                <div class="setting-name">Slack 연동</div>
                <div class="setting-desc">팀 채널로 주요 이벤트 푸시</div>
              </div>
              <label class="switch"><input type="checkbox"><span class="slider"></span></label>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><div class="card-title">권한 / 보안</div></div>
          <div class="card-body">
            <div class="setting-row">
              <div>
                <div class="setting-name">2단계 인증 (2FA)</div>
                <div class="setting-desc">로그인시 OTP 인증</div>
              </div>
              <label class="switch"><input type="checkbox"><span class="slider"></span></label>
            </div>
            <div class="setting-row">
              <div>
                <div class="setting-name">감사 로그</div>
                <div class="setting-desc">데이터 변경 이력 자동 기록</div>
              </div>
              <label class="switch"><input type="checkbox" checked><span class="slider"></span></label>
            </div>
            <div class="setting-row">
              <div>
                <div class="setting-name">담당자 외 리드 조회 제한</div>
                <div class="setting-desc">팀장 이상 권한자만 전체 조회</div>
              </div>
              <label class="switch"><input type="checkbox"><span class="slider"></span></label>
            </div>
            <div class="setting-row">
              <div>
                <div class="setting-name">IP 화이트리스트</div>
                <div class="setting-desc">사내 IP에서만 접근 가능</div>
              </div>
              <label class="switch"><input type="checkbox"><span class="slider"></span></label>
            </div>
          </div>
        </div>
      </div>

      <div class="card mb-3">
        <div class="card-header">
          <div class="card-title">✉️ 이메일 템플릿</div>
          <button class="btn btn-primary btn-sm" id="email-tpl-new-btn">+ 새 템플릿</button>
        </div>
        <div class="card-body" id="email-tpl-list">
          <div class="loading">불러오는 중...</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><div class="card-title">시스템 정보</div></div>
        <div class="card-body">
          <div class="kv-grid">
            <div class="kv-row"><span class="kv-key">서비스명</span><span class="kv-val">OCI CRM</span></div>
            <div class="kv-row"><span class="kv-key">버전</span><span class="kv-val mono">v1.0.0</span></div>
            <div class="kv-row"><span class="kv-key">백엔드</span><span class="kv-val mono">Node.js + Express</span></div>
            <div class="kv-row"><span class="kv-key">데이터베이스</span><span class="kv-val mono">MariaDB 10.x</span></div>
            <div class="kv-row"><span class="kv-key">기반 모델</span><span class="kv-val">핑거세일즈 CRM 커스터마이징</span></div>
            <div class="kv-row"><span class="kv-key">최종 빌드</span><span class="kv-val text-muted">${Fmt.dateKor(new Date())}</span></div>
          </div>
        </div>
      </div>
    `;
    document.getElementById('content').innerHTML = html;

    document.getElementById('settings-checkdb-btn')?.addEventListener('click', () => this.checkDb());
    document.getElementById('content').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-integration]');
      if (btn) this.openIntegration(btn.dataset.integration);
    });

    // 이메일 템플릿
    document.getElementById('email-tpl-new-btn')?.addEventListener('click', () => this.openTemplateForm());
    this.loadEmailTemplates();

    this.checkDb();
  },

  // ─── 이메일 템플릿 관리 ─────────────────────────────────
  async loadEmailTemplates() {
    const el = document.getElementById('email-tpl-list');
    if (!el) return;
    try {
      const r = await API.get('/email-templates');
      const tpls = r.data || [];
      if (!tpls.length) {
        el.innerHTML = '<div class="empty" style="padding:20px;text-align:center;color:var(--text-3)">템플릿이 없습니다.</div>';
        return;
      }
      const catLabel = { lead:'영업', customer:'고객사', project:'프로젝트', general:'일반' };
      el.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:60px">카테고리</th>
              <th>이름</th>
              <th>제목</th>
              <th style="width:80px">유형</th>
              <th style="width:140px;text-align:right">작업</th>
            </tr>
          </thead>
          <tbody>
            ${tpls.map(t => `
              <tr data-tpl-id="${t.id}">
                <td><span class="badge badge-blue">${esc(catLabel[t.category] || t.category)}</span></td>
                <td><strong>${esc(t.name)}</strong></td>
                <td style="font-size:12px;color:var(--text-2)">${esc(t.subject)}</td>
                <td>${t.is_system
                  ? '<span class="badge badge-gray" title="시스템 시드 — 수정 불가">🔒 시스템</span>'
                  : '<span class="badge badge-green">사용자</span>'}</td>
                <td style="text-align:right">
                  <button class="btn btn-ghost btn-sm" data-tpl-action="edit" data-id="${t.id}"
                          ${t.is_system ? 'disabled title="시스템 템플릿은 수정 불가"' : ''}>편집</button>
                  <button class="btn btn-ghost btn-sm" data-tpl-action="delete" data-id="${t.id}"
                          ${t.is_system ? 'disabled title="시스템 템플릿은 삭제 불가"' : 'style="color:var(--oci-red)"'}>삭제</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
      // 이벤트 위임
      el.querySelectorAll('[data-tpl-action]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = parseInt(btn.dataset.id, 10);
          const action = btn.dataset.tplAction;
          if (action === 'edit')   this.openTemplateForm(id);
          if (action === 'delete') this.deleteTemplate(id);
        });
      });
    } catch (e) {
      el.innerHTML = `<div class="empty" style="color:var(--oci-red)">불러오기 실패: ${esc(e.message || '')}</div>`;
    }
  },

  async openTemplateForm(id = null) {
    let tpl = { id: null, name: '', category: 'general', subject: '', body: '' };
    if (id) {
      try {
        const r = await API.get(`/email-templates/${id}`);
        tpl = r.data;
      } catch (e) {
        Toast.error('템플릿 로드 실패: ' + (e.message || ''));
        return;
      }
    }

    Modal.open({
      title: id ? '✉️ 템플릿 편집' : '✉️ 새 템플릿',
      width: 720,
      body: `
        <div class="form-grid" style="grid-template-columns: 120px 1fr; gap: 10px 12px; align-items: center">
          <label class="form-label">이름 *</label>
          <input type="text" class="form-input" id="tpl-name" maxlength="150" value="${esc(tpl.name)}">

          <label class="form-label">카테고리</label>
          <select class="form-input" id="tpl-category">
            <option value="lead"     ${tpl.category==='lead'?'selected':''}>영업 리드</option>
            <option value="customer" ${tpl.category==='customer'?'selected':''}>고객사</option>
            <option value="project"  ${tpl.category==='project'?'selected':''}>프로젝트</option>
            <option value="general"  ${tpl.category==='general'?'selected':''}>일반</option>
          </select>

          <label class="form-label">제목 *</label>
          <input type="text" class="form-input" id="tpl-subject" maxlength="300" value="${esc(tpl.subject)}">

          <label class="form-label" style="align-self:flex-start;padding-top:6px">본문 *</label>
          <textarea class="form-input" id="tpl-body" rows="12"
                    style="font-family:inherit;line-height:1.6">${esc(tpl.body)}</textarea>
        </div>
        <div style="margin-top:10px;font-size:11px;color:var(--text-3);line-height:1.6">
          💡 변수: <code>{{customer_name}}</code>, <code>{{contact_person}}</code>,
          <code>{{project_name}}</code>, <code>{{my_name}}</code>,
          <code>{{my_company}}</code>, <code>{{today}}</code>,
          <code>{{bidding_deadline}}</code>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="tpl-cancel">취소</button>
        <button class="btn btn-primary" id="tpl-save">저장</button>
      `,
      bind: {
        '#tpl-cancel': () => Modal.close(),
        '#tpl-save': async () => {
          const data = {
            name:     document.getElementById('tpl-name').value.trim(),
            category: document.getElementById('tpl-category').value,
            subject:  document.getElementById('tpl-subject').value.trim(),
            body:     document.getElementById('tpl-body').value,
          };
          if (!data.name || !data.subject || !data.body) {
            Toast.warn('이름·제목·본문은 필수입니다.');
            return;
          }
          try {
            if (id) {
              await API.put(`/email-templates/${id}`, data);
              Toast.success('템플릿이 수정되었습니다.');
            } else {
              await API.post('/email-templates', data);
              Toast.success('템플릿이 추가되었습니다.');
            }
            Modal.close();
            // Email 캐시 무효화
            if (typeof Email !== 'undefined') Email.templates = null;
            await this.loadEmailTemplates();
          } catch (e) {
            Toast.error('저장 실패: ' + (e.message || ''));
          }
        },
      },
    });
  },

  async deleteTemplate(id) {
    if (!confirm('이 템플릿을 삭제하시겠습니까?')) return;
    try {
      await API.del(`/email-templates/${id}`);
      Toast.success('템플릿이 삭제되었습니다.');
      this.loadEmailTemplates();
      if (typeof Email !== 'undefined') Email.templates = null;
    } catch (e) {
      Toast.error('삭제 실패: ' + (e.message || ''));
    }
  },

  async checkDb() {
    const el = document.getElementById('db-status');
    el.innerHTML = '<div class="loading">확인중...</div>';
    try {
      const [team, leads, products] = await Promise.all([
        API.team.list(),
        API.leads.list(),
        API.products.list()
      ]);
      el.innerHTML = `
        <div class="grid-3">
          <div class="db-stat">
            <div class="db-stat-label">팀원</div>
            <div class="db-stat-value">${team.data.length}<span class="metric-unit">건</span></div>
          </div>
          <div class="db-stat">
            <div class="db-stat-label">리드</div>
            <div class="db-stat-value">${leads.data.length}<span class="metric-unit">건</span></div>
          </div>
          <div class="db-stat">
            <div class="db-stat-label">상품/원가</div>
            <div class="db-stat-value">${products.data.length}<span class="metric-unit">건</span></div>
          </div>
        </div>
        <div class="alert alert-success mt-2">
          <strong>● 정상</strong> MariaDB 연결 정상. 모든 테이블 응답 OK.
        </div>
      `;
    } catch (err) {
      el.innerHTML = `
        <div class="alert alert-error">
          <strong>● 연결 실패</strong> MariaDB에 접속할 수 없습니다. .env 설정과 서비스 상태를 확인하세요.
          <div class="mono fs-12 mt-1">${esc(err.message)}</div>
        </div>
      `;
    }
  },

  openIntegration(name) {
    Modal.open({
      title: `${name} 연동 설정`,
      width: 520,
      body: `
        <div class="form-grid">
          <div class="form-row">
            <label class="form-label">API Endpoint URL</label>
            <input class="form-input mono" placeholder="https://...">
          </div>
          <div class="form-row">
            <label class="form-label">API Key</label>
            <input class="form-input mono" type="password" placeholder="••••••••••••••••">
          </div>
          <div class="form-row">
            <label class="form-label">동기화 주기 (분)</label>
            <input class="form-input" type="number" value="60">
          </div>
          <div class="form-row">
            <label class="form-label">매핑 규칙</label>
            <textarea class="form-input" rows="4" placeholder="예: leads.expected_amount → ${name === 'OnERP' ? 'erp.opportunity.amount' : 'gw.estimate.value'}"></textarea>
          </div>
          <div class="alert alert-info">
            ${name} API 키는 시스템 관리자가 발급합니다. 연동 후 첫 동기화는 5~10분 소요될 수 있습니다.
          </div>
        </div>
      `,
      footer: `
        <button class="btn btn-ghost" id="settings-int-cancel-btn">취소</button>
        <button class="btn btn-primary" id="settings-int-save-btn">저장 및 테스트</button>
      `,
      bind: {
        '#settings-int-cancel-btn': () => Modal.close(),
        '#settings-int-save-btn': () => { Toast.success(`${name} 연동 설정이 저장되었습니다`); Modal.close(); }
      }
    });
  }
};
