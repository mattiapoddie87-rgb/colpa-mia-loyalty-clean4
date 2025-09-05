// netlify/functions/session-email.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
const { Resend } = require('resend');
const resend = new Resend((process.env.RESEND_API_KEY || '').trim());
const MAIL_FROM = process.env.RESEND_FROM || process.env.MAIL_FROM || 'COLPA MIA <onboarding@resend.dev>';

function http(s,b){ return {statusCode:s, headers:{'Content-Type':'application/json'}, body:JSON.stringify(b)} }
function safeJSONEnv(k){ try{return JSON.parse(process.env[k]||'{}')}catch{return{}} }
const PRICE_RULES = safeJSONEnv('PRICE_RULES_JSON');

async function generateExcuses(context, productTag){
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  const payload = { need: context || productTag || 'ritardo', style:'neutro', persona: productTag||'generico', locale:'it-IT', maxLen:300 };
  if (apiKey){
    try{
      const r = await fetch(`${(process.env.SITE_URL || 'https://colpamia.com').replace(/\/+$/,'')}/.netlify/functions/ai-excuse`, {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
      });
      const data = await r.json().catch(()=> ({}));
      const v = (data?.variants||[]).map(x => String(x?.whatsapp_text || x?.sms || '').trim()).filter(Boolean);
      if (v.length) return v.slice(0,3);
    }catch{}
  }
  return [
    'Ho avuto un imprevisto serio e sto riorganizzando al volo. Arrivo più tardi del previsto; ti aggiorno tra poco.',
    'È saltata fuori una cosa urgente che non posso rimandare. Sto sistemando e ti scrivo appena ho chiaro l’orario.',
    'Situazione imprevista che mi blocca un attimo. Non voglio darti buca: mi prendo qualche minuto e ti aggiorno a breve.'
  ];
}

exports.handler = async (event)=>{
  try{
    const { session_id, email: emailIn, phone } = JSON.parse(event.body||'{}');
    if (!session_id) return http(400,{error:'missing_session_id'});

    const s = await stripe.checkout.sessions.retrieve(session_id, { expand:['line_items.data.price.product'] });
    const email = (emailIn || s.customer_details?.email || s.customer_email || '').toLowerCase();
    if (!email) return http(400,{error:'missing_email'});

    let minutes=0, tag='';
    for (const li of (s.line_items?.data || [])) {
      const rule = PRICE_RULES[li?.price?.id] || {};
      minutes += (Number(rule.minutes||0) * (li.quantity||1)) || 0;
      if (!tag && rule.excuse) tag = rule.excuse;
    }

    const need = (s.custom_fields || []).find(cf => (cf.key||'').toLowerCase()==='need');
    const variants = await generateExcuses(String(need?.text?.value||'').trim(), tag);

    if (resend){
      const html = `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111">
          <h2>La tua scusa</h2>
          ${variants.map(v=>`<p style="margin:10px 0;padding:12px;background:#f6f7fb;border-radius:10px">${v}</p>`).join('')}
          <p style="margin-top:16px">Accreditati (webhook in coda) <b>${minutes}</b> min.</p>
        </div>`;
      try{ await resend.emails.send({ from: MAIL_FROM, to: email, subject: 'La tua scusa — recovery', html }); }catch(e){ console.error('resend_recovery', e?.message||e); }
    }

    return http(200,{ ok:true, email, minutes, variantsCount: variants.length });
  }catch(e){
    return http(500,{error:String(e?.message||'session_email_error')});
  }
};
