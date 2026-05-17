# 📦 릴리즈 노트 (Release Notes)

> **프로젝트**: OCI CRM AI

---

## v5.0 (2026.05) — 현재 ⭐

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
