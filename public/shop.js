// public/shop.js
const CATALOG = [
  { sku: 'SCUSA_ENTRY',  title: 'Prima Scusa -50%', desc: 'Testa il servizio a metà prezzo.', eur: 50,  minutes: 10, badge: "Offerta d’ingresso" },
  { sku: 'SCUSA_BASE',   title: 'Scusa Base',       desc: 'La più usata, funziona sempre.', eur: 100, minutes: 10 },
  { sku: 'SCUSA_TRIPLA', title: 'Scusa Tripla',     desc: 'Tre scuse in un solo pacchetto.', eur: 250, minutes: 30 },
  { sku: 'SCUSA_DELUXE', title: 'Scusa Deluxe',     desc: 'Perfetta, elegante, inattaccabile.', eur: 450, minutes: 60 },
  { sku: 'RIUNIONE',     title: 'Riunione improvvisa', desc: 'Alibi perfetto in orario d’ufficio.', eur: 200, minutes: 20 },
  { sku: 'TRAFFICO',     title: 'Traffico assurdo', desc: 'Sempreverde, valido ovunque.', eur: 200, minutes: 20 },
  { sku: 'CONN_KO',      title: 'Connessione KO',   desc: 'Speciale smartworking edition.', eur: 200, minutes: 20 },
];

(function render() {
  const grid = document.getElementById('catalogo-grid') || document.getElementById('shop-grid');
  if (!grid) return;
  grid.innerHTML = '';
  for (const it of CATALOG) {
    const el = document.createElement('article');
    el.className = 'card';
    const badge = it.badge ? `<span class="badge">${it.badge}</span>` : '';
    el.innerHTML = `
      <h3>${it.title} ${badge}</h3>
      <p>${it.desc}</p>
      <div class="price">€ ${(it.eur / 100).toFixed(2)}</div>
      <div class="row">
        <span class="tag">Credito: ${it.minutes} min</span>
        <button class="btn" data-sku="${it.sku}">Acquista</button>
      </div>`;
    grid.appendChild(el);
  }
})();

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('button.btn');
  if (!btn) return;
  const sku = btn.getAttribute('data-sku');
  if (!sku) return;

  try {
    // GET semplifica il debug: puoi aprire direttamente l'URL nel browser
    const r = await fetch(`/.netlify/functions/create-checkout-session?sku=${encodeURIComponent(sku)}`, {
      method: 'GET',
      headers: { 'Cache-Control': 'no-cache' },
    });

    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try { const err = await r.json(); if (err?.error) msg += ` - ${err.error}`; } catch {}
      alert(`Errore checkout: ${msg}`);
      return;
    }

    const data = await r.json();
    if (data?.url) { window.location.href = data.url; return; }
    alert('Errore: URL checkout assente.');
  } catch (err) {
    console.error('Checkout fetch error', err);
    alert('Si è verificato un errore durante il checkout.');
  }
});

// Isola script terzi (pixel/chatbot) per evitare che blocchino il resto
window.addEventListener('error', (ev) => {
  const src = ev?.filename || '';
  if (src.includes('pixel') || src.includes('chatbot')) {
    // non propagare
    ev.preventDefault?.();
    return false;
  }
}, true);
