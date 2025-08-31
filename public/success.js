(function(){
  const $ = (s)=>document.querySelector(s);
  const params = new URLSearchParams(location.search);
  const sid = params.get('sid') || params.get('session_id') || params.get('session') || '';
  if (sid) $('#sid').value = sid;

  const show = (t, err=false)=>{
    const m = $('#msg');
    m.hidden = false;
    m.textContent = t;
    m.classList.toggle('error', err);
  };

  $('#claim').addEventListener('click', async ()=>{
    const session_id = $('#sid').value.trim();
    const email = $('#email').value.trim();
    const phone = $('#phone').value.trim();

    if(!session_id){ show('Inserisci il session_id del checkout (inizia con cs_)', true); return; }

    show('Collego e accredo minuti…');

    try{
      const r = await fetch('/.netlify/functions/claim-purchase', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ session_id, email, phone })
      });
      const data = await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(data.error || 'Errore');

      // Se tutto ok: accredito fatto e consegna inviata (se presente bozza)
      show('Fatto! Ti porto al Wallet…');
      const to = '/wallet.html' + (data.email ? `?email=${encodeURIComponent(data.email)}` : '');
      setTimeout(()=>location.href = to, 800);
    }catch(e){
      console.error(e);
      show(e.message || 'Errore di collegamento', true);
    }
  });
})();
