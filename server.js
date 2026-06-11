const express = require('express');
const app = express();
app.use(express.json());

let matchState = {
  map: null,
  phase: null,
  round: 0,
  team1: { name: 'CT', score: 0 },
  team2: { name: 'T', score: 0 },
  players: {}
};
let events = [];

// Recebe dados do plugin CS2LivePlugin
app.post('/gamestate', (req, res) => {
  const body = req.body;
  if (!body) return res.sendStatus(400);
  if (body.map) matchState.map = body.map;
  if (body.phase) matchState.phase = body.phase;
  if (body.round !== undefined) matchState.round = body.round;
  if (body.team1) matchState.team1 = body.team1;
  if (body.team2) matchState.team2 = body.team2;
  if (body.players) {
    matchState.players = {};
    for (const p of body.players) {
      matchState.players[p.name] = p;
    }
  }
  if (body.event) {
    events.unshift(body);
    if (events.length > 50) events.pop();
  }
  res.sendStatus(200);
});

app.get('/state', (req, res) => {
  res.json({ matchState, events });
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
.score-row { display:flex; align-items:center; justify-content:space-between; }
.team-ct { color:#5b9bd5; font-weight:700; font-size:13px; }
.team-t { color:#d4a017; font-weight:700; font-size:13px; }
.score-nums { display:flex; align-items:center; gap:12px; }
.score-nums span { font-size:28px; font-weight:800; }
.score-divider { font-size:18px; color:#444; }
.round-info { text-align:center; font-size:11px; color:#666; padding-top:4px; }
.player-row { display:flex; align-items:center; gap:8px; padding:4px 0; border-bottom:1px solid #1a1a22; }
.player-row:last-child { border-bottom:none; }
.player-name { flex:1; font-size:12px; }
.player-hp { font-size:11px; color:#4caf50; width:38px; text-align:right; }
.player-hp.low { color:#f44336; }
.player-kd { font-size:11px; color:#888; width:40px; text-align:right; }
.hp-bar { height:3px; background:#1a1a22; border-radius:2px; width:60px; }
.hp-fill { height:100%; border-radius:2px; background:#4caf50; }
.hp-fill.low { background:#f44336; }
.dead { opacity:0.35; text-decoration:line-through; }
.team-label { font-size:11px; font-weight:700; margin-bottom:6px; }
.team-label.ct { color:#5b9bd5; }
.team-label.t { color:#d4a017; }
.team-block { margin-bottom:10px; }
.event-row { font-size:11px; color:#888; padding:3px 0; border-bottom:1px solid #1a1a22; }
.event-row:last-child { border-bottom:none; }
.event-kill { color:#f44336; }
.event-bomb { color:#f0a500; }
.no-data { text-align:center; padding:40px 20px; color:#444; font-size:13px; }
</style>
</head>
<body>
<header><h1>⚡ CS2 Live</h1><span id="status">aguardando...</span></header>
<div class="container">
  <div id="nodata" class="no-data">Aguardando partida...<br><small>Plugin CS2Live precisa estar ativo no servidor.</small></div>

  <div id="scoreboard" class="card" style="display:none">
    <div class="card-title" id="map-name">Mapa</div>
    <div class="score-row">
      <span class="team-ct" id="team1-name">CT</span>
      <div class="score-nums">
        <span id="score-ct">0</span>
        <span class="score-divider">:</span>
        <span id="score-t">0</span>
      </div>
      <span class="team-t" id="team2-name">T</span>
    </div>
    <div class="round-info" id="round-info">—</div>
  </div>

  <div id="players-section" class="card" style="display:none">
    <div class="card-title">Jogadores</div>
    <div class="team-block"><div class="team-label ct">Counter-Terrorists</div><div id="players-ct"></div></div>
    <div class="team-block"><div class="team-label t">Terrorists</div><div id="players-t"></div></div>
  </div>

  <div id="events-section" class="card" style="display:none">
    <div class="card-title">Eventos recentes</div>
    <div id="events-list"></div>
  </div>
</div>
<script>
async function fetchState() {
  try {
    const res = await fetch('/state');
    const data = await res.json();
    const ms = data.matchState;
    const evs = data.events || [];

    const players = Object.values(ms.players || {});
    const hasData = ms.map || players.length > 0;

    document.getElementById('nodata').style.display = hasData ? 'none' : 'block';
    document.getElementById('scoreboard').style.display = hasData ? 'block' : 'none';
    document.getElementById('players-section').style.display = players.length > 0 ? 'block' : 'none';
    document.getElementById('events-section').style.display = evs.length > 0 ? 'block' : 'none';

    const statusEl = document.getElementById('status');
    statusEl.textContent = hasData ? '● AO VIVO' : 'aguardando...';
    statusEl.className = hasData ? 'live' : '';

    if (ms.map) document.getElementById('map-name').textContent = ms.map;
    document.getElementById('score-ct').textContent = ms.team1?.score || 0;
    document.getElementById('score-t').textContent = ms.team2?.score || 0;
    document.getElementById('team1-name').textContent = ms.team1?.name || 'CT';
    document.getElementById('team2-name').textContent = ms.team2?.name || 'T';
    document.getElementById('round-info').textContent = 'Round ' + (ms.round || '?') + ' • ' + (ms.phase || '');

    const ctEl = document.getElementById('players-ct');
    const tEl = document.getElementById('players-t');
    ctEl.innerHTML = ''; tEl.innerHTML = '';
    players.forEach(p => {
      const hp = p.health || 0;
      const alive = hp > 0;
      const low = hp < 30;
      const row = document.createElement('div');
      row.className = 'player-row' + (alive ? '' : ' dead');
      row.innerHTML = '<span class="player-name">' + p.name + '</span>' +
        '<div class="hp-bar"><div class="hp-fill ' + (low?'low':'') + '" style="width:' + hp + '%"></div></div>' +
        '<span class="player-hp ' + (low?'low':'') + '">' + hp + 'hp</span>' +
        '<span class="player-kd">' + (p.kills||0) + '/' + (p.deaths||0) + '</span>';
      if (p.team === 'CT') ctEl.appendChild(row);
      else tEl.appendChild(row);
    });

    const evEl = document.getElementById('events-list');
    evEl.innerHTML = '';
    evs.slice(0, 15).forEach(ev => {
      const row = document.createElement('div');
      row.className = 'event-row';
      let text = '';
      if (ev.event === 'player_death') {
        text = '<span class="event-kill">💀 ' + (ev.attacker || '?') + ' → ' + (ev.victim || '?') + (ev.weapon ? ' [' + ev.weapon + ']' : '') + '</span>';
      } else if (ev.event === 'bomb_planted') {
        text = '<span class="event-bomb">💣 Bomba plantada por ' + (ev.player || '?') + '</span>';
      } else if (ev.event === 'bomb_defused') {
        text = '<span class="event-bomb">✅ Bomba defusada por ' + (ev.player || '?') + '</span>';
      } else if (ev.event === 'round_end') {
        text = 'Round ' + (ev.round || '?') + ' — ' + (ev.winner || '') + ' venceu';
      } else {
        text = ev.event || '';
      }
      row.innerHTML = text;
      evEl.appendChild(row);
    });
  } catch(e) {}
}
setInterval(fetchState, 1000);
fetchState();
</script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('CS2 Live rodando na porta ' + PORT));
