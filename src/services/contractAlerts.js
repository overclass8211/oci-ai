'use strict';
// =============================================================
// Contract Alerts Service — Phase 4 (만료 알림 큐)
//
// 정책:
//   - end_date 가 설정된 계약은 2회 알림 자동 enqueue:
//     · 1차: D-`renewal_notice_days` (기본 30일)
//     · 2차: D-7 (마지막 경고, 1차와 동일하면 1건만)
//   - terminated / expired 상태로 전이 시 pending 알림 cancel
//   - end_date 변경 시 기존 pending 모두 cancel 후 재 enqueue
//
// 알림 채널 (Commit 2 에서 cron 등록):
//   - in-app: contract_alerts 테이블 자체가 큐 (UI 가 직접 조회)
//   - email: CONTRACT_ALERT_EMAIL_ENABLED 환경변수 토글 (옵션)
//
// 상태:
//   - pending: 발송 대기
//   - sent:    발송 완료 (sent_at 기록)
//   - cancelled: 취소됨 (계약 해지/만료/수동)
// =============================================================

const pool = require('../db');

// 1차 알림은 사용자 설정, 2차는 D-7 고정 (마지막 경고)
const FINAL_NOTICE_DAYS = 7;

// 알림 타입 (DB column 'alert_type' 에 저장)
//   notice_NN: NN 일 전 알림 (예: notice_30, notice_7)
function _alertTypeForDays(daysBefore) {
  return `notice_${daysBefore}`;
}

// end_date 에서 N 일 전 날짜를 'YYYY-MM-DD' 로 계산
function _calcScheduledDate(endDate, daysBefore) {
  if (!endDate) return null;
  const d = new Date(endDate);
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() - daysBefore);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 계약의 만료 알림 enqueue (idempotent)
//   - 기존 pending 알림 모두 cancel 후 재 enqueue (end_date 변경 시 안전)
//   - sent 알림은 보존 (이미 발송된 이력)
// 반환: { enqueued: [{alert_type, scheduled_for}], skipped: [...] }
async function enqueueExpiryAlerts(contractId, endDate, noticeDays, opts = {}) {
  if (!contractId || !endDate) return { enqueued: [], skipped: ['end_date 없음'] };
  const days1 = Math.max(1, parseInt(noticeDays, 10) || 30);
  const days2 = FINAL_NOTICE_DAYS;

  // pending 알림 cancel (재 enqueue 전 정리)
  await pool.query(
    `UPDATE contract_alerts
        SET status = 'cancelled'
      WHERE contract_id = ?
        AND status = 'pending'`,
    [contractId]
  );

  const scheduledDates = new Set();
  const enqueued = [];
  const skipped = [];

  // 1차 (사용자 설정)
  const date1 = _calcScheduledDate(endDate, days1);
  if (date1 && !scheduledDates.has(date1)) {
    scheduledDates.add(date1);
    await pool.query(
      `INSERT INTO contract_alerts
        (contract_id, alert_type, scheduled_for, status, channel)
       VALUES (?, ?, ?, 'pending', ?)`,
      [contractId, _alertTypeForDays(days1), date1, opts.channel || 'inapp']
    );
    enqueued.push({
      alert_type: _alertTypeForDays(days1),
      scheduled_for: date1,
      days_before: days1,
    });
  }

  // 2차 (마지막 경고 D-7) — 1차와 다른 날짜일 때만
  if (days1 !== days2) {
    const date2 = _calcScheduledDate(endDate, days2);
    if (date2 && !scheduledDates.has(date2)) {
      scheduledDates.add(date2);
      await pool.query(
        `INSERT INTO contract_alerts
          (contract_id, alert_type, scheduled_for, status, channel)
         VALUES (?, ?, ?, 'pending', ?)`,
        [contractId, _alertTypeForDays(days2), date2, opts.channel || 'inapp']
      );
      enqueued.push({
        alert_type: _alertTypeForDays(days2),
        scheduled_for: date2,
        days_before: days2,
      });
    } else if (date2) {
      skipped.push(`D-${days2} (중복 날짜)`);
    }
  } else {
    skipped.push(`D-${days2} (1차와 동일 일수)`);
  }

  return { enqueued, skipped };
}

// 계약의 pending 알림 모두 cancel
//   - sent 알림은 보존 (이력 유지)
// 반환: { cancelled: 건수 }
async function cancelAlerts(contractId, reason) {
  if (!contractId) return { cancelled: 0 };
  const [result] = await pool.query(
    `UPDATE contract_alerts
        SET status = 'cancelled'
      WHERE contract_id = ?
        AND status = 'pending'`,
    [contractId]
  );
  return { cancelled: result.affectedRows, reason: reason || null };
}

// 한글 알림 메시지 생성 (in-app + email 본문에 사용)
function _buildAlertMessage(contract, daysLeft) {
  const c = contract || {};
  const customer = c.customer_name || '(고객사 미정)';
  const title = c.title || c.contract_no || '계약';
  const autoRenewal = c.auto_renewal === 1 || c.auto_renewal === true;
  const endDate = c.end_date ? new Date(c.end_date).toISOString().slice(0, 10) : '(종료일 미정)';

  let actionGuide;
  if (daysLeft <= 0) {
    actionGuide = autoRenewal
      ? '⚠️ 만료일이 지났습니다. 자동갱신 정책 확인 후 후속 조치하세요.'
      : '⚠️ 만료일이 지났습니다. 즉시 갱신/해지 결정 필요.';
  } else if (autoRenewal) {
    actionGuide =
      `🔄 자동갱신 계약입니다. 갱신을 원하지 않으면 ${daysLeft}일 이내에 ` +
      `상대방에게 종료 통지하세요.`;
  } else {
    actionGuide =
      `📋 ${daysLeft}일 이내에 갱신 여부를 결정하세요. ` +
      `갱신 시 협상 시작, 종료 시 후속 인수인계 준비.`;
  }

  return {
    title: `[계약 만료 ${daysLeft >= 0 ? `D-${daysLeft}` : `${Math.abs(daysLeft)}일 경과`}] ${title}`,
    body:
      `계약: ${title} (${c.contract_no || '-'})\n` +
      `고객사: ${customer}\n` +
      `종료일: ${endDate}\n` +
      `\n${actionGuide}`,
    autoRenewal,
    daysLeft,
  };
}

// 알림 큐 처리 (cron 트리거 시점)
//   - pending + scheduled_for ≤ today 인 알림을 처리
//   - in-app: status='sent' + sent_at=NOW() (UI 가 직접 조회 — 별도 notification INSERT 없음)
//   - email: opts.sendEmail=true 일 때만 (Commit 2 에서 활성화)
//   - opts.now: 테스트용 (지정한 날짜로 처리)
// 반환: { processed: 건수, errors: [...] }
async function processAlertQueue(opts = {}) {
  const errors = [];
  let processed = 0;

  // 처리 대상 조회 (계약 + owner 정보 JOIN)
  const [rows] = await pool.query(
    `SELECT ca.id AS alert_id, ca.contract_id, ca.alert_type, ca.scheduled_for,
            ca.channel, c.contract_no, c.title, c.customer_name,
            c.end_date, c.auto_renewal, c.owner_id, c.owner_name,
            tm.email AS owner_email
       FROM contract_alerts ca
       JOIN contracts c ON c.id = ca.contract_id
       LEFT JOIN team_members tm ON tm.id = c.owner_id
      WHERE ca.status = 'pending'
        AND ca.scheduled_for <= ${opts.now ? '?' : 'CURRENT_DATE()'}
      ORDER BY ca.scheduled_for ASC
      LIMIT 500`,
    opts.now ? [opts.now] : []
  );

  for (const row of rows) {
    try {
      // daysLeft = end_date - today (또는 opts.now)
      const today = opts.now ? new Date(opts.now) : new Date();
      const end = new Date(row.end_date);
      const daysLeft = Math.floor((end - today) / (1000 * 60 * 60 * 24));
      const msg = _buildAlertMessage(row, daysLeft);

      // 이메일 발송 (옵션 토글 + owner 이메일 있을 때만)
      if (opts.sendEmail && row.owner_email && opts.emailSender) {
        try {
          await opts.emailSender({
            to: row.owner_email,
            subject: msg.title,
            text: msg.body,
            contract_id: row.contract_id,
          });
        } catch (e) {
          errors.push({
            alert_id: row.alert_id,
            error: 'email send failed: ' + (e.message || e),
          });
        }
      }

      // status='sent' 갱신 (in-app 큐는 UI 가 직접 조회)
      await pool.query(
        `UPDATE contract_alerts
            SET status = 'sent', sent_at = ${opts.now ? '?' : 'NOW()'}
          WHERE id = ?`,
        opts.now ? [opts.now, row.alert_id] : [row.alert_id]
      );
      processed += 1;
    } catch (e) {
      errors.push({ alert_id: row.alert_id, error: e.message || String(e) });
    }
  }

  return { processed, errors, total_candidates: rows.length };
}

module.exports = {
  enqueueExpiryAlerts,
  cancelAlerts,
  processAlertQueue,
  _buildAlertMessage, // 테스트용 export
  FINAL_NOTICE_DAYS,
};
