// public/shop.js — usa sku, la funzione server trova il priceId
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
  if(!msgEl) return;
  msgEl.hidden = false;
  msgEl.textContent = t;
  msgEl.classList.toggle('error', err);
};

for (const it of CATALOG) {
  const el = document.createElement('article');
  el.className='card';
  el.innerHTML = `
    <h3>${it.title}</h3>
    <p>${it.desc}</p>
    <div class="price">€ ${(it.eur/100).toFixed(2)}</div>
    <div class="row">
      <span class="tag" title="Minuti di credito utilizzabili">Credito: ${it.minutes} min</span>
      <button class="btn">Acquista</button>
    </div>`;
  const btn = el.querySelector('button');
  btn.addEventListener('click', async ()=>{
    btn.disabled = true;
    await checkout(it.sku).catch(()=>{});
    btn.disabled = false;
  });
  grid.appendChild(el);
}

async function checkout(sku){
  try{
    showMsg('Apro il checkout…');
    const r = await fetch('/.netlify/functions/create-checkout-session',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ sku })   // <— passiamo lo SKU
    });
    const data = await r.json().catch(()=>({}));
    if (r.ok && data?.url) {
      location.href = data.url;
      return;
    }
    throw new Error(data?.error || 'Errore checkout');
  }catch(e){
    showMsg(e.message, true);
    console.error(e);
  }
}

