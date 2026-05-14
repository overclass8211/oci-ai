'use strict';
/**
 * WebSocket 서버
 * - 연결 시 JWT 토큰 검증 (쿼리스트링 ?token=... 또는 Authorization 헤더)
 * - 미인증 연결은 즉시 종료 (코드 4001)
 */
const WebSocket = require('ws');
const { verifyToken, blacklistHas } = require('./services/authService');

let wss = null;
const wsClients = new Set();

function init(server) {
  wss = new WebSocket.Server({ server, verifyClient });
  wss.on('connection', (ws, req) => {
    // verifyClient를 통과한 인증된 연결만 여기까지 도달
    wsClients.add(ws);
    ws.on('close', () => wsClients.delete(ws));
    ws.on('error', () => wsClients.delete(ws));
  });
}

/**
 * WebSocket 연결 전 JWT 검증 콜백
 * 반환값: true → 연결 허용 / false → 거절
 */
function verifyClient(info, callback) {
  // 개발/테스트 환경에서는 인증 생략
  if (process.env.NODE_ENV === 'test') return callback(true);

  try {
    // WHATWG URL API로 쿼리스트링 파싱 (url.parse deprecation 대응)
    const reqUrl = new URL(info.req.url, 'http://localhost');
    // 1) 쿼리스트링에서 토큰 추출: ws://host/...?token=JWT
    // 2) Upgrade 요청의 Authorization 헤더
    const authHeader = info.req.headers['authorization'] || '';
    const token = reqUrl.searchParams.get('token') || (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null);

    if (!token) {
      return callback(false, 401, 'Unauthorized: 토큰이 없습니다.');
    }

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (_) {
      return callback(false, 401, 'Unauthorized: 유효하지 않은 토큰입니다.');
    }

    // 블랙리스트 확인 (인메모리)
    if (decoded.jti && blacklistHas(decoded.jti)) {
      return callback(false, 401, 'Unauthorized: 만료된 세션입니다.');
    }

    callback(true);
  } catch (_) {
    callback(false, 500, 'Internal Server Error');
  }
}

function wsBroadcast(data) {
  const msg = JSON.stringify(data);
  wsClients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

function getClientCount() { return wsClients.size; }

module.exports = { init, wsBroadcast, getClientCount };
