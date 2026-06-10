const express = require('express');
const app = express();
app.use(express.json());

let gameState = {};

app.post('/', (req, res) => {
  gameState = req.body;
  res.sendStatus(200);
});

app.get('/state', (req, res) => {
  res.json(gameState);
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
.scoreboard { background:#111118; border-radius:8px; overflow:hidden; }
.score-row { display:flex; align-items:center; justify-content:space-between; padding:10px 14px; }
.team-ct { color:#5b9bd5; font-weight:700; font-size:13px; }
.team-t { color:#d4a017; font-weight:700; font-size:13px; }
.score-nums { display:flex; align-items:center; gap:12px; }
.score-nums span { font-size:28px; font-weight:800; }
.score-divider { font-size:18px; color:#444; }
.round-info { text-align:center; font-size:11px; color:#666; padding-bottom:8px; }
.map-wrapper { background:#111118; border-radius:8px; padding:10px; }
.map-title { font-size:11px; color:#666; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px; }
#mapCanvas { width:100%; border-radius:4px; display:block; }
.players-section { background:#111118; border-radius:8px; padding:10px 14px; }
.players-title { font-size:11px; color:#666; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px; }
.team-block { margin-bottom:10px; }
.team-label { font-size:11px; font-weight:700; margin-bottom:6px; }
.team-label.ct { color:#5b9bd5; }
.team-label.t { color:#d4a017; }
.player-row { display:flex; align-items:center; gap:8px; padding:4px 0; border-bottom:1px solid #1a1a22; }
.player-row:last-child { border-bottom:none; }
.player-name { flex:1; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.player-hp { font-size:11px; color:#4caf50; width:38px; text-align:right; }
.player-hp.low { color:#f44336; }
.player-kd { font-size:11px; color:#888; width:40px; text-align:right; }
.hp-bar { height:3px; background:#1a1a22; border-radius:2px; width:60px; }
.hp-fill { height:100%; border-radius:2px; background:#4caf50; transition:width 0.3s; }
.hp-fill.low { background:#f44336; }
.dead { opacity:0.35; text-decoration:line-through; }
.bomb-info { background:#111118; border-radius:8px; padding:10px 14px; display:none; }
.bomb-info.visible { display:block; }
.bomb-label { font-size:11px; color:#666; text-transform:uppercase; letter-spacing:1px; margin-bottom:4px; }
.bomb-status { font-size:14px; font-weight:700; color:#f44336; }
.bomb-status.planted { animation:blink 1s infinite; }
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.4} }
.no-data { text-align:center; padding:40px 20px; color:#444; font-size:13px; }
</style>
</head>
<body>
<header><h1>⚡ CS2 Live</h1><span id="status">aguardando...</span></header>
<div class="container">
<div id="nodata" class="no-data">Aguardando partida...<br><small>GSI precisa estar ativo no servidor.</small></div>
<div id="scoreboard" class="scoreboard" style="display:none">
<div class="score-row">
<span class="team-ct">CT</span>
<div class="score-nums"><span id="score-ct">0</span><span class="score-divider">:</span><span id="score-t">0</span></div>
<span class="team-t">T</span>
</div>
<div class="round-info" id="round-info">—</div>
</div>
<div id="bomb-info" class="bomb-info"><div class="bomb-label">💣 Bomba</div><div class="bomb-status" id="bomb-status"></div></div>
<div id="map-wrapper" class="map-wrapper" style="display:none">
<div class="map-title" id="map-name">Mapa</div>
<canvas id="mapCanvas" width="400" height="400"></canvas>
</div>
<div id="players-section" class="players-section" style="display:none">
<div class="players-title">Jogadores</div>
<div class="team-block"><div class="team-label ct">Counter-Terrorists</div><div id="players-ct"></div></div>
<div class="team-block"><div class="team-label t">Terrorists</div><div id="players-t"></div></div>
</div>
</div>
<script>
const MAP_DATA = {
  de_dust2:{x:-2476,y:3239,scale:4.4},
  de_mirage:{x:-3230,y:1713,scale:5.0},
  de_inferno:{x:-2087,y:3870,scale:4.9},
  de_nuke:{x:-3453,y:2887,scale:7.0},
  de_overpass:{x:-4831,y:1781,scale:5.2},
  de_ancient:{x:-2953,y:2164,scale:5.0},
  de_anubis:{x:-2796,y:3328,scale:5.22},
  de_vertigo:{x:-3168,y:1762,scale:4.0},
  de_cache:{x:-2000,y:3250,scale:5.5},
};
let lastMap=null,mapImg=null;
function worldToCanvas(x,y,mapName,size){
  const m=MAP_DATA[mapName];if(!m)return null;
  return{x:((x-m.x)/m.scale)*(size/1024),y:((m.y-y)/m.scale)*(size/1024)};
}
function loadMapImage(mapName){
  if(lastMap===mapName&&mapImg)return;
  lastMap=mapName;mapImg=new Image();
  mapImg.src='https://raw.githubusercontent.com/crashz/csgo-map-images/master/maps/'+mapName+'.png';
  mapImg.onerror=()=>{mapImg=null;};
}
function drawMap(state){
  const canvas=document.getElementById('mapCanvas');
  const ctx=canvas.getContext('2d');
  const size=canvas.width;
  ctx.clearRect(0,0,size,size);
  const mapName=state.map&&state.map.name;
  if(!mapName)return;
  ctx.fillStyle='#1a1a22';ctx.fillRect(0,0,size,size);
  if(mapImg&&mapImg.complete&&mapImg.naturalWidth>0){ctx.globalAlpha=0.6;ctx.drawImage(mapImg,0,0,size,size);ctx.globalAlpha=1;}
  const players=state.allplayers;if(!players)return;
  Object.entries(players).forEach(([id,p])=>{
    const pos=p.position;if(!pos)return;
    const coords=pos.split(', ').map(Number);if(coords.length<2)return;
    const pt=worldToCanvas(coords[0],coords[1],mapName,size);if(!pt)return;
    const alive=p.state&&p.state.health>0;
    const color=p.team==='CT'?'#5b9bd5':'#d4a017';
    ctx.beginPath();ctx.arc(pt.x,pt.y,alive?6:4,0,Math.PI*2);
    ctx.fillStyle=alive?color:'#444';ctx.fill();
    ctx.strokeStyle='#000';ctx.lineWidth=1.5;ctx.stroke();
    if(alive){ctx.fillStyle='#fff';ctx.font='bold 7px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText((p.name&&p.name.charAt(0).toUpperCase())||'?',pt.x,pt.y);}
  });
  const bomb=state.bomb;
  if(bomb&&bomb.position){
    const bc=bomb.position.split(', ').map(Number);
    const bp=worldToCanvas(bc[0],bc[1],mapName,size);
    if(bp){ctx.beginPath();ctx.arc(bp.x,bp.y,5,0,Math.PI*2);ctx.fillStyle='#f44336';ctx.fill();ctx.fillStyle='#fff';ctx.font='bold 7px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('B',bp.x,bp.y);}
  }
}
function renderPlayers(players){
  const ctEl=document.getElementById('players-ct');
  const tEl=document.getElementById('players-t');
  ctEl.innerHTML='';tEl.innerHTML='';
  if(!players)return;
  Object.entries(players).forEach(([id,p])=>{
    const hp=(p.state&&p.state.health)||0;
    const alive=hp>0;
    const kills=(p.match_stats&&p.match_stats.kills)||0;
    const deaths=(p.match_stats&&p.match_stats.deaths)||0;
    const low=hp<30;
    const row=document.createElement('div');
    row.className='player-row'+(alive?'':' dead');
    row.innerHTML='<span class="player-name">'+(p.name||id)+'</span><div class="hp-bar"><div class="hp-fill '+(low?'low':'')+'" style="width:'+hp+'%"></div></div><span class="player-hp '+(low?'low':'')+'">'+hp+'hp</span><span class="player-kd">'+kills+'/'+deaths+'</span>';
    if(p.team==='CT')ctEl.appendChild(row);else tEl.appendChild(row);
  });
}
async function fetchState(){
  try{
    const res=await fetch('/state');
    const state=await res.json();
    const hasData=state.map||state.allplayers;
    document.getElementById('nodata').style.display=hasData?'none':'block';
    document.getElementById('scoreboard').style.display=hasData?'block':'none';
    document.getElementById('map-wrapper').style.display=hasData?'block':'none';
    document.getElementById('players-section').style.display=hasData?'block':'none';
    const statusEl=document.getElementById('status');
    statusEl.textContent=hasData?'● AO VIVO':'aguardando...';
    statusEl.className=hasData?'live':'';
    if(state.map){
      document.getElementById('score-ct').textContent=(state.map.team_ct&&state.map.team_ct.score)||0;
      document.getElementById('score-t').textContent=(state.map.team_t&&state.map.team_t.score)||0;
      document.getElementById('map-name').textContent=state.map.name||'Mapa';
      document.getElementById('round-info').textContent='Round '+((state.map.round)||'?')+' • '+(state.map.phase||'');
      loadMapImage(state.map.name);
    }
    const bomb=state.bomb;
    const bombEl=document.getElementById('bomb-info');
    if(bomb&&bomb.state){
      bombEl.classList.add('visible');
      const bs=document.getElementById('bomb-status');
      if(bomb.state==='planted'){bs.textContent='💥 Plantada!';bs.className='bomb-status planted';}
      else if(bomb.state==='exploded'){bs.textContent='💥 Explodiu!';bs.className='bomb-status';}
      else if(bomb.state==='defused'){bs.textContent='✅ Defusada';bs.className='bomb-status';}
      else{bs.textContent=bomb.state;bs.className='bomb-status';}
    }else{bombEl.classList.remove('visible');}
    renderPlayers(state.allplayers);
    drawMap(state);
  }catch(e){}
}
setInterval(fetchState,1000);
fetchState();
</script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('CS2 Minimapa rodando na porta ' + PORT));
