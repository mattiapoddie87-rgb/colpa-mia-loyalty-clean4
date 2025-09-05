// netlify/functions/stripe-webhook.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const { Resend } = require('resend');
const resend = new Resend((process.env.RESEND_API_KEY || '').trim());
const MAIL_FROM = process.env.RESEND_FROM || process.env.MAIL_FROM || 'COLPA MIA <onboarding@resend.dev>';

function http(s, b) {
  return { statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) };
}
function safeJSONEnv(key) { try { return JSON.parse(process.env[key] || '{}'); } catch { return {}; } }
const PRICE_RULES = safeJSONEnv('PRICE_RULES_JSON'); // {price_xxx:{minutes, excuse}}

function pick(x, path, d = null) {
  try { return path.split('.').reduce((a, c) => (a && a[c] != null ? a[c] : null), x) ?? d; } catch { return d; }
}

// --- AI excuses (via funzione interna o fallback)
async function generateExcuses(context, productTag) {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  const payload = { need: context || productTag || 'ritardo', style: 'neutro', persona: productTag || 'generico', locale: 'it-IT', maxLen: 300 };

  if (apiKey) {
    try {
      const r = await fetch(`${(process.env.SITE_URL || 'https://colpamia.com').replace(/\/+$/, '')}/.netlify/functions/ai-excuse`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      const data = await r.json().catch(() => ({}));
      const v = (data?.variants || []).map(x => String(x?.whatsapp_text || x?.sms || '').trim()).filter(Boolean);
      if (v.length) return { short: v[0], variants: v.slice(0, 3) };
    } catch {}
  }
  const v1 = 'Ho avuto un imprevisto serio e sto riorganizzando al volo. Arrivo più tardi del previsto; ti aggiorno tra poco.';
  const v2 = 'È saltata fuori una cosa urgente che non posso rimandare. Sto sistemando e ti scrivo appena ho chiaro l’orario.';
  const v3 = 'Situazione imprevista che mi blocca un attimo. Non voglio darti buca: mi prendo qualche minuto e ti aggiorno a breve.';
  return { short: v1, variants: [v1, v2, v3] };
}

// --- Email
async function sendEmail(to, minutes, excuses) {
  if (!resend || !to) return;
  const { variants } = excuses || {};
  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;line-height:1.45">
    <h2 style="margin:0 0 12px">La tua scusa</h2>
    ${Array.isArray(variants) && variants.length
      ? variants.map(v => `<p style="margin:10px 0;padding:12px;background:#f6f7fb;border-radius:10px">${v}</p>`).join('')
      : '<p>Nessuna scusa generata. (errore temporaneo)</p>'}
    <p style="margin-top:16px">Accreditati <b>${minutes}</b> minuti sul tuo wallet.</p>
  </div>`;
  try {
    await resend.emails.send({ from: MAIL_FROM, to, subject: 'La tua scusa è pronta ✅', html });
  } catch (e) {
    console.error('resend_error', e?.message || e);
  }
}

// --- WhatsApp (Twilio Sandbox)
const twilioSid = process.env.TWILIO_ACCOUNT_SID || '';
const twilioToken = process.env.TWILIO_AUTH_TOKEN || '';
const twilioFromWa = process.env.TWILIO_FROM_WA || ''; // es. whatsapp:+14155238886
const twilio = (twilioSid && twilioToken) ? require('twilio')(twilioSid, twilioToken) : null;

function onlyDigits(s) { return String(s || '').replace(/[^\d]/g, ''); }
function isE164(s) { return /^\+\d{6,15}$/.test(String(s || '')); }
function toWa(raw) {
  let v = String(raw || '').trim();
  if (/^whatsapp:\+\d{6,15}$/.test(v)) return v;
  if (isE164(v)) return `whatsapp:${v}`;
  let d = onlyDigits(v);
  if (d.startsWith('00')) d = d.slice(2);
  const cc = (process.env.DEFAULT_COUNTRY_CODE || '+39').replace('+', '');
  if (!d.startsWith(cc)) d = cc + d;
  return `whatsapp:+${d}`;
}
async function sendWA(toRaw, message) {
  if (!twilio || !twilioFromWa) return { ok: false, reason: 'twilio_not_configured' };
  try {
    await twilio.messages.create({ from: twilioFromWa, to: toWa(toRaw), body: message });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e?.message || 'wa_error') };
  }
}

// --- MAIN
exports.handler = async (event) => {
  try {
    const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
    if (!sig) return http(400, { error: 'missing_signature' });

    const whsec = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
    const ev = stripe.webhooks.constructEvent(event.body, sig, whsec);

    if (ev.type !== 'checkout.session.completed') return http(200, { ok: true, ignored: ev.type });

    const session = ev.data.object;
    if (session.mode !== 'payment') return http(200, { ok: true, ignored: 'not_payment' });

    const piId = String(session.payment_intent || '');
    if (!piId) return http(400, { error: 'missing_payment_intent' });

    let pi = await stripe.paymentIntents.retrieve(piId);

    // Email dell'acquirente
    const email = (session.customer_details?.email || session.customer_email || '').toLowerCase();
    if (!email) return http(400, { error: 'missing_email' });

    // Calcolo minuti dagli item
    const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100, expand: ['data.price.product'] });
    let minutes = 0; let productTag = '';
    for (const li of items.data) {
      const pr = li?.price?.id;
      const rule = PRICE_RULES[pr] || {};
      minutes += (Number(rule.minutes || 0) * (li.quantity || 1)) || 0;
      if (!productTag && rule.excuse) productTag = rule.excuse;
    }

    // Genera scuse (fallback sicuro)
    const need = (session.custom_fields || []).find(cf => (cf.key || '').toLowerCase() === 'need');
    const context = String(need?.text?.value || '').trim();
    const excuses = await generateExcuses(context, productTag);

    // Email
    await sendEmail(email, minutes, excuses);

    // WhatsApp best-effort
    let waStatus = 'no_phone';
    const phoneCandidates = new Set();
    const sPhone = pick(session, 'customer_details.phone'); if (sPhone) phoneCandidates.add(sPhone);
    const chPhone = pick(pi, 'charges.data.0.billing_details.phone'); if (chPhone) phoneCandidates.add(chPhone);
    (session.custom_fields || []).forEach(cf => {
      if ((cf.key || '').toLowerCase() === 'phone' && cf?.text?.value) phoneCandidates.add(cf.text.value);
    });

    if (phoneCandidates.size) {
      const waText = [
        'La tua Scusa (3 varianti):',
        ...excuses.variants.map((v, i) => `${i + 1}) ${v}`),
        '',
        `(+${minutes} min accreditati su COLPA MIA)`
      ].join('\n');

      for (const raw of phoneCandidates) {
        const r = await sendWA(raw, waText);
        if (r.ok) { waStatus = 'sent'; break; }
        else waStatus = 'error';
      }
    }

    // Scrivo metadati utili al wallet
    const meta = {
      ...(pi.metadata || {}),
      colpamiaCredited: 'true',
      colpamiaEmail: email,
      minutesCredited: String(minutes),
      excusesCount: String((excuses?.variants || []).length),
      colpamiaWaStatus: waStatus
    };
    pi = await stripe.paymentIntents.update(piId, { metadata: meta });

    return http(200, { ok: true, minutes, email, waStatus });
  } catch (e) {
    console.error('webhook_error', e?.message || e);
    return http(500, { error: String(e?.message || 'webhook_error') });
  }
};
