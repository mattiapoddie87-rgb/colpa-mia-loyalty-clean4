// chatbot.js — chiama l'AI via Netlify function
(() => {
  const box=document.getElementById('chatbot-container');
  const tog=document.getElementById('chatbot-toggle');
  const msgs=document.getElementById('chatbot-messages');
  const form=document.getElementById('chatbot-form');
  const inp=document.getElementById('chatbot-input');

  if(!box||!tog||!msgs||!form||!inp) return;

  const MAXH=10, KEY='cm_chat_ai';
  const load=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'[]')}catch{return[]}};
  const save=(h)=>{try{localStorage.setItem(KEY,JSON.stringify(h.slice(-MAXH)))}catch{}};
  let hist=load();

  const line=(t,who)=>{const d=document.createElement('div');d.className='msg '+who;d.textContent=t;msgs.appendChild(d);msgs.scrollTop=msgs.scrollHeight};
  const bot =(t)=>{line(t,'bot'); hist.push({role:'assistant',content:t}); save(hist);};
  const user=(t)=>{line(t,'user'); hist.push({role:'user',content:t}); save(hist);};

  box.style.display='none';
  tog.addEventListener('click',()=>{const open=box.style.display==='none';box.style.display=open?'flex':'none';box.classList.toggle('open',open); if(open) inp.focus()});
  if(!hist.length) bot('Ciao! Chiedimi pure: prezzi, tempi, rimborsi, pacchetti.');

  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const q=(inp.value||'').trim(); if(!q) return;
    user(q); inp.value='';
    try{
      const r = await fetch('/.netlify/functions/ai-chat', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ message:q, history: hist })
      });
      const data = await r.json().catch(()=> ({}));
      bot((r.ok && data.reply) ? data.reply : 'Errore temporaneo. Riprova.');
    }catch{
      bot('Errore di rete. Riprova.');
    }
  });
})();
          
