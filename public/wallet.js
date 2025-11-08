<!doctype html>
<html lang="it">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Wallet Minuti</title>
    <style>
      :root { color-scheme: dark; }
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background:#0b0d12; color:#e9eef5; margin:0; }
      .wrap{ max-width:960px; margin:40px auto; padding:0 16px; }
      .card{ background:#0f1623; border:1px solid #1f2636; border-radius:14px; padding:16px; }
      input, button { padding:12px; border-radius:10px; border:1px solid #334; background:#111826; color:#e9eef5; }
      input { width:100%; }
      button { background:linear-gradient(135deg,#6c7dff,#8a6dff); border:0; cursor:pointer; font-weight:600; }
      .mt12{ margin-top:12px; } .mt16{ margin-top:16px; }
      .muted{ opacity:.8; font-size:13px; }
      .grid{ display:grid; gap:12px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
      .row{ display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
      .pill{ padding:6px 10px; background:#142035; border-radius:999px; border:1px solid #213250; font-size:12px; }
      .err{ color:#ff6b6b } .ok{ color:#29d07b }
      table{ width:100%; border-collapse: collapse; }
      td,th{ padding:8px; border-bottom:1px solid #1f2636; text-align:left; font-size:14px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>Wallet Minuti</h1>
      <p class="muted">Inserisci l’email usata al checkout per vedere minuti e punti accumulati.</p>

      <div class="card">
        <input id="email" placeholder="email usata in checkout" />
        <button id="go" class="mt12">Vedi saldo</button>
        <span id="msg" class="mt12"></span>
      </div>

      <div class="card mt16">
        <h2>Saldo</h2>
        <div class="grid">
          <div class="row"><b>Minuti:</b><span id="minutes" class="pill">0</span></div>
          <div class="row"><b>Punti:</b><span id="points" class="pill">0</span></div>
          <div class="row"><b>Tier:</b><span id="tier" class="pill">None</span></div>
        </div>
      </div>

      <div class="card mt16">
        <h2>Storico acquisti</h2>
        <table id="history"><thead><tr><th>Data</th><th>SKU</th><th>Minuti</th><th>Importo</th></tr></thead><tbody></tbody></table>
      </div>
    </div>

    <script>
      const $ = (s) => document.querySelector(s);
      const fmtDate = (ts) => new Date(ts * 1000).toLocaleString();

      async function loadBalance(email) {
        $('#msg').textContent = 'Carico…';
        const r = await fetch('/.netlify/functions/balance?email=' + encodeURIComponent(email));
        const out = await r.json().catch(() => ({}));

        if (!r.ok || out.error) {
          $('#msg').textContent = out.error || ('HTTP ' + r.status);
          $('#msg').className = 'err';
          return;
        }

        $('#msg').textContent = 'OK';
        $('#msg').className = 'ok';

        $('#minutes').textContent = out.minutes ?? 0;
        $('#points').textContent  = out.points  ?? 0;
        $('#tier').textContent    = out.tier    ?? 'None';

        const tb = $('#history tbody'); tb.innerHTML = '';
        (out.history || []).forEach(h => {
          const tr = document.createElement('tr');
          tr.innerHTML = `<td>${fmtDate(h.created)}</td><td>${h.sku || ''}</td><td>${h.minutes || 0}</td><td>${(h.amount||0)/100} ${String(h.currency||'').toUpperCase()}</td>`;
          tb.appendChild(tr);
        });
        if (!out.history || !out.history.length) {
          const tr = document.createElement('tr');
          tr.innerHTML = `<td colspan="4" class="muted">Nessun pagamento registrato</td>`;
          tb.appendChild(tr);
        }
      }

      $('#go').addEventListener('click', () => {
        const email = $('#email').value.trim();
        if (!email) {
          $('#msg').textContent = 'Inserisci una email';
          $('#msg').className = 'err';
          return;
        }
        loadBalance(email);
      });
    </script>
  </body>
</html>
