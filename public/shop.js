const btns = document.querySelectorAll('.buy');
const msgEl = document.getElementById('msg');

const showMsg = (text, isError = false) => {
  msgEl.hidden = false;
  msgEl.textContent = text;
  msgEl.classList.toggle('error', isError);
};

btns.forEach(btn => {
  btn.addEventListener('click', async () => {
    const priceId = btn.dataset.price;
    if (!priceId) return;

    showMsg('Reindirizzamento al checkout in corso…');

    try {
      const res = await fetch('/.netlify/functions/create-checkout-session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ priceId })
      });

      if (res.status === 303 || res.redirected) {
        const loc = res.headers.get('Location');
        if (loc) window.location.href = loc;
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (data?.url) {
        window.location.href = data.url;
        return;
      }

      throw new Error(data?.error || 'Impossibile avviare il checkout.');
    } catch (err) {
      showMsg(err.message, true);
    }
  });
});

