// public/wallet.js
(()=> {
  const emailI = document.getElementById('wallet-email');
  const btn    = document.getElementById('wallet-fetch');
  const grid   = document.getElementById('wallet-grid');
  const msg    = document.getElementById('wallet-msg');

  async function load(){
    const email = (emailI?.value||'').trim();
    msg.textContent=''; grid.innerHTML='';
    if(!email){ msg.textContent='Inserisci una email.'; return; }
    btn.disabled = true;
    try{
      const r = await fetch('/.netlify/functions/balance', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ email })
      });
      const data = await r.json();
      if(!r.ok) throw new Error(data.error||'errore');
      grid.innerHTML = `
        <p>Minuti disponibili: <b>${data.minutes}</b></p>
        <p>Punti: <b>${data.points}</b></p>
        <p>Livello: <b>${data.level}</b></p>`;
    }catch(e){ msg.textContent = 'Errore: ' + e.message; }
    finally{ btn.disabled=false; }
  }
  btn?.addEventListener('click', load);
})();
