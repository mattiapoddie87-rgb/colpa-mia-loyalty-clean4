// --- sostituisci interamente la tua funzione checkout(sku) con questa ---
async function checkout(sku){
  try {
    // opzionale: mostra messaggio in pagina se hai un elemento #msg
    const msgEl = document.getElementById('msg');
    if (msgEl) { msgEl.hidden = false; msgEl.textContent = 'Apro il checkout…'; msgEl.classList.remove('error'); }

    const r = await fetch('/.netlify/functions/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku }),
      // ⬇️ evita che fetch segua in automatico il 303 di Stripe
      redirect: 'manual'
    });

    // Caso 1: in modalità manual alcuni browser (Chrome/Safari) rispondono "opaqueredirect"
    // con la URL di Stripe già in r.url
    if (r.type === 'opaqueredirect' && r.url) {
      location.href = r.url;
      return;
    }

    // Caso 2: 303 + Location nell’header (classico redirect di Netlify Function)
    const loc = r.headers.get('Location');
    if (r.status === 303 && loc) {
      location.href = loc;
      return;
    }

    // Caso 3: la function ritorna JSON { url: "https://checkout.stripe.com/..." }
    let data = {};
    try { data = await r.json(); } catch {}
    if (data && data.url) {
      location.href = data.url;
      return;
    }

    throw new Error('Errore checkout');
  } catch (e) {
    const msgEl = document.getElementById('msg');
    if (msgEl) { msgEl.hidden = false; msgEl.textContent = e.message || 'Errore checkout'; msgEl.classList.add('error'); }
    console.error(e);
  }
}
