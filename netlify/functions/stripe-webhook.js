// netlify/functions/stripe-webhook.js
import Stripe from 'stripe';
import { get, set } from '@netlify/blobs';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const STORE = 'colpamia';
const KEY   = 'wallets.json';

async function loadWallets() {
  return (await get({ name: KEY, type: 'json', store: STORE })) || {};
}
async function saveWallets(w) {
  await set({
    name: KEY,
    data: JSON.stringify(w),
    store: STORE,
    contentType: 'application/json'
  });
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const sig = event.headers['stripe-signature'];
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64')
    : Buffer.from(event.body || '', 'utf8');

  let evt;
  try {
    evt = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (evt.type === 'checkout.session.completed') {
    const s = evt.data.object;

    // Email normalizzata
    const email = (s.customer_details?.email || '').trim().toLowerCase();

    // Minuti per il wallet (inseriti in create-checkout-session come metadata.minutes)
    const minutes = Number(s.metadata?.minutes || 0);

    if (email && !isNaN(minutes) && minutes > 0) {
      const wallets = await loadWallets();
      const current = Number(wallets[email] || 0);
      wallets[email] = current + minutes;
      await saveWallets(wallets);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
