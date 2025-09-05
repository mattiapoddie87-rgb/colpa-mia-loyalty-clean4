// public/chatbot.js — IA unificata (scuse + chat)
(() => {
  const box=document.getElementById('chatbot-container');
  const tog=document.getElementById('chatbot-toggle');
  const msgs=document.getElementById('chatbot-messages');
  const form=document.getElementById('chatbot-form');
  const inp=document.getElementById('chatbot-input');
  if(!box||!tog||!msgs||!form||!inp) return;

  const MAXH=10, KEY='cm_chat_ai';
  const load=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'[]')}catch{return[]}};
  const save=h=>{try{localStorage.setItem(KEY,JSON.stringify(h.slice(-MAXH)))}catch{}};
  let hist=load();

  const line=(t,who)=>{const d=document.createElement('div');d.className='msg '+who;d.textContent=t;msgs.appendChild(d);msgs.scrollTop=msgs.scrollHeight};
  const bot =t=>{line(t,'bot');  hist.push({role:'assistant',content:t}); save(hist);};
  const user=t=>{line(t,'user'); hist.push({role:'user',content:t});      save(hist);};

  box.style.display='none';
  tog.addEventListener('click',()=>{const open=box.style.display==='none';box.style.display=open?'flex':'none';box.classList.toggle('open',open); if(open) inp.focus()});
  if(!hist.length) bot('Ciao! Chiedimi pure: prezzi, tempi, rimborsi, pacchetti.');

  form.addEventListener('submit', async e=>{
    e.preventDefault();
    const q=(inp.value||'').trim(); if(!q) return;
    user(q); inp.value='';

    // saluto specifico
    if(/^\s*(ciao|hey|ehi|buongiorno|buonasera)[\s!,.\-]*?(?:come\s+stai|come\s+va)\s*\??\s*$/i.test(q)){
      bot('Ciao, tutto bene.'); return;
    }

    // intent "scusa"
    const lower=q.toLowerCase();
    const wantsExcuse=/\b(scusa|alibi|giustifica(?:mi)?|copertura|inventami|preparami|giustificazione)\b/i.test(lower)
                    || /\bmi\s+serve\b.*\bscusa\b/i.test(lower)
                    || /\bprepara\b.*\bscusa\b/i.test(lower);
    if(wantsExcuse){
      try{
        const r=await fetch('/.netlify/functions/ai-excuse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({need:q,style:'neutro',persona:'generico',locale:'it-IT',maxLen:300})});
        const data=await r.json().catch(()=>({}));
        const v=(data?.variants||[])[0];
        bot(v ? (v.whatsapp_text||v.sms||'Ok.') : 'Posso preparare una scusa, ma la generazione non ha restituito risultati. Riprova.');
        return;
      }catch{ bot('Posso preparare una scusa, ma c’è stato un errore temporaneo. Riprova.'); return; }
    }

    // chat generale
    try{
      const r=await fetch('/.netlify/functions/ai-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:q,history:hist.slice(-MAXH)})});
      const data=await r.json().catch(()=>({}));
      bot((r.ok&&data.reply)?data.reply:'Errore temporaneo. Riprova.');
    }catch{ bot('Errore di rete. Riprova.'); }
  });
})();
