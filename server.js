const express = require('express');
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
let pterodactylData = { players: [], map: null, updated: null, raw: '' };

// ─── PTERODACTYL CONFIG ───────────────────────────────────────────────────────
const PTERO_URL = 'https://painel3.firegamesnetwork.com';
const PTERO_KEY = 'ptlc_xWQ2v95dY1ds00JAX39dQPVuwivxCe0aBLNF1QZhzYt';
const SERVER_ID = 'a93a9b62';

async function pterodactylCommand(command) {
  try {
    const res = await fetch(`${PTERO_URL}/api/client/servers/${SERVER_ID}/command`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PTERO_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ command })
    });
    return res.status === 204;
  } catch (e) {
    console.error('Pterodactyl command error:', e.message);
    return false;
  }
}

async function pterodactylLogs() {
  try {
    const res = await fetch(`${PTERO_URL}/api/client/servers/${SERVER_ID}/websocket`, {
      headers: {
        'Authorization': `Bearer ${PTERO_KEY}`,
        'Accept': 'application/json'
      }
    });
    const data = await res.json();
    return data;
  } catch (e) {
    return null;
  }
}

function parseStatus(raw) {
  const lines = raw.split('\n');
  const players = [];
  for (const line of lines) {
    const m = line.match(/^\s*#\s*(\d+)\s+"(.+?)"\s+(\S+)\s+(\d+)\s+(\d+:\d+)/);
    if (m && m[2] !== 'SourceTV') {
      players.push({ userid: m[1], name: m[2], steamid: m[3], ping: m[4] });
    }
  }
  const mapM = raw.match(/map\s*:\s*(\S+)/);
  return { players, map: mapM ? mapM[1] : null };
}

// Buffer para capturar output do console via POST /console
let consoleBuffer = '';

async function pollPterodactyl() {
  try {
    // Envia status para o console — o output chega via /console endpoint
    await pterodactylCommand('status');
  } catch (e) {}
}

// Inicia polling a cada 5 segundos
setInterval(pollPterodactyl, 5000);
setTimeout(pollPterodactyl, 2000);

// ─── ENDPOINTS ────────────────────────────────────────────────────────────────

// Recebe eventos do MatchZy (quando funcionar)
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
    case 'map_picked':
    case 'map_result':
      if (p.map_name) matchState.map = p.map_name;
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
    case 'series_end':
      matchState.phase = 'encerrado';
      break;
  }

  res.sendStatus(200);
});

// Recebe output do console do servidor via webhook do Pterodactyl
app.post('/console', (req, res) => {
  const body = req.body;
  const line = body.line || body.output || body.data || '';
  if (line) {
    consoleBuffer += line + '\n';
    // Mantém só as últimas 200 linhas
    const lines = consoleBuffer.split('\n');
    if (lines.length > 200) consoleBuffer = lines.slice(-200).join('\n');

    // Tenta parsear status
    if (line.includes('map     :') || line.includes('players :')) {
      const parsed = parseStatus(consoleBuffer);
      if (parsed.players.length > 0 || parsed.map) {
        pterodactylData = { ...parsed, updated: Date.now(), raw: consoleBuffer.slice(-2000) };
        if (parsed.map) matchState.map = parsed.map;
      }
    }
  }
  res.sendStatus(200);
});

// Endpoint legado
app.post('/', (req, res) => {
  const body = req.body;
  if (body && body.event) {
    get5Events.unshift({ event: body.event, params: body, ts: Date.now() });
    if (get5Events.length > 100) get5Events.pop();
  }
  res.sendStatus(200);
});

app.get('/state', (req, res) => {
  res.json({ matchState, get5Events: get5Events.slice(0, 50), pterodactylData });
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
.event-row { font-size:11px; color:#888; padding:4px 0; border-bottom:1px solid #1a1a22; display:flex; gap:6px; align-items:baseline; }
.event-row:last-child { border-bottom:none; }
.event-type { color:#f0a500; white-space:nowrap; }
.event-time { color:#444; font-size:10px; white-space:nowrap; }
.no-data { text-align:center; padding:40px 20px; color:#444; font-size:13px; }
</style>
</head>
<body>
<header><h1>⚡ CS2 Live</h1><span id="status">aguardando...</span></header>
<div class="container">
  <div id="nodata" class="no-data">Aguardando partida...<br><small>Conectando via Pterodactyl API</small></div>
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
    case 'bomb_planted': return '💣 Bomba plantada por ' + (p.player_name||'?');
    case 'bomb_defused': return '✅ Bomba defusada por ' + (p.player_name||'?');
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
    const ptero = data.pterodactylData || {};

    const hasMatch = ms.phase && ms.phase !== 'aguardando';
    const hasPlayers = Object.keys(ms.players || {}).length > 0;
    const hasPteroPlayers = ptero.players && ptero.players.length > 0;
    const map = ms.map || ptero.map;
    const hasData = hasMatch || hasPlayers || hasPteroPlayers || map;

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

    document.getElementById('players-card').style.display = (hasPlayers || hasPteroPlayers) ? 'block' : 'none';
    if (hasPlayers) {
      const list = document.getElementById('players-list');
      const sorted = Object.values(ms.players).sort((a,b) => b.kills - a.kills);
      list.innerHTML = sorted.map(p => '<div class="player-row"><span class="player-name">'+p.name+'</span><span class="kda">'+p.kills+'/'+p.deaths+'/'+p.assists+'</span></div>').join('');
    } else if (hasPteroPlayers) {
      const list = document.getElementById('players-list');
      list.innerHTML = ptero.players.map(p => '<div class="player-row"><span class="player-name">'+p.name+'</span><span class="kda">'+p.ping+'ms</span></div>').join('');
    }

    document.getElementById('events-card').style.display = events.length > 0 ? 'block' : 'none';
    if (events.length > 0) {
      const evEl = document.getElementById('events-list');
      evEl.innerHTML = events.slice(0, 15).map(ev => '<div class="event-row"><span class="event-type">'+ev.event+'</span><span style="flex:1">'+eventDesc(ev.event, ev.params||{})+'</span><span class="event-time">'+timeSince(ev.ts)+'</span></div>').join('');
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
