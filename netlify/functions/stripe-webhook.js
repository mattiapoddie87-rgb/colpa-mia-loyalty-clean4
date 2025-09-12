// Webhook Stripe: invio email certo. Se invio fallisce → 500 per retry.
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

async function getBlobsStore() {
  try {
    const token = process.env.NETLIFY_BLOBS_TOKEN;
    const siteID = process.env.NETLIFY_SITE_ID;
    if (!token || !siteID) return null;
    const { createClient } = await import('@netlify/blobs');
    return createClient({ token, siteID }).getStore('checkouts');
  } catch { return null; }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64')
                                   : Buffer.from(event.body || '', 'utf8');

  let evt;
  try {
    evt = stripe.webhooks.constructEvent(raw, sig, endpointSecret);
  } catch (err) {
    console.error('Firma Stripe non valida:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (evt.type === 'checkout.session.completed') {
    const session = evt.data.object;
    const store = await getBlobsStore();
    const dedupeKey = `mailed:${evt.id}`;

    // Skip se già inviata
    try { if (store && await store.get(dedupeKey)) { console.log('Skip email (già inviata):', evt.id); return { statusCode: 200, body: 'ok' }; } } catch {}

    // Destinatario
    let to = session?.customer_details?.email || session?.customer_email || session?.metadata?.email || null;
    if (!to && session?.customer) {
      try { const c = await stripe.customers.retrieve(session.customer); to = c?.email || null; }
      catch (e) { console.warn('Lookup customer email fallito:', e.message); }
    }

    // Line items (best-effort)
    let lineItems = [];
    try { const li = await stripe.checkout.sessions.listLineItems(session.id, { limit: 50 }); lineItems = li.data || []; }
    catch (e) { console.warn('Line items non disponibili:', e.message); }

    // Invio
    try {
      const { sendCheckoutEmail } = require('./session-email');
      console.log('Invio email →', { to, sessionId: session.id, evtId: evt.id });
      await sendCheckoutEmail({
        session,
        lineItems,
        overrideTo: to,
        replyTo: session?.customer_details?.email || undefined
      });
      if (store) await store.set(dedupeKey, '1'); // marca dopo successo
      console.log('Email marcata come inviata', { evtId: evt.id });
    } catch (e) {
      console.error('Invio email fallito:', e.message);
      // forza retry da Stripe
      return { statusCode: 500, body: 'email_send_failed' };
    }

    // Persistenza session opzionale
    try { if (store) await store.set(`${session.id}.json`, JSON.stringify(session)); } catch {}
  }

  return { statusCode: 200, body: 'ok' };
};
