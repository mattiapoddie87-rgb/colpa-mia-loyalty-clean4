// public/shop.js — catalog + checkout (SKU-only)
const CATALOG = [
  { sku:'SCUSA_BASE',   title:'Scusa Base',        desc:'La più usata, funziona sempre.',       eur:100, minutes:10 },
  { sku:'SCUSA_TRIPLA', title:'Scusa Tripla',      desc:'Tre scuse diverse in un solo pacchetto.', eur:250, minutes:30 },
  { sku:'SCUSA_DELUXE', title:'Scusa Deluxe',      desc:'Perfetta, elegante, inattaccabile.',   eur:450, minutes:60 },
  { sku:'RIUNIONE',     title:'Riunione improvvisa', desc:'Alibi perfetto in orario d’ufficio.', eur:200, minutes:20 },
  { sku:'TRAFFICO',     title:'Traffico assurdo',  desc:'Sempreverde, valido ovunque.',         eur:200, minutes:20 },
  { sku:'CONN_KO',      title:'Connessione KO',    desc:'Speciale smartworking edition.',       eur:200, minutes:20 },
];

const grid = document.getElementById('grid');
const msgEl = document.getElementById('msg');

const showMsg = (t, err=false)=>{
  msgEl.hidden=false; msgEl.textContent=t; msgEl.classList.toggle('error',err);
};

for (const it of CATALOG) {
  const el = document.createElement('article');
  el.className='card';
  el.innerHTML = `
    <h3>${it.title}</h3>
    <p>${it.desc}</p>
    <div class="price">€ ${(it.eur/100).toFixed(2)}</div>
    <div class="row">
      <span class="tag">${it.minutes} min</span>
      <button class="btn">Acquista</button>
    </div>`;
  el.querySelector('button').addEventListener('click',()=>checkout(it.sku));
  grid.appendChild(el);
}

async function checkout(sku){
  try{
    showMsg('Apro il checkout…');
    const r = await fetch('/.netlify/functions/create-checkout-session',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ sku })
    });
    if(r.status===303){
      const loc=r.headers.get('Location'); if(loc) return location.href=loc;
    }
    const data = await r.json().catch(()=>({}));
    if(data?.url) return location.href=data.url;
    throw new Error(data?.error || 'Errore checkout');
  }catch(e){ showMsg(e.message, true); console.error(e); }
}
