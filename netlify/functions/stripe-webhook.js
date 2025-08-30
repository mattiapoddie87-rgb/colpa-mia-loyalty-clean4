// netlify/functions/stripe-webhook.js
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  try {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if(!secret) return { statusCode: 400, body: 'Missing STRIPE_WEBHOOK_SECRET' };
    const evt = stripe.webhooks.constructEvent(event.body, sig, secret);

    if (evt.type === 'checkout.session.completed') {
      const s = evt.data.object;
      console.log('✔ checkout.session.completed', {
        customer: s.customer,
        email: s.customer_details?.email,
        minutes: s.metadata?.minutes,
        amount: s.amount_total
      });
    }
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (e) {
    console.error('Webhook error:', e.message);
    return { statusCode: 400, body: `Webhook error: ${e.message}` };
  }
};
