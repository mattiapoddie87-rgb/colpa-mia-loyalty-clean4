// netlify/functions/stripe-webhook.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const crypto = require('crypto');

// --- Email (Resend) ---
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM = process.env.RESEND_FROM || process.env.MAIL_FROM || 'COLPA MIA <no-reply@colpamia.com>';
async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY missing');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: RESEND_FROM, to, subject, html })
  });
  if (!r.ok) throw new Error('Resend failed: ' + (await r.text()).slice(0,200));
}

// --- AI (OpenAI) con fallback locale ---
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
async function genExcuses({ kind, need, minutes }) {
  // fallback locale se niente API
  const base = [
    `Mi dispiace, ho avuto un imprevisto (${kind}). Arrivo appena possibile.`,
    `Scusa il ritardo, sto gestendo un contrattempo (${kind}). Ti aggiorno tra poco.`,
    `Ti chiedo pazienza: situazione imprevista (${kind}). `
  ];
  if (!OPENAI_API_KEY) return base;

  const prompt = [
    `Genera 3 scuse naturali e convincenti, tono credibile, 1-2 frasi ciascuna.`,
    `Contesto: tipo=${kind}; esigenza="${need||''}".`,
    `Non nominare l'AI. Niente eccessi.`,
  ].join('\n');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.8
    })
  });
  if (!res.ok) return base;
  const data = await res.json();
  const txt = data.choices?.[0]?.message?.content || '';
  const items = txt.split('\n').map(s=>s.replace(/^\d+[\)\.\-]\s*/,'').trim()).filter(Boolean).slice(0,3);
  return items.length ? items : base;
}

// --- mapping minuti ---
function safeJson(s){ try{ return s?JSON.parse(s):null } catch { return null } }
const RULES = safeJson(process.env.PRICE_RULES_JSON) || {};

function minutesFromLineItem(li) {
  const priceId = li?.price?.id;
  if (priceId && RULES[priceId]?.minutes) return Number(RULES[priceId].minutes)||0;
  const metaMin = parseInt(li?.price?.metadata?.minutes || li?.price?.product?.metadata?.minutes || '0',10) || 0;
  return metaMin;
}

function kindFromLineItem(li) {
  const priceId = li?.price?.id;
  const k = priceId && RULES[priceId]?.excuse;
  return (k || li?.price?.metadata?.excuse || li?.price?.product?.metadata?.excuse || 'base').toLowerCase();
}

function htmlEmail({ excuses, minutes }) {
  return `
  <div style="font-family:system-ui,sans-serif;line-height:1.5">
    <h2>La tua Scusa è pronta ✅</h2>
    <p>Hai ricevuto <b>${minutes}</b> minuti nel tuo wallet.</p>
    <ol>
      ${excuses.map(e=>`<li>${e}</li>`).join('')}
    </ol>
    <p style="margin-top:16px">Grazie da COLPA MIA.</p>
  </div>`;
}

exports.handler = async (event) => {
  // Stripe signature check
  const sig = event.headers['stripe-signature'];
  if (!sig) return { statusCode: 400, body: 'Missing Stripe-Signature' };
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return { statusCode: 500, body: 'STRIPE_WEBHOOK_SECRET not set' };

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, secret);
  } catch (e) {
    return { statusCode: 400, body: `Signature error: ${e.message}` };
  }

  // Solo checkout.session.completed
  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: 'ignored' };
  }

  try {
    const session = stripeEvent.data.object;
    const sessionId = session.id;
    const piId = session.payment_intent;
    if (!piId) return { statusCode: 200, body: 'no payment_intent' };

    const pi = await stripe.paymentIntents.retrieve(piId);
    const alreadyCredited = pi.metadata?.colpamiaCredited === 'true';
    const emailSent = pi.metadata?.colpamiaEmailSent === 'true';
    const email = (session.customer_details?.email || session.customer_email || '').toLowerCase();

    // Line items (per minuti/tipo scusa)
    const items = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 100, expand: ['data.price.product'] });
    let minutes = 0; let kind = 'base';
    for (const li of items.data) {
      minutes += minutesFromLineItem(li) * (li.quantity || 1);
      if (kind === 'base') kind = kindFromLineItem(li);
    }

    // Se già accreditato ma mail non inviata -> invia solo mail
    if (alreadyCredited && !emailSent) {
      const excuses = await genExcuses({ kind, need: session.custom_fields?.find?.(f=>f.key==='need')?.text?.value, minutes });
      await sendEmail(email, 'La tua Scusa è pronta', htmlEmail({ excuses, minutes }));
      await stripe.paymentIntents.update(piId, { metadata: { ...pi.metadata, colpamiaEmailSent: 'true' } });
      return { statusCode: 200, body: 'resent email only' };
    }

    // Se non accreditato -> accredita + mail
    if (!alreadyCredited) {
      // accredito nel tuo sistema (se esiste)
      try {
        const wallet = require('./wallet');
        if (wallet?.creditMinutes) {
          await wallet.creditMinutes(email, minutes, { sessionId, piId, kind });
        }
      } catch(_) {}

      const excuses = await genExcuses({ kind, need: session.custom_fields?.find?.(f=>f.key==='need')?.text?.value, minutes });
      await sendEmail(email, 'La tua Scusa è pronta', htmlEmail({ excuses, minutes }));

      await stripe.paymentIntents.update(piId, {
        metadata: {
          ...(pi.metadata || {}),
          colpamiaCredited: 'true',
          minutesCredited: String(minutes),
          colpamiaEmailSent: 'true',
          emailUsed: email
        }
      });

      return { statusCode: 200, body: 'credited + mailed' };
    }

    // già accreditato e mail già inviata → niente da fare
    return { statusCode: 200, body: 'already credited & mailed' };

  } catch (err) {
    return { statusCode: 500, body: 'Webhook error: ' + (err.message || String(err)) };
  }
};
