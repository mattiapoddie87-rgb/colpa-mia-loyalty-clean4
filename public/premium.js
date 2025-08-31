// public/premium.js
// Render dei Premium + redeem con POST a /.netlify/functions/redeem

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
  const msg = document.getElementById('premium-msg');
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
    const btn = el.querySelector('button');
    btn.addEventListener('click', ()=> redeemPremium(it.id, btn, msg));
    grid.appendChild(el);
  });
})();

async function redeemPremium(itemId, btn, msg){
  try{
    if (msg) { msg.hidden = false; msg.textContent = 'Verifico il tuo saldo…'; msg.classList.remove('error'); }
    btn.disabled = true;

    // Chiedi telefono (default) ed email (fallback) con due prompt rapidi
    const phone = (prompt('Numero di telefono per la consegna (WhatsApp/SMS):') || '').trim();
    const email = (prompt('Email (opzionale, usata come backup):') || '').trim();

    if (!phone && !email) {
      if (msg){ msg.textContent = 'Operazione annullata.'; }
      btn.disabled = false; 
      return;
    }

    const r = await fetch('/.netlify/functions/redeem', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ item_id:itemId, phone, email })
    });

    const data = await r.json().catch(()=>({}));
    if (!r.ok || !data?.ok) {
      const err = data?.error || 'Errore di sblocco';
      if (msg){ msg.textContent = err; msg.classList.add('error'); }
      btn.disabled = false;
      return;
    }

    if (msg){
      msg.textContent = `${data.message} — Saldo residuo: ${data.remaining} min.`;
      msg.classList.remove('error');
    }
  }catch(e){
    console.error(e);
    if (msg){ msg.textContent = 'Errore imprevisto'; msg.classList.add('error'); }
  }finally{
    btn.disabled = false;
  }
}
