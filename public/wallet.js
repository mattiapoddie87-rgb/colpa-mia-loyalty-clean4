// Wallet: mostra minuti e punti disponibili per l’email indicata
document.addEventListener('DOMContentLoaded', () => {
  const emailInput = document.getElementById('wallet-email');
  const fetchBtn   = document.getElementById('wallet-fetch');
  const walletGrid = document.getElementById('wallet-grid');
  const walletMsg  = document.getElementById('wallet-msg');

  async function loadBalance(email) {
    walletMsg.textContent = 'Caricamento...';
    walletGrid.innerHTML = '';
    try {
      const res  = await fetch(`/.netlify/functions/balance?email=${encodeURIComponent(email)}`);
      const data = await res.json();
      walletGrid.innerHTML = `
        <p>Minuti disponibili: ${data.minutes || 0}</p>
        <p>Punti: ${data.points || 0}</p>
        <p>Livello: ${data.tier || 'Base'}</p>
      `;
      walletMsg.textContent = '';
    } catch (err) {
      console.error(err);
      walletMsg.textContent = 'Errore nel recuperare il saldo.';
    }
  }

  fetchBtn?.addEventListener('click', () => {
    const email = emailInput.value.trim();
    if (!email) {
      walletMsg.textContent = 'Inserisci l’email usata per l’acquisto.';
      return;
    }
    loadBalance(email);
  });
});
