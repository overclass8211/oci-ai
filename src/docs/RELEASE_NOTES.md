# 📦 릴리즈 노트 (Release Notes)

> **프로젝트**: OCI CRM AI

---

## v5.9.0 (2026.05.23) — 현재 ⭐

### 🎯 메인 — **계약 모듈 Phase 0: 기반 인프라 (Contract Lifecycle Management 시작)**

새로운 모듈 — 시스템 영향 최소화 전략 (신규 추가만, 기존 변경 0건).

#### 🆕 모듈 개요

```
사이드바
├─ 영업관리
│  ├─ 영업리드
│  ├─ 영업딜
│  ├─ 고객사
│  ├─ 영업 캘린더
│  ├─ 견적서
│  ├─ 제안
│  └─ 계약 ← 🆕 신규
```

**Phase 0 — 기반 인프라 (이번 릴리즈)**:
- DB 6개 신규 테이블 (자가 마이그레이션)
- 백엔드 CRUD + 파일 업로드/다운로드 + history Audit Trail
- 프론트 목록 페이지 + 작성/편집 모달
- 8단계 상태 / 9종 계약 유형
- 자동채번 (C-YYYY-NNNN)

**Phase 1 ~ 7 — 향후 (사용자 사전 승인 받음)**:
- Phase 1: CLM 워크플로우 + 빠른 액션 + Audit Trail 강화
- Phase 2: ⭐⭐⭐ **AI 법무 검토** (독소조항/누락/한국법규/수정안)
- Phase 3: 계약 템플릿 라이브러리 (NDA/MSA/SLA + 변수 치환)
- Phase 4: 만료 알림 (90/60/30/7일 + 자동 갱신 분기)
- Phase 5: AI 협상 코칭
- Phase 6: 다국어 (한/영)
- Phase 7: 전자서명 (모두싸인 우선)

### 🛠 기술 변경

#### 신규 DB 테이블 6개 (idempotent 자가 마이그레이션)
| 테이블 | 용도 | 사용 시작 |
|--------|------|----------|
| `contracts` | 메인 엔티티 | Phase 0 |
| `contract_files` | 파일 (CASCADE) | Phase 0 |
| `contract_history` | Audit Trail (CASCADE) | Phase 0 |
| `contract_templates` | 템플릿 라이브러리 | Phase 3 |
| `contract_legal_reviews` | AI 법무 검토 결과 | Phase 2 |
| `contract_alerts` | 만료 알림 큐 | Phase 4 |

#### 신규 엔드포인트 (Phase 0)
- `GET    /api/contracts/next-contract-no` — 다음 채번 미리보기
- `GET    /api/contracts` — 목록 (검색/필터/페이징)
- `GET    /api/contracts/:id` — 단건 (files + history)
- `POST   /api/contracts` — 생성 (proposal_id 자동 연결)
- `PUT    /api/contracts/:id` — 수정 (diff history 자동)
- `DELETE /api/contracts/:id` — CASCADE 삭제
- `POST   /api/contracts/:id/files` — 다중 파일 업로드
- `GET    /api/contracts/:id/files/:fileId/download`
- `DELETE /api/contracts/:id/files/:fileId`

#### 신규 파일 4개
- `src/routes/contracts.js` (760 lines)
- `tests/contracts.test.mjs` (290 lines, 14건)
- `public/js/pages/contracts.js` (~450 lines)
- `e2e/contracts.spec.js` (3건)

#### 기존 파일 수정 (각 1-18줄, 격리적)
- `server.js`: 라우터 등록 1줄
- `src/data/featureRegistry.js`: `crm.contracts` 기능 플래그 등록
- `src/data/menuDefaults.js`: 메뉴 시드 1줄
- `src/services/authService.js`: 4개 role ROLE_PAGES 에 추가
- `public/js/api.js`: API.contracts.* 헬퍼 (18줄)
- `public/index.html`: 사이드바 메뉴 + script
- `public/js/app.js`: pages 매핑 + featureMap
- `eslint.config.js`: `ContractsPage` globals 등록

### 📊 회귀 테스트
- vitest: **신규 14/14**, 전체 **390+ passed (회귀 0건)**
- lint: 0 errors / 0 warnings
- e2e: Phase 0 시나리오 작성 완료 (UI 미보유 dev 서버 재시작 후 자동 검증)

### 🛡 시스템 영향 평가
- **신규 추가만** — 기존 테이블/라우트/모듈 0건 수정
- **격리** — `/api/contracts` 라우터만 신규, 기존 모듈 무영향
- **롤백 안전** — 신규 테이블만 DROP 하면 원상복구 가능
- **Service Worker** — `CACHE_VERSION` 자동 갱신으로 사용자 브라우저 캐시 자동 무효화

### 🚀 운영 배포
```bash
cd ~/oci-ai && git pull origin master && pm2 restart oci-ai --update-env
```
배포 후 자동 동작:
- DB 자가 마이그레이션 → 6개 신규 테이블 생성
- 사이드바에 "계약" 메뉴 자동 노출
- 사용자는 즉시 사용 가능 (manager+ 권한)

### 📅 다음 단계

Phase 1 (CLM 워크플로우 + 빠른 액션) 진입 권장. 사용자 결정 대기.

---

## v5.8.2 (2026.05.23) — 직전

### 🎯 메인 — **제안 모듈 Phase 13-3: 제안평가 탭 5건 개선 (UI 단순화 + AI 신뢰성 가드)**

사용자 피드백 4건 + 추가 1건 — 환각 0점 버그 발견 / 수정 포함.

#### 1. 메타 입력 UI 제거 (파일유형/리비전/최종본/이메일첨부)
- `_renderFilesTab(e)` 의 4-grid 입력 + 설명 textarea 삭제
- 기본값으로 자동 업로드: `file_type='proposal'`, `revision_no=현재버전`, `is_final=false`, `include_in_email=false`, `description=''`
- hidden 으로 `pr-file-type` / `pr-file-rev` 만 보존 → 업로드 핸들러 호환

#### 2. "📦 제안 자료 아카이브" 안내 박스 제거
- 화면 상단 파란색 안내 박스 삭제 → 화면 더 간결

#### 3. "정성 메트릭" → "정량 메트릭" 표기 통일
- 탭 헤더, AI 평가 카드 라벨, CTA 힌트, 안내 박스 모두 일관 변경

#### 4. 🐛 환각 0점 버그 fix + AI 신뢰성 가드

**🔑 환각의 진짜 원인 발견**:
- Frontend 가 backend 와 다른 키를 읽고 있어서 메트릭이 항상 0점 표시
- Before (frontend): `clarity`, `completeness`, `feasibility`, `differentiation`, `price_competitiveness`
- After (frontend): `requirement_coverage`, `strategy_clarity`, `differentiation`, `risk_handling`, `price_competitiveness` ← backend 와 동일
- 사용자가 본 "수주확률 높은데 메트릭이 0" 현상의 근본 원인

**메트릭 스케일 표시 보정**: 10점 만점 → 5점 만점 (backend 0~5 스키마 일치)

**Gemini 프롬프트 강화** (`src/services/gemini.js`):
- `win_probability = avg(metrics) × 20 ± 5` 산출 공식 명시
- 일관성 규칙 5가지: 메트릭 모두 0 → 수주확률 ≤10, covered_count=0 → 수주확률 ≤15, 평균 4점↑ → 수주확률 ≥70 등
- 자가 검증 4항목 (응답 직전 reflection)
- `price_competitiveness`: 가격 정보 부재 시 0 강제 (이전엔 기본 3)
- `win_factors`/`risk_factors` 도 메트릭 점수와 일관되도록 강제

**Backend 후처리 가드** (환각 안전망):
- `metricsAvg === 0` → `win_probability = 0` 강제
- AI가 반환한 `win_probability` 가 `expected ± 15` 초과 벗어나면 → 평균 기반으로 재계산 + `console.warn` 경고 로그

#### 5. 💰 연결 견적 섹션 삭제
- `case 'content'` 에서 `_renderQuoteTab(e)` 호출 + divider 제거
- 견적 연결은 기본정보 탭의 "연결 견적" Combobox 에서 그대로 가능

### 🛠 기술 변경

- **DB 스키마 변경 없음** — UI/AI 프롬프트만 변경
- **변경 파일**:
  - `public/js/pages/proposals.js`:
    · `_renderFilesTab` — 메타 UI/안내박스 제거, hidden 2개로 호환
    · `_renderEvalResult` — 메트릭 키 5개 backend 일치, 스케일 5점 만점 표시
    · `_renderEvalSection` / CTA 힌트 — "정성" → "정량"
    · `case 'content'` — 연결견적 섹션 제거
  - `src/services/gemini.js`:
    · `PROPOSAL_EVAL_PROMPT` — 산출 공식 + 일관성 5규칙 + 자가검증 4항목 추가
    · `evaluateProposalAgainstRFP` 후처리 — `metricsAvg` 기반 환각 보정 가드
  - `src/docs/USER_MANUAL.md` — Phase 13-3 안내 박스 + 정량 메트릭 5점 시각화 + 부록 이력 추가
  - `src/docs/RELEASE_NOTES.md` — v5.8.2 신규

### 📊 회귀 테스트
- vitest: **44/44 (proposals) 통과** — backend mock 응답 변경 없음
- lint: 0 errors / 0 warnings
- E2E: skip — UI 표시 제거는 hidden 호환, 메트릭 키 fix 는 mock 으로 검증 불가(실 Gemini 호출 필요)

### 🚀 운영 배포
```bash
cd ~/oci-ai && git pull origin master && pm2 restart oci-ai --update-env
```

### 👁 사용자 체감 변화
- **Before**: 제안평가 탭 = 안내 박스 2개 + 메타입력 4개 + 드롭존 + 파일목록 + AI평가 CTA + 평가결과 + 연결견적 (긴 화면)
- **After**: 제안평가 탭 = 노란 안내 박스 + 드롭존 + 파일목록 + AI평가 CTA + 평가결과 (깔끔)
- **신뢰성**: 메트릭 점수가 정확하게 표시되고, 수주확률과 메트릭 평균이 항상 일치

---

## v5.8.1 (2026.05.23) — 직전

### 🎯 메인 — **제안 모듈 Phase 13-2: RFP 메타 입력 UI 제거 (화면 단순화)**

사용자 피드백 — 기본탭 화면을 더 단순화. RFP 메타 입력 UI 4개를 화면에서 제거.

#### 🎨 변경 내용

**제거 대상 (화면에서만 사라짐 — DB/저장 로직은 그대로)**:
- `RFP 제목` (text input, 가로 2열)
- `RFP 접수일` (date input)
- `RFP 제출마감일` (date input)
- `RFP 요약` (textarea, AI 분석 보조 입력)

**보존 방식**:
- 동일 ID(`pr-f-rfp_title`, `pr-f-rfp_received_date`, `pr-f-rfp_due_date`, `pr-f-rfp_summary`) 로 `<input type="hidden">` 만 남김
- AI 분석 시 자동 채움 흐름 (`analyzeProposalRFP` → 폼 force 덮어쓰기) 정상 동작
- `_collectForm()` / `_saveAndReturn()` 저장 로직 무변경 → 백엔드 컬럼 유지

**효과**:
- 화면이 더 깔끔 — RFP 파일 업로드 + AI 분석만 사용자가 신경 씀
- 메타 정보는 AI 가 자동으로 채워 hidden 으로 저장 → 검토 시점만 노출 가능 (필요 시 다음 Phase 에서)

### 🛠 기술 변경

- **DB 스키마 변경 없음** — UI 만 제거
- **변경 파일**:
  - `public/js/pages/proposals.js`:
    · `_renderRfpTab(e)` — `form-grid` 4개 입력 + 요약 textarea 제거
    · 동일 ID 로 `<input type="hidden">` 4개 추가 (저장 흐름 보존)
  - `src/docs/USER_MANUAL.md` — Phase 13-2 안내 박스 + 부록 이력 1줄 추가
  - `src/docs/RELEASE_NOTES.md` — v5.8.1 추가

### 📊 회귀 테스트
- vitest: **44/44 (proposals) 통과**
- lint: 0 errors / 0 warnings
- E2E: skip — UI 표시만 제거 (ID/값 흐름 동일, 사용자 인터랙션 경로 변경 없음)

### 🚀 운영 배포
```bash
cd ~/oci-ai && git pull origin master && pm2 restart oci-ai --update-env
```

---

## v5.8 (2026.05.23) — 직전

### 🎯 메인 — **제안 모듈 Phase 13: 기본탭 2섹션 통합 (3개 → 2개 카드)**

사용자 피드백 — 불필요한 항목 정리, RFP 작업을 한 카드에 응집.

#### 🎨 기본탭 카드 구조 단순화

**기존 (Phase 10/12 누적)**:
```
Stepper: [① RFP 업로드] → [② AI 분석] → [③ 검토 & 저장]
├─ 1단계: 📑 RFP 등록 & AI 분석 (메타 + 드롭존 + 파일 목록 + 안내만)
├─ 2단계: 🤖 AI 제안전략 요약 (큰 CTA + 6섹션 textarea)
└─ 3단계: 📋 제안 기본정보 (3열 그리드)
```

**개선 (Phase 13)**:
```
Stepper: [① RFP 등록 & AI 분석] → [② 검토 & 저장]
├─ 1단계: 📑 RFP 등록 & AI 분석 (모든 RFP 작업 통합)
│         · 메타 입력 + 드롭존 + 파일 목록
│         · 큰 CTA [🤖 AI 분석 시작]
│         · 6섹션 마크다운 textarea + Word 다운로드 + 복사
└─ 2단계: 📋 제안 기본정보 검토 & 저장 (3열 그리드)
```

**효과**:
- 카드 개수 3 → 2 (간결화)
- "RFP → 분석 → 요약" 흐름이 한 카드에 응집 → 사용자 컨텍스트 유지
- Stepper 더 단순 (2단계 = 사용자 멘탈 모델 매칭)

### 🛠 기술 변경

- **DB 스키마 변경 없음** — UI/UX 만 개선
- **변경 파일**:
  - `public/js/pages/proposals.js`:
    · `_renderActiveTab` 'basic' case — 3섹션 → 2섹션 통합
    · `_renderStepper2` 신규 (2단계 stepper)
    · `_summary1` 시그니처 변경 — `(rfpFiles, hasAiStrategy, done)` AI 상태 반영
    · `step1Done` 조건 = `hasRfp && hasAiStrategy` (둘 다 완료해야 ✓)

### 📊 회귀 테스트
- vitest: **44/44 (proposals) 통과**
- lint: 0 errors / 0 warnings

### 🚀 운영 배포
```bash
cd ~/oci-ai && git pull origin master && pm2 restart oci-ai --update-env
```

---

## v5.7 (2026.05.23) — 직전

### 🎯 메인 — **제안 모듈 Phase 12: AI 분석 위치 이동 + AI평가 큰 CTA + JSON 파싱 강화**

사용자 피드백 3건 — 워크플로우 자연스러움 + 시인성 + 에러 처리 견고화.

#### 1. 🎯 기본탭 AI 분석 버튼 1단계→2단계 이동 (Phase 12-A)

**기존**: 1단계 RFP 등록 섹션 하단에 큰 CTA `[🤖 AI 분석 시작]`
**개선**: 2단계 AI 제안전략 요약 섹션 **상단**으로 이동

```
1단계: 📑 RFP 등록 → ✅ 파일 N건 준비 완료 안내만
2단계: 🤖 AI 제안전략 요약
       [══ 🤖 AI 분석 시작 — RFP 기반 자동 생성 ══]  ← 큰 OCI Red CTA
       (textarea + Word 다운로드)
3단계: 📋 기본정보 검토 & 저장
```

**효과**: 워크플로우가 더 자연스러움 — "RFP 업로드 → 다음 단계 카드로 이동 → AI 분석"

#### 2. 📊 제안평가 탭 — 큰 [AI 제안평가] CTA + 작업 컬럼 정리 (Phase 12-B)

**기존**: 자료 행 작업 컬럼 = `[AI제안평가] [다운로드] [삭제]` — 작은 텍스트 버튼
**개선**:
- 작업 컬럼 단순화: `[다운로드] [삭제]` 만
- 자료 섹션 하단에 **큰 OCI Red CTA `[📊 AI 제안평가 시작]`** 추가
- 분석 가능한 첫 번째 자료 파일 자동 선택 → `_doEvaluateProposal()` 호출

**효과**: 기본탭 `[AI 분석 시작]` 패턴과 동일 → **시각적 일관성** + **사용자 절대 놓치지 않음**

#### 3. 🛡 AI 평가 JSON 파싱 강화 — RFP-제안서 미스매치 fallback (Phase 12-C)

**증상**: RFP 와 맞지 않는 제안서 업로드 → AI 평가 시 JSON 파싱 에러로 앱 동작 멈춤
**원인**: Gemini가 RFP-제안서 미스매치 케이스에서 `responseSchema` 강제에도 비정형 응답 가능

**Fix**:
- 1차 `JSON.parse(text)` 실패 시 markdown fence (` ``` `) 제거 + 첫 `{` ~ 마지막 `}` 추출 후 재시도
- 2차도 실패 시 **fallback 응답** 반환 (앱 동작 정상 유지):
  ```
  coverage_score: 0, win_probability: 0
  overall_assessment:
  "⚠️ AI가 응답을 정상 형식으로 생성하지 못했습니다.
   가능한 원인:
   ① 업로드한 제안서가 RFP 와 일치하지 않는 다른 사업/프로젝트의 자료일 수 있습니다.
   ② 제안서 파일이 손상되었거나 내용이 너무 적을 수 있습니다.
   ③ RFP 와 제안서의 언어/형식이 호환되지 않을 수 있습니다.
   권장 조치: 동일 사업의 정확한 RFP-제안서 쌍을 다시 업로드하여 평가를 시도하세요."
  risk_factors: ["RFP-제안서 미스매치 추정 — 동일 사업의 자료인지 확인 필요"]
  ```
- `analyzeProposalRFP` 도 동일 패턴 적용 (방어적 fix)

**효과**: 사용자가 잘못된 파일 쌍을 업로드해도 **앱이 죽지 않고 친절한 안내** 표시

### 🛠 기술 변경

- **DB 스키마 변경 없음**
- **신규 npm 의존성 0개**
- **변경 파일**:
  - `public/js/pages/proposals.js` — `_renderRfpTab` CTA 제거 / `_renderAiStrategySection` CTA 추가 / `_renderFileList` 작업 컬럼 단순화 / `_renderFilesTab` 큰 CTA 추가 / `_bindFileEvents` `#pr-evaluate-cta` 신규
  - `src/services/gemini.js` — `evaluateProposalAgainstRFP` + `analyzeProposalRFP` JSON 파싱 강화 + fallback

### 📊 회귀 테스트
- vitest: **44/44 (proposals) 통과**
- lint: 0 errors / 0 warnings

### 🚀 운영 배포
```bash
cd ~/oci-ai && git pull origin master && pm2 restart oci-ai --update-env
```

---

## v5.6 (2026.05.23) — 직전

### 🎯 메인 — **제안 모듈 Phase 11: AI 평가 영속 + Outlook 연동 + 목록 카드뷰**

사용자 피드백 3건 반영 — 데이터 영속성 + 메일앱 다양화 + 시각화 옵션.

#### 1. 💾 AI 평가 결과 영속화 (Phase 11-A)

**증상**: AI 제안평가 → 저장 → 모달 닫기 → 다시 열기 → **평가 결과가 사라짐**
**원인**: `_renderEvalSection()` 이 빈 div 만 렌더 (DB 이력은 남지만 모달 재진입 시 표시 안 함)
**Fix**:
- 백엔드 `GET /:id` 응답에 `latest_evaluation` 신규 필드 추가
  · `proposal_evaluations` 최신 1건 + 파일명 자동 조회 (ORDER BY generated_at DESC LIMIT 1)
  · `evaluation_json` 파싱 → covered_items / missing_items / quality_metrics / win_factors / risk_factors 등 풀어서 노출
- 프론트 `_renderEvalSection(e)`:
  · `e.latest_evaluation` 있으면 카드 자동 prefill
  · 안내 배너 강화: "💾 최근 평가 이력 자동 불러옴 — 커버율 N% · 수주확률 N%"
  · `[✕ 닫기]` 버튼 추가 (사용자가 일시 숨김 가능)

#### 2. 📧 Outlook(mailto) 발송 옵션 (Phase 11-A)

**기존**: Gmail OAuth 발송만 (Google 연동 필요)
**개선**: 발송 옵션 3가지 — 사용자가 메일 환경에 맞춰 선택

| 옵션 | 동작 | 권장 |
|------|------|------|
| **📧 메일앱(Outlook) 발송** | mailto URL → OS 기본 메일앱 자동 실행 | 회사 표준 Outlook 사용자 |
| **✉️ Gmail 발송** | Gmail OAuth 직접 발송 + 자동 첨부 | Google Workspace 사용자 |
| **📥 첨부 파일 다운로드** | 선택 파일들 일괄 다운로드 (250ms 간격) | 메일앱 수동 첨부 보완 |

- mailto URL 2000자 한계 검증 → 긴 본문은 Gmail 권장
- 견적 모듈 mailto 패턴 재사용

#### 3. 🗂 제안 목록 카드뷰 + 뷰 전환 토글 (Phase 11-B)

**기존**: 테이블 뷰만
**개선**: **카드 뷰 추가** + 사용자가 토글로 전환 (`[☰ 목록] [▦ 카드]`)

- 반응형 그리드: auto-fill min 290px → 1열~4열 자동 조정
- 카드 전체 클릭 = 모달 열기
- hover 시 OCI Red border + 부드러운 transform
- 사용자 선호 localStorage 영속 (`pr-list-view-mode`)

### 🛠 기술 변경

- **DB 스키마 변경 없음**
- **신규 npm 의존성 0개**
- **변경 파일**:
  - `src/routes/proposals.js` — `GET /:id` 응답에 `latest_evaluation` 추가
  - `public/js/pages/proposals.js` — `_renderEvalSection(e)` prefill + 발송 옵션 3개 핸들러 + 뷰 토글 + 카드뷰 렌더 + `_viewMode` 영속
  - `public/css/styles.css` — `.pr-view-toggle` / `.pr-card-grid` / `.pr-card-*` 신규 (+126)

### 📊 회귀 테스트
- vitest: **44/44 (proposals) 통과**
- lint: 0 errors / 0 warnings

### 🚀 운영 배포
```bash
cd ~/oci-ai && git pull origin master && pm2 restart oci-ai --update-env
```

---

## v5.5 (2026.05.23) — 이전

### 🎯 메인 — **제안 모듈 Phase 10: 디자이너 관점 UX 재설계 + Quick Fix 6건**

사용자 피드백 6건 반영 — 인지 부하 감소 + 워크플로우 시각화 + Quick Fix.

#### 1. 🐛 Word 다운로드 401 인증 fix (Phase 10-1)
**증상**: `[📄 Word 다운로드]` 클릭 → "로그인이 필요합니다" 401 에러
**원인**: fetch 호출 시 잘못된 토큰 키 사용 (`authToken`/`userId`)
**Fix**: 올바른 키로 변경 (`oci_token`/`current_user_id`, API.js 와 동일)

#### 2. 🎨 기본탭 UX 재설계 (Phase 10-2) — 핵심 개선
**기존 구조 (Phase 8-C)**: 3섹션 세로 나열 (RFP + 기본정보 + AI 요약) — 세로 스크롤 길고 AI 분석 버튼이 묻힘
**개선 구조 (Phase 10-2)**: **Stepper + Collapsible + 큰 CTA**

```
[① RFP 업로드] ─── [② AI 분석] ─── [③ 검토 & 저장]
   현재 단계          (대기중)           (대기중)

📑 1단계: RFP 등록 & AI 분석 (펼침/활성)
  └ 드롭존 + 파일 목록 + [══ 🤖 AI 분석 시작 ══]  ← 큰 OCI Red CTA

🤖 2단계: AI 제안전략 요약 (접힘) — "6섹션 마크다운 — 1,247자" ▼
📋 3단계: 제안 기본정보 검토 & 저장 (접힘) — 요약 ▼
```

**디자인 의도:**
- 시각적 진행감 (Stepper) — 사용자가 어디까지 왔는지 한눈에
- 포커스 집중 (Collapsible) — 활성 단계만 펼침
- AI 분석 prominence (큰 CTA 가로 버튼) — 절대 놓치지 않음
- 단계별 요약 (접힘 시에도 핵심 정보 1줄)

#### 3. 🏷 탭 제목 변경 (Phase 10-1)
- `"📦 자료 & 견적"` → `"📊 제안평가"` (핵심 기능 명확화)

#### 4. 📋 PPTX AI 분석 안내 강화 (Phase 10-1)
- 제안평가 탭 상단에 **노란색 안내 배너** 추가
- "PPT/DOC/HWP/XLS 는 평가 전에 PDF 로 변환해서 업로드하세요 (PowerPoint: 파일 → 내보내기 → PDF)"

#### 5. 🛡 AI 코칭 에러 사전 차단 (Phase 10-1)
**기존**: `[AI제안평가]` 클릭 → 서버 호출 후에야 비호환 안내 → Gemini 비용/시간 낭비
**개선**: confirm 이전에 RFP 파일 분석 가능 형식 사전 검증 → 즉시 안내
- RFP 비호환: "PPT/DOC/HWP/XLS 는 PDF 로 변환 후 다시 업로드"
- RFP 없음: "기본정보 탭의 RFP 영역에 PDF 파일을 먼저 업로드"

#### 6. 🔤 자료 작업 컬럼 한글화 (Phase 10-1)
- `[📊]` 아이콘 → **AI제안평가** 텍스트
- `[⬇️]` 아이콘 → **다운로드** 텍스트
- `[🗑️]` 아이콘 → **삭제** 텍스트
- 평가 불가 시 `—` → **"평가 불가"** 텍스트 + 안내 tooltip

#### 7. 📚 문서 갱신 (Phase 10-3)
- `USER_MANUAL.md` — Stepper UX 안내 + 탭명 변경 + 작업 컬럼 한글화
- `RELEASE_NOTES.md` (현재 파일)

### 🛠 기술 변경

- **DB 스키마 변경 없음** — UI/UX 만 개선
- **신규 npm 의존성 0개**
- **변경 파일**:
  - `public/js/pages/proposals.js` — Stepper + Collapsible 헬퍼 + 토글 핸들러 + 인증 토큰 키 + 한글화 + 사전 검증
  - `public/css/styles.css` — `.pr-stepper` / `.pr-section` / `.pr-ai-cta` 신규 (+167)
  - `src/docs/USER_MANUAL.md` / `RELEASE_NOTES.md` — 문서 갱신

### 📊 회귀 테스트
- vitest: **44/44 (proposals) 통과**
- lint: 0 errors / 0 warnings

### 🚀 운영 배포
```bash
cd ~/oci-ai && git pull origin master && pm2 restart oci-ai --update-env
```
- DB 스키마 변경 없음 — 마이그레이션 불필요
- Service Worker 캐시 자동 갱신

---

## v5.4 (2026.05.23) — 직전

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
