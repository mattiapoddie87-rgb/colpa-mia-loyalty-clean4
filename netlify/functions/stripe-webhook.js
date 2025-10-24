/**
 * Stripe webhook → invia email con la STESSA scusa di post-checkout.
 * Eventi: checkout.session.completed
 * ENV: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY, MAIL_FROM, (URL|SITE_URL)
 */
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const MAIL_FROM = process.env.MAIL_FROM || 'COLPA MIA <no-reply@colpamia.com>';

function ok(b){return {statusCode:200,body:JSON.stringify(b||{ok:true})}}
function bad(s,b){return {statusCode:s,body:JSON.stringify(b)}}
function clean(s){return (s||'').toString().trim().replace(/\s+/g,' ')}

async function fetchFinalExcuse(sessionId){
  const base = process.env.URL || process.env.SITE_URL || 'https://colpamia.com';
  const r = await fetch(`${base}/.netlify/functions/post-checkout?session_id=${encodeURIComponent(sessionId)}`);
  const d = await r.json();
  if(!r.ok) throw new Error(d.error||'post-checkout error');
  return { text: d.excuse || d.message || '', meta: d.metadata || {} };
}

function emailHtml({title,context,tone,text}){
  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;color:#0b0f16">
    <h2 style="margin:0 0 8px">La tua scusa è pronta</h2>
    <p style="margin:0 0 6px"><strong>Prodotto:</strong> ${title}</p>
    <p style="margin:0 0 6px"><strong>Contesto:</strong> ${context||'-'}</p>
    <p style="margin:0 0 12px"><strong>Tono:</strong> ${tone||'-'}</p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:12px 0">
    <p style="white-space:pre-wrap;line-height:1.5">${(text||'').replace(/</g,'&lt;')}</p>
  </div>`;
}

exports.handler = async (event) => {
  try{
    if(event.httpMethod!=='POST') return bad(405,{error:'Method not allowed'});
    const sig = event.headers['stripe-signature'];
    if(!sig) return bad(400,{error:'Missing signature'});
    let evt;
    try{
      evt = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    }catch(e){ return bad(400,{error:'Invalid signature'}) }

    if(evt.type !== 'checkout.session.completed') return ok({skipped:true});

    const sess = evt.data.object;
    const sessionId = sess.id;
    const toEmail = sess.customer_details?.email || sess.customer_email;
    const title   = clean(sess.metadata?.title || sess.metadata?.sku || 'COLPA MIA');
    const context = clean(sess.metadata?.context);
    const tone    = clean(sess.metadata?.tone || 'empatica');

    if(!toEmail) return ok({noEmail:true});

    const { text } = await fetchFinalExcuse(sessionId);

    if(!process.env.RESEND_API_KEY) return bad(500,{error:'RESEND_API_KEY missing'});
    await resend.emails.send({
      from: MAIL_FROM,
      to: toEmail,
      subject: `La tua scusa ${title}`,
      html: emailHtml({title,context,tone,text})
    });

    return ok({sent:true,to:toEmail});
  }catch(e){
    return bad(500,{error:e.message});
  }
};
