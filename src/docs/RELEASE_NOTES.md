# 📦 릴리즈 노트 (Release Notes)

> **프로젝트**: OCI CRM AI

---

## v5.4 (2026.05.23) — 현재 ⭐

### 🎯 메인 — **제안 모듈 Phase 9: UX 개선 + 임시 제안 + Word 다운로드**

사용자 피드백 5건 반영 — 워크플로우 효율화 + 산출물 품질 개선.

#### 1. 🐛 입력값 보존 버그 fix (Phase 9-1)
**증상**: 필수값(제안명/고객사/제안일) 미입력 후 [저장] 시 그동안 입력한 다른 필드(예상금액/리드/견적 등)가 모두 초기화됨
**원인**: `_save()` 검증 실패 시 `_renderActiveTab(e)` 호출 → DOM 전체 재렌더 → 사용자 입력 손실
**Fix**: 재렌더 제거 + 해당 input 으로 포커스 + scrollIntoView 만 수행 → 입력값 100% 보존

#### 2. 🤖 RFP 파일 행 [🤖] 아이콘 제거 (Phase 9-1)
- 통합 [🤖 AI 분석] 버튼으로 일원화 (RFP 섹션 하단)
- 파일 행 작업 컬럼 = 다운로드 + 삭제만 (단순화)

#### 3. 📋 AI 분석 → 고객사명 자동 채움 (Phase 9-1)
**기존**: 제안명/예상금액/통화만 자동 채움
**개선**: + **고객사명 (Phase 9-1 신규)** + 제안일/제출기한 force 덮어쓰기
- 백엔드: `analyzeProposalRFP` 응답에 `customer_name` 필드 추가 (Gemini 프롬프트 + responseSchema)
- 프론트: AI 분석 클릭 = "AI 결과 우선" 의미 → 모든 항목 force 덮어쓰기 (사용자가 다시 수정 가능)

#### 4. ✏️ [+제안등록] = 임시 제안 자동 생성 (Phase 9-2)
**기존 흐름**: [+제안등록] → 빈 폼 → 사용자가 모든 정보 입력 후 [저장]
**개선 흐름**: [+제안등록] → **임시 제안 자동 생성** (`P-YYYY-NNNN` 자동 채번) → 즉시 편집 모드 진입 → RFP 업로드 → [🤖 AI 분석] → 폼 자동 채움 → 검토 → [저장]

- 모달 타이틀: `✏️ 새 제안 작성 — P-2026-NNNN`
- 모든 탭 즉시 활성 (RFP 업로드 / AI 분석 / 평가 / 발송 모두 가능)
- **[닫기]** 시 자동 정리:
  - RFP/AI 자료 없으면 자동 DELETE (silent)
  - 있으면 confirm: "업로드한 RFP 파일 및 AI 분석 결과가 함께 삭제됩니다"

#### 5. 📄 미리보기 → Word(.docx) 다운로드 (Phase 9-3)
**기존**: [👁️ 미리보기] — 단순 markdown → HTML 렌더 (사용자 가치 낮음)
**개선**: **[📄 Word 다운로드]** — docx 파일 즉시 내려받기 (의미있는 산출물)

- 신규 endpoint: `GET /api/proposals/:id/ai-strategy/word`
- `docx@9.6.1` 사용 (npm 의존성 추가 없음)
- 표지 (제안번호/제안명/고객사/분석 일시) + 본문 (헤딩/불릿/체크박스)
- 폰트: 맑은 고딕 (한국어 안전)
- 파일명: `P-YYYY-NNNN_AI제안전략요약_YYYYMMDD.docx`
- Content-Disposition RFC 5987 한글 파일명 인코딩

#### 6. 📚 문서 갱신 (Phase 9-4)
- `USER_MANUAL.md` — 제안 모듈 신규 워크플로우 ([+제안등록] = 임시 제안)
- `API_DOCUMENTATION.md` — §21.4 customer_name 신규 필드 + §21.6 Word 다운로드 endpoint 명세
- `RELEASE_NOTES.md` (현재 파일)

### 🛠 기술 변경

- **DB 스키마 변경 없음** — `customer_name` 은 응답 schema 만 확장, Word 다운로드는 endpoint 추가만
- **신규 npm 의존성 0개** — `docx@9.6.1` 이미 설치됨
- **변경 파일**:
  - `src/services/gemini.js` — customer_name 추가 (프롬프트 + responseSchema + post-normalize)
  - `src/routes/proposals.js` — `GET /:id/ai-strategy/word` endpoint 신규
  - `public/js/api.js` — `aiStrategyWordUrl(id)` helper
  - `public/js/pages/proposals.js` — `_isTempProposal` 플래그 + `_closeAndCleanup()` + Word 다운로드 + customer_name 자동채움 + 입력값 보존 fix + [🤖] 버튼 제거
  - `tests/proposals.test.mjs` — customer_name 어설션 + Word 다운로드 시나리오 (+1)
  - `e2e/proposals.spec.js` — Phase 9-2 임시 제안 시나리오 갱신

### 📊 회귀 테스트
- vitest: **44/44 (proposals) 통과** (Word 다운로드 +1 신규)
- e2e: Phase 9-2 임시 제안 시나리오 격리 통과 (10.4s)
- lint: 0 errors / 0 warnings

### 🚀 운영 배포
```bash
cd ~/oci-ai && git pull origin master && pm2 restart oci-ai --update-env
```
- DB 스키마 변경 없음 — 마이그레이션 불필요
- 기존 데이터 100% 호환

---

## v5.3 (2026.05.23) — 이전

### 🎯 메인 — **제안 모듈 Phase 8: 통합 워크플로우 + 수주확률 예측**

영업 사원의 클릭 수를 절반으로 줄이고, 수주 가능성을 한 눈에 확인하는 핵심 개선.

#### 1. 🤖 RFP → 폼 자동 채움 (Phase 8-A)

기존: RFP 분석 → 결과를 수동으로 폼에 옮겨 입력 → 별도 탭에서 전략 작성
**개선**: RFP 업로드 → [🤖 AI 분석] **한 번 클릭으로 모든 항목 자동 채움**

`analyzeProposalRFP` 응답 schema 확장:
- 기존: RFP 메타 (4종) + 5섹션 마크다운
- **신규**: + **제안명** + **예상금액** + **통화** + **6섹션 마크다운**
  - 제안 목표 / 제안 주요 일정 / 제안 핵심사항 / 제안 준비사항 (체크리스트) / 예상 리스크 / 독소조항과 회피방안

#### 2. 📊 수주확률 + 정성 메트릭 (Phase 8-B)

기존: AI 평가 = RFP 커버율(정량) + 충족/누락/개선 코칭만
**개선**: + **수주확률 예측** + **정성 메트릭 5종** + **승리/리스크 요인**

`evaluateProposalAgainstRFP` 응답 schema 확장:
- `win_probability` (0-100): 예상 수주확률
- `quality_metrics` (각 0-10): 명확성/완결성/차별성/실현가능성/가격경쟁력
- `win_factors[]` 최대 5건: 강점 (각 100자)
- `risk_factors[]` 최대 5건: 약점 (각 100자)

#### 3. 🎨 3-탭 UI 통합 (Phase 8-C)

기존: 4-탭 (기본+RFP / AI 전략 / 자료&견적 / 발송&이력)
**개선**: 3-탭 (기본정보 / 자료&견적 / 발송&이력) — AI 탭 제거 + 기본탭 통합

- **기본정보 탭**: ① RFP 등록 섹션 (상단) → ② 제안 기본정보 (자동 채움) → ③ AI 제안전략 요약 6섹션 (편집 가능 textarea + 미리보기 + 복사)
- 비고 필드 폐지 → AI 제안전략 요약으로 통합
- 워크플로우: RFP 업로드 → 클릭 1번 → 모달 닫지 않고 검토 → [저장]

#### 4. 🎯 수주확률 카드 + 정성 메트릭 시각화 (Phase 8-D)

- **🎯 수주확률 대형 게이지**: 70%+ 녹색 / 40-69% 황색 / 0-39% 적색 + 높음/보통/낮음 배지
- **📈 정성 메트릭 5바**: 명확성/완결성/차별성/실현가능성/가격경쟁력 (0-10점)
- **✅ 승리 요인 + ⚠️ 리스크 요인 좌우 2-칼럼**
- 자료&견적 탭 = **3섹션 명확 분리** (📦 자료 / 📊 AI 평가 / 💰 견적)

### 🛠 기술 변경

- **DB 스키마 변경 없음** — 응답 schema 만 확장 (기존 컬럼 그대로 사용)
- **신규 npm 의존성 0개** — Gemini responseSchema 강화 + frontend CSS 132줄
- **변경 파일**:
  - `src/services/gemini.js` (+117 / -10): RFP_ANALYSIS_PROMPT + PROPOSAL_EVAL_PROMPT + responseSchema + 후처리 정규화
  - `public/js/pages/proposals.js` (+335 / -145): TABS 3개 + `_renderAiStrategySection` + `_renderEvalResult` 확장
  - `public/css/styles.css` (+132): 수주확률 카드, 정성 메트릭, 승리/리스크 요인
  - `tests/proposals.test.mjs` (+6): Phase 8-A 신규 필드 어설션
  - `e2e/proposals.spec.js` (+118 / -27): 3탭 검증 + 수주확률 어설션 + 안정성 보강
  - `playwright.config.js` (+2): test timeout 30s → 60s

### 📊 회귀 테스트
- vitest: **43/43 (proposals) / 375/375 전체 통과**
- e2e: 격리 실행 모두 통과 (4-C / 8-C / 6-C 평가 카드)
- lint: 0 errors / 0 warnings

### 💰 비용 통제
- 응답 schema 확장만 — 추가 API 호출 없음
- 기존 confirm 다이얼로그 그대로 (사용자 의식 클릭)
- 평균 1회 분석/평가: 300-500원 (Gemini Pro)

### 📚 문서 갱신
- `USER_MANUAL.md` — 제안 모듈 3-탭 워크플로우 갱신
- `API_DOCUMENTATION.md` — §21.4 + §21.5 Phase 8-A/B 신규 필드 명세
- `RELEASE_NOTES.md` (현재 파일)

### 🚀 운영 배포
```bash
cd ~/oci-ai && git pull origin master && pm2 restart oci-ai --update-env
```
- DB 스키마 변경 없음 — 마이그레이션 불필요
- 기존 데이터 호환 (신규 필드는 nullable / fallback 처리)

---

## v5.2 (2026.05.21~22) — 이전

### 🎯 메인 — **제안 모듈 (Proposals) 완성 + AI 평가 신기능**

영업 워크플로우의 마지막 퍼즐 — RFP 분석부터 평가/발송까지 통합.

#### 1. 📝 제안 모듈 (Phase 1-3) — 기본 인프라
- `proposals` 메인 + `proposal_files / revisions / history / email_logs` 신규 테이블
- 자동 채번 `P-YYYY-NNNN` (트랜잭션 보호)
- 상태 워크플로우 (draft / review / ready / sent / accepted / rejected / expired)
- 영업리드 / 견적 Combobox 자동 연결
- 파일 업로드/다운로드/삭제 + 리비전 + 감사 추적

#### 2. 🤖 AI RFP 분석 (Phase 4)
- **Gemini 2.5 Pro Multimodal** — PDF/이미지/텍스트 직접 분석
- 자동 추출: 제목 / 접수일 / 제출마감일 / RFP 요약
- B2B 제안 전략 마크다운 자동 생성 (5섹션)
- 드롭존 + 다중 파일 업로드 (drag & drop)
- 결과 검토 후 명시적 [저장] (자동 저장 X — 환각 방지)
- 비호환 형식 (PPT/DOC/HWP) 명확한 안내

#### 3. 📨 이메일 발송 (Phase 5-A/B) — Gmail OAuth
- 기존 `sendMessage` 영향 없이 `sendMessageWithAttachments` 신규
- multipart/mixed + RFC 2047 한글 안전
- 합계 25MB 한도 + 파일 소유 검증
- `proposal_email_logs` 자동 기록 (sending → sent / failed)
- 자동 템플릿 (고객/제안명/번호 자동 채움)

#### 4. 🔗 외부 공유 링크 (Phase 5-C/E)
- `crypto.randomBytes(32)` → base64url 토큰 (43자)
- 만료일 선택 (7/14/30일/무제한) + 재발급 + 무효화
- 외부 페이지 `proposal-share.html` — 단독 디자인 (사이드바/로그인 없음)
- **최소 정보 노출** — 가격/AI 전략/리드/이메일 이력 미노출
- `include_in_email=1` 파일만 다운로드 가능
- 인쇄 친화 (`@media print`)

#### 5. 🎨 4-탭 UI 통합 (Phase 6-A)
- 7-탭 → 4-탭으로 인지 부하 감소
- 📋 기본+RFP / 🤖 AI / 📦 자료+견적 / 📤 발송+이력
- 기존 렌더 함수 그대로 보존 (롤백 가능)
- 백엔드 / API / DB 변경 없음

#### 6. 📊 🆕 **AI 제안서 평가** (Phase 6-B/C) — 핵심 신기능
**RFP 와 제안서를 Gemini 가 동시 분석** → 평가위원 입장에서:
- **RFP 커버율** (0-100점, 정량 평가)
- **충족 요구사항** — RFP 의 어떤 요구사항이 제안서 어디에 응답됐는지
- **누락/부족 항목** — severity (high/medium/low) + 보완 제안
- **개선 제안** — 섹션별 구체 코칭
- **종합 평가** — 마크다운 (강점/보완/권장 액션)

신규 테이블 `proposal_evaluations` (다중 버전 비교 가능).

#### 7. 🐛 버그 fix (작업 중 발견 + 해결)
- proposal_date ISO 8601 SQL 오류 (탭 전환 시)
- RFP 한글 파일명 깨짐 (latin1 → utf8)
- AI 분석 비호환 형식 명확한 안내

### 🛠 기술 변경
- **신규 npm 의존성 0개** — Gemini SDK / HTML5 native API / Node crypto 만 사용
- **신규 테이블 6개**: `proposals`, `proposal_files`, `proposal_revisions`, `proposal_history`, `proposal_email_logs`, `proposal_evaluations`
- **신규 API endpoint** (15+건):
  - `/api/proposals` CRUD + 채번 + 상태
  - `/api/proposals/:id/rfp` `/files` `/revisions` (업로드/관리)
  - `/api/proposals/:id/rfp/analyze` `/evaluate` `/evaluations` (AI)
  - `/api/proposals/:id/email/send` (Gmail 발송)
  - `/api/proposals/:id/share` (공유 토큰)
  - `/api/proposals/share/:token` (인증 우회, 외부 접근)
- **신규 파일**: `src/services/gemini.js` (helper 2개 추가) / `src/routes/proposalShare.js` / `public/proposal-share.html` / `public/js/pages/proposal-share.js`

### 📊 회귀 테스트
- vitest: **368 테스트 / 32 파일 모두 통과** (Phase 6 전체 +10 신규)
- e2e: `e2e/proposals.spec.js` **12/12 통과** (Phase 6 +4 신규)
- lint: 0 errors / 0 warnings
- npm audit: critical/high 0건 (moderate 7건 — exceljs 의존성, 영향 미미)

### 🔒 보안
- AI 호출 — 호환 형식 화이트리스트 + 30MB 한도 + API 키 검증
- 공유 링크 — 토큰 길이 검증 + 만료 + `include_in_email` 화이트리스트
- 파일 업로드 — 다른 제안 file_id 첨부 차단 (소유 검증)
- 자동 채번 / 트랜잭션 보호 / FK CASCADE

### 💰 비용 통제
- AI 호출 — confirm 다이얼로그 2종 (첫 호출 / 덮어쓰기) + 비용 안내
- `ai_usage` 테이블 — endpoint 별 토큰 사용량 자동 기록
  - `proposal_rfp_analyze`
  - `proposal_evaluate`
- 평균 1회 분석/평가: 300-500원 (Gemini Pro)

### 📚 문서 갱신
- `USER_MANUAL.md` — 제안 모듈 섹션 + FAQ Q11/Q12 추가
- `API_DOCUMENTATION.md` — 견적 (§20) + 제안 (§21) 신규 섹션
- `RELEASE_NOTES.md` (현재 파일)

### 🚀 운영 배포
```bash
cd ~/oci-ai && git pull origin master && pm2 restart oci-ai --update-env
```
- 신규 테이블 자가 마이그레이션 자동 실행
- 별도 SQL 실행 불필요

---

## v5.0 (2026.05) — 이전

### 🎯 주요 변경

#### 1. Configuration Management 시스템 (납품 안정성)
- **Configuration Preset** 3개 패키지 (Minimal / Standard / Premium)
- **Circuit Breaker** — 클라이언트 API 가드 (네트워크 절약)
- **Cron + WebSocket 가드** — 백그라운드 토글 차단
- **Graceful Degradation** — 토글 OFF 시 친절한 UI 안내

#### 2. 기능 토글 시스템 (33개)
- 매니페스트 자동 동기화 (src/data/featureRegistry.js — SSOT)
- Backend featureGuard 미들웨어 (11개 라우트)
- Audit log + 의존성 검증
- UI 검색/정렬/접기/변경이력

#### 3. 리포트 빌더 (Drag & Drop)
- 사용자 정의 리포트 — 차원/지표 드래그
- 자동 차트 추천 (Bar/Pie/Line/Stacked)
- 본인 리포트 저장/공유 준비

#### 4. 로고 관리 + 자동 최적화
- 사이드바 좌측 상단 커스텀 로고
- Sharp + svgo 자동 최적화 (trim, sanitize)
- Magic Bytes 검증 + Image Bomb 방어
- Server-Side Inject (Flash 제거)

#### 5. 다크모드 완성
- 모든 페이지 다크모드 대응
- CSS 변수 일원화 (`--surface` 등)
- FullCalendar, Quill 에디터, FAQ 등 보강

#### 6. 개발 산출물 19종
- SRS, 화면설계서, 프로그램명세서, DB명세서, ERD
- 사용자매뉴얼, API 명세, 설치/배포/운영 가이드
- 보안 가이드, 테스트 계획서, 릴리즈노트, 변경이력

### 🛠 기술 변경
- 신규 의존성: `sharp`, `svgo`
- 신규 테이블: `report_definitions`, `dev_features_audit`
- 신규 컬럼: `dev_features` (risk_level, required_features, is_deprecated, ...)

### 📊 회귀 테스트
- vitest: 28 파일 / 284 테스트 모두 통과
- ESLint: 0 errors, 0 warnings

---

## v4.5 (2026.Q2) — Gmail G3 + 다크모드

### 추가
- Gmail Phase G1 + G2 + G3 (읽기 + 발송 + 백그라운드 동기화)
- 다크모드 (회의록 페이지 흰색 배경 충돌 해소)

### 수정
- OAuth invalid_grant 친절 처리
- popup 자동 닫힘 (CSP 우회)
- customers.email 컬럼 매칭 버그

---

## v4.0 (2026.Q1) — PWA Phase 1~3

### 추가
- PWA Manifest + Service Worker + offline.html
- 모바일 UX (햄버거, 16px 폰트, 페이지 타이틀)
- 오프라인 회의록 녹음 (IndexedDB 큐)
- Service Worker 캐시 자동 갱신

---

## v3.5 (2026.Q1) — STT 비동기 (120분)

### 추가
- POST /api/meetings/transcribe-async + 폴링
- sttJobs (in-memory 큐 + 25분 watchdog)
- Gemini Files API 통합 (10MB+ 파일)

### 수정
- 504 Gateway Timeout 해결
- Route-level timeout 15분

---

## v3.0 (2025.Q4) — 다국어 + 워드 사전

### 추가
- 한/영/일/중 4개 언어
- admin_labels 테이블 + 워드 사전 UI
- data-label / data-title-label 마커

---

## v2.0 (2025.Q3) — AI 어시스턴트 + STT

### 추가
- Gemini 2.5 Flash/Pro 통합
- AI 챗봇 SSE 스트리밍
- 고객사 AI 브리핑
- 회의록 STT + AI 요약
- AI 토큰 관리 + 자동충전

---

## v1.0 (2025.Q1) — 기본 CRM

### 추가
- 영업 리드 8단계 파이프라인
- 고객사/프로젝트/활동 이력
- 캘린더 + Google Meet
- 5단계 RBAC
- JWT + 2FA + WebAuthn

---

## 🚀 향후 로드맵

### Phase 5 (단기, 3개월)
- G4 Outlook 통합 (Microsoft Graph)
- Web Push 알림
- ESLint custom rule (매니페스트 누락 검증)

### Phase 6 (중기, 6개월)
- Redis 분산 큐 + WebSocket pub/sub
- Native 모바일 앱 (Capacitor/React Native)
- AI Voice Assistant

### Phase 7 (장기, 1년+)
- Multi-tenancy (고객사별 독립 설정)
- BI 도구 연동 (Tableau, Power BI)
- 온프레미스 패키지

---

## 📎 마이너 릴리즈

각 마이너 변경은 [CHANGELOG.md](./CHANGELOG.md) 에서 git commit 기반 timeline 확인.
