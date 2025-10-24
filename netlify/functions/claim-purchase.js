/**
 * Invia via email ESATTAMENTE la scusa generata e mostrata sul web
 * da /.netlify/functions/post-checkout?session_id=...
 * Niente AI qui. Nessun template locale. Nessuna divergenza possibile.
 *
 * ENV: STRIPE_SECRET_KEY, RESEND_API_KEY, MAIL_FROM, (URL|SITE_URL)
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const MAIL_FROM = process.env.MAIL_FROM || 'COLPA MIA <no-reply@colpamia.com>';

function clean(s){ return (s||'').toString().trim().replace(/\s+/g,' '); }

async function fetchFinal(sessionId){
  const base = process.env.URL || process.env.SITE_URL || 'https://colpamia.com';
  const url  = `${base}/.netlify/functions/post-checkout?session_id=${encodeURIComponent(sessionId)}`;
  const r = await fetch(url);
  const data = await r.json();
  if(!r.ok) throw new Error(data.error || 'Errore post-checkout');
  // Preferisce "excuse", fallback "message"
  return { text: data.excuse || data.message || '', meta: data.metadata || {} };
}

function buildEmailHtml({ title, context, tone, text }){
  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;color:#0b0f16">
    <h2 style="margin:0 0 8px">La tua scusa è pronta</h2>
    <p style="margin:0 0 6px"><strong>Prodotto:</strong> ${title}</p>
    <p style="margin:0 0 6px"><strong>Contesto:</strong> ${context || '-'}</p>
    <p style="margin:0 0 12px"><strong>Tono:</strong> ${tone || '-'}</p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:12px 0">
    <p style="white-space:pre-wrap;line-height:1.5">${(text||'').replace(/</g,'&lt;')}</p>
  </div>`;
}

exports.handler = async (event) => {
  try{
    if(event.httpMethod !== 'POST')
      return { statusCode:405, body: JSON.stringify({ error:'Method not allowed' }) };

    const { session_id } = JSON.parse(event.body || '{}');
    if(!session_id)
      return { statusCode:400, body: JSON.stringify({ error:'session_id mancante' }) };

    // 1) Prendi la sessione Stripe per destinatario e metadata originali
    const sess = await stripe.checkout.sessions.retrieve(session_id, { expand: ['line_items'] });
    const toEmail = sess.customer_details?.email || sess.customer_email;
    if(!toEmail) return { statusCode:400, body: JSON.stringify({ error:'email non disponibile' }) };

    const sku     = clean(sess.metadata?.sku);
    const title   = clean(sess.metadata?.title) || sku;
    const context = clean(sess.metadata?.context); // <- vero contesto scelto (CENA/WORK/EVENTO/…)
    const tone    = clean(sess.metadata?.tone || 'empatica');

    // 2) Recupera ESATTAMENTE il testo usato sul web
    const { text } = await fetchFinal(session_id);

    // 3) Componi e invia email
    if(!process.env.RESEND_API_KEY)
      return { statusCode:500, body: JSON.stringify({ error:'RESEND_API_KEY mancante' }) };

    const html = buildEmailHtml({ title, context, tone, text });
    await resend.emails.send({ from: MAIL_FROM, to: toEmail, subject: `La tua scusa ${title}`, html });

    return { statusCode:200, body: JSON.stringify({ ok:true, to: toEmail, sku }) };
  }catch(err){
    return { statusCode:500, body: JSON.stringify({ error: err.message }) };
  }
};
