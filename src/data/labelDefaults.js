'use strict';
// =============================================================
// 워드 사전(Word Repository) 기본 라벨 시드
//
// 구조:  { [scope]: { [key]: { label, desc } } }
//   scope = 도메인 단위 (leads, customers, projects, ... common)
//   key   = 코드 상에서 사용하는 식별자 (DB 컬럼명과 일치 권장)
//   label = 화면에 노출되는 한글 라벨 (어드민이 자유롭게 변경 가능)
//   desc  = 어드민 편집 UI 도움말
//
// 새 도메인/키 추가 시:
//   1) 이 파일에 entry 추가
//   2) GET /api/admin/labels/seed 호출 (또는 서버 재기동) → DB upsert
//   3) UI 측에서 [data-label="<scope>.<key>"] 마커 부착하면 자동 치환
// =============================================================

const LABEL_DEFAULTS = {
  // ─── 영업 리드 ─────────────────────────────────────────────
  leads: {
    customer_name: { label: '고객사', desc: '리드의 고객사 이름' },
    project_name: { label: '프로젝트', desc: '리드의 프로젝트(안건) 이름' },
    business_type: { label: '사업 유형', desc: 'EPC / 모듈 / O&M 등' },
    region: { label: '지역', desc: '국내 / 해외 등' },
    capacity_mw: { label: '규모', desc: '발전 용량 (MW)' },
    expected_amount: { label: '예상 금액', desc: '수주 예상 금액' },
    currency: { label: '통화', desc: 'KRW / USD 등' },
    stage: { label: '단계', desc: '파이프라인 단계' },
    assigned_to: { label: '영업 담당자', desc: '리드 담당 영업사원' },
    expected_close_date: { label: '예상 마감일', desc: '영업이 예측한 종결일' },
    bidding_deadline: { label: '입찰 마감일', desc: '고객사 지정 입찰 제출 기한' },
    source: { label: '리드 소스', desc: '전시회/소개/웹사이트 등' },
    notes: { label: '비고', desc: '메모/특이사항' },
    contact_person: { label: '고객 담당자', desc: '고객사 담당자 이름' },
    last_activity: { label: '최종 활동', desc: '가장 최근 활동' },
    created_at: { label: '최초 등록', desc: '리드 등록 일시' },
    updated_at: { label: '최근 업데이트', desc: '마지막 수정 시점' },
  },

  // ─── 고객사 ────────────────────────────────────────────────
  customers: {
    customer_name: { label: '고객사명', desc: '회사명' },
    region: { label: '지역', desc: '국가/지역' },
    industry: { label: '업종', desc: '발전/제조/유통 등' },
    contact_person: { label: '담당자', desc: '주 담당자 이름' },
    contact_email: { label: '이메일', desc: '담당자 이메일' },
    contact_phone: { label: '전화번호', desc: '담당자 연락처' },
    address: { label: '주소', desc: '회사 주소' },
    website: { label: '웹사이트', desc: '회사 홈페이지' },
    notes: { label: '비고', desc: '메모/특이사항' },
  },

  // ─── 프로젝트 ──────────────────────────────────────────────
  projects: {
    name: { label: '프로젝트명', desc: '프로젝트 이름' },
    status: { label: '상태', desc: '진행/완료/보류 등' },
    customer_name: { label: '고객사', desc: '발주 고객사' },
    manager: { label: 'PM', desc: '프로젝트 매니저' },
    start_date: { label: '시작일', desc: '프로젝트 시작 날짜' },
    end_date: { label: '종료일', desc: '프로젝트 종료 예정 날짜' },
    budget: { label: '예산', desc: '총 예산' },
  },

  // ─── 활동 ──────────────────────────────────────────────────
  activities: {
    activity_type: { label: '활동 유형', desc: '미팅/전화/이메일 등' },
    title: { label: '제목', desc: '활동 제목' },
    content: { label: '내용', desc: '활동 상세 내용' },
    activity_date: { label: '활동 일시', desc: '활동 수행 일시' },
    status: { label: '구분', desc: '계획/완료' },
    performer_name: { label: '담당자', desc: '활동 수행자' },
  },

  // ─── 팀 ────────────────────────────────────────────────────
  team: {
    name: { label: '이름', desc: '팀원 이름' },
    role: { label: '역할', desc: '시스템 역할(매니저/팀장 등)' },
    email: { label: '이메일', desc: '팀원 이메일' },
    team: { label: '소속 팀', desc: '부서/팀' },
    position: { label: '직급', desc: '직급/직책' },
  },

  // ─── 공통 (모든 화면) ──────────────────────────────────────
  common: {
    actions: { label: '관리', desc: '액션 버튼 컬럼' },
    search: { label: '검색', desc: '검색창 placeholder' },
    save: { label: '저장', desc: '저장 버튼' },
    cancel: { label: '취소', desc: '취소 버튼' },
    delete: { label: '삭제', desc: '삭제 버튼' },
    edit: { label: '편집', desc: '편집 버튼' },
    add: { label: '추가', desc: '추가 버튼' },
    created_at: { label: '최초 등록', desc: '레코드 생성 일시' },
    updated_at: { label: '최근 업데이트', desc: '레코드 수정 일시' },
  },
};

module.exports = { LABEL_DEFAULTS };
