// netlify/functions/stripe-webhook.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
const crypto = require('crypto');

// Resend per invio email
async function sendEmail({ to, subject, html }) {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'COLPA MIA <no-reply@colpamia.com>',
      to: [to],
      subject,
      html,
      reply_to: 'colpamiaconsulenze@proton.me'
    })
  });
  if (!resp.ok) throw new Error('email_send_failed');
}

// (facoltativo) Twilio WhatsApp Business
async function sendWhatsApp({ to, body }) {
  if (!process.env.TWILIO_ACCOUNT_SID) return { ok:false, skipped:true };
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM; // es. 'whatsapp:+14155238886'
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const form = new URLSearchParams();
  form.append('From', from);
  form.append('To', `whatsapp:${to.replace(/^whatsapp:/,'')}`);
  form.append('Body', body);
  const resp = await fetch(url, {
    method:'POST',
    headers:{ 'Authorization':'Basic '+Buffer.from(`${sid}:${token}`).toString('base64') },
    body: form
  });
  return { ok: resp.ok };
}

// calcolo minuti dal mapping env PRICE_RULES_JSON
function minutesFromSku(sku) {
  try {
    const rules = JSON.parse(process.env.PRICE_RULES_JSON || '{}');
    const r = rules[sku] || {};
    return Number(r.minutes || 0);
  } catch { return 0; }
}

// wallet su metadata cliente Stripe
async function addToWallet(customerId, add) {
  if (!customerId || !add) return 0;
  const c = await stripe.customers.retrieve(customerId);
  const current = Number(c?.metadata?.wallet_minutes || 0);
  const next = Math.max(0, current + add);
  await stripe.customers.update(customerId, { metadata: { ...c.metadata, wallet_minutes: String(next) } });
  return next;
}

const CORS = {'Access-Control-Allow-Origin':'*'};
const ok = ()=>({statusCode:200,headers:CORS,body:'ok'});

exports.handler = async (event) => {
  // verifica firma webhook
  const sig = event.headers['stripe-signature'];
  let data;
  try {
    data = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return { statusCode: 400, headers:CORS, body: 'bad signature' };
  }

  if (data.type !== 'checkout.session.completed') return ok();

  try {
    const session = await stripe.checkout.sessions.retrieve(data.data.object.id);

    const email = (session?.customer_details?.email || '').toLowerCase().trim();
    const phone = (session?.customer_details?.phone || '').trim();
    const customerId = session?.customer || null;
    const sku = String(session?.client_reference_id || '').trim();

    // — CONTEX parsing robusto —
    let need = '';
    try {
      for (const f of (session?.custom_fields || [])) {
        if (String(f?.key || '') === 'need' && f?.text?.value) {
          need = String(f.text.value || '');
          break;
        }
      }
    } catch {}
    if (!need) need = String(session?.metadata?.context_hint || '');

    // — genera testo scuse con funzione ai-excuse —
    const aiResp = await fetch(`${process.env.URL || 'https://colpamia.com'}/.netlify/functions/ai-excuse`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ sku, need })
    });
    const ai = await aiResp.json();
    const variants = Array.isArray(ai?.variants) ? ai.variants : [];
    const texts = variants.map(v => v.text || '').filter(Boolean);
    if (!texts.length) texts.push('Ciao, ho un imprevisto reale: mi riorganizzo e ti aggiorno a breve con orari aggiornati.');

    // — invio email (Base = 1 punto; Deluxe = elenco) —
    if (email) {
      const list = texts.map((t,i)=>`${i+1}. ${t}`).join('<br/>');
      const minutes = minutesFromSku(sku);
      const html =
`<h2>La tua Scusa</h2>
<p>${list}</p>
<p style="margin-top:16px">Accreditati <b>${minutes}</b> minuti sul tuo wallet.</p>`;
      await sendEmail({
        to: email,
        subject: 'La tua Scusa — COLPA MIA',
        html
      });
    }

    // — invio WhatsApp (prima variante) —
    if (phone && texts[0]) {
      try { await sendWhatsApp({ to: phone, body: texts[0] }); } catch {}
    }

    // — wallet —
    const added = minutesFromSku(sku);
    if (customerId && added) await addToWallet(customerId, added);

    return ok();
  } catch (e) {
    return { statusCode: 500, headers:CORS, body: 'webhook_error: '+String(e.message||e) };
  }
};
