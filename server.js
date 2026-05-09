// =============================================================
// OCI CRM — 서버 진입점
// =============================================================
const express = require('express');
const http    = require('http');
const cors    = require('cors');
const path    = require('path');
require('dotenv').config({ override: true });

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3000;

// WebSocket
const ws = require('./src/ws');
ws.init(server);

// 미들웨어
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// API 접근 로그
const { accessLogMiddleware } = require('./src/middleware/errorHandler');
app.use('/api', accessLogMiddleware);

// 라우트 등록
app.use('/api/dashboard',   require('./src/routes/dashboard'));
app.use('/api/leads',       require('./src/routes/leads'));
app.use('/api/products',    require('./src/routes/products'));
app.use('/api/projects',    require('./src/routes/projects'));
app.use('/api/team',        require('./src/routes/team'));
app.use('/api/customers',   require('./src/routes/customers'));
app.use('/api/activities',  require('./src/routes/activities'));
app.use('/api/ai',          require('./src/routes/ai'));
app.use('/api/admin',       require('./src/routes/admin'));
app.use('/api/calendar',    require('./src/routes/calendar'));
app.use('/api/meeting',     require('./src/routes/meetings'));   // STT + 요약
app.use('/api/meetings',    require('./src/routes/meetings'));   // CRUD
app.use('/api/board',       require('./src/routes/board'));
app.use('/api/upload',      require('./src/routes/upload'));
app.use('/uploads',         require('./src/routes/upload'));
app.use('/api/notifications', require('./src/routes/notifications'));

// SPA 폴백
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const { initTables } = require('./src/initTables');
const pool = require('./src/db');

// 직접 실행 시에만 listen + DB 초기화 (테스트에서는 app/pool import)
if (require.main === module) {
  (async () => {
    try {
      const conn = await pool.getConnection();
      console.log('✅ MariaDB 연결 성공:', process.env.DB_HOST + ':' + (process.env.DB_PORT || 3306));
      conn.release();
    } catch (err) {
      console.error('❌ MariaDB 연결 실패:', err.message);
    }
  })();
  initTables();
  server.listen(PORT, () => {
    console.log('═════════════════════════════════════════════');
    console.log('  🔴 OCI CRM 서버 시작');
    console.log('  📍 http://localhost:' + PORT);
    console.log('  🔌 WebSocket 활성화');
    console.log('═════════════════════════════════════════════');
  });
}

module.exports = { app, server, pool };
