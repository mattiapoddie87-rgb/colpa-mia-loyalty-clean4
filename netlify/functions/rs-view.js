// netlify/functions/rs-view.js
const { Blobs } = require('@netlify/blobs');
const STORE = new Blobs({ siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_TOKEN });

exports.handler = async (event) => {
  const id = (event.queryStringParameters||{}).id;
  if (!id) return { statusCode: 400, body: 'Missing id' };

  const key = `rs/${id}.json`;
  const raw = await STORE.get(key, { type:'json' });
  if (!raw) return { statusCode: 404, body: 'Not found' };

  if (raw.expiresAt && new Date(raw.expiresAt) < new Date()) {
    return { statusCode: 200, headers:{'Content-Type':'text/html'}, body:`<h1>Link scaduto</h1>` };
  }

  const html = `
<!doctype html><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Colpa Mia — Switch</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1115;color:#e6e6e6;margin:0}
  .wrap{max-width:720px;margin:0 auto;padding:24px}
  .card{background:#151822;border:1px solid #23283b;border-radius:16px;padding:16px}
  button{padding:12px 14px;border-radius:12px;border:0;cursor:pointer;background:#3b82f6;color:#fff;margin:6px 6px 0 0}
  .muted{color:#9aa3b2}
</style>
<div class="wrap">
  <h1>Responsibility Switch</h1>
  <p class="muted">Contesto: <b>${raw.context}</b></p>
  ${raw.brief ? `<div class="card" style="margin:12px 0">${raw.brief.replace(/\n/g,'<br>')}</div>`:''}
  <div class="card">
    <p>Scegli un’opzione per continuare:</p>
    <button onclick="choose('RICHIAMAMI')">Richiamami</button>
    <button onclick="choose('RIPROGRAMMA')">Riprogramma</button>
    <button onclick="choose('VOUCHER')">Rimborso/Voucher</button>
    <p id="msg" class="muted"></p>
  </div>
</div>
<script>
 async function choose(choice){
   const r = await fetch('/.netlify/functions/rs-choice', {
     method:'POST', headers:{'Content-Type':'application/json'},
     body: JSON.stringify({ id:'${id}', choice })
   });
   const d = await r.json().catch(()=>({}));
   document.getElementById('msg').textContent = r.ok ? 'Grazie, abbiamo registrato la tua scelta.' : ('Errore: '+(d.error||''));
 }
</script>`;
  return { statusCode: 200, headers:{'Content-Type':'text/html'}, body: html };
};
