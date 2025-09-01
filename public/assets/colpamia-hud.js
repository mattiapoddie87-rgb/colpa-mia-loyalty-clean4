/* =========================================================
   COLPA MIA — HUD “CIRCUITS”
   Rete di piste circuitali + impulsi di corrente.
   - Canvas dietro ai contenuti (z-index 0)
   - Nessun oscuramento della UI
   - Resistente ai resize, retina-friendly
   - Rispetta prefers-reduced-motion
   ========================================================= */

(function () {
  const prefersReduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Crea/attacca il canvas
  let cvs = document.getElementById('circuits');
  if (!cvs) {
    cvs = document.createElement('canvas');
    cvs.id = 'circuits';
    document.body.appendChild(cvs);
  }
  const ctx = cvs.getContext('2d', { alpha: true });

  // Config
  const LINE_COLOR = getCss('--line', '#0a1624');
  const NODE_COLOR = getCss('--node', '#102235');
  const PULSE_COLORS = [getCss('--pulseA', '#38bdf8'), getCss('--pulseB', '#22d3ee')];

  const BASE_SPACING = 84;        // distanza base tra nodi
  const JITTER = 14;              // random offset sui nodi
  const CONNECT_PROB = 0.82;      // probabilità di collegamento tra nodi vicini
  const PULSES = prefersReduce ? 0 : 28; // numero impulsi simultanei
  const PULSE_SPEED = 0.0019;     // velocità base impulsi
  const ZONE_FLASH_EVERY = prefersReduce ? 999999 : 900; // ogni N ms circa

  let dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  let w = 0, h = 0;

  // Rete di nodi/collegamenti
  let nodes = [];
  let edges = [];
  let adj = new Map(); // adjacency: nodeIndex -> [neighborIndex]

  // Impulsi
  const pulses = [];
  let lastTime = performance.now();
  let lastZoneFlash = 0;

  // Helpers CSS var
  function getCss(v, fallback) {
    const val = getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    return val || fallback;
  }

  // Resize
  function resize() {
    const { innerWidth, innerHeight } = window;
    w = Math.max(1, innerWidth);
    h = Math.max(1, innerHeight);

    cvs.width = Math.floor(w * dpr);
    cvs.height = Math.floor(h * dpr);
    cvs.style.width = w + 'px';
    cvs.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    buildNetwork();
    drawStatic();
  }

  // Costruisce i nodi su griglia jitterata e le connessioni
  function buildNetwork() {
    nodes.length = 0;
    edges.length = 0;
    adj.clear();

    const spacing = BASE_SPACING;
    const cols = Math.ceil(w / spacing) + 2;
    const rows = Math.ceil(h / spacing) + 2;

    // crea nodi
    for (let j = -1; j <= rows; j++) {
      for (let i = -1; i <= cols; i++) {
        const x = i * spacing + (Math.random() * 2 - 1) * JITTER;
        const y = j * spacing + (Math.random() * 2 - 1) * JITTER;
        nodes.push({ x, y });
      }
    }

    // funzione per convertire (i,j) in indice
    function idx(i, j) {
      return (j + 1) * (cols + 2) + (i + 1);
    }

    // collega a destra e in basso con probabilità; così crei piste rettilinee
    for (let j = -1; j <= rows; j++) {
      for (let i = -1; i <= cols; i++) {
        const a = idx(i, j);
        if (i < cols && Math.random() < CONNECT_PROB) {
          const b = idx(i + 1, j);
          addEdge(a, b);
        }
        if (j < rows && Math.random() < CONNECT_PROB) {
          const b = idx(i, j + 1);
          addEdge(a, b);
        }
      }
    }

    // adjacency per gli impulsi
    edges.forEach(e => {
      if (!adj.has(e.a)) adj.set(e.a, []);
      if (!adj.has(e.b)) adj.set(e.b, []);
      adj.get(e.a).push(e.b);
      adj.get(e.b).push(e.a);
    });

    // reset impulsi
    pulses.length = 0;
    for (let i = 0; i < PULSES; i++) pulses.push(newPulse());
  }

  function addEdge(a, b) {
    if (a === b) return;
    const na = nodes[a], nb = nodes[b];
    // rifiuta collegamenti troppo lunghi (bordo)
    const dx = na.x - nb.x, dy = na.y - nb.y;
    const d2 = dx * dx + dy * dy;
    const maxD2 = (BASE_SPACING * 1.6) * (BASE_SPACING * 1.6);
    if (d2 > maxD2) return;

    edges.push({ a, b, len: Math.sqrt(d2) });
  }

  // Disegno statico delle piste/nodi
  function drawStatic() {
    ctx.clearRect(0, 0, w, h);

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';

    // piste
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    edges.forEach(e => {
      const A = nodes[e.a], B = nodes[e.b];
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
    });
    ctx.stroke();

    // nodi
    ctx.fillStyle = NODE_COLOR;
    ctx.globalAlpha = 0.25;
    nodes.forEach(n => {
      ctx.beginPath();
      ctx.arc(n.x, n.y, 1.2, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.restore();
  }

  // Crea un impulso su un nodo casuale
  function newPulse() {
    const keys = Array.from(adj.keys());
    if (!keys.length) return null;
    const from = keys[(Math.random() * keys.length) | 0];
    const nexts = adj.get(from);
    if (!nexts || !nexts.length) return null;
    const to = nexts[(Math.random() * nexts.length) | 0];
    return {
      from,
      to,
      t: Math.random(), // posizione lungo l’arco (0..1)
      speed: PULSE_SPEED * (0.65 + Math.random() * 1.1),
      color: PULSE_COLORS[(Math.random() * PULSE_COLORS.length) | 0],
      size: 1 + Math.random() * 1.2
    };
  }

  // step di un impulso; quando arriva a un nodo, sceglie una nuova direzione
  function updatePulse(p, dt) {
    if (!p) return;
    p.t += p.speed * dt;
    while (p.t >= 1) {
      p.t -= 1;
      // scegli nuova direzione
      const options = adj.get(p.to) || [];
      if (!options.length) return Object.assign(p, newPulse());
      let next = options[(Math.random() * options.length) | 0];
      // evita di tornare immediatamente indietro
      if (options.length > 1 && next === p.from) {
        next = options[(Math.random() * options.length) | 0];
        if (next === p.from && options.length > 2) {
          next = options[(Math.random() * options.length) | 0];
        }
      }
      p.from = p.to;
      p.to = next;
    }
  }

  // disegna un impulso lungo il segmento corrente
  function drawPulse(p) {
    if (!p) return;
    const A = nodes[p.from], B = nodes[p.to];
    const x = A.x + (B.x - A.x) * p.t;
    const y = A.y + (B.y - A.y) * p.t;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter'; // glow
    ctx.strokeStyle = p.color;
    ctx.fillStyle = p.color;
    ctx.lineWidth = 1.25;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 8;

    // piccolo segmento luminoso
    ctx.beginPath();
    ctx.moveTo(x, y);
    const lx = A.x + (B.x - A.x) * Math.max(0, p.t - 0.06);
    const ly = A.y + (B.y - A.y) * Math.max(0, p.t - 0.06);
    ctx.lineTo(lx, ly);
    ctx.stroke();

    // puntino
    ctx.beginPath();
    ctx.arc(x, y, p.size, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // lampi di zona (gradiente leggero che lampeggia)
  function flashZone() {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const r = 260 + Math.random() * 360;

    const col = PULSE_COLORS[(Math.random() * PULSE_COLORS.length) | 0];
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, hexToRgba(col, 0.12));
    grad.addColorStop(1, hexToRgba(col, 0.0));

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.restore();
  }

  // util: #rrggbb → rgba
  function hexToRgba(hex, a) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return `rgba(0,0,0,${a})`;
    const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  // anim loop
  function frame(t) {
    const dt = Math.min(64, t - lastTime); // clamp
    lastTime = t;

    // pulizia “morbida” per lasciare una scia (non scurisce la pagina)
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.08)'; // fade solo il canvas
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    // ridisegno statico leggero sopra il fade (mantiene il reticolo visibile)
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    drawStatic();
    ctx.restore();

    // impulsi
    for (let i = 0; i < pulses.length; i++) {
      const p = pulses[i];
      updatePulse(p, dt);
      drawPulse(p);
    }

    // zona flash random
    if (!prefersReduce && t - lastZoneFlash > ZONE_FLASH_EVERY + Math.random() * 500) {
      flashZone();
      lastZoneFlash = t;
    }

    requestAnimationFrame(frame);
  }

  // init
  resize();
  window.addEventListener('resize', () => {
    // throttle leggero
    clearTimeout(resize._t);
    resize._t = setTimeout(resize, 80);
  });
  requestAnimationFrame((t) => {
    lastTime = t;
    if (prefersReduce) {
      // statico: disegna solo reticolo e basta
      drawStatic();
    } else {
      frame(t);
    }
  });
})();
