import Stripe from 'stripe';

const stripeKey = process.env.STRIPE_SECRET_KEY;

export async function handler(event) {
  if (!stripeKey) {
    return { statusCode: 200, body: JSON.stringify({ error: "Manca STRIPE_SECRET_KEY (vai su Netlify → Site settings → Environment)" })};
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  const { price_eur = 1, success = '/success.html', cancel = '/cancel.html' } = JSON.parse(event.body || '{}');

  try {
    const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });
    const site = process.env.SITE_URL || (event.headers['x-forwarded-proto'] ? `${event.headers['x-forwarded-proto']}://${event.headers.host}` : '');

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: site + success,
      cancel_url: site + cancel,
      line_items: [{
        price_data: { currency: 'eur', product_data: { name: 'Credito minuti' }, unit_amount: Math.max(50, Math.round(price_eur*100)) },
        quantity: 1,
      }]
    });

    return { statusCode: 200, body: JSON.stringify({ url: session.url })};
  } catch (err) {
    return { statusCode: 200, body: JSON.stringify({ error: err.message })};
  }
}
