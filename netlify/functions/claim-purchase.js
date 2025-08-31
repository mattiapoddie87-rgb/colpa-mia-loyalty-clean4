// netlify/functions/claim-purchase.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const ok  = (b) => ({ statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const err = (c, m) => ({ statusCode: c, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: m }) });
const isEmail = x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(x||''));
const norm = s => String(s||'').trim().toLowerCase();
const safeRequire = p => { try { return require(p); } catch { return null; } };

function getField(s, key){
  const f = (Array.isArray(s.custom_fields) ? s.custom_fields : []).find(x => x?.key === key);
  return (f && f.text && f.text.value) ? String(f.text.value).trim() : '';
}

function signalsFromSession(s, email){
  return {
    first_name: (s.customer_details?.name || email.split('@')[0] || 'Ciao').split(' ')[0],
    recipient:  getField(s, 'recipient'),
    tone:       getField(s, 'tone'),
    need:       getField(s, 'need'),
    delay:      getField(s, 'delay')
  };
}

function renderEmail({ firstName, excuses, minutes }) {
  const blocks = (excuses||[]).map((e,i)=> `<div style="margin:10px 0;padding:12px;border:1px solid #eee;border-radius:10px">${e}</div>`).join('');
  const accredito = minutes>0 ? `<p style="margin-top:12px">Accreditati <b>${minutes} minuti</b> sul tuo wallet.</p>` : '';
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111">
      <p>Ciao ${firstName || 'Ciao'},</p>
      <h2 style="margin:0 0 8px 0;">La tua scusa</h2>
      ${blocks || '<p>Nessuna scusa generata.</p>'}
      ${accredito}
      <p style="margin-top:20px;font-size:12px;color:#666">Suggerimento: copia la variante che preferisci e incollala nel canale giusto.</p>
    </div>
  `;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };
    if (event.httpMethod !== 'POST') return err(405, 'Method Not Allowed');

    let body = {}; try { body = JSON.parse(event.body || '{}'); } catch {}
    let { session_id, email_fallback, phone } = body;
    session_id = String(session_id||'').replace(/\s/g,'');

    if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(session_id)) return err(400,'Session ID non valido');
    if (session_id.startsWith('cs_live_') !== String(process.env.STRIPE_SECRET_KEY||'').startsWith('sk_live_')) return err(400,'Mismatch Live/Test');

    const s  = await stripe.checkout.sessions.retrieve(session_id);
    if (s.mode !== 'payment') return err(400,'Sessione non di pagamento');
    if (s.payment_status !== 'paid') return err(409,'Pagamento non acquisito');

    const piId = String(s.payment_intent||''); if (!piId) return err(400,'Payment Intent assente');
    const pi   = await stripe.paymentIntents.retrieve(piId);
    if (pi.metadata?.colpamiaCredited === 'true') return ok({ ok:true, credited:false, reason:'già accreditato' });

    const emailSess = s.customer_details?.email || s.customer_email || null;
    const email = norm(emailSess || (isEmail(email_fallback) ? email_fallback : ''));
    if (!email) return err(400,'Email assente/illeggibile');

    const items = await stripe.checkout.sessions.listLineItems(session_id, { limit:100, expand:['data.price.product'] });

    const { processLineItems } = safeRequire('./fulfillment') || {};
    let minutes = 0, excuses = [];
    if (typeof processLineItems === 'function') {
      const sig = signalsFromSession(s, email);
      const out = await processLineItems(items.data, sig);
      minutes = Number(out.minutes||0);
      excuses = Array.isArray(out.excuses) ? out.excuses : [];
    }

    // accredito
    if (minutes > 0) {
      try {
        const wallet = safeRequire('./wallet');
        if (wallet?.creditMinutes) await wallet.creditMinutes(email, minutes, { phone, session_id, piId });
      } catch {}
    }

    // email
    let emailSent = false;
    try {
      const sender = safeRequire('./send-utils');
      if (sender?.sendEmail) {
        const firstName = (s.customer_details?.name || email.split('@')[0] || 'Ciao').split(' ')[0];
        const html = renderEmail({ firstName, excuses, minutes });
        const subject = excuses.length ? 'La tua scusa è pronta' : 'Accredito minuti confermato';
        const res = await sender.sendEmail(email, subject, html);
        emailSent = !!res.sent;
      }
    } catch {}

    // idempotenza
    await stripe.paymentIntents.update(piId, {
      metadata: {
        ...(pi.metadata || {}),
        colpamiaCredited: 'true',
        minutesCredited: String(minutes||0),
        excusesCount: String(excuses.length||0),
        colpamiaEmailSent: emailSent ? 'true' : 'false'
      }
    });

    return ok({ ok:true, credited: minutes>0, email, minutes, excuses, emailSent });
  } catch (e) {
    return err(500, e.message || 'Errore interno');
  }
};
