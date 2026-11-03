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
let raceStartedAt = 0;
let raceResults = [];
let resultsTimer = null;
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
  const p={id:crypto.randomUUID?.()||String(Date.now()+Math.random()),username:name,color:COLORS[players.length%COLORS.length],distance:0,gridSlot:players.length,likes:0,likeRemainder:0,effects:[],shieldUntil:0,finished:false,finishTime:null,mesh:null,label:null};
  players.push(p);addFeed(`${name} присоединился к гонке`);
  if(players.length>=config.minPlayers&&phase==='waiting'){
    phase='registration';registrationDeadline=Date.now()+config.registrationSeconds*1000;
    addFeed(`Набрано ${config.minPlayers} участников. Регистрация закроется по таймеру.`);notify('Набрано 10 участников — стартует таймер 3 минуты');
  }
  if(players.length>=config.maxPlayers){addFeed('Достигнут максимум участников. Новые заявки закрыты.');notify('Набор участников завершён: достигнут лимит');}
  renderAll();syncCars();return true;
}
function applyEffect(player,effect,duration,strength=1){
  if(!player||player.finished)return;
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
function pickTarget(username){if(username){const target=findPlayer(username);if(target&&!target.finished)return target}return [...players].filter(p=>!p.finished).sort((a,b)=>b.distance-a.distance)[0]||null}
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

// Three.js scene: long point-to-point 3D race with live camera framing.
const wrap=$('scene-wrap');
const scene=new THREE.Scene();
scene.background=new THREE.Color('#9bc7e6');
scene.fog=new THREE.Fog('#9bc7e6',150,360);

const camera=new THREE.PerspectiveCamera(38,1,.1,900);
camera.position.set(-560,84,138);
camera.lookAt(-570,0,0);

const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.55));
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.12;
wrap.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight('#f4fbff','#486b45',2.15));
const sun=new THREE.DirectionalLight('#fff2d7',3.1);
sun.position.set(-280,180,120);
sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);
sun.shadow.camera.left=-180;sun.shadow.camera.right=180;
sun.shadow.camera.top=150;sun.shadow.camera.bottom=-150;
scene.add(sun);
const fill=new THREE.DirectionalLight('#a9d9ff',1.25);
fill.position.set(180,100,-120);scene.add(fill);

const TRACK_WIDTH=38;
const GRID_LANES=8;
const GRID_LANE_SPACING=4.15;
const GRID_ROW_SPACING=6.0;
const TRACK_POINTS=[
  [-720,0,0],[-510,0,-3],[-330,0,-12],[-130,0,-12],
  [70,0,8],[280,0,13],[470,0,5],[720,0,0]
].map(v=>new THREE.Vector3(v[0],v[1],v[2]));
const TRACK_CURVE=new THREE.CatmullRomCurve3(TRACK_POINTS,false,'centripetal',.15);
const TRACK_LENGTH=TRACK_CURVE.getLength();
const TRACK_SEGMENTS=520;

function sampleTrack(t){
  const u=THREE.MathUtils.clamp(t,0,1);
  const point=TRACK_CURVE.getPointAt(u);
  const tangent=TRACK_CURVE.getTangentAt(u).normalize();
  const normal=new THREE.Vector3(-tangent.z,0,tangent.x).normalize();
  return {point,tangent,normal};
}

const grass=new THREE.Mesh(
  new THREE.PlaneGeometry(1800,360),
  new THREE.MeshStandardMaterial({color:'#5c9c55',roughness:1})
);
grass.rotation.x=-Math.PI/2;grass.position.y=-.52;grass.receiveShadow=true;scene.add(grass);

// Distant hills soften the horizon behind the raceway.
const hillMat=[ '#7bac78','#8db77f','#719b72' ].map(c=>new THREE.MeshStandardMaterial({color:c,roughness:1}));
for(let i=0;i<18;i++){
  const x=-760+i*90;
  for(const side of [-1,1]){
    const hill=new THREE.Mesh(new THREE.ConeGeometry(24+(i%4)*5,28+(i%5)*7,7),hillMat[(i+side+3)%3]);
    hill.position.set(x,10,side*(118+(i%3)*8));
    hill.scale.z=1.6;hill.castShadow=true;scene.add(hill);
  }
}

function makeRibbon(innerOffset,outerOffset,y,material,name){
  const positions=[],uvs=[],indices=[];
  for(let i=0;i<=TRACK_SEGMENTS;i++){
    const t=i/TRACK_SEGMENTS;
    const s=sampleTrack(t);
    const a=s.point.clone().addScaledVector(s.normal,innerOffset);a.y=y;
    const b=s.point.clone().addScaledVector(s.normal,outerOffset);b.y=y;
    positions.push(a.x,a.y,a.z,b.x,b.y,b.z);
    uvs.push(t*45,0,t*45,1);
    if(i<TRACK_SEGMENTS){const n=i*2;indices.push(n,n+1,n+2,n+1,n+3,n+2);}
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geometry.setIndex(indices);geometry.computeVertexNormals();
  const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.receiveShadow=true;scene.add(mesh);return mesh;
}
const shoulderMat=new THREE.MeshStandardMaterial({color:'#c1c8cc',roughness:.92,side:THREE.DoubleSide});
const asphaltMat=new THREE.MeshStandardMaterial({color:'#343b43',roughness:.98,metalness:.02,side:THREE.DoubleSide});
const edgeMat=new THREE.MeshStandardMaterial({color:'#f7f6ec',roughness:.85,side:THREE.DoubleSide});
makeRibbon(-TRACK_WIDTH/2-3.2,TRACK_WIDTH/2+3.2,.015,shoulderMat,'wide-concrete-shoulder');
makeRibbon(-TRACK_WIDTH/2,TRACK_WIDTH/2,.055,asphaltMat,'long-asphalt-road');
makeRibbon(-TRACK_WIDTH/2+.2,-TRACK_WIDTH/2+.38,.085,edgeMat,'left-road-edge');
makeRibbon(TRACK_WIDTH/2-.38,TRACK_WIDTH/2-.2,.085,edgeMat,'right-road-edge');

// Dashed centre line and red/white kerbs use instanced meshes to keep 50-player performance stable.
const dashMesh=new THREE.InstancedMesh(
  new THREE.BoxGeometry(.28,.045,4.0),
  new THREE.MeshStandardMaterial({color:'#f4f4e9',roughness:.9}),
  180
);
dashMesh.castShadow=false;dashMesh.receiveShadow=false;
const dummy=new THREE.Object3D();
for(let i=0;i<180;i++){
  const s=sampleTrack((i+.5)/180);
  dummy.position.copy(s.point);dummy.position.y=.095;
  dummy.rotation.set(0,Math.atan2(-s.tangent.x,-s.tangent.z),0);
  dummy.updateMatrix();dashMesh.setMatrixAt(i,dummy.matrix);
}
dashMesh.instanceMatrix.needsUpdate=true;scene.add(dashMesh);

const curbGeo=new THREE.BoxGeometry(1.6,.18,1.1);
const curbRed=new THREE.InstancedMesh(curbGeo,new THREE.MeshStandardMaterial({color:'#e94d52',roughness:.8}),190);
const curbWhite=new THREE.InstancedMesh(curbGeo,new THREE.MeshStandardMaterial({color:'#f4f1e7',roughness:.8}),190);
let redCount=0,whiteCount=0;
for(let side of [-1,1]){
  for(let i=0;i<190;i++){
    const s=sampleTrack(i/190);
    const obj=dummy;
    obj.position.copy(s.point).addScaledVector(s.normal,side*(TRACK_WIDTH/2+1.0));
    obj.position.y=.17;obj.rotation.set(0,Math.atan2(-s.tangent.x,-s.tangent.z),0);
    obj.updateMatrix();
    if((i+(side===1?1:0))%2===0)curbRed.setMatrixAt(redCount++,obj.matrix);
    else curbWhite.setMatrixAt(whiteCount++,obj.matrix);
  }
}
curbRed.count=redCount;curbWhite.count=whiteCount;
curbRed.instanceMatrix.needsUpdate=true;curbWhite.instanceMatrix.needsUpdate=true;
scene.add(curbRed,curbWhite);

function makeTrackTube(offset,y,radius,color){
  const points=[];
  for(let i=0;i<=240;i++){
    const s=sampleTrack(i/240);
    const p=s.point.clone().addScaledVector(s.normal,offset);p.y=y;points.push(p);
  }
  const curve=new THREE.CatmullRomCurve3(points,false,'catmullrom',.12);
  const mesh=new THREE.Mesh(
    new THREE.TubeGeometry(curve,520,radius,7,false),
    new THREE.MeshStandardMaterial({color,metalness:.55,roughness:.38})
  );
  mesh.castShadow=true;scene.add(mesh);
}
makeTrackTube(-TRACK_WIDTH/2-3.8,1.05,.22,'#e4e9eb');
makeTrackTube(TRACK_WIDTH/2+3.8,1.05,.22,'#e4e9eb');

function addBox(w,h,d,color,x,y,z,metalness=.08){
  const mesh=new THREE.Mesh(
    new THREE.BoxGeometry(w,h,d),
    new THREE.MeshStandardMaterial({color,roughness:.75,metalness})
  );
  mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);return mesh;
}
function addGate(t,label,accent){
  const s=sampleTrack(t);
  const gate=new THREE.Group();
  const postMat=new THREE.MeshStandardMaterial({color:accent,metalness:.35,roughness:.38});
  for(const side of [-1,1]){
    const post=new THREE.Mesh(new THREE.BoxGeometry(.8,8,.8),postMat);
    post.position.set(side*(TRACK_WIDTH/2+1),4,0);
    gate.add(post);
  }
  const bar=new THREE.Mesh(new THREE.BoxGeometry(TRACK_WIDTH+4,.9,.8),postMat);
  bar.position.y=8;gate.add(bar);
  const bannerCanvas=document.createElement('canvas');bannerCanvas.width=1024;bannerCanvas.height=192;
  const ctx=bannerCanvas.getContext('2d');
  ctx.fillStyle='#11233e';ctx.fillRect(0,0,1024,192);
  ctx.fillStyle=accent;ctx.fillRect(0,0,14,192);ctx.fillRect(1010,0,14,192);
  ctx.fillStyle='#ffffff';ctx.font='bold 104px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,512,100);
  const texture=new THREE.CanvasTexture(bannerCanvas);texture.colorSpace=THREE.SRGBColorSpace;
  const sign=new THREE.Mesh(new THREE.PlaneGeometry(TRACK_WIDTH+3,5.2),new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide}));
  sign.position.set(0,8.2,.46);gate.add(sign);
  const yaw=Math.atan2(-s.tangent.x,-s.tangent.z);
  gate.position.copy(s.point);gate.position.y=0;gate.rotation.y=yaw;scene.add(gate);
  const lineMat=new THREE.MeshStandardMaterial({color:'#f6f5eb',roughness:.8});
  const line=new THREE.Mesh(new THREE.BoxGeometry(TRACK_WIDTH,.08,2),lineMat);
  line.position.copy(s.point);line.position.y=.12;line.rotation.y=yaw;scene.add(line);
}
addGate(0,'START','#25d0ec');
addGate(1,'FINISH','#f4b849');

// Spectator stands, pit buildings and trees along both sides of the long course.
// Seats are instanced so a full 50-car field remains responsive.
const standColors=['#e85b72','#f2c25e','#3dc4df','#8877e8','#f4f5ef'];
const seatGeometry=new THREE.BoxGeometry(1.35,.35,.72);
const seatInstances=standColors.map(color=>new THREE.InstancedMesh(
  seatGeometry,new THREE.MeshStandardMaterial({color,roughness:.7}),704
));
const seatCounts=standColors.map(()=>0);
const seatDummy=new THREE.Object3D();
for(const x of [-390,-80,260,520]){
  for(const side of [-1,1]){
    const z=side*54;
    addBox(48,1.2,8,'#64778a',x,1.2,z);
    for(let row=0;row<4;row++){
      addBox(46,.55,1.1,'#7e8fa1',x,2.0+row*.72,z+side*(row*.55));
      for(let seat=0;seat<22;seat++){
        const colorIndex=(seat+row)%standColors.length;
        seatDummy.position.set(x-21.5+seat*2.05,2.35+row*.72,z+side*(row*.55));
        seatDummy.rotation.set(0,0,0);seatDummy.updateMatrix();
        seatInstances[colorIndex].setMatrixAt(seatCounts[colorIndex]++,seatDummy.matrix);
      }
    }
  }
}
seatInstances.forEach((mesh,i)=>{
  mesh.count=seatCounts[i];mesh.instanceMatrix.needsUpdate=true;scene.add(mesh);
});
addBox(32,4,12,'#e8eef1',-210,2,-58);
addBox(34,.8,13,'#35bfd1',-210,4.4,-58);
addBox(28,3,10,'#dce8ed',390,1.5,58);
addBox(30,.7,11,'#e65e70',390,3.4,58);

const trunkMat=new THREE.MeshStandardMaterial({color:'#775437',roughness:1});
const leaves=['#2e8656','#3d9a61','#4aa76a'].map(c=>new THREE.MeshStandardMaterial({color:c,roughness:1}));
for(let x=-690;x<=690;x+=38){
  for(const side of [-1,1]){
    const z=side*(82+(Math.abs(x/38)%3)*5);
    const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.22,.3,2.0,7),trunkMat);
    trunk.position.set(x,1,z);trunk.castShadow=true;scene.add(trunk);
    const crown=new THREE.Mesh(new THREE.ConeGeometry(1.8,4.7,7),leaves[Math.abs(Math.floor(x/38)+side)%3]);
    crown.position.set(x,4,z);crown.castShadow=true;scene.add(crown);
  }
}

// Floodlights repeat along the route for a broadcast-racing arena feel.
for(let x=-620;x<=620;x+=155){
  for(const side of [-1,1]){
    const z=side*43;
    addBox(.55,14,.55,'#8795a3',x,7,z,.5);
    addBox(4,.55,1.3,'#fff1c5',x,14,z,.15);
    const lamp=new THREE.PointLight('#fff0c2',8,32);lamp.position.set(x,13,z);scene.add(lamp);
  }
}

// Each joined spectator gets one 3D sports car and a billboard name above it.
const carsGroup=new THREE.Group();scene.add(carsGroup);
const carObjects=new Map();
function makeNameSprite(name,color){
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='rgba(7,17,34,.9)';ctx.beginPath();ctx.roundRect(10,12,492,104,24);ctx.fill();
  ctx.strokeStyle=color;ctx.lineWidth=7;ctx.stroke();
  ctx.fillStyle='#fff';ctx.font='bold 48px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
  let label=String(name||'Зритель');
  while(ctx.measureText(label).width>450&&label.length>5)label=label.slice(0,-2)+'…';
  ctx.fillText(label,256,66);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:false,depthWrite:false}));
  sprite.position.set(0,3.25,0);sprite.scale.set(6.4,1.6,1);return sprite;
}
function makeCar(color,name){
  const root=new THREE.Group();
  const paint=new THREE.MeshStandardMaterial({color,metalness:.55,roughness:.25});
  const dark=new THREE.MeshStandardMaterial({color:'#17212b',metalness:.3,roughness:.38});
  const glass=new THREE.MeshStandardMaterial({color:'#17354d',metalness:.5,roughness:.16});
  const tyre=new THREE.MeshStandardMaterial({color:'#10151d',roughness:.92});
  const rim=new THREE.MeshStandardMaterial({color:'#d4e1e8',metalness:.88,roughness:.2});
  const body=new THREE.Mesh(new THREE.BoxGeometry(1.95,.72,4.15),paint);
  body.position.y=.78;body.castShadow=true;root.add(body);
  const hood=new THREE.Mesh(new THREE.BoxGeometry(1.78,.24,1.15),paint);
  hood.position.set(0,1.16,-1.38);root.add(hood);
  const cabin=new THREE.Mesh(new THREE.BoxGeometry(1.48,.78,1.95),glass);
  cabin.position.set(0,1.32,.02);cabin.castShadow=true;root.add(cabin);
  const roof=new THREE.Mesh(new THREE.BoxGeometry(1.38,.18,1.25),paint);
  roof.position.set(0,1.78,.04);root.add(roof);
  const spoiler=new THREE.Mesh(new THREE.BoxGeometry(2.1,.16,.42),dark);
  spoiler.position.set(0,1.2,1.87);root.add(spoiler);
  const spoilerPost1=new THREE.Mesh(new THREE.BoxGeometry(.1,.5,.1),rim);spoilerPost1.position.set(-.62,.96,1.72);root.add(spoilerPost1);
  const spoilerPost2=spoilerPost1.clone();spoilerPost2.position.x=.62;root.add(spoilerPost2);
  const wheelParts=[];
  for(const side of [-1,1]){
    for(const z of [-1.3,1.28]){
      const wheel=new THREE.Group();
      const rubber=new THREE.Mesh(new THREE.CylinderGeometry(.42,.42,.28,18),tyre);rubber.rotation.z=Math.PI/2;wheel.add(rubber);
      const alloy=new THREE.Mesh(new THREE.CylinderGeometry(.27,.27,.3,16),rim);alloy.rotation.z=Math.PI/2;wheel.add(alloy);
      wheel.position.set(side*1.0,.43,z);root.add(wheel);wheelParts.push(wheel);
    }
  }
  const headMat=new THREE.MeshStandardMaterial({color:'#f8ffff',emissive:'#d8f6ff',emissiveIntensity:2.3});
  for(const x of [-.62,.62]){
    const light=new THREE.Mesh(new THREE.BoxGeometry(.42,.16,.08),headMat);light.position.set(x,.86,-2.1);root.add(light);
    const tail=new THREE.Mesh(new THREE.BoxGeometry(.42,.14,.08),new THREE.MeshStandardMaterial({color:'#ff324b',emissive:'#fa1834',emissiveIntensity:1.8}));tail.position.set(x,.84,2.1);root.add(tail);
  }
  const underGlow=new THREE.Mesh(
    new THREE.BoxGeometry(1.55,.05,3.25),
    new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.6,transparent:true,opacity:.72})
  );
  underGlow.position.y=.28;root.add(underGlow);
  root.userData.glowMaterial=underGlow.material;root.userData.wheels=wheelParts;
  root.add(makeNameSprite(name,color));
  return root;
}
function syncCars(){
  for(const [id,obj] of carObjects){
    if(!players.some(p=>p.id===id)){carsGroup.remove(obj);carObjects.delete(id);}
  }
  for(const p of players){
    if(!carObjects.has(p.id)){
      const car=makeCar(p.color,p.username);carsGroup.add(car);carObjects.set(p.id,car);p.mesh=car;
    }else p.mesh=carObjects.get(p.id);
  }
}
function getPlayerPose(p,index){
  const slot=Number.isFinite(p.gridSlot)?p.gridSlot:index;
  const row=Math.floor(slot/GRID_LANES);
  const col=slot%GRID_LANES;
  const lane=(col-(GRID_LANES-1)/2)*GRID_LANE_SPACING;
  const rowOffset=row*GRID_ROW_SPACING;
  let along=p.distance*(TRACK_LENGTH+rowOffset)-rowOffset;
  if(p.finished)along=TRACK_LENGTH-rowOffset;
  let sample,point;
  if(along<0){
    sample=sampleTrack(0);
    point=sample.point.clone().addScaledVector(sample.tangent,along);
  }else{
    const u=THREE.MathUtils.clamp(along/TRACK_LENGTH,0,1);
    sample=sampleTrack(u);point=sample.point.clone();
  }
  point.addScaledVector(sample.normal,lane);
  return {point,sample,lane,row};
}
function placeCar(p,index){
  if(!p.mesh)return;
  const pose=getPlayerPose(p,index);
  p.mesh.position.set(pose.point.x,.13+Math.sin(performance.now()*.006+index)*.025,pose.point.z);
  p.mesh.rotation.y=Math.atan2(-pose.sample.tangent.x,-pose.sample.tangent.z);
  if(p.mesh.userData.glowMaterial){
    const boosted=p.effects.some(e=>e.type==='boost');
    p.mesh.userData.glowMaterial.emissiveIntensity=boosted?1.8:.6;
  }
  if(p.mesh.userData.wheels){
    const spin=p.finished?0:.13;
    for(const wheel of p.mesh.userData.wheels)wheel.rotation.x-=spin;
  }
}
let cameraDistance=165;
let cameraFocusX=-570;
function updateRaceCamera(dt){
  let minX=Infinity,maxX=-Infinity;
  if(players.length){
    players.forEach((p,i)=>{
      const x=getPlayerPose(p,i).point.x;
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);
    });
  }else{minX=-700;maxX=-660;}
  const spread=maxX-minX;
  const center=(minX+maxX)/2;
  const desiredWidth=Math.max(150,spread+120);
  const aspect=Math.max(.8,wrap.clientWidth/Math.max(1,wrap.clientHeight));
  const desiredDistance=THREE.MathUtils.clamp(
    desiredWidth/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*aspect),
    95,360
  );
  const smooth=1-Math.exp(-Math.max(.01,dt)*1.9);
  cameraDistance=THREE.MathUtils.lerp(cameraDistance,desiredDistance,smooth);
  cameraFocusX=THREE.MathUtils.lerp(cameraFocusX,center+13,smooth);
  camera.position.set(cameraFocusX,cameraDistance*.52+8,cameraDistance*.82);
  camera.lookAt(cameraFocusX+12,0,0);
}
function resize(){
  const w=wrap.clientWidth,h=wrap.clientHeight;
  camera.aspect=w/Math.max(1,h);camera.updateProjectionMatrix();renderer.setSize(w,h,false);
}
new ResizeObserver(resize).observe(wrap);
resize();
$('scene-loading').style.display='none';
function renderParticipants(){
  if(phase==='results'){
    $('participants-list').innerHTML=raceResults.map((p,i)=>
      '<div class="participant-row result-row"><span class="winner-rank">'+(i+1)+'</span><span class="name">'+escapeHtml(p.username)+'</span><span class="distance">'+formatFinishTime(p.finishTime)+'</span></div>'
    ).join('')||'<div class="empty-state">Результаты пока отсутствуют.</div>';
    $('participant-status').textContent='Полный финишный протокол';
  }else{
    const sorted=[...players].sort((a,b)=>b.distance-a.distance);
    $('participants-list').innerHTML=sorted.length?sorted.map((p,i)=>
      '<div class="participant-row"><span class="car-dot" style="background:'+p.color+';color:'+p.color+'"></span><span class="name">'+(i+1)+'. '+escapeHtml(p.username)+'</span><span class="distance">'+(p.finished?'ФИНИШ':Math.floor(p.distance*100)+'%')+'</span></div>'
    ).join(''):'<div class="empty-state">Пока никто не присоединился.<br />Напиши «Старт» в LIVE-чате.</div>';
    const finished=players.filter(p=>p.finished).length;
    $('participant-status').textContent=players.length?(phase==='race'?finished+' / '+players.length+' на финише':players.length+' машин на стартовой решётке'):'Ожидаем команду «Старт»';
  }
  $('participant-count').textContent=players.length+' / '+config.maxPlayers;
  const finishedCount=$('finished-count');
  if(finishedCount)finishedCount.textContent=players.filter(p=>p.finished).length+' / '+players.length;
}

function formatFinishTime(seconds){
  const value=Math.max(0,Number(seconds)||0);
  const mins=Math.floor(value/60);
  const secs=(value%60).toFixed(2).padStart(5,'0');
  return String(mins).padStart(2,'0')+':'+secs;
}

function renderFinishOverlay(){
  const overlay=$('finish-overlay');
  if(!overlay)return;
  overlay.hidden=phase!=='results';
  if(phase!=='results')return;
  const list=$('finish-results-list');
  if(!list)return;
  list.innerHTML=raceResults.map((p,i)=>
    '<div class="finish-result-row"><span class="finish-place">'+(i===0?'🏆':String(i+1).padStart(2,'0'))+'</span><span class="finish-name">'+escapeHtml(p.username)+'</span><strong class="finish-time">'+formatFinishTime(p.finishTime)+'</strong></div>'
  ).join('');
}
function renderWinners(){
  const rows=Object.entries(winners).sort((a,b)=>b[1].wins-a[1].wins||b[1].lastWin-a[1].lastWin);
  const total=rows.reduce((s,[,v])=>s+v.wins,0);$('wins-total').textContent=`${total} побед`;
  $('winners-list').innerHTML=rows.length?rows.slice(0,10).map(([name,v],i)=>`<div class="winner-row"><span class="winner-rank">${i+1}</span><span class="name">${escapeHtml(name)}</span><span class="win-count">${v.wins} 🏆</span></div>`).join(''):'<div class="empty-state compact">Победители появятся после первой гонки.</div>';
}
function renderFeed(){$('activity-feed').innerHTML=activity.length?activity.map(a=>`<div class="feed-item"><span class="feed-time">${a.time}</span><span class="feed-text">${escapeHtml(a.text)}</span></div>`).join(''):'<div class="feed-item muted">События появятся здесь.</div>'}
function formatTime(sec){sec=Math.max(0,Math.ceil(sec));return `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`}
function renderStatus(){
  const phaseText={waiting:'Ожидание',registration:'Регистрация',race:'Гонка',results:'Результаты'};
  const stateText={waiting:'ОЖИДАНИЕ УЧАСТНИКОВ',registration:'РЕГИСТРАЦИЯ ОТКРЫТА',race:'ГОНКА ИДЁТ',results:'ВСЕ МАШИНЫ НА ФИНИШЕ'};
  $('phase-label').textContent=phaseText[phase]||'Ожидание';
  $('race-state').textContent=stateText[phase]||stateText.waiting;
  if(phase==='waiting'){
    $('timer-label').textContent='УЧАСТНИКОВ ДЛЯ СТАРТА';
    $('timer').textContent=players.length+' / '+config.minPlayers;
    if($('timer-subtitle'))$('timer-subtitle').textContent='Нужно минимум '+config.minPlayers+' участников';
  }else if(phase==='registration'){
    $('timer-label').textContent='ДО СТАРТА';
    $('timer').textContent=formatTime((registrationDeadline-Date.now())/1000);
    if($('timer-subtitle'))$('timer-subtitle').textContent=players.length+' / '+config.maxPlayers+' машин на старте';
  }else{
    const elapsed=raceStartedAt?Math.max(0,(Date.now()-raceStartedAt)/1000):0;
    $('timer-label').textContent='ОБЩЕЕ ВРЕМЯ ГОНКИ';
    $('timer').textContent=formatTime(elapsed)+' / '+formatTime(config.raceSeconds);
    if($('timer-subtitle')){
      const finished=players.filter(p=>p.finished).length;
      $('timer-subtitle').textContent=phase==='results'
        ?'Все финишировали • следующий набор скоро'
        :'Финишировали '+finished+' из '+players.length+' • цель '+formatTime(config.raceSeconds);
    }
  }
  const finishOverlay=$('finish-overlay');
  if(finishOverlay)finishOverlay.hidden=phase!=='results';
}
function renderAll(){renderParticipants();renderWinners();renderStatus();}
function finishRace(){
  if(phase!=='race'||!players.length)return;
  raceResults=[...players].sort((a,b)=>(a.finishTime??Infinity)-(b.finishTime??Infinity));
  const winner=raceResults[0];
  if(winner){
    const key=winner.username;
    winners[key]??={wins:0,participations:0,lastWin:0};
    winners[key].wins++;winners[key].lastWin=Date.now();
    for(const p of players){
      winners[p.username]??={wins:0,participations:0,lastWin:0};
      winners[p.username].participations++;
    }
    saveWinners();
    addFeed('🏆 Победитель гонки: '+winner.username+' — '+formatFinishTime(winner.finishTime));
    notify('🏆 Победитель: '+winner.username);
  }
  phase='results';
  addFeed('Все '+players.length+' машин пересекли финиш. Показан полный протокол.');
  renderAll();
  renderFinishOverlay();
  if(resultsTimer)clearTimeout(resultsTimer);
  resultsTimer=setTimeout(()=>{
    players=[];
    raceResults=[];
    phase='waiting';
    raceStartedAt=0;
    registrationDeadline=0;
    raceDeadline=0;
    syncCars();
    renderAll();
    addFeed('Результаты сохранены. Открыт набор на следующую гонку.');
  },18000);
}

function startRace(){
  if(phase!=='registration'||players.length<config.minPlayers)return;
  if(resultsTimer){clearTimeout(resultsTimer);resultsTimer=null;}
  phase='race';
  raceStartedAt=Date.now();
  raceDeadline=0;
  raceResults=[];
  players.forEach(p=>{
    p.distance=0;p.effects=[];p.shieldUntil=0;p.finished=false;p.finishTime=null;
  });
  addFeed('🏁 Гонка №'+(raceNumber+1)+' началась! Участников: '+players.length);
  notify('Старт! Пять минут до контрольного финиша!');
  renderAll();
}

let lastLeaderboardPaint=0;
function tick(now){
  const dt=Math.min((now-lastTick)/1000,.1);
  lastTick=now;
  if(phase==='registration'&&Date.now()>=registrationDeadline)startRace();

  if(phase==='race'){
    const currentTime=Date.now();
    const elapsed=(currentTime-raceStartedAt)/1000;
    for(const p of players){
      if(p.finished)continue;
      p.effects=p.effects.filter(e=>e.until>currentTime);
      let multiplier=1;
      for(const effect of p.effects){
        if(effect.type==='boost')multiplier=Math.max(multiplier,effect.strength);
        if(effect.type==='slow')multiplier=Math.min(multiplier,effect.strength);
        if(effect.type==='stun')multiplier=0;
      }
      const rate=multiplier/config.raceSeconds;
      const secondsToFinish=rate>0?(1-p.distance)/rate:Infinity;
      p.distance=Math.min(1,p.distance+dt*rate);
      if(p.distance>=1){
        p.distance=1;
        p.finished=true;
        p.finishTime=Math.max(0,elapsed-dt+Math.min(dt,secondsToFinish));
        p.effects=[];
        addFeed('🏁 '+p.username+' пересёк финиш за '+formatFinishTime(p.finishTime));
      }
    }
    if(players.length&&players.every(p=>p.finished))finishRace();
    if(now-lastLeaderboardPaint>350){renderParticipants();lastLeaderboardPaint=now;}
  }

  players.forEach(placeCar);
  updateRaceCamera(dt);
  renderStatus();
  renderer.render(scene,camera);
  requestAnimationFrame(tick);
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

// WebSocket receives normalized events from the Node bridge.
// On hosted preview, keep the game usable in demo mode until an event server URL is configured.
const isLocalHost=['localhost','127.0.0.1'].includes(location.hostname);
const wsUrl=import.meta.env.VITE_WS_URL||(isLocalHost?`ws://${location.hostname}:8787`:'');
let socket;
function connectSocket(){
  if(!wsUrl){addFeed('Режим предпросмотра: LIVE-сервер пока не подключён');return}
  try{
    socket=new WebSocket(wsUrl);
    socket.addEventListener('open',()=>addFeed('Подключено к LIVE event-серверу'));
    socket.addEventListener('message',e=>{try{processEvent(JSON.parse(e.data))}catch{}});
    socket.addEventListener('close',()=>setTimeout(connectSocket,3500));
    socket.addEventListener('error',()=>socket.close());
  }catch{setTimeout(connectSocket,5000)}
}
connectSocket();
