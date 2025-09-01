/* =================== COLPA MIA — CYBERPUNK HUD v2 (HD) =====================
   - Canvas full-screen (id: cp-hud) con:
     • Griglia PCB tenue
     • “Circuiti” fitti in stile neon (ciano/magenta/ambra), glow in HD
     • Impulsi che corrono sulle piste
     • Parallax leggero su mouse/scroll
     • Autoscaling densità per device lenti
   - Glitch elegante sul titolo .hero__title (non invasivo)
============================================================================= */

(() => {
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  const PAIRS = [
    ['#10f1ff','#00b7ff'],  // cyan -> blue
    ['#ff3bd4','#a56fff'],  // pink -> violet
    ['#ffb300','#ff7a00']   // amber -> orange
  ];

  // crea canvas
  let c = document.getElementById('cp-hud');
  if (!c){
    c = document.createElement('canvas');
    c.id = 'cp-hud';
    document.body.prepend(c);
  }
  const ctx = c.getContext('2d');

  // glitch sul titolo (non tocco l'HTML)
  const h = document.querySelector('.hero__title');
  if (h && !h.classList.contains('cp-glitch')){
    h.dataset.text = h.textContent.trim();
    h.classList.add('cp-glitch');
  }

  let W=0, H=0;
  let parallax = {x:0,y:0};

  // struttura dei “circuiti”
  let traces = [];
  const GRID = { gap: 26, jitter: 10 };  // più gap => più ordine; meno => più fitto

  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

  function resize(){
    W = c.width  = Math.floor(innerWidth  * DPR);
    H = c.height = Math.floor(innerHeight * DPR);
    c.style.width  = innerWidth  + 'px';
    c.style.height = innerHeight + 'px';
    build();
  }
  addEventListener('resize', resize, {passive:true});

  // densità adattiva in base alla dimensione schermo
  function targetCount(){
    const base = (innerWidth*innerHeight)/14000; // più basso => più fitto
    return clamp(Math.floor(base), 22, 120);
  }

  // genera piste ortogonali con deviazioni
  function build(){
    traces.length = 0;

    const n = targetCount();
    for (let i=0;i<n;i++){
      const start = {
        x: Math.random()*innerWidth,
        y: Math.random()*innerHeight
      };
      const steps = 8 + (Math.random()*10)|0;
      const pts = [start];
      const dirs = [[1,0],[-1,0],[0,1],[0,-1]];

      let p = {...start};
      for (let k=0;k<steps;k++){
        const d = dirs[(Math.random()*dirs.length)|0];
        const jitter = (Math.random()*GRID.jitter) - (GRID.jitter/2);
        p = {
          x: clamp(p.x + d[0]*(GRID.gap + Math.random()*GRID.gap) + jitter, 0, innerWidth),
          y: clamp(p.y + d[1]*(GRID.gap + Math.random()*GRID.gap) + jitter, 0, innerHeight)
        };
        pts.push(p);
      }

      const pair = PAIRS[(Math.random()*PAIRS.length)|0];
      traces.push({
        pts,
        c1: pair[0],
        c2: pair[1],
        width: 2.2 + Math.random()*2.8,
        speed: 60 + Math.random()*160,
        t: Math.random()*1000
      });
    }
  }

  // leggera griglia PCB
  function drawGrid(){
    const g = 36 * DPR;
    ctx.save();
    ctx.globalAlpha = .12;
    ctx.strokeStyle = '#0d3346';
    ctx.lineWidth = 1*DPR;
    for (let x = (parallax.x*0.5)%g; x <= W; x += g){
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke();
    }
    for (let y = (parallax.y*0.5)%g; y <= H; y += g){
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
    }
    ctx.globalAlpha = .06;
    ctx.strokeStyle = '#0a2231';
    const g2 = g/2;
    for (let x = (parallax.x*0.5)%g2; x <= W; x += g2){
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke();
    }
    for (let y = (parallax.y*0.5)%g2; y <= H; y += g2){
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
    }
    ctx.restore();
  }

  // lunghezza polilinea
  function polyLength(pts){
    let L=0;
    for (let i=1;i<pts.length;i++){
      const dx = pts[i].x-pts[i-1].x, dy = pts[i].y-pts[i-1].y;
      L += Math.hypot(dx,dy);
    }
    return L;
  }

  function drawTrace(tr){
    const pts = tr.pts;
    const lw  = tr.width * DPR;

    // bagliore
    if (getComputedStyle(document.documentElement).getPropertyValue('--cp-glow') !== '0'){
      ctx.save();
      ctx.lineJoin='round'; ctx.lineCap='round';
      ctx.globalCompositeOperation='lighter';
      ctx.shadowBlur = 20*DPR;
      ctx.shadowColor = tr.c1;
      ctx.lineWidth = lw*1.9;
      ctx.strokeStyle = tr.c1;
      ctx.beginPath();
      ctx.moveTo( (pts[0].x+parallax.x)*DPR, (pts[0].y+parallax.y)*DPR );
      for (let i=1;i<pts.length;i++){
        ctx.lineTo( (pts[i].x+parallax.x)*DPR, (pts[i].y+parallax.y)*DPR );
      }
      ctx.stroke();
      ctx.restore();
    }

    // linea principale (gradiente)
    const p0 = pts[0], p1 = pts[pts.length-1];
    const grd = ctx.createLinearGradient(
      (p0.x+parallax.x)*DPR,(p0.y+parallax.y)*DPR,
      (p1.x+parallax.x)*DPR,(p1.y+parallax.y)*DPR
    );
    grd.addColorStop(0,tr.c1);
    grd.addColorStop(1,tr.c2);
    ctx.lineWidth = lw;
    ctx.strokeStyle = grd;
    ctx.lineJoin='round'; ctx.lineCap='round';
    ctx.beginPath();
    ctx.moveTo( (p0.x+parallax.x)*DPR, (p0.y+parallax.y)*DPR );
    for (let i=1;i<pts.length;i++){
      ctx.lineTo( (pts[i].x+parallax.x)*DPR, (pts[i].y+parallax.y)*DPR );
    }
    ctx.stroke();

    // impulso
    tr.t += tr.speed * 0.016;
    const L = polyLength(pts);
    let d = tr.t % L;
    for (let i=1;i<pts.length;i++){
      const ax=pts[i-1].x, ay=pts[i-1].y, bx=pts[i].x, by=pts[i].y;
      const segL = Math.hypot(bx-ax, by-ay);
      if (d <= segL || i===pts.length-1){
        const r = d/segL;
        const x = (ax + (bx-ax)*r + parallax.x)*DPR;
        const y = (ay + (by-ay)*r + parallax.y)*DPR;
        ctx.save();
        ctx.globalCompositeOperation='lighter';
        ctx.fillStyle = tr.c2;
        ctx.shadowBlur = 28*DPR;
        ctx.shadowColor = tr.c2;
        ctx.beginPath(); ctx.arc(x,y,lw*.9,0,Math.PI*2); ctx.fill();
        ctx.restore();
        break;
      }
      d -= segL;
    }
  }

  // parallax su mouse/scroll
  addEventListener('mousemove', e=>{
    const nx = (e.clientX / innerWidth - .5) * 16;
    const ny = (e.clientY / innerHeight - .5) * 16;
    parallax.x += (nx - parallax.x)*.06;
    parallax.y += (ny - parallax.y)*.06;
  }, {passive:true});
  addEventListener('scroll', ()=>{
    const s = scrollY;
    parallax.y = (s % 100) * .06;
  }, {passive:true});

  // main loop
  let last=0, drop=0;
  function loop(t){
    const dt = t - last; last = t;
    // semplice controllo fps: se scende spesso, riduci densità
    if (dt > 30) drop++;
    if (drop > 12){ GRID.gap = Math.min(GRID.gap+2, 40); drop=0; build(); }

    ctx.clearRect(0,0,W,H);
    drawGrid();
    for (let i=0;i<traces.length;i++) drawTrace(traces[i]);
    requestAnimationFrame(loop);
  }

  resize();
  requestAnimationFrame(loop);
})();
