Ecco **`netlify/functions/stripe-webhook.js`** completo, pronto da incollare:

```js
// netlify/functions/stripe-webhook.js
// Webhook Stripe: accredita minuti/punti (Customer.metadata), genera scuse via AI,
// invia email (Resend) e WhatsApp (Twilio). Idempotente sul PaymentIntent.

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const { Resend } = require('resend');
const resendKey = (process.env.RESEND_API_KEY || '').trim();
const resend = resendKey ? new Resend(resendKey) : null;
const MAIL_FROM = process.env.RESEND_FROM || process.env.MAIL_FROM || 'COLPA MIA <onboarding@resend.dev>';

const twilioSid = process.env.TWILIO_ACCOUNT_SID || '';
const twilioToken = process.env.TWILIO_AUTH_TOKEN || '';
const twilioFromWa = process.env.TWILIO_FROM_WA || ''; // es. "whatsapp:+14155238886"
const defaultCC = (process.env.DEFAULT_COUNTRY_CODE || '+39').trim();
const twilio = (twilioSid && twilioToken ? require('twilio')(twilioSid, twilioToken) : null);

function http(s, b) { return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }; }
function pick(x, path, d = null) { try { return path.split('.').reduce((a, c) => (a && a[c] != null ? a[c] : null), x) ?? d; } catch { return d; } }
function onlyDigits(s) { return String(s || '').replace(/[^\d]/g, ''); }
function isE164(s) { return /^\+\d{6,15}$/.test(String(s || '')); }
function asWhatsApp(toRaw) {
  let to = String(toRaw || '').trim();
  if (/^whatsapp:\+\d{6,15}$/.test(to)) return to;
  if (isE164(to)) return `whatsapp:${to}`;
  let d = onlyDigits(to);
  if (d.startsWith('00')) d = d.slice(2);
  const cc = defaultCC.replace('+', '');
  if (!d.startsWith(cc)) d = cc + d;
  return `whatsapp:+${d}`;
}
function readJSONenv(key) { try { return JSON.parse(process.env[key] || '{}'); } catch { return {}; } }

const PRICE_RULES = readJSONenv('PRICE_RULES_JSON'); // { price_xxx: { minutes, excuse } }
const ORIGIN = (process.env.SITE_URL || 'https://colpamia.com').replace(/\/+$/, '');

// -------- Customer helpers (saldo minuti/punti in metadata) --------
async function findOrCreateCustomer(email) {
  const list = await stripe.customers.list({ email, limit: 1 });
  return list.data[0] || await stripe.customers.create({ email });
}

// 1 minuto = 1 punto. Salva in Customer.metadata: cm_minutes / cm_points
async function creditMinutes(email, minutes) {
  try {
    if (!email || !minutes) return false;
    const c = await findOrCreateCustomer(email);
    const md = c.metadata || {};
    const curMin = parseInt(md.cm_minutes || '0', 10) || 0;
    const curPts = parseInt(md.cm_points || '0', 10) || 0;
    await stripe.customers.update(c.id, {
      metadata: {
        ...md,
        cm_minutes: String(curMin + minutes),
        cm_points: String(curPts + minutes),
      }
    });
    return true;
  } catch (e) {
    console.error('creditMinutes_error', e?.message || e);
    return false;
  }
}

// -------- AI: genera 3 varianti usando la funzione /.netlify/functions/ai-excuse --------
async function generateExcusesAI(context, productTag) {
  const payload = {
    need: String(context || productTag || 'ritardo').slice(0, 400),
    style: 'neutro',
    persona: String(productTag || 'generico'),
    locale: 'it-IT',
    maxLen: 300
  };
  try {
    const r = await fetch(`${ORIGIN}/.netlify/functions/ai-excuse`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await r.json().catch(() => ({}));
    const v = Array.isArray(data?.variants) ? data.variants.slice(0, 3) : [];
    if (v.length) return v;
  } catch (e) { /* noop */ }

  // fallback minimal
  return [{
    style_label: 'A',
    sms: 'Imprevisto ora, sto riorganizzando. Ti aggiorno entro sera.',
    whatsapp_text: 'È saltata fuori una cosa urgente e sto riorganizzando: arrivo più tardi. Ti scrivo entro le 18 con un orario chiaro.',
    email_subject: 'Aggiornamento',
    email_body: 'Ciao, è sopraggiunto un imprevisto che sto gestendo. Preferisco non fare promesse a vuoto: ti mando un aggiornamento entro le 18 con un nuovo orario affidabile.',
    escalation: '', risk_score: 0, red_flags: []
  }];
}

// -------- Email --------
async function sendEmail(to, minutes, variants) {
  if (!resend) return { ok: false, reason: 'no_resend_key' };
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;line-height:1.45">
      <h2 style="margin:0 0 12px">La tua scusa</h2>
      ${variants.map(v => `<p style="margin:10px 0;padding:12px;background:#f6f7fb;border-radius:10px">${(v.whatsapp_text||v.sms||'').replace(/</g,'&lt;')}</p>`).join('')}
      <p style="margin-top:16px">Accreditati <b>${minutes} minuti</b> sul tuo wallet.</p>
      <p style="font-size:12px;color:#666">Suggerimento: copia la variante che preferisci e incollala nel canale giusto.</p>
    </div>`;
  try {
    await resend.emails.send({ from: MAIL_FROM, to, subject: 'La tua scusa è pronta ✅', html });
    return { ok: true };
  } catch (err) {
    console.error('resend_error', err?.message || err);
    return { ok: false, reason: err?.message || 'send_error' };
  }
}

// -------- WhatsApp --------
async function sendWhatsApp(toRaw, message, paymentIntentId) {
  if (!twilio || !twilioFromWa) return { ok: false, reason: 'twilio_not_configured' };
  const to = asWhatsApp(toRaw);
  try {
    await twilio.messages.create({ from: twilioFromWa, to, body: message });
    return { ok: true };
  } catch (err) {
    // salva errore su PI metadata per diagnosi
    try {
      const cur = await stripe.paymentIntents.retrieve(paymentIntentId);
      await stripe.paymentIntents.update(paymentIntentId, {
        metadata: { ...(cur.metadata || {}), colpamiaWaError: String(err?.message || err?.code || 'wa_error') }
      });
    } catch {}
    return { ok: false, reason: err?.message || 'wa_error' };
  }
}

// -------- Recupero telefono da sessione/PI/Customer --------
async function getPhoneCandidates(session, paymentIntent) {
  const out = new Set();

  const sPhone = pick(session, 'customer_details.phone');
  if (sPhone) out.add(sPhone);

  const chPhone = pick(paymentIntent, 'charges.data.0.billing_details.phone');
  if (chPhone) out.add(chPhone);

  const customFields = Array.isArray(session?.custom_fields) ? session.custom_fields : [];
  customFields.forEach(cf => {
    if (cf?.key?.toLowerCase() === 'phone' && cf?.text?.value) out.add(cf.text.value);
  });

  const customerId = session.customer || paymentIntent.customer;
  if (customerId) {
    try {
      const customer = await stripe.customers.retrieve(customerId);
      if (customer?.phone) out.add(customer.phone);
      if (customer?.metadata?.phone) out.add(customer.metadata.phone);
    } catch {}
  }
  return Array.from(out);
}

// ======================= HANDLER =======================
exports.handler = async (event) => {
  try {
    const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
    if (!sig) return http(400, { error: 'missing signature' });
    const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const stripeEvent = stripe.webhooks.constructEvent(event.body, sig, whSecret);

    if (stripeEvent.type !== 'checkout.session.completed')
      return http(200, { received: true, ignored: stripeEvent.type });

    const session = stripeEvent.data.object;
    if (session.mode !== 'payment') return http(200, { received: true, ignored: 'not_payment' });

    const piId = String(session.payment_intent || '');
    if (!piId) return http(400, { error: 'missing payment_intent' });

    let pi = await stripe.paymentIntents.retrieve(piId);
    if (pi.metadata?.colpamiaCredited === 'true') return http(200, { ok: true, already: true });

    const email = String(session.customer_details?.email || session.customer_email || '').toLowerCase();
    if (!email) return http(400, { error: 'missing email' });

    // minuti & tag prodotto
    const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100, expand: ['data.price.product'] });
    let minutes = 0; let productTag = '';
    for (const li of items.data) {
      const rule = PRICE_RULES[li?.price?.id] || {};
      minutes += (Number(rule.minutes || 0) * (li.quantity || 1)) || 0;
      if (!productTag && rule.excuse) productTag = rule.excuse;
    }

    // contesto dal custom field "need"
    let context = '';
    const cfs = Array.isArray(session?.custom_fields) ? session.custom_fields : [];
    for (const cf of cfs) {
      if (cf?.key?.toLowerCase() === 'need' && cf?.text?.value) context = String(cf.text.value || '').trim();
    }

    // genera scuse
    const variants = await generateExcusesAI(context, productTag);

    // accredita saldo
    await creditMinutes(email, Math.max(0, minutes));

    // email
    await sendEmail(email, Math.max(0, minutes), variants);

    // whatsapp (best effort)
    const phoneCandidates = await getPhoneCandidates(session, pi);
    let waStatus = 'no_phone';
    if (phoneCandidates.length) {
      const waText = [
        'COLPA MIA — La tua Scusa:',
        (variants[0]?.whatsapp_text || variants[0]?.sms || '—'),
        '',
        `(+${Math.max(0, minutes)} min accreditati nel wallet)`
      ].join('\n');
      for (const raw of phoneCandidates) {
        const res = await sendWhatsApp(raw, waText, piId);
        if (res.ok) { waStatus = 'sent'; break; }
        else waStatus = 'error';
      }
    }

    // metadati PI aggiornati (idempotenza)
    pi = await stripe.paymentIntents.update(piId, {
      metadata: {
        ...(pi.metadata || {}),
        colpamiaCredited: 'true',
        colpamiaEmailSent: 'true',
        colpamiaWhatsAppTried: String(!!phoneCandidates.length),
        colpamiaWaStatus: waStatus,
        minutesCredited: String(Math.max(0, minutes)),
        excusesCount: String(variants.length)
      }
    });

    return http(200, { ok: true, minutes: Math.max(0, minutes), email, waStatus });

  } catch (err) {
    console.error('webhook_error', err?.message || err);
    return http(500, { error: err?.message || 'webhook_error' });
  }
};
```
