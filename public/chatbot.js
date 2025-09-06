// public/chatbot.js — fix “Ok.” + quick buttons
(() => {
  const box   = document.getElementById('chatbot-container');
  const toggle= document.getElementById('chatbot-toggle');
  const form  = document.getElementById('chatbot-form');
  const input = document.getElementById('chatbot-input');
  const msgs  = document.getElementById('chatbot-messages');
  const clear = document.getElementById('cm-clear');

  const quickWrap = document.querySelector('.quick');
  const QUICK = ['Prezzi','Tempi','Rimborso','Privacy','Come acquistare'];

  let history = []; // {role:'user'|'assistant', content:string}

  function addMsg(text, who='bot'){
    const div = document.createElement('div');
    div.className = 'msg ' + (who==='user' ? 'user' : 'bot');
    div.textContent = text;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function setTyping(on){
    if(on){
      addMsg('…', 'bot');
      typingEl = msgs.lastElementChild;
      typingEl.classList.add('typing');
    }else if(typingEl){
      typingEl.remove();
      typingEl = null;
    }
  }
  let typingEl = null;

  async function ask(message){
    // UI
    addMsg(message, 'user');
    setTyping(true);

    try{
      const r = await fetch('/.netlify/functions/ai-chat', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ message, history })
      });
      const data = await r.json().catch(()=> ({}));

      // accetta diversi campi possibili
      const reply =
        (data && (data.reply || data.text || data.output_text)) ||
        (data?.choices?.[0]?.message?.content) ||
        '';

      setTyping(false);

      if (!r.ok || !reply.trim()) {
        addMsg('Ops, non ho ricevuto la risposta. Riprova o chiedimi “Prezzi”, “Tempi”, “Rimborso”, “Privacy”, “Come acquistare”.');
        return;
      }

      addMsg(reply.trim(), 'bot');

      // aggiorna history (max 8)
      history.push({ role:'user', content: message });
      history.push({ role:'assistant', content: reply.trim() });
      history = history.slice(-8);
    }catch(e){
      setTyping(false);
      addMsg('Errore di rete. Riprova tra poco.');
    }
  }

  // quick buttons
  if (quickWrap && !quickWrap.children.length){
    quickWrap.innerHTML = QUICK.map(q => `<button type="button" data-q="${q}">${q}</button>`).join('');
  }
  quickWrap?.addEventListener('click', (e)=>{
    const b = e.target.closest('button[data-q]');
    if(!b) return;
    ask(b.getAttribute('data-q'));
  });

  // form
  form?.addEventListener('submit', (e)=>{
    e.preventDefault();
    const text = (input.value || '').trim();
    if(!text) return;
    input.value = '';
    ask(text);
  });

  // toggle + clear
  toggle?.addEventListener('click', ()=> box.classList.toggle('open'));
  clear?.addEventListener('click', ()=>{
    history = [];
    msgs.innerHTML = '';
  });
})();
