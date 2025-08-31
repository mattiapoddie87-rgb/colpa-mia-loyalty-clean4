// netlify/functions/session-email.js
// GET ?session_id=cs_xxx  →  { email: "..." }
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  try {
    const { session_id } = event.queryStringParameters || {};
    if (!session_id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'missing session_id' }) };
    }
    const session = await stripe.checkout.sessions.retrieve(session_id);
    const email = session.customer_details?.email || session.customer_email || null;
    return { statusCode: 200, body: JSON.stringify({ email }) };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
