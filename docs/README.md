# 📚 OCI CRM AI — 개발 문서 인덱스

> 이 폴더는 OCI CRM AI 프로젝트의 **모든 공식 개발 문서**를 통합 관리합니다.

---

## 📑 문서 목록

### 사용자 / 기능 문서

| 문서 | 대상 | 설명 |
|------|------|------|
| 📘 [USER_MANUAL.md](./USER_MANUAL.md) | 모든 사용자 | 시스템 사용법, 화면별 가이드, FAQ |

### 설계 문서

| 문서 | 대상 | 설명 |
|------|------|------|
| 🏛 [PROGRAM_DESIGN.md](./PROGRAM_DESIGN.md) | 아키텍트, 개발자 | 시스템 아키텍처, 모듈 설계, 보안 설계, ADR |
| 🗄 [db-erd.md](./db-erd.md) | 개발자 | DB ER 다이어그램 |
| 🗄 [db-table-design.md](./db-table-design.md) | 개발자 | 테이블 상세 설계 |
| 🗄 [db-ddl.sql](./db-ddl.sql) | 개발자 | DB DDL 스크립트 |

### 개발 / API 문서

| 문서 | 대상 | 설명 |
|------|------|------|
| 🔌 [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) | 개발자, 통합 파트너 | REST API 명세, WebSocket 이벤트, 에러 코드 |

### 운영 문서

| 문서 | 대상 | 설명 |
|------|------|------|
| 🛠 [ADMIN_SETUP_GUIDE.md](./ADMIN_SETUP_GUIDE.md) | 시스템 관리자, DevOps | 환경 설정, 배포, 백업, 모니터링 |
| 🔧 [TROUBLESHOOTING_GUIDE.md](./TROUBLESHOOTING_GUIDE.md) | 운영팀, 사용자 지원 | 증상별 진단 + 해결, 에러 코드 참조 |

---

## 🎯 역할별 추천 읽기 순서

### 신규 사용자

1. 📘 [USER_MANUAL.md](./USER_MANUAL.md) — 화면별 사용법 학습

### 신규 개발자 온보딩

1. 📘 [USER_MANUAL.md](./USER_MANUAL.md) — 제품 이해
2. 🏛 [PROGRAM_DESIGN.md](./PROGRAM_DESIGN.md) — 시스템 구조 파악
3. 🔌 [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) — API 명세 학습
4. 🛠 [ADMIN_SETUP_GUIDE.md](./ADMIN_SETUP_GUIDE.md) — 로컬 환경 셋업

### 운영 담당자

1. 🛠 [ADMIN_SETUP_GUIDE.md](./ADMIN_SETUP_GUIDE.md) — 환경 셋업 + 배포
2. 🔧 [TROUBLESHOOTING_GUIDE.md](./TROUBLESHOOTING_GUIDE.md) — 장애 대응

### 시스템 분석가 / 아키텍트

1. 🏛 [PROGRAM_DESIGN.md](./PROGRAM_DESIGN.md) — 전체 아키텍처
2. 🗄 [db-erd.md](./db-erd.md) — 데이터 모델
3. 🔌 [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) — 인터페이스 명세

---

## 📝 문서 관리 원칙

### 작성 원칙

- ✅ **사실 기반**: 실제 코드와 일치하도록 작성
- ✅ **버전 명시**: 각 문서 상단에 버전 / 일자 명시
- ✅ **마크다운**: 모든 문서는 `.md` 형식 (GitHub / Notion 호환)
- ✅ **한국어 우선**: 사용자 대상 문서는 한국어, 개발자 대상은 한/영 혼용 가능
- ❌ **시크릿 금지**: 실제 API 키, 비밀번호 등은 절대 포함하지 말 것

### 변경 시 절차

1. 코드 변경 시 → 관련 문서 동시 갱신
2. 변경 사항이 큰 경우 → 각 문서 하단 "변경 이력" 섹션 업데이트
3. PR 리뷰 시 → 문서 갱신 여부도 확인

### 새 문서 추가 시

1. `docs/` 폴더에 `.md` 파일 생성
2. 본 `README.md` (docs/README.md)의 문서 목록에 추가
3. 적절한 카테고리에 배치

---

## 🔗 외부 참조

### 코드 저장소
- **GitHub**: https://github.com/overclass8211/oci-ai
- **메인 브랜치**: `master`
- **기능 브랜치**: `feature/pipeline-ai-coaching`

### 외부 API 문서
- [Google Gemini API](https://ai.google.dev/docs)
- [Google Calendar API](https://developers.google.com/calendar/api/v3/reference)
- [Gmail API](https://developers.google.com/gmail/api/reference/rest)
- [Kakao Map JavaScript API](https://apis.map.kakao.com/web/)

### 기술 스택 공식 문서
- [Node.js](https://nodejs.org/docs)
- [Express](https://expressjs.com/)
- [MariaDB](https://mariadb.com/kb/en/documentation/)
- [Chart.js](https://www.chartjs.org/docs/)
- [FullCalendar](https://fullcalendar.io/docs)

---

## 📮 문의

- **문서 개선 제안**: GitHub Issue 또는 PR
- **기술 문의**: 개발팀
- **운영 문의**: IT 운영팀

---

> 📌 본 문서 인덱스는 신규 문서 추가 시 함께 갱신되어야 합니다.
