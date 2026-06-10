const express = require('express');
const WebSocket = require('ws');
const app = express();
app.use(express.json());

let get5Events = [];
let matchState = {
  map: null,
  team1: { name: 'CT', score: 0 },
  team2: { name: 'TR', score: 0 },
  round: 0,
  phase: 'aguardando',
  players: {},
};
let consoleData = { players: [], map: null, updated: null };
let consoleLines = [];

// ─── PTERODACTYL CONFIG ───────────────────────────────────────────────────────
const PTERO_URL = 'https://painel3.firegamesnetwork.com';
const PTERO_KEY = 'ptlc_xWQ2v95dY1ds00JAX39dQPVuwivxCe0aBLNF1QZhzYt';
const SERVER_ID = 'a93a9b62';

let wsClient = null;
let wsToken = null;
let wsSocketUrl = null;
let reconnectTimer = null;

async function fetchWsCredentials() {
  try {
    const res = await fetch(`${PTERO_URL}/api/client/servers/${SERVER_ID}/websocket`, {
      headers: {
        'Authorization': `Bearer ${PTERO_KEY}`,
        'Accept': 'application/json'
      }
    });
    const data = await res.json();
    console.log('WS credentials response:', JSON.stringify(data));  // DEBUG
    wsToken = data.data.token;
    wsSocketUrl = data.data.socket;
    console.log('Socket URL recebida:', wsSocketUrl);  // DEBUG
    return true;
  } catch (e) {
    console.error('Failed to fetch WS credentials:', e.message);
    return false;
  }
}

function parseStatusBlock(lines) {
  const players = [];
  for (const line of lines) {
    const m = line.match(/^\s*#\s*(\d+)\s+"(.+?)"\s+(\S+)\s+(\d+)\s+(\d+:\d+)/);
    if (m && m[2] !== 'SourceTV') {
      players.push({ userid: m[1], name: m[2], steamid: m[3], ping: m[4] });
    }
  }
  const mapLine = lines.find(l => l.includes('map     :') || l.match(/map\s*:\s*\S+/));
  let map = null;
  if (mapLine) {
    const mm = mapLine.match(/map\s*:\s*(\S+)/);
    if (mm) map = mm[1];
  }
  return { players, map };
}

function processConsoleLine(line) {
  consoleLines.push(line);
  if (consoleLines.length > 300) consoleLines = consoleLines.slice(-300);

  if (line.includes('#end') && consoleLines.some(l => l.includes('map     :'))) {
    const parsed = parseStatusBlock(consoleLines);
    if (parsed.map) {
      consoleData = { ...parsed, updated: Date.now() };
      matchState.map = parsed.map;
    }
  }
}

async function sendWsCommand(command) {
  if (wsClient && wsClient.readyState === WebSocket.OPEN) {
    wsClient.send(JSON.stringify({ event: 'send command', args: [command] }));
  }
}

async function connectWebSocket() {
  const ok = await fetchWsCredentials();
  if (!ok) {
    reconnectTimer = setTimeout(connectWebSocket, 10000);
    return;
  }

  // Se a URL vier com IP:8080, troca pelo domínio
  if (wsSocketUrl && wsSocketUrl.includes('103.14.27.41:8080')) {
    wsSocketUrl = wsSocketUrl.replace('ws://103.14.27.41:8080', 'wss://painel3.firegamesnetwork.com');
    console.log('Socket URL corrigida para:', wsSocketUrl);
  }

  console.log('Connecting to Pterodactyl WebSocket...');
  wsClient = new WebSocket(wsSocketUrl, {
    headers: { 'Origin': PTERO_URL }
  });

  wsClient.on('open', () => {
    console.log('WebSocket connected!');
    wsClient.send(JSON.stringify({ event: 'auth', args: [wsToken] }));
  });

  wsClient.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log('WS event:', msg.event);  // DEBUG
      if (msg.event === 'console output' && msg.args) {
        msg.args.forEach(line => processConsoleLine(line));
      }
      if (msg.event === 'token expiring' || msg.event === 'token expired') {
        fetchWsCredentials().then(() => {
          if (wsToken) wsClient.send(JSON.stringify({ event: 'auth', args: [wsToken] }));
        });
      }
    } catch (e) {}
  });

  wsClient.on('close', () => {
    console.log('WebSocket closed, reconnecting in 5s...');
    reconnectTimer = setTimeout(connectWebSocket, 5000);
  });

  wsClient.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });
}

setInterval(() => sendWsCommand('status'), 5000);
connectWebSocket();

// ─── GET5 / MATCHZY WEBHOOK ───────────────────────────────────────────────────
app.post('/get5', (req, res) => {
  const body = req.body;
  if (!body || !body.event) return res.sendStatus(400);
  const ev = body.event;
  const p = body.params || {};

  get5Events.unshift({ event: ev, params: p, ts: Date.now() });
  if (get5Events.length > 100) get5Events.pop();

  switch (ev) {
    case 'game_state_changed':
      matchState.phase = p.new_state || matchState.phase;
      break;
    case 'series_start':
      matchState.team1.name = p.team1_name || 'CT';
      matchState.team2.name = p.team2_name || 'TR';
      matchState.team1.score = 0;
      matchState.team2.score = 0;
      matchState.round = 0;
      matchState.players = {};
      break;
    case 'round_start':
      matchState.round = p.round_number ?? matchState.round;
      break;
    case 'round_end':
      matchState.round = p.round_number ?? matchState.round;
      matchState.team1.score = p.team1_score ?? matchState.team1.score;
      matchState.team2.score = p.team2_score ?? matchState.team2.score;
      break;
    case 'player_death': {
      const killer = p.attacker_steamid;
      if (killer && killer !== p.victim_steamid) {
        if (!matchState.players[killer]) matchState.players[killer] = { name: p.attacker_name || killer, kills: 0, deaths: 0, assists: 0 };
        matchState.players[killer].kills++;
        matchState.players[killer].name = p.attacker_name || killer;
      }
      const victim = p.victim_steamid;
      if (victim) {
        if (!matchState.players[victim]) matchState.players[victim] = { name: p.victim_name || victim, kills: 0, deaths: 0, assists: 0 };
        matchState.players[victim].deaths++;
        matchState.players[victim].name = p.victim_name || victim;
      }
      if (p.assister_steamid) {
        const a = p.assister_steamid;
        if (!matchState.players[a]) matchState.players[a] = { name: p.assister_name || a, kills: 0, deaths: 0, assists: 0 };
        matchState.players[a].assists++;
      }
      break;
    }
    case 'map_picked':
      if (p.map_name) matchState.map = p.map_name;
      break;
    case 'series_end':
      matchState.phase = 'encerrado';
      break;
  }
  res.sendStatus(200);
});

app.post('/', (req, res) => {
  const body = req.body;
  if (body && body.event) {
    get5Events.unshift({ event: body.event, params: body, ts: Date.now() });
    if (get5Events.length > 100) get5Events.pop();
  }
  res.sendStatus(200);
});

app.get('/state', (req, res) => {
  res.json({ matchState, get5Events: get5Events.slice(0, 50), consoleData });
});

// ─── FRONTEND ─────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CS2 Live</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { background:#0a0a0f; color:#e0e0e0; font-family:'Segoe UI',sans-serif; min-height:100vh; }
header { background:#111118; padding:10px 16px; display:flex; align-items:center; border-bottom:1px solid #222; }
header h1 { font-size:14px; font-weight:600; letter-spacing:2px; text-transform:uppercase; color:#f0a500; }
#status { font-size:11px; color:#666; margin-left:auto; }
#status.live { color:#4caf50; }
.container { padding:12px; display:flex; flex-direction:column; gap:12px; max-width:500px; margin:0 auto; }
.card { background:#111118; border-radius:8px; padding:10px 14px; }
.card-title { font-size:11px; color:#666; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px; }
.scoreboard { display:flex; align-items:center; justify-content:space-between; }
.team { display:flex; flex-direction:column; align-items:center; gap:4px; flex:1; }
.team-name { font-size:12px; color:#aaa; text-transform:uppercase; letter-spacing:1px; }
.team-score { font-size:40px; font-weight:800; color:#f0a500; line-height:1; }
.score-divider { font-size:20px; color:#333; padding:0 8px; }
.round-info { text-align:center; font-size:11px; color:#666; margin-top:6px; }
.player-row { display:flex; align-items:center; gap:8px; padding:5px 0; border-bottom:1px solid #1a1a22; font-size:12px; }
.player-row:last-child { border-bottom:none; }
.player-name { flex:1; }
.kda { color:#888; font-size:11px; font-family:monospace; }
.map-name { font-size:18px; font-weight:700; color:#f0a500; }
.event-row { font-size:11px; color:#888; padding:4px 0; border-bottom:1px solid #1a1a22; display:flex; gap:6px; }
.event-row:last-child { border-bottom:none; }
.event-type { color:#f0a500; white-space:nowrap; }
.event-time { color:#444; font-size:10px; white-space:nowrap; margin-left:auto; }
.no-data { text-align:center; padding:40px 20px; color:#444; font-size:13px; }
</style>
</head>
<body>
<header><h1>⚡ CS2 Live</h1><span id="status">aguardando...</span></header>
<div class="container">
  <div id="nodata" class="no-data">Aguardando partida...<br><small>Conectando via WebSocket</small></div>
  <div id="score-card" class="card" style="display:none">
    <div class="card-title">Placar</div>
    <div class="scoreboard">
      <div class="team"><div class="team-name" id="team1-name">CT</div><div class="team-score" id="team1-score">0</div></div>
      <div class="score-divider">×</div>
      <div class="team"><div class="team-score" id="team2-score">0</div><div class="team-name" id="team2-name">TR</div></div>
    </div>
    <div class="round-info">Round <span id="round-num">—</span> · <span id="phase-text">—</span></div>
  </div>
  <div id="map-card" class="card" style="display:none">
    <div class="card-title">Mapa</div>
    <div class="map-name" id="map-name">—</div>
  </div>
  <div id="players-card" class="card" style="display:none">
    <div class="card-title">Jogadores</div>
    <div id="players-list"></div>
  </div>
  <div id="events-card" class="card" style="display:none">
    <div class="card-title">Eventos recentes</div>
    <div id="events-list"></div>
  </div>
</div>
<script>
function timeSince(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return s + 's atrás';
  return Math.floor(s/60) + 'min atrás';
}
function eventDesc(ev, p) {
  switch(ev) {
    case 'player_death': return (p.attacker_name||'?') + ' ➜ ' + (p.victim_name||'?') + (p.weapon ? ' ['+p.weapon+']' : '');
    case 'round_end': return 'Round ' + (p.round_number||'?') + ' encerrado';
    case 'bomb_planted': return '💣 Plantada por ' + (p.player_name||'?');
    case 'bomb_defused': return '✅ Defusada por ' + (p.player_name||'?');
    case 'bomb_exploded': return '💥 Bomba explodiu!';
    case 'series_start': return '🟢 Série iniciada';
    case 'series_end': return '🏁 Série encerrada';
    default: return ev;
  }
}
async function fetchState() {
  try {
    const res = await fetch('/state');
    const data = await res.json();
    const ms = data.matchState || {};
    const events = data.get5Events || [];
    const cd = data.consoleData || {};
    const hasMatch = ms.phase && ms.phase !== 'aguardando';
    const hasPlayers = Object.keys(ms.players || {}).length > 0;
    const hasConsole = cd.players && cd.players.length > 0;
    const map = ms.map || cd.map;
    const hasData = hasMatch || hasPlayers || hasConsole || map;
    document.getElementById('nodata').style.display = hasData ? 'none' : 'block';
    const statusEl = document.getElementById('status');
    statusEl.textContent = hasData ? '● AO VIVO' : 'aguardando...';
    statusEl.className = hasData ? 'live' : '';
    const showScore = hasMatch || (ms.team1 && (ms.team1.score > 0 || ms.team2.score > 0));
    document.getElementById('score-card').style.display = showScore ? 'block' : 'none';
    if (showScore) {
      document.getElementById('team1-name').textContent = ms.team1?.name || 'CT';
      document.getElementById('team2-name').textContent = ms.team2?.name || 'TR';
      document.getElementById('team1-score').textContent = ms.team1?.score ?? 0;
      document.getElementById('team2-score').textContent = ms.team2?.score ?? 0;
      document.getElementById('round-num').textContent = ms.round || '—';
      document.getElementById('phase-text').textContent = ms.phase || '—';
    }
    document.getElementById('map-card').style.display = map ? 'block' : 'none';
    if (map) document.getElementById('map-name').textContent = map;
    document.getElementById('players-card').style.display = (hasPlayers || hasConsole) ? 'block' : 'none';
    if (hasPlayers) {
      const list = document.getElementById('players-list');
      list.innerHTML = Object.values(ms.players).sort((a,b)=>b.kills-a.kills).map(p =>
        '<div class="player-row"><span class="player-name">'+p.name+'</span><span class="kda">'+p.kills+'/'+p.deaths+'/'+p.assists+'</span></div>'
      ).join('');
    } else if (hasConsole) {
      const list = document.getElementById('players-list');
      list.innerHTML = cd.players.map(p =>
        '<div class="player-row"><span class="player-name">'+p.name+'</span><span class="kda">'+p.ping+'ms</span></div>'
      ).join('');
    }
    document.getElementById('events-card').style.display = events.length > 0 ? 'block' : 'none';
    if (events.length > 0) {
      document.getElementById('events-list').innerHTML = events.slice(0,15).map(ev =>
        '<div class="event-row"><span class="event-type">'+ev.event+'</span><span style="flex:1">'+eventDesc(ev.event,ev.params||{})+'</span><span class="event-time">'+timeSince(ev.ts)+'</span></div>'
      ).join('');
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
