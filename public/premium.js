// public/premium.js
const PREMIUM = [
  {
    id: 'ai_custom',
    title: 'Scusa AI su misura',
    desc: 'La nostra AI ti scrive l’alibi perfetto in 30 secondi. Tono a scelta (professionale, romantico, ironico).',
    cost: 30
  },
  {
    id: 'voice',
    title: 'Vocale credibile',
    desc: 'Ricevi un vocale “alibi” con rumori ambientali realistici (traffico, ufficio, metropolitana).',
    cost: 20
  },
  {
    id: 'med',
    title: 'Parere medico plausibile',
    desc: 'Testo plausibile di una giustificazione medica per una lieve indisposizione.',
    cost: 40
  },
  {
    id: 'ics',
    title: 'Blocco calendario',
    desc: 'Template ICS per “riunione non rinviabile” + guida di invio credibile per Slack/Teams.',
    cost: 15
  },
  {
    id: 'email_pack',
    title: 'Email di scuse premium',
    desc: 'Email pronta all’uso, 3 varianti (formale, amichevole, assertiva).',
    cost: 25
  }
];

(function renderPremium(){
  const grid = document.getElementById('premium-grid');
  if (!grid) return;

  PREMIUM.forEach(it=>{
    const el = document.createElement('article');
    el.className = 'card';
    el.innerHTML = `
      <h3>${it.title}</h3>
      <p>${it.desc}</p>
      <div class="row">
        <span class="tag">Costo: ${it.cost} min</span>
        <button class="btn" data-id="${it.id}">Sblocca</button>
      </div>
    `;
    el.querySelector('button').addEventListener('click', ()=>{
      const msg = document.getElementById('premium-msg');
      if (msg) {
        msg.hidden = false;
        msg.textContent = 'Per sbloccare i premium useremo i tuoi minuti (feature in arrivo).';
        msg.classList.remove('error');
      }
    });
    grid.appendChild(el);
  });
})();
