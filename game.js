// Diablo · FPS · Auto —— 第一人称自动战斗 ARPG 原型
// 使用全局 THREE (UMD)，自带迷你 PointerLockControls 实现，无需任何服务器/模块系统

// ====== 版本号（用于排查问题时确认浏览器是否加载到了最新版本） ======
const GAME_VERSION = 'v0.34.0';
const GAME_BUILD   = '2026-06-17';
console.log('%c🎮 Diablo·FPS·Auto '+GAME_VERSION+' ('+GAME_BUILD+')',
  'background:#241c10;color:#e8c45a;padding:4px 10px;border-radius:3px;font-weight:bold');
// 把版本号写到右下角小角标
(function(){
  const b = document.getElementById('verBadge');
  if(b) b.textContent = GAME_VERSION + ' · ' + GAME_BUILD;
})();

// 全局错误兜底：任何脚本错误直接显示在 overlay，方便定位（不再"点击没反应"沉默失败）
window.addEventListener('error', (ev)=>{
  const el = document.getElementById('loadStatus');
  if(el){
    el.style.display='block';
    el.textContent = '❌ '+(ev.message||'脚本错误')+'  @ '+(ev.filename||'').split('/').pop()+':'+(ev.lineno||'?');
  }
});

// ---------- 迷你 PointerLockControls ----------
// 兼容回退：当 Pointer Lock 不可用（如嵌入式 WebView / iframe），自动改为
// "鼠标移动直接转视角 + 按 ESC 暂停"模式，避免崩溃
class PointerLockControls {
  constructor(camera, domElement){
    this.camera = camera;
    this.domElement = domElement;
    this.isLocked = false;
    this.pointerSpeed = 1.0;
    this._listeners = {lock:[], unlock:[]};
    this._euler = new THREE.Euler(0,0,0,'YXZ');
    this._PI_2 = Math.PI/2;
    this._yawObject = new THREE.Object3D();
    this._yawObject.add(camera);
    // 检测 Pointer Lock 支持情况
    this._supportsPointerLock = !!(domElement.requestPointerLock || domElement.mozRequestPointerLock);
    this._fallback = !this._supportsPointerLock;

    this._onMouseMove = this._onMouseMove.bind(this);
    this._onPointerlockChange = this._onPointerlockChange.bind(this);
    this._onPointerlockError = this._onPointerlockError.bind(this);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onPointerlockChange);
    document.addEventListener('pointerlockerror', this._onPointerlockError);
  }
  addEventListener(type, fn){ (this._listeners[type] = this._listeners[type] || []).push(fn); }
  _emit(type){ (this._listeners[type]||[]).forEach(fn=>fn({type})); }
  getObject(){ return this._yawObject; }
  lock(){
    if(this._fallback){
      // 回退模式：直接当做"已锁定"，鼠标移动就会转视角
      if(!this.isLocked){ this.isLocked = true; this._emit('lock'); }
      return;
    }
    try{ this.domElement.requestPointerLock && this.domElement.requestPointerLock(); }
    catch(err){
      console.warn('PointerLock 不可用，切换到回退模式', err);
      this._fallback = true;
      this.isLocked = true; this._emit('lock');
    }
  }
  unlock(){
    if(this._fallback){
      if(this.isLocked){ this.isLocked = false; this._emit('unlock'); }
      return;
    }
    try{ document.exitPointerLock && document.exitPointerLock(); }catch(_){}
  }
  _onMouseMove(e){
    if(!this.isLocked) return;
    const mx = e.movementX || 0, my = e.movementY || 0;
    this._euler.setFromQuaternion(this.camera.quaternion);
    this._euler.y -= mx * 0.002 * this.pointerSpeed;
    this._euler.x -= my * 0.002 * this.pointerSpeed;
    this._euler.x = Math.max(-this._PI_2+0.01, Math.min(this._PI_2-0.01, this._euler.x));
    this.camera.quaternion.setFromEuler(this._euler);
  }
  _onPointerlockChange(){
    if(document.pointerLockElement === this.domElement){
      this.isLocked = true; this._emit('lock');
    } else {
      this.isLocked = false; this._emit('unlock');
    }
  }
  _onPointerlockError(e){
    console.warn('PointerLock 失败，切换到回退模式');
    this._fallback = true;
    this.isLocked = true; this._emit('lock');
  }
}

// ---------- 工具 ----------
const rand=(a,b)=>a+Math.random()*(b-a);
const randi=(a,b)=>Math.floor(rand(a,b+1));

// ---------- 音频系统（暗黑 1 风格 · 全程序化合成，无需外部文件） ----------
const Audio = (function(){
  let ctx=null, master=null, bgmGain=null, sfxGain=null;
  let bgmStarted=false, bgmNodes=[];
  let muted=false, bgmVol=0.18, sfxVol=0.5;
  function ensure(){
    if(ctx){
      // 移动端关键：每次进入用户手势上下文都要尝试 resume，否则 ctx 一直 suspended
      try{ if(ctx.state==='suspended') ctx.resume(); }catch(_){}
      return ctx;
    }
    try{
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value=1; master.connect(ctx.destination);
      bgmGain = ctx.createGain(); bgmGain.gain.value=bgmVol; bgmGain.connect(master);
      sfxGain = ctx.createGain(); sfxGain.gain.value=sfxVol; sfxGain.connect(master);
      // iOS Safari：必须在用户手势内 resume 才能出声
      try{ if(ctx.state==='suspended') ctx.resume(); }catch(_){}
    } catch(_){ ctx=null; }
    return ctx;
  }

  // ===== BGM：低频持续音 + 远处钟声 + 风声（D1 大教堂氛围） =====
  // v0.32.7 起按用户要求完全关闭背景音乐；保留函数定义避免外部调用报错
  function startBGM(){
    return; // 背景音乐已禁用
    // eslint-disable-next-line no-unreachable
    if(bgmStarted) return;
    if(!ensure()) return;
    if(ctx.state==='suspended') ctx.resume();
    bgmStarted=true;
    const t=ctx.currentTime;

    // 1) 持续低频 drone：D + A 五度，叠加微小颤动
    [55, 82.5, 110].forEach((freq,i)=>{
      const o = ctx.createOscillator(); o.type='sine'; o.frequency.value=freq;
      const lfo = ctx.createOscillator(); lfo.type='sine'; lfo.frequency.value=0.08+i*0.03;
      const lfoGain = ctx.createGain(); lfoGain.gain.value=freq*0.005;
      lfo.connect(lfoGain); lfoGain.connect(o.frequency);
      const g = ctx.createGain(); g.gain.value = i===0 ? 0.6 : i===1 ? 0.35 : 0.25;
      o.connect(g); g.connect(bgmGain);
      o.start(t); lfo.start(t);
      bgmNodes.push(o, lfo, g, lfoGain);
    });

    // 2) 噪声风声 + 低通
    const buf = ctx.createBuffer(1, ctx.sampleRate*4, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for(let i=0;i<data.length;i++) data[i]=(Math.random()*2-1)*0.5;
    const noise = ctx.createBufferSource(); noise.buffer=buf; noise.loop=true;
    const lp = ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=300;
    const wg = ctx.createGain(); wg.gain.value=0.18;
    noise.connect(lp); lp.connect(wg); wg.connect(bgmGain);
    noise.start(t);
    // 风声音量缓慢起伏
    const wlfo = ctx.createOscillator(); wlfo.type='sine'; wlfo.frequency.value=0.05;
    const wlfoG = ctx.createGain(); wlfoG.gain.value=0.1;
    wlfo.connect(wlfoG); wlfoG.connect(wg.gain);
    wlfo.start(t);
    bgmNodes.push(noise,lp,wg,wlfo,wlfoG);

    // 3) 周期钟声（每 18 秒）
    function bell(){
      if(!bgmStarted) return;
      const tn=ctx.currentTime;
      [220, 330, 440].forEach((freq,i)=>{
        const o=ctx.createOscillator(); o.type='sine'; o.frequency.value=freq;
        const g=ctx.createGain();
        const peak = i===0 ? 0.18 : i===1 ? 0.10 : 0.06;
        g.gain.setValueAtTime(0,tn);
        g.gain.linearRampToValueAtTime(peak,tn+0.03);
        g.gain.exponentialRampToValueAtTime(0.0001,tn+5);
        o.connect(g); g.connect(bgmGain);
        o.start(tn); o.stop(tn+5.2);
      });
      setTimeout(bell, 18000+Math.random()*4000);
    }
    setTimeout(bell, 4000);
  }
  function stopBGM(){
    bgmStarted=false;
    bgmNodes.forEach(n=>{ try{n.stop && n.stop();}catch(_){} try{n.disconnect();}catch(_){} });
    bgmNodes=[];
  }

  // ===== SFX 工具 =====
  function tone({freq=440,type='sine',dur=0.15,vol=0.4,attack=0.01,release=null,detune=0,bend=null}){
    if(muted || !ensure()) return;
    const t=ctx.currentTime;
    const o=ctx.createOscillator(); o.type=type; o.frequency.value=freq; if(detune)o.detune.value=detune;
    const g=ctx.createGain();
    g.gain.setValueAtTime(0,t);
    g.gain.linearRampToValueAtTime(vol,t+attack);
    g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    if(bend){ o.frequency.linearRampToValueAtTime(bend, t+dur*0.6); }
    o.connect(g); g.connect(sfxGain);
    o.start(t); o.stop(t+dur+0.05);
  }
  function noiseBurst({dur=0.2,vol=0.4,filterFreq=800,filterType='lowpass'}={}){
    if(muted || !ensure()) return;
    const t=ctx.currentTime;
    const buf=ctx.createBuffer(1,ctx.sampleRate*dur,ctx.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1);
    const src=ctx.createBufferSource(); src.buffer=buf;
    const f=ctx.createBiquadFilter(); f.type=filterType; f.frequency.value=filterFreq;
    const g=ctx.createGain();
    g.gain.setValueAtTime(vol,t);
    g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    src.connect(f); f.connect(g); g.connect(sfxGain);
    src.start(t); src.stop(t+dur);
  }

  // ===== 各种游戏音效 =====
  return {
    init: ensure,
    // 用户首次手势中调用：强制创建 + resume + 播一段静音脉冲，解锁移动端 AudioContext
    unlock(){
      const c = ensure();
      if(!c) return;
      try{
        if(c.state==='suspended') c.resume();
        // 极短静音脉冲——确保 iOS Safari 真正"启动"音频管线
        const o = c.createOscillator(), g = c.createGain();
        g.gain.value = 0; o.connect(g); g.connect(c.destination);
        o.start(0); o.stop(c.currentTime + 0.02);
      }catch(_){}
    },
    startBGM, stopBGM,
    setMute(m){ muted=m; if(ensure()){ master.gain.value = m?0:1; } },
    isMuted(){ return muted; },

    // 战斗
    hit(){       tone({freq:280,type:'square',dur:0.08,vol:.35,bend:200}); noiseBurst({dur:0.06,vol:.18,filterFreq:1500,filterType:'highpass'}); },
    crit(){      tone({freq:520,type:'square',dur:0.12,vol:.45,bend:240}); noiseBurst({dur:0.10,vol:.25,filterFreq:2000,filterType:'highpass'}); tone({freq:880,type:'triangle',dur:0.18,vol:.30}); },
    enemyDie(){  tone({freq:200,type:'sawtooth',dur:0.30,vol:.4,bend:60});  noiseBurst({dur:0.30,vol:.25,filterFreq:600}); },
    playerHit(){ tone({freq:140,type:'sawtooth',dur:0.25,vol:.45,bend:80}); noiseBurst({dur:0.18,vol:.30,filterFreq:400}); },
    // 技能
    cast_melee(){    tone({freq:520,type:'triangle',dur:0.10,vol:.30,bend:300}); },
    cast_proj(){     tone({freq:380,type:'sine',dur:0.12,vol:.35,bend:140}); noiseBurst({dur:0.05,vol:.10,filterFreq:1200}); },
    cast_aoe(){      tone({freq:80, type:'sawtooth',dur:0.40,vol:.45,bend:30}); noiseBurst({dur:0.40,vol:.30,filterFreq:300}); },
    cast_chain(){    tone({freq:1200,type:'square',dur:0.10,vol:.30,bend:600}); tone({freq:800,type:'square',dur:0.10,vol:.25,bend:400}); },
    cast_nova(){     tone({freq:600,type:'sine',dur:0.30,vol:.4,bend:200}); noiseBurst({dur:0.30,vol:.20,filterFreq:1600,filterType:'highpass'}); },
    // 物品 / 经验
    pickup(rarity){
      // 不同品质不同音
      const map={common:[440,'sine'], magic:[600,'triangle'], rare:[800,'triangle'], set:[900,'square'], unique:[1100,'sawtooth']};
      const [f,t]=map[rarity]||map.common;
      tone({freq:f,type:t,dur:0.18,vol:.35});
      tone({freq:f*1.5,type:t,dur:0.20,vol:.25,attack:0.04});
    },
    levelUp(){
      const t0=440;
      [t0,t0*1.25,t0*1.5,t0*2].forEach((f,i)=>setTimeout(()=>tone({freq:f,type:'triangle',dur:0.22,vol:.4}), i*120));
    },
    death(){
      tone({freq:200,type:'sawtooth',dur:1.2,vol:.5,bend:50});
      noiseBurst({dur:1.0,vol:.3,filterFreq:300});
    },
    // UI
    uiClick(){ tone({freq:900,type:'square',dur:0.04,vol:.22}); },
    uiOpen(){  tone({freq:520,type:'triangle',dur:0.08,vol:.28}); tone({freq:780,type:'triangle',dur:0.10,vol:.22,attack:0.02}); },
    uiClose(){ tone({freq:520,type:'triangle',dur:0.08,vol:.25,bend:300}); },
    waveStart(){
      tone({freq:160,type:'sawtooth',dur:0.45,vol:.4});
      tone({freq:80, type:'sawtooth',dur:0.55,vol:.5});
      noiseBurst({dur:0.35,vol:.22,filterFreq:300});
    },
    bossSpawn(){
      tone({freq:55, type:'sawtooth',dur:1.5,vol:.55});
      tone({freq:82, type:'sawtooth',dur:1.5,vol:.45});
      setTimeout(()=>noiseBurst({dur:0.6,vol:.35,filterFreq:200}), 200);
    },
  };
})();

const pick=arr=>arr[Math.floor(Math.random()*arr.length)];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

// ---------- 场景 ----------
const scene=new THREE.Scene();
// 深邃的午夜深蓝（星空背景色）
scene.background=new THREE.Color(0x05080f);
// 远雾仍保留以掩盖远端，但颜色变深
scene.fog=new THREE.Fog(0x0a1020, 50, 160);
const camera=new THREE.PerspectiveCamera(78,innerWidth/innerHeight,0.05,500);
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.25;
renderer.outputColorSpace=THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// 防止 Edge / Chrome 把 canvas 当作视频自动启用画中画 / 浮窗
renderer.domElement.setAttribute('disablepictureinpicture','');
renderer.domElement.style.touchAction='none';
// 禁掉 canvas 上的右键菜单（避免战斗中误触系统菜单）
renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});

// 半球光：星空夜晚整体偏冷蓝，地面反射偏暗
scene.add(new THREE.HemisphereLight(0x4a6890, 0x2a201a, 0.55));
scene.add(new THREE.AmbientLight(0xffffff, 0.22));
const moon=new THREE.DirectionalLight(0xfff2c4, 0.85);
moon.position.set(80, 130, -150);   // 与天空月亮位置一致，光从月亮方向打来
moon.castShadow=true;
moon.shadow.mapSize.set(1024,1024);
moon.shadow.camera.left=-60;moon.shadow.camera.right=60;moon.shadow.camera.top=60;moon.shadow.camera.bottom=-60;
scene.add(moon);

// ---------- Low Poly 卡通工具：3 段 toon 渐变贴图 ----------
const TOON_RAMP = (() => {
  const t = new THREE.DataTexture(new Uint8Array([
    60,60,60,255,
    150,150,150,255,
    255,255,255,255
  ]), 3, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  return t;
})();
function toonMat(color){
  return new THREE.MeshToonMaterial({color, gradientMap: TOON_RAMP});
}

// 地面：低多边形地形（PlaneGeometry 加扰动 + Toon 材质）
const groundGeo = new THREE.PlaneGeometry(200, 200, 40, 40);
// 给顶点加随机起伏，做出"碎石地面"凹凸感
{
  const pos = groundGeo.attributes.position;
  for(let i=0;i<pos.count;i++){
    const x = pos.getX(i), y = pos.getY(i);
    // 边缘归零，避免穿墙
    const distFromEdge = Math.min(100-Math.abs(x), 100-Math.abs(y));
    if(distFromEdge < 5) continue;
    pos.setZ(i, (Math.random()-0.4)*0.5);
  }
  groundGeo.computeVertexNormals();
}
const ground = new THREE.Mesh(groundGeo, toonMat(0x6a5546));
ground.rotation.x = -Math.PI/2;
ground.receiveShadow = true;
scene.add(ground);




// 程序化场景（Low Poly）
const fires=[];
function buildEnv(){
  const _dummy = new THREE.Object3D();   // 用于组装 InstancedMesh 的每实例矩阵
  // ===== 石柱：六棱柱 + Toon（性能优化④：60 根柱 ×3 段 → 3 个 InstancedMesh） =====
  const pillarMat = toonMat(0xc9b5a2);
  const pillarMatDk = toonMat(0x9a8472);
  const PILLAR_N = 60;
  const pillarBodyGeo = new THREE.CylinderGeometry(0.55, 0.65, 1, 6); // 单位高度 1，按 scale.y 拉伸
  const pillarBaseGeo = new THREE.CylinderGeometry(0.85, 0.95, 0.3, 6);
  const pillarCapGeo  = new THREE.CylinderGeometry(0.75, 0.65, 0.25, 6);
  const pillarBodyIM = new THREE.InstancedMesh(pillarBodyGeo, pillarMat,   PILLAR_N);
  const pillarBaseIM = new THREE.InstancedMesh(pillarBaseGeo, pillarMatDk, PILLAR_N);
  const pillarCapIM  = new THREE.InstancedMesh(pillarCapGeo,  pillarMatDk, PILLAR_N);
  [pillarBodyIM, pillarBaseIM, pillarCapIM].forEach(im=>{ im.castShadow = im.receiveShadow = true; });
  for(let i=0;i<PILLAR_N;i++){
    const h = rand(3.5, 5.5);
    const x = rand(-90,90), z = rand(-90,90), ry = rand(0, Math.PI*2);
    // 柱身：单位柱按 y 缩放到 h
    _dummy.position.set(x, h/2, z); _dummy.rotation.set(0, ry, 0); _dummy.scale.set(1, h, 1);
    _dummy.updateMatrix(); pillarBodyIM.setMatrixAt(i, _dummy.matrix);
    // 柱底
    _dummy.position.set(x, 0.15, z); _dummy.scale.set(1,1,1);
    _dummy.updateMatrix(); pillarBaseIM.setMatrixAt(i, _dummy.matrix);
    // 柱顶
    _dummy.position.set(x, h-0.12, z);
    _dummy.updateMatrix(); pillarCapIM.setMatrixAt(i, _dummy.matrix);
  }
  pillarBodyIM.instanceMatrix.needsUpdate = pillarBaseIM.instanceMatrix.needsUpdate = pillarCapIM.instanceMatrix.needsUpdate = true;
  scene.add(pillarBodyIM, pillarBaseIM, pillarCapIM);

  // ===== 石头：八面体 / 二十面体 + Toon（性能优化④：120 块 → 2 个 InstancedMesh，按实例上色） =====
  const rockColors = [0x8a7868, 0x726658, 0xa09080];
  const icoGeo  = new THREE.IcosahedronGeometry(1, 0);   // 单位半径，按 scale 缩放
  const octaGeo = new THREE.OctahedronGeometry(1, 0);
  const rockMat = toonMat(0xffffff);                     // 白底，靠 instanceColor 上色
  const icoIM  = new THREE.InstancedMesh(icoGeo,  rockMat, 60);
  const octaIM = new THREE.InstancedMesh(octaGeo, rockMat, 60);
  [icoIM, octaIM].forEach(im=>{ im.castShadow = im.receiveShadow = true; });
  const _col = new THREE.Color();
  let iIco = 0, iOcta = 0;
  for(let i=0;i<120;i++){
    const isIco = i%2===0;
    const baseR = isIco ? rand(0.3,1.2) : rand(0.4,1.0);
    const s = baseR * rand(0.6,1.6);
    _dummy.position.set(rand(-95,95), rand(0.2,0.7), rand(-95,95));
    _dummy.rotation.set(rand(0,Math.PI), rand(0,Math.PI), rand(0,Math.PI));
    _dummy.scale.setScalar(s);
    _dummy.updateMatrix();
    _col.setHex(rockColors[i%3]);
    if(isIco){ icoIM.setMatrixAt(iIco, _dummy.matrix); icoIM.setColorAt(iIco, _col); iIco++; }
    else     { octaIM.setMatrixAt(iOcta, _dummy.matrix); octaIM.setColorAt(iOcta, _col); iOcta++; }
  }
  icoIM.instanceMatrix.needsUpdate = octaIM.instanceMatrix.needsUpdate = true;
  if(icoIM.instanceColor) icoIM.instanceColor.needsUpdate = true;
  if(octaIM.instanceColor) octaIM.instanceColor.needsUpdate = true;
  scene.add(icoIM, octaIM);

  // ===== 火盆：三段式 + 火焰 + 点光源 =====
  for(let i=0;i<8;i++){
    const grp = new THREE.Group();
    // 底座（八棱锥台）
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.55, 0.25, 6),
      toonMat(0x2a2018)
    );
    base.position.y = 0.12;
    grp.add(base);
    // 立柱
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.10, 0.12, 0.5, 6),
      toonMat(0x3a2a18)
    );
    post.position.y = 0.5;
    grp.add(post);
    // 盆（倒置六棱锥台）
    const bowl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.30, 0.30, 6),
      toonMat(0x4a3a28)
    );
    bowl.position.y = 0.85;
    grp.add(bowl);
    // 火焰（八面体拉长 + 不参与光照的 Basic）
    const fire = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.35, 0),
      new THREE.MeshBasicMaterial({color: 0xff8a3c})
    );
    fire.scale.set(0.85, 1.4, 0.85);
    fire.position.y = 1.20;
    grp.add(fire);
    // 内焰（更亮）
    const fireInner = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.20, 0),
      new THREE.MeshBasicMaterial({color: 0xffe28a})
    );
    fireInner.scale.set(0.7, 1.3, 0.7);
    fireInner.position.y = 1.10;
    grp.add(fireInner);

    const pl = new THREE.PointLight(0xff8a3c, 2.0, 12, 2);
    pl.position.y = 1.2;
    grp.add(pl);

    grp.position.set(rand(-80,80), 0, rand(-80,80));
    grp.userData = {fire, pl};
    scene.add(grp);
    fires.push(grp);
  }

  // ===== 围墙：石质纹理感（用低多边形 + 顶部凸起雉堞） =====
  const wallMat = toonMat(0x5a4a3a);
  const wallTopMat = toonMat(0x3a2a20);
  const wallSpec = [
    [200, 8, 2,  0, 4, -100],
    [200, 8, 2,  0, 4,  100],
    [2,   8, 200, -100, 4, 0],
    [2,   8, 200,  100, 4, 0],
  ];
  wallSpec.forEach(([w,h,d,x,y,z])=>{
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), wallMat);
    wall.position.set(x,y,z);
    wall.receiveShadow = true;
    scene.add(wall);
    // 顶部沿墙的雉堞（每 4m 一个小立方体）
    const isHoriz = w > d;
    const len = isHoriz ? w : d;
    const count = Math.floor(len/4);
    for(let i=0;i<count;i++){
      const t = i/count - 0.5 + 0.5/count;
      const block = new THREE.Mesh(
        new THREE.BoxGeometry(1.0, 1.5, isHoriz?2:1.0),
        wallTopMat
      );
      if(isHoriz){
        block.position.set(x + t*w, h+0.75, z);
      } else {
        block.position.set(x, h+0.75, z + t*d);
      }
      scene.add(block);
    }
  });
}
buildEnv();

// ---------- 星空 ----------
// 在远处球壳上撒满星点，让玩家抬头看到布满星辰的夜空
function buildStars(){
  const starGroup = new THREE.Group();
  // ===== 1) 主星层：1500 颗白色小星 =====
  {
    const N = 1500;
    const positions = new Float32Array(N*3);
    const colors    = new Float32Array(N*3);
    for(let i=0;i<N;i++){
      // 球面均匀分布（仅上半球，y>=0）
      const u = Math.random();
      const v = Math.random()*0.5; // 0~0.5 → 上半球
      const theta = 2*Math.PI*u;
      const phi   = Math.acos(1 - 2*v);   // 0~π/2
      const R = 220 + Math.random()*40;   // 球壳半径
      positions[i*3+0] = R*Math.sin(phi)*Math.cos(theta);
      positions[i*3+1] = R*Math.cos(phi);
      positions[i*3+2] = R*Math.sin(phi)*Math.sin(theta);
      // 颜色：白偏蓝偏黄随机
      const h = Math.random();
      if(h<0.7){       // 白星
        colors[i*3+0]=1;     colors[i*3+1]=1;     colors[i*3+2]=1;
      } else if(h<0.88){ // 蓝星
        colors[i*3+0]=0.65;  colors[i*3+1]=0.78;  colors[i*3+2]=1.0;
      } else if(h<0.97){ // 黄星
        colors[i*3+0]=1.0;   colors[i*3+1]=0.92;  colors[i*3+2]=0.6;
      } else {           // 红星
        colors[i*3+0]=1.0;   colors[i*3+1]=0.55;  colors[i*3+2]=0.4;
      }
      // 随机加一点亮度变化
      const dim = 0.55 + Math.random()*0.45;
      colors[i*3+0]*=dim; colors[i*3+1]*=dim; colors[i*3+2]*=dim;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 1.4, sizeAttenuation: false,
      vertexColors: true, transparent: true, opacity: 0.95,
      depthWrite: false, fog: false
    });
    starGroup.add(new THREE.Points(geo, mat));
  }
  // ===== 2) 大星层：80 颗较亮的"亮星" =====
  {
    const N = 80;
    const positions = new Float32Array(N*3);
    const colors    = new Float32Array(N*3);
    for(let i=0;i<N;i++){
      const u = Math.random();
      const v = Math.random()*0.5;
      const theta = 2*Math.PI*u;
      const phi   = Math.acos(1 - 2*v);
      const R = 220 + Math.random()*30;
      positions[i*3+0] = R*Math.sin(phi)*Math.cos(theta);
      positions[i*3+1] = R*Math.cos(phi);
      positions[i*3+2] = R*Math.sin(phi)*Math.sin(theta);
      colors[i*3+0]=1.0; colors[i*3+1]=0.96; colors[i*3+2]=0.85;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 3.0, sizeAttenuation: false,
      vertexColors: true, transparent: true, opacity: 1.0,
      depthWrite: false, fog: false
    });
    starGroup.add(new THREE.Points(geo, mat));
  }
  // ===== 3) 月亮 =====
  {
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(8, 24, 16),
      new THREE.MeshBasicMaterial({color:0xfffce0, fog:false})
    );
    moon.position.set(80, 130, -150);
    starGroup.add(moon);
    // 月亮光晕
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(14, 16, 10),
      new THREE.MeshBasicMaterial({color:0xffeebb, transparent:true, opacity:0.18, fog:false})
    );
    halo.position.copy(moon.position);
    starGroup.add(halo);
  }
  // 让星空跟随玩家移动（永远在远处），靠 main loop 更新位置即可
  scene.add(starGroup);
  return starGroup;
}
const _stars = buildStars();
// 让星空中心始终跟随玩家位置（仅 xz，y 保持 0），让玩家"永远在星空圆顶中央"
function updateStars(){
  if(!_stars) return;
  const p = controls.getObject().position;
  _stars.position.set(p.x, 0, p.z);
}

// ---------- 控制器 ----------
const controls=new PointerLockControls(camera,renderer.domElement);
scene.add(controls.getObject());
controls.getObject().position.set(0,1.65,0);

// ---------- 第一人称手持武器（viewmodel） ----------
// 把武器挂在 camera 上，这样它跟随相机的 yaw/pitch；位置放在屏幕右下方。
// rebuildViewWeapon() 会读 player.equip.weapon.wType 重建模型；
// 主循环里调 updateViewWeapon(dt, moveSpeed) 做 idle / walk bob 与动作动画。
const viewWeaponRig = new THREE.Group();   // 外层：负责 bob / 摇摆位移
const viewWeaponHand = new THREE.Group();  // 内层：负责挥砍/前刺等动作旋转
viewWeaponRig.add(viewWeaponHand);
// 默认放在右下，距相机 0.5m
viewWeaponRig.position.set(0.32, -0.32, -0.55);
camera.add(viewWeaponRig);
// 触屏模式：屏幕底部被功能键占用较多，武器整体居中显示更自然（之前向左偏移会遮挡左下技能）
function adjustViewWeaponForMode(){
  if(!viewWeaponRig) return;
  if(InputMode && InputMode.current==='touch'){
    // 居中略下，靠近屏幕底部中线
    viewWeaponRig.position.set(0, -0.34, -0.55);
  } else {
    viewWeaponRig.position.set(0.32, -0.32, -0.55);
  }
}
// 把 camera 加进 scene 一次（PointerLockControls 已经把它加到 yawObject，
// 但 yawObject 已经 add(camera)，所以 camera 已在场景图中——直接挂 viewWeaponRig 即可）

let _vwMesh = null;          // 当前挂载的武器 mesh group
let _vwAnim = {               // 动作动画状态
  type: null,                  // 'swing' | 'thrust' | 'shoot' | 'cast'
  t: 0, dur: 0
};
let _bobPhase = 0;
let _bobMag   = 0;            // 平滑过渡到当前移动状态的 bob 强度
function clearViewWeapon(){
  while(viewWeaponHand.children.length) viewWeaponHand.remove(viewWeaponHand.children[0]);
  _vwMesh = null;
}
function buildViewWeaponMesh(wType){
  // 简洁低面数武器，主要颜色 + 亮金属/木头反差。返回 Group。
  const g = new THREE.Group();
  // 共用材质工厂：toonMat 已存在
  const wood   = (typeof toonMat==='function') ? toonMat(0x6b4a2a) : new THREE.MeshStandardMaterial({color:0x6b4a2a});
  const steel  = (typeof toonMat==='function') ? toonMat(0xcdd2da) : new THREE.MeshStandardMaterial({color:0xcdd2da});
  const dark   = (typeof toonMat==='function') ? toonMat(0x2a2a2a) : new THREE.MeshStandardMaterial({color:0x2a2a2a});
  const gold   = (typeof toonMat==='function') ? toonMat(0xe8c45a) : new THREE.MeshStandardMaterial({color:0xe8c45a});
  const glow   = (color)=> new THREE.MeshBasicMaterial({color, transparent:true, opacity:0.85});

  if(wType==='sword' || !wType){
    // 剑：剑柄(下) → 护手 → 剑刃(上)；整体沿 +Y 向前刺出
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022,0.022,0.14,8), dark);
    grip.position.y = -0.07; g.add(grip);
    const pommel = new THREE.Mesh(new THREE.IcosahedronGeometry(0.03,0), gold);
    pommel.position.y = -0.16; g.add(pommel);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.16,0.025,0.04), gold);
    guard.position.y = 0.005; g.add(guard);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05,0.5,0.012), steel);
    blade.position.y = 0.26; g.add(blade);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.025,0.08,4), steel);
    tip.position.y = 0.55; g.add(tip);
  } else if(wType==='axe'){
    // 斧：长柄 + 横向斧刃（刃口朝前 -Z）
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025,0.025,0.55,8), wood);
    handle.position.y = 0.10; g.add(handle);
    // 斧头主体（厚刃）：横向放置，刃口朝 -Z
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.04,0.20,0.18), steel);
    head.position.set(0, 0.30, -0.10); g.add(head);
    // 锋利锥刃：四棱锥尖端朝 -Z（前方）
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.10,0.18,4), steel);
    blade.rotation.x = -Math.PI/2;     // 尖朝 -Z
    blade.position.set(0, 0.30, -0.27); g.add(blade);
    // 斧顶尖刺
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.025,0.10,4), steel);
    spike.position.set(0, 0.45, 0); g.add(spike);
  } else if(wType==='bow'){
    // 弓：竖直弓身 + 弓弦 + 搭箭
    // 真实弓：凸面朝射手（+Z，玩家身后），凹面（弦+箭）朝敌人（-Z）
    // 拉弦时弦被拉向射手身体，箭从弦的内侧朝前飞出
    const bowGeo = new THREE.TorusGeometry(0.28, 0.020, 6, 24, Math.PI);
    bowGeo.rotateZ(Math.PI/2);    // 弓两端从 ±X → ±Y；凸面从 +Y → -X
    bowGeo.rotateY(-Math.PI/2);   // 凸面从 -X → +Z（朝后/朝射手 ✓）；两端仍在 ±Y
    const bow = new THREE.Mesh(bowGeo, wood);
    bow.position.y = 0.10;
    g.add(bow);
    // 弓两端的"角"
    [[0,0.38,0],[0,-0.18,0]].forEach(p=>{
      const tip = new THREE.Mesh(new THREE.IcosahedronGeometry(0.024,0), dark);
      tip.position.set(p[0], p[1], p[2]); g.add(tip);
    });
    // 弓弦：连接弓两端，沿 Y 直线（在 z=0，刚好处于弓的"凹面"那一侧）
    const stringMat = new THREE.LineBasicMaterial({color:0xddddcc});
    const sg = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0,-0.18,0), new THREE.Vector3(0,0.38,0)
    ]);
    g.add(new THREE.Line(sg, stringMat));
    // 箭：从弦的内侧（弓凹面方向 -Z）射出
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008,0.008,0.42,6), wood);
    shaft.rotation.x = Math.PI/2;
    shaft.position.set(0, 0.10, -0.21); g.add(shaft);
    const arrowHead = new THREE.Mesh(new THREE.ConeGeometry(0.018,0.05,4), steel);
    arrowHead.rotation.x = -Math.PI/2;
    arrowHead.position.set(0, 0.10, -0.45); g.add(arrowHead);
    // 箭尾羽毛（朝后 +Z）
    const fletch = new THREE.Mesh(new THREE.BoxGeometry(0.04,0.005,0.05), steel);
    fletch.position.set(0, 0.10, 0.02); g.add(fletch);
  } else if(wType==='staff'){
    // 法杖：长杆 + 顶端宝石光球
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.02,0.7,8), wood);
    handle.position.y = 0.15; g.add(handle);
    const orbCore = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06,0), glow(0x66ccff));
    orbCore.position.y = 0.55; g.add(orbCore);
    const orbHalo = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09,0),
      new THREE.MeshBasicMaterial({color:0x66ccff, transparent:true, opacity:0.25}));
    orbHalo.position.y = 0.55; g.add(orbHalo);
    // 杆顶四爪
    for(let i=0;i<4;i++){
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.018,0.10,4), gold);
      const a = i*Math.PI/2;
      claw.position.set(Math.cos(a)*0.05, 0.50, Math.sin(a)*0.05);
      claw.rotation.x = Math.cos(a)*0.4;
      claw.rotation.z = -Math.sin(a)*0.4;
      g.add(claw);
    }
  } else if(wType==='wand'){
    // 短法杖：短柄 + 紫色尖端
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018,0.022,0.30,8), dark);
    handle.position.y = 0; g.add(handle);
    const tip = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05,0), glow(0xc8b6ff));
    tip.position.y = 0.20; g.add(tip);
    const ringDeco = new THREE.Mesh(new THREE.TorusGeometry(0.03,0.008,4,8), gold);
    ringDeco.rotation.x = Math.PI/2;
    ringDeco.position.y = 0.13; g.add(ringDeco);
  } else if(wType==='orb'){
    // 法球：握在手心的发光球
    const sphere = new THREE.Mesh(new THREE.IcosahedronGeometry(0.10,0), glow(0x9be0ff));
    sphere.position.y = 0.05; g.add(sphere);
    const halo = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14,0),
      new THREE.MeshBasicMaterial({color:0x9be0ff, transparent:true, opacity:0.20}));
    halo.position.y = 0.05; g.add(halo);
    // 三道悬浮金环
    for(let i=0;i<3;i++){
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.13+i*0.02,0.005,4,16), gold);
      ring.rotation.x = i*0.7;
      ring.rotation.y = i*0.5;
      ring.position.y = 0.05; g.add(ring);
    }
  }
  return g;
}
function rebuildViewWeapon(){
  clearViewWeapon();
  const w = player.equip.weapon;
  const wType = w ? w.wType : 'sword';
  _vwMesh = buildViewWeaponMesh(wType);
  // 不同武器的握持基础姿态微调
  if(wType==='bow'){
    _vwMesh.rotation.set(0, 0, -0.05);
    viewWeaponRig.position.set(0.05, -0.32, -0.55);    // 弓居中略偏右
  } else if(wType==='staff'){
    _vwMesh.rotation.set(-0.2, 0.0, -0.25);
    viewWeaponRig.position.set(0.22, -0.32, -0.55);
  } else if(wType==='wand'){
    _vwMesh.rotation.set(-0.5, 0, 0);
    viewWeaponRig.position.set(0.32, -0.30, -0.55);
  } else if(wType==='orb'){
    _vwMesh.rotation.set(0,0,0);
    viewWeaponRig.position.set(0.32, -0.28, -0.55);
  } else if(wType==='axe'){
    _vwMesh.rotation.set(-0.25, 0.05, -0.20);
    viewWeaponRig.position.set(0.30, -0.32, -0.55);
  } else { // sword
    _vwMesh.rotation.set(-0.45, 0.10, -0.18);
    viewWeaponRig.position.set(0.32, -0.30, -0.55);
  }
  viewWeaponHand.add(_vwMesh);
  // 手机模式：统一覆盖 X 居中（各武器姿态保留，但水平位置改 0）
  if(InputMode && InputMode.current==='touch'){
    viewWeaponRig.position.x = 0;
  }
}
// 触发武器动作动画（在 castSkill 成功后调用）
function playViewWeaponAnim(skillType, skillKey){
  // melee/thrust → 前刺；melee/swing → 横挥；proj/multi/pierce(弓) → 射击；其它法术 → cast 上举
  let a = 'cast';
  if(skillType==='melee'){
    a = (skillKey==='thrust') ? 'thrust' : 'swing';
  }
  if(['proj','multi','pierce','chain'].includes(skillType)){
    const w = player.equip.weapon;
    a = (w && w.wType==='bow') ? 'shoot' : 'cast';
  }
  _vwAnim.type = a;
  _vwAnim.t = 0;
  _vwAnim.dur = (a==='shoot')?0.28 : (a==='thrust')?0.22 : (a==='swing')?0.32 : 0.40;
}
// 每帧调用
function updateViewWeapon(dt, isMoving){
  if(!_vwMesh) return;

  // === bob 摇摆 ===
  _bobMag += ((isMoving?1:0.25) - _bobMag) * Math.min(1, dt*6);
  _bobPhase += dt * (isMoving?9:2);
  const bobX = Math.sin(_bobPhase)*0.012*_bobMag;
  const bobY = Math.abs(Math.sin(_bobPhase*1.0))*0.018*_bobMag;
  // 基础位移 + bob
  // （rebuildViewWeapon 设置了 rig.position 的基础值，这里在该基础上加 bob）
  // 我们通过给 viewWeaponHand（内层）做 bob，避免覆盖 rig 的基础位置
  viewWeaponHand.position.set(bobX, -bobY*0.5, 0);

  // === 动作动画 ===
  if(_vwAnim.type){
    _vwAnim.t += dt;
    const k = Math.min(1, _vwAnim.t/_vwAnim.dur);
    // 简易 ease：先快后慢的弧线 sin(πk)
    const e = Math.sin(k*Math.PI);
    if(_vwAnim.type==='swing'){
      // 从右上往左下挥砍：绕 Z 旋转
      viewWeaponHand.rotation.z = -e*1.3;
      viewWeaponHand.rotation.x = -e*0.4;
      viewWeaponHand.position.z = -e*0.05;
    } else if(_vwAnim.type==='thrust'){
      // 前刺：沿 -Z 推一段
      viewWeaponHand.rotation.x = -e*0.25;
      viewWeaponHand.position.z = -e*0.18;
      viewWeaponHand.position.x += -e*0.02;
    } else if(_vwAnim.type==='shoot'){
      // 射箭：弓向后拉 → 释放
      // 0~0.5：拉弦后退；0.5~1：复位
      const back = (k<0.5) ? (k*2)*0.10 : (1-k)*2*0.10;
      viewWeaponHand.position.z = back;
      viewWeaponHand.rotation.x = e*0.10;
    } else if(_vwAnim.type==='cast'){
      // 施法：上举 + 推前
      viewWeaponHand.rotation.x = -e*0.55;
      viewWeaponHand.position.y += e*0.06;
      viewWeaponHand.position.z = -e*0.06;
    }
    if(k>=1){
      _vwAnim.type = null;
      viewWeaponHand.rotation.set(0,0,0);
      // bob 已在每帧重写 position，这里无需复位
    }
  } else {
    // 闲时姿态：旋转复位
    viewWeaponHand.rotation.x *= (1 - Math.min(1, dt*10));
    viewWeaponHand.rotation.y *= (1 - Math.min(1, dt*10));
    viewWeaponHand.rotation.z *= (1 - Math.min(1, dt*10));
  }
}

// ---------- 游戏全局设置 ----------
let INV_CAP = 48;       // 背包容量（可被【背包扩容卷轴】永久提升 +4）
const settings = {
  autoEquip: false,       // 默认关闭：拾取仅入包，由玩家手动穿戴
  autoPickup: true,       // 走过自动拾取
  sprintOn: false,        // 跑步开关（替代按住 Shift）
  autoPlay: false,        // 托管模式：自动寻路 + 找怪 + 拾取
  autoSkill: true,        // 技能释放：true=自动施放（原行为）/ false=手动（鼠标左键 或 手柄 RT）
};

// 按钮 UI 同步
function syncToggleButtons(){
  const sb=document.getElementById('btnSprint');
  if(sb){ sb.textContent='🏃 跑步：'+(settings.sprintOn?'开':'关'); sb.classList.toggle('on',settings.sprintOn); }
  const ab=document.getElementById('btnAuto');
  if(ab){ ab.textContent='🤖 托管：'+(settings.autoPlay?'开':'关'); ab.classList.toggle('on',settings.autoPlay); }
  const mb=document.getElementById('btnMute');
  if(mb){ mb.textContent='🔊 音效：'+(Audio.isMuted()?'关':'开'); mb.classList.toggle('on',!Audio.isMuted()); }
  const kb=document.getElementById('btnSkillMode');
  if(kb){ kb.textContent='✨ 技能：'+(settings.autoSkill?'自动':'手动'); kb.classList.toggle('on',settings.autoSkill); }
  // 触屏「奔跑」按钮（取代了原「跳」按钮）的开关态同步
  const tj=document.getElementById('tJump');
  if(tj){ tj.classList.toggle('on', settings.sprintOn); }
  const ta=document.getElementById('tAuto');
  if(ta){ ta.classList.toggle('on', settings.autoPlay); }
}
function toggleSprint(){
  settings.sprintOn=!settings.sprintOn; syncToggleButtons();
  toast(settings.sprintOn?'🏃 跑步开启':'🚶 跑步关闭');
  Audio.uiClick();
}
function toggleAutoPlay(){
  settings.autoPlay=!settings.autoPlay; syncToggleButtons();
  toast(settings.autoPlay?'🤖 托管开启 (自动找怪 / 拾取)':'🤖 托管关闭');
  Audio.uiClick();
}
function toggleMute(){
  Audio.setMute(!Audio.isMuted()); syncToggleButtons();
  toast(Audio.isMuted()?'🔇 已静音':'🔊 已开启');
}
// 技能释放模式：自动 / 手动 切换
function toggleSkillMode(){
  settings.autoSkill=!settings.autoSkill; syncToggleButtons();
  toast(settings.autoSkill?'✨ 技能自动施放':'✋ 技能手动施放（左键/RT 释放当前技能）');
  Audio.uiClick();
}
// 手动施放（手动模式下由鼠标左键 / 键盘 F / 手柄 RT 调用）
// 优先释放当前选中技能；若当前技能放不出（冷却中 / 蓝量不足 / 前方无目标），
// 则回退尝试其余已就绪技能，保证「按一下必然有反应」，避免出现"完全无法手动释放"的体感。
let _lastManualToast = 0;
function manualCastActive(){
  if(gamePaused || !controls.isLocked || player.hp<=0) return;
  // 攻击时顺手打破附近的宝箱
  tryBreakChestsNear(controls.getObject().position, 3.5);
  const cdrBonus = 1 + ((player._eq && player._eq.cdr) || 0)/100;
  const atkSpd=(player.equip.weapon?player.equip.weapon.atkSpd:1)*(1+player._dexTotal*.005)*cdrBonus;
  const tryCast=(s)=>{
    if(!s || s.cdLeft>0 || player.mp<s.mp) return false;
    // 不再要求前方有目标：攻击技能即便无目标，也朝准星方向直接释放
    if(castSkill(s)){
      s.cdLeft=s.cd/atkSpd;
      if(typeof playViewWeaponAnim==='function') playViewWeaponAnim(s.type, s.key);
      return true;
    }
    return false;
  };
  // 1) 先试当前选中技能
  if(tryCast(player.skills[player.activeSkill])) return;
  // 2) 回退：按顺序尝试其余技能，命中即停
  for(let i=0;i<player.skills.length;i++){
    if(i===player.activeSkill) continue;
    if(tryCast(player.skills[i])) return;
  }
  // 3) 全部无法施放 → 仅提示法力/冷却，不再提示"前方无目标"
  const now=performance.now();
  if(now-_lastManualToast>700){
    _lastManualToast=now;
    const cur=player.skills[player.activeSkill];
    if(cur && player.mp<cur.mp) toast('法力不足');
    else if(cur && cur.cdLeft>0) toast('技能冷却中…');
  }
}

// 托管 AI：自动寻路 + 自动拾取（每帧调用）
let _autoPilotState = { wanderTarget: null, wanderTimer: 0, lastPickupTry: 0, lastDrinkHp: 0, lastDrinkMp: 0 };
function autoPilot(dt){
  const pp = controls.getObject().position;

  // 0) 自动喝药：HP < 40% 喝红瓶；MP < 30% 喝蓝瓶（背包里有的话）
  //    冷却 1.5s 防止连刷；silent 模式：没药时不 toast 刷屏
  const now = performance.now();
  if(player.hp < player.hpMax * 0.4 && now - _autoPilotState.lastDrinkHp > 1500){
    if(typeof quickDrinkHp === 'function'){
      const drank = quickDrinkHp(true);
      _autoPilotState.lastDrinkHp = now;
      if(drank) return;
    }
  }
  if(player.mp < player.mpMax * 0.3 && now - _autoPilotState.lastDrinkMp > 1500){
    if(typeof quickDrinkMp === 'function'){
      const drank = quickDrinkMp(true);
      _autoPilotState.lastDrinkMp = now;
      if(drank) return;
    }
  }


  // 1) 优先朝最近的掉落物（满包则忽略）
  if(player.inv.length<INV_CAP){
    let bestLoot=null, bd=Infinity;
    for(const l of lootDrops){
      const d=l.mesh.position.distanceTo(pp);
      if(d<bd){bd=d;bestLoot=l;}
    }
    if(bestLoot && bd<28){
      const dir = bestLoot.mesh.position.clone().sub(pp); dir.y=0;
      _autoMoveTowards(dir, dt);
      // 距离够近就尝试拾取（自动吸附其实也会捡，这里再补一刀）
      if(bd<3 && performance.now()-_autoPilotState.lastPickupTry>200){
        _autoPilotState.lastPickupTry=performance.now();
        tryPickup();
      }
      return;
    }
  }

  // 2) 朝最近敌人接近到攻击范围内即可（武器决定 range）
  let target=null, td=Infinity;
  for(const e of enemies){
    if(e.hp<=0) continue;
    const d=e.mesh.position.distanceTo(pp);
    if(d<td){td=d;target=e;}
  }
  if(target){
    const isRanged = (player.equip.weapon && player.equip.weapon.skills.some(k=>['fireball','iceshard','arrow','bolt','chain'].includes(k)));
    const ideal = isRanged ? 8 : 2.5;
    const toEnemy = target.mesh.position.clone().sub(pp); toEnemy.y=0;
    if(td > ideal+0.3){
      // 太远 → 接近，转视角朝敌人
      _autoMoveTowards(toEnemy, dt, true);
    } else if(isRanged && td < ideal-1.5){
      // 远程武器太近 → 后退，但**视角仍朝敌人**（避免屁股对着敌人）
      _autoMoveTowards(toEnemy.clone().multiplyScalar(-1), dt, false);
      // 显式锁定视角朝敌人
      _autoFaceTowards(toEnemy, dt);
    } else {
      // 在攻击距离\"死区\"内（不前进也不后退）→ 至少要面朝敌人，让自动技能能命中
      _autoFaceTowards(toEnemy, dt);
    }
    return;
  }

  // 3) 没有目标：随机漫游
  _autoPilotState.wanderTimer -= dt;
  if(!_autoPilotState.wanderTarget || _autoPilotState.wanderTimer<=0
     || pp.distanceTo(_autoPilotState.wanderTarget)<2){
    const a=Math.random()*Math.PI*2, r=rand(8,30);
    _autoPilotState.wanderTarget = new THREE.Vector3(
      clamp(pp.x+Math.cos(a)*r,-90,90),0,
      clamp(pp.z+Math.sin(a)*r,-90,90));
    _autoPilotState.wanderTimer=rand(3,6);
  }
  const dir=_autoPilotState.wanderTarget.clone().sub(pp); dir.y=0;
  _autoMoveTowards(dir, dt);
}
// 朝目标方向移动 + 视角缓慢转向（不打断玩家手动鼠标视角控制）
// turnView: 是否同时转视角朝移动方向（默认 true）。后退时传 false（保持视角朝敌人）
function _autoMoveTowards(dir, dt, turnView){
  if(turnView === undefined) turnView = true;
  if(dir.lengthSq()<0.0001) return;
  dir.normalize();
  const yawObj = controls.getObject();

  // 视角未对齐时减速，避免\"屁股冲着敌人冲过去\"
  let speedMul = 1;
  if(turnView){
    const wantYaw = Math.atan2(-dir.x, -dir.z);
    // 用「真实合成朝向」计算偏差：鼠标/手柄视角写入的是 camera 自身偏航，
    // 而这里旋转的是 yawObject，二者叠加才是实际朝向。若只用 yawObject.rotation.y
    // 计算偏差，会残留 camera 的偏航量，导致托管时始终偏向敌人一侧（偏右/偏左）。
    const _fwd = new THREE.Vector3(); camera.getWorldDirection(_fwd);
    const curYaw = Math.atan2(-_fwd.x, -_fwd.z);
    let dy = wantYaw - curYaw;
    while(dy> Math.PI) dy-=Math.PI*2;
    while(dy<-Math.PI) dy+=Math.PI*2;
    const absDy = Math.abs(dy);
    // 偏差 > 60° 时半速移动；> 120° 时四分之一速；让玩家先转身
    if(absDy > Math.PI*2/3) speedMul = 0.25;
    else if(absDy > Math.PI/3) speedMul = 0.5;
    // 加速转向：6 rad/s（≈半秒转 180°）
    yawObj.rotation.y += dy * Math.min(1, dt*6);
  }
  const sp = (settings.sprintOn ? 9 : 5) * speedMul;
  controls.getObject().position.add(dir.clone().multiplyScalar(sp*dt));
}
// 仅旋转视角朝目标，不移动（用于在攻击死区内或后退时\"面朝敌人\"）
function _autoFaceTowards(dir, dt){
  if(dir.lengthSq()<0.0001) return;
  const d = dir.clone().normalize();
  const yawObj = controls.getObject();
  const wantYaw = Math.atan2(-d.x, -d.z);
  // 同 _autoMoveTowards：用真实合成朝向计算偏差，避免叠加 camera 自身偏航导致偏向一侧
  const _fwd = new THREE.Vector3(); camera.getWorldDirection(_fwd);
  const curYaw = Math.atan2(-_fwd.x, -_fwd.z);
  let dy = wantYaw - curYaw;
  while(dy> Math.PI) dy-=Math.PI*2;
  while(dy<-Math.PI) dy+=Math.PI*2;
  yawObj.rotation.y += dy * Math.min(1, dt*6);
}
let gamePaused = true;   // 默认暂停（开始菜单期间），点击 overlay 后才进入游戏

// 背包面板的手柄光标（行 8 列）
const INV_COLS = 8;
let padCursor = 0;        // 当前选中的格子 index（0..INV_CAP-1）
let _stickRepeatT = 0;    // 摇杆按住时的"按键重复"计时

const player={
  hp:100,hpMax:100,mp:50,mpMax:50,
  level:1,exp:0,expNeed:50,
  str:10,dex:10,int:10,armor:0,
  vel:new THREE.Vector3(),onGround:true,killCount:0,deathCount:0,invuln:0,
  hpRegen:1.2,mpRegen:3,
  // 防御性技能状态：护盾吸收值 / 护盾剩余时间 / 减伤姿态剩余时间 / 当前减伤比例
  shield:0,shieldMax:0,shieldT:0,hasteT:0,dmgReduce:0,
  equip:{weapon:null,helm:null,armor:null,ring:null},
  inv:[],skills:[],activeSkill:0,
};

const keys={};
document.addEventListener('keydown',e=>{
  keys[e.code]=true;
  if(e.code==='KeyI')toggleInv();
  if(e.code==='KeyF')tryPickup();
  // R = 背包打开时整理
  if(e.code==='KeyR' && invPanel && invPanel.style.display==='block'){ sortInv(); }
  // Q = 快捷喝生命药水；E = 快捷喝法力药水
  if(e.code==='KeyQ'){ if(typeof quickDrinkHp==='function') quickDrinkHp(); }
  if(e.code==='KeyE'){ if(typeof quickDrinkMp==='function') quickDrinkMp(); }
  // Shift = 跑步开关切换
  if(e.code==='ShiftLeft'){ toggleSprint(); }
  // T = 托管开关切换
  if(e.code==='KeyT'){ toggleAutoPlay(); }
  // M = 静音切换
  if(e.code==='KeyM'){ toggleMute(); }
  // K = 技能 自动/手动 切换
  if(e.code==='KeyK'){ toggleSkillMode(); }
  // 空格在手动技能模式下：释放当前技能（不跳跃冲突——保留跳跃，额外用 F 释放）
  if(e.code==='KeyF' && !settings.autoSkill){ manualCastActive(); }
  // 回退模式下按 Esc 释放视角控制（Pointer Lock 模式由浏览器原生处理）
  if(e.code==='Escape' && controls._fallback && controls.isLocked){ controls.unlock(); }
  if(['Digit1','Digit2','Digit3','Digit4','Digit5','Digit6','Digit7','Digit8'].includes(e.code)){
    const idx=+e.code.slice(5)-1;
    if(player.skills[idx]){player.activeSkill=idx;refreshSkillBar();toast('切换技能：'+player.skills[idx].name);}
  }
});
document.addEventListener('keyup',e=>keys[e.code]=false);

// 手动技能模式：鼠标左键释放当前选中技能（仅在视角锁定、未开自动施放时生效）
document.addEventListener('mousedown',e=>{
  if(e.button!==0) return;
  if(settings.autoSkill) return;
  if(!controls.isLocked) return;
  // 背包/镶嵌等面板打开时不触发（避免误放）
  if(invPanel && invPanel.style.display==='block') return;
  manualCastActive();
});

// ---------- Xbox 手柄输入 ----------
// Web Gamepad API：standard mapping
//  buttons[0]=A, 1=B, 2=X, 3=Y, 4=LB, 5=RB, 6=LT, 7=RT, 8=Back, 9=Start,
//  10=L3, 11=R3, 12=Up, 13=Down, 14=Left, 15=Right
const gp = {
  connected: false,
  index: -1,
  prevButtons: [],            // 上一帧按键，便于做"按下瞬间"边沿检测
  // 摇杆死区
  DEAD_LS: 0.18,
  DEAD_RS: 0.15,
  // 视角灵敏度（每秒弧度）
  LOOK_X: 2.6,
  LOOK_Y: 1.8,
};
function applyDeadzone(v, dz){ return Math.abs(v)<dz ? 0 : (v - Math.sign(v)*dz)/(1-dz); }
// 手柄事件保留（不提示 UI 也不改变模式选择，仅作为隐藏的辅助输入兼容已有玩家）
addEventListener('gamepadconnected', e=>{
  gp.connected=true; gp.index=e.gamepad.index;
  refreshSkillBar();
});
addEventListener('gamepaddisconnected', e=>{
  if(e.gamepad.index===gp.index){
    gp.connected=false; gp.index=-1;
  }
});

// 每帧调用：返回处理过的输入快照（移动向量 / 视角 / 按下/松开）
function pollGamepad(dt){
  // 启动后未触发 connect 事件时主动扫描
  if(!gp.connected){
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for(let i=0;i<pads.length;i++){
      if(pads[i] && pads[i].connected){
        gp.connected=true; gp.index=i;
        toast('🎮 手柄已激活：'+pads[i].id);
        const row=document.getElementById('padRow'), name=document.getElementById('padName');
        if(row) row.style.display='flex';
        if(name) name.textContent=(pads[i].id||'').slice(0,18);
        break;
      }
    }
    if(!gp.connected) return null;
  }
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const pad = pads[gp.index];
  if(!pad) return null;

  const lx = applyDeadzone(pad.axes[0]||0, gp.DEAD_LS);
  const ly = applyDeadzone(pad.axes[1]||0, gp.DEAD_LS);
  const rx = applyDeadzone(pad.axes[2]||0, gp.DEAD_RS);
  const ry = applyDeadzone(pad.axes[3]||0, gp.DEAD_RS);

  // 当前帧按下数组（boolean[]）
  const cur = pad.buttons.map(b=>b.pressed);
  const prev = gp.prevButtons;
  const justPressed = i => cur[i] && !prev[i];
  // 触发器一般 axes 不在 buttons，但 standard mapping 里 LT/RT 在 buttons[6/7] 也有 .value
  const ltVal = pad.buttons[6] ? pad.buttons[6].value : 0;
  const rtVal = pad.buttons[7] ? pad.buttons[7].value : 0;

  const out = {
    lx, ly, rx, ry,
    sprintToggle: justPressed(10),         // L3 按下瞬间 = 切换跑步开关
    jump: justPressed(0),                  // A
    pickup: justPressed(2),                // X = 拾取（RT 不再触发拾取）
    invToggle: justPressed(3),             // Y
    cancel: justPressed(1),                // B（关背包）
    skillPrev: justPressed(4),             // LB
    skillNext: justPressed(5),             // RB
    skill1: justPressed(14),               // D-Pad Left
    skill2: justPressed(12),               // D-Pad Up
    skill3: justPressed(15),               // D-Pad Right
    skill4: justPressed(13),               // D-Pad Down
    start:  justPressed(9),                // Start
    back:   justPressed(8),                // Back
    skillCast: (rtVal>0.7 && (gp.prevRT||0)<=0.7),  // RT 重按 = 释放技能（手动模式）
    skillDesc: (ltVal>0.7 && (gp.prevLT||0)<=0.7),  // LT 重按 = 查看当前技能描述
    rtVal, ltVal,
  };
  gp.prevButtons = cur;
  gp.prevRT = rtVal;
  gp.prevLT = ltVal;
  return out;
}


const overlay=document.getElementById('overlay');

// ---- overlay 三态切换：开始 / 暂停 / 死亡 视觉区分 ----
// 暂停界面用蓝色调，提示"继续游戏"，保留存读档；
// 死亡界面用红色调脉冲，提示"复活"，隐藏存读档按钮，避免混淆。
function showPauseOverlay(){
  overlay.style.display='flex';
  overlay.classList.remove('ov-death');
  overlay.classList.add('ov-pause');
  const h1 = overlay.querySelector('h1');
  if(h1) h1.textContent='⏸ 已 暂 停';
  const info = document.getElementById('pauseInfo');
  if(info) info.innerHTML =
    '游戏已暂停。<br/>点击 <b style="color:var(--gold)">「继续游戏」</b> 按钮（手柄按 <span class="key">Start</span>）恢复<br/>'+
    '按 <span class="key">ESC</span> 释放鼠标 · 按 <span class="key">I</span> 打开背包<br/>'+
    '<span style="color:#888;font-size:11px">可在下方保存 / 读取进度</span>'+
    '<div style="margin-top:12px;display:flex;gap:10px;justify-content:center">'+
    '  <button id="btnPauseInv" style="padding:9px 22px;font-size:13px;border:1px solid var(--gold);background:#241c10;color:var(--gold);border-radius:4px;cursor:pointer;letter-spacing:2px">🎒 打开背包</button>'+
    '</div>';
  const btn = document.getElementById('btnConfirmMode');
  if(btn) btn.textContent = '▶ 继 续 游 戏';
  const slBar = document.getElementById('saveLoadBar');
  if(slBar) slBar.style.display='flex';
  // 版本号仅在暂停界面显示
  const vb = document.getElementById('verBadge');
  if(vb) vb.style.display='block';
  // 绑定「打开背包」按钮：使用 _invFromOverlay='pause' 标记，让 toggleInv 关闭时自动回到暂停 overlay
  const pi = document.getElementById('btnPauseInv');
  if(pi){
    const open = (e)=>{
      e && e.stopPropagation && e.stopPropagation();
      e && e.preventDefault && e.preventDefault();
      // 标记入口来源 → 影响 toggleInv 关闭时的回归路径
      _invFromOverlay = 'pause';
      // 隐藏暂停 overlay 让位给背包；保持 gamePaused = true
      overlay.style.display = 'none';
      // 拉高背包/tip 等 z-index 到 overlay(50) 之上；toggleInv 关闭时会复位
      invPanel.style.zIndex = 60;
      tipEl.style.zIndex = 70;
      tipCmpEl.style.zIndex = 70;
      const gup = document.getElementById('gemUsePanel'); if(gup) gup.style.zIndex = 65;
      const sop = document.getElementById('socketPanel'); if(sop) sop.style.zIndex = 65;
      const fup = document.getElementById('fusePanel');   if(fup) fup.style.zIndex = 65;
      // 合成动画浮层 #fuseFx 默认 z-index:45，比 fusePanel 65 还低 → 死亡/暂停场景下动画被遮挡看不见。
      // 必须拉到 fusePanel 之上。
      const ffx = document.getElementById('fuseFx');      if(ffx) ffx.style.zIndex = 75;
      // 直接通过 toggleInv 走标准开关流程
      toggleInv(false);
    };
    pi.addEventListener('click', open);
    pi.addEventListener('touchstart', open, {passive:false});
  }
}
function showDeathOverlay(){
  overlay.style.display='flex';
  overlay.classList.remove('ov-pause');
  overlay.classList.add('ov-death');
  // 死亡画面不显示版本号
  const vb = document.getElementById('verBadge');
  if(vb) vb.style.display='none';
  const h1 = overlay.querySelector('h1');
  if(h1) h1.textContent='💀 你 死 了';
  const info = document.getElementById('pauseInfo');
  if(info) info.innerHTML =
    `你倒在了血色荒野。<br/>等级：Lv.${player.level}　击杀：${player.killCount}　<b style="color:#ff8a8a">死亡：${player.deathCount||1}</b><br/><br/>`+
    '<span style="color:#888;font-size:11px">点击「复活」清场重生（2 秒无敌）；或先打开背包整理装备，或读取上次存档</span>'+
    '<div style="margin-top:14px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">'+
    '  <button id="btnDeathRevive" style="padding:10px 28px;font-size:15px;border:2px solid #ff8a8a;background:#3a1414;color:#ffd0d0;border-radius:4px;cursor:pointer;letter-spacing:3px;font-weight:bold;box-shadow:0 0 12px rgba(255,80,80,.6)">✦ 复 活 ✦</button>'+
    '  <button id="btnDeathInv" style="padding:10px 22px;font-size:13px;border:1px solid var(--gold);background:#241c10;color:var(--gold);border-radius:4px;cursor:pointer;letter-spacing:2px">🎒 打开背包</button>'+
    '</div>';
  // 死亡时仍显示存读档按钮（玩家可以选择从上次存档复活）
  const slBar = document.getElementById('saveLoadBar');
  if(slBar) slBar.style.display='flex';

  // 绑定「复活」按钮
  const rv = document.getElementById('btnDeathRevive');
  if(rv){
    const doRevive = (e)=>{
      e && e.stopPropagation && e.stopPropagation();
      e && e.preventDefault && e.preventDefault();
      respawn();
    };
    rv.addEventListener('click', doRevive);
    rv.addEventListener('touchstart', doRevive, {passive:false});
  }

  // 绑定背包按钮（每次重建）
  const di = document.getElementById('btnDeathInv');
  if(di){
    const open = (e)=>{ e && e.stopPropagation && e.stopPropagation(); e && e.preventDefault && e.preventDefault();
      // 关闭可能残留的镶嵌/孔位面板，避免叠加 UI 干扰
      if(typeof closeGemUsePanel==='function') closeGemUsePanel();
      if(typeof closeSocketPanel==='function') closeSocketPanel();
      // 标记入口来源 → toggleInv 关闭时会自动回到死亡 overlay（不取消 gamePaused / 不复活）
      _invFromOverlay = 'death';
      // 临时隐藏死亡 overlay 让出 z-index
      overlay.style.display = 'none';
      // 死亡场景下整个 UI 层级需要拉高（toggleInv 关闭时统一复位）
      invPanel.style.zIndex = 60;
      tipEl.style.zIndex = 70;
      tipCmpEl.style.zIndex = 70;
      const gup = document.getElementById('gemUsePanel'); if(gup) gup.style.zIndex = 65;
      const sop = document.getElementById('socketPanel'); if(sop) sop.style.zIndex = 65;
      const fup = document.getElementById('fusePanel');   if(fup) fup.style.zIndex = 65;
      // 合成动画浮层 #fuseFx 默认 z-index:45，比 fusePanel 65 还低 → 死亡场景下动画被遮挡看不见。
      const ffx = document.getElementById('fuseFx');      if(ffx) ffx.style.zIndex = 75;
      // 走标准 toggleInv 流程（关闭时自动回死亡 overlay）
      toggleInv(false);
    };
    di.addEventListener('click', open);
    di.addEventListener('touchstart', open, {passive:false});
  }
}
function clearOverlayState(){
  overlay.classList.remove('ov-pause','ov-death');
  const slBar = document.getElementById('saveLoadBar');
  if(slBar) slBar.style.display='flex';
  // 恢复确定按钮的初始文案（开始游戏前显示）
  const btn = document.getElementById('btnConfirmMode');
  if(btn) btn.textContent = '✓ 确 定 · 开 始 游 戏';
  // 离开暂停界面时隐藏版本号
  const vb = document.getElementById('verBadge');
  if(vb) vb.style.display='none';
}


// 刚刚点击开始的时间戳：用于忽略浏览器在 lock 失败时立即派发的 unlock 事件
// 避免出现"点击屏幕→overlay 隐藏一瞬→又被弹回来"的体感"点了没反应"
let _justStartedAt = 0;
// 防止 click + pointerdown 双触发（200ms 内的第二次进入直接忽略）
let _starting = false;

// ===================== 输入模式系统（PC键鼠 / 手机竖屏） =====================
// 两种模式共用相同的游戏逻辑，仅输入层与 HUD 显示不同。
// 持久化到 localStorage.inputMode。开始菜单的卡片切换会立即应用 body 的 mode-* class。
// 注：v0.32.8 起移除 PC 手柄模式选项（手柄检测/事件代码仍保留作为辅助输入，但不再作为独立 UI 模式）
const InputMode = {
  current: null,        // 'kbm' | 'touch' | null
  // 自动检测推荐：移动端→touch；否则 kbm
  detect(){
    const isTouchDev = ('ontouchstart' in window) || (navigator.maxTouchPoints||0) > 1;
    const isMobile = /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent||'');
    if(isTouchDev && isMobile) return 'touch';
    return 'kbm';
  },
  apply(mode){
    // 兼容旧存档：把过期的 'pad' 归一到 'kbm'
    if(mode==='pad') mode='kbm';
    if(!['kbm','touch'].includes(mode)) mode='kbm';
    this.current = mode;
    document.body.classList.remove('mode-kbm','mode-pad','mode-touch');
    document.body.classList.add('mode-'+mode);
    try{ localStorage.setItem('inputMode', mode); }catch(_){}
    // 高亮选中卡片
    document.querySelectorAll('.modeCard').forEach(el=>{
      el.classList.toggle('active', el.dataset.mode===mode);
    });
    // 触屏模式下渲染降级 + 强制开启自动施放（没有手动攻击键）
    if(mode==='touch'){
      try{ renderer.setPixelRatio(Math.min(devicePixelRatio||1, 1.0)); }catch(_){}   // v0.33 触屏基础 PR 上限 1.0（旧 1.25→1.0）
      try{ renderer.shadowMap.enabled = false; }catch(_){}
      if(scene && scene.fog){ scene.fog.far = 100; }   // 远雾拉近，省 GPU
      try{ if(typeof settings!=='undefined') settings.autoSkill = true; }catch(_){}
    } else {
      try{ renderer.setPixelRatio(devicePixelRatio||1); }catch(_){}
      try{ renderer.shadowMap.enabled = true; }catch(_){}
      if(scene && scene.fog){ scene.fog.far = 160; }
    }
    // 武器视位置随模式调整
    if(typeof adjustViewWeaponForMode==='function') adjustViewWeaponForMode();
  },
  init(){
    let saved = null;
    try{ saved = localStorage.getItem('inputMode'); }catch(_){}
    this.apply(saved || this.detect());
    // 卡片点击切换
    document.querySelectorAll('.modeCard').forEach(el=>{
      el.addEventListener('click', (ev)=>{
        ev.stopPropagation();   // 防止冒泡到 overlay 触发 startOrResumeGame
        this.apply(el.dataset.mode);
      });
      el.addEventListener('touchstart', (ev)=>{
        ev.stopPropagation();
        this.apply(el.dataset.mode);
      }, {passive:true});
    });
  }
};
InputMode.init();

// ===================== 触屏输入控制器 =====================
// 仅在 mode-touch 时生效；提供：
//   - 左下虚拟摇杆 → touchInput.lx / ly （归一化 -1..1）
//   - 右上半屏滑动 → 直接更新 _yawObject.rotation.y 与 camera.x 旋转
//   - 各按钮：跳/拾/喝药/背包/暂停/攻击 → 直接调对应函数
const touchInput = { lx:0, ly:0, rx:0, ry:0 };
(function initTouchControls(){
  // 通用摇杆构造：返回 stickId getter 用于过滤别处事件
  const STICK_R = 50;
  function makeStick(id, axis){
    const stick = document.getElementById(id);
    if(!stick) return ()=>-1;
    const knob = stick.querySelector('.knob');
    let sid = -1, sx0=0, sy0=0;
    stick.addEventListener('touchstart', (e)=>{
      const t = e.changedTouches[0]; sid = t.identifier;
      const r = stick.getBoundingClientRect();
      sx0 = r.left + r.width/2; sy0 = r.top + r.height/2;
      e.preventDefault(); e.stopPropagation();
    }, {passive:false});
    stick.addEventListener('touchmove', (e)=>{
      for(const t of e.changedTouches){
        if(t.identifier!==sid) continue;
        let dx = t.clientX - sx0, dy = t.clientY - sy0;
        const d = Math.hypot(dx,dy);
        if(d>STICK_R){ dx*=STICK_R/d; dy*=STICK_R/d; }
        knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        touchInput[axis+'x'] = dx / STICK_R;
        touchInput[axis+'y'] = dy / STICK_R;
        e.preventDefault();
      }
    }, {passive:false});
    const end = (e)=>{
      for(const t of e.changedTouches){
        if(t.identifier!==sid) continue;
        sid = -1;
        knob.style.transform = 'translate(-50%,-50%)';
        touchInput[axis+'x'] = 0; touchInput[axis+'y'] = 0;
      }
    };
    stick.addEventListener('touchend',    end, {passive:true});
    stick.addEventListener('touchcancel', end, {passive:true});
    return ()=>sid;
  }
  makeStick('tStick',  'l');     // 左摇杆 → 移动
  makeStick('tStickR', 'r');     // 右摇杆 → 视角

  // 触屏：3D 视口空白处单指拖动，也可转视角（与右摇杆并存）
  // 排除：所有触屏控件、面板、技能槽
  let lookId = -1, lx0=0, ly0=0;
  const isControlEl = (el)=>{
    if(!el) return false;
    return !!(el.closest && el.closest(
      '#tStick, #tStickR, #tHp, #tMp, #tInv, #tQuest, #tAuto, #tPause, #tJump, #tFnRow,'+
      '#invPanel, #fusePanel, #gemUsePanel, #socketPanel, #overlay, #questPanel, #toggleBar, .slot, .tip'
    ));
  };
  document.addEventListener('touchstart', (e)=>{
    if(InputMode.current!=='touch') return;
    if(!controls.isLocked) return;
    for(const t of e.changedTouches){
      const target = document.elementFromPoint(t.clientX, t.clientY);
      if(isControlEl(target)) continue;
      lookId = t.identifier; lx0 = t.clientX; ly0 = t.clientY;
      break;
    }
  }, {passive:true});
  document.addEventListener('touchmove', (e)=>{
    if(InputMode.current!=='touch') return;
    if(!controls.isLocked) return;
    for(const t of e.changedTouches){
      if(t.identifier!==lookId) continue;
      const dx = t.clientX - lx0; /* dy 不再使用：手机模式锁定 Y 轴 */
      lx0 = t.clientX; ly0 = t.clientY;
      const eu = controls._euler;
      eu.setFromQuaternion(camera.quaternion);
      eu.y -= dx * 0.0035;
      // 不再调整 eu.x：手机模式下视角始终保持水平
      camera.quaternion.setFromEuler(eu);
    }
  }, {passive:true});
  const endLook = (e)=>{
    for(const t of e.changedTouches){ if(t.identifier===lookId) lookId=-1; }
  };
  document.addEventListener('touchend',    endLook, {passive:true});
  document.addEventListener('touchcancel', endLook, {passive:true});


  // 按钮：用 touchstart 立刻响应；阻止冒泡 + 阻止默认避免 ghost click
  const bind = (id, fn)=>{
    const el = document.getElementById(id);
    if(!el) return;
    const handler = (e)=>{ e.stopPropagation(); e.preventDefault(); fn(); };
    el.addEventListener('touchstart', handler, {passive:false});
    el.addEventListener('mousedown',  handler);
    el.addEventListener('click', (e)=>{ e.stopPropagation(); });
  };
  bind('tJump', ()=>{
    // 手机模式下原「跳」改为「奔跑」开关——跳跃在大多数情况下用不到，奔跑更实用
    if(typeof toggleSprint==='function') toggleSprint();
    // 同步按钮的高亮态（与 #tAuto 一样的视觉）
    const btn = document.getElementById('tJump');
    if(btn) btn.classList.toggle('on', !!(settings && settings.sprintOn));
  });
  bind('tHp',   ()=>{ if(typeof quickDrinkHp==='function') quickDrinkHp(); });
  bind('tMp',   ()=>{ if(typeof quickDrinkMp==='function') quickDrinkMp(); });
  bind('tInv',  ()=>{ if(typeof toggleInv==='function') toggleInv(true); });
  bind('tQuest',()=>{
    document.body.classList.toggle('show-quest');
  });
  bind('tAuto', ()=>{
    if(typeof toggleAutoPlay==='function') toggleAutoPlay();
    const btn = document.getElementById('tAuto');
    if(btn) btn.classList.toggle('on', !!(settings && settings.autoPlay));
  });
  bind('tPause',()=>{
    if(player._dead) return;
    if(gamePaused){
      startOrResumeGame();
    } else {
      gamePaused = true;
      controls.unlock && controls.unlock();
      if(typeof showPauseOverlay==='function') showPauseOverlay();
      else { overlay.style.display='flex'; }
    }
  });

  // 技能槽：tap 切换为该技能（不再立即施放，由自动施放接管）；长按显示技能描述
  const skillsEl = document.getElementById('skills');
  if(skillsEl){
    let pressTimer=null, longPressed=false, pressedSlotIdx=-1;
    const slotIdxOf = (target)=>{
      const slot = target && target.closest && target.closest('.slot');
      if(!slot) return -1;
      const all = Array.from(skillsEl.querySelectorAll('.slot'));
      return all.indexOf(slot);
    };
    skillsEl.addEventListener('touchstart', (e)=>{
      if(InputMode.current!=='touch') return;
      const idx = slotIdxOf(e.target);
      if(idx<0) return;
      pressedSlotIdx = idx; longPressed=false;
      pressTimer = setTimeout(()=>{
        longPressed = true;
        const s = player.skills[idx];
        if(s){
          const oldActive = player.activeSkill;
          player.activeSkill = idx;
          if(typeof showActiveSkillDesc==='function') showActiveSkillDesc();
          player.activeSkill = oldActive;
        }
      }, 600);
      e.stopPropagation();
    }, {passive:true});
    const cancel = ()=>{ if(pressTimer){ clearTimeout(pressTimer); pressTimer=null; } };
    skillsEl.addEventListener('touchmove', cancel, {passive:true});
    skillsEl.addEventListener('touchend', (e)=>{
      cancel();
      if(InputMode.current!=='touch') return;
      const idx = pressedSlotIdx; pressedSlotIdx=-1;
      if(idx<0 || longPressed) return;
      const s = player.skills[idx]; if(!s) return;
      // 短按：切换为该技能（自动施放接管释放时机）
      player.activeSkill = idx;
      if(typeof refreshSkillBar==='function') refreshSkillBar();
      if(typeof manualCastActive==='function') manualCastActive();
      e.stopPropagation();
    }, {passive:true});
    skillsEl.addEventListener('touchcancel', cancel, {passive:true});
  }

  // 触屏：在背包空白区域 / 面板空白区域点一下，关闭 tip
  // 装备/宝石的具体格子各自有 click handler，会先消费事件不会冒泡到这里
  const dismissTipPanels = ['invPanel','fusePanel','gemUsePanel','socketPanel'];
  dismissTipPanels.forEach(pid=>{
    const el = document.getElementById(pid);
    if(!el) return;
    const tryHide = (ev)=>{
      if(InputMode.current!=='touch') return;
      // 点到背包格 / 装备格 / tip 操作按钮 / tip 本身 → 不要关闭 tip
      const t = ev.target;
      if(t && t.closest && (t.closest('.invSlot') || t.closest('.eqSlot') || t.closest('.tip') || t.closest('.gemUseEq') || t.closest('.fuseRow') || t.closest('.hole2'))) return;
      if(typeof hideTip==='function') hideTip();
    };
    el.addEventListener('touchstart', tryHide, {passive:true});
    el.addEventListener('click',      tryHide);
  });
})();



function startOrResumeGame(){
  // 死亡画面有自己的「复活」按钮，不要走这里
  if(player._dead){ console.log('[start] player dead, ignore'); return; }
  if(_starting){ console.log('[start] already starting, ignore'); return; }
  _starting = true;
  console.log('[start] startOrResumeGame()');

  // 关键：在用户首次点击「确定/继续」的手势上下文中初始化 AudioContext，
  // 否则移动端 Safari/Chrome 一直 suspended，开局十几秒都没声音
  // 注意：不启动 BGM（用户反馈持续低频背景音影响体验），只解锁音频管线供 SFX 使用
  try{
    if(typeof Audio!=='undefined' && typeof Audio.unlock==='function') Audio.unlock();
  }catch(_){}

  // ① 先把暂停解掉、菜单藏起来 —— 即使后面 lock 失败也确保游戏能跑
  gamePaused = false;
  _autosaveEnabled = true;   // 玩家正式开打后开启每波自动存档
  overlay.style.display = 'none';
  // 清掉"从 overlay 进背包"的状态标记（玩家可能在暂停时打开过背包又走开）
  _invFromOverlay = null;
  const h1 = overlay.querySelector('h1');
  if(h1) h1.textContent = 'DIABLO · FPS · AUTO';
  // 清除暂停/死亡 overlay 的 class，恢复确定按钮初始文案
  if(typeof clearOverlayState==='function') clearOverlayState();
  _justStartedAt = performance.now();

  // ② 启动音频上下文（仅 ensure，不再播放 BGM——用户反馈已去除背景音乐）
  try{ Audio.init(); }catch(err){ console.warn('[start] Audio failed:', err); }

  // ③ 尝试锁定鼠标 —— 失败也无所谓，fallback 模式可玩
  // 触屏模式：直接走 fallback（不请求 PointerLock，避免在移动浏览器报错），
  //          手动把 controls 标记为已锁定，让游戏循环正常运行。
  if(InputMode && InputMode.current==='touch'){
    controls._fallback = true;
    if(!controls.isLocked){ controls.isLocked = true; controls._emit && controls._emit('lock'); }
  } else {
    try{ controls.lock(); }catch(err){ console.warn('[start] PointerLock failed:', err); }
  }

  setTimeout(()=>{ _starting = false; }, 250);
}

// 开始游戏：必须点击"确定"按钮（或按 Space/Enter）后才进入
// 这样玩家有机会先选择操作模式再开始，避免误触
function _overlayHandler(ev){
  if(player._dead) return; // 死亡画面用「复活」按钮
  startOrResumeGame();
}
// 确定按钮（开始菜单核心入口）
const _btnConfirmMode = document.getElementById('btnConfirmMode');
if(_btnConfirmMode){
  let _confirmFiring = false;
  const startFn = (e)=>{
    if(e){ e.stopPropagation(); if(e.preventDefault) e.preventDefault(); }
    if(_confirmFiring) return;
    _confirmFiring = true;
    _overlayHandler(e);
    // 防点击穿透：开始/继续后 350ms 内禁掉触屏功能键 + 主画布点击
    // 仅拦截 #touchLayer / canvas，不影响其他 UI（如存读档按钮）
    const blockNodes = [document.getElementById('touchLayer'), renderer && renderer.domElement].filter(Boolean);
    blockNodes.forEach(n=>{ n.style.pointerEvents='none'; });
    setTimeout(()=>{
      blockNodes.forEach(n=>{ n.style.pointerEvents=''; });
      _confirmFiring = false;
    }, 350);
  };
  _btnConfirmMode.addEventListener('click',     startFn);
  _btnConfirmMode.addEventListener('touchstart',startFn, {passive:false});
}
// 键盘兜底：开始/暂停菜单上按 Space/Enter 视为"确定开始"
window.addEventListener('keydown', (e)=>{
  if(overlay.style.display==='none') return;
  if(player._dead) return;
  if(e.code==='Space' || e.code==='Enter'){
    startOrResumeGame();
  }
});

controls.addEventListener('lock',()=>{
  console.log('[ctrl] lock');
  overlay.style.display='none';
});
controls.addEventListener('unlock',()=>{
  console.log('[ctrl] unlock');
  if(player.hp<=0 || player._dead) return;
  // 背包面板打开时不弹开始菜单
  if(invPanel && invPanel.style.display==='block')return;
  // 刚点击开始游戏后立即触发的 unlock 视为"lock 失败"，不要把 overlay 弹回来
  // 这是 IDE WebView / 某些浏览器策略下的常见情况；fallback 模式仍可正常游玩
  if(performance.now() - _justStartedAt < 600) return;
  // ESC 解锁鼠标 = 暂停 + 弹菜单
  gamePaused = true;
  if(typeof showPauseOverlay==='function') showPauseOverlay();
  else { overlay.style.display='flex'; }
});

// ---------- 技能 ----------
const SKILL_DB={
  swing:{name:'横扫斩',ico:'⚔',cd:.6,mp:0,range:3.5,type:'melee',dmg:[6,10],color:0xffffff,desc:'近战横扫，对身前扇形范围内的敌人造成物理伤害，出手稳健。'},
  thrust:{name:'刺击',ico:'🗡',cd:.45,mp:0,range:4,type:'melee',dmg:[8,12],color:0xffffff,desc:'快速突刺单体目标，冷却极短，适合贴脸高频输出。'},
  // 远程系：CD/法力消耗显著提升，控制刷屏感
  fireball:{name:'火球',ico:'🔥',cd:2.0,mp:18,range:30,type:'proj',dmg:[14,22],color:0xff5a1a,desc:'射出火球，命中后爆炸对周围敌人造成火焰伤害。'},
  iceshard:{name:'冰晶',ico:'❄',cd:1.4,mp:12,range:25,type:'proj',dmg:[10,16],color:0x6ad6ff,desc:'发射冰晶贯穿目标，造成伤害并短暂减速敌人。'},
  chain:{name:'闪电链',ico:'⚡',cd:3.0,mp:30,range:18,type:'chain',dmg:[20,28],color:0xc8b6ff,desc:'释放闪电，在多个临近敌人之间连续跳跃伤害。'},
  arrow:{name:'多重射击',ico:'🏹',cd:1.5,mp:8,range:28,type:'multi',dmg:[7,11],color:0xffe28a,desc:'一次射出多支箭矢呈扇形覆盖，清理成群小怪。'},
  bolt:{name:'穿刺箭',ico:'➹',cd:1.2,mp:10,range:30,type:'pierce',dmg:[12,18],color:0xa8ffae,desc:'高速箭矢沿直线穿透命中路径上的所有敌人。'},
  meteor:{name:'陨石',ico:'☄',cd:9,mp:55,range:30,type:'aoe',dmg:[40,70],color:0xff8030,desc:'召唤陨石轰炸指定区域，造成大范围高额爆发伤害。'},
  nova:{name:'新星',ico:'✦',cd:8,mp:50,range:8,type:'nova',dmg:[25,40],color:0x9be0ff,desc:'以自身为中心爆发冰霜冲击波，击退并打击周身敌人。'},
  // 防御系：不锁敌、自动按状态触发（治疗/护盾/减伤姿态）
  heal:{name:'治疗术',ico:'✚',cd:8,mp:25,range:0,type:'heal',heal:[55,85],color:0x7bd96a,desc:'立即恢复一定生命值，生命较低时会自动施放。'},
  barrier:{name:'守护护盾',ico:'🛡',cd:12,mp:30,range:0,type:'shield',shield:[80,120],dur:8,color:0x6ad6ff,desc:'生成可吸收伤害的护盾，持续数秒抵挡攻击。'},
  warcry:{name:'铁壁姿态',ico:'🪖',cd:16,mp:20,range:0,type:'haste',reduce:0.4,dur:6,color:0xe8c45a,desc:'进入坚毅姿态，短时间内大幅降低受到的伤害。'},
};
// ===================== 升级能力池（建议1：经验满后N选1）=====================
// 每次升级时，从池中随机抽取3个能力供玩家选择
// type: newSkill=新技能, extraProj=额外投射物, aoeUp=AOE扩大, cdRed=CD缩短,
//       dmgUp=伤害提升, defUp=防御提升, healUp=回复提升, aura=被动光环, special=特殊机制
const ABILITY_POOL = [
  // ---- 新技能（获得一个主动技能）----
  {id:'sk_meteor',   name:'陨石术',     ico:'☄', type:'newSkill',  skill:'meteor',  rarity:2, desc:'获得「陨石术」：召唤陨石轰炸区域，造成高额爆发伤害。'},
  {id:'sk_chain',    name:'闪电链',     ico:'⚡', type:'newSkill',  skill:'chain',   rarity:2, desc:'获得「闪电链」：闪电在多个敌人间跳跃伤害。'},
  {id:'sk_nova',     name:'冰霜新星',   ico:'✦', type:'newSkill',  skill:'nova',    rarity:2, desc:'获得「新星」：以自身为中心爆发冲击波，击退周身敌人。'},
  {id:'sk_fireball', name:'火球术',     ico:'🔥', type:'newSkill',  skill:'fireball', rarity:1, desc:'获得「火球术」：射出火球，命中后爆炸造成范围火焰伤害。'},
  {id:'sk_arrow',    name:'多重射击',   ico:'🏹', type:'newSkill',  skill:'arrow',   rarity:1, desc:'获得「多重射击」：一次射出多支箭矢呈扇形覆盖。'},
  {id:'sk_iceshard', name:'冰晶术',     ico:'❄', type:'newSkill',  skill:'iceshard',rarity:1, desc:'获得「冰晶术」：发射冰晶贯穿目标，减速敌人。'},
  {id:'sk_heal',     name:'治疗术',     ico:'✚', type:'newSkill',  skill:'heal',    rarity:1, desc:'获得「治疗术」：立即恢复一定生命值。'},
  {id:'sk_barrier',  name:'守护护盾',   ico:'🛡', type:'newSkill',  skill:'barrier', rarity:1, desc:'获得「守护护盾」：生成可吸收伤害的护盾。'},
  {id:'sk_bolt',     name:'穿刺箭',     ico:'➹', type:'newSkill',  skill:'bolt',    rarity:1, desc:'获得「穿刺箭」：高速箭矢穿透路径上所有敌人。'},
  {id:'sk_warcry',   name:'铁壁姿态',   ico:'🪖', type:'newSkill',  skill:'warcry',  rarity:2, desc:'获得「铁壁姿态」：大幅降低受到的伤害，生存向。'},

  // ---- 技能强化（强化已有技能）----
  {id:'ex_proj1',  name:'额外投射物+1', ico:'🎯', type:'skillBuff', buff:'extraProj', val:1, rarity:2, desc:'所有远程技能额外+1发投射物。'},
  {id:'ex_aoe20',  name:'AOE范围+20%',   ico:'💥', type:'skillBuff', buff:'aoeScale',  val:0.2, rarity:1, desc:'所有AOE技能范围+20%。'},
  {id:'ex_cd15',   name:'冷却缩短15%',    ico:'⏱', type:'skillBuff', buff:'cdRed',     val:0.15,rarity:2, desc:'所有技能冷却时间-15%。'},
  {id:'ex_dmg20',  name:'技能伤害+20%',   ico:'⚔', type:'skillBuff', buff:'dmgScale',  val:0.2, rarity:2, desc:'所有技能伤害+20%。'},
  {id:'ex_orb3',   name:'环绕飞球+3',     ico:'🔮', type:'skillBuff', buff:'orbCount',  val:3,   rarity:3, desc:'获得3颗环绕飞球，自动攻击周围敌人。'},

  // ---- 属性强化 ----
  {id:'af_str',    name:'力量+15',      ico:'💪', type:'statUp', stat:'str',        val:15, rarity:1, desc:'力量+15，提升物理伤害和护甲。'},
  {id:'af_dex',    name:'敏捷+15',      ico:'🏃', type:'statUp', stat:'dex',        val:15, rarity:1, desc:'敏捷+15，提升暴击率和移动速度。'},
  {id:'af_int',    name:'智力+15',      ico:'🧠', type:'statUp', stat:'int',        val:15, rarity:1, desc:'智力+15，提升技能伤害和法力上限。'},
  {id:'af_hp',     name:'最大生命+80',   ico:'❤', type:'statUp', stat:'hpMax',      val:80, rarity:1, desc:'最大生命值+80。'},
  {id:'af_dmgPct', name:'伤害+12%',     ico:'⚔', type:'statUp', stat:'dmgPct',    val:12, rarity:2, desc:'所有伤害+12%。'},
  {id:'af_crit',   name:'暴击率+8%',    ico:'💥', type:'statUp', stat:'critChance',val:8,  rarity:2, desc:'暴击率+8%。'},
  {id:'af_critDmg',name:'暴击伤害+30%', ico:'🔥', type:'statUp', stat:'critDmg',   val:30, rarity:2, desc:'暴击伤害+30%。'},

  // ---- 被动光环 ----
  {id:'au_thorns',  name:'荆棘光环',    ico:'🌹', type:'aura', aura:'thorns',  val:15, rarity:2, desc:'每5秒对周围敌人造成15点反伤。'},
  {id:'au_life',    name:'生命汲取',     ico:'🩸', type:'aura', aura:'lifeOnHit',val:3,  rarity:2, desc:'每次命中敌人回复3点生命。'},
  {id:'au_armor',   name:'石肤术',      ico:'🪨', type:'aura', aura:'armor',   val:30, rarity:1, desc:'护甲+30，持续本局。'},
  {id:'au_speed',   name:'疾风步',      ico:'💨', type:'aura', aura:'moveSpd', val:15, rarity:1, desc:'移动速度+15%。'},

  // ---- 特殊机制 ----
  {id:'sp_revive',  name:'死亡回溯',    ico:'👼', type:'special', special:'revive',  val:1,  rarity:3, desc:'本局首次死亡时自动复活（满血）。'},
  {id:'sp_magnet',  name:'经验磁铁',    ico:'🧲', type:'special', special:'magnet', val:5,  rarity:1, desc:'拾取范围+5米。'},
  {id:'sp_luck',    name:'幸运儿',      ico:'🍀', type:'special', special:'luck',   val:20, rarity:1, desc:'掉落品质提升，稀有+暗金掉落率+20%。'},
];
// 玩家已选能力列表（存 key → 等级）
let _playerAbilities = {};
// 当前升级选择面板是否打开
let _abilitySelectOpen = false;

// 获取当前可选能力池（排除已选满的）
function getAvailableAbilities(){
  const pool = ABILITY_POOL.filter(a=>{
    // 同类能力最多叠3级（用id前缀判断）
    const prefix = a.id.split('_')[0]+'_'+a.id.split('_')[1];
    const curLv = _playerAbilities[prefix] || 0;
    return curLv < 3;
  });
  // 按稀有度加权随机
  const weighted = [];
  pool.forEach(a=>{
    let w = 1;
    if(a.rarity===1) w = 50;
    else if(a.rarity===2) w = 25;
    else w = 8;
    for(let i=0;i<w;i++) weighted.push(a);
  });
  // 随机抽3个
  const picks = [];
  const used = new Set();
  for(let i=0;i<3 && weighted.length>0;i++){
    const idx = Math.floor(Math.random()*weighted.length);
    const a = weighted[idx];
    if(used.has(a.id)){ weighted.splice(idx,1); continue; }
    used.add(a.id);
    picks.push({...a});
  }
  return picks;
}

// 应用选中的能力
function applyAbility(ability){
  const prefix = ability.id.split('_')[0]+'_'+ability.id.split('_')[1];
  _playerAbilities[prefix] = (_playerAbilities[prefix]||0) + 1;
  const lv = _playerAbilities[prefix];

  switch(ability.type){
    case 'newSkill':
      if(ability.skill && SKILL_DB[ability.skill]){
        const have = player.skills.some(s=>s.key===ability.skill);
        if(!have){
          // 技能栏无限 → 直接添加新技能
          player.skills.push({key:ability.skill, ...SKILL_DB[ability.skill], cdLeft:0});
          refreshSkillBar();
          toast(`获得技能：${ability.name}`);
        } else {
          // 已有该技能 → 给予该技能专属强化（CD-30%+伤害+20%）
          const sk = player.skills.find(s=>s.key===ability.skill);
          if(sk) {
            sk.cd = Math.max(0.2, sk.cd * 0.7);
            sk._dmgBonus = (sk._dmgBonus || 0) + 0.2;
          }
          toast(`${ability.name} 强化！CD-30% 伤害+20%`);
        }
      }
      break;
    case 'skillBuff':
      if(!player._skillBuffs) player._skillBuffs = {};
      if(!player._skillBuffs[ability.buff]) player._skillBuffs[ability.buff] = 0;
      player._skillBuffs[ability.buff] += ability.val * lv; // 叠加
      toast(`${ability.name}（Lv${lv}）`);
      break;
    case 'statUp':
      if(!player._abilityStats) player._abilityStats = {};
      if(!player._abilityStats[ability.stat]) player._abilityStats[ability.stat] = 0;
      player._abilityStats[ability.stat] += ability.val;
      applyEquipStats();
      toast(`${ability.name}（Lv${lv}）`);
      break;
    case 'aura':
      if(!player._auras) player._auras = {};
      player._auras[ability.aura] = (player._auras[ability.aura]||0) + ability.val;
      toast(`${ability.name}（Lv${lv}）`);
      break;
    case 'special':
      if(!player._specials) player._specials = {};
      player._specials[ability.special] = (player._specials[ability.special]||0) + ability.val;
      if(ability.special==='revive') player._reviveUsed = false;
      toast(`${ability.name}！`);
      break;
  }
  // 存档能力选择（读档时恢复）
  player._savedAbilities = {..._playerAbilities};
}

// 显示能力选择面板
function showAbilitySelectPanel(){
  const picks = getAvailableAbilities();
  if(picks.length===0){
    // 没有可选能力了，直接继续
    hideAbilitySelectPanel();
    return;
  }
  _abilitySelectOpen = true;
  gamePaused = true;

  let html = `<div style="padding:16px 18px 10px;text-align:center">
    <div style="font-size:20px;color:var(--gold);letter-spacing:3px;margin-bottom:4px">★ 等级提升 ★</div>
    <div style="font-size:13px;color:#aaa;margin-bottom:14px">选择一项能力（${picks.length}选1）</div>
  </div>`;
  picks.forEach((a,i)=>{
    const rarityColor = a.rarity===3?'#e8c45a':a.rarity===2?'#f4e26b':'#5aa6ff';
    html += `<div class="abilCard" data-idx="${i}" style="
      margin:0 18px 10px;padding:14px 16px;
      background:linear-gradient(135deg,#1a1408,#0f0c08);
      border:2px solid ${rarityColor};border-radius:8px;
      cursor:pointer;text-align:left;
      transition:all .12s ease;
      ">
      <div style="font-size:16px;color:${rarityColor};margin-bottom:4px">${a.ico} ${a.name}</div>
      <div style="font-size:12px;color:#bbb;line-height:1.5">${a.desc}</div>
    </div>`;
  });
  // 手机：底部加"跳过"按钮（可选）
  html += `<div style="text-align:center;padding:6px 0 14px">
    <button id="abilSkipBtn" style="padding:8px 28px;background:rgba(255,255,255,.08);border:1px solid #555;border-radius:5px;color:#888;font-size:13px;cursor:pointer">跳过本次选择</button>
  </div>`;

  const panel = document.getElementById('abilitySelectPanel');
  panel.innerHTML = html;
  panel.style.display = 'block';

  // 绑定卡片点击（需二次确认防误触）
  panel.querySelectorAll('.abilCard').forEach(card=>{
    const idx = +card.getAttribute('data-idx');
    const handler = (e)=>{
      e.stopPropagation();
      const a = picks[idx];
      if(!a) return;
      // 二次确认对话框
      const confirmHtml = `
        <div id="abilConfirm" style="position:fixed;inset:0;z-index:99;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center">
          <div style="background:#15110b;border:2px solid var(--gold);border-radius:8px;padding:20px 24px;max-width:340px;text-align:center;box-shadow:0 0 40px rgba(232,196,90,.4)">
            <div style="font-size:15px;color:#ddd;margin-bottom:10px">确认选择此项能力？</div>
            <div style="font-size:18px;color:${a.rarity===3?'#e8c45a':a.rarity===2?'#f4e26b':'#5aa6ff'};font-weight:bold;margin-bottom:14px">${a.ico} ${a.name}</div>
            <div style="font-size:12px;color:#aaa;margin-bottom:16px;line-height:1.5">${a.desc}</div>
            <div style="display:flex;gap:12px;justify-content:center">
              <button id="abilConfirmOk" style="padding:10px 24px;background:linear-gradient(#3a2a14,#241d10);border:2px solid var(--gold);border-radius:6px;color:var(--gold);font-size:14px;font-weight:bold;cursor:pointer;font-family:inherit">✓ 确认</button>
              <button id="abilConfirmCancel" style="padding:10px 24px;background:#1a1410;border:1px solid #555;border-radius:6px;color:#ccc;font-size:14px;cursor:pointer;font-family:inherit">取消</button>
            </div>
          </div>
        </div>`;
      document.body.insertAdjacentHTML('beforeend', confirmHtml);
      const dialog = document.getElementById('abilConfirm');
      const onOk = ()=> {
        dialog.remove();
        applyAbility(a);
        hideAbilitySelectPanel();
      };
      const onCancel = ()=> { dialog.remove(); };
      document.getElementById('abilConfirmOk').addEventListener('click', onOk);
      document.getElementById('abilConfirmOk').addEventListener('touchend', (ev)=>{ ev.preventDefault(); onOk(); }, {passive:false});
      document.getElementById('abilConfirmCancel').addEventListener('click', onCancel);
      document.getElementById('abilConfirmCancel').addEventListener('touchend', (ev)=>{ ev.preventDefault(); onCancel(); }, {passive:false});
    };
    card.addEventListener('click', handler);
    card.addEventListener('touchend', (e)=>{ e.preventDefault(); handler(e); }, {passive:false});
    // 悬停效果
    card.addEventListener('mouseenter', ()=>{ card.style.background='linear-gradient(135deg,#2a1f10,#151008)'; card.style.borderColor='var(--gold)'; });
    card.addEventListener('mouseleave', ()=>{ card.style.background=''; card.style.borderColor=''; });
  });
  // 跳过按钮
  const skipBtn = document.getElementById('abilSkipBtn');
  if(skipBtn){
    skipBtn.addEventListener('click', ()=> hideAbilitySelectPanel());
    skipBtn.addEventListener('touchend', (e)=>{ e.preventDefault(); hideAbilitySelectPanel(); }, {passive:false});
  }
}

function hideAbilitySelectPanel(){
  const panel = document.getElementById('abilitySelectPanel');
  if(panel) panel.style.display = 'none';
  _abilitySelectOpen = false;
  gamePaused = false;
}
// ===================== 能力池结束 =====================

// 渲染能力面板（Tab 键 / 手机按钮打开时调用）
function renderAbilityPanel(){
  const body = document.getElementById('abilPanelBody');
  if(!body) return;
  let html = '';
  const prefixes = Object.keys(_playerAbilities);
  if(prefixes.length === 0){
    html = '<div style="color:#888;padding:20px;text-align:center">尚未选择任何能力<br/><span style="font-size:11px;color:#666">升级后暂停，从 3 个选项中选择能力</span></div>';
  } else {
    // 统计总加成
    let totalDmgPct = 0, totalCrit = 0, totalCDR = 0, totalAOE = 0, totalExtraProj = 0;
    let auraLines = [];
    let newSkills = [];

    prefixes.forEach(prefix => {
      const lv = _playerAbilities[prefix];
      const ab = ABILITY_POOL.find(a => {
        const p = a.id.split('_')[0]+'_'+a.id.split('_')[1];
        return p === prefix;
      });
      if(!ab) return;

      const rarityColor = ab.rarity===3?'#e8c45a':ab.rarity===2?'#f4e26b':'#5aa6ff';
      let currentVal = ab.val * lv;
      let effectText = '';

      switch(ab.type){
        case 'newSkill':
          newSkills.push(ab.name);
          effectText = `主动技能已激活`;
          break;
        case 'skillBuff':
          if(ab.buff==='dmgScale'){ totalDmgPct += ab.val*100*lv; effectText = `技能伤害 +${(ab.val*100*lv).toFixed(0)}%`; }
          else if(ab.buff==='cdRed'){ totalCDR += ab.val*100*lv; effectText = `冷却缩短 ${(ab.val*100*lv).toFixed(0)}%`; }
          else if(ab.buff==='aoeScale'){ totalAOE += ab.val*100*lv; effectText = `AOE 范围 +${(ab.val*100*lv).toFixed(0)}%`; }
          else if(ab.buff==='extraProj'){ totalExtraProj += currentVal; effectText = `额外投射物 +${currentVal}`; }
          else if(ab.buff==='orbCount'){ effectText = `环绕飞球 +${currentVal}`; }
          break;
        case 'statUp':
          effectText = `+${currentVal} ${ab.stat}`;
          break;
        case 'aura':
          auraLines.push(`${ab.ico} ${ab.name}（Lv${lv}）`);
          effectText = ab.desc;
          break;
        case 'special':
          effectText = ab.desc;
          break;
      }

      html += `<div class="abilRow" style="margin:6px 10px;padding:10px 14px;
        background:linear-gradient(135deg,#151008,#0f0c08);
        border:1px solid ${rarityColor}33;
        border-left:3px solid ${rarityColor};
        border-radius:6px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <div style="font-size:14px;color:${rarityColor}">${ab.ico} ${ab.name}</div>
          <div style="font-size:11px;color:#888">Lv${lv}/3</div>
        </div>
        <div style="font-size:12px;color:#bbb;line-height:1.5">${effectText}</div>
      </div>`;
    });

    // 汇总行
    let summary = '';
    if(totalDmgPct>0) summary += `⚔ 技能伤害 +${totalDmgPct.toFixed(0)}%　`;
    if(totalCDR>0) summary += `⏱ CD缩短 ${totalCDR.toFixed(0)}%　`;
    if(totalAOE>0) summary += `💥 AOE +${totalAOE.toFixed(0)}%　`;
    if(totalExtraProj>0) summary += `🎯 额外弹 +${totalExtraProj}　`;
    if(newSkills.length>0) summary += `✨ 新技能：${newSkills.join('、')}　`;
    if(auraLines.length>0) summary += `<br/>🛡 光环：${auraLines.join(' · ')}`;

    if(summary){
      html += `<div style="margin:10px 10px 4px;padding:8px 12px;
        background:rgba(232,196,90,.06);border:1px solid rgba(232,196,90,.2);
        border-radius:6px;font-size:12px;color:#e8c45a;line-height:1.8">${summary}</div>`;
    }
  }
  body.innerHTML = html;
}

// 应用能力光环效果（每帧调用）
function updateAuras(dt){
  if(!player._auras) return;
  const pp = controls.getObject().position;
  // 荆棘光环：每5秒对周围敌人造成伤害
  if(player._auras.thorns){
    player._thornsTimer = (player._thornsTimer || 0) + dt;
    if(player._thornsTimer >= 5){
      player._thornsTimer = 0;
      const range = 5;
      enemies.forEach(e=>{
        if(e.hp<=0) return;
        if(e.mesh.position.distanceTo(pp) <= range){
          const dmg = player._auras.thorns;
          damageEnemy(e, {dmg, crit:false});
          const wp = e.mesh.position.clone(); wp.y += 2;
          spawnDmgText(wp, dmg, false);
        }
      });
    }
  }
}

// 环绕飞球更新（orbCount 能力）
function updateOrbs(dt){
  const orbCount = (player._skillBuffs && player._skillBuffs.orbCount) || 0;
  if(orbCount <= 0){
    // 没有飞球，清理残留
    if(player._orbs && player._orbs.length > 0){
      player._orbs.forEach(o=>{ if(o.mesh) scene.remove(o.mesh); });
      player._orbs = [];
    }
    return;
  }
  // 初始化飞球
  if(!player._orbs) player._orbs = [];
  const orbColor = 0x5aa6ff;
  const orbRadius = 2.5; // 环绕半径
  // 补齐飞球数量
  while(player._orbs.length < orbCount){
    const idx = player._orbs.length;
    const angle = (idx / orbCount) * Math.PI * 2;
    const geo = new THREE.SphereGeometry(0.18, 12, 12);
    const mat = new THREE.MeshBasicMaterial({color:orbColor, transparent:true, opacity:0.85});
    const mesh = new THREE.Mesh(geo, mat);
    // 光晕
    const glowGeo = new THREE.SphereGeometry(0.32, 8, 8);
    const glowMat = new THREE.MeshBasicMaterial({color:orbColor, transparent:true, opacity:0.25});
    const glow = new THREE.Mesh(glowGeo, glowMat);
    mesh.add(glow);
    scene.add(mesh);
    player._orbs.push({
      mesh, angle, cdTimer: idx*0.4, cdMax: 1.8, // 错开开局射击时间
      target: null
    });
  }
  // 更新飞球位置 + 自动攻击
  const pp = controls.getObject().position;
  player._orbs.forEach((ob, idx)=>{
    // 环绕运动
    ob.angle += dt * 2.5; // 角速度
    const x = pp.x + Math.cos(ob.angle) * orbRadius;
    const z = pp.z + Math.sin(ob.angle) * orbRadius;
    ob.mesh.position.set(x, pp.y + 1.2, z);
    // 脉冲缩放
    const pulse = 1 + Math.sin(performance.now()*0.006 + idx) * 0.15;
    ob.mesh.scale.setScalar(pulse);
    // 冷却计时
    ob.cdTimer -= dt;
    if(ob.cdTimer <= 0){
      // 找最近敌人
      let nearest = null, nearestD = 12;
      enemies.forEach(e=>{
        if(e.hp<=0) return;
        const d = e.mesh.position.distanceTo(ob.mesh.position);
        if(d < nearestD){ nearestD = d; nearest = e; }
      });
      if(nearest && nearestD < 12){
        // 发射飞弹
        const dir = nearest.mesh.position.clone().setY(1.5).sub(ob.mesh.position).normalize();
        shootProjectile({
          origin: ob.mesh.position.clone(),
          dir, color: orbColor, range: 14, speed: 28, scale: 0.12, kind: 'orb',
          hit: e=>{ damageEnemy(e, {dmg:Math.round(8+player.level*1.5), crit:false}); }
        });
        ob.cdTimer = ob.cdMax;
      } else {
        ob.cdTimer = 0.3; // 没目标时快速重试
      }
    }
  });
}

const WEAPON_TYPES={
  sword:{skills:['swing','thrust'],atkSpd:1,base:[6,10]},
  axe:{skills:['swing'],atkSpd:.85,base:[10,16]},
  bow:{skills:['arrow','bolt'],atkSpd:1.2,base:[5,9]},
  staff:{skills:['fireball','iceshard'],atkSpd:1,base:[4,8]},
  wand:{skills:['fireball','chain'],atkSpd:1.2,base:[3,6]},
  orb:{skills:['iceshard','nova'],atkSpd:1.1,base:[3,6]},
};

// ---------- 装备 ----------
const QUALITY=[
  {key:'common',name:'普通',color:'#cccccc',weight:60,affixes:[1,1]},
  {key:'magic', name:'魔法',color:'#5aa6ff',weight:25,affixes:[2,3]},
  {key:'rare',  name:'稀有',color:'#f4e26b',weight:10,affixes:[4,5]},
  {key:'set',   name:'套装',color:'#7bd96a',weight:9, affixes:[5,6]},
  {key:'unique',name:'暗金',color:'#e8c45a',weight:2, affixes:[7,8]},
];

// ---------- 套装 ----------
// pieces: 该套装包含的部位（slot 列表，每个部位生成时若被选中此套装，会强制以该 slot 出现）
// bonuses: 集齐 N 件激活的加成；2/3/4 件叠加（不会替换，已激活的低件数仍生效）
const SET_DB = {
  death:{
    name:'亡者征途',
    color:'#7bd96a',
    pieces:['weapon','helm','armor','ring'],
    bonuses:{
      2:{stats:{str:15,hpMax:60},        desc:'+15 力量, +60 最大生命'},
      3:{stats:{dmgPct:25,critChance:8}, desc:'+25% 伤害, +8% 暴击率'},
      4:{stats:{lifeOnHit:5,critDmg:60}, desc:'命中回复 5 生命, +60% 暴击伤害'},
    }
  },
  arcane:{
    name:'秘法回响',
    color:'#7bd96a',
    pieces:['weapon','helm','armor','ring'],
    bonuses:{
      2:{stats:{int:18,mpMax:40},        desc:'+18 智力, +40 最大法力'},
      3:{stats:{mpRegen:4,dmgPct:20},    desc:'每秒+4 法力, +20% 伤害'},
      4:{stats:{critDmg:80,mpMax:60},    desc:'+80% 暴击伤害, 额外+60 法力上限'},
    }
  },
  hunter:{
    name:'猎风行者',
    color:'#7bd96a',
    pieces:['weapon','helm','armor','ring'],
    bonuses:{
      2:{stats:{dex:18,critChance:6},    desc:'+18 敏捷, +6% 暴击率'},
      3:{stats:{dmgPct:20,critDmg:40},   desc:'+20% 伤害, +40% 暴击伤害'},
      4:{stats:{critChance:12,dmgPct:25},desc:'+12% 暴击率, +25% 伤害'},
    }
  },
};
const SET_KEYS=Object.keys(SET_DB);

const AFFIX_POOL=[
  // 基础属性
  {k:'str',name:'+{v}力量',roll:[2,8]},
  {k:'dex',name:'+{v}敏捷',roll:[2,8]},
  {k:'int',name:'+{v}智力',roll:[2,8]},
  // 资源 / 防御
  {k:'hpMax',name:'+{v}最大生命',roll:[10,40]},
  {k:'mpMax',name:'+{v}最大法力',roll:[5,25]},
  {k:'armor',name:'+{v}护甲',roll:[3,15]},
  // 进攻
  {k:'dmgPct',name:'+{v}%伤害',roll:[5,25]},
  {k:'critChance',name:'+{v}%暴击率',roll:[3,12]},
  {k:'critDmg',name:'+{v}%暴击伤害',roll:[10,50]},
  // 续航
  {k:'lifeOnHit',name:'命中回复{v}生命',roll:[1,4]},
  {k:'hpRegen',name:'每秒+{v}生命',roll:[1,4]},
  {k:'mpRegen',name:'每秒+{v}法力',roll:[1,3]},
  // 新增进阶词条
  {k:'allStats',name:'全属性+{v}',roll:[2,6]},
  {k:'moveSpd',name:'+{v}%移动速度',roll:[3,12]},
  {k:'cdr',name:'+{v}%技能急速',roll:[3,12]},
  {k:'fireDmg',name:'+{v}%火焰伤害',roll:[10,30]},
  {k:'iceDmg',name:'+{v}%冰霜伤害',roll:[10,30]},
  {k:'lightDmg',name:'+{v}%闪电伤害',roll:[10,30]},
  {k:'thorns',name:'反伤{v}伤害',roll:[5,20]},
  {k:'goldFind',name:'+{v}%物品获取',roll:[10,40]},
  {k:'expBonus',name:'+{v}%经验加成',roll:[5,20]},
  // 技能词条（附加额外技能，rare+ 才能出现；roll 用作"等级提示"显示但实际不影响）
  {k:'extraSkill', skill:'fireball', name:'额外技能：🔥 火球',          roll:[1,1], minQuality:'rare'},
  {k:'extraSkill', skill:'iceshard', name:'额外技能：❄ 冰晶',           roll:[1,1], minQuality:'rare'},
  {k:'extraSkill', skill:'arrow',    name:'额外技能：🏹 多重射击',       roll:[1,1], minQuality:'rare'},
  {k:'extraSkill', skill:'bolt',     name:'额外技能：➹ 穿刺箭',         roll:[1,1], minQuality:'rare'},
  {k:'extraSkill', skill:'chain',    name:'额外技能：⚡ 闪电链',         roll:[1,1], minQuality:'set'},
  {k:'extraSkill', skill:'meteor',   name:'额外技能：☄ 陨石',           roll:[1,1], minQuality:'set'},
  {k:'extraSkill', skill:'nova',     name:'额外技能：✦ 新星',           roll:[1,1], minQuality:'unique'},
  // 防御性技能词条
  {k:'extraSkill', skill:'heal',     name:'额外技能：✚ 治疗术',         roll:[1,1], minQuality:'rare'},
  {k:'extraSkill', skill:'barrier',  name:'额外技能：🛡 守护护盾',       roll:[1,1], minQuality:'rare'},
  {k:'extraSkill', skill:'warcry',   name:'额外技能：🪖 铁壁姿态',       roll:[1,1], minQuality:'set'},
];

// ---------- 宝石 ----------
// 5 种宝石 × 3 个等级（粗糙 / 标准 / 完美）
// 宝石作为单独物品（it.isGem = true）；通过镶嵌进装备的孔位生效
const GEM_TYPES = {
  ruby:    {name:'红宝石', icon:'❤', color:'#ff4040', stat:'dmgPct',     base:5,  per:5},   // 5/10/15 % 伤害
  sapphire:{name:'蓝宝石', icon:'💧', color:'#4080ff', stat:'mpMax',     base:15, per:15},  // 15/30/45 法力
  emerald: {name:'绿宝石', icon:'💚', color:'#40d060', stat:'critChance',base:3,  per:3},   // 3/6/9 % 暴击
  topaz:   {name:'黄宝石', icon:'⭐', color:'#f4e26b', stat:'armor',     base:8,  per:8},   // 8/16/24 护甲
  amethyst:{name:'紫宝石', icon:'🟣', color:'#c060ff', stat:'allStats',  base:3,  per:3},   // +3/6/9 全属性
};
const GEM_GRADES = [
  {key:'rough',   name:'粗糙', mul:1, color:'#9a9aaf'},
  {key:'normal',  name:'标准', mul:2, color:'#dddddd'},
  {key:'perfect', name:'完美', mul:3, color:'#fff5b8'},
];
const GEM_TYPE_KEYS = Object.keys(GEM_TYPES);

// 创建一个宝石"物品"（可放进背包）
function makeGem(typeKey, gradeIdx){
  const t = GEM_TYPES[typeKey];
  const g = GEM_GRADES[gradeIdx];
  const v = t.base + t.per*gradeIdx;   // 0:base | 1:base+per | 2:base+2*per
  return {
    isGem: true,
    type: typeKey,
    grade: gradeIdx,
    name: `${g.name}${t.name}`,
    icon: t.icon,
    quality: {key:'gem', color:g.color, name:g.name},
    statKey: t.stat,
    statValue: v,
    label: `+${v}${getGemStatLabel(t.stat)}`,
  };
}
function getGemStatLabel(statKey){
  switch(statKey){
    case 'dmgPct':     return '% 伤害';
    case 'mpMax':      return ' 最大法力';
    case 'critChance': return '% 暴击率';
    case 'armor':      return ' 护甲';
    case 'allStats':   return ' 全属性';
    default: return '';
  }
}
// 随机生成一颗宝石（按等级权重：粗糙最常见、完美罕见）
function rollGem(){
  const r = Math.random();
  const gradeIdx = r<0.65 ? 0 : (r<0.92 ? 1 : 2);
  const typeKey = GEM_TYPE_KEYS[Math.floor(Math.random()*GEM_TYPE_KEYS.length)];
  return makeGem(typeKey, gradeIdx);
}

// ====== 背包扩容卷轴（5 件暗金合成产物）======
// special:'bagExpand' 标识，左键/A 使用 → INV_CAP 永久 +4
function makeBagExpandScroll(){
  return {
    special: 'bagExpand',
    name: '【背包扩容卷轴】',
    icon: '📜',
    quality: { key:'bagExpand', color:'#e8c45a', name:'特殊' },
    expandBy: 4,
  };
}
function useBagExpandScroll(idx){
  const it = player.inv[idx];
  if(!it || it.special!=='bagExpand') return;
  const add = it.expandBy || 4;
  INV_CAP += add;
  player.inv.splice(idx, 1);
  Audio.levelUp && Audio.levelUp();
  toast(`📜 背包扩容！容量 +${add} → ${INV_CAP}`);
  rebuildInv();
}

// ====== 经验书（合成副产物）======
// special:'expTome' 标识，左键/A 使用 → 立即获得 exp 点经验
// 经验量随玩家当前升级所需经验缩放，后期同样有意义
function makeExpTome(exp){
  exp = Math.max(1, Math.floor(exp || 50));
  return {
    special: 'expTome',
    name: '【经验之书】',
    icon: '📖',
    quality: { key:'expTome', color:'#7fd0ff', name:'经验' },
    exp,
  };
}
function useExpTome(idx){
  const it = player.inv[idx];
  if(!it || it.special!=='expTome') return false;
  const gain = it.exp || 50;
  player.inv.splice(idx, 1);
  Audio.levelUp && Audio.levelUp();
  // 经验条短暂高亮 + 增长动画提示
  const expBar = document.getElementById('expbar');
  if(expBar){
    expBar.classList.add('expFlash');
    setTimeout(()=>expBar.classList.remove('expFlash'), 1400);
  }
  // 临时弹出浮动经验条 + 数字滚动动画（无论是否在战斗界面都能看清涨了多少）
  spawnExpGainPopup(gain);
  gainExp(gain);
  toast(`📖 研读经验之书，获得 ${gain} 经验`);
  rebuildInv();
  refreshInfo();
  return true;
}

// 经验书使用时的动画浮窗：屏幕中上居中弹出一条加粗经验条，
// 数字从 0 滚动到 gain，金边脉冲，2.4s 后淡出
function spawnExpGainPopup(gain){
  // 防止快速连续使用导致多个浮窗叠加：先移除旧的
  const old = document.getElementById('expGainPopup');
  if(old) old.remove();

  const wrap = document.createElement('div');
  wrap.id = 'expGainPopup';
  wrap.style.cssText =
    'position:fixed;left:50%;top:22%;transform:translate(-50%,0) scale(.85);z-index:90;pointer-events:none;'+
    'background:rgba(0,0,0,.82);border:2px solid var(--gold);border-radius:8px;padding:14px 24px 16px;'+
    'min-width:260px;max-width:80vw;text-align:center;'+
    'box-shadow:0 0 24px var(--gold),0 0 60px rgba(0,0,0,.6);'+
    'transition:opacity .3s,transform .35s cubic-bezier(.3,1.6,.5,1);opacity:0';

  // 标题
  const title = document.createElement('div');
  title.style.cssText = 'font-size:14px;color:var(--gold);letter-spacing:3px;font-weight:bold;margin-bottom:8px';
  title.textContent = '📖 研读经验之书';
  wrap.appendChild(title);

  // 数字（滚动）
  const numEl = document.createElement('div');
  numEl.style.cssText = 'font-size:26px;color:#fff5b8;font-weight:bold;letter-spacing:2px;margin-bottom:8px;text-shadow:0 0 8px var(--gold)';
  numEl.textContent = '+0 EXP';
  wrap.appendChild(numEl);

  // 经验条（动画填充，从当前进度填到目标进度，跨级时分段处理）
  const barOuter = document.createElement('div');
  barOuter.style.cssText = 'width:100%;height:14px;background:#0c0c0c;border:1px solid #333;border-radius:3px;overflow:hidden;position:relative';
  const barInner = document.createElement('div');
  barInner.style.cssText = 'height:100%;width:0%;background:linear-gradient(90deg,#e8c45a,#fff5b8);box-shadow:0 0 6px #e8c45a inset;transition:width .35s cubic-bezier(.3,1.5,.6,1)';
  barOuter.appendChild(barInner);
  wrap.appendChild(barOuter);

  // 等级提示（升级时切换）
  const lvEl = document.createElement('div');
  lvEl.style.cssText = 'font-size:11px;color:#aaa;letter-spacing:2px;margin-top:6px';
  lvEl.textContent = `Lv.${player.level}　${player.exp}/${player.expNeed}`;
  wrap.appendChild(lvEl);

  document.body.appendChild(wrap);
  // 入场动画
  requestAnimationFrame(()=>{ wrap.style.opacity='1'; wrap.style.transform='translate(-50%,0) scale(1)'; });

  // 起始状态：使用前的等级 / 经验 / 经验需求；终止状态：调用 gainExp 后由外部刷新
  const startLevel = player.level;
  const startExp   = player.exp;
  const startNeed  = player.expNeed;
  // 立即把起点画上
  barInner.style.width = (startExp/startNeed*100) + '%';

  // 数字从 0 滚动到 gain
  const dur = 700;
  const t0 = performance.now();
  function tickNum(){
    const t = Math.min(1, (performance.now()-t0)/dur);
    // easeOutCubic
    const e = 1 - Math.pow(1-t, 3);
    numEl.textContent = `+${Math.round(gain*e)} EXP`;
    if(t<1) requestAnimationFrame(tickNum);
    else numEl.textContent = `+${gain} EXP`;
  }
  requestAnimationFrame(tickNum);

  // 进度条动画：分阶段——先把当前级填满到 100%，若还有剩余就清零再填到下一级位置，重复直到本次 gain 用完
  // 注意：此函数在 gainExp 之前调用，所以这里独立模拟一份本地进度推演（不影响 player）
  let simExp  = startExp;
  let simNeed = startNeed;
  let simLv   = startLevel;
  let leveled = false;
  let remain  = gain;
  let stepDelay = 60; // 入场后稍等再开始动
  function step(){
    if(remain <= 0){
      // 完成：刷新提示信息（同步到玩家最终状态，应已被 gainExp 更新）
      lvEl.textContent = `Lv.${player.level}　${player.exp}/${player.expNeed}`;
      return;
    }
    const room = simNeed - simExp;
    if(remain >= room){
      // 这一级会涨满 → 走到 100% → 升级
      simExp = simNeed;
      remain -= room;
      barInner.style.width = '100%';
      setTimeout(()=>{
        // 升级：重置进度条、Lv+1
        simLv++;
        simExp = 0;
        simNeed = Math.floor(50*Math.pow(1.25, simLv-1));
        leveled = true;
        barInner.style.transition = 'none';
        barInner.style.width = '0%';
        lvEl.textContent = `Lv.${simLv}　0/${simNeed}　★ 升级！`;
        lvEl.style.color = '#ffd76a';
        // 强制 reflow 然后恢复过渡
        void barInner.offsetWidth;
        barInner.style.transition = 'width .35s cubic-bezier(.3,1.5,.6,1)';
        setTimeout(step, 180);
      }, 380);
    } else {
      // 不会涨满：直接补到目标位置
      simExp += remain;
      remain = 0;
      barInner.style.width = (simExp/simNeed*100) + '%';
      setTimeout(()=>{
        lvEl.textContent = `Lv.${simLv}　${simExp}/${simNeed}` + (leveled ? '　★' : '');
        if(leveled) lvEl.style.color = '#ffd76a';
        step();
      }, 380);
    }
  }
  setTimeout(step, stepDelay);

  // 出场
  setTimeout(()=>{ wrap.style.opacity='0'; wrap.style.transform='translate(-50%,-20px) scale(.96)'; }, 2400);
  setTimeout(()=>{ wrap.remove(); }, 2800);
}

// ====== 血瓶 / 蓝瓶 ======
// 两级：普通（tier=0）/ 高级（tier=1）；5 瓶同级合成出高一级
// 红瓶恢复量降低；蓝瓶不动
const POTION_HP_PCT = [0.25, 0.50];   // 普通 25% / 高级 50%
const POTION_MP_PCT = [0.50, 0.85];   // 普通 50% / 高级 85%
function makeHpPotion(tier){
  tier = tier|0;
  if(tier<0)tier=0; if(tier>1)tier=1;
  return {
    special: 'hpPotion',
    tier,
    name: tier>0 ? '高级生命药水' : '生命药水',
    icon: '🧪',
    quality: { key:'potion', color: tier>0?'#ff8aff':'#ff5070', name: tier>0?'高级药水':'药水' },
    healPct: POTION_HP_PCT[tier],
  };
}
function makeMpPotion(tier){
  tier = tier|0;
  if(tier<0)tier=0; if(tier>1)tier=1;
  return {
    special: 'mpPotion',
    tier,
    name: tier>0 ? '高级法力药水' : '法力药水',
    icon: '🧴',
    quality: { key:'potion', color: tier>0?'#a0c8ff':'#5aa6ff', name: tier>0?'高级药水':'药水' },
    manaPct: POTION_MP_PCT[tier],
  };
}
function useHpPotion(idx){
  const it = player.inv[idx];
  if(!it || it.special!=='hpPotion') return false;
  if(player.hp >= player.hpMax){ toast('生命已满'); return false; }
  const heal = Math.floor(player.hpMax * (it.healPct||0.5));
  player.hp = Math.min(player.hpMax, player.hp + heal);
  player.inv.splice(idx, 1);
  Audio.uiOpen && Audio.uiOpen();
  toast(`🧪 喝下生命药水 +${heal}`);
  rebuildInv();
  refreshInfo();
  return true;
}
function useMpPotion(idx){
  const it = player.inv[idx];
  if(!it || it.special!=='mpPotion') return false;
  if(player.mp >= player.mpMax){ toast('法力已满'); return false; }
  const heal = Math.floor(player.mpMax * (it.manaPct||0.5));
  player.mp = Math.min(player.mpMax, player.mp + heal);
  player.inv.splice(idx, 1);
  Audio.uiOpen && Audio.uiOpen();
  toast(`🧴 喝下法力药水 +${heal}`);
  rebuildInv();
  refreshInfo();
  return true;
}
// 快捷键：Q 喝第一瓶红瓶；E 喝第一瓶蓝瓶（silent=true 时无药也不 toast，供托管使用）
function quickDrinkHp(silent){
  for(let i=0;i<player.inv.length;i++){
    if(player.inv[i] && player.inv[i].special==='hpPotion'){
      useHpPotion(i);
      return true;
    }
  }
  if(!silent) toast('背包中没有生命药水');
  return false;
}
function quickDrinkMp(silent){
  for(let i=0;i<player.inv.length;i++){
    if(player.inv[i] && player.inv[i].special==='mpPotion'){
      useMpPotion(i);
      return true;
    }
  }
  if(!silent) toast('背包中没有法力药水');
  return false;
}

const WEAPON_NAMES={sword:['短剑','长剑','圣剑','阔剑','破晓'],axe:['手斧','战斧','双手斧','残月斧','裂地'],bow:['短弓','长弓','复合弓','贯月弓','风之追猎'],staff:['法杖','骨杖','水晶杖','贤者之杖','永恒'],wand:['短杖','符文短杖','黑曜短杖','低语','暮光'],orb:['法球','灵能宝珠','寒冰之球','虚空','奥术']};
const ARMOR_NAMES=['布甲','皮甲','锁甲','板甲','战衣'];
const HELM_NAMES=['布帽','皮盔','铁盔','头骨面具','王冠'];
const RING_NAMES=['铜戒','银戒','金戒','宝石戒','秘银指环'];

function pickQuality(level){
  const w=QUALITY.map(q=>q.weight+(q.key!=='common'?level*.4:-level*.5));
  const total=w.reduce((a,b)=>a+Math.max(0,b),0);
  let r=Math.random()*total;
  for(let i=0;i<QUALITY.length;i++){r-=Math.max(0,w[i]);if(r<=0)return QUALITY[i];}
  return QUALITY[0];
}
// 稀有度等级（用于 minQuality 过滤）
const _QualityRankMap = {common:0, magic:1, rare:2, set:3, unique:4};
function rollAffix(level, usedKeys, qualityKey){
  // 当前装备的稀有度等级；若未传则默认允许所有词条
  const myRank = _QualityRankMap[qualityKey] != null ? _QualityRankMap[qualityKey] : 99;
  // 1) 按 minQuality 过滤：词条声明 minQuality 要求时，只有 ≥ 该等级的装备才能滚到
  let pool = AFFIX_POOL.filter(a=>{
    if(!a.minQuality) return true;
    return myRank >= (_QualityRankMap[a.minQuality] || 0);
  });
  // 2) 排除已用过的词条；技能词条还要避免"加同一个技能两次"
  if(usedKeys && usedKeys.size>0){
    const filtered = pool.filter(a=>{
      // 普通词条：用 k 去重
      if(a.k!=='extraSkill') return !usedKeys.has(a.k);
      // 技能词条：用 'extraSkill:技能名' 去重，允许多个不同技能
      return !usedKeys.has('extraSkill:'+a.skill);
    });
    if(filtered.length>0) pool = filtered;
  }
  if(pool.length===0) pool = AFFIX_POOL;   // 保险
  const a = pool[Math.floor(Math.random()*pool.length)];
  const v = randi(a.roll[0], a.roll[1]) + Math.floor(level*.3);
  const out = {k:a.k, v, label:a.name.replace('{v}',v)};
  if(a.k==='extraSkill') out.skill = a.skill;
  return out;
}
function pickPrefix(){return pick(['锐利的','坚固的','古老的','燃烧的','凛冽的','咆哮的','秘法的','黯影的','炽天的','贪婪的']);}
function pickUniqueName(){return pick(['末日审判','永夜之牙','灰烬之心','龙息','深渊之吻','寂静之刃']);}

function genItem(level,slotForce){
  const slot=slotForce||pick(['weapon','helm','armor','ring']);
  const q=pickQuality(level);
  const item={slot,quality:q,affixes:[],iLvl:level};
  const cnt=randi(q.affixes[0],q.affixes[1]);
  const usedKeys = new Set();
  for(let i=0;i<cnt;i++){
    const af = rollAffix(level, usedKeys, q.key);
    // 技能词条：用 'extraSkill:技能名' 作为去重键，允许同一件出多个不同技能
    usedKeys.add(af.k==='extraSkill' ? ('extraSkill:'+af.skill) : af.k);
    item.affixes.push(af);
  }
  // 套装归属：仅 set 品质有
  if(q.key==='set'){
    item.setKey = pick(SET_KEYS);
  }
  if(slot==='weapon'){
    const wt=pick(Object.keys(WEAPON_TYPES));
    item.wType=wt;
    const base=WEAPON_TYPES[wt].base;
    item.dmgMin=base[0]+Math.floor(level*1.2);
    item.dmgMax=base[1]+Math.floor(level*1.6);
    item.atkSpd=WEAPON_TYPES[wt].atkSpd;
    item.skills=[...WEAPON_TYPES[wt].skills];
    if(q.key==='rare'||q.key==='set')item.skills.push(pick(['nova','meteor','chain']));
    if(q.key==='unique'){item.skills.push('meteor');item.skills.push('chain');}
    item.name=pick(WEAPON_NAMES[wt]);
    if(q.key!=='common')item.name=pickPrefix()+item.name;
    if(q.key==='unique')item.name=pickUniqueName();
    if(q.key==='set')   item.name=SET_DB[item.setKey].name+'·'+item.name;
  } else {
    const pool=slot==='helm'?HELM_NAMES:slot==='armor'?ARMOR_NAMES:RING_NAMES;
    item.name=pick(pool);
    if(q.key!=='common')item.name=pickPrefix()+item.name;
    if(q.key==='set')   item.name=SET_DB[item.setKey].name+'·'+item.name;
    if(slot!=='ring')item.armor=randi(2,6)+Math.floor(level*.8);
  }
  item.icon=slot==='weapon'?(item.wType==='bow'?'🏹':item.wType==='staff'?'🪄':item.wType==='wand'?'🔮':item.wType==='orb'?'🔵':item.wType==='axe'?'🪓':'⚔'):slot==='helm'?'⛑':slot==='armor'?'🛡':'💍';
  // 宝石孔位（按品质递增）：普通 0-1，魔法 1-2，稀有 2-3，套装 2-3，暗金 3
  item.sockets = rollSocketCount(q.key);
  item.gems = new Array(item.sockets).fill(null);
  // 流派标签（warrior / mage / rogue）
  tagItemClass(item);
  return item;
}
// 按品质生成孔数
function rollSocketCount(qualityKey){
  const r = Math.random();
  switch(qualityKey){
    case 'common': return r<0.6 ? 0 : 1;
    case 'magic':  return r<0.5 ? 1 : 2;
    case 'rare':   return r<0.4 ? 2 : 3;
    case 'set':    return r<0.4 ? 2 : 3;
    case 'unique': return 3;
    default: return 0;
  }
}

// ===================== 装备流派 / 职业系统 (ClassTag) =====================
// 给玩家长期目标：集齐 4 件同流派装备 → 触发"流派精通"额外加成。
// 流派靠装备的 wType / 词条特征自动打标，不依赖人工选择。
//   ⚔ warrior 战士   ：剑/斧 主武器、力量词条强、伤害%
//   🔮 mage    法师   ：法杖/法球/魔棒 主武器、智力词条强、元素伤害（火/冰/雷）
//   🗡 rogue   盗贼   ：弓 主武器、敏捷词条强、暴击率/暴伤
const CLASS_DB = {
  warrior: {name:'战士', icon:'⚔', color:'#ff8a5a',
    mastery:'4 件套：力量 +20，护甲 +50，伤害% +15'},
  mage:    {name:'法师', icon:'🔮', color:'#7bb6ff',
    mastery:'4 件套：智力 +20，最大法力 +100，火/冰/雷 +15%'},
  rogue:   {name:'盗贼', icon:'🗡', color:'#7bd96a',
    mastery:'4 件套：敏捷 +20，暴击率 +10%，暴伤 +30%'},
};
const CLASS_KEYS = ['warrior','mage','rogue'];
// 按 wType 给武器分配流派
const WTYPE_CLASS = {
  sword:'warrior', axe:'warrior',
  staff:'mage', wand:'mage', orb:'mage',
  bow:'rogue',
};
// 给一件装备打 classTag（生成完毕 + affixes 已填后调用）
function tagItemClass(item){
  if(!item) return;
  // 武器：用 wType 直接确定
  if(item.slot==='weapon' && item.wType && WTYPE_CLASS[item.wType]){
    item.classTag = WTYPE_CLASS[item.wType];
    return;
  }
  // 其他装备：根据 affixes 倾向判定
  const score = {warrior:0, mage:0, rogue:0};
  (item.affixes||[]).forEach(a=>{
    const k = a.k;
    if(k==='str' || k==='armor' || k==='dmgPct' || k==='lifeOnHit') score.warrior += a.v;
    else if(k==='int' || k==='mpMax' || k==='fireDmg' || k==='iceDmg' || k==='lightDmg' || k==='mpRegen') score.mage += a.v;
    else if(k==='dex' || k==='critChance' || k==='critDmg' || k==='moveSpd' || k==='expBonus') score.rogue += a.v;
  });
  // 套装也可能影响：set 装备倾向于 mastery 偏向
  let best = 'warrior', bestV = -1;
  CLASS_KEYS.forEach(k=>{ if(score[k]>bestV){ bestV = score[k]; best = k; } });
  // 完全无词条时随机给一个，确保每件装备都有 tag
  if(bestV <= 0){
    item.classTag = CLASS_KEYS[Math.floor(Math.random()*CLASS_KEYS.length)];
  } else {
    item.classTag = best;
  }
}

// 统计当前已装备的流派分布；4 件同流派 = 精通激活
function getClassMastery(){
  const count = {warrior:0, mage:0, rogue:0};
  ['weapon','helm','armor','ring'].forEach(s=>{
    const it = player.equip[s];
    if(it && it.classTag && count[it.classTag]!=null) count[it.classTag]++;
  });
  let active = null;
  CLASS_KEYS.forEach(k=>{ if(count[k]>=4) active = k; });
  return {count, active};
}
// 把流派精通加成累加到 stats 上（在 applyEquipStats 中调用）
function applyClassMastery(stats){
  const m = getClassMastery();
  if(!m.active) return;
  if(m.active==='warrior'){
    stats.str = (stats.str||0) + 20;
    stats.armor = (stats.armor||0) + 50;
    stats.dmgPct = (stats.dmgPct||0) + 15;
  } else if(m.active==='mage'){
    stats.int = (stats.int||0) + 20;
    stats.mpMax = (stats.mpMax||0) + 100;
    stats.fireDmg = (stats.fireDmg||0) + 15;
    stats.iceDmg  = (stats.iceDmg||0) + 15;
    stats.lightDmg= (stats.lightDmg||0) + 15;
  } else if(m.active==='rogue'){
    stats.dex = (stats.dex||0) + 20;
    stats.critChance = (stats.critChance||0) + 10;
    stats.critDmg = (stats.critDmg||0) + 30;
  }
}

function applyEquipStats(){
  // 记录变更前的关键属性，用于结束时飘字提示属性变化
  const _prev = (player && player._eq) ? {
    str: player._strTotal||0, dex: player._dexTotal||0, int: player._intTotal||0,
    hpMax: player.hpMax||0, mpMax: player.mpMax||0, armor: player.armor||0,
    dmgPct: (player._eq.dmgPct||0), critChance: (player._eq.critChance||0),
    critDmg: (player._eq.critDmg||0), lifeOnHit: (player._eq.lifeOnHit||0)
  } : null;
  const stats={str:0,dex:0,int:0,hpMax:0,mpMax:0,armor:0,dmgPct:0,critChance:0,critDmg:0,lifeOnHit:0,hpRegen:0,mpRegen:0};
  // 统计已装备的套装件数
  const setCount={};
  ['weapon','helm','armor','ring'].forEach(s=>{
    const it=player.equip[s];if(!it)return;
    if(it.armor)stats.armor+=it.armor;
    it.affixes.forEach(a=>{stats[a.k]=(stats[a.k]||0)+a.v;});
    if(it.setKey){ setCount[it.setKey]=(setCount[it.setKey]||0)+1; }
    // 宝石：把 gems 数组中所有非空宝石的属性也并入 stats
    if(it.gems){
      it.gems.forEach(g=>{
        if(!g) return;
        stats[g.statKey] = (stats[g.statKey]||0) + g.statValue;
      });
    }
  });
  // 套装加成（叠加：达到 2、3、4 件均生效）
  const activeSetBonuses={};
  Object.keys(setCount).forEach(key=>{
    const n=setCount[key], def=SET_DB[key]; if(!def)return;
    activeSetBonuses[key]=[];
    [2,3,4].forEach(req=>{
      if(n>=req && def.bonuses[req]){
        const b=def.bonuses[req].stats;
        Object.keys(b).forEach(k=>{stats[k]=(stats[k]||0)+b[k];});
        activeSetBonuses[key].push(req);
      }
    });
  });
  // 把 allStats 转成同等的 str/dex/int 加成
  if(stats.allStats){
    stats.str = (stats.str||0) + stats.allStats;
    stats.dex = (stats.dex||0) + stats.allStats;
    stats.int = (stats.int||0) + stats.allStats;
  }
  // 流派精通：集齐 4 件同流派 → 额外加成
  if(typeof applyClassMastery==='function') applyClassMastery(stats);
  player._setCount=setCount;
  player._activeSetBonuses=activeSetBonuses;
  player._eq=stats;
  // 能力 statUp 加成（力量/敏捷/智力/HP/暴击等）
  const _abStats = player._abilityStats || {};
  const abStr = _abStats.str||0, abDex = _abStats.dex||0, abInt = _abStats.int||0;
  const abHpMax = _abStats.hpMax||0;
  const abDmgPct = _abStats.dmgPct||0;
  const abCrit = _abStats.critChance||0;
  const abCritDmg = _abStats.critDmg||0;
  player._strTotal = player.str + stats.str + abStr;
  player._dexTotal = player.dex + stats.dex + abDex;
  player._intTotal = player.int + stats.int + abInt;
  player.armor = stats.armor + (_abStats.armor||0);
  // 把能力的百分比加成也写进 _eq，让伤害/暴击公式能读到
  player._eq.dmgPct  = (player._eq.dmgPct||0) + abDmgPct;
  player._eq.critChance = (player._eq.critChance||0) + abCrit;
  player._eq.critDmg = (player._eq.critDmg||0) + abCritDmg;
  const newHpMax=80+player.level*15+player._strTotal*2+stats.hpMax+abHpMax;
  const newMpMax=30+player.level*8+player._intTotal*2+stats.mpMax;
  player.hp=Math.min(player.hp/player.hpMax*newHpMax,newHpMax);
  player.mp=Math.min(player.mp/player.mpMax*newMpMax,newMpMax);
  player.hpMax=newHpMax;player.mpMax=newMpMax;
  player.hpRegen=1+stats.hpRegen+player._strTotal*.05;
  player.mpRegen=2.5+stats.mpRegen+player._intTotal*.08;
  const w=player.equip.weapon;
  player.skills=w?w.skills.map(k=>({key:k,...SKILL_DB[k],cdLeft:0})):[{key:'swing',...SKILL_DB.swing,cdLeft:0}];
  // 装备词条 extraSkill：把额外技能并入 player.skills（去重）
  const haveSkillKeys = new Set(player.skills.map(s=>s.key));
  ['weapon','helm','armor','ring'].forEach(s=>{
    const it = player.equip[s]; if(!it) return;
    it.affixes.forEach(a=>{
      if(a.k==='extraSkill' && a.skill && SKILL_DB[a.skill] && !haveSkillKeys.has(a.skill)){
        player.skills.push({key:a.skill, ...SKILL_DB[a.skill], cdLeft:0});
        haveSkillKeys.add(a.skill);
      }
    });
  });
  // 技能栏无限，不再截断
  if(player.activeSkill>=player.skills.length)player.activeSkill=0;
  refreshSkillBar();refreshInfo();refreshEquip();
  // 重建第一人称手持武器（每次装备/换武器都会调用）
  if(typeof rebuildViewWeapon === 'function') rebuildViewWeapon();
  // 属性变化飘字（仅当不是初始化时）
  if(_prev && typeof spawnStatChangeFloats==='function'){
    spawnStatChangeFloats(_prev, {
      str: player._strTotal||0, dex: player._dexTotal||0, int: player._intTotal||0,
      hpMax: player.hpMax||0, mpMax: player.mpMax||0, armor: player.armor||0,
      dmgPct:(player._eq.dmgPct||0), critChance:(player._eq.critChance||0),
      critDmg:(player._eq.critDmg||0), lifeOnHit:(player._eq.lifeOnHit||0)
    });
  }
}

// ---------- 任务系统 ----------
// 任务结构: { id, name, desc, type, target?, current, max, reward:{exp,quality?,slot?}, done }
// type: 'kill' (杀任意敌人) | 'killType' (杀特定类型 enemy_type) | 'wave' (达到第 N 波)
//     | 'fuse' (合成 N 次) | 'equip' (装备某品质以上的任意物品)
//     | 'pickup' (拾取 N 件物品)
const QUEST_DEFS = [
  // 入门任务
  {id:'k_zombie_5',  name:'清扫腐尸',   desc:'击杀 5 只腐尸',    type:'killType', target:'zombie',  max:5,  reward:{exp:60}},
  {id:'k_skeleton_5',name:'压制射手',   desc:'击杀 5 只骷髅射手', type:'killType', target:'skeleton',max:5,  reward:{exp:80}},
  {id:'k_any_15',    name:'初出茅庐',   desc:'击杀任意 15 只敌人',type:'kill',                       max:15, reward:{exp:120, quality:'magic'}},
  {id:'pickup_3',    name:'拾荒者',     desc:'拾取 3 件装备',     type:'pickup',                     max:3,  reward:{exp:40}},
  {id:'equip_magic', name:'装备升级',   desc:'装备一件魔法品质以上', type:'equip', target:'magic',  max:1,  reward:{exp:80}},

  // 中阶
  {id:'k_ghoul_8',   name:'食尸鬼之灾', desc:'击杀 8 只食尸鬼',   type:'killType', target:'ghoul',   max:8,  reward:{exp:160}},
  {id:'k_imp_8',     name:'恶魔猎人',   desc:'击杀 8 只小恶魔',   type:'killType', target:'imp',     max:8,  reward:{exp:160}},
  {id:'wave_3',      name:'三波试炼',   desc:'抵达第 3 波',       type:'wave',                       max:3,  reward:{exp:200, quality:'rare'}},
  {id:'fuse_1',      name:'合成学徒',   desc:'完成 1 次合成',     type:'fuse',                       max:1,  reward:{exp:120}},
  {id:'k_any_50',    name:'血色荒野',   desc:'累计击杀 50 只敌人',type:'kill',                       max:50, reward:{exp:300, quality:'rare'}},

  // 高阶
  {id:'k_knight_1',  name:'BOSS 狩猎',  desc:'击败 1 只死亡骑士', type:'killType', target:'knight',  max:1,  reward:{exp:500, quality:'set'}},
  {id:'wave_5',      name:'波次战神',   desc:'抵达第 5 波',       type:'wave',                       max:5,  reward:{exp:400, quality:'set'}},
  {id:'fuse_5',      name:'合成大师',   desc:'完成 5 次合成',     type:'fuse',                       max:5,  reward:{exp:400, quality:'rare'}},
  {id:'equip_rare',  name:'稀有荣耀',   desc:'装备一件稀有品质以上', type:'equip', target:'rare',   max:1,  reward:{exp:300}},
  {id:'k_any_200',   name:'破坏神之路',desc:'累计击杀 200 只敌人',type:'kill',                       max:200,reward:{exp:1500, quality:'unique'}},

  // ===== 进阶任务（v0.21+）=====
  {id:'k_zombie_30',  name:'腐尸清道夫',  desc:'累计击杀 30 只腐尸',     type:'killType', target:'zombie',  max:30, reward:{exp:600,  quality:'rare'}},
  {id:'k_skeleton_30',name:'弓的老师',    desc:'累计击杀 30 只骷髅射手', type:'killType', target:'skeleton',max:30, reward:{exp:600,  quality:'rare'}},
  {id:'k_ghoul_30',   name:'食尸鬼克星',  desc:'累计击杀 30 只食尸鬼',   type:'killType', target:'ghoul',   max:30, reward:{exp:700,  quality:'rare'}},
  {id:'k_imp_30',     name:'地狱狩猎',    desc:'累计击杀 30 只小恶魔',   type:'killType', target:'imp',     max:30, reward:{exp:700,  quality:'rare'}},
  {id:'k_knight_3',   name:'死亡骑士终结',desc:'击败 3 只死亡骑士',     type:'killType', target:'knight',  max:3,  reward:{exp:900,  quality:'set'}},
  {id:'k_frost_2',    name:'冰封王座',    desc:'击败 2 只冰霜领主',     type:'killType', target:'frostlord',max:2, reward:{exp:1000, quality:'set'}},
  {id:'k_overlord_3', name:'王者归来',    desc:'击败 3 次远古霸主',     type:'killType', target:'overlord',max:3,  reward:{exp:3000, quality:'unique'}},

  {id:'wave_8',       name:'征途八波',    desc:'抵达第 8 波',           type:'wave', max:8,  reward:{exp:300}},
  {id:'wave_15',      name:'血色试炼',    desc:'抵达第 15 波',          type:'wave', max:15, reward:{exp:800,  quality:'set'}},
  {id:'wave_20',      name:'征服者',      desc:'抵达第 20 波（最终战）',type:'wave', max:20, reward:{exp:1500, quality:'unique'}},

  {id:'fuse_10',      name:'合成宗师',    desc:'完成 10 次合成',        type:'fuse', max:10, reward:{exp:800,  quality:'set'}},
  {id:'fuse_25',      name:'合成传说',    desc:'完成 25 次合成',        type:'fuse', max:25, reward:{exp:1800, quality:'unique'}},

  {id:'pickup_30',    name:'拾荒大师',    desc:'拾取 30 件装备',        type:'pickup',max:30, reward:{exp:600,  quality:'rare'}},
  {id:'pickup_100',   name:'集邮狂人',    desc:'拾取 100 件装备',       type:'pickup',max:100,reward:{exp:1500, quality:'unique'}},

  {id:'equip_set',    name:'套装收藏',    desc:'装备一件套装品质以上',  type:'equip', target:'set',    max:1, reward:{exp:600,  quality:'set'}},
  {id:'equip_unique', name:'传说降临',    desc:'装备一件暗金品质',      type:'equip', target:'unique', max:1, reward:{exp:1200, quality:'unique'}},

  {id:'k_any_500',    name:'血色无尽',    desc:'累计击杀 500 只敌人',   type:'kill', max:500, reward:{exp:3500, quality:'unique'}},
  {id:'k_any_1000',   name:'万千罹难',    desc:'累计击杀 1000 只敌人',  type:'kill', max:1000,reward:{exp:8000, quality:'unique'}},
];
const QualityRank = { common:0, magic:1, rare:2, set:3, unique:4 };

const Quests = {
  active: [],          // 当前激活的任务（最多 3 个）
  completed: new Set(),// 已完成 id
  pool: null,          // 待领取池

  init(){
    this.pool = QUEST_DEFS.map(d=>d.id);
    this.refillActive();
    this.render();
  },

  // 从池子中补满到 3 个活动任务
  refillActive(){
    while(this.active.length < 3 && this.pool.length>0){
      const id = this.pool.shift();
      const def = QUEST_DEFS.find(d=>d.id===id);
      if(!def) continue;
      this.active.push({...def, current:0, done:false});
    }
  },

  // 事件入口：在 player.killCount++ / pickup / fuse / equip 等处调用
  onEvent(eventType, payload){
    let changed = false;
    for(const q of this.active){
      if(q.done) continue;
      let inc = 0;
      if(eventType==='kill' && q.type==='kill'){ inc = 1; }
      else if(eventType==='kill' && q.type==='killType' && payload && payload.enemyType===q.target){ inc = 1; }
      else if(eventType==='pickup' && q.type==='pickup'){ inc = 1; }
      else if(eventType==='wave' && q.type==='wave'){
        // payload.wave 是当前波次
        const w = payload && payload.wave || 0;
        if(w >= q.max){ q.current = q.max; }
      }
      else if(eventType==='fuse' && q.type==='fuse'){ inc = 1; }
      else if(eventType==='equip' && q.type==='equip'){
        // 比较品质等级
        const need = QualityRank[q.target] || 0;
        const got = QualityRank[(payload && payload.qualityKey) || 'common'] || 0;
        if(got >= need){ q.current = q.max; }
      }
      if(inc>0){ q.current = Math.min(q.max, q.current + inc); }
      if(q.current >= q.max && !q.done){
        q.done = true;
        changed = true;
        this._onComplete(q);
      } else if(inc>0 || q.current === q.max){
        changed = true;
      }
    }
    if(changed) this.render();
  },

  _onComplete(q){
    this.completed.add(q.id);
    // 发奖
    const r = q.reward || {};
    if(r.exp){ gainExp(r.exp); }
    if(r.quality){
      // 给一件指定品质的随机部位物品
      const slots = ['weapon','helm','armor','ring'];
      const slot = r.slot || slots[Math.floor(Math.random()*slots.length)];
      const qDef = QUALITY.find(q=>q.key===r.quality);
      if(qDef){
        const it = makeItemAtQuality(slot, Math.max(1,player.level), qDef);
        it.isNew = true;
        if(player.inv.length < INV_CAP){
          player.inv.push(it);
          rebuildInv && rebuildInv();
        } else {
          // 包满 → 丢脚下
          const pp = controls.getObject().position.clone();
          spawnLootFromItem && spawnLootFromItem(it, pp, true);
        }
      }
    }
    // UI 飘字
    const el = document.getElementById('questToast');
    if(el){
      const rewardTxt = `${r.exp?`经验 +${r.exp}`:''}${r.exp&&r.quality?' · ':''}${r.quality?`【${QUALITY.find(q=>q.key===r.quality).name}】物品`:''}`;
      el.innerHTML = `🏆 任务完成<span class="sub">${q.name}<br/>奖励：${rewardTxt}</span>`;
      el.classList.remove('show'); void el.offsetWidth; // 重启动画
      el.classList.add('show');
      setTimeout(()=>el.classList.remove('show'), 2700);
    }
    Audio.levelUp && Audio.levelUp();
    // 完成的任务保留 4 秒后从列表移除并补充新任务
    setTimeout(()=>{
      const idx = this.active.indexOf(q);
      if(idx>=0) this.active.splice(idx,1);
      this.refillActive();
      this.render();
    }, 4000);
  },

  render(){
    const list = document.getElementById('questList');
    const cnt  = document.getElementById('qpCount');
    if(!list) return;
    list.innerHTML='';
    this.active.forEach(q=>{
      const el = document.createElement('div');
      el.className = 'quest' + (q.done?' done':'');
      const pct = Math.min(100, q.current/q.max*100);
      const r = q.reward || {};
      const rewardTxt = [
        r.exp ? `EXP +${r.exp}` : null,
        r.quality ? `【${(QUALITY.find(qq=>qq.key===r.quality)||{}).name||r.quality}】物品` : null
      ].filter(Boolean).join(' · ');
      el.innerHTML = `
        <div class="qn">${q.done?'✓ ':''}${q.name}</div>
        <div class="qd">${q.desc}</div>
        <div class="qbar"><div style="width:${pct}%"></div></div>
        <div class="qprog"><span>${q.current} / ${q.max}</span><span>${q.done?'已完成':''}</span></div>
        <div class="qrew">奖励：${rewardTxt||'—'}</div>
      `;
      list.appendChild(el);
    });
    if(cnt){
      const total = QUEST_DEFS.length;
      cnt.textContent = `${this.completed.size}/${total}`;
    }
  }
};

// ---------- 敌人 ----------
const enemies=[];
// role: melee 近战 / ranged 远程 / hybrid 远近兼有
// atk: 攻击间隔(s)；rng: 攻击距离(m)；prefRng: 远程怪的"理想保持距离"
const ENEMY_TYPES={
  zombie:  {color:0x88b04d, hp:30, dmg:[4,7],   spd:3.0, exp:8,  name:'腐尸',   role:'melee',  atk:1.6, rng:1.8},
  skeleton:{color:0xfff5dc, hp:24, dmg:[6,10],  spd:3.4, exp:12, name:'骷髅射手', role:'ranged', atk:2.0, rng:18, prefRng:12, projColor:0xeaeaea, projType:'arrow'},
  ghoul:   {color:0xb84a30, hp:48, dmg:[7,12],  spd:4.0, exp:18, name:'食尸鬼', role:'melee',  atk:1.0, rng:2.0},
  imp:     {color:0xff5028, hp:22, dmg:[5,9],   spd:4.2, exp:14, name:'小恶魔', role:'ranged', atk:1.3, rng:14, prefRng:9,  projColor:0xff6020, projType:'fireball'},
  knight:  {color:0x4a3a8a, hp:90, dmg:[14,22], spd:3.0, exp:30, name:'死亡骑士', role:'melee',  atk:2.2, rng:2.4},
  // 中期 BOSS：冰霜领主（每 5 波之一，与死亡骑士交替）
  frostlord:{color:0x6abfff, hp:120, dmg:[16,26], spd:2.6, exp:50, name:'冰霜领主', role:'melee', atk:2.0, rng:2.6},
  // 最终 BOSS：远古霸主（用 knight 模型 + 巨大化 + 暗红光）
  overlord:{color:0x8a0e0e, hp:180, dmg:[28,42], spd:2.6, exp:200, name:'远古霸主', role:'melee', atk:1.8, rng:3.2},
};
// 散兵/怪群只会用普通敌人；BOSS 类型 (knight/frostlord/overlord) 仅在波次/最终战时单独 spawn
const TYPE_KEYS = Object.keys(ENEMY_TYPES).filter(k=>k!=='knight' && k!=='frostlord' && k!=='overlord');

// 加权随机选敌人类型：远程类（skeleton/imp）权重低，避免成群远程刷屏
function pickEnemyType(){
  // 近战 zombie/ghoul 权重 4；远程 skeleton/imp 权重 1
  const weights = {
    zombie: 4, ghoul: 4,
    skeleton: 1, imp: 1,
  };
  const total = TYPE_KEYS.reduce((s,k)=>s+(weights[k]||1), 0);
  let r = Math.random()*total;
  for(const k of TYPE_KEYS){
    r -= (weights[k]||1);
    if(r<=0) return k;
  }
  return TYPE_KEYS[0];
}

// 敌人投射物（敌→我）
const eProjectiles=[];
// 性能保护：同屏敌方投射物硬上限，超过时丢弃最旧的（高波次远程怪密集 + 火法师 nova 等极端场景兜底）
const E_PROJ_HARD_LIMIT = 80;
function spawnEnemyProjectile(from,to,kind,dmg,color){
  // 超过硬上限：先释放最早的一发，避免性能雪崩
  if(eProjectiles.length >= E_PROJ_HARD_LIMIT){
    const old = eProjectiles.shift();
    if(old && old.mesh) releaseProj(old.mesh);
  }
  const origin=from.clone(); origin.y=1.5;
  const target=to.clone();   target.y=1.5;
  const dir=target.sub(origin).normalize();
  const m=acquireProj(.22,color,5);
  m.position.copy(origin);
  // 弹道速度调慢，给玩家更充足的躲避反应时间（箭 28→17、火球/其它 18→11）
  eProjectiles.push({mesh:m,dir,speed:kind==='arrow'?17:11,life:3.6,traveled:0,range:30,dmg,kind,color});
}



// makeEnemyMesh 使用 toonMat（已在文件前面定义）

// 性能优化①：每种怪物只构建一次模型，之后用 clone() 复用。
// THREE 的 Object3D.clone() 会共享 geometry / material 引用（不深拷贝），
// 因此既省内存又省 GPU 上传；死亡时只 scene.remove 不 dispose，故共享资源安全。
const _enemyMeshCache = {};
function makeEnemyMesh(type){
  if(type==='overlord') type='knight';
  if(!_enemyMeshCache[type]) _enemyMeshCache[type] = buildEnemyMesh(type);
  return _enemyMeshCache[type].clone();
}
// 给敌人主体（children[0]）着色时，先克隆其共享材质，避免 tint 扩散到同种怪的其它实例
function tintEnemyBody(mesh, colorHex, intensity){
  const m0 = mesh.children[0];
  if(!m0 || !m0.material) return;
  if(!m0.userData._tintCloned){ m0.material = m0.material.clone(); m0.userData._tintCloned = true; }
  m0.material.emissive = new THREE.Color(colorHex);
  m0.material.emissiveIntensity = intensity;
}

function buildEnemyMesh(type){
  // overlord 使用 knight 的模型（颜色/缩放在 spawnEnemy 后单独处理）
  if(type==='overlord') type = 'knight';
  // frostlord 有自己的模型（在下面单独构建）
  const def=ENEMY_TYPES[type];
  const g=new THREE.Group();

  // ===== 仅骷髅射手用 low poly + toon 风格作示范 =====
  if(type==='skeleton'){
    // 配色：饱和象牙白 + 暗骨色
    const boneLight = toonMat(0xfff5dc);
    const boneDark  = toonMat(0xc8b89a);
    const wood      = toonMat(0x6a4530);
    const cloth     = toonMat(0x6a3a3a); // 破布裹布

    // 躯干：六棱柱 + Flat Shading 感（Toon 自带硬阴影分界）
    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.34, 1.0, 6),
      boneLight
    );
    torso.position.y = 1.0; torso.castShadow = true; g.add(torso);

    // 肋骨：3 圈半 Torus（八面体扁平）
    for(let i=0;i<3;i++){
      const rib = new THREE.Mesh(
        new THREE.TorusGeometry(0.32, 0.05, 4, 6, Math.PI),
        boneLight
      );
      rib.position.y = 0.78 + i*0.18;
      rib.rotation.x = Math.PI/2;
      g.add(rib);
    }

    // 腰带（破布）
    const belt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.30, 0.30, 0.18, 6),
      cloth
    );
    belt.position.y = 0.55; g.add(belt);

    // 头骨：Icosahedron(20 面) —— 标志性 low poly 形状
    const skull = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.32, 0),
      boneLight
    );
    skull.position.y = 1.85;
    skull.scale.set(0.95, 1.0, 1.05);
    skull.castShadow = true;
    g.add(skull);

    // 下颌（八面体）
    const jaw = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.18, 0),
      boneDark
    );
    jaw.position.set(0, 1.62, 0.1);
    jaw.scale.set(1.4, 0.5, 1.0);
    g.add(jaw);

    // 眼窝（黑洞 + 红光）
    const sockets = toonMat(0x080808);
    [-0.10, 0.10].forEach(x=>{
      const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07,0), sockets);
      s.position.set(x, 1.92, 0.27);
      g.add(s);
      // 红色发光眼珠（用 Basic 不被光照影响，呈现明亮的发光感）
      const eye = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.045, 0),
        new THREE.MeshBasicMaterial({color: 0xff3030})
      );
      eye.position.set(x, 1.92, 0.31);
      g.add(eye);
    });

    // 双臂（八棱柱粗短）
    [-1, 1].forEach(s=>{
      const upperArm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.08, 0.5, 5),
        boneLight
      );
      upperArm.position.set(s*0.36, 1.25, 0);
      upperArm.rotation.z = s*0.25;
      g.add(upperArm);

      const lowerArm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.07, 0.5, 5),
        boneLight
      );
      lowerArm.position.set(s*0.5, 0.85, 0.1);
      lowerArm.rotation.x = -Math.PI/4;
      g.add(lowerArm);
    });

    // 双腿
    [-1, 1].forEach(s=>{
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.07, 0.7, 5),
        boneLight
      );
      leg.position.set(s*0.12, 0.15, 0);
      g.add(leg);
    });

    // 弓：竖直立在左手前方
    // TorusGeometry 默认在 XY 平面，半环（arc=PI）的弧从 (R,0) → (0,R) → (-R,0)
    // 想要：弧的两端朝上和下（沿 Y），凸面朝前（+Z）
    // 步骤：先绕 Z 转 -90°，让弧变成 (0,-R)→(R,0)→(0,R) （仍在 XY 平面，弧凸朝 +X）
    //       再绕 Y 转 -90°，让 +X 转到 +Z（凸面朝前）
    const bowHand = new THREE.Vector3(-0.55, 0.95, 0.35); // 左手位置（前伸）
    const bowGroup = new THREE.Group();
    bowGroup.position.copy(bowHand);
    g.add(bowGroup);

    const bow = new THREE.Mesh(
      new THREE.TorusGeometry(0.40, 0.045, 5, 12, Math.PI),
      wood
    );
    bow.rotation.z = -Math.PI/2;
    bow.rotation.y = -Math.PI/2;
    bowGroup.add(bow);

    // 弓弦：弧的两端连一根竖直 Cylinder（弓上端 y=+0.40 到下端 y=-0.40）
    const string = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.80, 3),
      toonMat(0xeeeeee)
    );
    bowGroup.add(string); // 默认沿 Y 轴 = 竖直，刚好对应弦
    g.add(string);

    return g;
  }

  // ===== 腐尸 zombie =====
  if(type==='zombie'){
    const skin    = toonMat(def.color);
    const skinDk  = toonMat(0x5a7a32);
    const cloth   = toonMat(0x4a2a20);  // 烂衣服
    const eyeMat  = new THREE.MeshBasicMaterial({color:0xffeb3b}); // 黄色腐眼

    // 躯干（歪斜的胖椭球）
    const torso = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5,0), skin);
    torso.position.set(0.05, 1.05, 0); torso.scale.set(1.0, 1.3, 0.85);
    torso.rotation.z = 0.12; torso.castShadow=true; g.add(torso);

    // 烂衣服（覆盖在躯干下半）
    const clothPiece = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42,0.46,0.5,6), cloth);
    clothPiece.position.y = 0.5; g.add(clothPiece);

    // 大头（八面体拉胖）
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.40,0), skinDk);
    head.position.set(0.05, 1.85, 0); head.scale.set(1.05,1.0,1.0);
    head.castShadow=true; g.add(head);

    // 眼睛（黄色发光）
    [[.18,1.95,.34],[-.04,1.92,.36]].forEach(p=>{
      const e=new THREE.Mesh(new THREE.IcosahedronGeometry(0.05,0), eyeMat);
      e.position.set(...p); g.add(e);
    });

    // 双臂前伸（典型僵尸姿态）
    [-1, 1].forEach(s=>{
      const upperArm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.10,0.12,0.5,5), skin);
      upperArm.position.set(s*0.50, 1.30, 0.25);
      upperArm.rotation.x = -Math.PI/3;
      g.add(upperArm);

      const lowerArm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08,0.10,0.5,5), skin);
      lowerArm.position.set(s*0.55, 0.95, 0.55);
      lowerArm.rotation.x = -Math.PI/2.2;
      g.add(lowerArm);

      // 爪子（黑色八面体）
      const claw = new THREE.Mesh(new THREE.OctahedronGeometry(0.10,0), toonMat(0x1a1a1a));
      claw.position.set(s*0.55, 0.78, 0.78);
      claw.scale.set(0.8,1.4,0.8);
      g.add(claw);
    });

    // 腿
    [-1, 1].forEach(s=>{
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.13,0.10,0.6,5), skin);
      leg.position.set(s*0.15, 0.20, 0); g.add(leg);
    });
    return g;
  }

  // ===== 食尸鬼 ghoul =====
  if(type==='ghoul'){
    const fur     = toonMat(def.color);
    const furDk   = toonMat(0x7a2818);
    const tooth   = toonMat(0xfff5d0);
    const eyeMat  = new THREE.MeshBasicMaterial({color:0xff8030});

    // 弓背圆球身体（八面体拉扁）
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.65,0), fur);
    body.position.y = 1.0; body.scale.set(1.1, 0.85, 1.1);
    body.castShadow=true; g.add(body);

    // 背上的鬃毛（多个尖锥）
    for(let i=0;i<5;i++){
      const spike = new THREE.Mesh(
        new THREE.ConeGeometry(0.08, 0.25, 4), furDk);
      spike.position.set(rand(-0.3,0.3), 1.5+rand(0,0.1), rand(-0.3,0));
      spike.rotation.z = rand(-0.3,0.3);
      g.add(spike);
    }

    // 突出向前的头（八面体）
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.36,0), fur);
    head.position.set(0.05, 1.55, 0.4); head.scale.set(1.0,0.85,1.2);
    head.castShadow=true; g.add(head);

    // 大嘴（深色八面体凹陷）
    const mouth = new THREE.Mesh(new THREE.IcosahedronGeometry(0.20,0), toonMat(0x100808));
    mouth.position.set(0.05, 1.45, 0.65); mouth.scale.set(1.2,0.5,0.5);
    g.add(mouth);

    // 4 颗獠牙（圆锥）
    [[0.10,1.50,0.78],[-0.05,1.50,0.79],[0.18,1.42,0.73],[-0.15,1.42,0.73]].forEach(p=>{
      const t = new THREE.Mesh(new THREE.ConeGeometry(0.05,0.18,4), tooth);
      t.position.set(...p);
      if(p[1]<1.45) t.rotation.x = Math.PI; // 上下分别
      g.add(t);
    });

    // 凸出的大眼（橙色）
    [[0.18,1.72,0.55],[-0.08,1.72,0.55]].forEach(p=>{
      const e = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07,0), eyeMat);
      e.position.set(...p); g.add(e);
    });

    // 短腿
    [-1,1].forEach(s=>{
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16,0.12,0.5,5), fur);
      leg.position.set(s*0.22, 0.25, 0); g.add(leg);
    });

    // 长前爪（双臂）
    [-1,1].forEach(s=>{
      const arm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.13,0.10,0.7,5), fur);
      arm.position.set(s*0.65, 0.85, 0.15);
      arm.rotation.x = -Math.PI/4;
      g.add(arm);
      // 爪子
      const claw = new THREE.Mesh(new THREE.OctahedronGeometry(0.14,0), toonMat(0x1a0808));
      claw.position.set(s*0.78, 0.55, 0.55);
      claw.scale.set(0.8, 1.5, 0.8);
      g.add(claw);
    });

    return g;
  }

  // ===== 小恶魔 imp =====
  if(type==='imp'){
    const skin    = toonMat(def.color);
    const skinDk  = toonMat(0xa83018);
    const horn    = toonMat(0x1a0808);
    const wing    = toonMat(0x2a0808);
    const eyeMat  = new THREE.MeshBasicMaterial({color:0xfff066});

    // 小圆身（飘浮在 1.2m 高，因为有翅膀）
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.40,0), skin);
    body.position.y = 1.2; body.scale.set(1.0,1.1,1.0);
    body.castShadow=true; g.add(body);

    // 头（更小的八面体）
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32,0), skinDk);
    head.position.y = 1.75; head.scale.set(1.05,0.9,1.0);
    g.add(head);

    // 头顶两只角（圆锥）
    [-1,1].forEach(s=>{
      const h = new THREE.Mesh(new THREE.ConeGeometry(0.07,0.30,5), horn);
      h.position.set(s*0.16, 2.05, -0.05);
      h.rotation.z = s*0.4;
      g.add(h);
    });

    // 耳朵（横向锥）
    [-1,1].forEach(s=>{
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06,0.20,4), skinDk);
      ear.position.set(s*0.30, 1.78, 0);
      ear.rotation.z = s*Math.PI/2.5;
      g.add(ear);
    });

    // 黄色发光眼睛
    [[.10,1.78,0.27],[-.10,1.78,0.27]].forEach(p=>{
      const e = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05,0), eyeMat);
      e.position.set(...p); g.add(e);
    });

    // 翅膀（两片三角形 PlaneGeometry，但用 ShapeGeometry 也行；这里用变形 Plane）
    // 用 Cone 拍扁来做尖头蝙蝠翅膀
    [-1,1].forEach(s=>{
      const w = new THREE.Mesh(
        new THREE.ConeGeometry(0.45, 0.7, 3),
        wing
      );
      w.position.set(s*0.45, 1.3, -0.25);
      w.rotation.z = s*Math.PI/2;
      w.scale.set(1, 1, 0.05);  // 拍扁
      w.material.side = THREE.DoubleSide;
      g.add(w);
    });

    // 尾巴（向后下方的细圆锥）
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.06,0.5,4), skin);
    tail.position.set(0, 1.0, -0.4);
    tail.rotation.x = Math.PI/2.2;
    g.add(tail);

    // 自身火光
    const fire = new THREE.PointLight(0xff5020, 0.9, 4);
    fire.position.y = 1.2; g.add(fire);

    return g;
  }

  // ===== 死亡骑士 knight =====
  if(type==='knight'){
    const armor   = toonMat(def.color);
    const armorDk = toonMat(0x2a1f4a);
    const metal   = toonMat(0x707080); // 金属装饰
    const blood   = toonMat(0x6a0a0a); // 血色披风
    const eyeMat  = new THREE.MeshBasicMaterial({color:0xff2020});

    // 高大躯干（六棱柱）
    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(0.50, 0.42, 1.4, 6), armor);
    torso.position.y = 1.05; torso.castShadow=true; g.add(torso);

    // 胸甲贴片（暗色八面体）
    const breast = new THREE.Mesh(new THREE.IcosahedronGeometry(0.30,0), armorDk);
    breast.position.set(0, 1.30, 0.42); breast.scale.set(1.4,1.0,0.5);
    g.add(breast);

    // 肩甲（八面体）
    [-1,1].forEach(s=>{
      const sh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32,0), armorDk);
      sh.position.set(s*0.55, 1.65, 0); sh.scale.set(1.0,0.85,1.0);
      g.add(sh);
      // 肩甲上的尖刺
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07,0.20,4), metal);
      spike.position.set(s*0.55, 1.85, 0); g.add(spike);
    });

    // 头盔（圆顶六棱锥）
    const helm = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.55, 6), armorDk);
    helm.position.y = 2.05; g.add(helm);

    // 面甲缝隙
    const slit = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.06, 0.05),
      toonMat(0x000000)
    );
    slit.position.set(0, 1.95, 0.32); g.add(slit);

    // 头盔角（两根弯角）
    [-1,1].forEach(s=>{
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.06,0.30,4), metal);
      horn.position.set(s*0.18, 2.30, -0.05);
      horn.rotation.z = s*0.6;
      g.add(horn);
    });

    // 红色发光眼
    [-0.13, 0.13].forEach(x=>{
      const e = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05,0), eyeMat);
      e.position.set(x, 1.95, 0.36); g.add(e);
    });

    // 腿
    [-1,1].forEach(s=>{
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18,0.14,0.7,6), armor);
      leg.position.set(s*0.20, 0.20, 0); g.add(leg);
    });

    // 披风（背后的红色斜面）
    const cape = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.55, 1.3, 6, 1, false, 0, Math.PI),
      blood
    );
    cape.position.set(0, 1.0, -0.1);
    cape.rotation.y = Math.PI;  // 把开口转到正前方，背后是闭合的半圆柱
    g.add(cape);

    // ===== 右臂：从右肩伸出，握剑（用一个 Group 把整条剑挂在手上）=====
    // 右肩位置约 (0.55, 1.65, 0)，让上臂沿身体下垂、前臂向前下方伸出
    // 上臂
    const upperArm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.13, 0.55, 6), armor);
    upperArm.position.set(0.62, 1.40, 0.05);
    upperArm.rotation.x = 0.2;
    g.add(upperArm);

    // 前臂（往前下方伸）
    const lowerArm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.13, 0.5, 6), armor);
    lowerArm.position.set(0.66, 1.10, 0.32);
    lowerArm.rotation.x = -Math.PI/2.6;
    g.add(lowerArm);

    // 拳头（八面体，更醒目）
    const handPos = new THREE.Vector3(0.66, 0.95, 0.55);
    const fist = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), armorDk);
    fist.position.copy(handPos);
    g.add(fist);

    // ===== 剑（挂在 hand 上的 Group） =====
    // 剑组：以护手中心为原点，向上为剑刃方向，向下为剑柄
    const swordGrp = new THREE.Group();
    swordGrp.position.copy(handPos);
    // 让剑稍微向前倾斜（更英姿）
    swordGrp.rotation.x = -0.1;
    g.add(swordGrp);

    // 剑柄（在 -Y 方向）
    const grip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.22, 6), toonMat(0x3a1a10));
    grip.position.y = -0.05;       // 把剑柄底部正好藏在拳头里
    swordGrp.add(grip);

    // 剑首（柄末端的圆球）
    const pommel = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 0), metal);
    pommel.position.y = -0.18;
    swordGrp.add(pommel);

    // 护手（横向 Box）
    const guard = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.07, 0.08), metal);
    guard.position.y = 0.06;
    swordGrp.add(guard);

    // 剑刃（从护手往上）
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 1.4, 0.04), metal);
    blade.position.y = 0.78;
    swordGrp.add(blade);

    // 剑刃中线凹槽（深色 Box，让剑看起来更立体）
    const fuller = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 1.1, 0.045), toonMat(0x4a4a55));
    fuller.position.y = 0.78;
    swordGrp.add(fuller);

    // 剑尖（圆锥）
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.25, 4), metal);
    tip.position.y = 1.60;
    swordGrp.add(tip);

    return g;
  }

  // ===== 冰霜领主 frostlord（专属模型） =====
  if(type==='frostlord'){
    const ice     = toonMat(0x6abfff);   // 冰蓝
    const iceDk   = toonMat(0x2a4a7a);   // 深蓝
    const crystal = toonMat(0xaee0ff);   // 浅冰晶
    const eyeMat  = new THREE.MeshBasicMaterial({color:0xfff5b8});
    const glow    = new THREE.MeshBasicMaterial({color:0x9be0ff, transparent:true, opacity:0.55});

    // 高大躯干（冰柱）
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.45, 1.5, 8), ice);
    torso.position.y = 1.10; torso.castShadow=true; g.add(torso);

    // 胸前冰晶簇
    [[0,1.35,0.45,0.18],[-0.22,1.20,0.40,0.13],[0.22,1.20,0.40,0.13]].forEach(p=>{
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(p[3],0), crystal);
      c.position.set(p[0],p[1],p[2]); g.add(c);
    });

    // 肩部冰刺（突出的尖刺）
    [-1,1].forEach(s=>{
      // 肩甲（深冰蓝）
      const sh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34,0), iceDk);
      sh.position.set(s*0.58, 1.70, 0); sh.scale.set(1.0, 0.85, 1.0);
      g.add(sh);
      // 三根冰刺向外
      [-0.25,0,0.25].forEach(off=>{
        const sp = new THREE.Mesh(new THREE.ConeGeometry(0.10, 0.35, 4), crystal);
        sp.position.set(s*(0.65+Math.abs(off)*0.1), 1.85, off*0.3);
        sp.rotation.z = s*0.6;
        sp.rotation.x = -0.3;
        g.add(sp);
      });
    });

    // 头部（冰晶冠）
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.36,0), ice);
    head.position.y = 2.10; g.add(head);

    // 头顶冰冠（5 根尖刺）
    for(let i=0;i<5;i++){
      const a = (i-2) * 0.35;
      const crown = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.40 - Math.abs(i-2)*0.05, 4), crystal);
      crown.position.set(Math.sin(a)*0.20, 2.50, -Math.cos(a)*0.20);
      crown.rotation.z = -Math.sin(a)*0.4;
      g.add(crown);
    }

    // 发光眼（双圆）
    [-0.12,0.12].forEach(x=>{
      const e = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06,0), eyeMat);
      e.position.set(x, 2.10, 0.32); g.add(e);
    });

    // 飘浮冰晶光环（围绕头顶 3 颗）
    for(let i=0;i<3;i++){
      const a = i*Math.PI*2/3;
      const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.10, 0), crystal);
      orb.position.set(Math.cos(a)*0.55, 2.30, Math.sin(a)*0.55);
      g.add(orb);
    }

    // 腿
    [-1,1].forEach(s=>{
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.20,0.16,0.75,6), ice);
      leg.position.set(s*0.22, 0.22, 0); g.add(leg);
    });

    // 拖在身后的冰甲披风（深蓝半圆柱）
    const cape = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.60, 1.4, 6, 1, false, 0, Math.PI),
      iceDk
    );
    cape.position.set(0, 1.05, -0.1);
    cape.rotation.y = Math.PI;
    g.add(cape);

    // 武器：冰霜法杖（左手）
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.04,1.6,6), iceDk);
    staff.position.set(-0.62, 1.40, 0.10);
    staff.rotation.z = 0.15;
    g.add(staff);
    // 杖顶大冰晶
    const staffTop = new THREE.Mesh(new THREE.OctahedronGeometry(0.20, 0), crystal);
    staffTop.position.set(-0.85, 2.20, 0.18);
    g.add(staffTop);
    // 杖顶光晕
    const halo = new THREE.Mesh(new THREE.IcosahedronGeometry(0.30,0), glow);
    halo.position.copy(staffTop.position);
    g.add(halo);

    return g;
  }

  // ===== fallback（理论上不会到这里） =====
  const body=new THREE.Mesh(new THREE.CapsuleGeometry(.45,1,4,8),new THREE.MeshStandardMaterial({color:def.color,roughness:.8}));
  body.position.y=1;body.castShadow=true;g.add(body);
  return g;
}

function makeHpBarTex(ratio,color){
  const c=document.createElement('canvas');c.width=128;c.height=10;
  const ctx=c.getContext('2d');
  ctx.fillStyle='rgba(0,0,0,.7)';ctx.fillRect(0,0,128,10);
  ctx.fillStyle=color;ctx.fillRect(1,1,126*ratio,8);
  ctx.strokeStyle='#000';ctx.strokeRect(0,0,128,10);
  const t=new THREE.CanvasTexture(c);t.needsUpdate=true;return t;
}

function spawnEnemy(type,level,pos,isElite=false,isBoss=false){
  const def=ENEMY_TYPES[type];
  const mesh=makeEnemyMesh(type);
  mesh.position.copy(pos);scene.add(mesh);
  // 数值成长曲线：前5波线性慢增长，5波后指数加快，避免前期压力过大
  const hpScale  = 1 + level*0.20 + Math.max(0,level-5)*level*0.018;
  const dmgScale = 1 + level*0.10 + Math.max(0,level-5)*level*0.006;
  // 难度加成：每提升 1 难度，HP/伤害额外 ×1.5
  const diffMul = 1 + (difficulty-1)*0.35;
  const hpMax=Math.floor(def.hp * hpScale * diffMul * (isElite?2.5:1) * (isBoss?12:1));
  const e={
    type,def,mesh,hpMax,hp:hpMax,level,isElite,isBoss,
    // 伤害倍率：基础值 + 等级成长 + 精英/BOSS 额外加成 + 难度倍率
    dmgBuff:dmgScale*diffMul*(isElite?1.5:1)*(isBoss?1.4:1),
    spd:def.spd*(1+level*0.020)*(isElite?.95:1)*(isBoss?.85:1),
    atkCd: rand(0, def.atk||1.2),  // 错峰开火，避免开局集体放技能
    slow:0,
    knockback:new THREE.Vector3(),
    // AI 状态
    state:'wander',                 // wander / chase / attack / kite / charge / cast
    wanderTarget:null,
    wanderTimer:0,
    aggro:25,                       // 视野
    leash:40,                       // 仇恨脱离距离
    spawnedAt: performance.now(),   // 出生时间，用于"逾期未清"暴怒机制
    enraged: false,                  // true: 无视距离主动追击玩家
    // BOSS 专属
    chargeCd: isBoss?4:0,
    quakeCd:  isBoss?7:0,
    chargeData:null,                // {dir, time}
    name:(isBoss?'【BOSS】':isElite?'【精英】':'')+def.name
  };
  if(isElite){tintEnemyBody(mesh,0x6a3aff,.6);}
  if(isBoss){mesh.scale.setScalar(1.8);tintEnemyBody(mesh,0xff2020,.8);}
  const hpBar=new THREE.Sprite(new THREE.SpriteMaterial({map:makeHpBarTex(1,isBoss?'#ff3030':isElite?'#c08aff':'#ff7070'),depthTest:false,transparent:true}));
  hpBar.scale.set(isBoss?3:2,isBoss?0.04:.18,1);hpBar.position.y=isBoss?3.5:2.7;mesh.add(hpBar);e.hpBar=hpBar;
  // BOSS 始终显示血条；普通敌人/精英默认隐藏，受伤后才显示
  e.hpBarVisibleTimer = 0;       // >0 时显示；每帧递减到 0 后隐藏
  if(!isBoss){
    hpBar.material.opacity = 0;
    hpBar.visible = false;
  }
  enemies.push(e);return e;
}
function updateHpBar(e){
  const r=Math.max(0,e.hp/e.hpMax);
  e.hpBar.material.map.dispose();
  e.hpBar.material.map=makeHpBarTex(r,e.isBoss?'#ff3030':e.isElite?'#c08aff':'#ff7070');
  e.hpBar.material.needsUpdate=true;
  // 非 BOSS：受伤即显示血条 4 秒
  if(!e.isBoss){
    e.hpBar.visible = true;
    e.hpBar.material.opacity = 1;
    e.hpBarVisibleTimer = 4;
  }
}

let waveLevel=1;
// 难度等级（每次"提升难度重玩"+1；敌人 HP/伤害额外 ×(1 + (difficulty-1)*0.5)）
let difficulty = 1;
// 最终 BOSS 出现波次
const FINAL_BOSS_WAVE = 20;
// 是否已经在本难度战胜过最终 BOSS（避免反复弹胜利面板）
let _victoryDone = false;
// 最终 BOSS 是否已刷出（确保只刷一次，且到达终波后不再补刷散兵）
let _finalBossSpawned = false;
// 累计通关次数（每击败一次最终 BOSS +1，重玩不清零）
let _clearCount = 0;
// 玩家在胜利面板选了"继续游戏" → 解除"通关后停止刷怪"的限制
let _continueAfterVictory = false;

// ===== 波次结算系统（方案1）=====
let _waveActive = false;          // 当前波次是否在进行中
let _waveStats = {                // 本波统计数据
  killCount: 0,                   // 本波击杀数（相对值，每波重置）
  killTotalStart: 0,              // 本波开始时的累计击杀数
  damageTaken: 0,                 // 本波承受总伤害
  maxHitSrc: null,                // 本波最大单次承伤来源 {type, dmg}
  maxHitDmg: 0,
  startTime: 0,                   // 本波开始时间戳
  waveLevel: 0,                    // 本波波次数
};
let _pendingWaveFn = null;         // 待执行的下一波回调（玩家点击继续后调用）
let _lastWaveResult = null;        // 上一波的结算结果（用于显示）

// 显示波次结算面板
function showWaveResultPanel(){
  const st = _lastWaveResult;
  if(!st) return;
  const panel = document.getElementById('waveResultPanel');
  const head  = document.getElementById('wresHead');
  const body  = document.getElementById('wresBody');
  const evalEl = document.getElementById('wresEval');

  // 评价等级
  let evalText = '', evalColor = '';
  const diedThisWave = (st.deaths || 0) > 0;
  if(diedThisWave || st.danger){
    evalText = diedThisWave ? `💀 死亡 ${st.deaths} 次` : '⚠ 危险！'; evalColor = '#ff5050';
  } else if(st.time < 30){
    evalText = '⚡ 速通！'; evalColor = '#ffeb3b';
  } else if(st.damage < player.hpMax * 0.2){
    evalText = '🛡 无伤通关'; evalColor = '#7bd96a';
  } else {
    evalText = '⚔ 顺利通关'; evalColor = '#e8c45a';
  }

  head.textContent = `第 ${st.wave} 波 · 战绩结算`;

  let html = '';
  html += `<div style="display:flex;justify-content:space-between;margin-bottom:8px">
    <span>⚔ 击杀</span><b style="color:#fff">${st.kills} 只</b></div>`;
  html += `<div style="display:flex;justify-content:space-between;margin-bottom:8px">
    <span>💀 承受伤害</span><b style="color:#ff8a8a">${Math.floor(st.damage)}</b></div>`;
  if(st.maxHitSrc){
    html += `<div style="display:flex;justify-content:space-between;margin-bottom:8px">
      <span>🎯 最大威胁</span><b style="color:#ffb0b0">${st.maxHitSrc}（${Math.floor(st.maxHitDmg)} 伤害）</b></div>`;
  }
  html += `<div style="display:flex;justify-content:space-between;margin-bottom:8px">
    <span>⏱ 用时</span><b style="color:#5aa6ff">${st.time}s</b></div>`;
  // 如果本波差点翻车，提示
  if(st.danger){
    html += `<div style="margin-top:10px;padding:8px;background:rgba(255,80,80,.12);border:1px solid #ff5050;
      border-radius:4px;color:#ff8a8a;font-size:12px">⚠ 这波很危险！建议检查装备防御</div>`;
  }
  body.innerHTML = html;
  evalEl.textContent = evalText;
  evalEl.style.color = evalColor;

  panel.style.display = 'block';
  gamePaused = true;

  // 绑定继续按钮（先解绑避免重复）
  const btn = document.getElementById('wresContinueBtn');
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.addEventListener('click', ()=>{
    hideWaveResultPanel();
    spawnWave();
  });
  newBtn.addEventListener('touchstart', (e)=>{
    e.stopPropagation(); e.preventDefault();
    hideWaveResultPanel();
    spawnWave();
  }, {passive:false});
}

function hideWaveResultPanel(){
  const panel = document.getElementById('waveResultPanel');
  if(panel) panel.style.display = 'none';
  gamePaused = false;
}

// 记录本波承伤
function recordWaveDamage(srcType, dmg){
  if(!_waveActive) return;
  _waveStats.damageTaken += dmg;
  if(dmg > _waveStats.maxHitDmg){
    _waveStats.maxHitDmg = dmg;
    _waveStats.maxHitSrc  = srcType;
  }
}

// 波次开始时调用
function startWaveStats(wave){
  _waveActive = true;
  _waveStats.killTotalStart = player.killCount || 0;
  _waveStats.deathStart   = player.deathCount || 0;
  _waveStats.damageTaken   = 0;
  _waveStats.maxHitSrc     = null;
  _waveStats.maxHitDmg     = 0;
  _waveStats.startTime     = performance.now();
  _waveStats.waveLevel     = wave;
}

// 波次结束时调用（生成结算数据）
function endWaveStats(){
  if(!_waveActive) return;
  _waveActive = false;
  const now = performance.now();
  const kills = (player.killCount || 0) - _waveStats.killTotalStart;
  const damage = _waveStats.damageTaken;
  const timeSec = Math.floor((now - _waveStats.startTime) / 1000);
  const hpPct = player.hp / player.hpMax;
  const waveDeaths = (player.deathCount || 0) - (_waveStats.deathStart || 0);
  _lastWaveResult = {
    wave: _waveStats.waveLevel,
    kills,
    damage,
    maxHitSrc: _waveStats.maxHitSrc,
    maxHitDmg: _waveStats.maxHitDmg,
    time: timeSec,
    danger: hpPct < 0.3 && damage > player.hpMax * 0.5,
    deaths: waveDeaths,
  };
}
// ===== 波次结算系统结束 =====

function spawnWave(){
  const p = controls.getObject().position;
  // ===== 第 20 波（最终战）：只刷最终 BOSS，不刷散兵/怪群，给玩家清场感 =====
  const isFinalWave = (waveLevel===FINAL_BOSS_WAVE && !_victoryDone);
  // 最终波数量为 0；其它波次正常计算（声明在 if 外，以便末尾 totalCnt 使用）
  let scatterCnt = 0;
  let groupNum   = 0;
  if(!isFinalWave){
    // ===== 散兵：随机分布在玩家周围 =====
  // 数量从原来 6 + min(20,wave) 提升到 12 + wave*1.5（不再硬截 20）
  scatterCnt = Math.floor(12 + waveLevel*1.5);
  for(let i=0;i<scatterCnt;i++){
    const a=Math.random()*Math.PI*2, d=rand(22,60);
    const pos=new THREE.Vector3(
      clamp(p.x+Math.cos(a)*d,-95,95), 0,
      clamp(p.z+Math.sin(a)*d,-95,95)
    );
    spawnEnemy(pickEnemyType(), waveLevel, pos, Math.random()<.08+waveLevel*.008, false);
  }

  // ===== 成群结队：每波 1-3 个怪群 =====
  // 每群 4-7 只同种敌人聚在一个中心点周围；波次越高群数 / 群规模越大
  groupNum = 1 + Math.min(3, Math.floor(waveLevel/3) + (Math.random()<0.5?1:0));
  for(let g=0; g<groupNum; g++){
    const ga = Math.random()*Math.PI*2, gd = rand(28, 55);
    const center = new THREE.Vector3(
      clamp(p.x+Math.cos(ga)*gd,-93,93), 0,
      clamp(p.z+Math.sin(ga)*gd,-93,93)
    );
    const groupType = pickEnemyType();
    const groupSize = 4 + Math.floor(Math.random()*4) + Math.min(4, Math.floor(waveLevel/4));
    // 群中带 1 个精英作为"小队长"
    let hasLeader = false;
    for(let k=0;k<groupSize;k++){
      const ang = Math.random()*Math.PI*2;
      const r   = rand(0.9, 2.6);
      const gp = new THREE.Vector3(
        clamp(center.x + Math.cos(ang)*r, -95, 95), 0,
        clamp(center.z + Math.sin(ang)*r, -95, 95)
      );
      // 群中的第一只是精英；如果群规模 ≥ 6，再加一个精英
      const isLeader = (!hasLeader && k===0) || (k===Math.floor(groupSize/2) && groupSize>=6);
      if(isLeader) hasLeader = true;
      spawnEnemy(groupType, waveLevel, gp, isLeader, false);
    }
    toast(`⚠ ${ENEMY_TYPES[groupType].name}群 出现 (${groupSize})`);
  }
  } // end if(!isFinalWave)

  // ===== BOSS：每 5 波 =====
  if(waveLevel%5===0 && waveLevel!==FINAL_BOSS_WAVE){
    const a=Math.random()*Math.PI*2;
    // 5/15 波 = 冰霜领主；10 波 = 死亡骑士；交替出现
    const useFrost = ((waveLevel/5) % 2 === 1);
    const bossType = useFrost ? 'frostlord' : 'knight';
    const bossNm   = useFrost ? '冰霜领主'  : '死亡骑士';
    const boss = spawnEnemy(bossType, waveLevel, new THREE.Vector3(p.x+Math.cos(a)*30,0,p.z+Math.sin(a)*30), false, true);
    // 冰霜领主：蓝色光晕 + 自带技能 cd
    if(useFrost && boss && boss.mesh){
      const m = boss.mesh.children[0] && boss.mesh.children[0].material;
      if(m){
        m.emissive = new THREE.Color(0x4abfff);
        m.emissiveIntensity = 0.9;
        m.color = new THREE.Color(0x6abfff);
      }
      boss.frostNovaCd = 4;   // 冰霜领主特有：定期释放范围减速冰圈
    }
    toast('⚠ BOSS 出现：'+bossNm);
    Audio.bossSpawn();
  }
  // ===== 最终 BOSS：第 FINAL_BOSS_WAVE 波 =====
  if(waveLevel===FINAL_BOSS_WAVE && !_victoryDone){
    const a=Math.random()*Math.PI*2;
    const bossPos = new THREE.Vector3(p.x+Math.cos(a)*30,0,p.z+Math.sin(a)*30);
    const finalBoss = spawnEnemy('overlord', waveLevel, bossPos, false, true);
    // 视觉强化：放大 + 暗红光
    if(finalBoss && finalBoss.mesh){
      finalBoss.mesh.scale.setScalar(2.6);
      const torsoMat = finalBoss.mesh.children[0] && finalBoss.mesh.children[0].material;
      if(torsoMat){
        torsoMat.emissive = new THREE.Color(0xc81818);
        torsoMat.emissiveIntensity = 1.0;
        torsoMat.color = new THREE.Color(0x6a0a0a);
      }
    }
    toast('💀 最终 BOSS 降临：远 古 霸 主');
    Audio.bossSpawn && Audio.bossSpawn();
    _finalBossSpawned = true;   // 标记已刷出，避免重复刷 / 之后不再补刷散兵
  }

  // 总数提示
  if(isFinalWave){
    // 最终波只有 BOSS，专属警告 toast 已在上面单独发
  } else {
    const totalCnt = scatterCnt + groupNum * 5; // 粗略估算
    toast(`第 ${waveLevel} 波！约 ${totalCnt} 只`);
  }
  Audio.waveStart();
  document.getElementById('sArea').textContent=`血色荒野 #${waveLevel}　难度 ${difficulty}`;
  // 任务事件：抵达波次
  if(typeof Quests!=='undefined'){ Quests.onEvent('wave', {wave: waveLevel}); }
  // 关卡进度面板更新
  renderProgress();
  // 终波（最终 BOSS 战）不再自增波次，让进度停在第 FINAL_BOSS_WAVE 波直到 BOSS 被击败，
  // 给玩家清晰的"最终决战 / 通关"节点，避免波次无限往上飘没有结束感。
  if(!isFinalWave) waveLevel++;
  // 自动存档：每波开始作为存档点（首帧 init 时 _autosaveEnabled=false，不覆盖旧档）
  if(_autosaveEnabled) saveGame(true);
  // 开始统计本波数据（用当前的 waveLevel-1，即刚刷的这波）
  startWaveStats(isFinalWave ? FINAL_BOSS_WAVE : waveLevel-1);
}

// ===== 关卡进度面板渲染 =====
function renderProgress(){
  const fill   = document.getElementById('pBarFill');
  const marks  = document.getElementById('pMarks');
  const wEl    = document.getElementById('pWave');
  const dEl    = document.getElementById('pDiff');
  const cEl    = document.getElementById('pCleared');
  if(!fill || !marks || !wEl || !dEl || !cEl) return;
  // waveLevel 在 spawnWave 末尾会 ++，所以"刚刷完的当前波"= waveLevel-1
  let cur = Math.min(FINAL_BOSS_WAVE, Math.max(0, waveLevel-1));
  // 终波（最终 BOSS 战）不再自增 waveLevel，需特判：BOSS 已刷出即视为已抵达第 FINAL_BOSS_WAVE 波
  if(waveLevel===FINAL_BOSS_WAVE && _finalBossSpawned) cur = FINAL_BOSS_WAVE;
  const pct = (cur / FINAL_BOSS_WAVE) * 100;
  fill.style.width = pct + '%';
  wEl.textContent  = cur;
  dEl.textContent  = '难度 ' + difficulty;
  cEl.textContent  = _clearCount;

  // 里程碑标记：第 5/10/15 波（中间 BOSS），第 20 波（最终 BOSS）
  const milestones = [5, 10, 15, 20];
  marks.innerHTML = '';
  milestones.forEach(w=>{
    const left = (w / FINAL_BOSS_WAVE) * 100;
    const isFinal = (w===FINAL_BOSS_WAVE);
    const done = (cur >= w);
    const mark = document.createElement('div');
    mark.className = 'pMark ' + (isFinal?'final':'boss') + (done?' done':'');
    mark.style.left = left + '%';
    mark.textContent = isFinal ? '👑' : '⚔';
    mark.title = isFinal ? `最终 BOSS（第 ${w} 波）` : `BOSS（第 ${w} 波）`;
    marks.appendChild(mark);
  });
}

// ===== 胜利面板 + 难度切换 =====
function showVictoryPanel(){
  gamePaused = true;
  controls.unlock && controls.unlock();
  const panel = document.getElementById('victoryPanel');
  const sub = document.getElementById('victorySub');
  if(sub){
    const dc = player.deathCount || 0;
    // 死亡 0 次时给金色"无瑕通关"标记，>0 次按数量显示红色
    const dcLabel = dc===0
      ? `<span style="color:#ffd76a">死亡 0 次　★ 无瑕通关</span>`
      : `<span style="color:#ff8a8a">死亡 ${dc} 次</span>`;
    sub.innerHTML =
      `你击败了远古霸主，征服了 <b style="color:var(--gold)">难度 ${difficulty}</b> 的血色荒野<br/>`+
      `等级 Lv.${player.level}　击杀 ${player.killCount}　${dcLabel}`;
  }
  if(panel) panel.style.display = 'block';
  Audio.levelUp && Audio.levelUp();
}
function hideVictoryPanel(){
  const panel = document.getElementById('victoryPanel');
  if(panel) panel.style.display = 'none';
}
// 清场（保留装备/背包/等级，清空怪物/投射物/掉落）
function resetLevel(){
  // 移除所有怪
  for(const e of enemies){ if(e.mesh) scene.remove(e.mesh); }
  enemies.length = 0;
  // 清投射物
  for(const p of eProjectiles){ if(p.mesh) releaseProj(p.mesh); }
  eProjectiles.length = 0;
  for(const p of projectiles){ if(p.mesh) releaseProj(p.mesh); }
  projectiles.length = 0;
  // 清掉落物
  for(const l of lootDrops){ if(l.mesh) scene.remove(l.mesh); }
  lootDrops.length = 0;
  // 清宝箱
  for(const c of chests){ if(c.mesh) scene.remove(c.mesh); }
  chests.length = 0;
  // 清 AOE
  for(const a of aoes){ if(a.mesh) scene.remove(a.mesh); }
  aoes.length = 0;
  // 重置波次和暴怒计时器
  waveLevel = 1;
  _victoryDone = false;
  _finalBossSpawned = false;
  _continueAfterVictory = false;
  window._enrageWarned = 0;
  // 立即刷新进度面板
  renderProgress();
  // 玩家回血回蓝 + 短暂无敌 + 回到出生点
  player.hp = player.hpMax;
  player.mp = player.mpMax;
  player.invuln = 3.0;
  player._frozenT = 0;
  controls.getObject().position.set(0, 1.65, 0);
  player.vel.set(0,0,0);
  player.onGround = true;
}

// ===================== 存档系统（localStorage）=====================
// 存：玩家属性/装备/背包/等级、波次、难度、任务进度。
// 不存：场上怪物/掉落/投射物（含 THREE mesh，无法序列化）→ 读档后清场重刷。
const SAVE_KEY = 'diablo_fps_save_v1';
let _autosaveEnabled = false;   // 防止页面首帧 init 的 spawnWave 在玩家选择"读取"前覆盖旧存档

function hasSave(){ try{ return !!localStorage.getItem(SAVE_KEY); }catch(e){ return false; } }

function saveGame(silent){
  // 死亡时禁止自动保存（避免把"满血复活前的死状态"写入覆盖旧档）；
  // 死亡画面下手动点保存（silent=false）则尊重用户选择
  if(silent && player && player._dead) return false;
  try{
    const data = {
      v: (typeof GAME_VERSION!=='undefined'?GAME_VERSION:'?'), ts: Date.now(),
      player: {
        hp:player.hp, hpMax:player.hpMax, mp:player.mp, mpMax:player.mpMax,
        level:player.level, exp:player.exp, expNeed:player.expNeed,
        str:player.str, dex:player.dex, int:player.int,
        killCount:player.killCount, deathCount:player.deathCount||0, activeSkill:player.activeSkill,
        equip:player.equip, inv:player.inv
      },
      waveLevel, difficulty,
      victoryDone:_victoryDone, clearCount:_clearCount, continueAfterVictory:_continueAfterVictory,
      quests:{
        completed:[...Quests.completed],
        pool:Quests.pool?[...Quests.pool]:[],
        active:Quests.active.map(q=>({id:q.id,current:q.current,done:q.done}))
      }
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    if(!silent){
      setSaveStatus(`✅ 已保存：Lv.${player.level} · 第${Math.max(1,waveLevel-1)}波 · 难度${difficulty}`);
      if(typeof showBigStatus==='function') showBigStatus('💾 进度已保存', '#7bd96a');
      else toast('💾 进度已保存');
    }
    return true;
  }catch(e){
    console.warn('[save] failed', e);
    if(!silent){
      setSaveStatus('❌ 保存失败：'+(e&&e.message||e));
      if(typeof showBigStatus==='function') showBigStatus('❌ 保存失败', '#ff7070');
    }
    return false;
  }
}

// 把存档里的物品重新链接到规范 quality 对象（按 key），其余字段是纯数据可直接用
function _relinkItem(it){
  if(!it) return null;
  if(it.quality && it.quality.key){
    const q = QUALITY.find(qq=>qq.key===it.quality.key);
    if(q) it.quality = q;
  }
  // 兼容旧存档：补打流派标签
  if(!it.classTag && it.slot && typeof tagItemClass==='function'){
    tagItemClass(it);
  }
  return it;
}

function loadGame(){
  let data;
  try{ data = JSON.parse(localStorage.getItem(SAVE_KEY)); }catch(e){ setSaveStatus('❌ 存档损坏'); return false; }
  if(!data || !data.player){ setSaveStatus('⚠ 没有可用存档'); return false; }
  const P = data.player;
  // 先清场（也会把 waveLevel/胜利标记重置，随后用存档值覆盖）
  resetLevel();
  // 恢复玩家核心数据
  player.level=P.level; player.exp=P.exp; player.expNeed=P.expNeed;
  player.str=P.str; player.dex=P.dex; player.int=P.int;
  player.killCount=P.killCount||0; player.deathCount=P.deathCount||0; player.activeSkill=P.activeSkill||0;
  player.equip={weapon:null,helm:null,armor:null,ring:null};
  ['weapon','helm','armor','ring'].forEach(s=>{ player.equip[s]=_relinkItem(P.equip && P.equip[s]); });
  player.inv=(P.inv||[]).map(_relinkItem);
  // 波次 / 难度 / 胜利状态
  waveLevel = data.waveLevel||1;
  difficulty = data.difficulty||1;
  _victoryDone = !!data.victoryDone;
  _finalBossSpawned = false;   // 读档后由末尾 spawnWave 决定是否重刷最终 BOSS
  _clearCount = data.clearCount||0;
  _continueAfterVictory = !!data.continueAfterVictory;
  // 任务系统
  if(data.quests){
    Quests.completed = new Set(data.quests.completed||[]);
    Quests.pool = data.quests.pool||[];
    Quests.active = (data.quests.active||[]).map(sq=>{
      const def = QUEST_DEFS.find(d=>d.id===sq.id);
      return def ? {...def, current:sq.current, done:sq.done} : null;
    }).filter(Boolean);
  }
  // 重算装备属性（会重建 skills / hpMax / mpMax 等）
  applyEquipStats();
  // hp/mp 用存档值，clamp 到新上限
  player.hp = Math.min(P.hp!=null?P.hp:player.hpMax, player.hpMax);
  player.mp = Math.min(P.mp!=null?P.mp:player.mpMax, player.mpMax);
  player.invuln = 3.0;
  // 关键：如果玩家在死亡画面下点的读档，必须把 _dead 清掉，
  // 否则 startOrResumeGame 会因 `if(player._dead) return` 而被跳过，
  // 看起来就是"读档了但 overlay 不消失"。
  player._dead = false;
  if(typeof clearOverlayState==='function') clearOverlayState();
  // 刷新所有 UI
  if(typeof rebuildInv==='function') rebuildInv();
  if(typeof refreshEquip==='function') refreshEquip();
  if(typeof refreshInfo==='function') refreshInfo();
  Quests.render();
  renderProgress();
  // 刷出该波怪物（spawnWave 会用当前 waveLevel 并自增，与正常流程一致）
  spawnWave();
  _autosaveEnabled = true;   // 读档后开启自动存档
  setSaveStatus(`📂 已读取：Lv.${player.level} · 第${Math.max(1,waveLevel-1)}波 · 难度${difficulty}`);
  if(typeof showBigStatus==='function') showBigStatus(`📂 存档已读取：Lv.${player.level}`, '#5aa6ff');
  else toast(`📂 存档已读取：Lv.${player.level} · 难度${difficulty}`);
  // 自动进入游戏：避免玩家"还要再点屏幕一次"的二次确认体验
  // 使用一个微小延迟，让 showBigStatus 先弹出来，玩家能看到反馈
  setTimeout(()=>{
    if(typeof startOrResumeGame==='function') startOrResumeGame();
  }, 350);
  return true;
}

function setSaveStatus(txt){
  const el = document.getElementById('saveStatus');
  if(el) el.textContent = txt || '';
}
// ===================================================================

// 提升难度重玩：保留所有装备 / 物品 / 等级
function chooseHarder(){
  difficulty++;
  resetLevel();
  hideVictoryPanel();
  gamePaused = false;
  toast(`⚠ 难度提升至 ${difficulty}！敌人 HP/伤害额外 +${(difficulty-1)*20}%`);
  spawnWave();
  try{ controls.lock(); }catch(_){}
}
// 同难度重玩
function chooseRestart(){
  resetLevel();
  hideVictoryPanel();
  gamePaused = false;
  toast(`↻ 重玩难度 ${difficulty}`);
  spawnWave();
  try{ controls.lock(); }catch(_){}
}
// 继续游戏（不重置波次，怪继续正常刷）
function chooseContinue(){
  hideVictoryPanel();
  gamePaused = false;
  toast('▶ 继续征战…');
  // 不重置 waveLevel —— 让自动补刷继续；但 _victoryDone 保持 true，避免再次弹面板
  // 解除"通关后冻结刷怪"标记：使用 _continueAfterVictory 让 setInterval 恢复刷怪
  _continueAfterVictory = true;
  try{ controls.lock(); }catch(_){}
}

// 绑定按钮事件（在 DOM 就绪后）
(function(){
  const bH = document.getElementById('vBtnHarder');
  const bR = document.getElementById('vBtnRestart');
  const bC = document.getElementById('vBtnContinue');
  if(bH) bH.addEventListener('click', chooseHarder);
  if(bR) bR.addEventListener('click', chooseRestart);
  if(bC) bC.addEventListener('click', chooseContinue);
})();

// ---------- 投射物/特效 ----------
const projectiles=[],aoes=[],lootDrops=[];
// 性能保护：玩家投射物硬上限（极端连发 + 穿透 + chain 时兜底）
const P_PROJ_HARD_LIMIT = 60;
// 性能优化③：AI 循环复用的临时向量（避免每帧每敌 new THREE.Vector3 造成 GC）
const _aiToP=new THREE.Vector3(), _aiSep=new THREE.Vector3();

// 性能优化②：投射物对象池（玩家/敌人投射物每秒大量生成销毁，复用 mesh+材质+点光源消除战斗 GC 卡顿）
const _projGeo = new THREE.SphereGeometry(0.25, 8, 8);  // 共享球体几何，按需缩放
const _projPool = [];
function acquireProj(scale, color, lightDist, kind){
  let m = _projPool.pop();
  if(!m){
    m = new THREE.Mesh(_projGeo, new THREE.MeshBasicMaterial());
    const pl = new THREE.PointLight(0xffffff, 1.2, 6);
    m.add(pl); m.userData.pl = pl;
  }
  m.material.color.set(color);
  m.userData.pl.color.set(color);
  m.userData.pl.distance = lightDist || 6;
  m.scale.setScalar(scale / 0.25);   // 基础几何半径 0.25，缩放到目标大小
  // 清理上一次的装饰
  if(m.userData.deco){ m.remove(m.userData.deco); m.userData.deco = null; }
  // 根据 kind 添加不同造型装饰
  if(kind){
    let deco = null;
    if(kind==='fireball'){
      // 火球：核心球 + 外圈火焰光环
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.42, 0.10, 6, 12),
        new THREE.MeshBasicMaterial({color, transparent:true, opacity:0.7})
      );
      ring.rotation.x = Math.PI/2;
      deco = ring;
    } else if(kind==='iceshard'){
      // 冰晶：八面体（晶体感）
      deco = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.6, 0),
        new THREE.MeshBasicMaterial({color, transparent:true, opacity:0.85, wireframe:false})
      );
    } else if(kind==='arrow'){
      // 多重射击的箭：细长锥体（头朝运动方向 = mesh 的 +Z 由 lookAt 设置）
      deco = new THREE.Mesh(
        new THREE.ConeGeometry(0.18, 1.0, 5),
        new THREE.MeshBasicMaterial({color})
      );
      deco.rotation.x = -Math.PI/2;
    } else if(kind==='bolt'){
      // 穿刺箭：长条胶囊
      deco = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.04, 1.2, 6),
        new THREE.MeshBasicMaterial({color})
      );
      deco.rotation.x = -Math.PI/2;
    }
    if(deco){
      m.add(deco);
      m.userData.deco = deco;
    }
  }
  m.visible = true; scene.add(m);
  return m;
}
function releaseProj(m){
  if(m.userData && m.userData.deco){ m.remove(m.userData.deco); m.userData.deco=null; }
  scene.remove(m); _projPool.push(m);
}

// 性能优化②：掉落物共享几何体（频率较低 + 含特殊道具，仅共享几何体，避免对象池复位风险）
const _lootGeo = new THREE.OctahedronGeometry(.25);
const _lootBeamGeo = new THREE.CylinderGeometry(.05,.05,2,6);

function shootProjectile(opts){
  const {origin,dir,color,range,speed=35,scale=.25,dmg,hit,pierce=false,life=2,kind}=opts;
  // 性能保护：玩家投射物硬上限
  if(projectiles.length >= P_PROJ_HARD_LIMIT){
    const old = projectiles.shift();
    if(old && old.mesh) releaseProj(old.mesh);
  }
  const m=acquireProj(scale,color,6,kind);
  m.position.copy(origin);
  // 让 deco（锥/胶囊）朝运动方向
  if(m.userData.deco){
    const v = dir.clone().normalize();
    m.lookAt(m.position.clone().add(v));
  }
  projectiles.push({mesh:m,dir:dir.clone().normalize(),speed,dmg,life,range,traveled:0,pierce,hits:new Set(),hit});
}
function spawnAoe(pos,radius,dmgFn,color=0xff8030,dur=.4){
  // 能力buff：AOE范围扩大
  const aoeScale = 1 + ((player._skillBuffs&&player._skillBuffs.aoeScale)||0);
  radius *= aoeScale;
  const ring=new THREE.Mesh(new THREE.CircleGeometry(radius,32),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.55,side:THREE.DoubleSide}));
  ring.rotation.x=-Math.PI/2;ring.position.copy(pos);ring.position.y=.05;scene.add(ring);
  enemies.forEach(e=>{if(e.hp<=0)return;if(e.mesh.position.distanceTo(pos)<=radius)damageEnemy(e,typeof dmgFn==='function'?dmgFn():dmgFn,false,pos);});
  aoes.push({mesh:ring,life:dur,maxLife:dur});
}

// 在指定位置生成一个掉落物（公共函数：dropLoot / 丢弃 都用它）
function spawnLootFromItem(it, pos, jitter=true){
  const col=parseInt(it.quality.color.slice(1),16);
  const m=new THREE.Mesh(_lootGeo,new THREE.MeshStandardMaterial({color:col,emissive:col,emissiveIntensity:.6}));
  m.position.set(
    pos.x+(jitter?rand(-.6,.6):0),
    .4,
    pos.z+(jitter?rand(-.6,.6):0)
  );
  m.castShadow=true;scene.add(m);
  const beam=new THREE.Mesh(_lootBeamGeo,new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:.5}));
  beam.position.y=1;m.add(beam);
  lootDrops.push({mesh:m,item:it,t:0});
}

// === 特殊道具：全图拾取卷轴 ===
// 它是一个 lootDrop，但 item.special = 'magnet'，拾取时不进背包，立刻触发"全图吸取"
function spawnMagnetScroll(pos){
  // 视觉：金色立方体 + 上下双锥 + 强光柱
  const g = new THREE.Group();
  const gold = 0xe8c45a;
  const core = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 0.5, 0.35),
    new THREE.MeshStandardMaterial({color:gold, emissive:gold, emissiveIntensity:1.0})
  );
  g.add(core);
  // 上下两个金色锥
  const topCone = new THREE.Mesh(new THREE.ConeGeometry(0.25,0.20,6),
    new THREE.MeshStandardMaterial({color:gold, emissive:gold, emissiveIntensity:0.9}));
  topCone.position.y = 0.35; g.add(topCone);
  const botCone = new THREE.Mesh(new THREE.ConeGeometry(0.25,0.20,6),
    new THREE.MeshStandardMaterial({color:gold, emissive:gold, emissiveIntensity:0.9}));
  botCone.position.y = -0.35; botCone.rotation.x = Math.PI; g.add(botCone);
  // 强光柱（特殊道具更显眼）
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.10,0.10,4,8),
    new THREE.MeshBasicMaterial({color:gold, transparent:true, opacity:0.4})
  );
  beam.position.y = 2; g.add(beam);
  // 外圈光环
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.35,0.02,4,16),
    new THREE.MeshBasicMaterial({color:gold, transparent:true, opacity:0.7})
  );
  ring.rotation.x = Math.PI/2; g.add(ring);
  g.position.set(pos.x, 0.7, pos.z);
  scene.add(g);

  const item = {
    special: 'magnet',
    name: '【全图拾取卷轴】',
    icon: '✨',
    quality: { key:'unique', color:'#e8c45a', name:'特殊' }
  };
  lootDrops.push({mesh:g, item:item, t:0, isSpecial:true, ring:ring});
}

// 触发全图吸取：把所有非 special 的 lootDrops 标记为 magnet 模式
function triggerMagnetPickup(){
  let count = 0;
  for(const l of lootDrops){
    if(l.isSpecial) continue;       // 卷轴自身不吸
    if(l.magnet) continue;          // 已在吸取中
    l.magnet = true;
    l.magnetT = 0;
    l.magnetDur = rand(0.9, 1.4);  // 飞行时长，错落
    l.magnetStart = l.mesh.position.clone();
    // 弧线高度：用一个随机控制点 y
    l.magnetArcH = rand(2.0, 4.0);
    count++;
  }
  toast(`✨ 全图拾取！${count} 件物品飞向你`);
  Audio.levelUp && Audio.levelUp();
  // 屏幕金色闪一下
  flashScreenGold();
}

function flashScreenGold(){
  let el = document.getElementById('magnetFx');
  if(!el){
    el = document.createElement('div');
    el.id = 'magnetFx';
    el.style.cssText = 'position:fixed;inset:0;z-index:8;pointer-events:none;'+
      'background:radial-gradient(circle,rgba(232,196,90,.55) 0%,transparent 60%);'+
      'opacity:0;transition:opacity .25s ease-out;';
    document.body.appendChild(el);
  }
  el.style.opacity='1';
  setTimeout(()=>{ el.style.opacity='0'; }, 300);
}

// ===================== 宝箱系统 =====================
// 定时在地图随机点刷出宝箱，玩家靠近并攻击（或走到跟前）即可打破，掉落法力药水。
const chests = [];
const CHEST_MAX = 4;                 // 场上最多同时存在的宝箱数
const _chestBodyGeo = new THREE.BoxGeometry(1.0, 0.6, 0.7);
const _chestLidGeo  = new THREE.BoxGeometry(1.04, 0.3, 0.74);
const _chestBandGeo = new THREE.BoxGeometry(1.06, 0.62, 0.12);
function spawnChest(pos){
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({color:0x6b4322, emissive:0x3a2410, emissiveIntensity:0.5, roughness:0.8});
  const gold = new THREE.MeshStandardMaterial({color:0xe8c45a, emissive:0xe8c45a, emissiveIntensity:0.6, metalness:0.6, roughness:0.4});
  const body = new THREE.Mesh(_chestBodyGeo, wood); body.position.y=0.3; body.castShadow=true; g.add(body);
  const lid  = new THREE.Mesh(_chestLidGeo,  wood); lid.position.y=0.6; g.add(lid);
  // 金色铁箍 + 锁扣
  const band1 = new THREE.Mesh(_chestBandGeo, gold); band1.position.set(0,0.4,0); g.add(band1);
  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.18,0.22,0.08), gold); lock.position.set(0,0.5,0.39); g.add(lock);
  // 光柱（暗场中显眼）
  const beam = new THREE.Mesh(_lootBeamGeo, new THREE.MeshBasicMaterial({color:0xe8c45a, transparent:true, opacity:0.35}));
  beam.position.y=2; g.add(beam);
  g.position.set(pos.x, 0, pos.z);
  scene.add(g);
  chests.push({mesh:g, t:Math.random()*6, broken:false});
}
// 在玩家附近一定范围外的随机可达点刷新宝箱
function spawnChestRandom(){
  if(gamePaused || (player && player._dead)) return;
  if(chests.length >= CHEST_MAX) return;
  const pp = controls.getObject().position;
  for(let tries=0; tries<12; tries++){
    const ang = Math.random()*Math.PI*2;
    const dist = rand(12, 40);
    const x = pp.x + Math.cos(ang)*dist;
    const z = pp.z + Math.sin(ang)*dist;
    if(Math.abs(x)>92 || Math.abs(z)>92) continue;   // 不要贴墙/出界
    spawnChest({x, z});
    return;
  }
}
// 打破宝箱：掉落法力药水（1~3 瓶，偶尔高级），并伴随金光与音效
function breakChest(c){
  if(c.broken) return;
  c.broken = true;
  const p = c.mesh.position.clone();
  scene.remove(c.mesh);
  const idx = chests.indexOf(c); if(idx>=0) chests.splice(idx,1);
  Audio.pickup && Audio.pickup('rare');
  flashAt && flashAt(p.clone().setY(1), 0xe8c45a, 2);
  // 掉落法力药水
  const n = 1 + Math.floor(Math.random()*3);   // 1~3 瓶
  for(let i=0;i<n;i++){
    const tier = Math.random()<0.25 ? 1 : 0;    // 25% 高级
    spawnLootFromItem(makeMpPotion(tier), p, true);
  }
  // 小概率附带 1 瓶生命药水
  if(Math.random()<0.30) spawnLootFromItem(makeHpPotion(0), p, true);
  toast(`📦 打破宝箱，获得 ${n} 瓶法力药水！`);
}
// 攻击时调用：打破玩家附近的宝箱
function tryBreakChestsNear(pos, range){
  const r2 = range*range;
  for(let i=chests.length-1;i>=0;i--){
    const c=chests[i];
    const dx=c.mesh.position.x-pos.x, dz=c.mesh.position.z-pos.z;
    if(dx*dx+dz*dz <= r2) breakChest(c);
  }
}
// 主循环每帧更新：漂浮发光 + 贴近自动打破
function updateChests(dt){
  if(!chests.length) return;
  const pp = controls.getObject().position;
  for(let i=chests.length-1;i>=0;i--){
    const c=chests[i];
    c.t+=dt;
    c.mesh.rotation.y = Math.sin(c.t*0.6)*0.15;
    c.mesh.position.y = Math.sin(c.t*2)*0.06;
    // 走到跟前（<1.8m）自动打破
    const dx=c.mesh.position.x-pp.x, dz=c.mesh.position.z-pp.z;
    if(dx*dx+dz*dz <= 1.8*1.8) breakChest(c);
  }
}

function dropLoot(pos,level,isElite,isBoss){
  // 整体掉落进一步降频（v0.19）
  // 普通怪 10% 掉 1 件；精英 50% 掉 1 件 + 15% 第 2 件；BOSS 固定 3 件
  let count = 0;
  if(isBoss){
    count = 3;
  } else if(isElite){
    if(Math.random() < 0.50) count = 1;
    if(count===1 && Math.random() < 0.15) count = 2;
  } else {
    if(Math.random() < 0.10) count = 1;   // 90% 不掉任何东西
  }
  for(let i=0;i<count;i++){
    const it=genItem(level);
    spawnLootFromItem(it, pos, true);
    // 装备掉落提示（建议2）
    showLootToast(it);
  }
  // ===== 宝石掉落 =====
  // 普通 4%、精英 16%、BOSS 必掉 1 颗（v0.23.3 提高宝石掉率）
  let gemChance = 0.04;
  if(isElite) gemChance = 0.16;
  if(isBoss)  gemChance = 1.0;
  if(Math.random() < gemChance){
    const gem = isBoss ? makeGem(GEM_TYPE_KEYS[Math.floor(Math.random()*GEM_TYPE_KEYS.length)], Math.random()<0.4?2:1) : rollGem();
    spawnLootFromItem(gem, pos, true);
  }
  // ===== 药水掉落 =====
  // 红瓶：普通 3% / 精英 12% / BOSS 必掉 2
  // 蓝瓶：普通 6% / 精英 18% / BOSS 必掉 3（提高蓝瓶概率）
  if(isBoss){
    spawnLootFromItem(makeHpPotion(0), pos, true);
    spawnLootFromItem(makeHpPotion(0), pos, true);
    spawnLootFromItem(makeMpPotion(0), pos, true);
    spawnLootFromItem(makeMpPotion(0), pos, true);
    spawnLootFromItem(makeMpPotion(0), pos, true);
  } else {
    if(Math.random() < (isElite?0.12:0.03)){
      spawnLootFromItem(makeHpPotion(0), pos, true);
    }
    if(Math.random() < (isElite?0.18:0.06)){
      spawnLootFromItem(makeMpPotion(0), pos, true);
    }
  }
  // 特殊道具【全图拾取卷轴】掉落（也降低）
  let chance = 0.004;
  if(isElite) chance = 0.015;
  if(isBoss)  chance = 1.0;
  if(Math.random() < chance){
    spawnMagnetScroll(pos);
  }
}
function tryPickup(){
  const p=controls.getObject().position;
  let best=null,bd=4;
  lootDrops.forEach(l=>{
    if(l.magnet) return;     // 飞向玩家中的物品不能再被手动拾取
    const d=l.mesh.position.distanceTo(p);
    if(d<bd){bd=d;best=l;}
  });
  if(best){
    // 特殊道具：直接触发效果，不入包
    if(best.item && best.item.special==='magnet'){
      scene.remove(best.mesh);
      lootDrops.splice(lootDrops.indexOf(best),1);
      Audio.pickup && Audio.pickup('unique');
      triggerMagnetPickup();
      return;
    }
    if(player.inv.length>=INV_CAP){ toast('背包已满！按 I 整理后再拾取'); return; }
    best.item.isNew=true;
    player.inv.push(best.item);
    scene.remove(best.mesh);
    lootDrops.splice(lootDrops.indexOf(best),1);
    toast(`拾取：${best.item.name}`);
    addLootText(best.item);
    Audio.pickup(best.item.quality.key);
    if(settings.autoEquip) autoEquipBetter(best.item);
    rebuildInv();
    // 任务事件：拾取（仅装备计入"拾荒者"等任务）
    if(typeof Quests!=='undefined' && !best.item.isGem && !best.item.special){
      Quests.onEvent('pickup', {qualityKey: best.item.quality.key});
    }
  } else toast('附近无可拾取物品');
}
function itemScore(it){
  let s=(it.dmgMin||0)+(it.dmgMax||0)+(it.armor||0)*2;
  it.affixes.forEach(a=>s+=a.v*(a.k==='dmgPct'?2:1));
  s+={common:0,magic:5,rare:15,set:25,unique:40}[it.quality.key];
  return s;
}
function autoEquipBetter(it){
  if(it.isGem) return;   // 宝石不能"穿戴"
  if(it.special) return; // 特殊消耗品（扩容卷轴等）不能穿戴
  const cur=player.equip[it.slot];
  if(!cur||itemScore(it)>itemScore(cur)){
    if(cur)player.inv.push(cur);
    player.equip[it.slot]=it;
    const idx=player.inv.indexOf(it);if(idx>=0)player.inv.splice(idx,1);
    toast('装备：'+it.name);
    applyEquipStats();
    if(typeof Quests!=='undefined'){ Quests.onEvent('equip', {qualityKey: it.quality.key}); }
  }
}

// ---------- 战斗 ----------
function calcPlayerDamage(skill){
  const w=player.equip.weapon;
  let [lo,hi]=skill.dmg;
  if(w&&['melee','multi','pierce'].includes(skill.type)){lo+=w.dmgMin*.5;hi+=w.dmgMax*.7;}
  if(['proj','aoe','nova','chain'].includes(skill.type)){lo+=player._intTotal*.4;hi+=player._intTotal*.7;}
  else {lo+=player._strTotal*.4;hi+=player._strTotal*.6;}
  // 能力buff：伤害提升
  const dmgScale = 1 + ((player._skillBuffs&&player._skillBuffs.dmgScale)||0);
  let dmg=rand(lo,hi) * dmgScale;
  const eq=player._eq||{};
  dmg*=1+(eq.dmgPct||0)/100;
  // 元素伤害加成（按技能 key 粗略匹配）
  const sk = skill.key || '';
  if((sk==='fireball'||sk==='meteor')   && eq.fireDmg)  dmg *= 1+eq.fireDmg/100;
  if((sk==='iceshard' ||sk==='nova')     && eq.iceDmg)   dmg *= 1+eq.iceDmg/100;
  if((sk==='chain'    ||sk==='lightning')&& eq.lightDmg) dmg *= 1+eq.lightDmg/100;
  // 能力buff：额外暴击率
  const bonusCrit = (player._skillBuffs&&player._skillBuffs.critChance)||0;
  const isCrit=Math.random()*100<((eq.critChance||0)+5+bonusCrit);
  if(isCrit)dmg*=1.5+(eq.critDmg||0)/100;
  return {dmg:Math.round(dmg),crit:isCrit};
}
function damageEnemy(e,dmgRoll,fromMelee,hitPos){
  if(e.hp<=0)return;
  const v=dmgRoll.dmg!==undefined?dmgRoll.dmg:dmgRoll;
  e.hp-=v;updateHpBar(e);
  const wp=(hitPos||e.mesh.position).clone();wp.y+=2.4;
  spawnDmgText(wp,v,dmgRoll.crit);
  // 命中音效（只在敌人附近时播放，避免太吵）
  const dPlayer = e.mesh.position.distanceTo(controls.getObject().position);
  if(dPlayer<25){ if(dmgRoll.crit) Audio.crit(); else Audio.hit(); }
  const eq=player._eq||{};
  // 装备生命汲取
  if(eq.lifeOnHit)heal(eq.lifeOnHit);
  // 能力光环：生命汲取
  if(player._auras && player._auras.lifeOnHit) heal(player._auras.lifeOnHit);
  if(e.hp<=0)killEnemy(e);
}
function killEnemy(e){
  Audio.enemyDie();
  scene.remove(e.mesh);
  enemies.splice(enemies.indexOf(e),1);
  player.killCount++;
  document.getElementById('sKill').textContent=player.killCount;
  gainExp(e.def.exp*(1+e.level*.2)*(e.isElite?3:1)*(e.isBoss?15:1));
  dropLoot(e.mesh.position.clone(),e.level,e.isElite,e.isBoss);
  // 任务事件：击杀
  if(typeof Quests!=='undefined'){
    Quests.onEvent('kill', {enemyType: e.type, isElite: e.isElite, isBoss: e.isBoss});
  }
  // 最终 BOSS 被击败 → 弹胜利面板
  if(e.type==='overlord' && !_victoryDone){
    _victoryDone = true;
    _clearCount++;
    renderProgress();
    setTimeout(()=>showVictoryPanel(), 1200);   // 留点时间让特效播完
  }
}
function gainExp(v){
  // 经验加成
  const expBonus = (player._eq && player._eq.expBonus) || 0;
  v = v * (1 + expBonus/100);
  player.exp+=Math.floor(v);
  // 非阻塞升级：一次只升一级，弹出能力选择面板
  if(player.exp>=player.expNeed && !_abilitySelectOpen){
    _doOneLevelUp();
  }
  refreshInfo();
}

// 执行一次升级（非阻塞，选完能力后再检查是否还能继续升级）
function _doOneLevelUp(){
  if(player.exp<player.expNeed) return;
  player.exp-=player.expNeed; player.level++;
  player.expNeed=Math.floor(50*Math.pow(1.25,player.level-1));
  player.str+=2; player.dex+=2; player.int+=2;
  // 每升1级增加1格背包上限
  INV_CAP += 1;
  applyEquipStats();
  player.hp=player.hpMax; player.mp=player.mpMax;
  Audio.levelUp();
  // 弹出能力选择面板（选完后在 hideAbilitySelectPanel 里继续检查下一级）
  showAbilitySelectPanel();
}

// 关闭能力面板后，检查是否还能继续升级（经验溢出时连续升级）
const _origHideAbilitySelectPanel = hideAbilitySelectPanel;
hideAbilitySelectPanel = function(){
  _origHideAbilitySelectPanel();
  // 延迟一帧再检查，避免面板还没完全关闭就又打开
  requestAnimationFrame(()=>{
    if(player.exp>=player.expNeed && !_abilitySelectOpen){
      _doOneLevelUp();
    }
  });
};
function heal(v){player.hp=Math.min(player.hpMax,player.hp+v);}
function damagePlayer(v, source){
  if(player.invuln>0)return;
  // 背包/合成/镶嵌面板打开时，锁死伤害防止突然死亡
  if(invPanel && invPanel.style.display==='block') return;
  if(typeof fusePanelEl!=='undefined' && fusePanelEl && fusePanelEl.style.display==='flex') return;
  // 比例减伤（替代旧的线性 armor/2）：减伤% = armor/(armor+K)，K 随等级增长
  // → 堆护甲呈递减收益、永不溢出，且后期需要更多护甲才能维持（护甲也随装备成长）。硬上限 85%
  const K = 50 + player.level*10;
  const dr = player.armor/(player.armor + K);
  v*=1-Math.min(0.85, dr);
  // 铁壁姿态减伤（叠加在护甲之后）
  if((player.hasteT||0)>0 && player.dmgReduce>0){ v*=1-player.dmgReduce; }
  // 守护护盾优先吸收伤害
  if((player.shield||0)>0){
    const absorbed=Math.min(player.shield,v);
    player.shield-=absorbed; v-=absorbed;
    if(player.shield<=0){ player.shield=0; player.shieldT=0; toast('🛡 护盾破碎'); }
  }
  player.hp-=v;player.invuln=.25;
  // 记录本波承伤（用于结算面板）
  if(_waveActive && source && source.type){
    recordWaveDamage(ENEMY_TYPES[source.type] ? ENEMY_TYPES[source.type].name : source.type, v);
  }
  Audio.playerHit();
  // 反伤：装备 thorns 词条 → 给攻击者造成固定反伤
  const thorns = (player._eq && player._eq.thorns) || 0;
  if(thorns>0 && source && source.hp>0){
    damageEnemy(source, {dmg:thorns,crit:false}, false, source.mesh.position);
  }
  if(player.hp<=0){player.hp=0;gameOver();}
}
function gameOver(){
  if(player._dead) return;        // 防重复触发
  // 关闭波次结算面板（如果正在显示）
  const wpanel = document.getElementById('waveResultPanel');
  if(wpanel) wpanel.style.display = 'none';
  player._dead = true;
  player.deathCount = (player.deathCount||0) + 1;
  Audio.death();
  gamePaused = true;              // 死亡即暂停，敌方投射物 / AI 全部冻结
  controls.unlock();
  // 关掉所有可能残留的子面板，避免叠加 UI（旧 bug：死后点"继续"会弹出宝石镶嵌界面，
  // 因为玩家死前正好打开了 gemUsePanel/socketPanel 而它们没有被关闭）
  if(invPanel && invPanel.style.display==='block'){
    invPanel.style.display='none';
  }
  if(typeof closeGemUsePanel==='function') closeGemUsePanel();
  if(typeof closeSocketPanel==='function') closeSocketPanel();
  const fp = document.getElementById('fusePanel');
  if(fp) fp.style.display='none';
  showDeathOverlay();

  // 旧版"点屏幕复活"已废弃：改为死亡 overlay 上的显式「复活」按钮
  // （这里清理掉可能残留的 onclick，防止意外触发）
  overlay.onclick = null;
}

function respawn(){
  // 清场：移除所有现存敌人和它们的投射物，避免复活瞬间又被打死
  for(const e of enemies){ if(e.mesh) scene.remove(e.mesh); }
  enemies.length = 0;
  for(const p of eProjectiles){ releaseProj(p.mesh); }
  eProjectiles.length = 0;
  for(const p of projectiles){ releaseProj(p.mesh); }
  projectiles.length = 0;
  for(const a of aoes){ scene.remove(a.mesh); }
  aoes.length = 0;

  // 复活
  player.hp = player.hpMax;
  player.mp = player.mpMax;
  player.invuln = 2.0;             // 给 2 秒无敌缓冲
  controls.getObject().position.set(0, 1.65, 0);
  player.vel.set(0,0,0);
  player.onGround = true;
  player._dead = false;
  // 清掉"从 overlay 进背包"的状态标记，防止下次背包关闭时误回死亡画面
  _invFromOverlay = null;

  // 隐藏死亡画面（不要显示开始菜单）
  overlay.style.display = 'none';
  clearOverlayState();

  // 重新开打：先解暂停，再尝试锁定鼠标
  gamePaused = false;
  // 由用户的点击事件触发，浏览器允许 lock
  try { controls.lock(); } catch(_) {}

  toast('复活！2 秒无敌');
  // 立刻再来一波，但保留当前波次（不推进）。spawnWave 末尾在非最终波时会 waveLevel++，
  // 这里先 -1 让它增回原值，避免"每死一次跳一波"的体感；最终波本身不自增，不需修正
  if(waveLevel !== FINAL_BOSS_WAVE){
    waveLevel = Math.max(1, waveLevel - 1);
  }
  spawnWave();
}

function findBestTarget(maxRange,preferFOV=false){
  // 锁定玩家面前一个锥形范围内的敌人（水平面投影）
  // v0.33 起：dot 阈值从 0(180°) 收紧到 0.5(约 120° FOV) ——
  // 玩家不"看"的敌人不被锁定，逼玩家滑动视角对准目标才能输出，找回 FPS 操作感
  const FOV_DOT = 0.5;            // cos(60°) = 0.5 → 前方 120° 锥形
  const cam=controls.getObject().position;
  const fwd=new THREE.Vector3();camera.getWorldDirection(fwd);
  // 投影到水平面（忽略 pitch 抬头/低头），用 xz 方向判断"前方"
  const fwdXZ = new THREE.Vector3(fwd.x, 0, fwd.z);
  if(fwdXZ.lengthSq()<1e-6) fwdXZ.set(0,0,-1);
  fwdXZ.normalize();
  let bestFOV=null,bestFOVD=Infinity;
  let bestAny=null,bestAnyD=Infinity;
  for(const e of enemies){
    if(e.hp<=0)continue;
    const d=e.mesh.position.distanceTo(cam);
    if(d>maxRange)continue;
    // 只考虑视野锥内的敌人
    const toXZ = new THREE.Vector3(
      e.mesh.position.x - cam.x, 0,
      e.mesh.position.z - cam.z
    );
    if(toXZ.lengthSq()<1e-6) continue;
    toXZ.normalize();
    const dot = fwdXZ.dot(toXZ);
    if(dot < FOV_DOT) continue;     // 不在视野锥内 → 跳过
    if(d<bestAnyD){bestAnyD=d;bestAny=e;}
    if(preferFOV){
      // 更严格的中心视野（约 60° 锥）的进一步偏好
      if(dot>0.85 && d<bestFOVD){bestFOVD=d;bestFOV=e;}
    }
  }
  return preferFOV ? (bestFOV||bestAny) : bestAny;
}

// 计算"瞄向目标"的方向（自动瞄准核心）
function aimAt(target,origin){
  const tp=target.mesh.position.clone();
  tp.y=1.5; // 瞄向敌人胸口
  return tp.sub(origin).normalize();
}

function castSkill(skill){
  if(player.mp<skill.mp)return false;
  const origin=controls.getObject().position.clone();origin.y=1.5;
  const camDir=new THREE.Vector3();camera.getWorldDirection(camDir);
  // 准星方向（水平投影）：无锁定目标时，攻击技能朝此方向释放
  const aimDir=new THREE.Vector3(camDir.x,0,camDir.z);
  if(aimDir.lengthSq()<1e-6) aimDir.set(0,0,-1);
  aimDir.normalize();

  if(skill.type==='melee'){
    player.mp-=skill.mp;
    Audio.cast_melee();
    const t=findBestTarget(skill.range,true);
    if(t){
      damageEnemy(t,calcPlayerDamage(skill),true);
      t.knockback.copy(t.mesh.position.clone().sub(origin).setY(0).normalize().multiplyScalar(2));
      flashAt(t.mesh.position.clone().setY(2),skill.color);
    }else{
      // 无目标：朝准星前方挥击，命中前方范围内的敌人（空挥也消耗法力与特效）
      const fx=origin.clone().add(aimDir.clone().multiplyScalar(Math.min(skill.range,3.5)));
      enemies.forEach(e=>{if(e.hp<=0)return;if(e.mesh.position.distanceTo(fx)<=2.2)damageEnemy(e,calcPlayerDamage(skill),true);});
      flashAt(fx.setY(1.8),skill.color);
    }
    return true;
  }
  if(skill.type==='proj'){
    player.mp-=skill.mp;
    Audio.cast_proj();
    const t=findBestTarget(skill.range,true);
    const dir=t?aimAt(t,origin):aimDir.clone();
    shootProjectile({origin,dir,color:skill.color,range:skill.range,speed:32,scale:.3,kind:skill.key,
      hit:e=>{const d=calcPlayerDamage(skill);damageEnemy(e,d);
        if(skill.key==='iceshard')e.slow=2;
        if(skill.key==='fireball')spawnAoe(e.mesh.position.clone(),3,()=>calcPlayerDamage(skill),0xff5a1a,.4);}});
    return true;
  }
  if(skill.type==='multi'){
    player.mp-=skill.mp;
    Audio.cast_proj();
    const t=findBestTarget(skill.range,true);
    const baseDir=t?aimAt(t,origin):aimDir.clone();
    // 能力buff：额外投射物
    const extraProj = (player._skillBuffs && player._skillBuffs.extraProj) || 0;
    const totalProj = 3 + extraProj;
    const half = Math.floor(totalProj / 2);
    const angleStep = totalProj > 5 ? 0.13 : 0.18; // 弹数多时缩小角度间距
    for(let i=-half;i<=half;i++){
      const d2=baseDir.clone().applyAxisAngle(new THREE.Vector3(0,1,0),i*angleStep);
      shootProjectile({origin,dir:d2,color:skill.color,range:skill.range,speed:42,scale:.18,kind:'arrow',
        hit:e=>damageEnemy(e,calcPlayerDamage(skill))});
    }return true;
  }
  if(skill.type==='pierce'){
    player.mp-=skill.mp;
    Audio.cast_proj();
    const t=findBestTarget(skill.range,true);
    const dir=t?aimAt(t,origin):aimDir.clone();
    shootProjectile({origin,dir,color:skill.color,range:skill.range,speed:45,scale:.18,pierce:true,kind:'bolt',
      hit:e=>damageEnemy(e,calcPlayerDamage(skill))});
    return true;
  }
  if(skill.type==='aoe'){
    player.mp-=skill.mp;
    Audio.cast_aoe();
    const t=findBestTarget(skill.range,true);
    const target=t?t.mesh.position.clone().setY(0)
                  :origin.clone().add(aimDir.clone().multiplyScalar(Math.min(skill.range,8))).setY(0);
    const warn=new THREE.Mesh(new THREE.RingGeometry(2.5,3,32),new THREE.MeshBasicMaterial({color:skill.color,side:THREE.DoubleSide,transparent:true,opacity:.6}));
    warn.rotation.x=-Math.PI/2;warn.position.copy(target);warn.position.y=.05;scene.add(warn);
    setTimeout(()=>{scene.remove(warn);spawnAoe(target,3.2,()=>calcPlayerDamage(skill),skill.color,.5);flashAt(target.clone().setY(1.5),skill.color,3);},700);
    return true;
  }
  if(skill.type==='nova'){
    player.mp-=skill.mp;
    Audio.cast_nova();
    const c=controls.getObject().position.clone();c.y=0;
    spawnAoe(c,skill.range,()=>calcPlayerDamage(skill),skill.color,.5);
    flashAt(controls.getObject().position.clone(),skill.color,4);return true;
  }
  if(skill.type==='chain'){
    player.mp-=skill.mp;
    Audio.cast_chain();
    let cur=findBestTarget(skill.range,true);
    if(!cur){
      // 无目标：朝准星前方放一道空闪电
      drawLightning(origin.clone(),origin.clone().add(aimDir.clone().multiplyScalar(skill.range)),skill.color);
      return true;
    }
    const hit=new Set();let last=origin.clone(),left=4;
    while(cur&&left>0){
      hit.add(cur);damageEnemy(cur,calcPlayerDamage(skill));
      drawLightning(last,cur.mesh.position.clone().setY(1.5),skill.color);
      last=cur.mesh.position.clone().setY(1.5);
      let n=null,bd=8;
      enemies.forEach(e=>{if(hit.has(e)||e.hp<=0)return;const d=e.mesh.position.distanceTo(last);if(d<bd){bd=d;n=e;}});
      cur=n;left--;
    }return true;
  }
  // ---------- 防御性技能 ----------
  if(skill.type==='heal'){
    // 仅在生命不满（低于 60%）时才值得释放，避免浪费
    if(player.hp >= player.hpMax*0.6) return false;
    player.mp-=skill.mp;
    Audio.cast_nova && Audio.cast_nova();
    const amt = rand(skill.heal[0],skill.heal[1]) + (player._intTotal||0)*0.8;
    heal(amt);
    const pos=controls.getObject().position.clone();
    flashAt(pos.clone().setY(1.5),skill.color,2.2);
    toast('✚ 治疗 +'+Math.round(amt));
    refreshInfo();
    return true;
  }
  if(skill.type==='shield'){
    // 已有护盾时不重复施放
    if((player.shield||0)>0) return false;
    player.mp-=skill.mp;
    Audio.cast_nova && Audio.cast_nova();
    const amt = rand(skill.shield[0],skill.shield[1]) + (player._intTotal||0)*0.8;
    player.shield=amt; player.shieldMax=amt; player.shieldT=skill.dur;
    flashAt(controls.getObject().position.clone().setY(1.5),skill.color,2.6);
    toast('🛡 护盾 +'+Math.round(amt));
    refreshInfo();
    return true;
  }
  if(skill.type==='haste'){
    // 减伤姿态：仅在生命低于 55% 时触发，作为危急保命
    if((player.hasteT||0)>0) return false;
    if(player.hp >= player.hpMax*0.55) return false;
    player.mp-=skill.mp;
    Audio.cast_nova && Audio.cast_nova();
    player.hasteT=skill.dur; player.dmgReduce=skill.reduce;
    flashAt(controls.getObject().position.clone().setY(1.5),skill.color,2.6);
    toast('🪖 铁壁姿态：减伤 '+Math.round(skill.reduce*100)+'%');
    return true;
  }
  return false;
}
function drawLightning(a,b,color){
  const pts=[];const seg=8;
  for(let i=0;i<=seg;i++){const t=i/seg;const p=a.clone().lerp(b,t);if(i&&i!==seg){p.x+=rand(-.4,.4);p.y+=rand(-.4,.4);p.z+=rand(-.4,.4);}pts.push(p);}
  // 用 TubeGeometry 画出有粗细的闪电（LineBasicMaterial.linewidth 在 WebGL 里基本无效，永远 1px）
  const curve=new THREE.CatmullRomCurve3(pts);
  // 主体：实心亮管
  const coreGeo=new THREE.TubeGeometry(curve, 20, 0.10, 6, false);
  const core=new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({color, transparent:true, opacity:1}));
  // 外发光：更粗的半透明管，营造电弧光晕
  const glowGeo=new THREE.TubeGeometry(curve, 20, 0.26, 6, false);
  const glow=new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({color, transparent:true, opacity:0.35, depthWrite:false}));
  scene.add(core); scene.add(glow);
  setTimeout(()=>{
    scene.remove(core); coreGeo.dispose(); core.material.dispose();
    scene.remove(glow); glowGeo.dispose(); glow.material.dispose();
  },150);
}
function flashAt(pos,color,size=1.5){
  // 性能保护：PerfMon 关闭粒子时（极低帧/低端机）跳过闪光特效，但技能本身逻辑不受影响
  if(typeof PerfMon!=='undefined' && !PerfMon.particlesOn()) return;
  const m=new THREE.Mesh(new THREE.SphereGeometry(size,12,12),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.6}));
  m.position.copy(pos);scene.add(m);
  let t=0;const id=setInterval(()=>{t+=.05;m.scale.setScalar(1+t*2);m.material.opacity=Math.max(0,.6-t);if(t>=.6){clearInterval(id);scene.remove(m);}},20);
}

// ---------- UI ----------
// 同步 body 的 uiShow class：暂停/背包/合成/镶嵌打开时显示属性面板等 UI
function syncUiShow(){
  const show = !!gamePaused;
  document.body.classList.toggle('uiShow', show);
}
function refreshInfo(){
  document.getElementById('charLvl').textContent=player.level;
  document.getElementById('sStr').textContent=player._strTotal||player.str;
  document.getElementById('sDex').textContent=player._dexTotal||player.dex;
  document.getElementById('sInt').textContent=player._intTotal||player.int;
  document.getElementById('sArm').textContent=Math.floor(player.armor);
  document.getElementById('hpFill').style.height=(player.hp/player.hpMax*100)+'%';
  document.getElementById('mpFill').style.height=(player.mp/player.mpMax*100)+'%';
  // 护盾 / 铁壁姿态状态后缀（有则在 HP 标签后提示）
  let _suffix='';
  if((player.shield||0)>0) _suffix+=' 🛡'+Math.ceil(player.shield);
  if((player.hasteT||0)>0) _suffix+=' 🪖';
  document.getElementById('hpLbl').textContent=Math.ceil(player.hp)+'/'+Math.ceil(player.hpMax)+_suffix;
  document.getElementById('mpLbl').textContent=Math.ceil(player.mp)+'/'+Math.ceil(player.mpMax);
  document.getElementById('expFill').style.width=(player.exp/player.expNeed*100)+'%';
  // 流派分布显示（属性面板内）
  const classEl = document.getElementById('sClass');
  if(classEl && typeof getClassMastery==='function'){
    const m = getClassMastery();
    const parts = CLASS_KEYS.map(k=>{
      const cls = CLASS_DB[k];
      const c = m.count[k]||0;
      const isActive = m.active===k;
      return `<span style="color:${c>0?cls.color:'#666'};font-weight:${isActive?'bold':'normal'}${isActive?';text-shadow:0 0 6px '+cls.color:''}">${cls.icon}${c}</span>`;
    }).join(' / ');
    const masteryLabel = m.active ? `<span style="color:${CLASS_DB[m.active].color};font-size:11px;margin-left:6px">★ ${CLASS_DB[m.active].name}精通</span>` : '';
    classEl.innerHTML = parts + masteryLabel;
  }
  syncUiShow();
}
function refreshSkillBar(){
  const wrap=document.getElementById('skills');wrap.innerHTML='';
  // 技能栏无限：显示所有技能（最少 4 格保留视觉对齐）
  const n = Math.max(4, player.skills.length);
  
  // 根据技能数量动态调整技能格尺寸
  let slotSize = 62;
  let fontSize = 11;
  let icoSize = 22;
  if(n > 12) { slotSize = 48; fontSize = 10; icoSize = 18; }
  else if(n > 8) { slotSize = 56; fontSize = 10; icoSize = 20; }
  
  // 设置动态样式
  const styleId = 'dynamicSkillStyle';
  let styleEl = document.getElementById(styleId);
  if(!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = `
    #skills .slot {
      width: ${slotSize}px !important;
      height: ${slotSize}px !important;
      font-size: ${fontSize}px !important;
    }
    #skills .slot .ico { font-size: ${icoSize}px !important; }
  `;
  
  for(let i=0;i<n;i++){
    const s=player.skills[i];
    const d=document.createElement('div');
    d.className='slot'+(i===player.activeSkill?' active':'');
    if(s){
      d.innerHTML=`<div><div class="ico">${s.ico}</div><div>${s.name}</div></div><div class="cd" id="cd_${i}"></div>`;
      d.style.cursor='help';
      // 悬停显示技能描述
      d.onmouseenter = e=>{ showSkillTip(s, e.clientX, e.clientY); };
      d.onmousemove  = e=>{ showSkillTip(s, e.clientX, e.clientY); };
      d.onmouseleave = ()=>{ hideTip(); };
    } else {
      d.innerHTML='<div style="color:#444">空</div>';
    }
    wrap.appendChild(d);
  }
}
// 渲染技能描述 tip 的 HTML
function skillTipHtml(s){
  const cn={melee:'近战',proj:'弹道',chain:'连锁',multi:'多重',pierce:'穿透',aoe:'范围',nova:'新星',heal:'治疗',shield:'护盾',haste:'增益'};
  let html=`<div style="color:#ffd97a;font-weight:bold">${s.ico} ${s.name}</div>`;
  html+=`<div style="color:#888;font-size:11px;margin:2px 0 6px">${cn[s.type]||s.type} · 冷却 ${s.cd}s · 法力 ${s.mp}</div>`;
  // 数值信息
  const rows=[];
  if(s.dmg)   rows.push(`伤害：<span style="color:#ff8a6a">${s.dmg[0]}~${s.dmg[1]}</span>`);
  if(s.heal)  rows.push(`治疗：<span style="color:#7bd96a">${s.heal[0]}~${s.heal[1]}</span>`);
  if(s.shield)rows.push(`护盾：<span style="color:#6ad6ff">${s.shield[0]}~${s.shield[1]}</span>`);
  if(s.reduce)rows.push(`减伤：<span style="color:#e8c45a">${Math.round(s.reduce*100)}%</span>`);
  if(s.dur)   rows.push(`持续：<span style="color:#cbd">${s.dur}s</span>`);
  if(s.range) rows.push(`范围：<span style="color:#cbd">${s.range}</span>`);
  if(rows.length) html+=`<div style="font-size:12px;line-height:1.6">${rows.join('　')}</div>`;
  if(s.desc) html+=`<div style="color:#aaa;font-size:11px;margin-top:6px;line-height:1.5;max-width:240px">${s.desc}</div>`;
  return html;
}
function showSkillTip(s,x,y){
  if(fusePanelEl && fusePanelEl.style.display==='flex'){ hideTip(); return; }
  tipCmpEl.style.display='none';
  tipEl.innerHTML=skillTipHtml(s);
  tipEl.style.display='block';
  tipEl.style.left='-9999px';
  tipEl.style.top='-9999px';
  const tw=tipEl.offsetWidth||220, th=tipEl.offsetHeight||120;
  // 技能栏在底部，tip 默认放光标上方
  let tx=x+14; if(tx+tw>innerWidth-4) tx=Math.max(4,x-14-tw);
  let ty=y-14-th; if(ty<4) ty=Math.min(innerHeight-th-4,y+14);
  tx=Math.max(4,Math.min(tx,innerWidth-tw-4));
  ty=Math.max(4,Math.min(ty,innerHeight-th-4));
  tipEl.style.left=tx+'px';
  tipEl.style.top =ty+'px';
}
// 手柄无鼠标光标：LT 查看当前选中技能的描述，居中显示在技能栏上方，数秒后自动隐藏
let _skillDescTimer = null;
function showActiveSkillDesc(){
  const s = player.skills[player.activeSkill];
  if(!s){ toast('当前技能槽为空'); return; }
  tipCmpEl.style.display='none';
  tipEl.innerHTML=skillTipHtml(s);
  tipEl.style.display='block';
  tipEl.style.left='-9999px';
  tipEl.style.top='-9999px';
  const tw=tipEl.offsetWidth||240, th=tipEl.offsetHeight||140;
  // 居中、贴近底部技能栏上方
  const tx=Math.max(4,Math.min((innerWidth-tw)/2, innerWidth-tw-4));
  const ty=Math.max(4, innerHeight-th-150);
  tipEl.style.left=tx+'px';
  tipEl.style.top =ty+'px';
  if(_skillDescTimer) clearTimeout(_skillDescTimer);
  _skillDescTimer=setTimeout(()=>{ hideTip(); _skillDescTimer=null; }, 4000);
}
function refreshEquip(){
  const slots = [['eqWeapon','weapon'],['eqHelm','helm'],['eqArmor','armor'],['eqRing','ring']];
  slots.forEach(([id, slot])=>{
    const el = document.getElementById(id);
    if(!el) return;
    const v = player.equip[slot];
    if(!v){
      el.innerHTML = '—';
      el.onmouseenter = null;
      el.onmousemove  = null;
      el.onmouseleave = null;
      el.oncontextmenu = null;
      el.style.cursor = 'default';
      return;
    }
    el.innerHTML = `<span style="color:${v.quality.color}">${v.name}</span>`;
    el.style.cursor = 'help';
    el.classList.add('eqSlot');     // 用于触屏点击识别
    // 悬停显示 tip
    el.onmouseenter = e=>{ showTip(v, e.clientX, e.clientY); };
    el.onmousemove  = e=>{ showTip(v, e.clientX, e.clientY); };
    el.onmouseleave = ()=>{ hideTip(); };
    // 触屏点击：显示持久 tip + 卸下按钮
    el.onclick = (ev)=>{
      if(InputMode && InputMode.current==='touch'){
        ev.stopPropagation();
        const r = el.getBoundingClientRect();
        // 临时把已穿戴装备显示为 tip + 卸下按钮，类似背包格
        showTip(v, r.right, r.top);
        if(tipEl.style.display!=='none'){
          let actEl = tipEl.querySelector('#tipActions');
          if(actEl) actEl.remove();
          actEl = document.createElement('div'); actEl.id = 'tipActions';
          const mkBtn = (lbl, fn, cls)=>{
            const b=document.createElement('button'); b.textContent=lbl;
            if(cls) b.className=cls;
            const stop=(e)=>{ e.stopPropagation(); e.preventDefault && e.preventDefault(); fn(); };
            b.addEventListener('click', stop);
            b.addEventListener('touchstart', stop, {passive:false});
            return b;
          };
          actEl.appendChild(mkBtn('卸下', ()=>{
            if(player.inv.length >= INV_CAP){ toast('背包已满，无法卸下'); return; }
            player.inv.push(v);
            player.equip[slot] = null;
            hideTip(); applyEquipStats(); rebuildInv();
            toast(`卸下：${v.name}`);
          }, 'danger'));
          actEl.appendChild(mkBtn('关闭', ()=>{ hideTip(); }));
          tipEl.appendChild(actEl);
        }
      }
    };
    // 右键卸下到背包（有空位时）
    el.oncontextmenu = e=>{
      e.preventDefault();
      if(player.inv.length >= INV_CAP){ toast('背包已满，无法卸下'); return; }
      player.inv.push(v);
      player.equip[slot] = null;
      hideTip();
      applyEquipStats();
      rebuildInv();
      toast(`卸下：${v.name}`);
      Audio.uiClick && Audio.uiClick();
    };
  });
}
const tipEl=document.getElementById('tip');
const tipCmpEl=document.getElementById('tipCmp');

// 记录鼠标实时位置 + 当前悬停的背包格 index
let _mouseX=0,_mouseY=0,_hoverIdx=-1;
document.addEventListener('mousemove',e=>{
  // 只有鼠标真正发生位移时才视作"用户切回鼠标"
  const dx = e.clientX - _mouseX, dy = e.clientY - _mouseY;
  _mouseX=e.clientX; _mouseY=e.clientY;
  // 背包用手柄打开后，只要鼠标动了一下就立刻退出"手柄独占"模式
  // 让鼠标光标重新可见、hover 重新生效，无需关背包再开
  if((dx||dy) && document.body.classList.contains('pad-inv-open')){
    document.body.classList.remove('pad-inv-open');
    // 同时把手柄绿色光标也清掉，避免"双光标"造成视觉混乱
    padCursor = -1;
    const grid=document.getElementById('invGrid');
    if(grid) grid.querySelectorAll('.invSlot.padCursor').forEach(el=>el.classList.remove('padCursor'));
    hideTip();
  }
});

// 渲染单件物品的 tip HTML
// 部位中文名
const SLOT_CN = {weapon:'武器',helm:'头盔',armor:'护甲',ring:'戒指'};

function itemTipHtml(it, title){
  let html='';
  if(title) html+=`<div style="color:#888;font-size:11px;margin-bottom:2px">${title}</div>`;
  html+=`<div style="color:${it.quality.color};font-weight:bold">${it.name}</div>`;
  // 宝石的 tip：单独样式
  if(it.isGem){
    html+=`<div style="color:#888">宝石 · ${GEM_GRADES[it.grade].name}级</div>`;
    html+=`<div style="color:${it.quality.color}">${it.label}</div>`;
    html+=`<div style="color:#888;font-size:11px;margin-top:6px;line-height:1.5">点击打开镶嵌面板，<br/>把它嵌入装备的孔位中</div>`;
    return html;
  }
  // 背包扩容卷轴：单独样式
  if(it.special==='bagExpand'){
    html+=`<div style="color:#888">特殊消耗品</div>`;
    html+=`<div style="color:${it.quality.color}">使用后永久 +${it.expandBy||4} 背包格</div>`;
    html+=`<div style="color:#888;font-size:11px;margin-top:6px;line-height:1.5">点击 / A 立即使用<br/>当前背包容量：${INV_CAP}</div>`;
    return html;
  }
  // 血瓶 / 蓝瓶
  if(it.special==='hpPotion'){
    const heal = Math.floor(player.hpMax * (it.healPct||0.5));
    html+=`<div style="color:#888">消耗品 · 药水</div>`;
    html+=`<div style="color:${it.quality.color}">恢复 ${Math.round((it.healPct||0.5)*100)}% 最大生命（≈${heal}）</div>`;
    html+=`<div style="color:#888;font-size:11px;margin-top:6px;line-height:1.5">点击 / A 立即使用<br/>快捷键：<b style="color:#fff">Q</b></div>`;
    return html;
  }
  if(it.special==='mpPotion'){
    const heal = Math.floor(player.mpMax * (it.manaPct||0.5));
    html+=`<div style="color:#888">消耗品 · 药水</div>`;
    html+=`<div style="color:${it.quality.color}">恢复 ${Math.round((it.manaPct||0.5)*100)}% 最大法力（≈${heal}）</div>`;
    html+=`<div style="color:#888;font-size:11px;margin-top:6px;line-height:1.5">点击 / A 立即使用<br/>快捷键：<b style="color:#fff">E</b></div>`;
    return html;
  }
  // 经验之书：单独样式
  if(it.special==='expTome'){
    html+=`<div style="color:#888">消耗品 · 经验</div>`;
    html+=`<div style="color:${it.quality.color}">使用后立即获得 ${it.exp||0} 点经验</div>`;
    html+=`<div style="color:#888;font-size:11px;margin-top:6px;line-height:1.5">点击 / A 立即研读</div>`;
    return html;
  }
  html+=`<div style="color:#888">${it.quality.name} · iLvl ${it.iLvl} · ${SLOT_CN[it.slot]||it.slot}</div>`;
  // 流派标签：醒目色彩条，点击查看精通效果
  if(it.classTag && CLASS_DB[it.classTag]){
    const cls = CLASS_DB[it.classTag];
    html+=`<div class="classTagTip" data-ctag="${it.classTag}" style="display:inline-block;margin:3px 0;padding:2px 8px;background:rgba(0,0,0,.4);border:1px solid ${cls.color};border-radius:3px;color:${cls.color};font-size:11px;letter-spacing:1px;cursor:pointer">${cls.icon} ${cls.name}流派</div>`;
  }
  if(it.dmgMin)html+=`<div>伤害 ${it.dmgMin}-${it.dmgMax}</div>`;
  if(it.armor)html+=`<div>护甲 +${it.armor}</div>`;
  it.affixes.forEach(a=>html+=`<div style="color:var(--blue)">${a.label}</div>`);
  // 宝石孔位：显示孔状态和已镶嵌的宝石
  if(it.sockets && it.sockets>0){
    const slotsHtml = (it.gems||[]).map(g=>{
      if(g) return `<span title="${g.name} ${g.label}" style="color:${g.quality.color};border:1px solid ${g.quality.color};padding:0 3px;border-radius:2px">${g.icon}</span>`;
      return `<span style="color:#666;border:1px solid #444;padding:0 3px;border-radius:2px">◇</span>`;
    }).join(' ');
    html+=`<div style="margin-top:4px;color:#aaa;font-size:11px">孔位 (${(it.gems||[]).filter(g=>g).length}/${it.sockets})：${slotsHtml}</div>`;
    // 显示已嵌宝石的属性合计
    const gemBonuses = (it.gems||[]).filter(g=>g);
    if(gemBonuses.length>0){
      html+=`<div style="color:#bdf;font-size:11px;margin-top:2px">宝石加成：${gemBonuses.map(g=>g.label).join('、')}</div>`;
    }
  }
  if(it.skills)html+=`<div style="color:var(--orange)">技能：${it.skills.map(k=>SKILL_DB[k].name).join('、')}</div>`;
  // 套装信息块
  if(it.setKey && SET_DB[it.setKey]){
    const def = SET_DB[it.setKey];
    const have = (player._setCount && player._setCount[it.setKey]) || 0;
    const total = def.pieces.length;
    html+=`<div style="margin-top:6px;padding-top:6px;border-top:1px dashed #444">`;
    html+=`<div style="color:${def.color};font-weight:bold">${def.name}套装 (${have}/${total})</div>`;
    // 列出全部部位 + 哪些已穿
    html+=`<div style="color:#888;font-size:11px;margin:2px 0">部位：`+
      def.pieces.map(p=>{
        const wearing = player.equip[p] && player.equip[p].setKey===it.setKey;
        return `<span style="color:${wearing?def.color:'#666'}">${SLOT_CN[p]}${wearing?'✓':''}</span>`;
      }).join(' / ')+`</div>`;
    // 列出每档加成，已激活高亮
    Object.keys(def.bonuses).forEach(req=>{
      const r=+req;
      const active = have>=r;
      const color = active ? def.color : '#666';
      const mark  = active ? '◆' : '◇';
      html+=`<div style="color:${color};font-size:11px">${mark} ${r}件套：${def.bonuses[req].desc}</div>`;
    });
    html+=`</div>`;
  }
  return html;
}

// 装备对比摘要：返回顶部 highlight box，只列变化最大的 3-5 行核心数值
// 设计目标：玩家一眼就能看出"这件装备换上后强了多少 / 哪些属性涨/降"
// 仅在 a (新装备 ≠ cur 已装备)、同 slot 时使用
function itemCompareSummary(it, cur){
  if(!it || !it.slot || it.special || it.isGem) return '';
  // 计算关键数值
  const ait = {
    dmgMin: it.dmgMin||0, dmgMax: it.dmgMax||0,
    armor: it.armor||0, dmgPct: 0, critChance: 0, critDmg: 0,
    lifeOnHit:0, hpMax:0, str:0, dex:0, int:0,
  };
  const acur = cur ? {
    dmgMin: cur.dmgMin||0, dmgMax: cur.dmgMax||0,
    armor: cur.armor||0, dmgPct: 0, critChance: 0, critDmg: 0,
    lifeOnHit:0, hpMax:0, str:0, dex:0, int:0,
  } : null;
  // 把 affixes 累计进各自 obj（含宝石）
  function accumulate(obj, target){
    if(!obj) return;
    (obj.affixes||[]).forEach(a=>{ if(target[a.k]!=null) target[a.k]+=a.v; });
    (obj.gems||[]).forEach(g=>{ if(g && target[g.statKey]!=null) target[g.statKey]+=g.statValue; });
  }
  accumulate(it, ait);
  if(cur) accumulate(cur, acur);
  // 评分
  const sNew = Math.round(itemScore(it));
  const sCur = cur ? Math.round(itemScore(cur)) : 0;
  // 词条 → 文案 + 颜色
  const ROWS = [
    {key:'dmg',  label:'伤害',   compute:(o)=> (o.dmgMin+o.dmgMax)/2, fmt:(v)=>v.toFixed(0)},
    {key:'armor',label:'护甲',   compute:(o)=> o.armor,                fmt:(v)=>v.toFixed(0)},
    {key:'dmgPct',label:'伤害%', compute:(o)=> o.dmgPct,               fmt:(v)=>v.toFixed(0)+'%'},
    {key:'critChance',label:'暴击率', compute:(o)=> o.critChance,      fmt:(v)=>v.toFixed(0)+'%'},
    {key:'critDmg',label:'暴伤',  compute:(o)=> o.critDmg,             fmt:(v)=>v.toFixed(0)+'%'},
    {key:'lifeOnHit',label:'命中回血', compute:(o)=> o.lifeOnHit,      fmt:(v)=>v.toFixed(0)},
    {key:'hpMax',label:'生命',    compute:(o)=> o.hpMax,               fmt:(v)=>v.toFixed(0)},
    {key:'str',  label:'力量',    compute:(o)=> o.str,                 fmt:(v)=>v.toFixed(0)},
    {key:'dex',  label:'敏捷',    compute:(o)=> o.dex,                 fmt:(v)=>v.toFixed(0)},
    {key:'int',  label:'智力',    compute:(o)=> o.int,                 fmt:(v)=>v.toFixed(0)},
  ];
  const lines = [];
  for(const r of ROWS){
    const newV = r.compute(ait);
    const curV = acur ? r.compute(acur) : 0;
    if(newV===0 && curV===0) continue;
    const d = newV - curV;
    if(Math.abs(d) < 0.5 && newV===0) continue;
    const arrow = d>0.5 ? `<span style="color:#7bd96a">↑+${r.fmt(d)}</span>`
                : d<-0.5 ? `<span style="color:#ff7070">↓${r.fmt(d)}</span>`
                : `<span style="color:#888">—</span>`;
    lines.push(`<div style="display:flex;font-size:12px;line-height:1.55">`+
               `<b style="color:#ddd;min-width:58px;flex-shrink:0">${r.label}</b>`+
               `<span><span style="color:#888">${r.fmt(curV)} → </span><b style="color:#fff">${r.fmt(newV)}</b>　${arrow}</span>`+
               `</div>`);
    if(lines.length>=6) break;   // 控制最多 6 行
  }
  // 评分行（核心）
  const scoreLine = `<div style="display:flex;font-size:13px;line-height:1.55;margin-top:4px;padding-top:4px;border-top:1px solid #3a2f18">`+
                    `<b style="color:var(--gold);min-width:58px;flex-shrink:0">评分</b>`+
                    `<span><b style="color:#fff">${sCur}</b><span style="color:#888"> → </span><b style="color:var(--gold)">${sNew}</b></span>`+
                    `</div>`;
  if(lines.length===0 && !cur){
    // 新装备且无对比 → 仍显示评分 + 提示
    return `<div class="cmpSummary" style="margin:6px -2px 8px;padding:8px 10px;background:rgba(232,196,90,.08);border:1px solid #6b5a2b;border-radius:5px">`+
           scoreLine + `</div>`;
  }
  if(lines.length===0) return '';
  return `<div class="cmpSummary" style="margin:6px -2px 8px;padding:8px 10px;background:rgba(232,196,90,.08);border:1px solid #6b5a2b;border-radius:5px">`+
         lines.join('') + scoreLine + `</div>`;
}

function showTip(it,x,y){
  // 合成面板打开时不要显示物品 tip，避免遮挡
  if(fusePanelEl && fusePanelEl.style.display==='flex'){ hideTip(); return; }
  // 桌面/手柄模式：tip 顶部加属性对比摘要（与触屏分支保持视觉一致）
  let _summaryPrefix = '';
  if(it && it.slot && !it.isGem && !it.special){
    const _curEq = player.equip[it.slot];
    _summaryPrefix = itemCompareSummary(it, _curEq);
  }
  tipEl.innerHTML = _summaryPrefix + itemTipHtml(it);
  // 流派标签点击事件：显示精通效果（确保可交互）
  (function bindClassTagTip(){
    const tags = tipEl.querySelectorAll('.classTagTip');
    tags.forEach(tag=>{
      // 强制设置可交互样式（覆盖父元素可能的 pointer-events:none）
      tag.style.pointerEvents = 'auto';
      tag.style.cursor = 'pointer';
      const handler = (e)=>{
        e.stopPropagation();
        e.preventDefault();
        const ckey = tag.getAttribute('data-ctag');
        if(!ckey || !CLASS_DB[ckey]) return;
        const cls = CLASS_DB[ckey];
        // 统计当前已装备的同流派数量
        let count = 0;
        ['weapon','helm','armor','ring'].forEach(s=>{
          const eq = player.equip[s];
          if(eq && eq.classTag === ckey) count++;
        });
        const masteryInfo = cls.mastery;
        const activeMark = count >= 4 ? ' ✅ 已激活' : ` (${count}/4)`;
        toast(`${cls.icon} ${cls.name}流派${activeMark}\n${masteryInfo}`, 2500);
      };
      tag.addEventListener('click', handler);
      tag.addEventListener('touchend', handler, {passive:false});
      tag.addEventListener('mousedown', (e)=>{ e.preventDefault(); }, {passive:false});
    });
    // 同步绑定对比面板(tipCmp)中的流派标签
    setTimeout(()=>{
      const cmpTags = document.querySelectorAll('#tipCmp .classTagTip');
      cmpTags.forEach(tag=>{
        tag.style.pointerEvents = 'auto';
        tag.style.cursor = 'pointer';
        tag.onclick = ()=> {
          const ckey = tag.getAttribute('data-ctag');
          if(!ckey || !CLASS_DB[ckey]) return;
          const cls = CLASS_DB[ckey];
          let count = 0;
          ['weapon','helm','armor','ring'].forEach(s=>{ const eq=player.equip[s]; if(eq&&eq.classTag===ckey) count++; });
          toast(`${cls.icon} ${cls.name}流派${count>=4?' ✅ 已激活':` (${count}/4)`}\n${cls.mastery}`, 2500);
        };
      });
    }, 0);
  })();
  // 先让 tip 显示出来才能测量真实尺寸
  tipEl.style.display='block';
  tipEl.style.left='-9999px';   // 临时隐藏出屏幕，避免一帧闪烁
  tipEl.style.top='-9999px';

  // ============ 触屏模式：居中模态布局，主 tip 在上，对比 tip 在下 ============
  if(InputMode && InputMode.current==='touch'){
    // 关键决策：tipEl 自身不滚动；用其内部一个 div.tipScroll 做滚动。
    // 这样 fixed 钉底按钮区的渲染不依赖 tipEl 是否在滚动，规避 iOS 渲染 bug。
    const w = Math.min(360, innerWidth - 24);
    tipEl.style.width = w + 'px';
    tipEl.style.maxWidth = w + 'px';
    tipEl.style.maxHeight = '';
    tipEl.style.overflowY = 'hidden';
    tipEl.style.left = ((innerWidth - w)/2) + 'px';
    tipEl.style.top  = '4vh';
    tipEl.style.bottom = '100px';   // 留 100px 给 fixed 按钮区
    // 顶部摘要 + itemTipHtml 内容包进可滚动子 div（tipEl 自身不滚）
    const curEq = (it.slot && !it.isGem && !it.special) ? player.equip[it.slot] : null;
    const summary = (it.slot && !it.isGem && !it.special) ? itemCompareSummary(it, curEq) : '';
    const innerHtml = summary + itemTipHtml(it);
    tipEl.innerHTML = `<div class="tipScroll" style="height:100%;overflow-y:auto;-webkit-overflow-scrolling:touch;padding-right:4px">${innerHtml}</div>`;
    const scrollBox = tipEl.querySelector('.tipScroll');
    // 对比当前同槽装备：拼到 tipScroll 末尾（不显示冗余的"当前已装备"标题行，顶部摘要已有评分对比）
    const cur = it.slot ? player.equip[it.slot] : null;
    if(cur && cur!==it){
      const html =
        `<div style="margin:10px -10px 8px;padding:6px 10px;`+
        `background:linear-gradient(90deg,transparent,rgba(232,196,90,.15),transparent);`+
        `border-top:2px solid var(--gold);`+
        `border-bottom:2px solid var(--gold);`+
        `</div>`+
        itemTipHtml(cur);
      if(scrollBox) scrollBox.innerHTML += html;
    }
    // 触屏模式也需要绑定流派标签点击事件（innerHTML 在此路径才最终确定）
    (function bindClassTagTipTouch(){
      const tags = tipEl.querySelectorAll('.classTagTip');
      tags.forEach(tag=>{
        const handler = (e)=>{
          e.stopPropagation();
          const ckey = tag.getAttribute('data-ctag');
          if(!ckey || !CLASS_DB[ckey]) return;
          const cls = CLASS_DB[ckey];
          let count = 0;
          ['weapon','helm','armor','ring'].forEach(s=>{
            const eq = player.equip[s];
            if(eq && eq.classTag === ckey) count++;
          });
          const activeMark = count >= 4 ? ' ✅ 已激活' : ` (${count}/4)`;
          toast(`${cls.icon} ${cls.name}流派${activeMark}\n${cls.mastery}`, 2500);
        };
        tag.addEventListener('click', handler);
        tag.addEventListener('touchend', (e)=>{ e.preventDefault(); handler(e); }, {passive:false});
      });
    })();
    tipCmpEl.style.display='none';
    return;
  }

  // ============ 桌面/手柄模式：原浮动布局 ============
  // 测量 tip 实际尺寸
  const tw = tipEl.offsetWidth  || 260;
  const th = tipEl.offsetHeight || 200;
  let tx, ty;
  // 背包面板打开时：把 tip 放到面板「外侧」，绝不遮挡背包内容
  const invOpen = invPanel && invPanel.style.display==='block';
  const pr = invOpen ? invPanel.getBoundingClientRect() : null;
  if(pr){
    if(pr.right + 12 + tw <= innerWidth - 4){
      tx = pr.right + 12;
    } else if(pr.left - 12 - tw >= 4){
      tx = pr.left - 12 - tw;
    } else {
      tx = x + 14;
      if(tx + tw > innerWidth - 4) tx = Math.max(4, x - 14 - tw);
    }
    ty = Math.min(Math.max(y - th*0.3, pr.top), pr.bottom - th);
    if(ty < 4) ty = 4;
  } else {
    tx = x + 14;
    if(tx + tw > innerWidth - 4) tx = Math.max(4, x - 14 - tw);
    ty = y + 14;
    if(ty + th > innerHeight - 4) ty = Math.max(4, y - 14 - th);
  }
  tx = Math.max(4, Math.min(tx, innerWidth  - tw - 4));
  ty = Math.max(4, Math.min(ty, innerHeight - th - 4));
  tipEl.style.left = tx + 'px';
  tipEl.style.top  = ty + 'px';
  // 对比当前同槽装备（不显示冗余的"当前已装备"标题行）
  const cur=it.slot ? player.equip[it.slot] : null;
  if(cur && cur!==it){
    tipCmpEl.innerHTML=
      `<div style="margin:-2px -8px 6px;padding:5px 8px;`+
      `background:linear-gradient(90deg,transparent,rgba(232,196,90,.15),transparent);`+
      `border-top:2px solid var(--gold);`+
      `border-bottom:2px solid var(--gold);`+
      `</div>`+
      itemTipHtml(cur);
    tipCmpEl.style.display='block';
    tipCmpEl.style.left='-9999px';
    tipCmpEl.style.top='-9999px';
    const cw = tipCmpEl.offsetWidth  || 260;
    const ch = tipCmpEl.offsetHeight || 200;
    let cx = tx + tw + 8;
    let cy = ty;
    if(cx + cw > innerWidth - 4){
      cx = tx - cw - 8;
      if(cx < 4){
        cx = Math.max(4, Math.min(tx, innerWidth - cw - 4));
        cy = ty + th + 8;
        if(cy + ch > innerHeight - 4) cy = Math.max(4, ty - ch - 8);
      }
    }
    cy = Math.max(4, Math.min(cy, innerHeight - ch - 4));
    tipCmpEl.style.left = cx + 'px';
    tipCmpEl.style.top  = cy + 'px';
  } else {
    tipCmpEl.style.display='none';
  }
}
function hideTip(){
  tipEl.style.display='none'; tipCmpEl.style.display='none';
  // 触屏模式下 tip 用了 inline 多种样式，下次显示前清掉
  tipEl.style.width=''; tipEl.style.maxWidth=''; tipEl.style.maxHeight=''; tipEl.style.overflowY='';
  tipEl.style.bottom=''; tipEl.style.webkitOverflowScrolling=''; tipEl.style.transform='';
  tipCmpEl.style.width=''; tipCmpEl.style.maxWidth=''; tipCmpEl.style.maxHeight=''; tipCmpEl.style.overflowY='';
  // 清理可能挂在 body / invPanel 上的独立 tipActions（触屏模式下挂出 tipEl 避免被 overflow/stacking 裁剪）
  const ext = document.getElementById('tipActions');
  if(ext) ext.remove();
}

// 触屏模式：显示装备/物品 tip 时附带操作按钮（装备/替换/使用/丢弃）
// 调用时 idx 为该物品在 player.inv 的下标
function showItemTipWithActions(it, idx, x, y){
  // 先清掉旧 actEl（防止上次残留浮在屏幕底部）
  const oldA = document.getElementById('tipActions');
  if(oldA) oldA.remove();
  showTip(it, x, y);
  // 复用 tipEl，把按钮注入到末尾
  if(tipEl.style.display==='none') return;
  const actEl = document.createElement('div');
  actEl.id = 'tipActions';
  // 根据物品类型决定按钮
  const buttons = [];
  // 优先按"特殊用法"决定主要操作；但只要 it.slot 存在（装备），都强制追加「装备/替换」按钮，
  // 确保任何装备打开对比界面时都能看到替换入口（用户反馈"有时没出现替换按钮"的根因防护）
  let mainHandled = false;
  if(it.isGem){
    buttons.push({lbl:'镶嵌', fn:()=>{ hideTip(); useGemFromInv(idx); }});
    mainHandled = true;
  } else if(it.special==='hpPotion'){
    buttons.push({lbl:'喝下', fn:()=>{ useHpPotion(idx); hideTip(); }});
    mainHandled = true;
  } else if(it.special==='mpPotion'){
    buttons.push({lbl:'喝下', fn:()=>{ useMpPotion(idx); hideTip(); }});
    mainHandled = true;
  } else if(it.special==='expTome'){
    buttons.push({lbl:'研读', fn:()=>{ useExpTome(idx); hideTip(); }});
    mainHandled = true;
  } else if(it.special==='bagExpand'){
    buttons.push({lbl:'使用', fn:()=>{ useBagExpandScroll(idx); hideTip(); }});
    mainHandled = true;
  }
  // 装备：只要有 slot 字段，就追加替换/装备按钮（与上面的 special 分支共存）
  if(it.slot && !it.isGem){
    const cur = player.equip[it.slot];
    buttons.push({lbl: cur ? '替换装备' : '装 备', cls:'primary', fn:()=>{
      const c = player.equip[it.slot];
      player.equip[it.slot] = it;
      player.inv.splice(idx,1);
      if(c) player.inv.splice(idx,0,c);
      applyEquipStats(); rebuildInv();
      if(typeof Quests!=='undefined' && it.quality){ Quests.onEvent('equip', {qualityKey: it.quality.key}); }
      hideTip();
    }});
    mainHandled = true;
  }
  // 完全无识别的物品（极少见）：避免 buttons 只有"丢弃/关闭"，给个保险
  void mainHandled;
  buttons.push({lbl:'丢弃', cls:'danger', fn:()=>{ dropFromInv(idx); hideTip(); }});
  buttons.push({lbl:'关闭', fn:()=>{ hideTip(); }});
  buttons.forEach(b=>{
    const btn=document.createElement('button');
    btn.textContent=b.lbl; if(b.cls) btn.className=b.cls;
    const stop=(e)=>{ e.stopPropagation(); e.preventDefault && e.preventDefault(); b.fn(); };
    btn.addEventListener('click', stop);
    btn.addEventListener('touchstart', stop, {passive:false});
    actEl.appendChild(btn);
  });
  // 触屏模式：actEl 挂到 invPanel（永远稳定显示的容器），避免 iOS 滚动 tipEl 时 fixed 兄弟节点被隐藏的渲染 bug
  // 桌面/手柄模式：保持挂在 tipEl 内（位置随 tip 浮动，体验一致）
  if(InputMode && InputMode.current==='touch'){
    // 内联样式：fixed 钉到屏幕底部 + 顶级 z-index + GPU 层避免渲染 bug
    actEl.style.cssText =
      'position:fixed;left:8px;right:8px;bottom:16px;'+
      'margin:0;padding:12px 10px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;'+
      'background:rgba(20,16,11,.98);border:2px solid #e8c45a;border-radius:8px;'+
      'box-shadow:0 0 24px rgba(232,196,90,.6), 0 0 60px rgba(0,0,0,.85);'+
      'z-index:99999;pointer-events:auto;'+
      'transform:translateZ(0);will-change:transform;'+
      '-webkit-backface-visibility:hidden;backface-visibility:hidden';
    // 优先挂到 invPanel（背包打开时它必定可见且 z-index 高）；invPanel 不可见才挂 body
    if(invPanel && invPanel.style.display==='block'){
      invPanel.appendChild(actEl);
    } else {
      document.body.appendChild(actEl);
    }
  } else {
    tipEl.appendChild(actEl);
  }
}

const invPanel=document.getElementById('invPanel');
// 记忆上一次手柄查看的格子位置；下次打开背包时尝试恢复到这一格
let _lastPadCursor = 0;
// 是否"从 overlay（暂停/死亡界面）打开"：true 时关闭背包应回到 overlay，而非进入战斗
let _invFromOverlay = null;   // null | 'pause' | 'death'
function toggleInv(byPad){
  if(invPanel.style.display==='block'){
    // ---- 关闭背包 ----
    // 关闭即清除所有物品的 NEW 标记（关闭=已查看）
    if(player && player.inv){ player.inv.forEach(it=>{ if(it && it.isNew) it.isNew=false; }); }
    // 保存当前手柄光标位置，下次打开时恢复
    if(padCursor>=0) _lastPadCursor = padCursor;
    Audio.uiClose();
    invPanel.style.display='none';
    _hoverIdx=-1;
    padCursor=-1;
    hideTip();
    document.body.classList.remove('pad-inv-open');
    // 复位临时拉高的 z-index（死亡/暂停 overlay 入口打开时拉高过）
    invPanel.style.zIndex='';
    tipEl.style.zIndex='';
    tipCmpEl.style.zIndex='';
    const _gup = document.getElementById('gemUsePanel'); if(_gup) _gup.style.zIndex='';
    const _sop = document.getElementById('socketPanel'); if(_sop) _sop.style.zIndex='';
    const _fup = document.getElementById('fusePanel');   if(_fup) _fup.style.zIndex='';
    const _ffx = document.getElementById('fuseFx');      if(_ffx) _ffx.style.zIndex='';
    // 关闭可能残留的子面板，避免下次再打开 overlay 时叠加
    if(typeof closeGemUsePanel==='function') closeGemUsePanel();
    if(typeof closeSocketPanel==='function') closeSocketPanel();

    // 关键：如果是从 overlay（暂停/死亡）进入的背包 → 关闭后回到 overlay，保持 gamePaused=true
    if(_invFromOverlay){
      const from = _invFromOverlay;
      _invFromOverlay = null;
      gamePaused = true;
      if(from==='death' && player._dead){
        if(typeof showDeathOverlay==='function') showDeathOverlay();
      } else {
        if(typeof showPauseOverlay==='function') showPauseOverlay();
      }
      return;
    }

    gamePaused=false;
    // 触屏模式：不请求 PointerLock，直接走 fallback 标记为已锁定
    if(InputMode && InputMode.current==='touch'){
      controls._fallback = true;
      if(!controls.isLocked){ controls.isLocked = true; controls._emit && controls._emit('lock'); }
    } else {
      controls.lock();
    }
  } else {
    // ---- 打开背包 ----
    Audio.uiOpen();
    invPanel.style.display='block';
    gamePaused=true;
    _hoverIdx=-1;
    hideTip();
    // 用手柄打开则隐藏鼠标 + 屏蔽鼠标 hover
    if(byPad || gp.connected) document.body.classList.add('pad-inv-open');
    else document.body.classList.remove('pad-inv-open');
    controls.unlock();
    // 手柄连接时恢复光标到上次查看的位置（如果该位置已无物品则降级到第一件物品）
    if(gp.connected && player.inv.length>0){
      // 把上次记忆的位置 clamp 到 [0, INV_CAP-1]，并优先落在有物品的格子上
      let want = _lastPadCursor;
      if(want<0 || want>=INV_CAP) want = 0;
      // 如果该格已没有物品，就回退到第一件物品
      if(!player.inv[want]) want = 0;
      padCursor = want;
    } else {
      padCursor = -1;
    }
    rebuildInv();
    if(padCursor>=0) updatePadCursor();
  }
}

// 在 grid 上更新光标高亮 + 同步弹 tip
function updatePadCursor(){
  const grid=document.getElementById('invGrid'); if(!grid) return;
  // 清掉旧高亮
  grid.querySelectorAll('.invSlot.padCursor').forEach(el=>el.classList.remove('padCursor'));
  if(padCursor<0) { hideTip(); return; }
  const slot = grid.children[padCursor];
  if(!slot) return;
  slot.classList.add('padCursor');
  // 滚动到可视区
  if(slot.scrollIntoView) slot.scrollIntoView({block:'nearest',inline:'nearest'});
  // 在该格中心显示 tip
  const it = player.inv[padCursor];
  if(it){
    const r=slot.getBoundingClientRect();
    if(it.isNew){ it.isNew=false; const tag=slot.querySelector('.newDot'); if(tag) tag.remove(); }
    showTip(it, r.right, r.top);
  } else {
    hideTip();
  }
}

// 移动光标：dx/dy 可以是 -1/0/1
// 横向移动：行末向右 → 下一行最左；行首向左 → 上一行最右（环绕到下一/上一行）
// 纵向移动：列底向下 → 同列最顶（同列循环）
function movePadCursor(dx, dy){
  const n = INV_CAP;
  if(player.inv.length===0){ padCursor=-1; updatePadCursor(); return; }
  if(padCursor<0) padCursor=0;
  const rows = Math.ceil(n/INV_COLS);
  let r = Math.floor(padCursor/INV_COLS);
  let c = padCursor%INV_COLS;

  if(dx!==0){
    // 横向：把(r,c)看成扁平索引 idx，用 (idx + dx + n) % n 实现环绕
    let idx = r*INV_COLS + c + dx;
    idx = (idx + n) % n;
    // 跳过空格继续探查；最多扫一整圈
    let probe = idx;
    for(let i=0;i<n;i++){
      if(player.inv[probe]) { idx=probe; break; }
      probe = (probe + dx + n) % n;
    }
    padCursor = idx;
  } else if(dy!==0){
    // 纵向：同列循环
    let nr = (r + dy + rows) % rows;
    let probeR = nr;
    let landed = nr*INV_COLS + c;
    for(let i=0;i<rows;i++){
      const cand = probeR*INV_COLS + c;
      if(cand<n && player.inv[cand]){ landed = cand; break; }
      probeR = (probeR + dy + rows) % rows;
    }
    padCursor = landed;
  }
  updatePadCursor();
}

// 手柄按 A：装备当前选中
function padEquipCurrent(){
  if(padCursor<0) return;
  const it = player.inv[padCursor]; if(!it) return;
  it.isNew=false;
  // 宝石：A 键弹孔位选择浮窗
  if(it.isGem){
    useGemFromInv(padCursor);
    return;
  }
  // 背包扩容卷轴：A 键直接使用
  if(it.special==='bagExpand'){
    useBagExpandScroll(padCursor);
    if(padCursor>=player.inv.length) padCursor=Math.max(0,player.inv.length-1);
    if(player.inv.length===0) padCursor=-1;
    updatePadCursor();
    return;
  }
  // 血瓶 / 蓝瓶：A 键使用
  if(it.special==='hpPotion' || it.special==='mpPotion'){
    if(it.special==='hpPotion') useHpPotion(padCursor);
    else useMpPotion(padCursor);
    if(padCursor>=player.inv.length) padCursor=Math.max(0,player.inv.length-1);
    if(player.inv.length===0) padCursor=-1;
    updatePadCursor();
    return;
  }
  const cur=player.equip[it.slot];
  player.equip[it.slot]=it;
  player.inv.splice(padCursor,1);
  if(cur)player.inv.splice(padCursor,0,cur);
  applyEquipStats();
  if(typeof Quests!=='undefined'){ Quests.onEvent('equip', {qualityKey: it.quality.key}); }
  rebuildInv();
  // 重新定位光标（防止越界）
  if(padCursor>=player.inv.length) padCursor=Math.max(0,player.inv.length-1);
  if(player.inv.length===0) padCursor=-1;
  updatePadCursor();
}

// 手柄按 X：丢弃当前选中
function padDropCurrent(){
  if(padCursor<0) return;
  if(!player.inv[padCursor]) return;
  dropFromInv(padCursor);
  if(padCursor>=player.inv.length) padCursor=Math.max(0,player.inv.length-1);
  if(player.inv.length===0) padCursor=-1;
  updatePadCursor();
}

// 手柄按 LB：切换"自动换装"勾选
function padToggleAutoEquip(){
  settings.autoEquip = !settings.autoEquip;
  const opt=document.getElementById('optAutoEquip');
  if(opt) opt.checked = settings.autoEquip;
  Audio.uiOpen && Audio.uiOpen();
  toast(settings.autoEquip ? '✓ 自动换装：开' : '自动换装：关');
}

// 手柄按 RB：弹出合成面板让用户选择具体组合
function padTryFuse(){
  // tryFuse() 内部会弹出面板；面板内的导航由主循环处理
  tryFuse();
}

// 丢弃：把物品从背包移除并在玩家脚下生成 lootDrop
function dropFromInv(idx){
  const it = player.inv[idx];
  if(!it) return;
  const pp = controls.getObject().position.clone();
  const fwd=new THREE.Vector3();camera.getWorldDirection(fwd);fwd.y=0;fwd.normalize();
  // 丢远点：5~7 米外，前方略带随机扇形散布（±20°）
  const dist = 5 + Math.random()*2;
  const ang = (Math.random()-0.5) * (Math.PI/4.5);  // ±20°
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const dir = new THREE.Vector3(fwd.x*cs - fwd.z*sn, 0, fwd.x*sn + fwd.z*cs);
  const drop = pp.clone().add(dir.multiplyScalar(dist));
  // 限制在地图范围内
  drop.x = Math.max(-95, Math.min(95, drop.x));
  drop.z = Math.max(-95, Math.min(95, drop.z));
  spawnLootFromItem(it, drop, true);
  player.inv.splice(idx,1);
  toast('丢弃：'+it.name);
  rebuildInv();
}

// ---------- 3 合 1 合成 ----------
// 同 slot + 同稀有度 任意 3 件 → 1 件随机的 同 slot + 稀有度+1
function findFusableGroup(){
  // 委托给 findAllFusableGroups（包含装备和宝石），返回第一项
  const groups = findAllFusableGroups();
  return groups.length>0 ? groups[0] : null;
}
// 返回所有可合成组合（每组 FUSE_N 件），优先稀有度高的；同 slot 同稀有度有 ≥2*FUSE_N 件可分多组
function findAllFusableGroups(){
  // 装备组：仅按稀有度分桶（不再要求同 slot）
  const buckets = {};
  // 宝石组：按宝石类型 + 等级分桶（gem_<type>_<grade>）
  const gemBuckets = {};
  // 药水组：按 hp/mp 类型 + tier 分桶（potion_hp_0/potion_mp_0 等）；tier=1 已是顶级，不再合成
  const potionBuckets = {};
  // 金色道具：所有 unique 收集到一起（不分 slot），用于合成背包扩容
  const uniqueIdx = [];
  for(let i=0;i<player.inv.length;i++){
    const it = player.inv[i];
    if(!it) continue;
    if(it.isGem){
      // 宝石单独走 GEM_FUSE_N=3 路径（在下面），这里跳过
      continue;
    }
    // 药水合成
    if(it.special==='hpPotion' || it.special==='mpPotion'){
      const tier = it.tier|0;
      if(tier>=1) continue;            // 顶级药水不再合成
      const k = it.special==='hpPotion' ? ('potion_hp_'+tier) : ('potion_mp_'+tier);
      (potionBuckets[k] = potionBuckets[k] || []).push(i);
      continue;
    }
    if(it.special) continue;          // 其它特殊道具（扩容卷轴等）不进任何分组
    if(it.quality.key==='unique'){    // 暗金（金色）
      uniqueIdx.push(i);
      continue;
    }
    // set（绿色套装）现在也可合成：5 件套装 → 1 件随机套装（自成阶梯，不升暗金）
    // 仅按稀有度分桶
    (buckets[it.quality.key] = buckets[it.quality.key] || []).push(i);
  }
  const groups = [];
  // ===== 1) 暗金合成（特殊：5 件任意金色 → 背包扩容卷轴）=====
  for(let off=0; off+FUSE_N<=uniqueIdx.length; off+=FUSE_N){
    groups.push({kind:'unique2bag', indices: uniqueIdx.slice(off, off+FUSE_N)});
  }
  // ===== 2) 装备：稀有度高 → 低，每 5 件一组（任意部位）=====
  // set（绿色套装）自成阶梯：5 件套装 → 1 件随机套装（详见 nextQuality）
  const order = ['set','rare','magic','common'];
  for(const q of order){
    const arr = buckets[q];
    if(!arr || arr.length<FUSE_N) continue;
    for(let off=0; off+FUSE_N<=arr.length; off+=FUSE_N){
      groups.push({kind:'equip', qualityKey:q, indices: arr.slice(off, off+FUSE_N)});
    }
  }
  // ===== 3) 宝石：3 个同等级任意类型 → 1 个高一级宝石（type 随机）=====
  // 完美宝石（grade 2）已是最高级，3 个完美 → 1 个随机类型完美（自循环，不再升级）
  // 仅按 grade 分桶；产物的 type 在 executeFuseWithAnim 中随机
  const GEM_FUSE_N = 3;
  const MAX_GEM_GRADE = GEM_GRADES.length - 1;   // 2 = 完美
  const gemByGrade = {};   // grade -> [inv idx, ...]
  for(let i=0;i<player.inv.length;i++){
    const it = player.inv[i];
    if(!it || !it.isGem) continue;
    (gemByGrade[it.grade] = gemByGrade[it.grade] || []).push(i);
  }
  for(let grade=MAX_GEM_GRADE; grade>=0; grade--){
    const arr = gemByGrade[grade];
    if(!arr || arr.length<GEM_FUSE_N) continue;
    const toGrade = Math.min(MAX_GEM_GRADE, grade+1);   // 完美→完美
    for(let off=0; off+GEM_FUSE_N<=arr.length; off+=GEM_FUSE_N){
      groups.push({kind:'gem', grade, toGrade, indices: arr.slice(off, off+GEM_FUSE_N)});
    }
  }
  // ===== 4) 药水：hp / mp 各自的 tier 0 → tier 1 =====
  ['hp','mp'].forEach(pt=>{
    const arr = potionBuckets['potion_'+pt+'_0'];
    if(!arr || arr.length<FUSE_N) return;
    for(let off=0; off+FUSE_N<=arr.length; off+=FUSE_N){
      groups.push({kind:'potion', potionType:pt, tier:0, indices: arr.slice(off, off+FUSE_N)});
    }
  });
  return groups;
}
function nextQuality(currentKey){
  // 自定义升级表：common → magic → rare → unique
  // set（绿色套装）自成阶梯：set → set（合成出另一件随机套装，不跨体系升暗金）
  const stepUp = { common:'magic', magic:'rare', rare:'unique', set:'set' };
  const nextKey = stepUp[currentKey];
  if(!nextKey) return QUALITY.find(q=>q.key===currentKey);
  return QUALITY.find(q=>q.key===nextKey) || QUALITY.find(q=>q.key===currentKey);
}
// 入口：从按钮 / 手柄 / 命令调用，会弹合成面板让用户选要合成的组合
function tryFuse(){
  openFusePanel();
  return true;
}

// === 合成面板 ===
// 合成所需件数：N 合 1
const FUSE_N = 5;
const fusePanelEl   = document.getElementById('fusePanel');
const fuseListEl    = document.getElementById('fuseList');
const fuseFxEl      = document.getElementById('fuseFx');
let _fuseGroups = [];     // 当前展开的所有组合
let _fusePadSel = 0;      // 手柄在面板中的选中行
let _fuseAnimating = false;

function openFusePanel(){
  if(_fuseAnimating) return;
  _fuseGroups = findAllFusableGroups();
  if(_fuseGroups.length===0){
    toast(`需要 ${FUSE_N} 件同部位+同稀有度的物品（不含暗金/套装）`);
    Audio.uiClick();
    return;
  }
  _fusePadSel = 0;
  // 关掉背包格的 tip，避免 tip 浮层挡住合成面板
  if(typeof hideTip==='function') hideTip();
  _hoverIdx = -1;
  renderFuseList();
  fusePanelEl.style.display = 'flex';
  Audio.uiOpen && Audio.uiOpen();
}
function closeFusePanel(){
  fusePanelEl.style.display = 'none';
  Audio.uiClose && Audio.uiClose();
}
function renderFuseList(){
  fuseListEl.innerHTML='';
  _fuseGroups.forEach((grp, idx)=>{
    const items = grp.indices.map(i=>player.inv[i]);
    const div = document.createElement('div');
    div.className = 'fuseItem';
    if(idx===_fusePadSel) div.classList.add('padSel');
    // FUSE_N 件源道具图标
    const iconHtml = items.map(it=>
      `<span style="color:${it.quality.color}">${it.icon}</span>`
    ).join('');
    let leftLabel, rightLabel, targetIcon, targetColor;
    if(grp.kind==='unique2bag'){
      // 5 件暗金 → 背包扩容卷轴
      leftLabel  = `<b style="color:#e8c45a">${FUSE_N}× 暗金道具（任意）</b>`;
      rightLabel = `<span style="color:#e8c45a;font-weight:bold">1× 📜 背包扩容卷轴 (+4 格)</span>`;
      targetIcon = '📜';
      targetColor = '#e8c45a';
    } else if(grp.kind==='gem'){
      // 宝石组：3 个同等级任意类型 → 1 个随机类型升一级宝石（完美→完美）
      const fromGrade = grp.grade;
      const toGrade   = (grp.toGrade!=null) ? grp.toGrade : grp.grade+1;
      const fromG = GEM_GRADES[fromGrade];
      const toG   = GEM_GRADES[toGrade];
      const sameGrade = (toGrade===fromGrade);
      leftLabel  = `<b style="color:${fromG.color}">3× ${fromG.name}宝石（任意）</b>`;
      rightLabel = `<span style="color:${toG.color};font-weight:bold">1× ${toG.name}宝石（随机类型${sameGrade?'' :''}）</span>`;
      // 用第一颗源宝石的图标作为目标图标占位
      targetIcon = items[0].icon;
      targetColor = toG.color;
    } else if(grp.kind==='potion'){
      // 药水组：tier0 → tier1
      const isHp = grp.potionType==='hp';
      const fromName = isHp ? '生命药水' : '法力药水';
      const toName   = isHp ? '高级生命药水' : '高级法力药水';
      const fromColor = isHp ? '#ff5070' : '#5aa6ff';
      const toColor   = isHp ? '#ff8aff' : '#a0c8ff';
      leftLabel  = `<b style="color:${fromColor}">${FUSE_N}× ${fromName}</b>`;
      rightLabel = `<span style="color:${toColor};font-weight:bold">1× ${toName}</span>`;
      targetIcon = isHp ? '🧪' : '🧴';
      targetColor = toColor;
    } else {
      // 装备组（任意部位）
      const q = QUALITY.find(qq=>qq.key===grp.qualityKey);
      const nextQ = nextQuality(grp.qualityKey);
      leftLabel  = `<b style="color:${q.color}">${FUSE_N}× ${q.name} 装备（任意部位）</b>`;
      rightLabel = `<span style="color:${nextQ.color};font-weight:bold">1× ${nextQ.name} 装备（随机部位）</span>`;
      targetIcon = items[0].icon;
      targetColor = nextQ.color;
    }
    div.innerHTML = `
      <div class="ico3">${iconHtml}</div>
      <div class="arrow">→</div>
      <div class="target" style="color:${targetColor};border:2px solid ${targetColor}">${targetIcon}</div>
      <div class="info">
        ${leftLabel}<br/>
        <span style="color:#999">→ </span>${rightLabel}
      </div>
    `;
    div.addEventListener('click', ()=>{
      if(_fuseAnimating) return;
      // 触屏点击不会触发 mouseenter，必须在这里同步选中态，
      // 否则 executeFuseWithAnim 用 _fusePadSel 取 selRow 会拿错位置 → 飞行起点错位甚至看不到动画
      _fusePadSel = idx;
      fuseListEl.querySelectorAll('.fuseItem.padSel').forEach(el=>el.classList.remove('padSel'));
      div.classList.add('padSel');
      executeFuseWithAnim(grp);
    });
    div.addEventListener('mouseenter', ()=>{
      _fusePadSel = idx;
      // 移除所有 padSel
      fuseListEl.querySelectorAll('.fuseItem.padSel').forEach(el=>el.classList.remove('padSel'));
      div.classList.add('padSel');
    });
    fuseListEl.appendChild(div);
  });
}
function fuseMoveSel(dy){
  if(_fuseGroups.length===0) return;
  _fusePadSel = (_fusePadSel + dy + _fuseGroups.length) % _fuseGroups.length;
  fuseListEl.querySelectorAll('.fuseItem.padSel').forEach(el=>el.classList.remove('padSel'));
  const target = fuseListEl.children[_fusePadSel];
  if(target){
    target.classList.add('padSel');
    target.scrollIntoView({block:'nearest'});
  }
}
function fuseConfirmSel(){
  if(_fuseAnimating) return;
  const grp = _fuseGroups[_fusePadSel];
  if(grp) executeFuseWithAnim(grp);
}

// 实际合成 + 演出动画
// 1) 锁住面板，三件源道具浮起 → 飞向屏幕中心
// 2) 中心爆闪
// 3) 弹出新物品图标
// 4) 关闭面板 + toast + 加进背包 + 刷新
function executeFuseWithAnim(grp){
  _fuseAnimating = true;
  const items = grp.indices.map(i=>player.inv[i]);

  // 屏幕中心位置
  const cx = window.innerWidth/2, cy = window.innerHeight/2;

  // 计算源物品在面板中的位置（取 .fuseItem.padSel 的 .ico3>span 的初始坐标）
  const selRow = fuseListEl.children[_fusePadSel];
  const spans = selRow ? selRow.querySelectorAll('.ico3 span') : [];
  const sourcePts = [];
  // 用 items.length 兼容不同合成的件数（宝石 3、其它 5）
  const N = items.length;
  for(let i=0;i<N;i++){
    const r = spans[i] ? spans[i].getBoundingClientRect() : null;
    sourcePts.push(r ? {x:r.left+r.width/2-32, y:r.top+r.height/2-32} : {x:cx-32, y:cy-32});
  }

  // 创建动画浮层节点
  fuseFxEl.innerHTML = '';
  fuseFxEl.style.display = 'block';
  const fxItems = items.map((it, i)=>{
    const d = document.createElement('div');
    d.className = 'fxItem';
    d.style.left = sourcePts[i].x+'px';
    d.style.top  = sourcePts[i].y+'px';
    d.style.color = it.quality.color;
    d.style.borderColor = it.quality.color;
    d.style.boxShadow = `0 0 18px ${it.quality.color}`;
    d.textContent = it.icon;
    fuseFxEl.appendChild(d);
    return d;
  });
  const flash = document.createElement('div');
  flash.className = 'fxFlash';
  flash.style.left = cx+'px'; flash.style.top = cy+'px';
  fuseFxEl.appendChild(flash);

  // 给浏览器一帧时间应用初始 transform，再触发"飞向中心"
  Audio.uiClick && Audio.uiClick();
  requestAnimationFrame(()=>{
    requestAnimationFrame(()=>{
      // 飞向中心 + 收缩
      fxItems.forEach((d,i)=>{
        d.style.left = (cx-32)+'px';
        d.style.top  = (cy-32)+'px';
        d.style.transform = `scale(0.6) rotate(${i*(360/N) + 180}deg)`;
        d.style.opacity = '0.6';
      });
    });
  });

  // 0.85s 后：闪光 + 真合成 + 弹结果
  setTimeout(()=>{
    Audio.levelUp && Audio.levelUp();
    flash.classList.add('bang');
    fxItems.forEach(d=>{ d.style.opacity='0'; });

    // 实际合成：删源 + 加新
    let newIt;
    if(grp.kind==='unique2bag'){
      // 5 件暗金 → 背包扩容卷轴（特殊消耗品，左键使用永久 +4 格）
      newIt = makeBagExpandScroll();
      newIt.isNew = true;
    } else if(grp.kind==='gem'){
      // 宝石：3 个同等级任意类型 → 1 个随机类型的高一级宝石（完美→随机完美）
      const randType = GEM_TYPE_KEYS[Math.floor(Math.random()*GEM_TYPE_KEYS.length)];
      const toGrade = (grp.toGrade!=null) ? grp.toGrade : grp.grade+1;
      newIt = makeGem(randType, toGrade);
      newIt.isNew = true;
    } else if(grp.kind==='potion'){
      // 药水升一级
      newIt = grp.potionType==='hp' ? makeHpPotion(1) : makeMpPotion(1);
      newIt.isNew = true;
    } else {
      // 装备：用最高 iLvl，随机 slot（任意部位合成）
      const sources = grp.indices.map(i=>player.inv[i]);
      const maxLvl = Math.max(...sources.map(s=>s.iLvl||1));
      const targetQ = nextQuality(grp.qualityKey);
      const slots = ['weapon','helm','armor','ring'];
      const randSlot = slots[Math.floor(Math.random()*slots.length)];
      newIt = makeItemAtQuality(randSlot, maxLvl, targetQ);
      newIt.isNew = true;

      // === 方案4：随机保留源装备的极品词缀 ===
      // 收集所有源装备的词缀，按数值排序，随机保留1条（5%概率保留2条）
      {
        const allAffixes = [];
        sources.forEach(src=>{
          if(src && src.affixes){
            src.affixes.forEach(af=>{
              if(af && af.k && af.value!=null) allAffixes.push({...af});
            });
          }
        });
        if(allAffixes.length > 0){
          // 按数值排序（降序）
          allAffixes.sort((a,b)=>(b.value||0)-(a.value||0));
          // 决定保留几条：5%概率保留2条，否则1条
          const keepCount = (Math.random() < 0.05 && allAffixes.length >= 2) ? 2 : 1;
          const kept = allAffixes.slice(0, keepCount);
          // 把保留的词缀加到新装备上（避免key重复：如果新装备已有同key词缀，替换它）
          if(!newIt._keptAffixes) newIt._keptAffixes = [];
          kept.forEach(kaf=>{
            // 检查新装备是否已有同key词缀
            const existIdx = newIt.affixes.findIndex(af=>af.k === kaf.k);
            if(existIdx >= 0){
              // 替换现有词缀
              newIt.affixes[existIdx] = {...kaf};
            } else {
              // 追加新词缀（如果affixes数组还没满）
              newIt.affixes.push({...kaf});
            }
            newIt._keptAffixes.push({...kaf});
          });
        }
      }
      // === 词缀保留结束 ===

      // ✨ 自动拆宝石：把源装备上镶嵌的宝石抽出，先存到 newIt._recoverGems 待会塞背包
      const recovered = [];
      sources.forEach(src=>{
        if(src && Array.isArray(src.gems)){
          src.gems.forEach(g=>{
            if(g && g.isGem){
              g.isNew = true;
              recovered.push(g);
            }
          });
          src.gems = src.gems.map(()=>null);
        }
      });
      newIt._recoverGems = recovered;
    }

    // 移除源（从大到小删避免下标失效）
    const toRemove = [...grp.indices].sort((a,b)=>b-a);
    toRemove.forEach(i=>player.inv.splice(i,1));
    player.inv.push(newIt);
    // 📖 合成副产物：有几率额外掉落一本「经验之书」（使用后加经验）
    //   产出概率 55%；经验量随玩家当前升级所需经验缩放（约 25%~45%），后期同样有用。
    let _bonusTome = null;
    if(Math.random() < 0.55){
      const need = player.expNeed || 50;
      const exp = Math.floor(need * (0.25 + Math.random()*0.20));
      const tome = makeExpTome(exp);
      tome.isNew = true;
      if(player.inv.length < INV_CAP){
        player.inv.push(tome);
      } else {
        spawnLootFromItem(tome, controls.getObject().position.clone(), true);
      }
      _bonusTome = tome;
      setTimeout(()=>toast(`📖 合成副产物：经验之书（+${exp} 经验）`), 1400);
    }
    // ✨ 处理装备合成自动拆下的宝石：能放进背包就放，放不下的丢到玩家脚下
    const recovered = newIt._recoverGems || [];
    delete newIt._recoverGems;
    if(recovered.length>0){
      let putIn = 0, dropped = 0;
      const pp = controls.getObject().position.clone();
      recovered.forEach(g=>{
        if(player.inv.length < INV_CAP){
          player.inv.push(g);
          putIn++;
        } else {
          // 背包满 → 丢到玩家脚下附近
          spawnLootFromItem(g, pp, true);
          dropped++;
        }
      });
      // 延迟一点到合成 toast 之后再提示，避免被覆盖
      setTimeout(()=>{
        if(dropped>0){
          toast(`💎 拆下 ${recovered.length} 颗宝石（${putIn} 进背包，${dropped} 掉地上）`);
        } else {
          toast(`💎 拆下 ${recovered.length} 颗宝石放回背包`);
        }
      }, 1100);
    }
    // 任务事件：合成
    if(typeof Quests!=='undefined'){
      Quests.onEvent('fuse', {qualityKey: newIt.quality && newIt.quality.key});
    }

    // 弹出结果
    const resEl = document.createElement('div');
    resEl.className = 'fxResult';
    resEl.style.color = newIt.quality.color;
    resEl.style.borderColor = newIt.quality.color;
    resEl.style.boxShadow = `0 0 35px ${newIt.quality.color}, 0 0 70px ${newIt.quality.color}66`;
    resEl.textContent = newIt.icon;
    fuseFxEl.appendChild(resEl);
    requestAnimationFrame(()=>requestAnimationFrame(()=>resEl.classList.add('show')));

    Audio.pickup && Audio.pickup(newIt.quality.key || 'rare');

    // 副产物：经验之书也展示在结果右侧
    if(_bonusTome){
      const bonusEl = document.createElement('div');
      bonusEl.className = 'fxResult';
      bonusEl.style.color = _bonusTome.quality.color;
      bonusEl.style.borderColor = _bonusTome.quality.color;
      bonusEl.style.boxShadow = `0 0 22px ${_bonusTome.quality.color}`;
      bonusEl.style.width = '64px'; bonusEl.style.height = '64px'; bonusEl.style.fontSize = '36px';
      bonusEl.style.left = (cx+90)+'px'; bonusEl.style.top = cy+'px';
      bonusEl.textContent = _bonusTome.icon;
      fuseFxEl.appendChild(bonusEl);
      setTimeout(()=>{
        requestAnimationFrame(()=>requestAnimationFrame(()=>bonusEl.classList.add('show')));
      }, 200);
    }
    // 显示保留的词缀信息
    let fuseMsg = `⚗ 合成成功：${newIt.name}`;
    if(newIt._keptAffixes && newIt._keptAffixes.length > 0){
      const keptNames = newIt._keptAffixes.map(af=>{
        // 尝试从 AFFIX_DEFS 获取显示名称，否则直接用 key
        let label = af.k || '?';
        try{
          if(typeof AFFIX_DEFS!=='undefined' && AFFIX_DEFS[af.k] && AFFIX_DEFS[af.k].label){
            label = AFFIX_DEFS[af.k].label;
          }
        }catch(e){}
        return `+${af.value} ${label}`;
      }).join('，');
      fuseMsg += `　（保留：${keptNames}）`;
    }
    toast(fuseMsg);


    // 1.0s 后清场
    setTimeout(()=>{
      fuseFxEl.style.display = 'none';
      fuseFxEl.innerHTML = '';
      _fuseAnimating = false;
      rebuildInv();
      // 刷新合成列表（合成后可能没有更多组合了）
      _fuseGroups = findAllFusableGroups();
      if(_fuseGroups.length===0){
        closeFusePanel();
      } else {
        if(_fusePadSel>=_fuseGroups.length) _fusePadSel = 0;
        renderFuseList();
      }
    }, 1000);
  }, 850);
}

// ====== 宝石使用浮窗（v0.22 简化交互） ======
// 流程：背包点宝石 → 弹出浮窗（左上显示当前宝石 + 4 件装备的孔位列表）→ 点空孔位即刻镶嵌 → 关闭
let _gemUseSrcIdx = -1;       // 当前要镶嵌的宝石在 player.inv 中的下标
let _gemUseNav = [];          // [{el, action, eqIdx}]
let _gemUseNavIdx = 0;
function useGemFromInv(invIdx){
  const it = player.inv[invIdx];
  if(!it || !it.isGem) return;
  // 找当前所有装备 + 是否至少有 1 个孔位（空孔可镶嵌、满孔可替换）
  const slots = ['weapon','helm','armor','ring'];
  let hasAnySocket = false;
  slots.forEach(s=>{
    const eq = player.equip[s];
    if(eq && (eq.sockets||0)>0) hasAnySocket = true;
  });
  if(!hasAnySocket){
    toast('当前装备没有任何孔位');
    return;
  }
  _gemUseSrcIdx = invIdx;
  _gemUseNavIdx = 0;
  renderGemUsePanel();
  const el = document.getElementById('gemUsePanel');
  if(el) el.style.display = 'flex';
  if(typeof hideTip==='function') hideTip();
  Audio.uiOpen && Audio.uiOpen();
}
function closeGemUsePanel(){
  const el = document.getElementById('gemUsePanel');
  if(el) el.style.display = 'none';
  _gemUseSrcIdx = -1;
  _gemUseNav = [];
  Audio.uiClose && Audio.uiClose();
}
function renderGemUsePanel(){
  const sel = document.getElementById('gemUseSel');
  const list = document.getElementById('gemUseList');
  if(!sel || !list) return;
  const gem = player.inv[_gemUseSrcIdx];
  if(!gem || !gem.isGem){ closeGemUsePanel(); return; }
  // 顶部显示当前宝石
  sel.innerHTML = `
    <div class="gIco2" style="color:${gem.quality.color};border-color:${gem.quality.color}">${gem.icon}</div>
    <div>
      <div style="color:${gem.quality.color};font-weight:bold">${gem.name}</div>
      <div style="color:#aaa;font-size:11px">${gem.label}</div>
    </div>
  `;
  // 装备列表
  list.innerHTML = '';
  _gemUseNav = [];
  let _eqOrd = 0;
  const slots = ['weapon','helm','armor','ring'];
  let anyEq = false;
  slots.forEach(slot=>{
    const eq = player.equip[slot];
    if(!eq) return;
    anyEq = true;
    const eqIdx = _eqOrd++;
    const row = document.createElement('div');
    row.className = 'gemUseEq';
    let html = `
      <div class="row">
        <div class="ic" style="color:${eq.quality.color}">${eq.icon}</div>
        <div class="nm">
          <div style="color:${eq.quality.color};font-weight:bold">${eq.name}</div>
          <div style="color:#888;font-size:10px">${SLOT_CN[slot]||slot} · ${eq.quality.name}</div>
        </div>
      </div>`;
    const sockets = eq.sockets || 0;
    if(sockets===0){
      html += `<div class="holes"><span style="color:#666;font-size:10px;padding:2px 4px">无孔位</span></div>`;
      row.innerHTML = html;
      list.appendChild(row);
      return;
    }
    html += `<div class="holes" data-eq="${slot}"></div>`;
    row.innerHTML = html;
    list.appendChild(row);
    const holesWrap = row.querySelector('.holes');
    for(let h=0; h<sockets; h++){
      const exist = eq.gems[h];
      const hEl = document.createElement('div');
      hEl.className = 'hole2 ' + (exist ? 'filled' : 'empty');
      hEl.style.color = exist ? exist.quality.color : '#555';
      if(exist) hEl.style.borderColor = exist.quality.color;
      hEl.textContent = exist ? exist.icon : '◇';
      hEl.title = exist ? `已镶嵌：${exist.name} ${exist.label}（点击替换，旧宝石退回背包）` : '点击镶嵌';
      const action = ()=>{
        const srcGem = player.inv[_gemUseSrcIdx];
        if(!srcGem || !srcGem.isGem){ closeGemUsePanel(); return; }
        if(exist){
          // 孔位已满 → 替换：把旧宝石退回背包，再嵌入新宝石
          eq.gems[h] = srcGem;
          // 先移除背包中的源宝石（下标可能因 push 变化，先记录引用再处理）
          player.inv.splice(_gemUseSrcIdx, 1);
          // 旧宝石退回背包；满了则丢到脚下
          const old = exist; old.isNew = true;
          if(player.inv.length < INV_CAP){
            player.inv.push(old);
          } else {
            const pp = controls.getObject().position.clone();
            spawnLootFromItem(old, pp, true);
          }
          applyEquipStats();
          rebuildInv();
          Audio.pickup && Audio.pickup('rare');
          toast(`替换：${srcGem.name} → ${eq.name}（${old.name} 退回背包）`);
          closeGemUsePanel();
          return;
        }
        // 空孔 → 直接镶嵌
        eq.gems[h] = srcGem;
        player.inv.splice(_gemUseSrcIdx, 1);
        applyEquipStats();
        rebuildInv();
        Audio.pickup && Audio.pickup('rare');
        toast(`镶嵌：${srcGem.name} → ${eq.name}`);
        closeGemUsePanel();
      };
      hEl.addEventListener('click', action);
      holesWrap.appendChild(hEl);
      _gemUseNav.push({el:hEl, action, eqIdx, empty: !exist});
    }
  });
  if(!anyEq){
    list.innerHTML = `<div style="color:#777;font-size:11px;padding:8px;text-align:center">尚未穿戴任何装备</div>`;
  }
  // 把光标定位到第一个空孔
  if(_gemUseNav.length>0){
    let firstEmpty = _gemUseNav.findIndex(x=>x.empty);
    if(firstEmpty<0) firstEmpty = 0;
    _gemUseNavIdx = firstEmpty;
    applyGemUseFocus();
  }
}
function applyGemUseFocus(){
  _gemUseNav.forEach((it, i)=>{
    it.el.classList.toggle('padFocus', i===_gemUseNavIdx);
    if(i===_gemUseNavIdx) it.el.scrollIntoView({block:'nearest'});
  });
}
function gemUseNavMove(dir){
  if(_gemUseNav.length===0) return;
  // ↑↓ 按\"装备\"为单位跳：每按一次直接到下一件装备的第一个空孔（与背包→镶嵌的直觉一致）
  // 收集每件装备的"目标项"（优先空孔，其次第一个孔）
  const cur = _gemUseNav[_gemUseNavIdx];
  if(!cur) return;
  // 按 eqIdx 分组，记录每组的代表项（首个空孔，否则首个孔）
  const groupMap = new Map();   // eqIdx -> {firstEmpty, firstAny}
  _gemUseNav.forEach((it, i)=>{
    let g = groupMap.get(it.eqIdx);
    if(!g){ g = {firstEmpty:-1, firstAny:i}; groupMap.set(it.eqIdx, g); }
    if(it.empty && g.firstEmpty<0) g.firstEmpty = i;
  });
  // 装备顺序列表（按 eqIdx 排序）
  const eqList = Array.from(groupMap.keys()).sort((a,b)=>a-b);
  if(eqList.length===0) return;
  let curEqPos = eqList.indexOf(cur.eqIdx);
  if(curEqPos<0) curEqPos = 0;
  const nextEq = eqList[(curEqPos + dir + eqList.length) % eqList.length];
  const g = groupMap.get(nextEq);
  // 优先落在该装备的第一个空孔；如果该装备所有孔都满了，落第一个孔（玩家会看到提示）
  _gemUseNavIdx = (g.firstEmpty>=0) ? g.firstEmpty : g.firstAny;
  applyGemUseFocus();
}
function gemUseNavConfirm(){
  if(_gemUseNav.length===0) return;
  const cur = _gemUseNav[_gemUseNavIdx];
  if(cur && cur.action) cur.action();
}
// 同一件装备内的孔位左右移动（←→）
function gemUseNavMoveSlot(dir){
  if(_gemUseNav.length===0) return;
  const cur = _gemUseNav[_gemUseNavIdx];
  if(!cur) return;
  const sameEq = _gemUseNav.map((it,i)=>({it,i})).filter(x=>x.it.eqIdx===cur.eqIdx);
  if(sameEq.length<=1) return;
  const curPos = sameEq.findIndex(x=>x.i===_gemUseNavIdx);
  const next = (curPos + dir + sameEq.length) % sameEq.length;
  _gemUseNavIdx = sameEq[next].i;
  applyGemUseFocus();
}

// ====== 宝石镶嵌面板 ======
const socketPanelEl = () => document.getElementById('socketPanel');
let _selectedGemIdx = -1;   // 当前选中要镶嵌的宝石在 player.inv 中的下标
// 手柄导航：可交互元素列表（宝石和孔位的 DOM 节点 + 操作回调）
let _sockNavList = [];      // [{el, action()}]
let _sockNavIdx  = 0;       // 当前光标索引

function openSocketPanel(preselectGemIdx){
  if(_fuseAnimating) return;
  // 如果合成面板正开着，先关掉避免叠加
  if(fusePanelEl && fusePanelEl.style.display==='flex') closeFusePanel();
  _selectedGemIdx = (preselectGemIdx!=null && player.inv[preselectGemIdx] && player.inv[preselectGemIdx].isGem) ? preselectGemIdx : -1;
  _sockNavIdx = 0;          // 手柄光标重置
  if(typeof hideTip==='function') hideTip();
  _hoverIdx = -1;
  renderSocketPanel();
  const el = socketPanelEl();
  if(el){ el.style.display='flex'; }
  Audio.uiOpen && Audio.uiOpen();
}
function closeSocketPanel(){
  const el = socketPanelEl();
  if(el) el.style.display='none';
  _selectedGemIdx = -1;
  Audio.uiClose && Audio.uiClose();
}
function renderSocketPanel(){
  const gemList = document.getElementById('sockGemList');
  const eqList  = document.getElementById('sockEquipList');
  if(!gemList || !eqList) return;
  gemList.innerHTML='';
  eqList.innerHTML='';
  _sockNavList = [];   // 重建手柄导航列表（顺序：宝石 → 各装备孔位）

  // ---- 宝石列表（左侧）----
  const gems = [];
  player.inv.forEach((it, idx)=>{ if(it && it.isGem) gems.push({it, idx}); });
  if(gems.length===0){
    gemList.innerHTML = `<div style="color:#777;font-size:11px;padding:8px;text-align:center">背包中没有宝石<br/><span style="color:#555">击杀敌人有概率掉落</span></div>`;
  } else {
    gems.forEach(({it, idx})=>{
      const d = document.createElement('div');
      d.className = 'gemItem' + (idx===_selectedGemIdx?' selected':'');
      d.innerHTML = `
        <div class="gIco" style="color:${it.quality.color};border-color:${it.quality.color}">${it.icon}</div>
        <div class="gInfo">
          <div style="color:${it.quality.color};font-weight:bold">${it.name}</div>
          <div style="color:#aaa">${it.label}</div>
        </div>
      `;
      const action = ()=>{
        _selectedGemIdx = (_selectedGemIdx===idx) ? -1 : idx;
        renderSocketPanel();
      };
      d.addEventListener('click', action);
      gemList.appendChild(d);
      _sockNavList.push({el:d, action, kind:'gem'});
    });
  }

  // ---- 装备列表（右侧）----
  const slots = ['weapon','helm','armor','ring'];
  let anyEquipped = false;
  let _eqIdxCounter = 0;   // 装备序号，用于手柄"↓ 跳下一件装备"
  slots.forEach(slot=>{
    const it = player.equip[slot];
    if(!it) return;
    anyEquipped = true;
    const eqIdx = _eqIdxCounter++;
    const row = document.createElement('div');
    row.className = 'sockEquip';
    const holes = [];
    for(let h=0; h<(it.sockets||0); h++){
      const gem = it.gems && it.gems[h];
      if(gem){
        holes.push(`<div class="hole filled" data-slot="${slot}" data-h="${h}" title="${gem.name} ${gem.label}（点击取出）" style="border-color:${gem.quality.color};box-shadow:0 0 6px ${gem.quality.color};color:${gem.quality.color}">${gem.icon}</div>`);
      } else {
        holes.push(`<div class="hole empty" data-slot="${slot}" data-h="${h}" title="空孔（点击镶嵌）">◇</div>`);
      }
    }
    if((it.sockets||0)===0){
      holes.push(`<span style="color:#666;font-size:10px;padding:0 4px">无孔</span>`);
    }
    row.innerHTML = `
      <div class="ic" style="color:${it.quality.color}">${it.icon}</div>
      <div class="nm">
        <div style="color:${it.quality.color};font-weight:bold">${it.name}</div>
        <div style="color:#888;font-size:10px">${SLOT_CN[slot]||slot} · ${it.quality.name}</div>
      </div>
      <div class="holes">${holes.join('')}</div>
    `;
    eqList.appendChild(row);
    row.querySelectorAll('.hole').forEach(holeEl=>{
      const action = ()=>{
        const slotKey = holeEl.dataset.slot;
        const h = +holeEl.dataset.h;
        const eq = player.equip[slotKey];
        if(!eq) return;
        const gem = eq.gems[h];
        if(gem){
          if(player.inv.length >= INV_CAP){
            toast('背包已满，无法取出宝石');
            return;
          }
          eq.gems[h] = null;
          player.inv.push(gem);
          applyEquipStats();
          rebuildInv();
          renderSocketPanel();
          Audio.uiClick && Audio.uiClick();
          toast(`取出 ${gem.name}`);
        } else {
          if(_selectedGemIdx<0){
            toast('请先在左侧选一颗宝石');
            return;
          }
          const sourceGem = player.inv[_selectedGemIdx];
          if(!sourceGem || !sourceGem.isGem) return;
          eq.gems[h] = sourceGem;
          player.inv.splice(_selectedGemIdx, 1);
          _selectedGemIdx = -1;
          applyEquipStats();
          rebuildInv();
          renderSocketPanel();
          Audio.pickup && Audio.pickup('rare');
          toast(`镶嵌成功：${sourceGem.name} → ${eq.name}`);
        }
      };
      holeEl.addEventListener('click', action);
      _sockNavList.push({el:holeEl, action, kind:'hole', eqIdx});
    });
  });
  if(!anyEquipped){
    eqList.innerHTML = `<div style="color:#777;font-size:11px;padding:8px;text-align:center">尚未穿戴任何装备</div>`;
  }

  // 应用手柄光标高亮
  if(_sockNavList.length>0){
    if(_sockNavIdx<0 || _sockNavIdx>=_sockNavList.length) _sockNavIdx = 0;
    _sockNavList.forEach((item, i)=>{
      if(i===_sockNavIdx){
        item.el.classList.add('padFocus');
        // 自动滚动到可见
        item.el.scrollIntoView({block:'nearest'});
      } else {
        item.el.classList.remove('padFocus');
      }
    });
  } else {
    _sockNavIdx = 0;
  }
}
function sockNavMove(dir){
  // 旧的"线性循环"行为：保留作为兜底（上下键复用）
  if(_sockNavList.length===0) return;
  _sockNavIdx = (_sockNavIdx + dir + _sockNavList.length) % _sockNavList.length;
  _sockNavList.forEach((item, i)=>{
    item.el.classList.toggle('padFocus', i===_sockNavIdx);
    if(i===_sockNavIdx) item.el.scrollIntoView({block:'nearest'});
  });
}
// 列内上下移动：宝石列正常逐项移动；孔位列按"装备"为单位跳转（每按一次跳到下一件装备的第一个孔）
function sockNavVert(dir){
  if(_sockNavList.length===0) return;
  const cur = _sockNavList[_sockNavIdx];
  if(!cur) return;
  // ===== 孔位列：按装备跳 =====
  if(cur.kind==='hole'){
    // 收集所有 hole，按 eqIdx 分组
    const holes = _sockNavList.map((it,i)=>({it,i})).filter(x=>x.it.kind==='hole');
    if(holes.length===0) return;
    // 当前 eqIdx，目标 eqIdx
    const curEq = cur.eqIdx;
    // 不同 eqIdx 的列表，去重保序
    const eqList = [];
    holes.forEach(x=>{ if(eqList.indexOf(x.it.eqIdx)<0) eqList.push(x.it.eqIdx); });
    if(eqList.length===0) return;
    let curEqPos = eqList.indexOf(curEq);
    if(curEqPos<0) curEqPos = 0;
    const nextEq = eqList[(curEqPos + dir + eqList.length) % eqList.length];
    // 落到目标 eq 的第一个孔（dir=1 时）或最后一个孔（dir=-1 时）
    const targetHoles = holes.filter(x=>x.it.eqIdx===nextEq);
    const target = dir>0 ? targetHoles[0] : targetHoles[targetHoles.length-1];
    if(!target) return;
    _sockNavIdx = target.i;
  } else {
    // ===== 宝石列：按项逐个移动 =====
    const subList = _sockNavList.map((it,i)=>({it,i})).filter(x=>x.it.kind===cur.kind);
    if(subList.length===0) return;
    const curSub = subList.findIndex(x=>x.i===_sockNavIdx);
    const nextSub = (curSub + dir + subList.length) % subList.length;
    _sockNavIdx = subList[nextSub].i;
  }
  _sockNavList.forEach((item, i)=>{
    item.el.classList.toggle('padFocus', i===_sockNavIdx);
    if(i===_sockNavIdx) item.el.scrollIntoView({block:'nearest'});
  });
}
// 左右换列：宝石 ↔ 孔位
function sockNavHoriz(dir){
  if(_sockNavList.length===0) return;
  const curKind = _sockNavList[_sockNavIdx] && _sockNavList[_sockNavIdx].kind;
  const targetKind = (curKind==='gem') ? 'hole' : 'gem';
  // 找到目标 kind 的第一项（如果当前列在目标 kind 上没有可对齐的项，就选第一个）
  // 优化：尽量按"行号"对齐——根据 el.offsetTop 找最接近的
  const curEl = _sockNavList[_sockNavIdx].el;
  const curRect = curEl.getBoundingClientRect();
  const curMidY = curRect.top + curRect.height/2;
  let bestIdx = -1, bestDy = Infinity;
  _sockNavList.forEach((item, i)=>{
    if(item.kind !== targetKind) return;
    const r = item.el.getBoundingClientRect();
    const midY = r.top + r.height/2;
    const dy = Math.abs(midY - curMidY);
    if(dy < bestDy){ bestDy = dy; bestIdx = i; }
  });
  if(bestIdx<0) return;   // 目标列没有项（比如没装备 / 没宝石）
  _sockNavIdx = bestIdx;
  _sockNavList.forEach((item, i)=>{
    item.el.classList.toggle('padFocus', i===_sockNavIdx);
    if(i===_sockNavIdx) item.el.scrollIntoView({block:'nearest'});
  });
  // 顺手忽略 dir 的具体方向：只要按方向能跨列就跨
}
function sockNavConfirm(){
  if(_sockNavList.length===0) return;
  const cur = _sockNavList[_sockNavIdx];
  if(!cur) return;
  // 光标在宝石上：一键自动镶嵌到第一件装备的第一个空孔（手柄简化）
  if(cur.kind==='gem'){
    autoInsertGemFromCurrent();
    return;
  }
  // 光标在孔位上：原行为（取出 / 镶嵌之前选中的宝石）
  if(cur.action) cur.action();
}
// 一键自动镶嵌：根据当前光标所在宝石，找第一件装备的第一个空孔嵌入
function autoInsertGemFromCurrent(){
  // 找当前光标对应的宝石在 player.inv 中的下标
  // 宝石项是按"player.inv 顺序"加入 _sockNavList 的，下标对应即可
  // 但更稳：直接遍历 _sockNavList 找当前的 gem，记下背包 idx
  // 我们通过 el 的内容反查太脆 → 改用：让 _sockNavList 记录 inv 下标
  // 更简：用_selectedGemIdx 当桥梁
  const navItem = _sockNavList[_sockNavIdx];
  if(!navItem || navItem.kind!=='gem') return;
  // 找到这是第几个 gem（在 nav list 中）
  let gemOrder = -1, cnt = 0;
  for(let i=0;i<_sockNavList.length;i++){
    if(_sockNavList[i].kind==='gem'){
      if(i===_sockNavIdx){ gemOrder = cnt; break; }
      cnt++;
    }
  }
  if(gemOrder<0) return;
  // 在 player.inv 中找第 gemOrder 个 gem
  let invIdx = -1, k = 0;
  for(let i=0;i<player.inv.length;i++){
    if(player.inv[i] && player.inv[i].isGem){
      if(k===gemOrder){ invIdx = i; break; }
      k++;
    }
  }
  if(invIdx<0) return;
  const gem = player.inv[invIdx];
  // 找第一件有空孔的装备
  const slots = ['weapon','helm','armor','ring'];
  for(const s of slots){
    const eq = player.equip[s];
    if(!eq || !eq.sockets) continue;
    for(let h=0; h<eq.sockets; h++){
      if(!eq.gems[h]){
        eq.gems[h] = gem;
        player.inv.splice(invIdx, 1);
        _selectedGemIdx = -1;
        applyEquipStats();
        rebuildInv();
        renderSocketPanel();
        Audio.pickup && Audio.pickup('rare');
        toast(`镶嵌：${gem.name} → ${eq.name}`);
        return;
      }
    }
  }
  toast('没有可用空孔位');
}


// 生成指定 slot 和指定品质的物品（复用 genItem 的内部逻辑但不走 pickQuality）
function makeItemAtQuality(slot, level, quality){
  const item = {slot, quality, affixes:[], iLvl:level};
  const cnt = randi(quality.affixes[0], quality.affixes[1]);
  const usedKeys = new Set();
  for(let i=0;i<cnt;i++){
    const af = rollAffix(level, usedKeys, quality.key);
    usedKeys.add(af.k==='extraSkill' ? ('extraSkill:'+af.skill) : af.k);
    item.affixes.push(af);
  }
  // 套装归属
  if(quality.key==='set'){
    item.setKey = pick(SET_KEYS);
  }
  if(slot==='weapon'){
    const wt = pick(Object.keys(WEAPON_TYPES));
    item.wType = wt;
    const base = WEAPON_TYPES[wt].base;
    item.dmgMin = base[0]+Math.floor(level*1.2);
    item.dmgMax = base[1]+Math.floor(level*1.6);
    item.atkSpd = WEAPON_TYPES[wt].atkSpd;
    item.skills = [...WEAPON_TYPES[wt].skills];
    if(quality.key==='rare' || quality.key==='set') item.skills.push(pick(['nova','meteor','chain']));
    if(quality.key==='unique'){ item.skills.push('meteor'); item.skills.push('chain'); }
    item.name = pick(WEAPON_NAMES[wt]);
    if(quality.key!=='common') item.name = pickPrefix()+item.name;
    if(quality.key==='unique') item.name = pickUniqueName();
    if(quality.key==='set')    item.name = SET_DB[item.setKey].name+'·'+item.name;
  } else {
    const pool = slot==='helm'?HELM_NAMES : slot==='armor'?ARMOR_NAMES : RING_NAMES;
    item.name = pick(pool);
    if(quality.key!=='common') item.name = pickPrefix()+item.name;
    if(quality.key==='set')    item.name = SET_DB[item.setKey].name+'·'+item.name;
    if(slot!=='ring') item.armor = randi(2,6)+Math.floor(level*0.8);
  }
  item.icon = slot==='weapon'
    ? (item.wType==='bow'?'🏹':item.wType==='staff'?'🪄':item.wType==='wand'?'🔮':item.wType==='orb'?'🔵':item.wType==='axe'?'🪓':'⚔')
    : slot==='helm' ? '⛑'
    : slot==='armor'? '🛡'
    : '💍';
  // 宝石孔位
  item.sockets = rollSocketCount(quality.key);
  item.gems = new Array(item.sockets).fill(null);
  // 流派标签（warrior / mage / rogue）
  tagItemClass(item);
  return item;
}
// 更新合成提示
function refreshFuseHint(){
  const hint = document.getElementById('fuseHint');
  const btn = document.getElementById('btnFuse');
  if(!hint || !btn) return;
  const grp = findFusableGroup();
  if(!grp){
    hint.textContent = '（无可合成组合）';
    btn.classList.remove('on');
    btn.disabled = true;
    return;
  }
  let leftHtml='', rightHtml='';
  if(grp.kind==='unique2bag'){
    leftHtml  = `<span style="color:#e8c45a">${FUSE_N}× 暗金道具</span>`;
    rightHtml = `<span style="color:#e8c45a">📜 背包扩容卷轴</span>`;
  } else if(grp.kind==='gem'){
    const fromG = GEM_GRADES[grp.grade];
    // 完美宝石（最高级）合成产物仍为完美：用 grp.toGrade 兜底，越界时回到自身
    const toGradeIdx = (grp.toGrade!=null) ? grp.toGrade : Math.min(GEM_GRADES.length-1, grp.grade+1);
    const toG = GEM_GRADES[toGradeIdx] || fromG;
    leftHtml  = `<span style="color:${fromG.color}">3× ${fromG.name}宝石（任意）</span>`;
    rightHtml = `<span style="color:${toG.color}">1× ${toG.name}宝石</span>`;
  } else if(grp.kind==='potion'){
    const isHp = grp.potionType==='hp';
    leftHtml  = `<span style="color:${isHp?'#ff5070':'#5aa6ff'}">${FUSE_N}× ${isHp?'生命':'法力'}药水</span>`;
    rightHtml = `<span style="color:${isHp?'#ff8aff':'#a0c8ff'}">1× 高级${isHp?'生命':'法力'}药水</span>`;
  } else {
    // 装备组（任意部位）
    const q = QUALITY.find(qq=>qq.key===grp.qualityKey);
    const nextQ = nextQuality(grp.qualityKey);
    if(q && nextQ){
      leftHtml  = `<span style="color:${q.color}">${FUSE_N}× ${q.name}装备</span>`;
      rightHtml = `<span style="color:${nextQ.color}">1× ${nextQ.name}装备</span>`;
    } else {
      leftHtml = `${FUSE_N}× 装备`; rightHtml = `1× 装备`;
    }
  }
  hint.innerHTML = `可合成：${leftHtml} → ${rightHtml}`;
  btn.classList.add('on');
  btn.disabled = false;
}


// 整理背包：按"特殊卷轴 > 药水 > 宝石 > 装备(品质降序+部位)"排序，方便合成查看
function sortInv(){
  const QualityOrder = {unique:0, set:1, rare:2, magic:3, common:4};
  const SlotOrder    = {weapon:0, helm:1, armor:2, ring:3};
  // 给每件物品打一个排序权重 (cat, sub1, sub2, sub3)，从小到大排
  function weight(it){
    if(!it) return [99,0,0,0];
    // 1) 特殊扩容卷轴 / 全图拾取卷轴
    if(it.special==='bagExpand') return [0, 0, 0, 0];
    if(it.special==='magnet')    return [0, 1, 0, 0];
    // 2) 药水（高级在前）
    if(it.special==='hpPotion')  return [1, 0, -(it.tier|0), 0];
    if(it.special==='mpPotion')  return [1, 1, -(it.tier|0), 0];
    // 3) 宝石（等级高在前，按类型）
    if(it.isGem){
      const tIdx = GEM_TYPE_KEYS.indexOf(it.type);
      return [2, -(it.grade|0), tIdx<0?99:tIdx, 0];
    }
    // 4) 装备（按品质降序、部位、iLvl 降序）
    const qIdx  = QualityOrder[it.quality && it.quality.key];
    const slotI = SlotOrder[it.slot];
    return [3, qIdx==null?99:qIdx, slotI==null?99:slotI, -(it.iLvl||0)];
  }
  // 复制并排序，然后写回
  const sorted = player.inv.slice().sort((a,b)=>{
    const wa = weight(a), wb = weight(b);
    for(let i=0;i<wa.length;i++){
      if(wa[i]!==wb[i]) return wa[i]-wb[i];
    }
    return 0;
  });
  player.inv = sorted;
  rebuildInv();
  // 整理后把光标重置到 0（如果在背包内）
  if(padCursor>=0) padCursor = 0;
  updatePadCursor && updatePadCursor();
  Audio.uiOpen && Audio.uiOpen();
  toast('📦 背包已整理');
}

// 镶嵌/孔位面板是否打开：打开时应禁止操作背包格，避免误触
function gemModalOpen(){
  const g=document.getElementById('gemUsePanel');
  const s=document.getElementById('socketPanel');
  return (g && g.style.display==='flex') || (s && s.style.display==='flex');
}

// 同步触屏血/蓝按钮上的瓶数角标
function updatePotionCounts(){
  let hp=0, mp=0;
  if(player && player.inv){
    for(const it of player.inv){
      if(!it) continue;
      if(it.special==='hpPotion') hp++;
      else if(it.special==='mpPotion') mp++;
    }
  }
  const hpEl = document.getElementById('tHpCnt');
  const mpEl = document.getElementById('tMpCnt');
  if(hpEl){ hpEl.textContent=hp; hpEl.classList.toggle('zero', hp===0); }
  if(mpEl){ mpEl.textContent=mp; mpEl.classList.toggle('zero', mp===0); }
}
// 背包当前分类筛选：'all' / 'equip' / 'consume' / 'gem'
let _invCategory = 'all';
function _itemCategory(it){
  if(!it) return null;
  if(it.isGem) return 'gem';
  if(it.special) return 'consume';   // hpPotion / mpPotion / expTome / bagExpand
  if(it.slot) return 'equip';
  return 'equip';                     // 其他默认归装备
}
function setInvCategory(cat){
  _invCategory = cat;
  // 同步 tab 按钮高亮
  document.querySelectorAll('#invTabBar .invTab').forEach(b=>{
    b.classList.toggle('active', b.dataset.cat===cat);
  });
  // 重建格子
  rebuildInv();
}

function rebuildInv(){
  // 容量条
  const cap=document.getElementById('capLabel');
  if(cap){
    const n=player.inv.length;
    cap.textContent=`背包：${n} / ${INV_CAP}`;
    cap.style.color = n>=INV_CAP ? '#ff7070' : (n>=INV_CAP-4 ? '#f4e26b' : '#e8c45a');
  }
  // 自动换装勾选
  const opt=document.getElementById('optAutoEquip');
  if(opt){opt.checked=settings.autoEquip; opt.onchange=()=>{settings.autoEquip=opt.checked;};}

  const grid=document.getElementById('invGrid');grid.innerHTML='';
  // 防右键菜单
  grid.oncontextmenu = e=>{e.preventDefault(); return false;};

  // 当前分类匹配的物品下标列表 + 空格子数
  // 显示策略：先渲染匹配的物品（保留 player.inv 原下标供事件用），再补足空格子至 INV_CAP
  const matchedIdx = [];
  for(let i=0;i<INV_CAP;i++){
    const it = player.inv[i];
    if(_invCategory==='all'){ matchedIdx.push(i); continue; }
    if(it && _itemCategory(it)===_invCategory) matchedIdx.push(i);
  }
  // 不足 INV_CAP 时补足空槽（用 -1 标记，不绑事件）
  while(matchedIdx.length < INV_CAP) matchedIdx.push(-1);

  for(let k=0;k<INV_CAP;k++){
    const i = matchedIdx[k];
    const it = i>=0 ? player.inv[i] : null;
    const d=document.createElement('div');d.className='invSlot';
    if(it){
      const newTag = it.isNew ? `<span class="newDot"></span>` : '';
      // 升级提示：是装备 且 评分高于当前已穿戴 → 显示 ↑ 角标
      let upTag = '';
      if(!it.isGem && !it.special && it.slot && it.quality){
        const cur = player.equip[it.slot];
        if(!cur || itemScore(it) > itemScore(cur)){
          upTag = `<span class="upTag" title="比当前装备更强">↑</span>`;
        }
      }
      d.innerHTML=`<span style="color:${it.quality.color}">${it.icon}</span>`+
                  `<div class="qLabel" style="color:${it.quality.color}">${it.quality.name}</div>`+
                  newTag + upTag;
      d.addEventListener('mouseenter',e=>{
        // 触屏模式下 iOS 会在 touchend 后合成派发 mouse 事件序列（mouseover/move/leave），
        // 这些"假"事件会触发 showTip/hideTip 与 click 路径上的 showItemTipWithActions 抢夺 actEl，
        // 表现就是用户反馈的"按钮时有时无"。手机模式下完全屏蔽鼠标事件，仅靠 click 显示 tip。
        if(InputMode && InputMode.current==='touch') return;
        if(gemModalOpen()) return;   // 镶嵌界面打开时不弹背包 tip
        _hoverIdx=i;
        if(it.isNew){ it.isNew=false; const tag=d.querySelector('.newTag'); if(tag) tag.remove(); }
        showTip(it,_mouseX,_mouseY);
      });
      d.addEventListener('mousemove',e=>{
        if(InputMode && InputMode.current==='touch') return;
        if(gemModalOpen()) return;
        _hoverIdx=i; showTip(it,e.clientX,e.clientY);
      });
      d.addEventListener('mouseleave',()=>{
        if(InputMode && InputMode.current==='touch') return;
        if(_hoverIdx===i){_hoverIdx=-1;hideTip();}
      });
      // 左键：装备/交换（宝石不能装备，只能镶嵌）
      d.addEventListener('click',(ev)=>{
        // 镶嵌/孔位面板打开时，禁止操作背包，必须先关闭镶嵌界面
        if(gemModalOpen()){ toast('请先关闭镶嵌界面'); return; }
        it.isNew=false;
        // 触屏模式：点击 = 显示 tip + 操作按钮（装备/替换/使用/丢弃）
        if(InputMode && InputMode.current==='touch'){
          ev.stopPropagation();
          const r = d.getBoundingClientRect();
          showItemTipWithActions(it, i, r.left + r.width/2, r.top);
          return;
        }
        if(it.isGem){
          // 宝石点击 → 弹"选孔位"快速选择浮窗（v0.22 新交互）
          useGemFromInv(i);
          return;
        }
        // 背包扩容卷轴：点击直接使用
        if(it.special==='bagExpand'){
          useBagExpandScroll(i);
          return;
        }
        // 血瓶 / 蓝瓶：点击直接使用
        if(it.special==='hpPotion'){ useHpPotion(i); return; }
        if(it.special==='mpPotion'){ useMpPotion(i); return; }
        // 经验之书：点击直接研读
        if(it.special==='expTome'){ useExpTome(i); return; }
        const cur=player.equip[it.slot];
        player.equip[it.slot]=it;player.inv.splice(i,1);
        if(cur)player.inv.splice(i,0,cur);
        applyEquipStats();rebuildInv();
        if(typeof Quests!=='undefined'){ Quests.onEvent('equip', {qualityKey: it.quality.key}); }
      });
      // 右键：丢弃
      d.addEventListener('contextmenu',e=>{
        e.preventDefault();
        if(gemModalOpen()){ toast('请先关闭镶嵌界面'); return; }
        dropFromInv(i);
      });
    }
    grid.appendChild(d);
  }
  refreshEquip();
  // 同步触屏药水按钮的瓶数
  if(typeof updatePotionCounts==='function') updatePotionCounts();
  // 仅当背包面板真正打开时才刷新/显示 tip——否则战斗中拾取触发的 rebuildInv
  // 会把上次悬停的物品 tip 重新弹到左上角（_mouseX/_mouseY 残留），挡住任务面板。
  if(invPanel && invPanel.style.display==='block' && _hoverIdx>=0){
    const newItem=player.inv[_hoverIdx];
    if(newItem) showTip(newItem,_mouseX,_mouseY);
    else { _hoverIdx=-1; hideTip(); }
  } else if(invPanel && invPanel.style.display!=='block'){
    // 背包已关闭（战斗状态）：清除任何残留 tip，避免遮挡左上角任务 UI
    _hoverIdx=-1; hideTip();
  }
  // 手柄光标也要在重建后重新画
  if(padCursor>=0) updatePadCursor();
  // 刷新合成提示
  refreshFuseHint();
}
const toastWrap=document.getElementById('toast');
function toast(msg){const d=document.createElement('div');d.className='toast-item';d.textContent=msg;toastWrap.appendChild(d);setTimeout(()=>d.remove(),2100);}

// 通用二次确认对话框（保存/读取/危险操作前调用）
// 风格与游戏其他面板一致：金边、深底、模态遮罩；点确认/取消/遮罩外都正确销毁
// 用法：confirmDialog({title:'...', msg:'...', okLabel:'确定', cancelLabel:'取消', onOk, onCancel, danger:false})
function confirmDialog(opts){
  opts = opts || {};
  const title = opts.title || '请确认';
  const msg   = opts.msg   || '';
  const okLbl = opts.okLabel || '确 定';
  const caLbl = opts.cancelLabel || '取 消';
  const danger= !!opts.danger;
  // 防止重复弹出
  const old = document.getElementById('confirmDialog');
  if(old) old.remove();

  const mask = document.createElement('div');
  mask.id = 'confirmDialog';
  mask.style.cssText =
    'position:fixed;inset:0;z-index:95;background:rgba(0,0,0,.7);'+
    'display:flex;align-items:center;justify-content:center;'+
    'animation:cfdFadeIn .18s ease-out;pointer-events:auto';

  const panel = document.createElement('div');
  panel.style.cssText =
    'min-width:280px;max-width:86vw;background:linear-gradient(180deg,#241c10,#15110b);'+
    'border:2px solid var(--gold);border-radius:8px;color:#ddd;text-align:center;padding:20px 22px;'+
    'box-shadow:0 0 30px rgba(232,196,90,.5),0 0 80px rgba(0,0,0,.7);'+
    'animation:cfdScaleIn .22s cubic-bezier(.3,1.6,.5,1)';

  const okColor = danger ? '#ff8a8a' : '#ffd76a';
  const okBg    = danger ? 'linear-gradient(180deg,#5a1414,#3a0a0a)' : 'linear-gradient(180deg,#3a2a14,#241c10)';
  const okBorder= danger ? '#c83030' : 'var(--gold)';

  panel.innerHTML =
    `<div style="color:var(--gold);font-size:16px;font-weight:bold;letter-spacing:3px;margin-bottom:10px">${title}</div>`+
    `<div style="color:#ccc;font-size:13px;line-height:1.7;margin-bottom:18px;letter-spacing:1px">${msg}</div>`+
    `<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">`+
    `  <button class="cfdOk" style="padding:9px 24px;font-size:13px;`+
    `    background:${okBg};color:${okColor};border:2px solid ${okBorder};`+
    `    border-radius:5px;cursor:pointer;font-family:inherit;letter-spacing:3px;font-weight:bold;`+
    `    box-shadow:0 0 10px rgba(232,196,90,.4)">${okLbl}</button>`+
    `  <button class="cfdCancel" style="padding:9px 24px;font-size:13px;`+
    `    background:#1a1408;color:#999;border:2px solid #555;`+
    `    border-radius:5px;cursor:pointer;font-family:inherit;letter-spacing:3px">${caLbl}</button>`+
    `</div>`;

  mask.appendChild(panel);
  document.body.appendChild(mask);

  const close = ()=>{
    mask.style.animation = 'cfdFadeOut .15s ease-in forwards';
    setTimeout(()=>{ mask.remove(); }, 160);
  };
  const onOk = (e)=>{
    e && e.stopPropagation && e.stopPropagation();
    e && e.preventDefault && e.preventDefault();
    close();
    try{ opts.onOk && opts.onOk(); }catch(err){ console.warn('[confirmDialog] onOk error:', err); }
  };
  const onCancel = (e)=>{
    e && e.stopPropagation && e.stopPropagation();
    e && e.preventDefault && e.preventDefault();
    close();
    try{ opts.onCancel && opts.onCancel(); }catch(err){ console.warn('[confirmDialog] onCancel error:', err); }
  };
  // 阻止点击 panel 内部冒泡到 mask（点 mask 才取消）
  panel.addEventListener('click', e=>e.stopPropagation());
  panel.addEventListener('touchstart', e=>e.stopPropagation(), {passive:true});
  // 点遮罩外 = 取消
  mask.addEventListener('click', onCancel);
  mask.addEventListener('touchstart', onCancel, {passive:false});

  const okBtn = panel.querySelector('.cfdOk');
  const caBtn = panel.querySelector('.cfdCancel');
  okBtn.addEventListener('click', onOk);
  okBtn.addEventListener('touchstart', onOk, {passive:false});
  caBtn.addEventListener('click', onCancel);
  caBtn.addEventListener('touchstart', onCancel, {passive:false});

  // ESC 取消、Enter 确认
  const onKey = (e)=>{
    if(e.code==='Escape'){ onCancel(e); document.removeEventListener('keydown', onKey); }
    else if(e.code==='Enter' || e.code==='Space'){ onOk(e); document.removeEventListener('keydown', onKey); }
  };
  document.addEventListener('keydown', onKey);
}

// 醒目的大字提示（保存/读取成功等）— 屏幕中上居中、金边脉冲、2 秒淡出
function showBigStatus(msg, color){
  color = color || 'var(--gold)';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;left:50%;top:30%;transform:translate(-50%,0) scale(.85);z-index:55;pointer-events:none;'+
    'background:rgba(0,0,0,.78);border:2px solid '+color+';border-radius:8px;padding:14px 28px;'+
    'font-size:18px;font-weight:bold;color:'+color+';letter-spacing:2px;text-align:center;'+
    'box-shadow:0 0 24px '+color+',0 0 60px rgba(0,0,0,.6);'+
    'transition:opacity .3s,transform .35s cubic-bezier(.3,1.6,.5,1);opacity:0';
  wrap.textContent = msg;
  document.body.appendChild(wrap);
  requestAnimationFrame(()=>{ wrap.style.opacity='1'; wrap.style.transform='translate(-50%,0) scale(1)'; });
  setTimeout(()=>{ wrap.style.opacity='0'; wrap.style.transform='translate(-50%,-20px) scale(.95)'; }, 1500);
  setTimeout(()=>{ wrap.remove(); }, 1900);
}

// 属性变化飘字（装备/镶嵌/卸下后调用）
// before/after: { str, dex, int, hpMax, mpMax, armor, dmgPct, critChance, critDmg, lifeOnHit }
function spawnStatChangeFloats(before, after){
  if(!before || !after) return;
  const labels = {
    str:'力量', dex:'敏捷', int:'智力', hpMax:'生命', mpMax:'法力',
    armor:'护甲', dmgPct:'伤害%', critChance:'暴击%', critDmg:'暴伤%', lifeOnHit:'命中回血'
  };
  const lines = [];
  Object.keys(labels).forEach(k=>{
    const d = (after[k]||0) - (before[k]||0);
    if(Math.abs(d) < 0.5) return;
    const sign = d>0 ? '+' : '';
    const color = d>0 ? '#7bd96a' : '#ff7070';
    lines.push(`<span style="color:${color}">${sign}${Math.round(d)} ${labels[k]}</span>`);
  });
  if(lines.length===0) return;
  // 用一个独立浮层显示，挂左侧（避开关卡进度面板下方），2 秒后向上淡出
  // z-index 必须高于 invPanel(20)/gemUsePanel(25) 以及死亡 overlay 临时拉高的 60，
  // 否则装备替换 / 宝石镶嵌后的属性变化提示会被这些面板挡住，玩家以为"没出现"。
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;left:calc(12px + var(--safe-l));top:35%;z-index:80;pointer-events:none;'+
    'background:rgba(0,0,0,.78);border:2px solid var(--gold);border-radius:6px;padding:10px 14px;'+
    'font-size:13px;line-height:1.7;color:#ddd;text-align:left;letter-spacing:1px;max-width:42vw;'+
    'box-shadow:0 0 22px rgba(232,196,90,.7);transition:opacity .4s,transform .8s;opacity:0;transform:translateY(0)';
  wrap.innerHTML = '<div style="color:var(--gold);font-size:11px;margin-bottom:5px;letter-spacing:2px;font-weight:bold">✦ 属性变化 ✦</div>'+lines.join('<br/>');
  document.body.appendChild(wrap);
  requestAnimationFrame(()=>{ wrap.style.opacity='1'; });
  setTimeout(()=>{ wrap.style.opacity='0'; wrap.style.transform='translateY(-30px)'; }, 1800);
  setTimeout(()=>{ wrap.remove(); }, 2400);
}
const lootWrap=document.getElementById('loot');
function addLootText(it){
  // 仅在玩家"拾取"时显示飘字（dropLoot 中已去掉调用，掉落不再飘字）
  if(!it || !it.quality) return;
  const d=document.createElement('div');d.className='loot-item';
  d.style.borderLeftColor=it.quality.color;
  d.innerHTML=`<span style="color:${it.quality.color}">${it.name}</span> <span style="color:#888;font-size:11px">[${it.quality.name||''}]</span>`;
  lootWrap.appendChild(d);setTimeout(()=>d.remove(),3500);
}
const dmgLayer=document.getElementById('dmgNumbers');
function spawnDmgText(worldPos,val,crit){
  const v=worldPos.clone().project(camera);if(v.z>1)return;
  const x=(v.x*.5+.5)*innerWidth,y=(-v.y*.5+.5)*innerHeight;
  const d=document.createElement('div');
  d.className='dmg'+(crit?' crit':'');
  // 字号：暴击更大，数值越大字号越大
  const absVal = Math.abs(Math.round(val));
  const fontSize = crit ? Math.min(38, 22+Math.floor(absVal/50)) : Math.min(26, 14+Math.floor(absVal/80));
  d.style.cssText=`position:fixed;left:${x}px;top:${y}px;z-index:19;pointer-events:none;
    font-size:${fontSize}px;font-weight:bold;letter-spacing:1px;
    color:${crit?'#ffe135':'#ffffff'};
    text-shadow:${crit?'0 0 8px #ff9600,0 0 20px #ff6a00,0 0 4px #000':'0 0 4px rgba(0,0,0,.8)'};
    font-family:Arial Black,sans-serif;
    transition:all .9s cubic-bezier(.2,.8,.3,1);
    opacity:1;transform:translateY(0) scale(1);
    text-stroke:${crit?'1.5px #a00':'0'};
    -webkit-text-stroke:${crit?'1.5px #a00':'0'};
  `;
  d.textContent=(crit?'暴击! ':'')+Math.round(val);
  dmgLayer.appendChild(d);
  // 向上飘 + 渐隐
  requestAnimationFrame(()=>{
    d.style.opacity='0';
    d.style.transform=`translateY(-80px) scale(${crit?1.3:1.1})`;
  });
  setTimeout(()=>d.remove(),1100);
  // 暴击触发屏幕震动
  if(crit) screenShake(180, 3.5);
}

// ===== 屏幕震动（建议5）=====
let _shakeDur=0, _shakeInt=0, _shakeOX=0;
function screenShake(durationMs, intensity){
  _shakeDur = Math.max(_shakeDur, durationMs/1000);
  _shakeInt = Math.max(_shakeInt, intensity);
}
function updateScreenShake(dt){
  if(_shakeDur<=0){ if(_shakeOX!==0){ camera.position.y-=_shakeOX; _shakeOX=0; } return; }
  _shakeDur -= dt;
  const t = _shakeDur<=0 ? 0 : _shakeDur;
  const decay = Math.max(0, t / Math.max(0.01, screenShake._maxDur||0.3));
  const cur = _shakeInt * decay;
  const nx = (Math.random()-0.5)*cur*0.012;
  const ny = (Math.random()-0.5)*cur*0.008;
  camera.position.x += (nx - (_shakeOX||0)*0.5);
  camera.position.y += ny;
  _shakeOX = nx;
  if(_shakeDur<=0){ _shakeInt=0; _shakeOX=0; }
}
screenShake._maxDur = 0.3;
// ===========

function showLootToast(it){
  const el = document.getElementById('lootToast');
  if(!el) return;
  const score = Math.round(itemScore(it)||0);
  const curEq = it.slot ? player.equip[it.slot] : null;
  const curScore = curEq ? Math.round(itemScore(curEq)) : 0;
  let arrow = '';
  if(curEq && score > curScore) arrow = ' ⬆';
  else if(curEq && score < curScore) arrow = ' ⬇';
  el.textContent = `${it.icon} 获得：${it.name}　评分 ${score}${arrow}`;
  el.style.display = 'block';
  el.style.opacity = '1';
  el.style.transform = 'translateX(-50%) translateY(0)';
  // 白色→金色渐变（高品质物品）
  if(it.quality.key==='unique'||it.quality.key==='set'){
    el.style.color = it.quality.color;
    el.style.borderColor = it.quality.color;
    el.style.boxShadow = `0 0 20px ${it.quality.color}`;
  }
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(()=>{
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(-20px)';
    setTimeout(()=>{ el.style.display='none'; el.style.boxShadow=''; }, 600);
  }, 2500);
}
// ===========

const mm=document.getElementById('mmCanvas').getContext('2d');
function drawMinimap(){
  mm.clearRect(0,0,180,180);
  mm.fillStyle='rgba(0,0,0,.4)';mm.fillRect(0,0,180,180);
  const px=controls.getObject().position.x, pz=controls.getObject().position.z, R=60;
  // 玩家朝向（xz 平面 yaw）
  const fwd=new THREE.Vector3(); camera.getWorldDirection(fwd);
  // canvas 旋转量：让玩家朝向永远朝上（屏幕 -y 方向）
  // fwd=(0,0,-1) 意味着前方在世界 -Z；我们希望它显示在屏幕上方 → 不旋转
  // fwd=(1,0,0) 朝东 → 应当让"东"显示在屏幕上方 → 整个地图顺时针转 90°
  // 因此旋转角 = -atan2(fwd.x, -fwd.z)
  const yaw = Math.atan2(fwd.x, -fwd.z);  // 玩家朝向相对 -Z 的角度
  // 把世界 (wx, wz) 转换为 canvas (cx, cy)：先以玩家为原点，再按 yaw 反向旋转，再缩放+偏移
  const cosA = Math.cos(-yaw), sinA = Math.sin(-yaw);
  const w2s = (wx, wz) => {
    let dx = (wx - px) / R * 90;     // 屏幕 x 偏移（玩家在中心 90,90）
    let dy = (wz - pz) / R * 90;     // 屏幕 y 偏移
    // 旋转 (dx, dy) by -yaw，使得世界中"玩家朝向"始终对应屏幕 -y 方向
    const rx = dx*cosA - dy*sinA;
    const ry = dx*sinA + dy*cosA;
    return [rx + 90, ry + 90];
  };

  // 火把（fires）不再绘制到小地图，避免误以为是敌人/物品
  // mm.fillStyle='#ff8a3c';
  // fires.forEach(f=>{const[x,y]=w2s(f.position.x,f.position.z);if(x>0&&x<180&&y>0&&y<180)mm.fillRect(x-1,y-1,3,3);});
  enemies.forEach(e=>{
    if(e.hp<=0)return;
    const[x,y]=w2s(e.mesh.position.x,e.mesh.position.z);
    if(x<0||x>180||y<0||y>180)return;
    mm.fillStyle=e.isBoss?'#ff3030':e.isElite?'#c08aff':'#ff7070';
    mm.fillRect(x-2,y-2,4,4);
  });
  lootDrops.forEach(l=>{
    const[x,y]=w2s(l.mesh.position.x,l.mesh.position.z);
    if(x<0||x>180||y<0||y>180)return;
    mm.fillStyle=l.item.quality.color;
    mm.fillRect(x-1,y-1,2,2);
  });

  // 玩家箭头：永远朝屏幕上方（因为地图已经按玩家朝向旋转）
  mm.fillStyle='#fff';
  mm.beginPath();
  mm.moveTo(90, 84);   // 顶点（朝上）
  mm.lineTo(94, 94);
  mm.lineTo(86, 94);
  mm.closePath();
  mm.fill();

  mm.strokeStyle='#333';mm.strokeRect(0,0,180,180);
}

// 初始化
player.equip.weapon=(()=>{
  const it=genItem(1,'weapon');
  it.wType='sword';it.skills=[...WEAPON_TYPES.sword.skills];it.dmgMin=4;it.dmgMax=8;
  it.name='生锈的短剑';it.icon='⚔';it.quality=QUALITY[0];it.affixes=[];it.atkSpd=1;
  tagItemClass(it);   // 重新打 tag（affixes 改空后流派可能变化，但 sword → warrior 仍稳定）
  return it;
})();
applyEquipStats();
// 开场赠送：1 瓶血 + 1 瓶蓝（手机模式新手开局减少卡死风险，PC/手柄玩家也用得上）
player.inv.push(makeHpPotion(0));
player.inv.push(makeMpPotion(0));
// 同步触屏血/蓝按钮上的瓶数角标（不调用就会一直显示 0 直到第一次打开背包）
if(typeof updatePotionCounts==='function') updatePotionCounts();
// 初始化任务系统（必须在 applyEquipStats 之后，确保 player 已就绪）
Quests.init();
renderProgress();        // 初始化关卡进度面板
spawnWave();

// ===== 存读档按钮连接（开始/暂停菜单内）=====
(function wireSaveLoad(){
  const btnSave = document.getElementById('btnSave');
  const btnLoad = document.getElementById('btnLoad');
  // 让按钮可点：在 touchstart 直接触发 + 阻止穿透到 overlay；click 兜底（鼠标）
  const wire = (btn, fn)=>{
    if(!btn) return;
    let firing = false;
    const trigger = (e)=>{
      e.stopPropagation(); if(e.preventDefault) e.preventDefault();
      if(firing) return; firing = true;
      try{ fn(); }finally{ setTimeout(()=>{ firing=false; }, 300); }
    };
    btn.addEventListener('touchstart', trigger, {passive:false});
    btn.addEventListener('click',      trigger);
  };
  // 保存：若已有存档需提示玩家会"覆盖"旧档；否则简单确认
  wire(btnSave, ()=>{
    if(hasSave()){
      let oldInfo = '';
      try{
        const d = JSON.parse(localStorage.getItem(SAVE_KEY));
        if(d && d.player){
          const when = d.ts ? new Date(d.ts).toLocaleString() : '';
          oldInfo = `<br/><span style="color:#888;font-size:11px">旧存档：Lv.${d.player.level} · 难度${d.difficulty||1} · ${when}</span>`;
        }
      }catch(_){}
      confirmDialog({
        title: '💾 保 存 进 度',
        msg: `将以当前状态<b style="color:var(--gold)"> 覆盖 </b>旧存档。${oldInfo}`,
        okLabel: '✓ 覆盖保存',
        cancelLabel: '取 消',
        onOk: ()=> saveGame(false),
      });
    } else {
      confirmDialog({
        title: '💾 保 存 进 度',
        msg: '把当前等级、装备、波次写入本地存档？',
        okLabel: '✓ 保 存',
        cancelLabel: '取 消',
        onOk: ()=> saveGame(false),
      });
    }
  });

  // 读取：会丢弃当前进度回到存档点，要求显式确认（红色危险按钮）
  wire(btnLoad, ()=>{
    if(!hasSave()){
      if(typeof showBigStatus==='function') showBigStatus('⚠ 没有可用存档', '#ff7070');
      else toast('⚠ 没有可用存档');
      return;
    }
    let info = '';
    try{
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      if(d && d.player){
        const when = d.ts ? new Date(d.ts).toLocaleString() : '';
        info = `<br/><span style="color:var(--gold)">Lv.${d.player.level} · 难度${d.difficulty||1}</span><br/><span style="color:#888;font-size:11px">${when}</span>`;
      }
    }catch(_){}
    confirmDialog({
      title: '📂 读 取 存 档',
      msg: `将<b style="color:#ff8a8a">丢弃</b>当前进度，回到存档点。${info}`,
      okLabel: '✓ 读 取',
      cancelLabel: '取 消',
      danger: true,
      onOk: ()=> loadGame(),
    });
  });
  // 启动时若检测到存档，提示玩家可读取
  if(hasSave()){
    try{
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      const when = d && d.ts ? new Date(d.ts).toLocaleString() : '';
      setSaveStatus(`检测到存档（Lv.${d.player.level} · 难度${d.difficulty} · ${when}），点击「📂 读取存档」继续`);
    }catch(e){ setSaveStatus('检测到存档，点击「📂 读取存档」继续'); }
  } else {
    setSaveStatus('提示：开打后每波自动保存，可在此手动存/读档');
  }
})();
// 自动补刷：场上非 BOSS 怪过少时刷新一波；阈值随波次稍增（避免高波时频繁刷新堆积）
// 最终波 BOSS 战期间 / 胜利面板未关闭前 不自动补刷，避免"通关后还在源源不断刷怪"
let _autoSpawnEnabled = true;
setInterval(()=>{
  if(!_autoSpawnEnabled) return;
  // 暂停 / 死亡画面期间绝不推进波次或刷怪——否则玩家在死亡界面停留时
  // 波次会被这个定时器一路自增（复活后出现"第20波死、复活变第37波"的跳变）。
  if(gamePaused || player._dead) return;
  // 已经通关但玩家还没选"继续"——冻结刷怪让胜利感更强
  if(_victoryDone && !_continueAfterVictory) return;
  // 到达最终波且尚未通关：
  if(waveLevel===FINAL_BOSS_WAVE && !_victoryDone){
    // 关键修复：最终 BOSS 只有在 spawnWave(waveLevel===20) 被调用时才会刷出。
    // 旧逻辑这里直接 return，导致永远不会以 waveLevel===20 调用 spawnWave，
    // 最终 BOSS 永远不出现、第20波也没有结束感。现在主动刷一次最终 BOSS，
    // 之后（已刷出）就 return，不再补散兵，让玩家专心打 BOSS。
    if(!_finalBossSpawned) spawnWave();
    return;
  }
  const aliveNonBoss = enemies.filter(e=>!e.isBoss).length;
  const hasBoss = enemies.some(e=>e.isBoss);
  // 波次结算：场上非 BOSS 敌人全清，且本波在进行中 → 结束上一波，显示结算面板
  if(_waveActive && aliveNonBoss === 0 && !hasBoss){
    endWaveStats();
    showWaveResultPanel();
    return;
  }
  // 【关键修复】波次进行中时，禁止阈值补刷，必须等玩家点击"继续下一波"
  // 这解决了"前几波没有结算"的bug：旧逻辑在敌人还剩几只时就提前spawnWave，
  // 导致 _waveActive 被覆盖、endWaveStats 从未调用、结算面板永远不会弹出
  if(_waveActive) return;
  // 阈值：5 + 波次 × 0.5，但不超过 12（仅作为安全网，正常走结算流程）
  const threshold = Math.min(12, 5 + Math.floor(waveLevel*0.5));
  if(aliveNonBoss < threshold) spawnWave();
}, 8000);

// 定时在地图随机点刷宝箱（每 ~22 秒一次，仅游戏进行中）
setInterval(()=>{
  if(!_autoSpawnEnabled) return;
  if(gamePaused || player._dead) return;
  if(typeof controls==='undefined' || !controls.isLocked) return;
  spawnChestRandom();
}, 22000);

// 顶部开关按钮事件
document.getElementById('btnSprint').addEventListener('click', toggleSprint);
document.getElementById('btnAuto'  ).addEventListener('click', toggleAutoPlay);
document.getElementById('btnMute'  ).addEventListener('click', toggleMute);
{ const bsm=document.getElementById('btnSkillMode'); if(bsm) bsm.addEventListener('click', toggleSkillMode); }
document.getElementById('btnFuse'  ).addEventListener('click', tryFuse);
{
  const bs = document.getElementById('btnSort');
  if(bs) bs.addEventListener('click', sortInv);
}
// 背包分类 Tab 绑定（默认 'all' 已在 setInvCategory 体现）
{
  document.querySelectorAll('#invTabBar .invTab').forEach(btn=>{
    const handler = (e)=>{ e.stopPropagation(); if(e.preventDefault) e.preventDefault(); setInvCategory(btn.dataset.cat); };
    btn.addEventListener('click', handler);
    btn.addEventListener('touchstart', handler, {passive:false});
  });
}
{
  const sb = document.getElementById('btnSocket');
  if(sb) sb.addEventListener('click', ()=>openSocketPanel());
  const cb = document.getElementById('socketCloseBtn');
  if(cb) cb.addEventListener('click', closeSocketPanel);
  document.addEventListener('keydown', (e)=>{
    const sp = socketPanelEl();
    if(!sp || sp.style.display!=='flex') return;
    if(e.code==='Escape' || e.code==='KeyB'){ closeSocketPanel(); }
  });
  // gemUsePanel 关闭按钮 + 键盘
  const gucb = document.getElementById('gemUseCloseBtn');
  if(gucb) gucb.addEventListener('click', closeGemUsePanel);
  document.addEventListener('keydown', (e)=>{
    const gp = document.getElementById('gemUsePanel');
    if(!gp || gp.style.display!=='flex') return;
    if(e.code==='Escape' || e.code==='KeyB' || e.code==='KeyY'){ closeGemUsePanel(); }
    else if(e.code==='ArrowUp'    || e.code==='KeyW'){ gemUseNavMove(-1); }
    else if(e.code==='ArrowDown'  || e.code==='KeyS'){ gemUseNavMove( 1); }
    else if(e.code==='ArrowLeft'  || e.code==='KeyA'){ gemUseNavMoveSlot(-1); }
    else if(e.code==='ArrowRight' || e.code==='KeyD'){ gemUseNavMoveSlot( 1); }
    else if(e.code==='Enter' || e.code==='Space'){ gemUseNavConfirm(); }
  });
}
// 合成面板的关闭按钮 + ESC 键
{
  const cb = document.getElementById('fuseCloseBtn');
  if(cb) cb.addEventListener('click', ()=>{ if(!_fuseAnimating) closeFusePanel(); });
  // 背包关闭按钮
  const invCb = document.getElementById('invCloseBtn');
  if(invCb){
    const closeFn = (e)=>{
      e && e.stopPropagation && e.stopPropagation();
      if(typeof toggleInv==='function' && invPanel && invPanel.style.display==='block') toggleInv();
    };
    invCb.addEventListener('click', closeFn);
    invCb.addEventListener('touchstart', closeFn, {passive:true});
  }
  document.addEventListener('keydown', (e)=>{
    if(fusePanelEl.style.display!=='flex') return;
    if(_fuseAnimating) return;
    if(e.code==='Escape' || e.code==='KeyB' || e.code==='KeyY'){ closeFusePanel(); }
    else if(e.code==='ArrowUp'   || e.code==='KeyW'){ fuseMoveSel(-1); }
    else if(e.code==='ArrowDown' || e.code==='KeyS'){ fuseMoveSel( 1); }
    else if(e.code==='Enter' || e.code==='Space'){ fuseConfirmSel(); }
  });
  // Tab 键：打开/关闭能力面板（建议3）
  document.addEventListener('keydown', (e)=>{
    if(e.code!=='Tab') return;
    e.preventDefault();
    const panel = document.getElementById('abilityPanel');
    if(!panel) return;
    if(panel.style.display==='block'){
      panel.style.display='none';
    } else {
      renderAbilityPanel();
      panel.style.display='block';
    }
  });
  // 手机底部"能力"按钮（提升z-index避免被触屏层遮挡）
  const abilBtn = document.getElementById('abilMobileBtn');
  if(abilBtn){
    abilBtn.style.zIndex = '30';
    abilBtn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const panel = document.getElementById('abilityPanel');
      if(!panel) return;
      if(panel.style.display==='block') panel.style.display='none';
      else { renderAbilityPanel(); panel.style.display='block'; }
    });
    abilBtn.addEventListener('touchend', (e)=>{ 
      e.preventDefault();
      e.stopPropagation();
      const panel = document.getElementById('abilityPanel');
      if(!panel) return;
      if(panel.style.display==='block') panel.style.display='none';
      else { renderAbilityPanel(); panel.style.display='block'; }
    }, {passive:false});
  }
  // 能力面板关闭按钮
  const abilPClose = document.getElementById('abilPanelClose');
  if(abilPClose){
    abilPClose.addEventListener('click', ()=>{
      document.getElementById('abilityPanel').style.display='none';
    });
  }
}
syncToggleButtons();

// ---------- 主循环 ----------
const dirVec=new THREE.Vector3(),rightVec=new THREE.Vector3(),clock=new THREE.Clock();

function update(dt){
  // 手柄轮询
  const padIn = pollGamepad(dt);

  // 兜底：战斗状态（未暂停且背包未打开）下绝不显示物品 tip / 对比框，
  // 防止任何残留的道具提示框出现在左上角遮挡任务面板。
  if(!gamePaused && invPanel && invPanel.style.display!=='block'){
    if(tipEl && tipEl.style.display==='block'){ _hoverIdx=-1; hideTip(); }
  }

  // 手柄按键事件（在锁定 / 未锁定都需要响应一些）
  if(padIn){
    // Start = 进入游戏 / 暂停切换（与开始菜单同等作用）
    if(padIn.start){
      if(overlay && overlay.style.display!=='none' && !player._dead){
        // 开始菜单 / 暂停菜单可见 → Start 进入游戏
        startOrResumeGame();
      } else if(player._dead){
        // 死亡画面下：等同于点击「复活」按钮
        const rv = document.getElementById('btnDeathRevive');
        if(rv) rv.click();
        else respawn();
      } else {
        // 游戏运行中按 Start → 暂停游戏 + 弹暂停菜单
        gamePaused = true;
        controls.unlock();
        if(typeof showPauseOverlay==='function') showPauseOverlay();
        else { overlay.style.display = 'flex'; }
      }
    }
    // Y = 切换背包（手柄触发，会隐藏鼠标）
    if(padIn.invToggle) toggleInv(true);
    // B = 关闭背包（如果开着）
    if(padIn.cancel && invPanel && invPanel.style.display==='block') toggleInv(true);
    // X = 拾取
    if(padIn.pickup) tryPickup();
    // RT = 释放当前技能（手动模式）。RT 不再触发拾取，拾取仅用 X。
    if(!settings.autoSkill && padIn.skillCast) manualCastActive();
    // LT = 查看当前选中技能描述
    if(padIn.skillDesc) showActiveSkillDesc();
    // L3 = 跑步开关
    if(padIn.sprintToggle) toggleSprint();
    // Back = 托管开关
    if(padIn.back) toggleAutoPlay();
    // LB = 喝生命药水；RB = 喝法力药水（无需打开背包）
    if(padIn.skillPrev){ if(typeof quickDrinkHp==='function') quickDrinkHp(); }
    if(padIn.skillNext){ if(typeof quickDrinkMp==='function') quickDrinkMp(); }
    // D-Pad ←/→ 切换主技能（旧 LB/RB 切技能改到这里）
    if(padIn.skill1 && !padIn.skill3){
      // ← 上一个
      const n = player.skills.length;
      if(n>0){
        for(let k=0;k<n;k++){
          const idx = (player.activeSkill - (k+1) + n) % n;
          if(player.skills[idx]){ player.activeSkill=idx; refreshSkillBar(); toast('技能：'+player.skills[idx].name); break; }
        }
      }
    } else if(padIn.skill3 && !padIn.skill1){
      // → 下一个
      const n = player.skills.length;
      if(n>0){
        for(let k=0;k<n;k++){
          const idx = (player.activeSkill + (k+1) + n) % n;
          if(player.skills[idx]){ player.activeSkill=idx; refreshSkillBar(); toast('技能：'+player.skills[idx].name); break; }
        }
      }
    }
    // D-Pad = 直接选择技能槽 1-4
    // D-Pad ↑/↓ = 直接选择技能槽 2/4（左右键已被切技能占用）
    const want = padIn.skill2?1 : padIn.skill4?3 : -1;
    if(want>=0 && player.skills[want]){
      player.activeSkill=want;refreshSkillBar();toast('技能：'+player.skills[want].name);
    }
  }

  // 视角：右摇杆驱动（仅在视角控制激活时生效）
  if(padIn && controls.isLocked && (padIn.rx || padIn.ry)){
    const e = controls._euler;
    e.setFromQuaternion(camera.quaternion);
    e.y -= padIn.rx * gp.LOOK_X * dt;
    e.x -= padIn.ry * gp.LOOK_Y * dt;
    e.x = Math.max(-Math.PI/2+0.01, Math.min(Math.PI/2-0.01, e.x));
    camera.quaternion.setFromEuler(e);
  }
  // 触屏右摇杆驱动视角（已移除 Y 轴：手机模式下玩家不再上下调整视角，避免抬头看天/低头看地的迷失感）
  if(InputMode.current==='touch' && controls.isLocked && touchInput.rx){
    const e = controls._euler;
    e.setFromQuaternion(camera.quaternion);
    e.y -= touchInput.rx * 1.6 * dt;     // 仅水平转向
    // e.x 保持不变（水平视角锁定）
    camera.quaternion.setFromEuler(e);
  }



  // 移动（键盘 + 手柄）
  if(controls.isLocked){
    camera.getWorldDirection(dirVec);dirVec.y=0;dirVec.normalize();
    rightVec.crossVectors(dirVec,new THREE.Vector3(0,1,0)).normalize();
    // 冲刺：开关式（Shift / L3 切换）
    const moveSpdBonus = 1 + ((player._eq && player._eq.moveSpd) || 0)/100;
    // 冰霜领主减速：_frozenT > 0 时移速 ×0.5
    if(player._frozenT && player._frozenT>0){ player._frozenT -= dt; }
    const frozenMul = (player._frozenT && player._frozenT>0) ? 0.5 : 1;
    const sp = (settings.sprintOn ? 9 : 5) * moveSpdBonus * frozenMul;
    const move=new THREE.Vector3();
    if(keys['KeyW'])move.add(dirVec);
    if(keys['KeyS'])move.sub(dirVec);
    if(keys['KeyD'])move.add(rightVec);
    if(keys['KeyA'])move.sub(rightVec);
    // 手柄左摇杆叠加（lx 右为正、ly 下为正）
    if(padIn && (padIn.lx || padIn.ly)){
      move.add(dirVec.clone().multiplyScalar(-padIn.ly));
      move.add(rightVec.clone().multiplyScalar(padIn.lx));
    }
    // 触屏虚拟摇杆叠加（与手柄完全一致的轴向语义）
    if(InputMode.current==='touch' && (touchInput.lx || touchInput.ly)){
      move.add(dirVec.clone().multiplyScalar(-touchInput.ly));
      move.add(rightVec.clone().multiplyScalar(touchInput.lx));
    }
    // 托管模式：玩家无输入时自动朝目标移动 + 自动转视角朝目标
    if(settings.autoPlay && move.lengthSq()<0.01){
      autoPilot(dt);
    }
    if(move.lengthSq()>0){move.normalize().multiplyScalar(sp*dt);controls.getObject().position.add(move);}
    // 第一人称手持武器：bob 摇摆 + 动作动画
    const _isMoving = move.lengthSq()>0;
    if(typeof updateViewWeapon==='function') updateViewWeapon(dt, _isMoving);
    // 跳跃：Space 或 A
    if((keys['Space'] || (padIn && padIn.jump)) && player.onGround){player.vel.y=6;player.onGround=false;}
    player.vel.y-=18*dt;
    controls.getObject().position.y+=player.vel.y*dt;
    if(controls.getObject().position.y<=1.65){controls.getObject().position.y=1.65;player.vel.y=0;player.onGround=true;}
    const p=controls.getObject().position;p.x=clamp(p.x,-95,95);p.z=clamp(p.z,-95,95);
  }
  // 火光
  fires.forEach(f=>{
    const k = .9+Math.sin(performance.now()*.01+f.position.x)*.1;
    f.userData.fire.scale.set(0.85*k, 1.4*k, 0.85*k);
    f.userData.pl.intensity=1.6+Math.sin(performance.now()*.013+f.position.z)*.6;
  });
  // 能力光环更新
  updateAuras(dt);
  // 环绕飞球更新
  updateOrbs(dt);
  // 自动战斗
  player.skills.forEach(s=>{if(s.cdLeft>0)s.cdLeft=Math.max(0,s.cdLeft-dt);});
  const cdrBonus = 1 + ((player._eq && player._eq.cdr) || 0)/100;
  // 能力buff：CD缩短（正确做法：乘算作用于基础 CD，而非混进 atkSpd）
  const abilCdMul = 1 - ((player._skillBuffs&&player._skillBuffs.cdRed)||0);
  const atkSpd=(player.equip.weapon?player.equip.weapon.atkSpd:1)*(1+player._dexTotal*.005)*cdrBonus;
  if(controls.isLocked&&player.hp>0&&enemies.length>0){
    // 仅在「技能自动施放」开启时自动放技能；手动模式下由鼠标左键 / 手柄 RT 触发
    if(settings.autoSkill){
    // 优先尝试当前选中技能，再尝试其余所有技能（不限于 4 个）
    const allIdx = [];
    for(let i=0;i<player.skills.length;i++) allIdx.push(i);
    const order=[player.activeSkill, ...allIdx.filter(i=>i!==player.activeSkill)];
    for(const i of order){
      const s=player.skills[i];if(!s||s.cdLeft>0||player.mp<s.mp)continue;
      // 防御性技能（治疗/护盾/铁壁姿态）不锁敌，由 castSkill 内部按生命/状态条件自行判定
      // 注意：nova 是范围攻击技能（不是防御技能），必须有敌人在范围内才释放，否则空放浪费蓝
      const need=!['heal','shield','haste'].includes(s.type);
      let t = null;
      if(need){
        if(s.type==='nova'){
          // 新星是 360° 范围 AOE：全向检测，只要范围内有任意敌人即视为命中目标
          const cam = controls.getObject().position;
          for(const e of enemies){
            if(e.hp<=0) continue;
            if(e.mesh.position.distanceTo(cam) <= s.range){ t = e; break; }
          }
        } else {
          // 其他技能：仅锁定玩家前方 180° 范围内的敌人
          t = findBestTarget(s.range, false);
        }
      }
      if(need&&!t)continue;
      if(castSkill(s)){
        // 能力buff：CD缩短正确乘算
        s.cdLeft=s.cd*abilCdMul/atkSpd;
        // 触发第一人称武器动作动画
        if(typeof playViewWeaponAnim==='function') playViewWeaponAnim(s.type, s.key);
        break;
      }
    }
    }
    for(let i=0;i<8;i++){
      const el=document.getElementById('cd_'+i);if(!el)continue;
      const s=player.skills[i];
      if(s&&s.cdLeft>0){el.textContent=s.cdLeft.toFixed(1);el.style.background='rgba(0,0,0,.7)';}
      else {el.textContent='';el.style.background='transparent';}
    }
    // 触屏主攻击键的冷却显示
    if(InputMode.current==='touch'){
      const cdEl = document.getElementById('tCastCd');
      if(cdEl){
        const s = player.skills[player.activeSkill];
        cdEl.textContent = (s && s.cdLeft>0) ? s.cdLeft.toFixed(1)+'s' : '';
      }
    }
  }
  // 投射物
  for(let i=projectiles.length-1;i>=0;i--){
    const p=projectiles[i];
    const step=p.speed*dt;
    p.mesh.position.add(p.dir.clone().multiplyScalar(step));
    p.traveled+=step;p.life-=dt;
    let hit=false;
    for(const e of enemies){
      if(e.hp<=0||p.hits.has(e))continue;
      if(p.mesh.position.distanceTo(e.mesh.position.clone().setY(p.mesh.position.y))<.9){
        p.hits.add(e);
        if(p.hit)p.hit(e);
        if(!p.pierce){hit=true;break;}
      }
    }
    if(hit||p.life<=0||p.traveled>=p.range){releaseProj(p.mesh);projectiles.splice(i,1);}
  }
  // AOE 渐隐
  for(let i=aoes.length-1;i>=0;i--){
    const a=aoes[i];a.life-=dt;
    a.mesh.material.opacity=Math.max(0,a.life/a.maxLife*.55);
    a.mesh.scale.setScalar(1+(1-a.life/a.maxLife)*.5);
    if(a.life<=0){scene.remove(a.mesh);aoes.splice(i,1);}
  }
  // 掉落物动画 + 自动吸附
  const pp=controls.getObject().position;
  // 宝箱：漂浮发光 + 贴近自动打破
  updateChests(dt);
  // 性能优化：远离玩家 30m 外的掉落物休眠（不更新动画/不检测拾取）
  const LOOT_AWAKE_DIST_SQ = 30*30;
  for(let i=lootDrops.length-1;i>=0;i--){
    const l=lootDrops[i];l.t+=dt;
    // 计算到玩家平面距离²（避免 sqrt）
    const _dx = l.mesh.position.x - pp.x, _dz = l.mesh.position.z - pp.z;
    const _distSq = _dx*_dx + _dz*_dz;
    const _far = !l.magnet && _distSq > LOOT_AWAKE_DIST_SQ;
    // 远距离物品：跳过动画/吸附判定（仅在拾取/magnet 触发时唤醒）
    if(_far) continue;

    // === magnet 飞向玩家 ===
    if(l.magnet){
      l.magnetT += dt;
      const k = Math.min(1, l.magnetT / l.magnetDur);
      // ease-in-out
      const e = k<0.5 ? 2*k*k : 1-Math.pow(-2*k+2,2)/2;
      // 抛物线插值：xz 用 lerp，y 用抛物（控制点 magnetArcH）
      const sx = l.magnetStart.x, sy0 = l.magnetStart.y, sz = l.magnetStart.z;
      const tx = pp.x, ty = 1.4, tz = pp.z;       // 玩家胸口高度
      l.mesh.position.x = sx + (tx-sx)*e;
      l.mesh.position.z = sz + (tz-sz)*e;
      // 抛物：sy0 + 4*h*k*(1-k) 从 sy0 上升到 sy0+h 再下降，最终落到 ty
      // 我们做"先飞高再落到玩家"：用 (1-e) 的旧 y 加上 e 的目标 y，再叠加抛物峰
      const baseY = sy0*(1-e) + ty*e;
      l.mesh.position.y = baseY + 4*l.magnetArcH*k*(1-k);
      // 旋转得更快，营造"飞行"感
      l.mesh.rotation.y += dt*8;
      l.mesh.rotation.x += dt*4;
      // 到达后 → 入包
      if(k>=1){
        if(player.inv.length>=INV_CAP){
          if(!window._lastFullToast || performance.now()-window._lastFullToast>1500){
            toast('背包已满！按 I 整理或丢弃');
            window._lastFullToast=performance.now();
          }
          // 包满：留在脚下，取消 magnet
          l.magnet = false;
          l.mesh.position.set(pp.x+rand(-1,1), .4, pp.z+rand(-1,1));
        } else {
          l.item.isNew=true;
          player.inv.push(l.item);
          scene.remove(l.mesh);
          lootDrops.splice(i,1);
          addLootText(l.item);
          Audio.pickup(l.item.quality.key);
          if(settings.autoEquip) autoEquipBetter(l.item);
          rebuildInv();
          if(typeof Quests!=='undefined' && !l.item.isGem && !l.item.special){
            Quests.onEvent('pickup', {qualityKey: l.item.quality.key});
          }
        }
      }
      continue;
    }

    // === 普通漂浮 ===
    l.mesh.rotation.y+=dt*2;
    // 特殊卷轴用更明显的浮动 + 上下脉动
    if(l.isSpecial){
      l.mesh.position.y = .7 + Math.sin(l.t*2.5)*.15;
      // 光环旋转
      if(l.ring){ l.ring.rotation.z += dt*3; }
    } else {
      l.mesh.position.y=.4+Math.sin(l.t*3)*.1;
    }
    if(settings.autoPickup && l.mesh.position.distanceTo(pp)<2.2){
      // 特殊道具：自动触发，不入包
      if(l.item && l.item.special==='magnet'){
        scene.remove(l.mesh);
        lootDrops.splice(i,1);
        Audio.pickup && Audio.pickup('unique');
        triggerMagnetPickup();
        continue;
      }
      if(player.inv.length>=INV_CAP){
        // 满包：仅每 1.5 秒提示一次，避免刷屏
        if(!window._lastFullToast || performance.now()-window._lastFullToast>1500){
          toast('背包已满！按 I 整理或丢弃');
          window._lastFullToast=performance.now();
        }
        continue; // 不吸取，物品留在地上
      }
      l.item.isNew=true;
      player.inv.push(l.item);
      scene.remove(l.mesh);lootDrops.splice(i,1);
      addLootText(l.item);
      Audio.pickup(l.item.quality.key);
      if(settings.autoEquip) autoEquipBetter(l.item);
      rebuildInv();
      // 任务事件：拾取（仅装备计入）
      if(typeof Quests!=='undefined' && !l.item.isGem && !l.item.special){
        Quests.onEvent('pickup', {qualityKey: l.item.quality.key});
      }
    }
  }
  // 敌方投射物
  for(let i=eProjectiles.length-1;i>=0;i--){
    const p=eProjectiles[i];
    const step=p.speed*dt;
    p.mesh.position.add(p.dir.clone().multiplyScalar(step));
    p.traveled+=step; p.life-=dt;
    // 命中玩家
    if(p.mesh.position.distanceTo(pp)<1.0){
      damagePlayer(p.dmg);
      if(p.kind==='fireball'){
        // 小范围 AOE 视觉
        const ring=new THREE.Mesh(new THREE.CircleGeometry(2,20),new THREE.MeshBasicMaterial({color:p.color,transparent:true,opacity:.5,side:THREE.DoubleSide}));
        ring.rotation.x=-Math.PI/2;ring.position.copy(p.mesh.position);ring.position.y=.05;scene.add(ring);
        setTimeout(()=>scene.remove(ring),300);  // ring 非池对象
      }
      releaseProj(p.mesh); eProjectiles.splice(i,1); continue;
    }
    if(p.life<=0||p.traveled>=p.range){releaseProj(p.mesh);eProjectiles.splice(i,1);}
  }

  // 敌人 AI
  player.invuln=Math.max(0,player.invuln-dt);
  // 性能优化：远离玩家 50m 外的敌人 AI 降频（每 0.2s 才执行一次完整 AI）
  const FAR_AI_DIST_SQ = 50*50;
  for(let i=0;i<enemies.length;i++){
    const e=enemies[i];
    if(e.hp<=0)continue;
    // 先用 distSq 快速判断距离
    const _ddx = e.mesh.position.x - pp.x;
    const _ddz = e.mesh.position.z - pp.z;
    const _eDistSq = _ddx*_ddx + _ddz*_ddz;
    const _isFar = !e.isBoss && (_eDistSq > FAR_AI_DIST_SQ);
    // ===== LOD：远距离非 BOSS 敌人在画面外不渲染（仍参与 AI/碰撞），显著节省 GPU =====
    // 60m 外 / 性能等级 >= 1 ：mesh.visible=false（敌人 mesh 几十-上百三角面，远敌渲染浪费）
    // BOSS 和距离 <60m 的始终保持可见
    const _LOD_HIDE_DIST_SQ = (PerfMon.level()>=1 ? 60*60 : 90*90);
    if(!e.isBoss){
      const shouldHide = _eDistSq > _LOD_HIDE_DIST_SQ;
      if(e.mesh.visible === shouldHide ? false : true){
        // 仅在状态变化时设置，减少 setter 调用
      }
      if(shouldHide && e.mesh.visible) e.mesh.visible = false;
      else if(!shouldHide && !e.mesh.visible) e.mesh.visible = true;
    }
    if(_isFar){
      // 远距离：累计 dt，每 0.2s 才执行一次完整 AI；其它帧只做最少状态衰减
      e._farAcc = (e._farAcc||0) + dt;
      e.atkCd = Math.max(0, e.atkCd - dt);
      e.slow  = Math.max(0, e.slow  - dt);
      if(e._farAcc < 0.2) continue;
      // 攒够时间，用 _farAcc 替代 dt 跑这一帧 AI（一次性追加这段时间）
      e._farAcc = 0;
    }
    e.atkCd=Math.max(0,e.atkCd-dt);
    e.slow=Math.max(0,e.slow-dt);
    // 血条计时器：受伤后保持显示一段时间，到时淡出
    if(!e.isBoss && e.hpBar){
      if(e.hpBarVisibleTimer>0){
        e.hpBarVisibleTimer -= dt;
        if(e.hpBarVisibleTimer<=0.6){
          // 最后 0.6 秒淡出
          e.hpBar.material.opacity = Math.max(0, e.hpBarVisibleTimer/0.6);
          if(e.hpBarVisibleTimer<=0) e.hpBar.visible = false;
        }
      }
    }
    if(e.isBoss){e.chargeCd=Math.max(0,e.chargeCd-dt);e.quakeCd=Math.max(0,e.quakeCd-dt);}
    const toP=_aiToP.copy(pp).sub(e.mesh.position);toP.y=0;
    const dist=toP.length();

    // 朝向玩家（冲锋时除外，会自己处理）
    if(!e.chargeData) e.mesh.lookAt(pp.x,e.mesh.position.y,pp.z);

    // 击退
    if(e.knockback.lengthSq()>.01){
      e.mesh.position.add(e.knockback.clone().multiplyScalar(dt*4));
      e.knockback.multiplyScalar(.85);
    }

    // 怪与怪之间的分离力（避免叠模）
    let sep=_aiSep.set(0,0,0);
    let sepCnt=0;
    for(let j=0;j<enemies.length;j++){
      if(j===i)continue;
      const o=enemies[j]; if(o.hp<=0)continue;
      const dx=e.mesh.position.x-o.mesh.position.x;
      const dz=e.mesh.position.z-o.mesh.position.z;
      const dd=Math.sqrt(dx*dx+dz*dz);
      const minD=(e.isBoss?2.4:1.0)+(o.isBoss?2.4:1.0);
      if(dd>0 && dd<minD){
        sep.x+=dx/dd; sep.z+=dz/dd; sepCnt++;
      }
    }
    if(sepCnt>0){
      sep.normalize().multiplyScalar(2.5*dt);
      e.mesh.position.add(sep);
    }

    // ===== BOSS 专属技能 =====
    if(e.isBoss){
      // 1) 冲锋（中距离触发）
      if(!e.chargeData && e.chargeCd<=0 && dist>6 && dist<22){
        e.chargeData={dir:toP.clone().normalize(),time:0.9};
        e.chargeCd=8; e.quakeCd=Math.max(e.quakeCd,2);
        toast('⚠ BOSS 冲锋！');
      }
      // 2) 地裂 AOE（近距离触发）
      if(e.quakeCd<=0 && dist<6){
        e.quakeCd=9;
        // 警告圈，0.8 秒后爆炸
        const center=e.mesh.position.clone().setY(0);
        const warn=new THREE.Mesh(new THREE.RingGeometry(5.5,6,32),new THREE.MeshBasicMaterial({color:0xff4422,side:THREE.DoubleSide,transparent:true,opacity:.7}));
        warn.rotation.x=-Math.PI/2;warn.position.copy(center);warn.position.y=.05;scene.add(warn);
        toast('⚠ BOSS 地裂！');
        setTimeout(()=>{
          scene.remove(warn);
          // 真正伤害判定
          const cur=e.mesh.position.clone().setY(0);
          if(pp.distanceTo(cur)<6){
            damagePlayer(rand(e.def.dmg[0],e.def.dmg[1])*1.5*(1+e.level*.2));
          }
          // 视觉
          const aoe=new THREE.Mesh(new THREE.CircleGeometry(6,40),new THREE.MeshBasicMaterial({color:0xff4422,transparent:true,opacity:.55,side:THREE.DoubleSide}));
          aoe.rotation.x=-Math.PI/2;aoe.position.copy(cur);aoe.position.y=.05;scene.add(aoe);
          aoes.push({mesh:aoe,life:.5,maxLife:.5});
          flashAt(cur.clone().setY(1.5),0xff4422,4);
        },800);
      }
      // 3) 冰霜领主特有：冰圈（范围伤害 + 玩家减速 3s）
      if(e.type==='frostlord'){
        e.frostNovaCd = (e.frostNovaCd||4) - dt;
        if(e.frostNovaCd<=0 && dist<14){
          e.frostNovaCd = 7;
          const center=e.mesh.position.clone().setY(0);
          // 警告圈
          const warn=new THREE.Mesh(new THREE.RingGeometry(7,7.5,40),new THREE.MeshBasicMaterial({color:0x6abfff,side:THREE.DoubleSide,transparent:true,opacity:.75}));
          warn.rotation.x=-Math.PI/2;warn.position.copy(center);warn.position.y=.05;scene.add(warn);
          toast('❄ 冰霜领主：冰圈！');
          setTimeout(()=>{
            scene.remove(warn);
            const cur=e.mesh.position.clone().setY(0);
            if(pp.distanceTo(cur)<8){
              damagePlayer(rand(e.def.dmg[0],e.def.dmg[1])*1.2*(1+e.level*.2), e);
              // 玩家减速：通过 invuln 系统不能减速；用临时移速 buff 标记
              player._frozenT = 3;   // 主循环里读它给移速打折
            }
            const aoe=new THREE.Mesh(new THREE.CircleGeometry(8,48),new THREE.MeshBasicMaterial({color:0x6abfff,transparent:true,opacity:.45,side:THREE.DoubleSide}));
            aoe.rotation.x=-Math.PI/2;aoe.position.copy(cur);aoe.position.y=.05;scene.add(aoe);
            aoes.push({mesh:aoe,life:.6,maxLife:.6});
            flashAt(cur.clone().setY(1.5),0x6abfff,5);
          },800);
        }
      }
    }

    // ===== 冲锋中：直线突进，撞到玩家伤害+击退自己停止 =====
    if(e.chargeData){
      const sp=14; // 冲锋速度
      e.mesh.position.add(e.chargeData.dir.clone().multiplyScalar(sp*dt));
      e.chargeData.time-=dt;
      // 朝向冲锋方向
      const lk=e.mesh.position.clone().add(e.chargeData.dir);
      e.mesh.lookAt(lk.x,e.mesh.position.y,lk.z);
      if(dist<2.2){
        damagePlayer(rand(e.def.dmg[0],e.def.dmg[1])*2*(1+e.level*.2));
        // 撞飞玩家
        player.vel.y=4;
        e.chargeData=null;
      } else if(e.chargeData && e.chargeData.time<=0){
        e.chargeData=null;
      }
      e.mesh.position.x=clamp(e.mesh.position.x,-95,95);
      e.mesh.position.z=clamp(e.mesh.position.z,-95,95);
      continue; // 冲锋时不走下面的常规 AI
    }

    // ===== "逾期未清"暴怒机制：出生 60 秒未死 → 主动锁定玩家 =====
    if(!e.enraged && performance.now() - e.spawnedAt > 60000){
      e.enraged = true;
      // 视野和缠绕距离扩到无限大；状态切到追击
      e.aggro = 9999;
      e.leash = 9999;
      // 视觉：敌人发红光标记狂暴（克隆共享材质，避免染红同种其它怪）
      tintEnemyBody(e.mesh, 0xff3030, 0.6);
      // 整波第一只暴怒时给一次警告（避免刷屏）
      if(!window._enrageWarned || performance.now() - window._enrageWarned > 3000){
        toast('⚠ 残余敌人进入暴怒！主动追击！');
        Audio.bossSpawn && Audio.bossSpawn();
        window._enrageWarned = performance.now();
      }
    }

    // ===== 状态机（漫游/追击/远程/近战）=====
    const aggro = e.state==='wander' ? e.aggro : e.leash; // 已激活后视野更远
    const isRanged = e.def.role==='ranged';

    if(dist > aggro){
      // 漫游：在自身附近随机走
      e.state='wander';
      e.wanderTimer-=dt;
      if(!e.wanderTarget || e.wanderTimer<=0 ||
         e.mesh.position.distanceTo(e.wanderTarget)<0.5){
        const a=Math.random()*Math.PI*2;
        const r=rand(2,6);
        e.wanderTarget=new THREE.Vector3(
          clamp(e.mesh.position.x+Math.cos(a)*r,-95,95),
          0,
          clamp(e.mesh.position.z+Math.sin(a)*r,-95,95));
        e.wanderTimer=rand(2,4);
      }
      const wd=e.wanderTarget.clone().sub(e.mesh.position).setY(0);
      if(wd.length()>0.1){
        const sp=e.spd*0.4*(e.slow>0?.4:1);
        e.mesh.position.add(wd.normalize().multiplyScalar(sp*dt));
        // 朝行走方向
        const lk=e.mesh.position.clone().add(wd);
        e.mesh.lookAt(lk.x,e.mesh.position.y,lk.z);
      }
    } else {
      // 已发现玩家
      e.state='chase';
      // 远程：保持 prefRng 距离
      if(isRanged){
        const pref=e.def.prefRng||10;
        if(dist > e.def.rng){
          // 走近到射程
          const sp=e.spd*(e.slow>0?.4:1);
          e.mesh.position.add(toP.clone().normalize().multiplyScalar(sp*dt));
        } else if(dist < pref-2){
          // 太近了，后退（风筝）
          e.state='kite';
          const sp=e.spd*0.7*(e.slow>0?.4:1);
          e.mesh.position.add(toP.clone().normalize().multiplyScalar(-sp*dt));
        } else {
          // 在理想距离，停下射击（左右小幅游走，避免站桩）
          const t=performance.now()*0.001+i;
          const side=new THREE.Vector3(-toP.z,0,toP.x).normalize();
          e.mesh.position.add(side.multiplyScalar(Math.sin(t)*e.spd*0.3*dt));
        }
        // 射击：在攻击距离内 + CD 到了
        if(dist<=e.def.rng && e.atkCd<=0 && player.hp>0){
          e.atkCd=e.def.atk;
          const dmg=rand(e.def.dmg[0],e.def.dmg[1])*e.dmgBuff*(1+e.level*.2);
          // 给玩家位置带一点提前量
          const aim=pp.clone();
          spawnEnemyProjectile(e.mesh.position,aim,e.def.projType,dmg,e.def.projColor);
        }
      } else {
        // 近战
        if(dist < e.def.rng){
          e.state='attack';
          if(e.atkCd<=0 && player.hp>0){
            e.atkCd=e.def.atk;
            const dmg=rand(e.def.dmg[0],e.def.dmg[1])*e.dmgBuff*(1+e.level*.2);
            damagePlayer(dmg, e);
          }
        } else {
          const sp=e.spd*(e.slow>0?.4:1);
          e.mesh.position.add(toP.clone().normalize().multiplyScalar(sp*dt));
        }
      }
    }

    e.mesh.position.x=clamp(e.mesh.position.x,-95,95);
    e.mesh.position.z=clamp(e.mesh.position.z,-95,95);
  }
  // 回血回蓝
  if(player.hp>0&&player.hp<player.hpMax)player.hp=Math.min(player.hpMax,player.hp+player.hpRegen*dt);
  if(player.mp<player.mpMax)player.mp=Math.min(player.mpMax,player.mp+player.mpRegen*dt);
  // 防御性状态计时衰减
  if((player.shieldT||0)>0){
    player.shieldT-=dt;
    if(player.shieldT<=0){ player.shieldT=0; player.shield=0; player.shieldMax=0; }
  }
  if((player.hasteT||0)>0){
    player.hasteT-=dt;
    if(player.hasteT<=0){ player.hasteT=0; player.dmgReduce=0; }
  }
  refreshInfo();
  drawMinimap();
}

// ===================== 自适应画质（PerfMon）=====================
// 监控帧时间：连续低帧 → 逐级降级（pixelRatio / 阴影 / 雾距 / particlesEnabled）
// 帧率恢复 → 逐级回升。等级 0(原始) ~ 3(最简)
const PerfMon = (function(){
  let level = 0;                  // 当前降级等级
  let lowAcc = 0, highAcc = 0;    // 连续低/高帧累计时长
  let avgFrame = 16.67;           // 滑动平均帧时长 ms
  let initial = null;             // 初始 pixelRatio/shadow/fog
  // 触屏模式起点比 PC 更低
  function caps(){
    return InputMode.current==='touch'
      ? { pr:[1.0, 0.85, 0.7, 0.55], fog:[100, 90, 75, 60], shadow:[false,false,false,false], particles:[true,true,false,false] }
      : { pr:[devicePixelRatio||1, 1.0, 0.85, 0.7], fog:[160, 140, 120, 100], shadow:[true, true, false, false], particles:[true,true,true,false] };
  }
  function applyLevel(L){
    if(!renderer) return;
    const c = caps();
    L = Math.max(0, Math.min(3, L));
    try{ renderer.setPixelRatio(c.pr[L]); }catch(_){}
    try{ renderer.shadowMap.enabled = c.shadow[L]; }catch(_){}
    if(scene && scene.fog){ scene.fog.far = c.fog[L]; }
    window._perfParticlesOn = c.particles[L];
    level = L;
  }
  function snapshot(){
    if(initial) return;
    initial = {
      pr: renderer ? renderer.getPixelRatio() : 1,
      shadow: renderer ? renderer.shadowMap.enabled : false,
      fog: scene && scene.fog ? scene.fog.far : 160,
    };
  }
  return {
    tick(dt){
      if(!renderer) return;
      snapshot();
      const ms = dt*1000;
      // 滑动平均（α=0.1）
      avgFrame = avgFrame*0.9 + ms*0.1;
      // < 22fps = 45ms：紧急降级；< 35fps = 28.5ms：累计降级；> 55fps = 18.18ms：累计升级
      if(avgFrame > 28.5){ lowAcc += dt; highAcc = 0; }
      else if(avgFrame < 18.18){ highAcc += dt; lowAcc = 0; }
      else { lowAcc *= 0.95; highAcc *= 0.95; }
      // 连续 1.0s 低帧 → 降级
      if(lowAcc > 1.0 && level < 3){
        applyLevel(level+1);
        lowAcc = 0;
        if(typeof toast==='function') toast(`📉 画质降级 L${level}（卡顿优化）`);
      }
      // 连续 3.5s 高帧 → 升级（更保守，避免反复抖动）
      if(highAcc > 3.5 && level > 0){
        applyLevel(level-1);
        highAcc = 0;
        if(typeof toast==='function') toast(`📈 画质回升 L${level}`);
      }
    },
    level(){ return level; },
    particlesOn(){ return window._perfParticlesOn !== false; },
  };
})();

function loop(){
  try{
    const dt=Math.min(.05,clock.getDelta());
    PerfMon.tick(dt);   // 自适应画质：低帧降级、回升时复原
    if(gamePaused){
      // 暂停状态下也轮询手柄，让 Start / Y / B / 背包导航仍然有效
      const padIn = pollGamepad(dt);
      const invOpen = invPanel && invPanel.style.display==='block';
      if(padIn){
        if(padIn.start){
          if(player._dead){
            const rv = document.getElementById('btnDeathRevive');
            if(rv) rv.click(); else respawn();
          }
          else if(overlay && overlay.style.display!=='none'){
            // 开始菜单 / 暂停菜单 → Start 进入游戏
            startOrResumeGame();
          }
          else if(invOpen){ toggleInv(true); }
        }
        const fuseOpenEarly = fusePanelEl && fusePanelEl.style.display==='flex';
        const sockOpenEarly = socketPanelEl() && socketPanelEl().style.display==='flex';
        const gemUseEl = document.getElementById('gemUsePanel');
        const gemUseOpen = gemUseEl && gemUseEl.style.display==='flex';
        if(padIn.invToggle && invOpen && !fuseOpenEarly && !sockOpenEarly && !gemUseOpen) toggleInv(true);
        if(padIn.cancel    && invOpen && !fuseOpenEarly && !sockOpenEarly && !gemUseOpen) toggleInv(true);

        // 宝石使用浮窗打开时：手柄选孔位
        if(gemUseOpen){
          if(padIn.cancel || padIn.invToggle){ closeGemUsePanel(); }
          else {
            if(padIn.skill2) gemUseNavMove(-1);     // ↑ 上一件装备
            if(padIn.skill4) gemUseNavMove( 1);     // ↓ 下一件装备
            if(padIn.skill1) gemUseNavMoveSlot(-1); // ← 同装备内上一个孔
            if(padIn.skill3) gemUseNavMoveSlot( 1); // → 同装备内下一个孔
            // 摇杆按住重复（Y 主轴跨装备，X 主轴跨孔位）
            _stickRepeatT -= dt;
            const sx = padIn.lx, sy = padIn.ly;
            const ax = Math.abs(sx), ay = Math.abs(sy);
            if(ax>0.5 || ay>0.5){
              if(_stickRepeatT<=0){
                if(ay >= ax) gemUseNavMove(sy>0 ? 1 : -1);
                else         gemUseNavMoveSlot(sx>0 ? 1 : -1);
                _stickRepeatT = 0.22;
              }
            } else {
              _stickRepeatT = 0;
            }
            if(padIn.jump) gemUseNavConfirm();
          }
        }

        // 镶嵌面板打开时：手柄在宝石/孔位间导航
        if(sockOpenEarly){
          if(padIn.cancel || padIn.invToggle){ closeSocketPanel(); }
          else {
            // D-Pad：上下=同列内移动，左右=跨列跳转
            if(padIn.skill2) sockNavVert(-1);    // ↑
            if(padIn.skill4) sockNavVert( 1);    // ↓
            if(padIn.skill1) sockNavHoriz(-1);   // ← 跨列
            if(padIn.skill3) sockNavHoriz( 1);   // → 跨列
            // 左摇杆按住节奏重复
            _stickRepeatT -= dt;
            const sx = padIn.lx, sy = padIn.ly;
            const ax = Math.abs(sx), ay = Math.abs(sy);
            if(ax>0.5 || ay>0.5){
              if(_stickRepeatT<=0){
                if(ay >= ax){
                  // 垂直为主 → 列内移动
                  sockNavVert(sy>0 ? 1 : -1);
                } else {
                  // 水平为主 → 跨列
                  sockNavHoriz(sx>0 ? 1 : -1);
                }
                _stickRepeatT = 0.22;
              }
            } else {
              _stickRepeatT = 0;
            }
            // A 确认（选宝石 / 镶嵌 / 取出）
            if(padIn.jump) sockNavConfirm();
          }
        }

        // ===== 合成面板打开时：手柄输入用于面板导航，不再传给背包 =====
        const fuseOpen = fusePanelEl && fusePanelEl.style.display==='flex';
        if(fuseOpen){
          if(_fuseAnimating){
            // 动画期间无视任何输入
          } else {
            // D-Pad 上/下 选择
            if(padIn.skill2) fuseMoveSel(-1);  // ↑
            if(padIn.skill4) fuseMoveSel( 1);  // ↓
            // 左摇杆按住：节奏重复
            _stickRepeatT -= dt;
            const sy = padIn.ly;
            if(Math.abs(sy)>0.5){
              if(_stickRepeatT<=0){
                fuseMoveSel(sy>0?1:-1);
                _stickRepeatT = 0.20;
              }
            } else {
              _stickRepeatT = 0;
            }
            // A 确认合成
            if(padIn.jump) fuseConfirmSel();
            // B / Y 关闭
            if(padIn.cancel || padIn.invToggle) closeFusePanel();
          }
        }
        // ===== 背包内的手柄导航（合成/镶嵌/宝石使用面板未打开时） =====
        else if(invOpen && !sockOpenEarly && !gemUseOpen){
          // D-Pad：单步移动
          if(padIn.skill1) movePadCursor(-1,0);  // ←
          if(padIn.skill3) movePadCursor( 1,0);  // →
          if(padIn.skill2) movePadCursor(0,-1);  // ↑
          if(padIn.skill4) movePadCursor(0, 1);  // ↓
          // 左摇杆：连续按住时按重复节奏移动（约 5 次/秒）
          _stickRepeatT -= dt;
          const sx = padIn.lx, sy = padIn.ly;
          if(Math.abs(sx)>0.5 || Math.abs(sy)>0.5){
            if(_stickRepeatT<=0){
              const dx = sx> 0.5 ? 1 : sx<-0.5 ? -1 : 0;
              const dy = sy> 0.5 ? 1 : sy<-0.5 ? -1 : 0;
              if(dx||dy){ movePadCursor(dx,dy); _stickRepeatT = 0.18; }
            }
          } else {
            _stickRepeatT = 0;  // 摇杆回中立即取消重复
          }
          // A = 装备
          if(padIn.jump)   padEquipCurrent();
          // X = 丢弃
          if(padIn.pickup) padDropCurrent();
          // LB = 切换"自动换装"勾选
          if(padIn.skillPrev) padToggleAutoEquip();
          // RB = 执行 3 合 1 合成（如果当前有可合成组合）
          if(padIn.skillNext) padTryFuse();
          // Back = 整理背包
          if(padIn.back) sortInv();
        }
      }
      refreshInfo();
      drawMinimap();
      updateScreenShake(dt);
    } else {
      update(dt);
    }
    // 让星空跟随玩家（永远在远处）
    updateStars();
    renderer.render(scene,camera);
  } catch(err){
    console.error('[Game Loop Error]', err);
    // 单帧异常不让循环死掉
  }
  requestAnimationFrame(loop);
}
loop();

