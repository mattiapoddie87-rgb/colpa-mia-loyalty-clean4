// public/premium.js
const PREMIUM = [
  { id:'AI_COACH', title:'AI Excuse Coach', cost:30,
    desc:'Un assistant che ti produce 3 scuse su misura in base alla situazione.' },
  { id:'VOICE_CALL', title:'Chiamata automatizzata', cost:50,
    desc:'Bot vocale che simula una chiamata urgente per coprirti in riunione.' },
  { id:'EMAIL_ALIBI', title:'Email Alibi Pro', cost:40,
    desc:'Template email “perfetto” + subject line per uscire da ogni impiccio.' },
  { id:'MEETING_COVER', title:'Cover Meet “problemi rete”', cost:25,
    desc:'Overlay e script pronti per fingere micro disconnessioni.' },
  { id:'VIP_PACK', title:'Pacchetto VIP – 24h su misura', cost:120,
    desc:'1 giornata di coperture cucite addosso: AI + script + reminder.' },
];

const grid = document.getElementById('premium-grid');
const msg = document.getElementById('premium-msg');

function info(t, err=false){
  if(!msg) return;
  msg.hidden = false;
  msg.textContent = t;
  msg.classList.toggle('error', !!err);
}

function getEmailFromURL(){
  const email = new URLSearchParams(location.search).get('email') || '';
  return email.trim();
}

for (const it of PREMIUM){
  const el = document.createElement('article');
  el.className = 'card';
  el.innerHTML = `
    <h3>${it.title}</h3>
    <p>${it.desc}</p>
    <div class="row">
      <span class="tag">Costo: ${it.cost} min</span>
      <button class="btn">Sblocca</button>
    </div>
  `;
  el.querySelector('button').addEventListener('click', ()=> redeem(it));
  grid.appendChild(el);
}

async function redeem(item){
  try{
    info('Verifica saldo…');
    const email = getEmailFromURL() || prompt('Inserisci la tua email:') || '';
    if(!email) return info('Email necessaria', true);

    const r = await fetch('/.netlify/functions/redeem', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ email, premiumId: item.id, cost: item.cost })
    });
    const j = await r.json().catch(()=> ({}));
    if(!r.ok) throw new Error(j.error || 'Operazione non riuscita');

    info(`Sbloccato "${item.title}". Minuti residui: ${j.minutes}`);
  }catch(e){
    console.error(e);
    info(e.message, true);
  }
}
