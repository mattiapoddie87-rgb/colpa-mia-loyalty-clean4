// public/bg.js — simple neon particles
const c = document.getElementById('bg');
const ctx = c.getContext('2d', { alpha: true });
let w, h, DPR;

function resize(){
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  w = c.width = Math.floor(innerWidth * DPR);
  h = c.height = Math.floor(innerHeight * DPR);
  c.style.width = innerWidth+'px';
  c.style.height = innerHeight+'px';
}
addEventListener('resize', resize, { passive:true }); resize();

const N = 80;
const P = [];
for(let i=0;i<N;i++){
  P.push({
    x: Math.random()*w, y: Math.random()*h,
    vx: (Math.random()-.5)*0.15*DPR,
    vy: (Math.random()-.5)*0.15*DPR,
    r: Math.random()*1.8*DPR + .6*DPR
  });
}

function tick(){
  ctx.clearRect(0,0,w,h);
  for(const p of P){
    p.x+=p.vx; p.y+=p.vy;
    if(p.x<0||p.x>w) p.vx*=-1;
    if(p.y<0||p.y>h) p.vy*=-1;

    const g = ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r*6);
    g.addColorStop(0,'rgba(90,163,255,.25)');
    g.addColorStop(1,'rgba(90,163,255,0)');
    ctx.fillStyle=g;
    ctx.beginPath(); ctx.arc(p.x,p.y,p.r*6,0,Math.PI*2); ctx.fill();

    ctx.fillStyle='rgba(138,107,255,.8)';
    ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
  }
  requestAnimationFrame(tick);
}
tick();
