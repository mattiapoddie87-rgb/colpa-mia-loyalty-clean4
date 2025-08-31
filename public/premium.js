// public/premium.js
const PREMIUM = [
  {
    id: 'ai_excuse',
    title: 'Scusa AI su misura',
    desc: 'La nostra AI ti scrive l’alibi perfetto in 30 secondi. Tono a scelta (professionale, romantico, ironico).',
    cost: 30
  },
  {
    id: 'voice_note',
    title: 'Vocale credibile',
    desc: 'Ricevi un vocale “alibi” con rumori ambientali realistici (traffico, ufficio, metropolitana).',
    cost: 20
  },
  {
    id: 'doctor_note',
    title: 'Parere medico plausibile',
    desc: 'Testo plausibile di una giustificazione medica per una lieve indisposizione.',
    cost: 40
  },
  {
    id: 'calendar_block',
    title: 'Blocco calendario',
    desc: 'Template ICS per “riunione non rinviabile” + guida di invio credibile per Slack/Teams.',
    cost: 15
  },
  {
    id: 'email_template',
    title: 'Email di scuse premium',
    desc: 'Email pronta all’uso, 3 varianti (formale, amichevole, assertiva).',
    cost: 25
  }
];

(function renderPremium(){
  const el = document.getElementById('premium-grid');
  const msg = document.getElementById('premium-msg');
  if(!el) return;

  el.innerHTML = '';
  for(const item of PREMIUM){
    const a = document.createElement('article');
    a.className = 'card';
    a.innerHTML = `
      <h3>${item.title}</h3>
      <p>${item.desc}</p>
      <div class="row">
        <span class="tag" title="Punti richiesti">Costo: ${item.cost} min</span>
        <a class="btn" href="/wallet.html#premium?redeem=${item.id}">Sblocca</a>
      </div>`;
    el.appendChild(a);
  }
})();
