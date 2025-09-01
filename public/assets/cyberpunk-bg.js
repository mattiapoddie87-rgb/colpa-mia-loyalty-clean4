/* Cyberpunk City BG — canvas procedural, no assets, © you.
   Toggle:  window.CYBERPUNK_MOTION = false  -> disegna frame statico.
*/
(() => {
  const DISABLE_MOTION =
    window.CYBERPUNK_MOTION === false ||
    (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // crea canvas + overlay se non esistono
  let cvs = document.getElementById('cp-bg');
  if (!cvs) {
    cvs = document.createElement('canvas');
    cvs.id = 'cp-bg';
    document.body.prepend(cvs);
  }
  if (!document.getElementById('cp-fx')) {
    const fx = document.createElement('div');
    fx.id = 'cp-fx';
    const bloom = document.createElement('div');
    bloom.className = 'cp-bloom';
    document.body.appendChild(fx);
    document.body.appendChild(bloom);
  }

  const ctx = cvs.getContext('2d', { alpha: false });
  let W = 0, H = 0, DPR = Math.min(2.5, window.devicePixelRatio || 1);

  // LAYER DATA
  let buildings = [];
  let rains = [];
  let beams = [];
  let drones = [];
  let t = 0;

  function rnd(a,b){ return a + Math.random()*(b-a); }

  function resize() {
    W = Math.max(1280, window.innerWidth);
    H = Math.max(720, window.innerHeight);
    cvs.width = Math.floor(W * DPR);
    cvs.height = Math.floor(H * DPR);
    cvs.style.width = W + 'px';
    cvs.style.height = H + 'px';

    // rigenera città
    genCity();
    genRain();
    genBeams();
    genDrones();
    drawStatic(); // skyline e base
  }

  // ---------- CITY ----------
  function genCity(){
    buildings = [];
    const baseLine = H * 0.7;
    const layers = 4;
    for (let L=0; L<layers; L++){
      const yOff = baseLine - L * (H * 0.08);
      const count = 14 - L*2;
      let x = rnd(-120, 0);
      for (let i=0; i<count; i++){
        const w = rnd(60, 140) * (1 - L*0.1);
        const h = rnd(H*0.10, H*0.28) * (1 - L*0.1);
        const skew = rnd(-8, 8);
        const glow = (L===0) ? rnd(0.15, 0.35) : rnd(0.05, 0.18);
        buildings.push({
          x, y: yOff - h, w, h, skew, layer:L,
          windows: genWindows(w, h, L),
          glow
        });
        x += w + rnd(24, 50);
      }
    }
  }

  function genWindows(w,h,L){
    const cellsX = Math.max(4, Math.floor(w/10));
    const cellsY = Math.max(4, Math.floor(h/10));
    const on = [];
    for (let j=0;j<cellsY;j++){
      const row = [];
      for (let i=0;i<cellsX;i++){
        // più lontano = meno finestre accese
        const p = 0.25 - L*0.05;
        row.push(Math.random() < p);
      }
      on.push(row);
    }
    return { cellsX, cellsY, on, time:rnd(0,10) };
  }

  // ---------- RAIN ----------
  function genRain(){
    rains = [];
    const n = Math.floor((W*H) / 8000); // densità relativa
    for (let i=0;i<n;i++){
      rains.push({
        x: rnd(0, W), y: rnd(-H, H),
        len: rnd(8, 18),
        spd: rnd(400, 900), // px/s
        alpha: rnd(0.08, 0.18)
      });
    }
  }

  // ---------- LIGHT BEAMS ----------
  function genBeams(){
    beams = [];
    const n = Math.floor(W/420);
    for (let i=0;i<n;i++){
      beams.push({
        y: rnd(H*0.25, H*0.85),
        w: rnd(180, 420),
        life: rnd(2, 6),
        c: (Math.random()<0.5) ? '#00e6ff' : '#ff2f6d',
        phase: rnd(0,99)
      });
    }
  }

  // ---------- DRONES ----------
  function genDrones(){
    drones = [];
    const n = Math.floor(W/380);
    for (let i=0;i<n;i++){
      const dir = Math.random()<0.5 ? 1 : -1;
      drones.push({
        x: dir>0 ? rnd(-W*0.3, -50) : rnd(W+50, W*1.3),
        y: rnd(H*0.25, H*0.65),
        vx: dir * rnd(60, 140),
        color: (Math.random()<0.5) ? '#7cffd4' : '#ffe66d',
        tail: [],
      });
    }
  }

  // ---------- DRAW ----------
  function drawStatic(){
    // cielo + nebbiolina + base città
    ctx.setTransform(DPR,0,0,DPR,0,0);
    ctx.clearRect(0,0,W,H);

    // gradiente notte
    let g = ctx.createLinearGradient(0,0,0,H);
    g.addColorStop(0, '#09111a');
    g.addColorStop(1, '#05080c');
    ctx.fillStyle = g;
    ctx.fillRect(0,0,W,H);

    // skyline layers
    for (let L=3; L>=0; L--){
      const fog = 0.06 + (3-L)*0.04;
      for (const b of buildings) {
        if (b.layer !== L) continue;
        drawBuilding(b, fog);
      }
    }
  }

  function drawBuilding(b, fog){
    const {x,y,w,h,skew,windows,glow} = b;
    ctx.save();
    ctx.translate(x, y);
    ctx.transform(1,0,Math.tan(skew*Math.PI/180)*0.15,1,0,0);
    // corpo
    const base = `rgba(20,40,60,${0.65 - b.layer*0.1})`;
    ctx.fillStyle = base;
    ctx.fillRect(0,0,w,h);

    // glow laterale (neon riflessi)
    const g = ctx.createLinearGradient(0,0,w,0);
    g.addColorStop(0, `rgba(0,230,255,${glow})`);
    g.addColorStop(0.5, 'transparent');
    g.addColorStop(1, `rgba(255,47,109,${glow*0.8})`);
    ctx.fillStyle = g;
    ctx.globalCompositeOperation = 'screen';
    ctx.fillRect(-2,0,w+4,h);
    ctx.globalCompositeOperation = 'source-over';

    // finestre (pattern)
    const cellW = w / windows.cellsX;
    const cellH = h / windows.cellsY;
    for (let j=0;j<windows.cellsY;j++){
      for (let i=0;i<windows.cellsX;i++){
        if (!windows.on[j][i]) continue;
        const px = i*cellW + 1; const py = j*cellH + 1;
        const ww = cellW - 2;  const hh = cellH - 2;
        const c = (Math.random()<0.6) ? 'rgba(255,230,109,.85)' : 'rgba(124,255,212,.85)';
        ctx.fillStyle = c;
        ctx.fillRect(px,py,ww,hh);
        // bloom leggero
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = c;
        ctx.fillRect(px-1,py-1,ww+2,hh+2);
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();

    // foschia sul layer
    ctx.fillStyle = `rgba(0,0,0,${fog})`;
    ctx.fillRect(0,0,W,H);
  }

  function updateWindows(dt){
    // flicker casuale
    for (const b of buildings){
      const w = b.windows;
      w.time += dt;
      if (w.time > 0.15){
        w.time = 0;
        const j = Math.floor(Math.random()*w.cellsY);
        const i = Math.floor(Math.random()*w.cellsX);
        if (Math.random()<0.33){
          w.on[j][i] = !w.on[j][i];
        }
      }
    }
  }

  function drawRain(dt){
    ctx.save();
    ctx.setTransform(DPR,0,0,DPR,0,0);
    ctx.globalCompositeOperation = 'screen';
    ctx.lineWidth = 1;
    for (const r of rains){
      r.y += r.spd * dt;
      r.x += 120 * dt; // vento
      if (r.y > H + 20){ r.y = rnd(-H, -20); r.x = rnd(-20, W+20); }
      ctx.strokeStyle = `rgba(180,190,205,${r.alpha})`;
      ctx.beginPath();
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(r.x - 6, r.y - r.len);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBeams(dt){
    ctx.save();
    ctx.setTransform(DPR,0,0,DPR,0,0);
    for (const b of beams){
      b.phase += dt;
      const amp = 0.65 + Math.sin(b.phase*2)*0.35; // pulsazione
      const y = b.y + Math.sin(b.phase) * 2;
      const grd = ctx.createLinearGradient(0, y, W, y);
      grd.addColorStop(0, 'transparent');
      grd.addColorStop(0.45, `${hex2rgba(b.c, 0.0)}`);
      grd.addColorStop(0.5, `${hex2rgba(b.c, 0.28*amp)}`);
      grd.addColorStop(0.55, `${hex2rgba(b.c, 0.0)}`);
      grd.addColorStop(1, 'transparent');
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = grd;
      ctx.fillRect(0, y-2, W, 4);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }

  function drawDrones(dt){
    ctx.save();
    ctx.setTransform(DPR,0,0,DPR,0,0);
    for (const d of drones){
      d.x += d.vx * dt;
      // wrap
      if (d.vx>0 && d.x>W+60) { d.x = -80; d.y = rnd(H*0.25, H*0.65); }
      if (d.vx<0 && d.x<-60) { d.x = W+80; d.y = rnd(H*0.25, H*0.65); }

      // trail
      d.tail.unshift({x:d.x, y:d.y});
      if (d.tail.length>14) d.tail.pop();

      ctx.globalCompositeOperation = 'screen';
      for (let i=0;i<d.tail.length;i++){
        const p = d.tail[i];
        const a = (1 - i/d.tail.length) * .22;
        ctx.fillStyle = hex2rgba(d.color, a);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3 + (1 - i/d.tail.length)*2, 0, Math.PI*2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }

  let lightning = 0;
  function drawLightning(dt){
    // probabilità bassa di un lampo
    if (lightning<=0 && Math.random()<0.004) lightning = 0.25;
    if (lightning>0){
      lightning -= dt;
      const a = Math.max(0, Math.min(1, lightning*2));
      ctx.setTransform(DPR,0,0,DPR,0,0);
      ctx.fillStyle = `rgba(160,200,255,${0.18*a})`;
      ctx.fillRect(0,0,W,H);
    }
  }

  function hex2rgba(hex, a){
    const m = hex.replace('#','');
    const r = parseInt(m.substring(0,2),16);
    const g = parseInt(m.substring(2,4),16);
    const b = parseInt(m.substring(4,6),16);
    return `rgba(${r},${g},${b},${a})`;
  }

  // ---------- LOOP ----------
  let last = performance.now();
  function loop(now){
    const dt = Math.min(0.033, (now-last)/1000); last = now; t += dt;

    // ridisegna base sfondo (leggera persistenza per bloom)
    ctx.setTransform(DPR,0,0,DPR,0,0);
    ctx.fillStyle = 'rgba(5,8,12,0.6)';
    ctx.fillRect(0,0,W,H);

    // finestre flicker
    updateWindows(dt);

    // ridisegna i building attivi (solo finestre + glow sottile)
    for (const b of buildings){
      // re-draw solo overlay rapido (finestre)
      ctx.save();
      ctx.setTransform(DPR,0,0,DPR, (b.x) * DPR, (b.y) * DPR);
      const w = b.w, h = b.h;
      // pulizia area minima
      ctx.clearRect(0,0,w*DPR,h*DPR);

      // base corpo scuro
      ctx.setTransform(DPR,0,0,DPR, b.x*DPR, b.y*DPR);
      ctx.transform(1,0,Math.tan(b.skew*Math.PI/180)*0.15,1,0,0);
      ctx.fillStyle = `rgba(20,40,60,${0.5 - b.layer*0.08})`;
      ctx.fillRect(0,0,w,h);

      // finestre
      const WN = b.windows;
      const cellW = w / WN.cellsX; const cellH = h / WN.cellsY;
      for (let j=0;j<WN.cellsY;j++){
        for (let i=0;i<WN.cellsX;i++){
          if (!WN.on[j][i]) continue;
          const px = i*cellW + 1; const py = j*cellH + 1;
          const ww = cellW - 2;  const hh = cellH - 2;
          const c = (Math.random()<0.6) ? 'rgba(255,230,109,.85)' : 'rgba(124,255,212,.85)';
          ctx.fillStyle = c; ctx.fillRect(px,py,ww,hh);
          ctx.globalAlpha = 0.2; ctx.fillRect(px-1,py-1,ww+2,hh+2); ctx.globalAlpha = 1;
        }
      }
      ctx.restore();
    }

    drawBeams(dt);
    drawRain(dt);
    drawDrones(dt);
    drawLightning(dt);

    if (!DISABLE_MOTION) requestAnimationFrame(loop);
  }

  resize();
  window.addEventListener('resize', resize, { passive:true });

  if (DISABLE_MOTION){
    // frame statico
    drawStatic();
  } else {
    requestAnimationFrame((n)=>{ last=n; drawStatic(); loop(n); });
  }
})();

