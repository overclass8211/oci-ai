const router = require('express').Router();
const pool   = require('../db');
const { handleError, logAccess } = require('../middleware/errorHandler');

router.get('/events', async (req, res) => {
  try {
    const { start, end, assigned_to } = req.query;
    let sql = `SELECT e.*, t.name AS assignee_name FROM calendar_events e
               LEFT JOIN team_members t ON e.assigned_to = t.id WHERE 1=1`;
    const params = [];
    if (start)       { sql += ' AND e.start_datetime >= ?'; params.push(start); }
    if (end)         { sql += ' AND e.start_datetime <= ?'; params.push(end); }
    if (assigned_to) { sql += ' AND e.assigned_to = ?';    params.push(assigned_to); }
    sql += ' ORDER BY e.start_datetime ASC LIMIT 2000';
    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) { handleError(res, err); }
});

router.post('/events', async (req, res) => {
  try {
    const { title, description, start_datetime, end_datetime, all_day,
            event_type, status, lead_id, customer_name, assigned_to, color, recurrence } = req.body;
    const [result] = await pool.query(
      `INSERT INTO calendar_events
       (title, description, start_datetime, end_datetime, all_day, event_type,
        status, lead_id, customer_name, assigned_to, color, recurrence)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [title, description || null, start_datetime, end_datetime || null,
       all_day ? 1 : 0, event_type || '기타', status || 'planned',
       lead_id || null, customer_name || null, assigned_to || null,
       color || '#e63946', recurrence || null]);
    logAccess(req, 201);
    res.json({ success: true, id: result.insertId });
  } catch (err) { handleError(res, err); }
});

router.put('/events/:id', async (req, res) => {
  try {
    const fields = ['title','description','start_datetime','end_datetime','all_day',
                    'event_type','status','lead_id','customer_name','assigned_to','color','recurrence'];
    const updates = []; const values = [];
    fields.forEach(f => { if (req.body[f] !== undefined) { updates.push(`${f}=?`); values.push(req.body[f]); } });
    if (!updates.length) return res.json({ success: true });
    values.push(req.params.id);
    await pool.query(`UPDATE calendar_events SET ${updates.join(',')} WHERE id=?`, values);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

router.delete('/events/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM calendar_events WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// 대량 시드 — 2026년 1~4월
router.post('/seed-massive', async (req, res) => {
  try {
    await pool.query('DELETE FROM calendar_events');
    const [leads] = await pool.query(`SELECT id, customer_name, project_name, business_type FROM leads ORDER BY id`);
    if (!leads.length) return res.status(400).json({ success: false, error: '리드가 없어 시드 불가' });

    const [team]  = await pool.query('SELECT id, name FROM team_members WHERE is_active=1');
    const teamIds = team.length ? team.map(t => t.id) : [null];

    const HOLIDAYS = new Set([
      '2026-01-01','2026-02-16','2026-02-17','2026-02-18',
      '2026-03-01','2026-03-02','2026-04-15'
    ]);
    const TYPE_COLORS = {
      '미팅':'#3788d8','영업방문':'#28a745','입찰':'#e63946',
      '제안':'#fd7e14','내부':'#6c757d','기타':'#9c27b0'
    };
    const SLOTS = [
      { hour:9,  types:['미팅','영업방문','내부'] },
      { hour:11, types:['미팅','입찰','제안','내부'] },
      { hour:14, types:['미팅','영업방문','제안','입찰'] },
      { hour:16, types:['영업방문','내부','기타','제안'] }
    ];
    const TITLE_BANK = {
      '미팅':     ['방문 미팅','기술 협의 미팅','킥오프 미팅','진행상황 점검 미팅','임원 보고 미팅','계약 조율 미팅','파트너사 미팅'],
      '영업방문': ['현장 답사','사이트 실사','본사 방문','신규 거래선 발굴 방문','관계 강화 방문','공장 실사'],
      '입찰':     ['입찰서 제출','PQ 제출','입찰 마감 대응','입찰 현장 설명회 참석','Q&A 세션 참석','기술 평가 대응'],
      '제안':     ['견적서 발송','제안서 발표','RFP 입수','제안 PT','상업 조건 협의','가격 협상','최종 제안서 제출'],
      '내부':     ['파이프라인 리뷰','영업 전략 회의','주간 보고','원가 검토','분기 실적 회의','수주 현황 공유'],
      '기타':     ['자료 전달','계약서 검토','전화 상담','이메일 팔로업','샘플 발송','문서 요청 응대']
    };

    const p2  = n => String(n).padStart(2, '0');
    const ymd = d => `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`;
    const dt  = (d, h) => `${ymd(d)} ${p2(h)}:00:00`;
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const rows  = [];

    for (let d = new Date('2026-01-01'); d <= new Date('2026-04-30'); d.setDate(d.getDate() + 1)) {
      const dow = d.getDay();
      if (dow === 0 || dow === 6 || HOLIDAYS.has(ymd(d))) continue;

      const eventCount = 3 + Math.floor(Math.random() * 2);
      const slots  = [...SLOTS].sort(() => Math.random() - 0.5).slice(0, eventCount);
      const status = d < today ? 'completed' : 'planned';

      for (const slot of slots) {
        const lead = pick(leads);
        const type = pick(slot.types);
        rows.push([
          `${lead.customer_name} ${pick(TITLE_BANK[type])}`,
          `${lead.project_name || lead.customer_name} 관련 ${type} — ${lead.business_type || ''}`,
          dt(new Date(d), slot.hour), dt(new Date(d), slot.hour + 1),
          0, type, status, lead.id, lead.customer_name, pick(teamIds), TYPE_COLORS[type]
        ]);
      }
    }

    const BATCH = 50;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const ph    = batch.map(() => '(?,?,?,?,?,?,?,?,?,?,?)').join(',');
      await pool.query(
        `INSERT INTO calendar_events (title,description,start_datetime,end_datetime,all_day,event_type,status,lead_id,customer_name,assigned_to,color) VALUES ${ph}`,
        batch.flat());
    }
    res.json({ success: true, seeded: rows.length, period: '2026-01-01 ~ 2026-04-30' });
  } catch (err) { handleError(res, err); }
});

// 데모 시드
router.post('/seed-demo', async (req, res) => {
  try {
    const [[cnt]] = await pool.query('SELECT COUNT(*) AS c FROM calendar_events');
    if (cnt.c >= 5) return res.json({ success: true, seeded: 0, message: '이미 충분한 데이터 있음' });

    const [leads] = await pool.query('SELECT id, customer_name, project_name FROM leads ORDER BY updated_at DESC LIMIT 15');
    if (!leads.length) return res.json({ success: true, seeded: 0, message: '리드 없음' });

    const typeColors = { '미팅':'#3788d8','영업방문':'#28a745','입찰':'#e63946','제안':'#fd7e14','내부':'#6c757d','기타':'#adb5bd' };
    const typeTitles = {
      '미팅':     ['킥오프 미팅','제품 소개 미팅','기술 협의 미팅','견적 검토 미팅','상황 점검 미팅'],
      '영업방문': ['현장 실사 방문','고객 니즈 파악','관계 강화 방문','경쟁 현황 파악'],
      '입찰':     ['입찰서류 제출','기술 평가 대응','현장 설명회 참석','Q&A 세션'],
      '제안':     ['기술 제안 발표','상업 조건 협의','최종 제안서 제출','가격 협상'],
      '내부':     ['주간 파이프라인 리뷰','영업 전략 회의','팀 브리핑','원가 검토 회의'],
      '기타':     ['전화 상담','이메일 팔로업','서류 전달','계약서 검토']
    };
    const types = Object.keys(typeColors);
    const now   = new Date();
    const p2    = n => String(n).padStart(2, '0');
    const fmtDT = d => `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())} ${p2(d.getHours())}:00:00`;

    for (let i = 0; i < 28; i++) {
      const offset = Math.floor(Math.random() * 110) - 30;
      const date   = new Date(now); date.setDate(date.getDate() + offset); date.setHours(9 + Math.floor(Math.random() * 8), 0, 0, 0);
      const endDate = new Date(date); endDate.setHours(date.getHours() + 1, 0, 0, 0);
      const lead  = leads[Math.floor(Math.random() * leads.length)];
      const type  = types[Math.floor(Math.random() * types.length)];
      const subtl = typeTitles[type][Math.floor(Math.random() * typeTitles[type].length)];
      await pool.query(
        `INSERT INTO calendar_events (title,description,start_datetime,end_datetime,all_day,event_type,lead_id,customer_name,assigned_to,color)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [`[${type}] ${lead.customer_name} ${subtl}`,
         `${lead.project_name || lead.customer_name} 관련 ${type} 일정`,
         fmtDT(date), fmtDT(endDate), 0, type, lead.id, lead.customer_name, null, typeColors[type]]);
    }
    res.json({ success: true, seeded: 28 });
  } catch (err) { handleError(res, err); }
});

module.exports = router;
