// public/shop.js — disegna il catalogo + apre Stripe in modo compatibile

// 1) Catalogo “Minuti di Vita”

const CATALOG = [
  { sku:'SCUSA_BASE',   title:'Scusa Base',        desc:'La più usata, funziona sempre.',            eur:100, minutes:10 },
  { sku:'SCUSA_TRIPLA', title:'Scusa Tripla',      desc:'Tre scuse diverse in un solo pacchetto.',   eur:250, minutes:30 },
    { sku:'SCUSA_ENTRY', title:'Prima Scusa -50%', desc:'Testa il servizio a metà prezzo.', eur:50, minutes:10, badge:'Offerta d\u2019ingresso' },

  { sku:'SCUSA_DELUXE', title:'Scusa Deluxe',      desc:'Perfetta, elegante, inattaccabile.',        eur:450, minutes:60 },
  { sku:'RIUNIONE',     title:'Riunione improvvisa', desc:'Alibi perfetto in orario d’ufficio.',     eur:200, minutes:20 },
  { sku:'TRAFFICO',     title:'Traffico assurdo',  desc:'Sempreverde, valido ovunque.',              eur:200, minutes:20 },
  { sku:'CONN_KO',      title:'Connessione KO',    desc:'Speciale smartworking edition.',            eur:200, minutes:20 },
];

// 2) Riferimenti DOM
const grid = document.getElementById('grid');
const msgEl = document.getElementById('msg');

// 3) Disegna le card
(function renderCatalog(){
  if (!grid) return; // se manca il contenitore, non facciamo nulla
  grid.innerHTML = ''; // pulizia
  for (const it of CATALOG) {
    const el = document.createElement('article');
    el.className = 'card';

          const badgeHtml = it.badge ? '<span class="badge">'+it.badge+'</span>' : '';
    el.i        <h3>${it.title} ${badgeHtml}</h3>
          <h3>${it.title} ${badgeHtml}</h3>
      <p>${it.desc}</p>
      <div class="price">€ ${(it.eur/100).toFixed(2)}</div>
      <div class="row">
        <span class="tag" title="Minuti di credito utilizzabili">Credito: ${it.minutes} min</span>
        <button class="btn" data-sku="${it.sku}">Acquista</button>
      </div>`;
    grid.appendChild(el);
  }

  // bind dei bottoni
  grid.querySelectorAll('button[data-sku]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await checkout(btn.dataset.sku).catch(()=>{});
      btn.disabled = false;
    });
  });
})();

// 4) Messaggi helper
function showMsg(text, isErr=false){
  if (!msgEl) return;
  msgEl.hidden = false;
  msgEl.textContent = text;
  msgEl.classList.toggle('error', !!isErr);
}

// 5) Apertura checkout Stripe — robusta a 303/opaqueredirect/JSON
async function checkout(sku){
  try {
    showMsg('Apro il checkout…', false);

    const r = await fetch('/.netlify/functions/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku }),
      redirect: 'manual'   // <- fondamentale per i 303
    });

    // Caso A: Chrome/Safari in manual → opaqueredirect con r.url
    if (r.type === 'opaqueredirect' && r.url) {
      location.href = r.url;
      return;
    }

    // Caso B: 303 + Location
    const loc = r.headers.get('Location');
    if (r.status === 303 && loc) {
      location.href = loc;
      return;
    }

    // Caso C: JSON { url: "https://checkout.stripe.com/..." }
    let data = {};
    try { data = await r.json(); } catch {}
    if (data && data.url) {
      location.href = data.url;
      return;
    }

    throw new Error('Errore checkout');
  } catch (e) {
    showMsg(e.message || 'Errore checkout', true);
    console.error(e);
  }
}
