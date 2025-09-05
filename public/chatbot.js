// Colpa Mia — Chatbot minimale, veloce, senza dipendenze.
// Funziona offline con intent regex. Se in futuro vuoi un backend, imposta window.CHATBOT_ENDPOINT.

(() => {
  const ENDPOINT = window.CHATBOT_ENDPOINT || null;   // opzionale
  const TIMEOUT_MS = 6500;                            // fail-fast
  const MAX_HISTORY = 50;                             // per localStorage

  // --- mount
  const box  = document.getElementById('chatbot-container');
  const tog  = document.getElementById('chatbot-toggle');
  const msgs = document.getElementById('chatbot-messages');
  const form = document.getElementById('chatbot-form');
  const inp  = document.getElementById('chatbot-input');

  if (!box || !tog || !msgs || !form || !inp) return;

  // header + quick actions
  const head = document.createElement('div');
  head.className = 'chat-head';
  head.innerHTML = `<b>Assistenza rapida</b>
    <div>
      <button type="button" id="cm-clear" title="Svuota chat">✕</button>
    </div>`;
  box.insertBefore(head, msgs);

  const quick = document.createElement('div');
  quick.className = 'quick';
  quick.innerHTML = `
    <button data-q="Prezzi">Prezzi</button>
    <button data-q="Tempi di consegna">Tempi</button>
    <button data-q="Rimborso">Rimborso</button>
    <button data-q="Privacy">Privacy</button>
    <button data-q="Come acquistare">Come acquistare</button>
  `;
  box.appendChild(quick);

  // stato
  const state = {
    open: false,
    busy: false,
    history: loadHistory()
  };

  // init UI
  renderHistory();
  box.classList.remove('open');
  box.style.display = 'none';

  tog.addEventListener('click', () => {
    state.open = !state.open;
    box.style.display = state.open ? 'flex' : 'none';
    box.classList.toggle('open', state.open);
    if (state.open) inp.focus();
  });

  document.getElementById('cm-clear').addEventListener('click', () => {
    state.history = [];
    saveHistory();
    msgs.innerHTML = '';
    bot("Ok, ripartiamo da zero. Hai una domanda?");
  });

  quick.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-q]');
    if (!b) return;
    send(b.getAttribute('data-q'));
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = (inp.value || '').trim();
    if (!text || state.busy) return;
    send(text);
  });

  // --- core
  function send(text) {
    user(text);
    inp.value = '';
    respond(text).catch(() => bot("Errore temporaneo. Riprova tra poco."));
  }

  async function respond(text) {
    state.busy = true;

    // backend (opzionale)
    if (ENDPOINT) {
      try {
        const controller = new AbortController();
        const to = setTimeout(() => controller.abort(), TIMEOUT_MS);
        const r = await fetch(ENDPOINT, {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ q: text, history: last(state.history, 6) }),
          signal: controller.signal
        });
        clearTimeout(to);
        if (r.ok) {
          const data = await r.json().catch(()=> ({}));
          const out = (data.reply || '').trim();
          if (out) { bot(out); state.busy = false; return; }
        }
      } catch(_) { /* fallback locale */ }
    }

    // fallback locale (intent regex)
    const out = localReply(text);
    bot(out);
    state.busy = false;
  }

  // --- replies locali
  function localReply(q) {
    const s = q.toLowerCase();

    const intents = [
      { re: /(prezzi?|costa|quanto|listino)/,  a: 'Prezzi e pacchetti sono nel Catalogo. Paghi con Stripe in 10s.' },
      { re: /(tempo|quando|consegna|quanto ci mette|rapid)/, a: 'Consegna automatica tra 30s e 10m in base al pacchetto.' },
      { re: /(rimborso|refund|soddisfatto)/, a: 'Se il testo non ti soddisfa, rimborsiamo.' },
      { re: /(privacy|anonim|dati|gdpr)/,     a: 'Richiediamo solo i dati minimi. Le richieste restano anonime.' },
      { re: /(come (si )?acquista|comprare|checkout)/, a: 'Vai su “Catalogo”, scegli un pacchetto e clicca “Acquista”. Paghi con Stripe.' },
      { re: /(whatsapp|telefono|numero)/,     a: 'Puoi lasciare il numero in checkout: inviamo anche via WhatsApp (se configurato).' },
      { re: /(email|ricev|fattura)/,          a: 'Ricevi la scusa via email. Se ti serve fattura, rispondi alla mail di conferma.' }
    ];

    const hit = intents.find(i => i.re.test(s));
    if (hit) return hit.a;

    return 'Scrivimi cosa ti serve (contesto e urgenza). Ti indico il pacchetto giusto o ti preparo una bozza.';
  }

  // --- UI helpers
  function line(text, who) {
    const p = document.createElement('div');
    p.className = `msg ${who}`;
    p.textContent = text;
    msgs.appendChild(p);
    msgs.scrollTop = msgs.scrollHeight;
  }
  function bot(t){ line(t,'bot'); push('bot', t); }
  function user(t){ line(t,'user'); push('user', t); }

  function push(role, content){
    state.history.push({ t: Date.now(), role, content });
    if (state.history.length > MAX_HISTORY) state.history.shift();
    saveHistory();
  }

  function saveHistory(){ try{ localStorage.setItem('cm_chat', JSON.stringify(state.history)); }catch{} }
  function loadHistory(){ try{ return JSON.parse(localStorage.getItem('cm_chat')||'[]'); }catch{ return []; } }
  function renderHistory(){
    msgs.innerHTML = '';
    state.history.forEach(m => line(m.content, m.role));
    if (!state.history.length) bot('Ciao! Posso aiutarti con prezzi, tempi, rimborsi e scelta pacchetto.');
  }
  function last(arr, n){ return arr.slice(-n); }
})();
