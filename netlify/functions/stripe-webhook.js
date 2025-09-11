// netlify/functions/stripe-webhook.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const RESEND_KEY = (process.env.RESEND_API_KEY || '').trim();
const SITE_URL   = (process.env.SITE_URL || '').replace(/\/+$/, '');
const TW_SID     = (process.env.TWILIO_ACCOUNT_SID || '').trim();
const TW_TOKEN   = (process.env.TWILIO_AUTH_TOKEN || '').trim();
const TW_FROM_WA = (process.env.TWILIO_FROM_WA || '').trim(); // es: whatsapp:+1415...

const CORS = { 'Access-Control-Allow-Origin': '*' };
const resp = (s, b) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', ...CORS }, body: JSON.stringify(b) });

/* -------------------- helpers -------------------- */
function isColpaPackage(sku = '') {
  return String(sku).toUpperCase().startsWith('COLPA_');
}
function skuToKind(sku = '') {
  const x = String(sku).toUpperCase();
  if (x === 'RIUNIONE') return 'riunione';
  if (x === 'TRAFFICO') return 'traffico';
  if (x === 'CONNESSIONE' || x === 'CONS_KO' || x === 'CONN_KO') return 'connessione';
  if (x === 'SCUSA_DELUXE') return 'deluxe';
  return 'base';
}
async function listLineItemsWithProduct(sessionId) {
  try {
    return await stripe.checkout.sessions.listLineItems(sessionId, {
      limit: 100,
      expand: ['data.price.product'],
    });
  } catch {
    return { data: [] };
  }
}
function pick(obj, path, d = null) {
  try { return path.split('.').reduce((a, c) => (a && a[c] != null ? a[c] : null), obj) ?? d; } catch { return d; }
}
async function minutesFromSession(session) {
  const items = await listLineItemsWithProduct(session.id);
  let total = 0;
  for (const li of (items.data || [])) {
    const qty = Number(li?.quantity || 1);
    const m1 = Number(pick(li, 'price.metadata.minutes', 0)) || 0;
    const m2 = Number(pick(li, 'price.product.metadata.minutes', 0)) || 0;
    total += (m1 || m2) * qty;
  }
  return total;
}
async function sendWhatsApp(toE164, body) {
  try {
    if (!TW_SID || !TW_TOKEN || !TW_FROM_WA) return { ok: false, skip: 'twilio_not_configured' };
    const form = new URLSearchParams();
    form.append('To', `whatsapp:${toE164.replace(/^whatsapp:/, '')}`);
    form.append('From', TW_FROM_WA);
    form.append('Body', body);
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${TW_SID}:${TW_TOKEN}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, sid: j.sid, status: j.status, raw: j };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}
async function sendEmailResend(to, subject, html) {
  try {
    if (!RESEND_KEY) return { ok: false, skip: 'resend_not_configured' };
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'COLPA MIA <no-reply@colpamia.com>',
        to: [to],
        subject,
        html,
        reply_to: 'support@colpamia.com',
      }),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, id: j?.id, raw: j };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}
async function getExcuseVariants({ kind, need }) {
  const url = SITE_URL ? `${SITE_URL}/.netlify/functions/ai-excuse` : `/.netlify/functions/ai-excuse`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sku: kind, need, tone: 'naturale', locale: 'it-IT', maxLen: 320 }),
  });
  const data = await r.json().catch(() => ({}));
  const arr = Array.isArray(data?.variants) ? data.variants : [];
  // normalizza
  const texts = arr.map(v => String(v.whatsapp_text || v.text || '').trim()).filter(Boolean);
  while (texts.length < 3) texts.push(texts[0] || 'Ciao, è saltato un imprevisto reale. Sistemo e ti aggiorno a breve.');
  return texts.slice(0, 3);
}

/* ------------------ Netlify handler ------------------ */
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return resp(204, {});
  const sig = event.headers['stripe-signature'] || '';
  let type, obj;
  try {
    const evt = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    type = evt.type;
    obj = evt.data.object;
  } catch (e) {
    return resp(400, { error: 'invalid_signature' });
  }

  if (type !== 'checkout.session.completed') return resp(200, { ok: true, ignored: true });

  try {
    const session = await stripe.checkout.sessions.retrieve(obj.id);
    const email = (session?.customer_details?.email || '').toLowerCase().trim();
    const phone = (session?.customer_details?.phone || '').trim();
    const customerId = session?.customer || null;
    const sku = String(session?.client_reference_id || '').trim();

    // minuti dal listino (price/product metadata)
    const minutes = await minutesFromSession(session);

    // need (campo custom 'need', se presente)
    let need = '';
    try {
      for (const f of (session?.custom_fields || [])) {
        if (String(f?.key || '') === 'need' && f?.text?.value) { need = String(f.text.value); break; }
      }
    } catch {}

    // di default non inviamo niente per i pacchetti "Prendo io la colpa"
    let waSent = false, emSent = false, variantsUsed = 0;

    if (!isColpaPackage(sku)) {
      const kind = skuToKind(sku);
      const variants = await getExcuseVariants({ kind, need });
      variantsUsed = variants.length;

      // WhatsApp
      if (phone && variants[0]) {
        const text =
          `La tua Scusa\n` +
          `1) ${variants[0]}\n` +
          `2) ${variants[1]}\n` +
          `3) ${variants[2]}\n\n` +
          (minutes ? `Accreditati +${minutes} minuti sul tuo wallet.` : '');
        const wa = await sendWhatsApp(phone, text);
        waSent = !!wa.ok;
      }

      // Email
      if (email) {
        const html =
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
             <h2 style="margin:0 0 8px">La tua Scusa</h2>
             <ol>${variants.map(v => `<li>${v}</li>`).join('')}</ol>
             ${minutes ? `<p style="color:#555">Accreditati <b>${minutes}</b> minuti sul tuo wallet.</p>` : ''}
           </div>`;
        const em = await sendEmailResend(email, 'La tua Scusa — COLPA MIA', html);
        emSent = !!em.ok;
      }
    } else {
      // Pacchetto COLPA_*: nessuna scusa automatica.
      // (minuti eventuali comunque accreditati)
      if (email && minutes) {
        await sendEmailResend(
          email,
          'COLPA MIA — pagamento ricevuto',
          `<p style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
            Grazie! Pagamento ricevuto. Nessuna scusa automatica è stata inviata.<br/>
            Rispondi a questa email con i dettagli per gestire la situazione insieme.<br/>
            Accreditati <b>${minutes}</b> minuti sul tuo wallet.
           </p>`
        );
        emSent = true;
      }
    }

    // WALLET: somma sullo Stripe Customer
    let walletTotal = minutes;
    if (customerId) {
      try {
        const cust = await stripe.customers.retrieve(customerId);
        const prev = Number(cust?.metadata?.walletMinutes || 0) || 0;
        walletTotal = prev + minutes;
        await stripe.customers.update(customerId, { metadata: { walletMinutes: String(walletTotal) } });
      } catch {}
    }

    // salva metadati sull’Intent
    if (session.payment_intent) {
      try {
        await stripe.paymentIntents.update(session.payment_intent, {
          metadata: {
            minutesCredited: String(minutes || 0),
            excusesCount: String(variantsUsed || 0),
            customerEmail: email || '',
            colpamiaWaStatus: waSent ? 'sent' : 'skip',
            colpamiaEmailSent: emSent ? 'true' : 'false',
            walletAfter: String(walletTotal || 0),
            sku,
          },
        });
      } catch {}
    }

    return resp(200, { ok: true, minutes, waSent, emSent, wallet: walletTotal, sku });
  } catch (e) {
    return resp(500, { error: 'webhook_error', detail: String(e.message || e) });
  }
};
