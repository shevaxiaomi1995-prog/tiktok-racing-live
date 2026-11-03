import * as THREE from 'three';
import './style.css';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'tiktok-racing-live-v1';
const DEFAULT_CONFIG = {
  minPlayers: 10, maxPlayers: 50, registrationSeconds: 180, raceSeconds: 300,
  likesThreshold: 100, likesBoostDuration: 5, likesBoostStrength: 1.5, likesEnabled: true, attacksEnabled: true,
  gifts: [
    { name: 'Rose', effect: 'boost', duration: 6, strength: 1.7 },
    { name: 'Heart', effect: 'shield', duration: 8, strength: 1 },
    { name: 'GG', effect: 'slow', duration: 5, strength: 0.55 }
  ]
};
const COLORS = ['#42d9ff','#ff6b9d','#9d85ff','#ffd166','#5ce0a3','#ff925c','#69a5ff','#e8ed74','#ed7be8','#7ce5dd','#f28cbb','#a4eb73'];
let config = loadConfig();
let phase = 'waiting';
let players = [];
let winners = loadWinners();
let raceDeadline = 0;
let registrationDeadline = 0;
let liveSessionActive = false;
let raceNumber = 0;
let activity = [];
let lastTick = performance.now();
let toastTimer;

function loadConfig(){try{return {...DEFAULT_CONFIG,...JSON.parse(localStorage.getItem(STORAGE_KEY+'-config')||'{}')};}catch{return structuredClone(DEFAULT_CONFIG)}}
function saveConfig(){localStorage.setItem(STORAGE_KEY+'-config',JSON.stringify(config));}
function loadWinners(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY+'-winners')||'{}')}catch{return {}}}
function saveWinners(){localStorage.setItem(STORAGE_KEY+'-winners',JSON.stringify(winners));}
function escapeHtml(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function notify(msg){const el=$('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2400)}
function addFeed(text){activity.unshift({time:new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit'}),text});activity=activity.slice(0,12);renderFeed();}
function normalizeName(name){return String(name||'Зритель').trim().replace(/^@/,'').slice(0,24)||'Зритель'}
function findPlayer(username){const key=normalizeName(username).toLowerCase();return players.find(p=>p.username.toLowerCase()===key)}
function addPlayer(username){
  const name=normalizeName(username);
  if(phase==='race'){addFeed(`${name}: регистрация уже закрыта`);return false}
  if(findPlayer(name)){addFeed(`${name} уже участвует`);return false}
  if(players.length>=config.maxPlayers){addFeed(`Лимит ${config.maxPlayers} участников достигнут`);return false}
  const p={id:crypto.randomUUID?.()||String(Date.now()+Math.random()),username:name,color:COLORS[players.length%COLORS.length],distance:0,likes:0,likeRemainder:0,effects:[],shieldUntil:0,mesh:null,label:null};
  players.push(p);addFeed(`${name} присоединился к гонке`);
  if(players.length>=config.minPlayers&&phase==='waiting'){
    phase='registration';registrationDeadline=Date.now()+config.registrationSeconds*1000;
    addFeed(`Набрано ${config.minPlayers} участников. Регистрация закроется по таймеру.`);notify('Набрано 10 участников — стартует таймер 3 минуты');
  }
  if(players.length>=config.maxPlayers){addFeed('Достигнут максимум участников. Новые заявки закрыты.');notify('Набор участников завершён: достигнут лимит');}
  renderAll();syncCars();return true;
}
function applyEffect(player,effect,duration,strength=1){
  if(!player)return;
  const now=Date.now();
  if(effect==='shield'){player.shieldUntil=Math.max(player.shieldUntil,now+duration*1000);addFeed(`${player.username}: активирован щит`);return}
  if(effect==='pushback'){
    if(player.shieldUntil>now){addFeed(`${player.username}: щит заблокировал атаку`);return}
    player.distance=Math.max(0,player.distance-0.025*strength);addFeed(`${player.username}: отброшен назад`);return;
  }
  if((effect==='slow'||effect==='stun')&&player.shieldUntil>now){addFeed(`${player.username}: щит заблокировал атаку`);return}
  player.effects.push({type:effect,until:now+duration*1000,strength});
  const labels={boost:'получил ускорение',slow:'замедлен',stun:'оглушён'};
  addFeed(`${player.username}: ${labels[effect]||'получил эффект'}`);
}
function pickTarget(username){if(username){const target=findPlayer(username);if(target)return target}return [...players].sort((a,b)=>b.distance-a.distance)[0]||null}
function processEvent(event){
  if(!event||typeof event!=='object')return;
  const type=String(event.type||'').toLowerCase();
  const username=normalizeName(event.username||event.uniqueId||event.nickname||'Зритель');
  if(type==='live_start'){
    if(!liveSessionActive){liveSessionActive=true;winners={};saveWinners();raceNumber=0;addFeed('Новый эфир: таблица побед сброшена');notify('Новый эфир — таблица побед обновлена')}
    return;
  }
  if(type==='live_end'){liveSessionActive=false;addFeed('Эфир завершён');return}
  if(type==='chat'){
    const message=String(event.message||'').trim();
    if(/^старт$/i.test(message)||/^start$/i.test(message)||/^!join$/i.test(message)){addPlayer(username);return}
    const attack=message.match(/^!пакость\s+@?([\w.-]+)/i);
    if(attack&&config.attacksEnabled){const target=findPlayer(attack[1]);if(target)applyEffect(target,'slow',4,.5);return}
    return;
  }
  if(type==='like'||type==='likes'){
    if(!config.likesEnabled)return;
    const p=findPlayer(username);if(!p)return;
    const count=Math.max(1,Number(event.count||1));p.likes+=count;p.likeRemainder+=count;
    while(p.likeRemainder>=config.likesThreshold){p.likeRemainder-=config.likesThreshold;applyEffect(p,'boost',config.likesBoostDuration,config.likesBoostStrength)}
    renderParticipants();return;
  }
  if(type==='gift'){
    const giftName=String(event.giftName||event.gift||event.name||'').trim();
    const rule=config.gifts.find(g=>g.name.toLowerCase()===giftName.toLowerCase());
    if(!rule){addFeed(`${username} отправил подарок «${giftName||'неизвестный'}» (правило не настроено)`);return}
    const own=findPlayer(username);
    if(rule.effect==='slow'||rule.effect==='pushback'||rule.effect==='stun'){
      const target=pickTarget(event.targetUsername);
      if(target)applyEffect(target,rule.effect,Number(rule.duration)||4,Number(rule.strength)||1);
    }else if(own){applyEffect(own,rule.effect,Number(rule.duration)||5,Number(rule.strength)||1)}
    addFeed(`${username}: подарок «${giftName}»`);return;
  }
}

// Three.js scene: oval track, stadium lights and simple 3D cars.
const wrap=$('scene-wrap');
const scene=new THREE.Scene();scene.background=new THREE.Color('#0a1128');scene.fog=new THREE.Fog('#0a1128',42,95);
const camera=new THREE.PerspectiveCamera(42,1,.1,200);camera.position.set(0,27,31);camera.lookAt(0,0,0);
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;wrap.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight('#a9dfff','#17213c',2.0));
const keyLight=new THREE.DirectionalLight('#ffffff',2.2);keyLight.position.set(-12,24,10);keyLight.castShadow=true;scene.add(keyLight);
const cyanLight=new THREE.PointLight('#26d6ff',35,40);cyanLight.position.set(-13,4,-7);scene.add(cyanLight);
const purpleLight=new THREE.PointLight('#8965ff',28,40);purpleLight.position.set(13,4,8);scene.add(purpleLight);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(100,100),new THREE.MeshStandardMaterial({color:'#111b35',roughness:.95}));floor.rotation.x=-Math.PI/2;floor.position.y=-.18;floor.receiveShadow=true;scene.add(floor);
const centerDisc=new THREE.Mesh(new THREE.CircleGeometry(7,64),new THREE.MeshStandardMaterial({color:'#152849',roughness:1}));centerDisc.rotation.x=-Math.PI/2;centerDisc.position.y=-.08;scene.add(centerDisc);
const trackGroup=new THREE.Group();scene.add(trackGroup);
const A=14,B=9,ROAD=4.3;
function ovalSurface(){
  const vertices=[],indices=[],uv=[];const steps=220;
  for(let i=0;i<=steps;i++){
    const t=i/steps*Math.PI*2;const cx=A*Math.cos(t),cz=B*Math.sin(t);const nx=Math.cos(t)/A,nz=Math.sin(t)/B;const len=Math.hypot(nx,nz);const ox=nx/len,oz=nz/len;
    for(const side of [-1,1]){vertices.push(cx+ox*ROAD/2*side,.02,cz+oz*ROAD/2*side);uv.push(i/steps,side===-1?0:1)}
  }
  for(let i=0;i<steps;i++){const n=i*2;indices.push(n,n+1,n+2,n+1,n+3,n+2)}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return g;
}
const road=new THREE.Mesh(ovalSurface(),new THREE.MeshStandardMaterial({color:'#303a50',roughness:.9,side:THREE.DoubleSide}));road.receiveShadow=true;trackGroup.add(road);
function makeRail(offset,color){const pts=[];for(let i=0;i<=180;i++){const t=i/180*Math.PI*2;const nx=Math.cos(t)/A,nz=Math.sin(t)/B;const l=Math.hypot(nx,nz);pts.push(new THREE.Vector3(A*Math.cos(t)+nx/l*offset,.22,B*Math.sin(t)+nz/l*offset));}const line=new THREE.CatmullRomCurve3(pts,true);const mesh=new THREE.Mesh(new THREE.TubeGeometry(line,240,.12,8,true),new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.35}));trackGroup.add(mesh)}
makeRail(ROAD/2+.4,'#2bcbea');makeRail(-ROAD/2-.4,'#785bff');
for(let i=0;i<46;i++){const t=i/46*Math.PI*2;const x=A*Math.cos(t),z=B*Math.sin(t);const marker=new THREE.Mesh(new THREE.BoxGeometry(.23,.045,.7),new THREE.MeshStandardMaterial({color:i%2?'#d9e8ff':'#ff6da8',emissive:i%2?'#223b70':'#5a1c4a',emissiveIntensity:.4}));marker.position.set(x,ROAD===0?0:.055,z);marker.rotation.y=-t;trackGroup.add(marker)}
// Start/finish arch at the front of the oval.
const archMat=new THREE.MeshStandardMaterial({color:'#37dfff',emissive:'#1679aa',emissiveIntensity:.7});
const archTop=new THREE.Mesh(new THREE.BoxGeometry(5,.22,.35),archMat);archTop.position.set(0,3.4,B+1.6);scene.add(archTop);
for(const x of [-2.4,2.4]){const post=new THREE.Mesh(new THREE.BoxGeometry(.22,3.4,.25),archMat);post.position.set(x,1.7,B+1.6);scene.add(post)}
const carsGroup=new THREE.Group();scene.add(carsGroup);const carObjects=new Map();
function makeCar(color){
  const root=new THREE.Group();const bodyMat=new THREE.MeshStandardMaterial({color,metalness:.45,roughness:.28});
  const body=new THREE.Mesh(new THREE.BoxGeometry(1.35,.38,2.2),bodyMat);body.position.y=.48;body.castShadow=true;root.add(body);
  const hood=new THREE.Mesh(new THREE.BoxGeometry(1.05,.18,.63),new THREE.MeshStandardMaterial({color:'#e9f4ff',metalness:.55,roughness:.25}));hood.position.set(0,.74,-.25);root.add(hood);
  const glass=new THREE.Mesh(new THREE.BoxGeometry(.93,.38,.9),new THREE.MeshStandardMaterial({color:'#172849',metalness:.3,roughness:.13,transparent:true,opacity:.9}));glass.position.set(0,.78,.42);root.add(glass);
  const wheelMat=new THREE.MeshStandardMaterial({color:'#080b15',roughness:.8});
  for(const x of [-.72,.72])for(const z of [-.68,.68]){const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.25,.25,.16,12),wheelMat);wheel.rotation.z=Math.PI/2;wheel.position.set(x,.28,z);wheel.castShadow=true;root.add(wheel)}
  const lightMat=new THREE.MeshStandardMaterial({color:'#ffffff',emissive:'#ffffff',emissiveIntensity:1.7});for(const x of [-.42,.42]){const light=new THREE.Mesh(new THREE.BoxGeometry(.25,.12,.08),lightMat);light.position.set(x,.48,-1.12);root.add(light)}
  const aura=new THREE.PointLight(color,1.8,4);aura.position.y=.5;root.add(aura);
  root.userData.aura=aura;return root;
}
function syncCars(){
  for(const [id,obj] of carObjects){if(!players.some(p=>p.id===id)){carsGroup.remove(obj);carObjects.delete(id)}}
  for(const p of players){if(!carObjects.has(p.id)){const car=makeCar(p.color);carsGroup.add(car);carObjects.set(p.id,car);p.mesh=car}}
}
function placeCar(p,index){
  if(!p.mesh)return;const t=((p.distance%1)+1)%1*Math.PI*2;const x=(A+Math.cos(t)*.45)*Math.cos(t);const z=(B+Math.sin(t)*.45)*Math.sin(t);const lane=((index%3)-1)*.9;
  const nx=Math.cos(t)/A,nz=Math.sin(t)/B,len=Math.hypot(nx,nz);p.mesh.position.set(x+nx/len*lane,.12,z+nz/len*lane);const dx=-A*Math.sin(t),dz=B*Math.cos(t);p.mesh.rotation.y=Math.atan2(dx,dz);
  p.mesh.userData.aura.intensity=p.effects.some(e=>e.type==='boost')?5:1.8;
}
function resize(){const w=wrap.clientWidth,h=wrap.clientHeight;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false)}
new ResizeObserver(resize).observe(wrap);resize();$('scene-loading').style.display='none';

function renderParticipants(){
  const sorted=[...players].sort((a,b)=>b.distance-a.distance);
  $('participants-list').innerHTML=sorted.length?sorted.slice(0,50).map((p,i)=>`<div class="participant-row"><span class="car-dot" style="background:${p.color};color:${p.color}"></span><span class="name">${i+1}. ${escapeHtml(p.username)}</span><span class="distance">${Math.floor(p.distance)}.${Math.floor((p.distance%1)*1000)} m</span></div>`).join(''):'<div class="empty-state">Пока никто не присоединился.<br />Напиши «Старт» в тестовом чате справа.</div>';
  $('participant-count').textContent=`${players.length} / ${config.maxPlayers}`;
  $('participant-status').textContent=players.length?`${players.length} машин на трассе`:'Ожидаем команду «Старт»';
}
function renderWinners(){
  const rows=Object.entries(winners).sort((a,b)=>b[1].wins-a[1].wins||b[1].lastWin-a[1].lastWin);
  const total=rows.reduce((s,[,v])=>s+v.wins,0);$('wins-total').textContent=`${total} побед`;
  $('winners-list').innerHTML=rows.length?rows.slice(0,10).map(([name,v],i)=>`<div class="winner-row"><span class="winner-rank">${i+1}</span><span class="name">${escapeHtml(name)}</span><span class="win-count">${v.wins} 🏆</span></div>`).join(''):'<div class="empty-state compact">Победители появятся после первой гонки.</div>';
}
function renderFeed(){$('activity-feed').innerHTML=activity.length?activity.map(a=>`<div class="feed-item"><span class="feed-time">${a.time}</span><span class="feed-text">${escapeHtml(a.text)}</span></div>`).join(''):'<div class="feed-item muted">События появятся здесь.</div>'}
function formatTime(sec){sec=Math.max(0,Math.ceil(sec));return `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`}
function renderStatus(){
  const phaseText={waiting:'Ожидание',registration:'Регистрация',race:'Гонка'};
  $('phase-label').textContent=phaseText[phase];$('race-state').textContent=({waiting:'ОЖИДАНИЕ УЧАСТНИКОВ',registration:'РЕГИСТРАЦИЯ ОТКРЫТА',race:'ГОНКА ИДЁТ'})[phase];
  if(phase==='waiting'){$('timer-label').textContent='УЧАСТНИКОВ ДЛЯ СТАРТА';$('timer').textContent=`${players.length} / ${config.minPlayers}`}
  else if(phase==='registration'){$('timer-label').textContent='ДО СТАРТА';$('timer').textContent=formatTime((registrationDeadline-Date.now())/1000)}
  else{$('timer-label').textContent='ДО ФИНИША';$('timer').textContent=formatTime((raceDeadline-Date.now())/1000)}
}
function renderAll(){renderParticipants();renderWinners();renderStatus();}
function finishRace(){
  const ranked=[...players].sort((a,b)=>b.distance-a.distance);const winner=ranked[0];
  if(winner){const key=winner.username;winners[key]??={wins:0,participations:0,lastWin:0};winners[key].wins++;winners[key].lastWin=Date.now();for(const p of players){winners[p.username]??={wins:0,participations:0,lastWin:0};winners[p.username].participations++}saveWinners();addFeed(`🏆 Победитель гонки: ${winner.username}`);notify(`🏆 Победитель: ${winner.username}`)}
  raceNumber++;players=[];phase='waiting';registrationDeadline=0;raceDeadline=0;syncCars();renderAll();
  addFeed('Все участники вышли. Открыт набор на следующую гонку.');
}
function startRace(){if(phase!=='registration'||players.length<config.minPlayers)return;phase='race';raceDeadline=Date.now()+config.raceSeconds*1000;players.forEach((p,i)=>{p.distance=0;p.effects=[];p.shieldUntil=0});addFeed(`🏁 Гонка №${raceNumber+1} началась! Участников: ${players.length}`);notify('Старт! Удачи участникам!');renderAll()}
function tick(now){const dt=Math.min((now-lastTick)/1000,.1);lastTick=now;
  if(phase==='registration'&&Date.now()>=registrationDeadline)startRace();
  if(phase==='race'){
    const time=Date.now();for(const p of players){p.effects=p.effects.filter(e=>e.until>time);let mult=1;for(const e of p.effects){if(e.type==='boost')mult=Math.max(mult,e.strength);if(e.type==='slow')mult=Math.min(mult,e.strength);if(e.type==='stun')mult=0}p.distance+=dt*.0032*mult;}
    if(time>=raceDeadline)finishRace();
  }
  players.forEach(placeCar);renderStatus();renderer.render(scene,camera);requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

function renderGiftRules(){
  $('gift-rules').innerHTML=config.gifts.map((g,i)=>`<div class="gift-rule" data-index="${i}"><input class="gift-name" aria-label="Название подарка" value="${escapeHtml(g.name)}" /><select class="gift-effect" aria-label="Эффект"><option value="boost" ${g.effect==='boost'?'selected':''}>Ускорение</option><option value="shield" ${g.effect==='shield'?'selected':''}>Щит</option><option value="slow" ${g.effect==='slow'?'selected':''}>Замедление лидера</option><option value="pushback" ${g.effect==='pushback'?'selected':''}>Сдвиг назад</option><option value="stun" ${g.effect==='stun'?'selected':''}>Оглушение</option></select><input class="gift-duration" type="number" min="1" max="60" title="Длительность, секунды" value="${Number(g.duration)||5}" /><input class="gift-strength" type="number" min="0.1" max="5" step="0.1" title="Сила эффекта" value="${Number(g.strength)||1}" /><button class="remove-rule" title="Удалить">×</button></div>`).join('');
  $('gift-rules').querySelectorAll('.remove-rule').forEach(btn=>btn.addEventListener('click',e=>{const i=Number(e.currentTarget.closest('.gift-rule').dataset.index);config.gifts.splice(i,1);saveConfig();renderGiftRules();renderDemoGifts()}));
  $('gift-rules').querySelectorAll('.gift-name,.gift-effect,.gift-duration,.gift-strength').forEach(el=>el.addEventListener('change',()=>{const row=el.closest('.gift-rule');const i=Number(row.dataset.index);config.gifts[i].name=row.querySelector('.gift-name').value.trim();config.gifts[i].effect=row.querySelector('.gift-effect').value;config.gifts[i].duration=Math.max(1,Math.min(60,Number(row.querySelector('.gift-duration').value)||5));config.gifts[i].strength=Math.max(.1,Math.min(5,Number(row.querySelector('.gift-strength').value)||1));saveConfig();renderDemoGifts()}));
}
function renderDemoGifts(){$('demo-gift').innerHTML=config.gifts.map(g=>`<option value="${escapeHtml(g.name)}">${escapeHtml(g.name)} → ${g.effect}</option>`).join('')||'<option value="">Нет правил</option>'}
function loadForm(){ $('min-players').value=config.minPlayers;$('max-players').value=config.maxPlayers;$('registration-seconds').value=config.registrationSeconds;$('race-seconds').value=config.raceSeconds;$('likes-threshold').value=config.likesThreshold;$('likes-boost-duration').value=config.likesBoostDuration;$('likes-boost-strength').value=config.likesBoostStrength;$('likes-enabled').checked=config.likesEnabled;$('attacks-enabled').checked=config.attacksEnabled;renderGiftRules();renderDemoGifts(); }
$('save-settings').addEventListener('click',()=>{
  const min=Math.max(10,Math.min(50,Number($('min-players').value)||10));const max=Math.max(min,Math.min(50,Number($('max-players').value)||50));
  config={...config,minPlayers:min,maxPlayers:max,registrationSeconds:Math.max(30,Number($('registration-seconds').value)||180),raceSeconds:Math.max(30,Number($('race-seconds').value)||300),likesThreshold:Math.max(1,Number($('likes-threshold').value)||100),likesBoostDuration:Math.max(1,Math.min(60,Number($('likes-boost-duration').value)||5)),likesBoostStrength:Math.max(1,Math.min(5,Number($('likes-boost-strength').value)||1.5)),likesEnabled:$('likes-enabled').checked,attacksEnabled:$('attacks-enabled').checked};
  saveConfig();renderAll();notify('Настройки сохранены');
});
$('add-gift').addEventListener('click',()=>{config.gifts.push({name:'New Gift',effect:'boost',duration:5,strength:1.5});saveConfig();renderGiftRules();renderDemoGifts();saveConfig()});
$('demo-join').addEventListener('click',()=>{const name=normalizeName($('demo-name').value);processEvent({type:'chat',username:name,message:'Старт'})});
$('demo-likes').addEventListener('click',()=>{processEvent({type:'like',username:normalizeName($('demo-name').value),count:100})});
$('demo-send-gift').addEventListener('click',()=>{const giftName=$('demo-gift').value;if(giftName)processEvent({type:'gift',username:normalizeName($('demo-name').value),giftName})});
$('demo-attack').addEventListener('click',()=>{const target=pickTarget();if(target&&config.attacksEnabled)applyEffect(target,'slow',4,.45);else notify('Пока нет цели для атаки')});
$('reset-winners').addEventListener('click',()=>{if(confirm('Сбросить таблицу победителей этого эфира?')){winners={};saveWinners();renderWinners();addFeed('Ведущий вручную сбросил таблицу победителей')}});
$('export-winners').addEventListener('click',()=>{const rows=[['Зритель','Победы','Участия'],...Object.entries(winners).sort((a,b)=>b[1].wins-a[1].wins).map(([n,v])=>[n,v.wins,v.participations])];const csv='\ufeff'+rows.map(r=>r.map(x=>'"'+String(x).replaceAll('"','""')+'"').join(';')).join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='tiktok-racing-winners.csv';a.click();URL.revokeObjectURL(a.href)});
loadForm();renderAll();

// WebSocket receives normalized events from the local Node bridge.
const wsUrl=import.meta.env.VITE_WS_URL||`ws://${location.hostname}:8787`;
let socket;
function connectSocket(){try{socket=new WebSocket(wsUrl);socket.addEventListener('open',()=>addFeed('Подключено к локальному event-серверу'));socket.addEventListener('message',e=>{try{processEvent(JSON.parse(e.data))}catch{}});socket.addEventListener('close',()=>setTimeout(connectSocket,3500));socket.addEventListener('error',()=>socket.close())}catch{setTimeout(connectSocket,5000)}}
connectSocket();
