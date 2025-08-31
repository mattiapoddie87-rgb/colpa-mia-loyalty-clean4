// --- funzione generica per aprire il checkout Stripe da premium.js ---
async function startCheckoutForSku(sku){
  try {
    // opzionale: messaggio utente
    const box = document.getElementById('premium-msg');
    if (box) { box.hidden = false; box.textContent = 'Apro il checkout…'; box.classList.remove('error'); }

    const r = await fetch('/.netlify/functions/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku }),
      // ⬇️ importantissimo: niente auto-follow del 303
      redirect: 'manual'
    });

    // 1) opaqueredirect con r.url valorizzato
    if (r.type === 'opaqueredirect' && r.url) {
      location.href = r.url;
      return;
    }

    // 2) redirect 303 + Location
    const loc = r.headers.get('Location');
    if (r.status === 303 && loc) {
      location.href = loc;
      return;
    }

    // 3) JSON { url }
    let data = {};
    try { data = await r.json(); } catch {}
    if (data && data.url) {
      location.href = data.url;
      return;
    }

    throw new Error('Errore checkout');
  } catch (e) {
    const box = document.getElementById('premium-msg');
    if (box) { box.hidden = false; box.textContent = e.message || 'Errore checkout'; box.classList.add('error'); }
    console.error(e);
  }
}
