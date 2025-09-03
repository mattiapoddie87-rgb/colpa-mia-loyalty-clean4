// Catalogo dei pacchetti premium e rendering

// Definizione dei pacchetti premium (costi in minuti credito)
const PREMIUM = [
  {
    id: 'ai_custom',
    title: 'Scusa AI su misura',
    desc: 'La nostra AI ti scrive l’alibi perfetto in 30 secondi. Tono a scelta (professionale, romantico, ironico).',
    cost: 30,
    express: true, // questa voce attiverà il badge Express <10 min
  },
  {
    id: 'voice',
    title: 'Vocale credibile',
    desc: 'Ricevi un vocale “alibi” con rumori ambientali realistici (traffico, ufficio, metropolitana).',
    cost: 20,
  },
  {
    id: 'med',
    title: 'Parere medico plausibile',
    desc: 'Testo plausibile di una giustificazione medica per una lieve indisposizione.',
    cost: 40,
  },
  {
    id: 'ics',
    title: 'Blocco calendario',
    desc: 'Template .ics per “riunione non rinviabile” + guida di invio credibile per Slack/Teams.',
    cost: 15,
  },
  {
    id: 'email_pack',
    title: 'Email di scuse premium',
    desc: 'Email pronta all’uso, 3 varianti (formale, amichevole, assertiva).',
    cost: 25,
  },
];

// Funzione da implementare: sblocca il pacchetto premium
async function redeemPremium(id, btn, msgEl) {
  btn.disabled = true;
  btn.textContent = 'Sblocco...';
  try {
    const response = await fetch('/.netlify/functions/redeem-premium', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (!response.ok) throw new Error('Errore nello sblocco');
    msgEl.textContent = 'Pacchetto sbloccato con successo!';
  } catch (e) {
    console.error(e);
    msgEl.textContent = 'Errore: non è stato possibile sbloccare il pacchetto.';
    btn.disabled = false;
    btn.textContent = 'Sblocca';
  }
}

// Rendering dell’area premium
(function renderPremium() {
  const grid = document.getElementById('premium-grid');
  const msg  = document.getElementById('premium-msg');
  if (!grid) return;
  PREMIUM.forEach((it) => {
    const el = document.createElement('article');
    el.className = 'card';
    el.innerHTML = `
      <h3>${it.title} ${it.express ? '<span class="badge badge--express">Express &lt;10 min</span>' : ''}</h3>
      <p>${it.desc}</p>
      <div class="row">
        <span class="tag">Costo: ${it.cost} min</span>
        <button class="btn" data-id="${it.id}">Sblocca</button>
      </div>`;
    const button = el.querySelector('button');
    button.addEventListener('click', () => redeemPremium(it.id, button, msg));
    grid.appendChild(el);
  });
})();
