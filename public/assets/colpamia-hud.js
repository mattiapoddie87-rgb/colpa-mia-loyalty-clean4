/* === HUD FUTURISTICO A CIRCUITI (rev. neon) ===============================
   - Canvas a tutta pagina con “tracce” ciano/arancio simili alla reference
   - Glow forte (+ impulso che corre), board grid tenue sullo sfondo
   - Zero dipendenze; non tocca il layout del sito
============================================================================ */

(() => {
  const DPR = Math.min(2, window.devicePixelRatio || 1);

  // crea il canvas se non esiste
  let canvas = document.getElementById('circuits');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'circuits';
    document.body.prepend(canvas);
  }
  const ctx = canvas.getContext('2d');

  let W = 0, H = 0;

  const GRID = { gap: 34, jitter: 6 };        // spaziatura “rami” pcb
  let traces = [];

  // palette ispirata alla reference: coppie gradiente per le piste
  const PAIRS = [
    ['#08e8ff', '#00d7ff'], // cyan -> blue
    ['#ffb100', '#ff7a00'], // amber -> orange
  ];

  function resize() {
    W = canvas.width  = Math.floor(innerWidth  * DPR);
    H = canvas.height = Math.floor(innerHeight * DPR);
    canvas.style.width  = innerWidth  + 'px';
    canvas.style.height = innerHeight + 'px';
    buildTraces();
  }
  window.addEventListener('resize', resize, { passive: true });

  // costruisce “tracce” (polilinee a passi ortogonali)
  function buildTraces() {
    traces.length = 0;
    const count = Math.min(26, Math.floor((innerWidth * innerHeight) / 25000));
    for (let i = 0; i < count; i++) {
      const start = { x: Math.random() * innerWidth, y: Math.random() * innerHeight };
      const len   = 6 + Math.floor(Math.random() * 10);
      const dirs  = [[1,0],[-1,0],[0,1],[0,-1]];

      let p = { ...start };
      const pts = [p];
      for (let k = 0; k < len; k++) {
        const d = dirs[(Math.random() * 4) | 0];
        p = {
          x: clamp(p.x + d[0] * (GRID.gap + Math.random() * GRID.gap), 0, innerWidth),
          y: clamp(p.y + d[1] * (GRID.gap + Math.random() * GRID.gap), 0, innerHeight)
        };
        pts.push(p);
      }

      const pair = PAIRS[(Math.random() * PAIRS.length) | 0];
      traces.push({
        pts,
        c1: pair[0],
        c2: pair[1],
        width: 2.5 + Math.random() * 2.6,
        speed: 50  + Math.random() * 120,
        t: Math.random() * 1000
      });
    }
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function gridLayer() {
    // griglia pcb molto tenue
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = '#0a3b4d';
    ctx.lineWidth = 1 * DPR;

    const gap = GRID.gap * DPR;
    for (let x = 0; x <= W; x += gap) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y <= H; y += gap) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // sotto-griglia diagonale leggera per profondità
    ctx.globalAlpha = 0.06;
    ctx.strokeStyle = '#0f2230';
    for (let x = gap/2; x <= W; x += gap) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = gap/2; y <= H; y += gap) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.restore();
  }

  function polyLength(pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i-1].x, dy = pts[i].y - pts[i-1].y;
      L += Math.hypot(dx, dy);
    }
    return L;
  }

  function drawTrace(tr) {
    const pts = tr.pts;
    const lw  = tr.width * DPR;

    // bagliore sotto (ombra colorata)
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap  = 'round';
    ctx.shadowBlur  = 18 * DPR;
    ctx.shadowColor = tr.c1;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = lw * 1.8;
    ctx.strokeStyle = tr.c1;
    ctx.beginPath();
    ctx.moveTo(pts[0].x * DPR, pts[0].y * DPR);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x * DPR, pts[i].y * DPR);
    }
    ctx.stroke();
    ctx.restore();

    // linea principale con gradiente
    const p0 = pts[0], p1 = pts[pts.length - 1];
    const grad = ctx.createLinearGradient(p0.x * DPR, p0.y * DPR, p1.x * DPR, p1.y * DPR);
    grad.addColorStop(0, tr.c1);
    grad.addColorStop(1, tr.c2);

    ctx.lineWidth  = lw;
    ctx.strokeStyle = grad;
    ctx.lineJoin = 'round';
    ctx.lineCap  = 'round';
    ctx.beginPath();
    ctx.moveTo(p0.x * DPR, p0.y * DPR);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x * DPR, pts[i].y * DPR);
    }
    ctx.stroke();

    // impulso che corre lungo la traccia
    tr.t += tr.speed * 0.016;
    const L = polyLength(pts);
    let d = (tr.t % L);

    for (let i = 1; i < pts.length; i++) {
      const segL = Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y);
      if (d <= segL || i === pts.length - 1) {
        const r = d / segL;
        const x = (pts[i-1].x + (pts[i].x - pts[i-1].x) * r) * DPR;
        const y = (pts[i-1].y + (pts[i].y - pts[i-1].y) * r) * DPR;

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = tr.c2;
        ctx.shadowBlur  = 25 * DPR;
        ctx.shadowColor = tr.c2;
        ctx.beginPath();
        ctx.arc(x, y, lw * 0.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
      }
      d -= segL;
    }
  }

  let last = 0;
  function loop(ts) {
    last = ts || 0;
    ctx.clearRect(0, 0, W, H);

    // leggero “flicker” di profondità
    ctx.globalAlpha = 1;
    gridLayer();
    for (const tr of traces) drawTrace(tr);

    requestAnimationFrame(loop);
  }

  resize();
  requestAnimationFrame(loop);
})();
