const express = require('express');
const app = express();
app.use(express.json());

let gameState = {};
let matchzyEvents = [];

// Recebe dados do GSI padrão
app.post('/', (req, res) => {
  const body = req.body;
  
  // Detecta se é evento do MatchZy ou GSI padrão
  if (body.event) {
    matchzyEvents.unshift(body);
    if (matchzyEvents.length > 50) matchzyEvents.pop();
    
    // Atualiza gameState com dados do MatchZy
    if (body.map) gameState.map = gameState.map || {};
    if (body.team1) {
      gameState.matchzy = body;
    }
  } else {
    gameState = body;
  }
  
  res.sendStatus(200);
});

app.get('/state', (req, res) => {
  res.json({ gameState, matchzyEvents });
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
.score-row { display:flex; align-items:center; justify-content:space-between; padding:4px 0; }
.team-ct { color:#5b9bd5; font-weight:700; font-size:13px; }
.team-t { color:#d4a017; font-weight:700; font-size:13px; }
.score-nums { display:flex; align-items:center; gap:12px; }
.score-nums span { font-size:28px; font-weight:800; }
.score-divider { font-size:18px; color:#444; }
.round-info { text-align:center; font-size:11px; color:#666; padding-top:4px; }
.player-row { display:flex; align-items:center; gap:8px; padding:4px 0; border-bottom:1px solid #1a1a22; }
.player-row:last-child { border-bottom:none; }
.player-name { flex:1; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
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
.event-type { color:#f0a500; margin-right:6px; }
.no-data { text-align:center; padding:40px 20px; color:#444; font-size:13px; }
.bomb-planted { color:#f44336; font-weight:700; animation:blink 1s infinite; }
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.4} }
</style>
</head>
<body>
<header><h1>⚡ CS2 Live</h1><span id="status">aguardando...</span></header>
<div class="container">
  <div id="nodata" class="no-data">Aguardando partida...<br><small>Conecte ao servidor para ver os dados.</small></div>
  
  <div id="scoreboard" class="card" style="display:none">
    <div class="card-title">Placar</div>
    <div class="score-row">
      <span class="team-ct">CT</span>
      <div class="score-nums"><span id="score-ct">0</span><span class="score-divider">:</span><span id="score-t">0</span></div>
      <span class="team-t">T</span>
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
    const gs = data.gameState;
    const events = data.matchzyEvents || [];

    const hasGSI = gs.map || gs.allplayers;
    const hasMatchZy = gs.matchzy || events.length > 0;
    const hasData = hasGSI || hasMatchZy;

    document.getElementById('nodata').style.display = hasData ? 'none' : 'block';
    document.getElementById('scoreboard').style.display = hasData ? 'block' : 'none';
    document.getElementById('players-section').style.display = hasGSI && gs.allplayers ? 'block' : 'none';
    document.getElementById('events-section').style.display = events.length > 0 ? 'block' : 'none';

    const statusEl = document.getElementById('status');
    statusEl.textContent = hasData ? '● AO VIVO' : 'aguardando...';
    statusEl.className = hasData ? 'live' : '';

    // GSI padrão
    if (gs.map) {
      document.getElementById('score-ct').textContent = (gs.map.team_ct && gs.map.team_ct.score) || 0;
      document.getElementById('score-t').textContent = (gs.map.team_t && gs.map.team_t.score) || 0;
      document.getElementById('round-info').textContent = 'Round ' + (gs.map.round || '?') + ' • ' + (gs.map.phase || '');
    }

    // MatchZy
    if (gs.matchzy) {
      const mz = gs.matchzy;
      if (mz.team1_score !== undefined) {
        document.getElementById('score-ct').textContent = mz.team1_score || 0;
        document.getElementById('score-t').textContent = mz.team2_score || 0;
        document.getElementById('round-info').textContent = (mz.map || '') + ' • Round ' + (mz.round_number || '?');
        document.getElementById('scoreboard').style.display = 'block';
        document.getElementById('nodata').style.display = 'none';
      }
    }

    // Jogadores GSI
    if (gs.allplayers) {
      const ctEl = document.getElementById('players-ct');
      const tEl = document.getElementById('players-t');
      ctEl.innerHTML = ''; tEl.innerHTML = '';
      Object.entries(gs.allplayers).forEach(([id, p]) => {
        const hp = (p.state && p.state.health) || 0;
        const alive = hp > 0;
        const kills = (p.match_stats && p.match_stats.kills) || 0;
        const deaths = (p.match_stats && p.match_stats.deaths) || 0;
        const low = hp < 30;
        const row = document.createElement('div');
        row.className = 'player-row' + (alive ? '' : ' dead');
        row.innerHTML = '<span class="player-name">' + (p.name || id) + '</span><div class="hp-bar"><div class="hp-fill ' + (low ? 'low' : '') + '" style="width:' + hp + '%"></div></div><span class="player-hp ' + (low ? 'low' : '') + '">' + hp + 'hp</span><span class="player-kd">' + kills + '/' + deaths + '</span>';
        if (p.team === 'CT') ctEl.appendChild(row); else tEl.appendChild(row);
      });
    }

    // Eventos MatchZy
    if (events.length > 0) {
      const evEl = document.getElementById('events-list');
      evEl.innerHTML = '';
      events.slice(0, 10).forEach(ev => {
        const row = document.createElement('div');
        row.className = 'event-row';
        let desc = '';
        if (ev.event === 'player_death') desc = (ev.attacker_name || '?') + ' matou ' + (ev.player_name || '?');
        else if (ev.event === 'round_end') desc = 'Round ' + (ev.round_number || '?') + ' encerrado — ' + (ev.winner || '');
        else if (ev.event === 'bomb_planted') desc = '💣 Bomba plantada!';
        else if (ev.event === 'bomb_defused') desc = '✅ Bomba defusada!';
        else if (ev.event === 'bomb_exploded') desc = '💥 Bomba explodiu!';
        else desc = ev.event || JSON.stringify(ev).slice(0, 60);
        row.innerHTML = '<span class="event-type">' + (ev.event || 'evento') + '</span>' + desc;
        evEl.appendChild(row);
      });
    }
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
