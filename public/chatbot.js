// public/chatbot.js
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('chatbot-toggle');
  const container = document.getElementById('chatbot-container');
  const messagesEl = document.getElementById('chatbot-messages');
  const form = document.getElementById('chatbot-form');
  const input = document.getElementById('chatbot-input');
  let history = [];

  // apre/chiude la finestra
  toggle.addEventListener('click', () => {
    container.classList.toggle('open');
  });

  // invia il messaggio
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const userMsg = input.value.trim();
    if (!userMsg) return;
    appendMessage('user', userMsg);
    input.value = '';
    history.push({ role: 'user', content: userMsg });
    try {
      const resp = await fetch('/.netlify/functions/chatbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history }),
      });
      const data = await resp.json();
      const aiMsg = data.reply || data.error || '…';
      appendMessage('ai', aiMsg);
      history.push({ role: 'assistant', content: aiMsg });
    } catch (err) {
      console.error(err);
      appendMessage('ai', 'Errore nella risposta. Riprova più tardi.');
    }
  });

  function appendMessage(sender, text) {
    const p = document.createElement('p');
    p.className = sender === 'user' ? 'user' : 'ai';
    p.textContent = text;
    messagesEl.appendChild(p);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
});
