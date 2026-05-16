'use strict';
// =============================================================
// 워드 사전(Word Repository) 기본 라벨 시드 — 다국어 지원
//
// 구조:  { [scope]: { [key]: { desc, ko, en, ja, zh } } }
//   scope = 도메인 단위 (leads, customers, ..., common, menu)
//   key   = 코드 상에서 사용하는 식별자
//   desc  = 어드민 편집 UI 도움말 (한글 고정)
//   ko/en/ja/zh = 각 언어별 기본 라벨
//
// 미오버라이드 + 미번역인 경우 fallback 순서:
//   요청 locale → ko → key
// =============================================================

const SUPPORTED_LOCALES = ['ko', 'en', 'ja', 'zh'];

const LOCALE_INFO = {
  ko: { label: '한국어', flag: '🇰🇷' },
  en: { label: 'English', flag: '🇺🇸' },
  ja: { label: '日本語', flag: '🇯🇵' },
  zh: { label: '中文', flag: '🇨🇳' },
};

const LABEL_DEFAULTS = {
  // ─── 영업 리드 ─────────────────────────────────────────────
  leads: {
    customer_name: {
      desc: '리드의 고객사 이름',
      ko: '고객사',
      en: 'Customer',
      ja: '顧客',
      zh: '客户',
    },
    project_name: {
      desc: '리드의 프로젝트(안건)',
      ko: '프로젝트',
      en: 'Project',
      ja: 'プロジェクト',
      zh: '项目',
    },
    business_type: {
      desc: 'EPC / 모듈 / O&M 등',
      ko: '사업 유형',
      en: 'Business Type',
      ja: '事業区分',
      zh: '业务类型',
    },
    region: { desc: '국내 / 해외 등', ko: '지역', en: 'Region', ja: '地域', zh: '地区' },
    capacity_mw: {
      desc: '발전 용량 (MW)',
      ko: '규모',
      en: 'Capacity (MW)',
      ja: '規模 (MW)',
      zh: '容量 (MW)',
    },
    expected_amount: {
      desc: '수주 예상 금액',
      ko: '예상 금액',
      en: 'Expected Amount',
      ja: '予想金額',
      zh: '预计金额',
    },
    currency: { desc: 'KRW / USD 등', ko: '통화', en: 'Currency', ja: '通貨', zh: '货币' },
    stage: { desc: '파이프라인 단계', ko: '단계', en: 'Stage', ja: 'ステージ', zh: '阶段' },
    assigned_to: {
      desc: '리드 담당 영업사원',
      ko: '영업 담당자',
      en: 'Sales Rep',
      ja: '営業担当',
      zh: '销售负责人',
    },
    expected_close_date: {
      desc: '영업이 예측한 종결일',
      ko: '예상 마감일',
      en: 'Expected Close',
      ja: '完了予定日',
      zh: '预计结案日',
    },
    bidding_deadline: {
      desc: '고객사 지정 입찰 제출 기한',
      ko: '입찰 마감일',
      en: 'Bid Deadline',
      ja: '入札締切',
      zh: '投标截止',
    },
    source: {
      desc: '전시회/소개/웹사이트 등',
      ko: '리드 소스',
      en: 'Lead Source',
      ja: 'リードソース',
      zh: '线索来源',
    },
    notes: { desc: '메모/특이사항', ko: '비고', en: 'Notes', ja: '備考', zh: '备注' },
    contact_person: {
      desc: '고객사 담당자 이름',
      ko: '고객 담당자',
      en: 'Contact',
      ja: '担当者',
      zh: '联系人',
    },
    last_activity: {
      desc: '가장 최근 활동',
      ko: '최종 활동',
      en: 'Last Activity',
      ja: '最終活動',
      zh: '最近活动',
    },
    created_at: {
      desc: '리드 등록 일시',
      ko: '최초 등록',
      en: 'Created',
      ja: '登録日',
      zh: '创建日',
    },
    updated_at: {
      desc: '마지막 수정 시점',
      ko: '최근 업데이트',
      en: 'Updated',
      ja: '更新日',
      zh: '更新日',
    },
  },

  // ─── 고객사 ────────────────────────────────────────────────
  customers: {
    customer_name: {
      desc: '회사명',
      ko: '고객사명',
      en: 'Customer Name',
      ja: '顧客名',
      zh: '客户名称',
    },
    region: { desc: '국가/지역', ko: '지역', en: 'Region', ja: '地域', zh: '地区' },
    industry: { desc: '발전/제조/유통 등', ko: '업종', en: 'Industry', ja: '業種', zh: '行业' },
    contact_person: {
      desc: '주 담당자 이름',
      ko: '담당자',
      en: 'Contact',
      ja: '担当者',
      zh: '联系人',
    },
    contact_email: { desc: '담당자 이메일', ko: '이메일', en: 'Email', ja: 'メール', zh: '邮箱' },
    contact_phone: { desc: '담당자 연락처', ko: '전화번호', en: 'Phone', ja: '電話', zh: '电话' },
    address: { desc: '회사 주소', ko: '주소', en: 'Address', ja: '住所', zh: '地址' },
    website: {
      desc: '회사 홈페이지',
      ko: '웹사이트',
      en: 'Website',
      ja: 'ウェブサイト',
      zh: '网站',
    },
    notes: { desc: '메모/특이사항', ko: '비고', en: 'Notes', ja: '備考', zh: '备注' },
  },

  // ─── 프로젝트 ──────────────────────────────────────────────
  projects: {
    name: {
      desc: '프로젝트 이름',
      ko: '프로젝트명',
      en: 'Project Name',
      ja: 'プロジェクト名',
      zh: '项目名称',
    },
    status: { desc: '진행/완료/보류 등', ko: '상태', en: 'Status', ja: 'ステータス', zh: '状态' },
    customer_name: { desc: '발주 고객사', ko: '고객사', en: 'Customer', ja: '顧客', zh: '客户' },
    business_type: { desc: 'EPC / 모듈 등', ko: '유형', en: 'Type', ja: '種類', zh: '类型' },
    contract_amount: {
      desc: '계약 금액',
      ko: '계약금액',
      en: 'Contract',
      ja: '契約金額',
      zh: '合同金额',
    },
    estimated_cost: {
      desc: '산정 원가',
      ko: '산정 원가',
      en: 'Est. Cost',
      ja: '原価',
      zh: '估算成本',
    },
    margin_pct: { desc: '마진율(%)', ko: '마진율', en: 'Margin %', ja: '利益率', zh: '利润率' },
    due_date: { desc: '납기일', ko: '납기일', en: 'Due Date', ja: '納期', zh: '交付日' },
    manager: { desc: '프로젝트 매니저', ko: '담당', en: 'Manager', ja: '担当', zh: '负责人' },
    start_date: {
      desc: '프로젝트 시작 날짜',
      ko: '시작일',
      en: 'Start Date',
      ja: '開始日',
      zh: '开始日期',
    },
    end_date: {
      desc: '프로젝트 종료 예정일',
      ko: '종료일',
      en: 'End Date',
      ja: '終了日',
      zh: '结束日期',
    },
    budget: { desc: '총 예산', ko: '예산', en: 'Budget', ja: '予算', zh: '预算' },
  },

  // ─── 활동 ──────────────────────────────────────────────────
  activities: {
    activity_type: {
      desc: '미팅/전화/이메일 등',
      ko: '활동 유형',
      en: 'Activity Type',
      ja: '活動種別',
      zh: '活动类型',
    },
    title: { desc: '활동 제목', ko: '제목', en: 'Title', ja: 'タイトル', zh: '标题' },
    content: { desc: '활동 상세 내용', ko: '내용', en: 'Content', ja: '内容', zh: '内容' },
    activity_date: {
      desc: '활동 수행 일시',
      ko: '활동 일시',
      en: 'Activity Date',
      ja: '実施日時',
      zh: '活动日期',
    },
    status: { desc: '계획/완료', ko: '구분', en: 'Status', ja: 'ステータス', zh: '状态' },
    performer_name: {
      desc: '활동 수행자',
      ko: '담당자',
      en: 'Performer',
      ja: '実施者',
      zh: '执行人',
    },
  },

  // ─── 팀 ────────────────────────────────────────────────────
  team: {
    name: { desc: '팀원 이름', ko: '이름', en: 'Name', ja: '氏名', zh: '姓名' },
    role: { desc: '시스템 역할(매니저/팀장 등)', ko: '역할', en: 'Role', ja: '役割', zh: '角色' },
    email: { desc: '팀원 이메일', ko: '이메일', en: 'Email', ja: 'メール', zh: '邮箱' },
    team: { desc: '부서/팀', ko: '소속팀', en: 'Team', ja: 'チーム', zh: '团队' },
    position: { desc: '직급/직책', ko: '직급', en: 'Position', ja: '役職', zh: '职位' },
    in_progress: {
      desc: '진행중 리드 수',
      ko: '진행중',
      en: 'In Progress',
      ja: '進行中',
      zh: '进行中',
    },
    won_this_year: {
      desc: '올해 수주 건수',
      ko: '올해수주',
      en: 'Won YTD',
      ja: '今年受注',
      zh: '本年成交',
    },
    won_amount: {
      desc: '수주 금액 합계',
      ko: '수주금액',
      en: 'Won Amount',
      ja: '受注金額',
      zh: '成交金额',
    },
    new_this_month: {
      desc: '이번달 신규 리드 수',
      ko: '이번달신규',
      en: 'New This Month',
      ja: '今月新規',
      zh: '本月新增',
    },
  },

  // ─── 메뉴 (사이드바) ───────────────────────────────────────
  menu: {
    dashboard: {
      desc: '대시보드 메뉴',
      ko: '대시보드',
      en: 'Dashboard',
      ja: 'ダッシュボード',
      zh: '仪表盘',
    },
    pipeline: {
      desc: '파이프라인 메뉴',
      ko: '파이프라인',
      en: 'Pipeline',
      ja: 'パイプライン',
      zh: '管道',
    },
    orders: { desc: 'ERP 연계 메뉴', ko: 'ERP 연계', en: 'ERP', ja: 'ERP連携', zh: 'ERP 集成' },
    leads: {
      desc: '영업 리드 메뉴',
      ko: '영업 리드',
      en: 'Sales Leads',
      ja: '営業リード',
      zh: '销售线索',
    },
    projects: {
      desc: '프로젝트 메뉴',
      ko: '프로젝트',
      en: 'Projects',
      ja: 'プロジェクト',
      zh: '项目',
    },
    customers: { desc: '고객사 메뉴', ko: '고객사', en: 'Customers', ja: '顧客', zh: '客户' },
    calendar: {
      desc: '영업 캘린더 메뉴',
      ko: '영업 캘린더',
      en: 'Calendar',
      ja: 'カレンダー',
      zh: '日历',
    },
    team: { desc: '팀 현황 메뉴', ko: '팀 현황', en: 'Team', ja: 'チーム', zh: '团队' },
    reports: { desc: '리포트 메뉴', ko: '리포트', en: 'Reports', ja: 'レポート', zh: '报表' },
    board: {
      desc: '커뮤니케이션 메뉴',
      ko: '커뮤니케이션',
      en: 'Communication',
      ja: 'コミュニケーション',
      zh: '沟通',
    },
    'ai-assistant': {
      desc: 'AI 어시스턴트 메뉴',
      ko: 'AI 어시스턴트',
      en: 'AI Assistant',
      ja: 'AIアシスタント',
      zh: 'AI 助手',
    },
    meeting: {
      desc: '회의록 AI 메뉴',
      ko: '회의록 AI',
      en: 'Meeting AI',
      ja: '議事録AI',
      zh: '会议 AI',
    },
    'meeting-list': {
      desc: '회의록 목록 메뉴',
      ko: '회의록 목록',
      en: 'Meetings',
      ja: '議事録',
      zh: '会议记录',
    },
    admin: { desc: '관리자 메뉴', ko: '관리자', en: 'Admin', ja: '管理者', zh: '管理员' },
    settings: { desc: '설정 메뉴', ko: '설정', en: 'Settings', ja: '設定', zh: '设置' },
    dev: {
      desc: '개발자 옵션 메뉴',
      ko: '개발자 옵션',
      en: 'Dev Options',
      ja: '開発オプション',
      zh: '开发选项',
    },
  },

  // ─── 공통 (모든 화면) ──────────────────────────────────────
  common: {
    actions: { desc: '액션 버튼 컬럼', ko: '관리', en: 'Actions', ja: '操作', zh: '操作' },
    search: { desc: '검색창 placeholder', ko: '검색', en: 'Search', ja: '検索', zh: '搜索' },
    save: { desc: '저장 버튼', ko: '저장', en: 'Save', ja: '保存', zh: '保存' },
    cancel: { desc: '취소 버튼', ko: '취소', en: 'Cancel', ja: 'キャンセル', zh: '取消' },
    delete: { desc: '삭제 버튼', ko: '삭제', en: 'Delete', ja: '削除', zh: '删除' },
    edit: { desc: '편집 버튼', ko: '편집', en: 'Edit', ja: '編集', zh: '编辑' },
    add: { desc: '추가 버튼', ko: '추가', en: 'Add', ja: '追加', zh: '添加' },
    created_at: {
      desc: '레코드 생성 일시',
      ko: '최초 등록',
      en: 'Created',
      ja: '登録日',
      zh: '创建日',
    },
    updated_at: {
      desc: '레코드 수정 일시',
      ko: '최근 업데이트',
      en: 'Updated',
      ja: '更新日',
      zh: '更新日',
    },
  },
};

// 헬퍼: 기본 라벨 조회 (locale fallback chain)
function getDefaultLabel(scope, key, locale = 'ko') {
  const entry = LABEL_DEFAULTS[scope]?.[key];
  if (!entry) return null;
  return entry[locale] || entry.ko || key;
}

module.exports = { LABEL_DEFAULTS, SUPPORTED_LOCALES, LOCALE_INFO, getDefaultLabel };
