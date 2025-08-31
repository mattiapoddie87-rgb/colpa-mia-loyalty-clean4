// netlify/functions/stripe-webhook.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const safeRequire = p => { try { return require(p); } catch { return null; } };
const j = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

function getField(s, key){
  const f = (Array.isArray(s.custom_fields) ? s.custom_fields : []).find(x => x?.key === key);
  return (f && f.text && f.text.value) ? String(f.text.value).trim() : '';
}
function signalsFromSession(s){
  const email = String((s.customer_details?.email || s.customer_email || '')).toLowerCase();
  return {
    first_name: (s.customer_details?.name || email.split('@')[0] || 'Ciao').split(' ')[0],
    recipient:  getField(s,'recipient'),
    tone:       getField(s,'tone'),
    need:       getField(s,'need'),
    delay:      getField(s,'delay')
  };
}
function renderEmail({ firstName, excuses, minutes }) {
  const blocks = (excuses||[]).map((e)=> `<div style="margin:10px 0;padding:12px;border:1px solid #eee;border-radius:10px">${e}</div>`).join('');
  const accredito = minutes>0 ? `<p style="margin-top:12px">Accreditati <b>${minutes} minuti</b> sul tuo wallet.</p>` : '';
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111">
    <p>Ciao ${firstName || 'Ciao'},</p><h2 style="margin:0 0 8px 0;">La tua scusa</h2>${blocks||'<p>Nessuna scusa generata.</p>'}${accredito}
    <p style="margin-top:20px;font-size:12px;color:#666">Suggerimento: copia la variante che preferisci e incollala nel canale giusto.</p></div>`;
}

exports.handler = async (event) => {
  try {
    const sig = event.headers['stripe-signature'];
    const raw = event.isBase64Encoded ? Buffer.from(event.body,'base64').toString('utf8') : event.body;

    let ev;
    try { ev = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET); }
    catch (e) { return { statusCode: 400, body: `Webhook Error: ${e.message}` }; }

    if (ev.type === 'checkout.session.completed') {
      const s = ev.data.object;
      const piId = String(s.payment_intent || ''); if (!piId) return done();

      const pi = await stripe.paymentIntents.retrieve(piId);
      const alreadyCredited = pi.metadata?.colpamiaCredited === 'true';
      const alreadyMailed   = pi.metadata?.colpamiaEmailSent === 'true';

      const items = await stripe.checkout.sessions.listLineItems(s.id, { limit:100, expand:['data.price.product'] });

      // genera minuti + scuse
      let minutes = 0, excuses = [];
      const { processLineItems } = safeRequire('./fulfillment') || {};
      if (typeof processLineItems === 'function') {
        const sigs = signalsFromSession(s);
        const out = await processLineItems(items.data, sigs);
        minutes = Number(out.minutes||0);
        excuses = Array.isArray(out.excuses) ? out.excuses : [];
      } else {
        // Fallback: solo minuti
        const MAP = j(process.env.PRICE_MINUTES_JSON) || {};
        for (const li of items.data) {
          const price = li.price || {};
          const product = price.product || {};
          const env = price.id ? (MAP[price.id] || 0) : 0;
          const meta = parseInt(price?.metadata?.minutes || product?.metadata?.minutes || '', 10) || 0;
          minutes += (env || meta || 0) * (li.quantity || 1);
        }
      }

      // accredito
      if (!alreadyCredited && minutes>0) {
        try {
          const wallet = safeRequire('./wallet');
          if (wallet?.creditMinutes) {
            const email = String((s.customer_details?.email || s.customer_email || '')).toLowerCase();
            await wallet.creditMinutes(email, minutes, { session_id: s.id, piId });
          }
        } catch {}

      }

      // email
      let emailSent = alreadyMailed;
      if (!alreadyMailed) {
        try {
          const sender = safeRequire('./send-utils');
          if (sender?.sendEmail) {
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
          minutesCredited: String(minutes||0),
          excusesCount: String(excuses.length||0),
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
