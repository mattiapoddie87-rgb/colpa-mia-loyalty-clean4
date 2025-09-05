// netlify/functions/session-email.js
// Recupero dati da Checkout Session + generazione scuse via ai-excuse + invio email

const Stripe = require('stripe');
const { Resend } = require('resend');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const ORIGIN = (process.env.SITE_URL || 'https://colpamia.com').replace(/\/+$/,'');
const MAIL_FROM = process.env.RESEND_FROM || process.env.MAIL_FROM || 'COLPA MIA <onboarding@resend.dev>';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const j = (s,b,h={}) => ({ statusCode:s, headers:{'Content-Type':'application/json', ...CORS, ...h}, body:JSON.stringify(b) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return j(204,{});
  if (event.httpMethod !== 'POST')   return j(405,{ error:'method_not_allowed' });

  let body={}; try { body = JSON.parse(event.body||'{}'); } catch { return j(400,{ error:'bad_json' }); }
  const sessionId = String(body.session_id||'').trim();
  if (!sessionId) return j(400,{ error:'missing_session_id' });

  try {
    // 1) Prendo la sessione Stripe (live)
    const s = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['line_items.data.price.product'] });

    // email destinazione (fallback da body)
    const to = (s.customer_details?.email || s.customer_email || body.email || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return j(400,{ error:'missing_or_invalid_email' });

    // 2) Estraggo il "need" dal custom field del checkout
    let need = '';
    const cfs = Array.isArray(s.custom_fields) ? s.custom_fields : [];
    for (const cf of cfs) if ((cf.key||'').toLowerCase()==='need' && cf?.text?.value) need = String(cf.text.value).trim();

    // 3) Chiamo l’engine locale /ai-excuse (usa OPENAI_API_KEY)
    let variants = [];
    try {
      const r = await fetch(`${ORIGIN}/.netlify/functions/ai-excuse`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ need, style:'neutro', persona:'generico', locale:'it-IT', maxLen:300 })
      });
      const data = await r.json().catch(()=> ({}));
      variants = Array.isArray(data?.variants) ? data.variants.slice(0,3) : [];
    } catch {}

    // 4) Preparo HTML (sempre con almeno un fallback leggibile)
    const blocks = (variants.length ? variants : [{
      whatsapp_text: 'Imprevisto ora, sto riorganizzando. Ti aggiorno entro le 18.',
      sms: 'Imprevisto ora, sto riorganizzando. Aggiorno a breve.',
      email_body: 'È sopraggiunto un imprevisto: ti mando un nuovo orario affidabile entro le 18.',
      email_subject:'Aggiornamento sui tempi'
    }]).map((v,i)=>`
      <p style="margin:10px 0; padding:12px; background:#f6f7fb; border-radius:10px;">
        <b>${i+1})</b> ${v.whatsapp_text || v.sms || v.email_body}
      </p>
    `).join('');

    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;line-height:1.45">
        <h2 style="margin:0 0 12px">La tua scusa</h2>
        ${blocks}
        <p style="font-size:12px;color:#666;margin-top:16px">
          Suggerimento: copia la variante che preferisci e incollala nel canale giusto.
        </p>
      </div>`;

    // 5) Invia email (best-effort, non blocca la risposta)
    let emailSent = false, reason = null;
    const key = (process.env.RESEND_API_KEY || '').trim();
    if (key) {
      try {
        const resend = new Resend(key);
        await resend.emails.send({
          from: MAIL_FROM,
          to, subject: 'La tua scusa è pronta ✅',
          html
        });
        emailSent = true;
      } catch (e) { reason = String(e?.message || 'send_error'); }
    } else {
      reason = 'no_resend_key';
    }

    return j(200, { ok:true, emailSent, reason, variantsCount: variants.length });
  } catch (err) {
    return j(500,{ error:String(err?.message || 'session_email_error') });
  }
};
