// public/shop.js
(async () => {
  const API = '/.netlify/functions/create-checkout-session';

  function pickCtx(btn) {
    const card = btn.closest('.card, .box, .product, .sku, .panel') || document;
    const sel = card.querySelector('select[name="ctx"]');
    return (sel && sel.value ? String(sel.value).toUpperCase().trim() : '');
  }

  async function buy(sku, ctx) {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku: String(sku).toUpperCase(), ctx })
    });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || r.statusText);
    location.href = j.url; // vai a Stripe
  }

  // Bottoni “Acquista” devono avere data-buy="SCUSA_BASE" | "SCUSA_DELUXE" | "TRAFFICO" | ...
  document.querySelectorAll('[data-buy]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const sku = btn.dataset.buy || '';
      const ctx = pickCtx(btn); // vuoto per TRAFFICO/RIUNIONE/CONNESSIONE o se non c’è select
      try { await buy(sku, ctx); }
      catch (err) { alert('Errore: ' + (err.message || err)); }
    });
  });
})();
