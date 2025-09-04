// Catalogo e Checkout (tutti via Netlify function)

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
    const badge = it.badge ? `<span class="badge">${it.badge}</span>` : '';
    const el = document.createElement('article');
    el.className = 'card';
    el.innerHTML = `
      <h3>${it.title} ${badge}</h3>
      <p>${it.desc}</p>
      <div class="price">€ ${(it.eur/100).toFixed(2)}</div>
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
    const r = await fetch('/.netlify/functions/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku }),
      redirect: 'manual'
    });

    if (r.status === 303) {
      const loc = r.headers.get('Location');
      if (loc) { location.href = loc; return; }
    }

    const data = await r.json().catch(() => ({}));
    if (data?.url) { location.href = data.url; return; }

    alert(data?.error || 'Si è verificato un errore durante il checkout.');
  } catch (err) {
    console.error(err);
    alert('Si è verificato un errore durante il checkout.');
  }
});
