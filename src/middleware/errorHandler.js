const pool = require('../db');

function friendlyError(err) {
  const msg = err.message || String(err);
  if (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid') || msg.includes('PERMISSION_DENIED')) {
    return 'Gemini API 키가 유효하지 않습니다. .env 파일의 GEMINI_API_KEY를 확인 후 서버를 재시작하세요.';
  }
  if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota') || err.status === 429) {
    return 'Gemini API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.';
  }
  if (msg.includes('INVALID_ARGUMENT') || err.status === 400) {
    return '요청 형식 오류입니다: ' + msg;
  }
  return msg;
}

function handleError(res, err) {
  console.error('API Error:', err);
  res.status(500).json({ success: false, error: friendlyError(err) });
}

function logAccess(req, statusCode, durationMs) {
  const skip = ['/api/admin/access-logs', '/api/admin/daily-logs', '/api/admin/top-paths'];
  if (skip.some(p => req.path.startsWith(p))) return;
  pool.query(
    'INSERT INTO access_logs (action, method, path, ip, status_code, duration_ms) VALUES (?,?,?,?,?,?)',
    [req.method + ' ' + req.path, req.method, req.path,
     req.ip || req.connection.remoteAddress, statusCode || 200, durationMs || 0]
  ).catch(() => {});
}

function accessLogMiddleware(req, res, next) {
  if (req.path.startsWith('/admin/access-logs') ||
      req.path.startsWith('/admin/daily-logs') ||
      req.path.startsWith('/admin/top-paths')) return next();
  const start = Date.now();
  res.on('finish', () => {
    pool.query(
      'INSERT IGNORE INTO access_logs (action, method, path, ip, status_code, duration_ms) VALUES (?,?,?,?,?,?)',
      [req.method + ' /api' + req.path, req.method, '/api' + req.path,
       req.ip || '', res.statusCode, Date.now() - start]
    ).catch(() => {});
  });
  next();
}

module.exports = { friendlyError, handleError, logAccess, accessLogMiddleware };
