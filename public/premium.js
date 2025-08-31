// public/premium.js
// Mostra prodotti Premium, legge saldo e permette lo "sblocco" scalando minuti.

const PREMIUM_ITEMS = [
  { id:'ai_su_misura', title:'Scusa AI su misura', cost:30, desc:'La nostra AI ti scrive l’alibi perfetto in 30 secondi. Tono a scelta (professionale, romantico, ironico).' },
  { id:'vocale_credibile', title:'Vocale credibile', cost:20, desc:'Ricevi un vocale “alibi” con rumori ambientali realistici (traffico, ufficio, metropolitana).' },
  { id:'parere_medico', title:'Parere medico plausibile', cost:40, desc:'Testo plausibile di una giustificazione medica per una lieve indisposizione.' },
  { id:'blocco_calendario', title:'Blocco calendario', cost:15, desc:'Template ICS per “riunione non rinviabile” + guida di invio credibile per Slack/Teams.' },
  { id:'email_scuse', title:'Email di scuse premium', cost:25, desc:'Email pronta all’uso, 3 varianti (formale, ruffiana, assertiva).' }
];

const premiumGrid = document.getElementById('premium-grid');
const premiumMsg  = document.getElementById('premium-msg');

function getEmail() {
  const params = new URLSearchParams(location.search);
  return params.get('email') || localStorage.getItem('cm_email') || '';
}
function setEmail(e){ if(e) localStorage.setItem('cm_email', e); }

function showPM(t, err=false) {
  if(!premiumMsg) return;
  premiumMsg.hidden=false;
  premiumMsg.textContent = t;
  premiumMsg.classList.toggle('error', err);
}

async function fetchBalance(email){
  if (!email) return { minutes:0 };
  const r = await fetch('/.netlify/functions/balance?email='+encodeURIComponent(email));
  const data = await r.json().catch(()=>({minutes:0}));
  return data;
}

async function redeem(email, item){
  const r = await fetch('/.netlify/functions/redeem', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ email, itemId:item.id, cost:item.cost, title:item.title })
  });
  const data = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(data?.error || 'Errore redeem');
  return data;
}

function renderPremium(balance, email){
  premiumGrid.innerHTML = '';
  for (const it of PREMIUM_ITEMS) {
    const el = document.createElement('article');
    el.className='card';
    el.innerHTML = `
      <h3>${it.title}</h3>
      <p>${it.desc}</p>
      <div class="row">
        <span class="tag">Costo: ${it.cost} min</span>
        <button class="btn">Sblocca</button>
      </div>`;
    const btn = el.querySelector('button');
    btn.addEventListener('click', async ()=>{
      try {
        if (!email) {
          const e = prompt('Inserisci la tua email per usare i tuoi minuti:');
          if (!e) return;
          setEmail(e);
          location.search = '?email='+encodeURIComponent(e);
          return;
        }
        btn.disabled = true;
        showPM('Verifico saldo…');
        const bal = await fetchBalance(email);
        if ((bal.minutes||0) < it.cost) {
          showPM(`Saldo insufficiente. Ti servono ${it.cost} min (hai ${bal.minutes||0}).`, true);
          btn.disabled = false;
          return;
        }
        showPM('Sblocco in corso…');
        const done = await redeem(email, it);
        showPM(`Sbloccato! Saldo residuo: ${done.minutes} min.`);
        // TODO: qui potresti aprire un link/download/AI ecc.
      } catch (e){
        console.error(e);
        showPM(e.message, true);
      } finally {
        btn.disabled = false;
      }
    });
    premiumGrid.appendChild(el);
  }
}

(async () => {
  const email = getEmail();
  if (email) setEmail(email);
  const bal = await fetchBalance(email);
  renderPremium(bal, email);
})();
