// Cyberpunk BG – crea i layer e li anima.
// Path: /assets/cyberpunk-bg.js

(function () {
  // Evita doppio mount
  if (window.__CP_BG_MOUNTED__) return;
  window.__CP_BG_MOUNTED__ = true;

  // Contenitore
  const root = document.createElement('div');
  root.id = 'cp-bg';
  root.setAttribute('aria-hidden', 'true');
  // pointer-events none + z-index negativo nel CSS
  document.body.prepend(root);

  // Canvas "pioggia" / particelle
  const rain = document.createElement('canvas');
  rain.id = 'cp-rain';
  root.appendChild(rain);

  // Overlay neon (luccichii + scanlines)
  const overlay = document.createElement('div');
  overlay.id = 'cp-overlay';
  overlay.innerHTML = `
    <div class="cp-glow cp-glow-a"></div>
    <div class="cp-glow cp-glow-b"></div>
    <div class="cp-scanlines"></div>
    <div class="cp-vignette"></div>
  `;
  root.appendChild(overlay);

  // Canvas neon-wires (linee che si accendono)
  const wires = document.createElement('canvas');
  wires.id = 'cp-wires';
  root.appendChild(wires);

  const ctxRain = rain.getContext('2d');
  const ctxWires = wires.getContext('2d', { alpha: true });

  // Resize
  function fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = innerWidth;
    const h = innerHeight;
    [rain, wires].forEach(c => {
      c.width = Math.floor(w * dpr);
      c.height = Math.floor(h * dpr);
      c.style.width = w + 'px';
      c.style.height = h + 'px';
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
  }
  window.addEventListener('resize', fit, { passive: true });
  fit();

  // ------ RAIN / PARTICLES ------
  const drops = [];
  const DROP_COUNT = 160;
  function initRain() {
    drops.length = 0;
    for (let i = 0; i < DROP_COUNT; i++) {
      drops.push({
        x: Math.random() * innerWidth,
        y: Math.random() * innerHeight,
        l: 5 + Math.random() * 15,
        v: 4 + Math.random() * 6,
        o: 0.15 + Math.random() * 0.3,
      });
    }
  }
  initRain();

  // ------ WIRES (linee neon) ------
  let paths = [];
  function makePaths() {
    const cols = 8;
    const rows = 6;
    const gapX = innerWidth / cols;
    const gapY = innerHeight / rows;
    const rnd = (a, b) => a + Math.random() * (b - a);

    paths = [];
    for (let r = 0; r <= rows; r++) {
      const y = Math.floor(r * gapY + rnd(-12, 12));
      const p = [];
      for (let c = 0; c <= cols; c++) {
        const x = Math.floor(c * gapX + rnd(-14, 14));
        p.push([x, y + Math.sin(c * 0.9 + r * 0.5) * rnd(4, 18)]);
      }
      paths.push(p);
    }
    for (let c = 0; c <= cols; c++) {
      const x = Math.floor(c * gapX + rnd(-10, 10));
      const p = [];
      for (let r = 0; r <= rows; r++) {
        const y = Math.floor(r * gapY + rnd(-10, 10));
        p.push([x + Math.cos(r * 0.6 + c * 0.8) * rnd(4, 16), y]);
      }
      paths.push(p);
    }
  }
  makePaths();
  window.addEventListener('resize', makePaths, { passive: true });

  // Palette neon
  const colors = [
    'rgba(0, 210, 255, .75)',   // cyan
    'rgba(255, 70, 200, .75)',  // magenta
    'rgba(255, 190, 0, .75)',   // amber
    'rgba(120, 255, 180, .75)', // mint
    'rgba(80, 110, 255, .75)'   // electric blue
  ];

  // Stato animazione
  let t0 = performance.now();
  const MOTION = (typeof window.CYBERPUNK_MOTION === 'boolean')
    ? window.CYBERPUNK_MOTION
    : true;

  // DRAW
  function frame(now) {
    const dt = Math.min(32, now - t0);
    t0 = now;

    // --- Rain ---
    ctxRain.clearRect(0, 0, innerWidth, innerHeight);
    ctxRain.lineWidth = 1.2;
    for (const d of drops) {
      ctxRain.strokeStyle = `rgba(180,200,255,${d.o})`;
      ctxRain.beginPath();
      ctxRain.moveTo(d.x, d.y);
      ctxRain.lineTo(d.x + 2, d.y + d.l);
      ctxRain.stroke();
      if (MOTION) {
        d.x += 0.4;
        d.y += d.v * (dt / 16);
      }
      if (d.y > innerHeight + 20) {
        d.y = -20;
        d.x = Math.random() * innerWidth;
      }
    }

    // --- Wires ---
    ctxWires.clearRect(0, 0, innerWidth, innerHeight);
    ctxWires.lineCap = 'round';
    for (let i = 0; i < paths.length; i++) {
      const p = paths[i];
      const col = colors[i % colors.length];
      const w = 2 + (i % 3);
      ctxWires.lineWidth = w;
      ctxWires.strokeStyle = col;
      ctxWires.shadowBlur = 8 + w * 2;
      ctxWires.shadowColor = col;

      // Effetto “corrente” che pulsa lungo la linea
      const pulse = (Math.sin((now * 0.002) + i * 0.9) + 1) * 0.5; // 0..1
      ctxWires.globalAlpha = 0.25 + pulse * 0.7;

      ctxWires.beginPath();
      ctxWires.moveTo(p[0][0], p[0][1]);
      for (let k = 1; k < p.length; k++) ctxWires.lineTo(p[k][0], p[k][1]);
      ctxWires.stroke();
    }
    ctxWires.globalAlpha = 1;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Accessibilità: riduci movimento se l’utente lo preferisce
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  function applyMotionPreference() {
    if (mq.matches) {
      document.documentElement.style.setProperty('--cp-motion', '0');
    } else {
      document.documentElement.style.setProperty('--cp-motion', '1');
    }
  }
  mq.addEventListener?.('change', applyMotionPreference);
  applyMotionPreference();

  // Debug helper
  window.CP_BG_READY = true;
})();
