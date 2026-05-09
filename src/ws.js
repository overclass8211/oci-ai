const WebSocket = require('ws');

let wss = null;
const wsClients = new Set();

function init(server) {
  wss = new WebSocket.Server({ server });
  wss.on('connection', (ws) => {
    wsClients.add(ws);
    ws.on('close', () => wsClients.delete(ws));
  });
}

function wsBroadcast(data) {
  const msg = JSON.stringify(data);
  wsClients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

function getClientCount() { return wsClients.size; }

module.exports = { init, wsBroadcast, getClientCount };
