// SKU NORMALIZZATI: usa *esattamente* questi anche in PRICE_BY_SKU_JSON o come lookup_key su Stripe.
const CATALOG = [
  { sku:'SCUSA_ENTRY',  name:'Prima Scusa -50%', price:0.50, minutes:10 },
  { sku:'SCUSA_BASE',   name:'Scusa Base',      price:1.00, minutes:10 },
  { sku:'SCUSA_TRIPLA', name:'Scusa Tripla',    price:2.50, minutes:30 },
  { sku:'SCUSA_DELUXE', name:'Scusa Deluxe',    price:4.50, minutes:60 },
  { sku:'CONS_KO',      name:'Connessione KO',  price:?,    minutes:30 },
  { sku:'RIUNIONE',     name:'Riunione improvvisa', price:?, minutes:15 },
  { sku:'TRAFFICO',     name:'Traffico assurdo',    price:?, minutes:20 },
];

const grid = document.getElementById('catalogo-grid');
const msg  = document.getElementById('catalogo-msg');

(function render(){
  grid.innerHTML = '';
  CATALOG.forEach(p=>{
    const el = document.createElement('article');
    el.className='card';
    el.innerHTML = `
      <div class="row"><b>${p.name}</b><span class="tag">${p.minutes} min</span></div>
      <div class="row"><span>€ ${(p.price||0).toFixed(2)}</span>
      <button class="btn" data-sku="${p.sku}">Acquista</button></div>`;
    grid.appendChild(el);
  });
})();

document.addEventListener('click', async (e)=>{
  const b = e.target.closest('button[data-sku]'); if(!b) return;
  b.disabled = true; msg.textContent = '';
  const sku = b.getAttribute('data-sku');

  let res,data;
  try{
    res = await fetch('/.netlify/functions/create-checkout-session', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ sku })
    });
    data = await res.json().catch(()=> ({}));
  }catch{
    b.disabled=false; msg.textContent='Errore di rete.';
    alert('Checkout KO: rete'); return;
  }

  if(!res.ok || !data?.url){
    const m = data?.error || `HTTP ${res.status}`;
    console.error('Checkout error:', m);
    msg.textContent = `Errore checkout: ${m}`;
    alert(`Checkout KO: ${m}`);
    b.disabled=false; return;
  }
  window.location.href = data.url;
});
