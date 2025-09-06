// public/chatbot.js
(() => {
  const $id = (x) => document.getElementById(x);

  const box   = $id('chatbot-container');
  const toggle= $id('chatbot-toggle');
  const msgs  = $id('chatbot-messages');
  const form  = $id('chatbot-form');
  const input = $id('chatbot-input');
  const clear = $id('cm-clear');

  let history = [];
  try { history = JSON.parse(localStorage.getItem('cmHistory') || '[]'); } catch {}

  function add(role, text){
    const el = document.createElement('div');
    el.className = 'msg ' + (role === 'assistant' || role === 'bot' ? 'bot' : 'user');
    el.textContent = text;
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
  }
  function save(){ localStorage.setItem('cmHistory', JSON.stringify(history.slice(-8))); }

  async function send(text){
    if(!text || !text.trim()) return;
    add('user', text);
    input.value = '';
    input.disabled = true;
    form.querySelector('button[type=submit]').disabled = true;

    try{
      const r = await fetch('/.netlify/functions/ai-chat', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ message:text, history })
      });
      const out = await r.json().catch(()=> ({}));
      const reply = String(out.reply || 'Ok.').trim();
      add('bot', reply);
      history = [...history, {role:'user', content:text}, {role:'assistant', content:reply}].slice(-8);
      save();
    }catch{
      add('bot', 'Ops, non riesco a collegarmi. Riprova tra poco.');
    }finally{
      input.disabled = false;
      form.querySelector('button[type=submit]').disabled = false;
      input.focus();
    }
  }

  // ripristina chat precedente
  history.forEach(m => add(m.role, m.content));

  // toggle finestra
  toggle.addEventListener('click', ()=>{
    box.classList.toggle('open');
    if (box.classList.contains('open')) setTimeout(()=>input.focus(), 50);
  });

  // invio da form
  form.addEventListener('submit', (e)=>{
    e.preventDefault();
    send(input.value);
  });

  // pulisci chat
  clear.addEventListener('click', ()=>{
    history = [];
    save();
    msgs.innerHTML = '';
  });

  // ✅ Bottoni rapidi (funzionano ovunque grazie a event delegation)
  document.addEventListener('click', (e)=>{
    const btn = e.target.closest('.quick button');
    if (!btn) return;
    e.preventDefault();
    const q = btn.dataset.q || btn.textContent.trim();
    send(q);
  });

  // apri da #chat
  if (location.hash === '#chat') {
    box.classList.add('open');
    setTimeout(()=>input.focus(), 50);
  }
})();
