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
  const p={id:crypto.randomUUID?.()||String(Date.now()+Math.random()),username:name,color:COLORS[players.length%COLORS.length],distance:0,gridSlot:players.length,lane:(players.length%2===0?-1.55:1.55),likes:0,likeRemainder:0,effects:[],shieldUntil:0,mesh:null,label:null};
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

// Three.js scene: full 3D circuit, detailed arcade-sport cars and name tags.
const wrap=$('scene-wrap');
const scene=new THREE.Scene();
scene.background=new THREE.Color('#9fc9e8');
scene.fog=new THREE.Fog('#9fc9e8',85,175);

const camera=new THREE.PerspectiveCamera(43,1,.1,260);
camera.position.set(0,66,78);
camera.lookAt(0,0,0);

const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.12;
wrap.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight('#eaf7ff','#496447',2.25));
const sun=new THREE.DirectionalLight('#fff4dc',3.15);
sun.position.set(-32,58,25);
sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);
sun.shadow.camera.left=-65;sun.shadow.camera.right=65;sun.shadow.camera.top=65;sun.shadow.camera.bottom=-65;
scene.add(sun);
const fillLight=new THREE.DirectionalLight('#8cc9ff',1.2);
fillLight.position.set(34,24,-28);
scene.add(fillLight);

const ground=new THREE.Mesh(
  new THREE.PlaneGeometry(240,220),
  new THREE.MeshStandardMaterial({color:'#4b8b55',roughness:1})
);
ground.rotation.x=-Math.PI/2;
ground.position.y=-.42;
ground.receiveShadow=true;
scene.add(ground);

// A real, irregular road circuit: long straights, hairpins and an S-section (not an oval).
const trackPoints=[
  [-29,-19],[-17,-22],[-5,-22],[8,-19],[19,-13],[24,-5],[22,2],[16,6],
  [11,11],[14,18],[9,24],[-2,26],[-14,23],[-23,16],[-25,8],[-20,3],
  [-13,1],[-17,-5],[-25,-8],[-31,-12]
].map(v=>new THREE.Vector3(v[0],0,v[1]));
const TRACK_CURVE=new THREE.CatmullRomCurve3(trackPoints,true,'catmullrom',.18);
const TRACK_LENGTH=TRACK_CURVE.getLength();
const ROAD_WIDTH=10.8;
const SEGMENTS=560;

function sampleTrack(t){
  const point=TRACK_CURVE.getPointAt((t%1+1)%1);
  const tangent=TRACK_CURVE.getTangentAt((t%1+1)%1).normalize();
  const normal=new THREE.Vector3(-tangent.z,0,tangent.x).normalize();
  return {point,tangent,normal};
}
function makeRibbon(innerOffset,outerOffset,y,material,name){
  const positions=[],uvs=[],indices=[];
  for(let i=0;i<=SEGMENTS;i++){
    const t=i/SEGMENTS;
    const s=sampleTrack(t);
    const a=s.point.clone().addScaledVector(s.normal,innerOffset);a.y=y;
    const b=s.point.clone().addScaledVector(s.normal,outerOffset);b.y=y;
    positions.push(a.x,a.y,a.z,b.x,b.y,b.z);
    uvs.push(t*30,0,t*30,1);
    if(i<SEGMENTS){const n=i*2;indices.push(n,n+1,n+2,n+1,n+3,n+2);}
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh=new THREE.Mesh(geometry,material);
  mesh.name=name||'track-ribbon';
  mesh.receiveShadow=true;
  scene.add(mesh);
  return mesh;
}

const shoulderMat=new THREE.MeshStandardMaterial({color:'#aeb6bd',roughness:.92,side:THREE.DoubleSide});
const asphaltMat=new THREE.MeshStandardMaterial({color:'#343a43',roughness:.96,metalness:.02,side:THREE.DoubleSide});
const whiteLineMat=new THREE.MeshStandardMaterial({color:'#f6f4e9',roughness:.75});
makeRibbon(-ROAD_WIDTH/2-1.05,ROAD_WIDTH/2+1.05,.005,shoulderMat,'concrete-shoulder');
makeRibbon(-ROAD_WIDTH/2,ROAD_WIDTH/2,.035,asphaltMat,'asphalt-track');
makeRibbon(-ROAD_WIDTH/2+.18,-ROAD_WIDTH/2+.34,.065,whiteLineMat,'inside-edge-line');
makeRibbon(ROAD_WIDTH/2-.34,ROAD_WIDTH/2-.18,.065,whiteLineMat,'outside-edge-line');

// Red/white kerbs on both sides.
const curbGeometry=new THREE.BoxGeometry(1.15,.16,.72);
for(let i=0;i<260;i++){
  const t=i/130;
  const side=i<130?-1:1;
  const s=sampleTrack(t);
  const curb=new THREE.Mesh(curbGeometry,new THREE.MeshStandardMaterial({
    color:(i%2===0)?'#f4f3ea':'#ed4f54',roughness:.82
  }));
  curb.position.copy(s.point).addScaledVector(s.normal,side*(ROAD_WIDTH/2+.05));
  curb.position.y=.12;
  curb.rotation.y=Math.atan2(-s.tangent.x,-s.tangent.z);
  curb.castShadow=true;
  scene.add(curb);
}

// Dashed centre line, painted in short segments that follow the bends.
const dashGeometry=new THREE.BoxGeometry(.15,.035,2.15);
const dashMat=new THREE.MeshStandardMaterial({color:'#f9f6e9',roughness:.85});
for(let i=0;i<95;i++){
  const s=sampleTrack((i+.25)/95);
  const dash=new THREE.Mesh(dashGeometry,dashMat);
  dash.position.copy(s.point);dash.position.y=.085;
  dash.rotation.y=Math.atan2(-s.tangent.x,-s.tangent.z);
  scene.add(dash);
}

// Guard rails outside the kerbs.
function makeOffsetCurve(offset,y){
  const pts=[];
  for(let i=0;i<=240;i++){
    const s=sampleTrack(i/240);
    const p=s.point.clone().addScaledVector(s.normal,offset);p.y=y;pts.push(p);
  }
  return new THREE.CatmullRomCurve3(pts,true,'catmullrom',.12);
}
for(const side of [-1,1]){
  const offset=side*(ROAD_WIDTH/2+1.55);
  const railCurve=makeOffsetCurve(offset,1.02);
  const rail=new THREE.Mesh(
    new THREE.TubeGeometry(railCurve,520,.16,8,true),
    new THREE.MeshStandardMaterial({color:'#dce5ee',metalness:.65,roughness:.32})
  );
  rail.castShadow=true;scene.add(rail);
  for(let i=0;i<100;i+=4){
    const s=sampleTrack(i/100);
    const post=new THREE.Mesh(
      new THREE.BoxGeometry(.17,1.12,.17),
      new THREE.MeshStandardMaterial({color:'#687586',metalness:.45,roughness:.55})
    );
    post.position.copy(s.point).addScaledVector(s.normal,offset);post.position.y=.53;
    scene.add(post);
  }
}

// Start / finish checkerboard across the track.
{
  const s=sampleTrack(0);
  const yaw=Math.atan2(-s.tangent.x,-s.tangent.z);
  const tileMatA=new THREE.MeshStandardMaterial({color:'#f7f7f2'});
  const tileMatB=new THREE.MeshStandardMaterial({color:'#202634'});
  for(let row=0;row<2;row++){
    for(let col=0;col<12;col++){
      const tile=new THREE.Mesh(new THREE.BoxGeometry(ROAD_WIDTH/12,.045,.72),((row+col)%2)?tileMatA:tileMatB);
      const lateral=(col-5.5)*(ROAD_WIDTH/12);
      const along=(row-.5)*.72;
      const position=s.point.clone().addScaledVector(s.normal,lateral).addScaledVector(s.tangent,along);
      tile.position.set(position.x,.105,position.z);
      tile.rotation.y=yaw;scene.add(tile);
    }
  }
  const sign=new THREE.Mesh(new THREE.BoxGeometry(ROAD_WIDTH+1,.34,.38),new THREE.MeshStandardMaterial({color:'#17253b',emissive:'#0b3c55',emissiveIntensity:.45}));
  sign.position.copy(s.point).addScaledVector(s.tangent,-2.2);sign.position.y=5.2;scene.add(sign);
  const signCanvas=document.createElement('canvas');signCanvas.width=1024;signCanvas.height=128;
  const ctx=signCanvas.getContext('2d');ctx.fillStyle='#10223b';ctx.fillRect(0,0,1024,128);
  ctx.fillStyle='#f8fbff';ctx.font='bold 76px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('RACING  •  START / FINISH',512,66);
  const tex=new THREE.CanvasTexture(signCanvas);tex.colorSpace=THREE.SRGBColorSpace;
  const board=new THREE.Mesh(new THREE.PlaneGeometry(ROAD_WIDTH+1,1.5),new THREE.MeshBasicMaterial({map:tex,side:THREE.DoubleSide}));
  board.position.copy(sign.position);board.position.y=5.2;board.rotation.y=yaw;scene.add(board);
}

// Infield: manicured grass, paddock buildings, trees, spectator stands and lighting.
function addBox(w,h,d,color,x,y,z,opts={}){
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({
    color,roughness:opts.roughness??.78,metalness:opts.metalness??.08
  }));
  m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;scene.add(m);return m;
}
addBox(15,.4,6,'#d5e1e5',-1,.03,3);
addBox(12,1.4,4.5,'#e9f0f3',-1,.9,3);
addBox(12,.22,4.55,'#e24b61',-1,1.7,3);
for(let i=0;i<4;i++){
  addBox(2.7,.22,1.1,['#35bdd0','#f4c14d','#e85e72','#8275e8'][i],-5.1+i*2.7,1.82,3);
}
addBox(2.4,2.2,2.4,'#203e57',-12,1.1,-4);
addBox(2.6,1.5,2.2,'#e7edf0',-12,2.8,-4);
addBox(3,.22,2.6,'#22c4df',-12,3.65,-4);

// Low-poly trees placed away from the road.
const trunkMat=new THREE.MeshStandardMaterial({color:'#765138',roughness:1});
const leafMats=['#267b51','#31895a','#3c9d60'].map(color=>new THREE.MeshStandardMaterial({color,roughness:1}));
for(let i=0;i<44;i++){
  const x=((i*17)%86)-43;
  const z=((i*29)%72)-36;
  const nearTrack=TRACK_CURVE.getPoints(90).some(p=>Math.hypot(p.x-x,p.z-z)<ROAD_WIDTH/2+4);
  if(nearTrack||Math.hypot(x,z)<8)continue;
  const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.16,.23,1.45,7),trunkMat);
  trunk.position.set(x,.72,z);trunk.castShadow=true;scene.add(trunk);
  const crown=new THREE.Mesh(new THREE.ConeGeometry(1.15,2.8,7),leafMats[i%leafMats.length]);
  crown.position.set(x,2.65,z);crown.castShadow=true;scene.add(crown);
}

// Grandstand on the far side, with colourful seats.
for(let row=0;row<5;row++){
  addBox(34,.6,1.25,'#586b81',-1,1.1+row*.68,-34+row*.15);
  for(let seat=0;seat<24;seat++){
    const colors=['#e85b72','#f1c15b','#41c4dc','#8d78eb'];
    addBox(.72,.34,.55,colors[(seat+row)%colors.length],-17+seat*1.42,1.55+row*.68,-34.6+row*.15);
  }
}
addBox(36,.8,1.2,'#e7edf1',-1,.55,-35.2);

// Floodlight towers around the circuit.
for(const [x,z] of [[-38,-20],[32,-22],[31,23],[-35,24],[0,-35]]){
  const mast=new THREE.Mesh(new THREE.CylinderGeometry(.12,.2,9,8),new THREE.MeshStandardMaterial({color:'#aab8c4',metalness:.55,roughness:.42}));
  mast.position.set(x,4.5,z);mast.castShadow=true;scene.add(mast);
  const head=new THREE.Mesh(new THREE.BoxGeometry(2.0,.45,.8),new THREE.MeshStandardMaterial({color:'#f4f5e8',emissive:'#fff0b3',emissiveIntensity:1.2}));
  head.position.set(x,9,z);scene.add(head);
  const lamp=new THREE.SpotLight('#fff1c6',75,52,Math.PI/4,.5,1.5);
  lamp.position.set(x,8.8,z);lamp.target.position.set(0,0,0);scene.add(lamp,lamp.target);
}

// 3D sports cars with shaped bodywork, cabin, glass, alloy wheels, lights and overhead name tags.
const carsGroup=new THREE.Group();scene.add(carsGroup);
const carObjects=new Map();
function makeNameSprite(name,color){
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;
  const ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,512,128);
  ctx.fillStyle='rgba(7,17,34,.88)';
  ctx.beginPath();ctx.roundRect(10,14,492,100,24);ctx.fill();
  ctx.strokeStyle=color;ctx.lineWidth=7;ctx.stroke();
  ctx.fillStyle='#ffffff';ctx.font='bold 48px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
  let label=String(name||'Зритель');
  while(ctx.measureText(label).width>450&&label.length>5)label=label.slice(0,-2)+'…';
  ctx.fillText(label,256,66);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:true,depthWrite:false}));
  sprite.position.set(0,3.15,0);sprite.scale.set(5.6,1.4,1);
  return sprite;
}
function makeCar(color,name){
  const root=new THREE.Group();
  const paint=new THREE.MeshStandardMaterial({color,metalness:.62,roughness:.24});
  const darkPaint=new THREE.MeshStandardMaterial({color:'#172333',metalness:.45,roughness:.3});
  const glass=new THREE.MeshStandardMaterial({color:'#152c43',metalness:.48,roughness:.12,transparent:true,opacity:.94});
  const rubber=new THREE.MeshStandardMaterial({color:'#11151d',roughness:.88});
  const alloy=new THREE.MeshStandardMaterial({color:'#c9d5df',metalness:.9,roughness:.2});
  const chrome=new THREE.MeshStandardMaterial({color:'#dfe7ee',metalness:.85,roughness:.18});

  const shellShape=new THREE.Shape();
  shellShape.moveTo(0,-2.28);
  shellShape.lineTo(.78,-1.72);shellShape.lineTo(.98,-.72);
  shellShape.lineTo(.94,1.42);shellShape.lineTo(.67,2.08);
  shellShape.lineTo(-.67,2.08);shellShape.lineTo(-.94,1.42);
  shellShape.lineTo(-.98,-.72);shellShape.lineTo(-.78,-1.72);
  shellShape.closePath();
  const shellGeometry=new THREE.ExtrudeGeometry(shellShape,{depth:.62,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.075,bevelThickness:.08,curveSegments:6});
  shellGeometry.rotateX(Math.PI/2);
  const shell=new THREE.Mesh(shellGeometry,paint);shell.position.y=.84;shell.castShadow=true;root.add(shell);

  const chassis=new THREE.Mesh(new THREE.BoxGeometry(1.82,.24,3.45),darkPaint);
  chassis.position.set(0,.42,0);chassis.castShadow=true;root.add(chassis);

  // Raised cabin with dark panoramic windows and a painted roof.
  const cabinShape=new THREE.Shape();
  cabinShape.moveTo(-.61,-1.12);cabinShape.lineTo(.61,-1.12);cabinShape.lineTo(.55,.88);cabinShape.lineTo(-.55,.88);cabinShape.closePath();
  const cabinGeo=new THREE.ExtrudeGeometry(cabinShape,{depth:.68,bevelEnabled:true,bevelSegments:2,bevelSize:.05,bevelThickness:.05});
  cabinGeo.rotateX(Math.PI/2);
  const cabin=new THREE.Mesh(cabinGeo,glass);cabin.position.y=1.26;cabin.castShadow=true;root.add(cabin);
  const roof=new THREE.Mesh(new THREE.BoxGeometry(1.08,.13,1.22),paint);
  roof.position.set(0,1.64,-.08);root.add(roof);
  const windshield=new THREE.Mesh(new THREE.BoxGeometry(1.18,.055,.12),new THREE.MeshStandardMaterial({color:'#9eddf5',metalness:.45,roughness:.12}));
  windshield.position.set(0,1.48,-1.0);windshield.rotation.x=-.22;root.add(windshield);
  const rearGlass=new THREE.Mesh(new THREE.BoxGeometry(1.12,.05,.12),glass);
  rearGlass.position.set(0,1.48,.92);rearGlass.rotation.x=.22;root.add(rearGlass);

  // Side skirts and aerodynamic details.
  for(const side of [-1,1]){
    const skirt=new THREE.Mesh(new THREE.BoxGeometry(.12,.22,2.85),darkPaint);
    skirt.position.set(side*.91,.38,.12);root.add(skirt);
    const mirror=new THREE.Mesh(new THREE.BoxGeometry(.28,.16,.3),paint);
    mirror.position.set(side*1.02,1.1,-.86);root.add(mirror);
    const sideWindow=new THREE.Mesh(new THREE.BoxGeometry(.035,.34,1.35),glass);
    sideWindow.position.set(side*.67,1.36,-.05);root.add(sideWindow);
  }

  const wheelParts=[];
  for(const side of [-1,1]){
    for(const z of [-1.28,1.24]){
      const wheelGroup=new THREE.Group();
      const tyre=new THREE.Mesh(new THREE.CylinderGeometry(.39,.39,.25,20),rubber);
      tyre.rotation.z=Math.PI/2;tyre.castShadow=true;wheelGroup.add(tyre);
      const rim=new THREE.Mesh(new THREE.CylinderGeometry(.255,.255,.265,16),alloy);
      rim.rotation.z=Math.PI/2;wheelGroup.add(rim);
      const hub=new THREE.Mesh(new THREE.CylinderGeometry(.085,.085,.28,12),chrome);
      hub.rotation.z=Math.PI/2;wheelGroup.add(hub);
      for(let spoke=0;spoke<6;spoke++){
        const angle=spoke*Math.PI/3;
        const bar=new THREE.Mesh(new THREE.BoxGeometry(.035,.04,.38),chrome);
        bar.position.set(0,Math.cos(angle)*.16,Math.sin(angle)*.16);bar.rotation.x=angle;wheelGroup.add(bar);
      }
      wheelGroup.position.set(side*.91,.42,z);root.add(wheelGroup);wheelParts.push(wheelGroup);
    }
  }

  // Headlights, grille, diffuser, tail lamps and spoiler.
  for(const x of [-.58,.58]){
    const head=new THREE.Mesh(new THREE.BoxGeometry(.48,.16,.1),new THREE.MeshStandardMaterial({color:'#f6fbff',emissive:'#d5f3ff',emissiveIntensity:2.2}));
    head.position.set(x,.73,-2.2);root.add(head);
    const tail=new THREE.Mesh(new THREE.BoxGeometry(.48,.14,.1),new THREE.MeshStandardMaterial({color:'#ff344f',emissive:'#ff183b',emissiveIntensity:1.6}));
    tail.position.set(x,.72,2.12);root.add(tail);
  }
  const grille=new THREE.Mesh(new THREE.BoxGeometry(.75,.2,.08),darkPaint);grille.position.set(0,.5,-2.24);root.add(grille);
  const diffuser=new THREE.Mesh(new THREE.BoxGeometry(1.35,.18,.32),darkPaint);diffuser.position.set(0,.28,1.92);root.add(diffuser);
  for(const x of [-.52,.52]){
    const post=new THREE.Mesh(new THREE.BoxGeometry(.08,.55,.08),chrome);post.position.set(x,.95,1.78);root.add(post);
  }
  const spoiler=new THREE.Mesh(new THREE.BoxGeometry(2.0,.12,.45),paint);spoiler.position.set(0,1.23,1.87);root.add(spoiler);
  const stripe=new THREE.Mesh(new THREE.BoxGeometry(.16,.025,3.65),new THREE.MeshStandardMaterial({color:'#ffffff',emissive:'#ffffff',emissiveIntensity:.35}));
  stripe.position.set(0,1.17,-.03);root.add(stripe);

  const glow=new THREE.PointLight(color,2.3,6);glow.position.set(0,.5,0);root.add(glow);
  root.userData.aura=glow;
  root.userData.wheels=wheelParts;
  root.add(makeNameSprite(name,color));
  return root;
}
function syncCars(){
  for(const [id,obj] of carObjects){
    if(!players.some(p=>p.id===id)){carsGroup.remove(obj);carObjects.delete(id);}
  }
  for(const p of players){
    if(!carObjects.has(p.id)){
      const car=makeCar(p.color,p.username);
      carsGroup.add(car);carObjects.set(p.id,car);p.mesh=car;
    }else p.mesh=carObjects.get(p.id);
  }
}
function placeCar(p,index){
  if(!p.mesh)return;
  const gridSlot=Number.isFinite(p.gridSlot)?p.gridSlot:index;
  const startProgress=.012-(gridSlot*2.55/TRACK_LENGTH);
  const progress=(startProgress+p.distance%1+1)%1;
  const s=sampleTrack(progress);
  const lane=Number.isFinite(p.lane)?p.lane:((index%2===0)?-1.55:1.55);
  const pos=s.point.clone().addScaledVector(s.normal,lane);
  p.mesh.position.set(pos.x,.11+Math.sin(performance.now()*.006+index)*.018,pos.z);
  p.mesh.rotation.y=Math.atan2(-s.tangent.x,-s.tangent.z);
  p.mesh.userData.aura.intensity=p.effects.some(e=>e.type==='boost')?5.5:2.3;
  for(const wheel of p.mesh.userData.wheels||[])wheel.rotation.x-=.08;
}
function resize(){
  const w=wrap.clientWidth,h=wrap.clientHeight;
  camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);
}
new ResizeObserver(resize).observe(wrap);
resize();
$('scene-loading').style.display='none';
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
