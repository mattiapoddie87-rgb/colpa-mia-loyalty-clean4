// shop.js — gestione catalogo e checkout (sostituisci tutto il file con questo)

// Endpoint delle Netlify Functions
const CHECKOUT_FN  = '/.netlify/functions/create-checkout-session';
const ENTRY_LINK_FN = '/.netlify/functions/entry-link'; // opzionale (usata solo per SCUSA_ENTRY)

// Catalogo: prezzi in centesimi e minuti accreditati
const CATALOG = [
  { sku: 'SCUSA_ENTRY',  title: 'Prima Scusa -50%',  desc: 'Testa il servizio a metà prezzo.', eur:  50, minutes: 10, badge: "Offerta d’ingresso" },
  { sku: 'SCUSA_BASE',   title: 'Scusa Base',        desc: 'La più usata, funziona sempre.',   eur: 100, minutes: 10 },
  { sku: 'SCUSA_TRIPLA', title: 'Scusa Tripla',      desc: 'Tre scuse in un solo pacchetto.',  eur: 250, minutes: 30 },
  { sku: 'SCUSA_DELUXE', title: 'Scusa Deluxe',      desc: 'Perfetta, elegante, inattaccabile.', eur: 450, minutes: 60 },
  { sku: 'RIUNIONE',     title: 'Riunione improvvisa', desc: 'Alibi perfetto in orario d’ufficio.', eur: 200, minutes: 20 },
  { sku: 'TRAFFICO',     title: 'Traffico assurdo',  desc: 'Sempreverde, valido ovunque.',     eur: 200, minutes: 20 },
  { sku: 'CONN_KO',      title: 'Connessione KO',    desc: 'Speciale smartworking edition.',   eur: 200, minutes: 20 },
];

// Utils
const euros = c => (c / 100).toFixed(2);

// Render grid (supporta id: grid, catalogo-grid, shop-grid)
(function renderCatalog() {
  const gridEl =
    document.getElementById('grid') ||
    document.getElementById('catalogo-grid') ||
    document.getElementById('shop-grid');

  if (!gridEl) return;
  gridEl.innerHTML = '';

  for (const it of CATALOG) {
    const badgeHtml = it.badge ? `<span class="badge">${it.badge}</span>` : '';
    const el = document.createElement('article');
    el.className = 'card';
    el.innerHTML = `
      <h3>${it.title} ${badgeHtml}</h3>
      <p>${it.desc}</p>
      <div class="price">€ ${euros(it.eur)}</div>
      <div class="row">
        <span class="tag" title="Minuti di credito utilizzabili">Credito: ${it.minutes} min</span>
        <button class="btn" data-sku="${it.sku}">Acquista</button>
      </div>`;
    gridEl.appendChild(el);
  }
})();

// ---- Checkout helpers

// Chiama la function di checkout e redirige alla sessione Stripe
async function goCheckout(payload) {
  try {
    const r = await fetch(CHECKOUT_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // In alcuni setup potresti usare 303 Location: gestiamolo comunque
    if (r.status === 303) {
      const loc = r.headers.get('Location');
      if (loc) {
        window.location.href = loc;
        return;
      }
    }

    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.url) {
      console.error('create-checkout-session error:', data);
      throw new Error(data.error || 'create-checkout-session failed');
    }
    window.location.href = data.url;
  } catch (err) {
    console.error('Checkout error:', err);
    alert('Si è verificato un errore durante il checkout.');
  }
}

// Prova a usare il Payment Link per l’offerta d’ingresso; se fallisce, fallback al checkout
async function openEntryLink() {
  try {
    const r = await fetch(ENTRY_LINK_FN);
    if (!r.ok) throw new Error('ENTRY_LINK_NOT_CONFIGURED');
    const data = await r.json();
    if (data && data.url) {
      window.location.href = data.url;
      return true;
    }
    throw new Error('ENTRY_LINK_EMPTY');
  } catch (e) {
    console.warn('ENTRY_LINK fallito, uso checkout come fallback:', e);
    return false;
  }
}

// ---- Click handler Acquista
document.addEventListener('click', async (event) => {
  const btn = event.target.closest('button.btn');
  if (!btn) return;

  const sku = btn.getAttribute('data-sku');
  if (!sku) return;

  // Offerta d’ingresso: prova Payment Link, altrimenti passa al checkout standard
  if (sku === 'SCUSA_ENTRY') {
    const ok = await openEntryLink();
    if (ok) return;         // Payment Link ok
    await goCheckout({ sku }); // fallback a create-checkout-session
    return;
  }

  // Prodotti normali → checkout via function
  await goCheckout({ sku });
});
