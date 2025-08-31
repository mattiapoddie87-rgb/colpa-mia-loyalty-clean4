// netlify/functions/claim-purchase.js
// Collega una Checkout Session pagata, genera eventuali Scuse e accredita minuti (idempotente).

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const j = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const ok  = (b) => ({ statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const err = (c, m) => ({ statusCode: c, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: m }) });

const safeRequire = (p) => { try { return require(p); } catch { return null; } };
const normalizeEmail = (e) => String(e || '').trim().toLowerCase();
const isEmail = (x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(x||''));

function needFromSession(s){
  const cf = Array.isArray(s.custom_fields) ? s.custom_fields : [];
  const f = cf.find(x => x?.key === 'need') || null;
  return (f && f.text && f.text.value) ? String(f.text.value).trim() : '';
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };
    if (event.httpMethod !== 'POST') return err(405, 'Method Not Allowed');

    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch {}

    let { session_id, email_fallback, phone } = body;
    session_id = String(session_id || '').replace(/\s/g, '');

    if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(session_id)) return err(400, 'Session ID non valido');
    if (session_id.length > 200) return err(400, 'Session ID troppo lungo');

    const isLiveId = session_id.startsWith('cs_live_');
    const isLiveKey = String(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live_');
    if (isLiveId !== isLiveKey) return err(400, 'Mismatch Live/Test tra chiave Stripe e Session ID');

    const s = await stripe.checkout.sessions.retrieve(session_id);
    if (s.mode !== 'payment') return err(400, 'Sessione non di pagamento');
    if (s.payment_status !== 'paid') return err(409, 'Pagamento non acquisito');

    const piId = String(s.payment_intent || '');
    if (!piId) return err(400, 'Payment Intent assente');

    const pi = await stripe.paymentIntents.retrieve(piId);
    if (pi.metadata && pi.metadata.colpamiaCredited === 'true') {
      return ok({ ok: true, credited: false, reason: 'già accreditato' });
    }

    const emailSession = (s.customer_details && s.customer_details.email) || s.customer_email || null;
    const email = normalizeEmail(emailSession || (isEmail(email_fallback) ? email_fallback : ''));
    if (!email) return err(400, 'Email assente/illeggibile');

    const items = await stripe.checkout.sessions.listLineItems(session_id, { limit: 100, expand: ['data.price.product'] });

    const { processLineItems } = safeRequire('./fulfillment') || {};
    let minutes = 0, excuses = [];
    if (typeof processLineItems === 'function') {
      const need = needFromSession(s);
      const firstName = (s.customer_details?.name || email.split('@')[0] || 'Ciao').split(' ')[0];
      const out = await processLineItems(items.data, { first_name: firstName, need, email });
      minutes = Number(out.minutes || 0);
      excuses = Array.isArray(out.excuses) ? out.excuses : [];
    } else {
      // Fallback: solo minuti da PRICE_MINUTES_JSON o metadata.minutes
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

    if (minutes > 0) {
      try {
        const wallet = safeRequire('./wallet');
        if (wallet && typeof wallet.creditMinutes === 'function') {
          await wallet.creditMinutes(email, minutes, { phone, session_id, piId });
        }
      } catch {}
    }

    await stripe.paymentIntents.update(piId, {
      metadata: { ...(pi.metadata || {}), colpamiaCredited: 'true', minutesCredited: String(minutes||0), excusesCount: String(excuses.length||0) }
    });

    return ok({ ok: true, credited: minutes > 0, email, minutes, excuses });
  } catch (e) {
    return err(500, e.message || 'Errore interno');
  }
};
