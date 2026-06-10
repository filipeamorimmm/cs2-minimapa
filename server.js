const express = require('express');
const net = require('net');
const app = express();
app.use(express.json());

let gameState = {};
let matchzyEvents = [];
let rconData = {};

// RCON config
const RCON_HOST = '103.14.27.41';
const RCON_PORT = 27288;
const RCON_PASSWORD = 'minimapa123';

// RCON implementation
class RCON {
  constructor(host, port, password) {
    this.host = host;
    this.port = port;
    this.password = password;
    this.id = 1;
  }

  createPacket(id, type, body) {
    const bodyBuffer = Buffer.from(body + '\0', 'utf8');
    const buf = Buffer.alloc(4 + 4 + 4 + bodyBuffer.length + 1);
    buf.writeInt32LE(buf.length - 4, 0);
    buf.writeInt32LE(id, 4);
    buf.writeInt32LE(type, 8);
    bodyBuffer.copy(buf, 12);
    buf.writeUInt8(0, buf.length - 1);
    return buf;
  }

  send(command) {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      let buffer = Buffer.alloc(0);
      let authenticated = false;
      let timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error('timeout'));
      }, 5000);

      socket.connect(this.port, this.host, () => {
        socket.write(this.createPacket(1, 3, this.password));
      });

      socket.on('data', (data) => {
        buffer = Buffer.concat([buffer, data]);
        while (buffer.length >= 4) {
          const len = buffer.readInt32LE(0) + 4;
          if (buffer.length < len) break;
          const packet = buffer.slice(0, len);
          buffer = buffer.slice(len);
          const type = packet.readInt32LE(8);
          const body = packet.slice(12, packet.length - 2).toString('utf8');
          if (!authenticated) {
            authenticated = true;
            socket.write(this.createPacket(2, 2, command));
          } else {
            clearTimeout(timeout);
            socket.destroy();
            resolve(body);
          }
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }
}

const rcon = new RCON(RCON_HOST, RCON_PORT, RCON_PASSWORD);

async function parseStatus(raw) {
  const lines = raw.split('\n');
  const players = [];
  for (const line of lines) {
    const m = line.match(/^\s*#\s*(\d+)\s+"(.+?)"\s+(\S+)\s+(\d+)\s+(\d+:\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\S+)/);
    if (m) {
      players.push({ userid: m[1], name: m[2], steamid: m[3], ping: m[4] });
    }
  }
  const mapM = raw.match(/map\s*:\s*(\S+)/);
  const map = mapM ? mapM[1] : null;
  return { players, map };
}

async function pollRcon() {
  try {
    const [statusRaw, scoreRaw] = await Promise.all([
      rcon.send('status'),
      rcon.send('mp_teamname_1; mp_teamname_2; mp_ct_wins; mp_t_wins')
    ]);
    const status = await parseStatus(statusRaw);
    rconData = { ...status, raw: statusRaw, updated: Date.now() };
  } catch (e) {
    // silently fail
  }
}

setInterval(pollRcon, 3000);
pollRcon();

// Recebe dados do GSI/MatchZy
app.post('/', (req, res) => {
  const body = req.body;
  if (body.event) {
    matchzyEvents.unshift(body);
    if (matchzyEvents.length > 50) matchzyEvents.pop();
    if (body.team1_score !== undefined) gameState.matchzy = body;
  } else {
    gameState = body;
  }
  res.sendStatus(200);
});

app.get('/state', (req, res) => {
  res.json({ gameState, matchzyEvents, rconData });
});

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CS2 Live</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { background:#0a0a0f; color:#e0e0e0; font-family:'Segoe UI',sans-serif; }
header { background:#111118; padding:10px 16px; display:flex; align-items:center; border-bottom:1px solid #222; }
header h1 { font-size:14px; font-weight:600; letter-spacing:2px; text-transform:uppercase; color:#f0a500; }
#status { font-size:11px; color:#666; margin-left:auto; }
#status.live { color:#4caf50; }
.container { padding:12px; display:flex; flex-direction:column; gap:12px; }
.card { background:#111118; border-radius:8px; padding:10px 14px; }
.card-title { font-size:11px; color:#666; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px; }
.player-row { display:flex; align-items:center; gap:8px; padding:4px 0; border-bottom:1px solid #1a1a22; }
.player-row:last-child { border-bottom:none; }
.player-name { flex:1; font-size:12px; }
.player-ping { font-size:11px; color:#888; }
.map-name { font-size:18px; font-weight:700; color:#f0a500; }
.no-data { text-align:center; padding:40px 20px; color:#444; font-size:13px; }
.event-row { font-size:11px; color:#888; padding:3px 0; border-bottom:1px solid #1a1a22; }
.event-type { color:#f0a500; margin-right:6px; }
</style>
</head>
<body>
<header><h1>⚡ CS2 Live</h1><span id="status">aguardando...</span></header>
<div class="container">
  <div id="nodata" class="no-data">Aguardando partida...<br><small>Conectando ao servidor via RCON...</small></div>
  <div id="map-card" class="card" style="display:none">
    <div class="card-title">Mapa atual</div>
    <div class="map-name" id="map-name">—</div>
  </div>
  <div id="players-card" class="card" style="display:none">
    <div class="card-title">Jogadores online</div>
    <div id="players-list"></div>
  </div>
  <div id="events-card" class="card" style="display:none">
    <div class="card-title">Eventos recentes</div>
    <div id="events-list"></div>
  </div>
</div>
<script>
async function fetchState() {
  try {
    const res = await fetch('/state');
    const data = await res.json();
    const rcon = data.rconData || {};
    const events = data.matchzyEvents || [];

    const hasPlayers = rcon.players && rcon.players.length > 0;
    const hasData = hasPlayers || rcon.map;

    document.getElementById('nodata').style.display = hasData ? 'none' : 'block';
    document.getElementById('map-card').style.display = rcon.map ? 'block' : 'none';
    document.getElementById('players-card').style.display = hasPlayers ? 'block' : 'none';
    document.getElementById('events-card').style.display = events.length > 0 ? 'block' : 'none';

    const statusEl = document.getElementById('status');
    statusEl.textContent = hasData ? '● AO VIVO' : 'aguardando...';
    statusEl.className = hasData ? 'live' : '';

    if (rcon.map) {
      document.getElementById('map-name').textContent = rcon.map;
    }

    if (hasPlayers) {
      const list = document.getElementById('players-list');
      list.innerHTML = '';
      rcon.players.forEach(p => {
        const row = document.createElement('div');
        row.className = 'player-row';
        row.innerHTML = '<span class="player-name">' + p.name + '</span><span class="player-ping">' + p.ping + 'ms</span>';
        list.appendChild(row);
      });
    }

    if (events.length > 0) {
      const evEl = document.getElementById('events-list');
      evEl.innerHTML = '';
      events.slice(0, 10).forEach(ev => {
        const row = document.createElement('div');
        row.className = 'event-row';
        let desc = '';
        if (ev.event === 'player_death') desc = (ev.attacker_name || '?') + ' matou ' + (ev.player_name || '?');
        else if (ev.event === 'round_end') desc = 'Round ' + (ev.round_number || '?') + ' encerrado';
        else if (ev.event === 'bomb_planted') desc = '💣 Bomba plantada!';
        else if (ev.event === 'bomb_defused') desc = '✅ Bomba defusada!';
        else desc = ev.event || '';
        row.innerHTML = '<span class="event-type">' + (ev.event || '') + '</span>' + desc;
        evEl.appendChild(row);
      });
    }
  } catch(e) {}
}
setInterval(fetchState, 2000);
fetchState();
</script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('CS2 Live rodando na porta ' + PORT));
