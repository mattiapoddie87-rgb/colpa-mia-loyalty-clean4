// Gestione catalogo e checkout

// Dati dei prodotti: prezzi in centesimi di euro e minuti credito
const CATALOG = [
  {
    sku: 'SCUSA_ENTRY',
    title: 'Prima Scusa -50%',
    desc: 'Testa il servizio a metà prezzo.',
    eur: 50,               // 0,50 €
    minutes: 10,
    badge: "Offerta d’ingresso",
  },
  {
    sku: 'SCUSA_BASE',
    title: 'Scusa Base',
    desc: 'La più usata, funziona sempre.',
    eur: 100,              // 1,00 €
    minutes: 10,
  },
  {
    sku: 'SCUSA_TRIPLA',
    title: 'Scusa Tripla',
    desc: 'Tre scuse in un solo pacchetto.',
    eur: 250,              // 2,50 €
    minutes: 30,
  },
  {
    sku: 'SCUSA_DELUXE',
    title: 'Scusa Deluxe',
    desc: 'Perfetta, elegante, inattaccabile.',
    eur: 450,              // 4,50 €
    minutes: 60,
  },
  {
    sku: 'RIUNIONE',
    title: 'Riunione improvvisa',
    desc: 'Alibi perfetto in orario d’ufficio.',
    eur: 200,              // 2,00 €
    minutes: 20,
  },
  {
    sku: 'TRAFFICO',
    title: 'Traffico assurdo',
    desc: 'Sempreverde, valido ovunque.',
    eur: 200,              // 2,00 €
    minutes: 20,
  },
  {
    sku: 'CONN_KO',
    title: 'Connessione KO',
    desc: 'Speciale smartworking edition.',
    eur: 200,              // 2,00 €
    minutes: 20,
  },
];

// Renderizza la griglia del catalogo
(function renderCatalog() {
  const gridEl = document.getElementById('catalogo-grid') || document.getElementById('shop-grid');
  if (!gridEl) return;
  gridEl.innerHTML = '';
  for (const it of CATALOG) {
    const badgeHtml = it.badge ? '<span class="badge">' + it.badge + '</span>' : '';
    const el = document.createElement('article');
    el.className = 'card';
    el.innerHTML = `
      <h3>${it.title} ${badgeHtml}</h3>
      <p>${it.desc}</p>
      <div class="price">€ ${(it.eur / 100).toFixed(2)}</div>
      <div class="row">
        <span class="tag" title="Minuti di credito utilizzabili">Credito: ${it.minutes} min</span>
        <button class="btn" data-sku="${it.sku}">Acquista</button>
      </div>`;
    gridEl.appendChild(el);
  }
})();

// Gestione click sui pulsanti di acquisto
document.addEventListener('click', async (event) => {
  const btn = event.target.closest('button.btn');
  if (!btn) return;
  const sku = btn.getAttribute('data-sku');
  if (!sku) return;

  // Pagamento tramite Payment Link per l’offerta d’ingresso
  if (sku === 'SCUSA_ENTRY') {
    try {
      const r   = await fetch('/.netlify/functions/entry-link');
      const res = await r.json();
      if (!res.url) {
        alert('ENTRY_LINK non configurato');
        return;
      }
      location.href = res.url;
      return;
    } catch (err) {
      console.error(err);
      alert('Errore nel recuperare l’ENTRY_LINK.');
      return;
    }
  }

  // Checkout con Stripe per gli altri prodotti
  try {
    const response = await fetch('/.netlify/functions/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku }),
      redirect: 'manual',
    });

    // Se la funzione restituisce redirect 303, usa Location
    if (response.status === 303) {
      const redirectUrl = response.headers.get('Location');
      if (redirectUrl) {
        location.href = redirectUrl;
        return;
      }
    }
    // Altrimenti prova a leggere il JSON
    const data = await response.json();
    if (data.url) {
      location.href = data.url;
    }
  } catch (e) {
    console.error(e);
    alert('Si è verificato un errore durante il checkout.');
  }
});
