// public/premium.js — premium solo con punti (minuti). Niente DB: gating “soft”.
const PREMIUM = [
  {
    id: 'QUANTUM',
    title: 'Scusa Quantum',
    desc: 'Scusa adattiva: si modella sulla tua situazione in tempo reale.',
    cost: 200,
    build: (ctx) => `Scusa Quantum per ${ctx || 'situazione generica'}:\n` +
      `“Ho appena ricevuto un alert dall’ufficio/fornitore che richiede il mio intervento su un vincolo bloccante. ` +
      `Appena chiudo il giro (previsto in 25-30 minuti) ti aggiorno. Mi spiace, non dipende da me.”`
  },
  {
    id: 'OLOGRAFICO',
    title: 'Alibi Olografico',
    desc: 'Messaggio pronto “nel tuo stile” (testo) da incollare ovunque.',
    cost: 400,
    build: (ctx) => `Alibi Olografico:\n` +
      `“Ho provato a dirtelo prima ma mi si è piantato tutto: rete e calendario. ` +
      `Sto rientrando da un imprevisto (documenti da firmare) e arrivo in ritardo. ` +
      `${ctx ? 'È legato a: ' + ctx + '. ' : ''}Ti avviso appena libero una finestra.”`
  },
  {
    id: 'RETRO',
    title: 'Scusa Retroattiva',
    desc: 'Copre il ritardo + il motivo per cui non hai avvisato prima.',
    cost: 300,
    build: () => `Scusa Retroattiva:\n` +
      `“Non ti ho scritto prima perché pensavo di farcela, poi si è sommato un blocco imprevisto ` +
      `che non dipendeva da me. Sto risolvendo e recupero appena chiudo la cosa urgente.”`
  },
  {
    id: 'BOSS',
    title: 'Pacchetto “Boss Level”',
    desc: '5 scuse credibili per capi/professori/clienti. Senza contraddizioni.',
    cost: 600,
    build: () => [
      '1) “Meeting cross-team entrato d’urgenza, mi allineo e ti mando update.”',
      '2) “Finestra di manutenzione anticipata: devo validare il change prima del rilascio.”',
      '3) “Sto chiudendo una dipendenza bloccante, arrivo con la versione consolidata.”',
      '4) “Il fornitore ha cambiato la scaletta, sto riconfezionando le evidenze.”',
      '5) “Ho preferito evitare un rilascio parziale per non inquinare i dati, consegno completo.”'
    ].join('\n')
  },
  {
    id: 'AI_ENGINE',
    title: 'Motore AI Personalizzato',
    desc: 'Inserisci la situazione, ottieni una scusa perfetta istantanea.',
    cost: 1000,
    build: (ctx) => {
      const base = ctx || 'ritardo a cena';
      return `Motore AI — output:\n` +
        `“Sto rientrando ora da una cosa imprevista legata a ${base}. ` +
        `Preferisco arrivare con la testa libera e darti attenzione come meriti. ` +
        `Mi prendo 30-40 minuti per chiudere bene e poi sono da te.”`;
    }
  }
];

const pgrid = document.getElementById('premium-grid');
const pmsg  = document.getElementById('premium-msg');

function showPmsg(text, isErr=false){
  if(!pmsg) return;
  pmsg.hidden = false;
  pmsg.textContent = text;
  pmsg.classList.toggle('error', !!isErr);
}

// Render
if (pgrid) {
  for (const p of PREMIUM) {
    const el = document.createElement('article');
    el.className = 'card';
    el.innerHTML = `
      <h3>${p.title}</h3>
      <p>${p.desc}</p>
      <div class="row">
        <span class="tag" title="Punti richiesti (minuti di credito)">Solo con punti: ${p.cost}</span>
        <button class="btn" data-id="${p.id}">Sblocca</button>
      </div>
      <div class="msg" id="out-${p.id}" hidden></div>
    `;
    el.querySelector('button').addEventListener('click', () => redeem(p.id));
    pgrid.appendChild(el);
  }
}

async function redeem(id){
  try{
    const item = PREMIUM.find(x=>x.id===id);
    if(!item){ return showPmsg('Elemento non trovato', true); }

    // 1) chiedi email per leggere il serbatoio (wallet)
    const email = prompt('Inserisci l’email usata al checkout per verificare i tuoi punti:');
    if(!email){ return; }

    showPmsg('Verifico il saldo punti…');
    const wr = await fetch('/.netlify/functions/wallet?email='+encodeURIComponent(email));
    const data = await wr.json();
    if(data.error){ return showPmsg(data.error, true); }

    const points = Number(data.total_minutes||0); // 1 punto = 1 minuto
    if(points < item.cost){
      const need = item.cost - points;
      return showPmsg(`Punti insufficienti. Ti servono ancora ${need} punti.`, true);
    }

    // 2) Input situazione (solo per alcuni)
    let ctx = '';
    if(item.id === 'QUANTUM' || item.id === 'OLOGRAFICO' || item.id === 'AI_ENGINE'){
      ctx = prompt('Inserisci la situazione (es. “ritardo a riunione con cliente X”)') || '';
    }

    // 3) Genera contenuto “sbloccato” (niente DB: non scaliamo i punti)
    const out = document.getElementById('out-'+item.id);
    if(out){
      out.hidden = false;
      const content = typeof item.build === 'function' ? item.build(ctx) : 'Contenuto non disponibile.';
      out.innerHTML = `
        <div style="white-space:pre-wrap">${content}</div>
        <div style="margin-top:10px" class="muted">
          Hai accesso perché possiedi ≥ ${item.cost} punti. 
          <strong>Nota:</strong> senza DB non scaliamo i punti dal saldo.
        </div>
      `;
      showPmsg(`Sbloccato: ${item.title}`);
    }
  }catch(e){
    console.error(e);
    showPmsg('Errore di rete', true);
  }
}
