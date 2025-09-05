// public/shop.js — v2 robusto
(() => {
  console.log('[CM] shop.js v2 loaded');

  const grid = document.getElementById('catalogo-grid');
  const msg  = document.getElementById('catalogo-msg');
  if (!grid) { console.warn('[CM] #catalogo-grid non trovato'); return; }

  // SKU ammessi: SCUSA_ENTRY, SCUSA_BASE, SCUSA_TRIPLA, SCUSA_DELUXE, CONS_KO, RIUNIONE, TRAFFICO
  const CATALOG = [
    { sku:'SCUSA_ENTRY',  name:'Prima Scusa -50%',     minutes:10, price:0.50 },
    { sku:'SCUSA_BASE',   name:'Scusa Base',          minutes:10, price:1.00 },
    { sku:'SCUSA_TRIPLA', name:'Scusa Tripla',        minutes:30, price:2.50 },
    { sku:'SCUSA_DELUXE', name:'Scusa Deluxe',        minutes:60, price:4.50 },
    { sku:'CONS_KO',      name:'Connessione KO',      minutes:30, price:null },
    { sku:'RIUNIONE',     name:'Riunione improvvisa', minutes:15, price:null },
    { sku:'TRAFFICO',     name:'Traffico assurdo',    minutes:20, price:null },
  ];

  function priceLabel(p){ return typeof p === 'number' ? `€ ${p.toFixed(2)}` : 'Vedi al checkout'; }

  // Render
  try {
    grid.innerHTML = CATALOG.map(p => `
      <article class="card">
        <div class="row"><b>${p.name}</b><span class="tag">${p.minutes} min</span></div>
        <div class="row">
          <span>${priceLabel(p.price)}</span>
          <button class="btn" data-sku="${p.sku}">Acquista</button>
        </div>
      </article>`).join('');
  } catch (err) {
    console.error('[CM] Render catalogo error:', err);
    if (msg) msg.textContent = `Errore catalogo: ${err.message || 'render'}`;
    return;
  }

  // Checkout
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-sku]');
    if (!b) return;

    const sku = b.getAttribute('data-sku');
    b.disabled = true;
    if (msg) msg.textContent = '';
    try {
      const r = await fetch('/.netlify/functions/create-checkout-session', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ sku })
      });
      const data = await r.json().catch(() => ({}));

      if (r.ok && data?.url) { window.location.href = data.url; return; }

      const m = data?.error || `HTTP ${r.status}`;
      console.error('[CM] Checkout error:', m);
      if (msg) msg.textContent = `Errore checkout: ${m}`;
      alert(`Checkout KO: ${m}`);
    } catch (e2) {
      console.error('[CM] Network error:', e2);
      if (msg) msg.textContent = 'Errore di rete.';
      alert('Checkout KO: rete/non raggiungibile');
    } finally {
      b.disabled = false;
    }
  });
})();
