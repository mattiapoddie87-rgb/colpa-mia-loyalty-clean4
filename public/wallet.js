// public/wallet.js
(() => {
  const emailInput = document.getElementById('wallet-email');
  const btn = document.getElementById('wallet-fetch');
  const grid = document.getElementById('wallet-grid');
  const msg  = document.getElementById('wallet-msg');

  async function fetchWallet() {
    const email = String(emailInput.value || '').trim().toLowerCase();
    msg.textContent = ''; grid.innerHTML = '';

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      msg.textContent = 'Email non valida.';
      return;
    }
    btn.disabled = true;
    try {
      const r = await fetch(`/.netlify/functions/wallet?email=${encodeURIComponent(email)}`);
      const data = await r.json().catch(()=> ({}));
      if (!r.ok || !data?.ok) {
        msg.textContent = data?.error || `Errore ${r.status}`;
        return;
      }
      grid.innerHTML = `
        <div class="card">
          <div class="row"><b>Minuti disponibili</b><span>${data.minutes}</span></div>
          <div class="row"><b>Punti</b><span>${data.points}</span></div>
          <div class="row"><b>Livello</b><span>${data.level}</span></div>
        </div>`;
    } catch {
      msg.textContent = 'Errore di rete.';
    } finally {
      btn.disabled = false;
    }
  }

  if (btn) btn.addEventListener('click', fetchWallet);
})();
