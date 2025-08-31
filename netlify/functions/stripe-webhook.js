// netlify/functions/stripe-webhook.js
// Webhook: genera scuse, accredita minuti e INVIA EMAIL su checkout.session.completed (idempotente).

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const j = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const safeRequire = (p) => { try { return require(p); } catch { return null; } };

function needFromSession(s){
  const cf = Array.isArray(s.custom_fields) ? s.custom_fields : [];
  const f = cf.find(x => x?.key === 'need') || null;
  return (f && f.text && f.text.value) ? String(f.text.value).trim() : '';
}

function renderEmail({ firstName, excuses, minutes }) {
  const e = Array.isArray(excuses) ? excuses : [];
  const scuseHtml = e.length
    ? `<h2 style="margin:0 0 8px 0;">La tua scusa</h2><p style="font-size:16px;line-height:1.5">${e.join('<br><br>')}</p>`
    : '';
  const accredito = minutes > 0
    ? `<p style="margin-top:12px">Accreditati <b>${minutes} minuti</b> sul tuo wallet.</p>`
    : '';
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111">
      <p>Ciao ${firstName || 'Ciao'},</p>
      ${scuseHtml}
      ${accredito}
      <p style="margin-top:20px;font-size:12px;color:#666">Se non sei stato tu, contatta subito il supporto.</p>
    </div>
  `;
}

exports.handler = async (event) => {
  try {
    const sig = event.headers['stripe-signature'];
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;

    let ev;
    try {
      ev = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (e) {
      return { statusCode: 400, body: `Webhook Error: ${e.message}` };
    }

    if (ev.type === 'checkout.session.completed') {
      const s = ev.data.object;
      const piId = String(s.payment_intent || '');
      if (!piId) return done();

      const pi = await stripe.paymentIntents.retrieve(piId);
      const alreadyCredited = pi.metadata && pi.metadata.colpamiaCredited === 'true';
      const alreadyMailed   = pi.metadata && pi.metadata.colpamiaEmailSent === 'true';

      const items = await stripe.checkout.sessions.listLineItems(s.id, { limit: 100, expand: ['data.price.product'] });

      let minutes = 0, excuses = [];
      const { processLineItems } = safeRequire('./fulfillment') || {};
      if (typeof processLineItems === 'function') {
        const need = needFromSession(s);
        const firstName = (s.customer_details?.name || '').split(' ')[0] || 'Ciao';
        const out = await processLineItems(items.data, { first_name: firstName, need });
        minutes = Number(out.minutes || 0);
        excuses = Array.isArray(out.excuses) ? out.excuses : [];
      } else {
        const MAP = j(process.env.PRICE_MINUTES_JSON) || {};
        for (const li of items.data) {
          const price = li.price || {};
          const product = price.product || {};
          const env = price.id ? (MAP[price.id] || 0) : 0;
          const meta = parseInt(price?.metadata?.minutes || product?.metadata?.minutes || '', 10) || 0;
          const m = env || meta || 0;
          minutes += m * (li.quantity || 1);
        }
      }

      if (!alreadyCredited && minutes > 0) {
        try {
          const wallet = safeRequire('./wallet');
          if (wallet && typeof wallet.creditMinutes === 'function') {
            const email = String((s.customer_details?.email || s.customer_email || '')).toLowerCase();
            await wallet.creditMinutes(email, minutes, { session_id: s.id, piId });
          }
        } catch {}
      }

      let emailSent = alreadyMailed;
      if (!alreadyMailed) {
        try {
          const sender = safeRequire('./send-utils');
          if (sender && typeof sender.sendEmail === 'function') {
            const to = String((s.customer_details?.email || s.customer_email || '')).toLowerCase();
            const firstName = (s.customer_details?.name || '').split(' ')[0] || 'Ciao';
            const html = renderEmail({ firstName, excuses, minutes });
            const subject = excuses.length ? 'La tua scusa è pronta' : 'Accredito minuti confermato';
            const res = await sender.sendEmail(to, subject, html);
            emailSent = !!res.sent;
          }
        } catch { emailSent = false; }
      }

      await stripe.paymentIntents.update(piId, {
        metadata: {
          ...(pi.metadata || {}),
          colpamiaCredited: 'true',
          minutesCredited: String(minutes || 0),
          excusesCount: String(excuses.length || 0),
          colpamiaEmailSent: emailSent ? 'true' : 'false'
        }
      });
    }

    return done();
  } catch (e) {
    return { statusCode: 500, body: e.message || 'Errore interno' };
  }
};

function done(){ return { statusCode: 200, body: JSON.stringify({ received: true }) }; }
