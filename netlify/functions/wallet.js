// netlify/functions/wallet.js
// Sorgente unica di verità: metadata del Customer Stripe.
// Espone: creditMinutes(email, minutes, meta?) e getBalance(email).

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

function normalizeEmail(e) { return String(e || '').trim().toLowerCase(); }

function tierFromPoints(points) {
  if (points >= 300) return 'Platinum';
  if (points >= 150) return 'Gold';
  if (points >= 60)  return 'Silver';
  if (points >= 1)   return 'Bronze';
  return 'None';
}

async function findOrCreateCustomerByEmail(email, extras = {}) {
  email = normalizeEmail(email);
  let customer = null;

  // Prova ricerca (più affidabile)
  try {
    const r = await stripe.customers.search({ query: `email:"${email}"`, limit: 1 });
    customer = r.data[0] || null;
  } catch (_) { /* fallback su list sotto */ }

  if (!customer) {
    const r2 = await stripe.customers.list({ email, limit: 1 });
    customer = r2.data[0] || null;
  }
  if (!customer) {
    customer = await stripe.customers.create({ email, ...extras });
  }
  return customer;
}

// Accredita minuti e aggiorna punti (1 punto = 1 minuto). Idempotenza gestita a monte (PI metadata).
async function creditMinutes(email, minutes, meta = {}) {
  email = normalizeEmail(email);
  minutes = Math.max(0, parseInt(minutes, 10) || 0);
  if (!email || !minutes) throw new Error('Parametri non validi (email/minuti)');

  const customer = await findOrCreateCustomerByEmail(email, { phone: meta.phone });

  const currentMin = parseInt(customer.metadata?.minutes || '0', 10) || 0;
  const currentPts = parseInt(customer.metadata?.points  || '0', 10) || 0;

  const newMin = currentMin + minutes;
  const newPts = currentPts + minutes;

  const newMeta = { ...(customer.metadata || {}), minutes: String(newMin), points: String(newPts) };
  // Briciole di audit leggere (non sono uno storico vero e proprio)
  if (meta.session_id) newMeta[`s_${String(meta.session_id).slice(0, 12)}`] = String(minutes);
  if (meta.piId)       newMeta[`pi_${String(meta.piId).slice(0, 12)}`]       = String(minutes);

  await stripe.customers.update(customer.id, {
    metadata: newMeta,
    ...(meta.phone ? { phone: meta.phone } : {})
  });

  return { customer_id: customer.id, email, minutes: newMin, points: newPts, tier: tierFromPoints(newPts) };
}

async function getBalance(email) {
  email = normalizeEmail(email);
  let customer = null;

  try {
    const r = await stripe.customers.search({ query: `email:"${email}"`, limit: 1 });
    customer = r.data[0] || null;
  } catch (_) {
    const r2 = await stripe.customers.list({ email, limit: 1 });
    customer = r2.data[0] || null;
  }

  if (!customer) {
    return { email, minutes: 0, points: 0, tier: 'None', history: [] };
  }

  const minutes = parseInt(customer.metadata?.minutes || '0', 10) || 0;
  const points  = parseInt(customer.metadata?.points  || '0', 10) || 0;

  // Storico leggero: ultimi PaymentIntent riusciti del customer
  const pis = await stripe.paymentIntents.list({ customer: customer.id, limit: 10 });
  const history = pis.data
    .filter(pi => pi.status === 'succeeded')
    .map(pi => ({
      id: pi.id,
      amount: pi.amount,          // in centesimi
      currency: pi.currency,
      created: pi.created,        // epoch seconds
      description: pi.description || null
    }));

  return { email, minutes, points, tier: tierFromPoints(points), history };
}

module.exports = { creditMinutes, getBalance, normalizeEmail };
