// netlify/functions/session-email.js
import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

export async function handler(event) {
  try {
    const sid = event.queryStringParameters?.sid;
    if (!sid) return { statusCode: 400, body: 'sid mancante' };
    const s = await stripe.checkout.sessions.retrieve(sid);
    const email = s.customer_details?.email || s.customer_email || null;
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ email }),
    };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
}
