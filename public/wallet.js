// public/wallet.js

// helper brevi
const $ = (s) => document.querySelector(s);
const fmtDate = (ts) => new Date(ts * 1000).toLocaleString();

// chiama la function Netlify e popola la pagina
async function loadBalance(email) {
  const msg = $('#msg');
  msg.textContent = 'Carico…';
  msg.className = '';

  try {
    const res = await fetch('/.netlify/functions/balance?email=' + encodeURIComponent(email));
    const data = await res.json();

    if (!res.ok || data.error) {
      msg.textContent = data.error || ('HTTP ' + res.status);
      msg.className = 'err';
      return;
    }

    msg.textContent = 'OK';
    msg.className = 'ok';

    // saldo
    $('#minutes').textContent = data.minutes ?? 0;
    $('#points').textContent  = data.points  ?? 0;
    $('#tier').textContent    = data.tier    ?? 'None';

    // storico
    const tbody = document.querySelector('#history tbody');
    tbody.innerHTML = '';
    (data.history || []).forEach((entry) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${fmtDate(entry.created)}</td>
        <td>${entry.sku || ''}</td>
        <td>${entry.minutes || 0}</td>
        <td>${(entry.amount || 0) / 100} ${(entry.currency || 'EUR').toUpperCase()}</td>
      `;
      tbody.appendChild(tr);
    });

    if (!data.history || !data.history.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="4" class="muted">Nessun pagamento registrato</td>`;
      tbody.appendChild(tr);
    }
  } catch (err) {
    msg.textContent = err.message || 'Errore di rete';
    msg.className = 'err';
  }
}

// hook sul bottone
document.addEventListener('DOMContentLoaded', () => {
  const btn = $('#go');
  const emailInput = $('#email');

  btn.addEventListener('click', () => {
    const email = emailInput.value.trim();
    if (!email) {
      $('#msg').textContent = 'Inserisci una email';
      $('#msg').className = 'err';
      return;
    }
    loadBalance(email);
  });

  // prefill da query string ?email=
  const urlEmail = new URL(window.location.href).searchParams.get('email');
  if (urlEmail) {
    emailInput.value = urlEmail;
    loadBalance(urlEmail);
  }
});
