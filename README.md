# OCI CRM

OCI(태양광 영업) 전용 CRM 시스템입니다. 핑거세일즈 CRM의 UI/UX를 기반으로 OCI의 사업 특성(태양광/전기·ESS 영업, 국내·해외 통합관리, 원가 변동성)에 맞춰 커스터마이징한 풀스택 웹 애플리케이션입니다.

## 주요 기능

- **대시보드** — 5대 KPI, 월별 영업기회 추이 차트, 단계별 파이프라인, 최근 활동, 인사이트 알림
- **파이프라인** — 8단계 칸반 보드 (드래그앤드롭으로 단계 변경, 변경 이력 자동 기록)
- **영업 리드** — 검색/필터/CRUD, 상세 모달에서 활동 이력 관리
- **프로젝트** — 수주 후 진행 프로젝트 관리, 마진율 자동 계산
- **고객사** — 국내·해외 거래처 통합 관리
- **원가 관리** — 상품 원가 + 산정 계산기 + 변동 이력 차트 (3탭)
- **팀 현황** — CS/Field/Sales 조직도, 팀원별 실적
- **리포트** — 연간 목표 달성률, 국내/해외 비중, 사업유형별 매출, 깔때기 전환율, CSV 내보내기
- **설정** — OnERP / 가온아이 그룹웨어 연동 화면, DB 상태 모니터, 알림/보안 옵션

## 아키텍처

```
[Browser]
  ├── Vanilla JS (페이지별 모듈 + Chart.js)
  ├── 1 SPA · index.html + 9 page modules + app.js 라우터
  └── REST API (JSON)
       │
[Node.js + Express :3000]
  ├── /api/dashboard/*
  ├── /api/leads (GET/POST/PUT/DELETE/PATCH 단계변경)
  ├── /api/products + /products/:id/history
  ├── /api/projects, /team, /customers, /activities
  └── mysql2/promise 풀
       │
[MariaDB 10.x]
  └── schema.sql (8 테이블, utf8mb4)
```

## 설치 / 실행

### 1. 사전 요구사항

- Node.js 18+ 
- MariaDB 10.4+ (또는 MySQL 8.0+)
- npm

### 2. MariaDB 설정

```bash
# DB 생성 + 스키마 + 샘플 데이터 일괄 로드
mysql -u root -p < schema.sql
```

`schema.sql` 은 다음을 자동 수행합니다:
- `oci_power_crm` 데이터베이스 생성 (없을 경우)
- 8개 테이블 생성: `team_members`, `customers`, `leads`, `products`, `cost_history`, `projects`, `activities`, (관계형 인덱스 포함)
- 샘플 데이터 삽입 (팀원 8명, 고객사 11곳, 리드 14건, 상품 9개, 프로젝트 3건, 활동 7건)

### 3. 환경 변수 설정

`.env.example` 을 `.env` 로 복사 후 수정:

```bash
cp .env.example .env
```

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=비밀번호
DB_NAME=oci_power_crm
PORT=3000
```

### 4. 의존성 설치 + 실행

```bash
npm install
npm start
```

개발 모드 (자동 재시작):
```bash
npm run dev
```

브라우저에서 `http://localhost:3000` 접속.

## 데이터베이스 스키마 요약

| 테이블 | 설명 | 주요 컬럼 |
|--------|------|-----------|
| `team_members` | 영업팀 (CS/Field/Sales) | name, role, team, email, is_active |
| `customers` | 국내·해외 거래처 | name, country, industry, contact_person |
| `leads` | 영업 기회 (8단계) | customer_name, project_name, business_type, stage, expected_amount, currency, capacity_mw, region, assigned_to, expected_close_date |
| `products` | 상품/원가 항목 | name, category, current_price, last_updated, change_pct |
| `cost_history` | 원가 변동 이력 (자동 기록) | product_id, price, change_pct, recorded_at |
| `projects` | 수주 후 진행 프로젝트 | name, contract_amount, cost_amount, margin, status |
| `activities` | 모든 활동 이력 (단계변경 자동 INSERT) | lead_id, activity_type, title, content |

### 단계 (stage) 값

`lead` → `review` → `proposal` → `bidding` → `negotiation` → `won` / `lost` / `dropped`

칸반에서 드래그하여 단계를 변경하면 `activities` 테이블에 `stage_change` 활동이 자동 기록됩니다.

## 외부 시스템 연동 (예정)

설정 페이지에서 다음 연동 후크가 준비되어 있습니다:

- **OnERP** — 제품 원가 / 출고 단가 / 재고 동기화 (`products.last_updated`, `change_pct` 자동 갱신)
- **가온아이 그룹웨어** — 결재 / 일정 / SSO (SAML 2.0)

API 엔드포인트와 키를 입력하면 실제 동기화 로직을 추가할 수 있도록 구조가 마련되어 있습니다.

## 디렉토리 구조

```
oci-crm/
├── package.json
├── .env.example
├── schema.sql              # MariaDB 스키마 + 샘플 데이터
├── server.js               # Express 서버 + REST API
├── README.md
└── public/
    ├── index.html          # SPA 컨테이너
    ├── assets/
    │   └── oci_power_logo.png
    ├── css/
    │   └── styles.css      # 핑거세일즈 스타일 + OCI Red(#E63329)
    └── js/
        ├── api.js          # API 클라이언트
        ├── utils.js        # Fmt, STAGES, Modal, Toast, esc, debounce
        ├── app.js          # 메인 라우터 + 리드 등록/상세 모달
        └── pages/
            ├── dashboard.js
            ├── pipeline.js
            ├── leads.js
            ├── projects.js
            ├── customers.js
            ├── cost.js
            ├── team.js
            ├── reports.js
            └── settings.js
```

## 디자인 가이드

- **메인 컬러**: OCI Red `#E63329` (활성 표시줄, 주요 버튼, 알림 배지)
- **레이아웃**: 사이드바(220px) + 메인 영역. 핑거세일즈 CRM 구조 그대로
- **폰트**: Noto Sans KR (본문), IBM Plex Mono (숫자/금액)
- **반응형**: 1100px 이하부터 그리드 자동 축소

## 라이선스

내부 사용 (OCI 영업조직 전용)
