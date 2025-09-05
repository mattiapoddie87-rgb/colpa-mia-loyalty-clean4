// public/lead.js
(() => {
  const f  = document.getElementById('lead-form');
  const em = document.getElementById('lead-email');
  const ph = document.getElementById('lead-phone');
  const hp = document.getElementById('hp');
  const btn= document.getElementById('lead-submit');
  const msg= document.getElementById('lead-msg');

  if (!f) return;

  const PDF_URL = '/assets/lead.pdf';

  function setMsg(t, ok=false){
    msg.textContent = t;
    msg.style.color = ok ? '#9be37e' : '#ffd6d6';
  }

  f.addEventListener('submit', async (e)=>{
    e.preventDefault();
    setMsg('');
    if (hp.value) return; // bot

    const email = (em.value||'').trim();
    const phone = (ph.value||'').trim();

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setMsg('Email non valida.'); em.focus(); return;
    }

    btn.disabled = true; btn.textContent = 'Invio...';

    try{
      const r = await fetch('/.netlify/functions/lead-pdf', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ email, phone, pdf: PDF_URL })
      });
      const data = await r.json().catch(()=> ({}));
      if (!r.ok) throw new Error(data?.error||('HTTP '+r.status));

      setMsg('Ti ho mandato il PDF via email. Avvio download...', true);
      // download immediato
      const a = document.createElement('a');
      a.href = PDF_URL; a.download = '';
      document.body.appendChild(a); a.click(); a.remove();
    }catch(err){
      console.error(err);
      setMsg('Errore invio. Riprova tra poco.');
    }finally{
      btn.disabled = false; btn.textContent = 'Scarica PDF';
    }
  });
})();
