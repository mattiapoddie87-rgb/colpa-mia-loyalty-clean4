// Stripe Webhook -> invio email + salvataggio opzionale su Netlify Blobs
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

async function getBlobsStore() {
  try {
    const token = process.env.NETLIFY_BLOBS_TOKEN;
    const siteID = process.env.NETLIFY_SITE_ID;
    if (!token || !siteID) return null;
    const { createClient } = await import('@netlify/blobs');
    const client = createClient({ token, siteID });
    return client.getStore('checkouts');
  } catch {
    return null;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64')
    : Buffer.from(event.body || '', 'utf8');

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(raw, sig, endpointSecret);
  } catch (err) {
    console.error('Firma Stripe non valida:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;

    // 1) Persistenza NON bloccante
    try {
      const store = await getBlobsStore();
      if (store) await store.set(`${session.id}.json`, JSON.stringify(session));
    } catch (e) {
      console.warn('Scrittura Blobs saltata:', e.message);
    }

    // 2) Email al cliente
    try {
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 50 });
      const { sendCheckoutEmail } = require('./session-email');
      await sendCheckoutEmail({ session, lineItems: lineItems.data });
    } catch (e) {
      console.error('Invio email fallito:', e.message);
      // Non propagare. Il pagamento resta confermato, il webhook risponde 200.
    }
  }

  return { statusCode: 200, body: 'ok' };
};
