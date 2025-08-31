// netlify/functions/stripe-webhook.js
// Accredita minuti al completamento checkout + invia email di conferma (Resend)

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM    = process.env.RESEND_FROM || 'no-reply@example.com';
const SITE_URL       = process.env.SITE_URL || process.env.URL || 'http://localhost:8888';

// --- helper store minuti ---
async function getBalance(email) {
  const store = getStore('balances'); // spazio nomi
  const raw = await store.get(email);
  if (!raw) return { minutes: 0, history: [] };
  try { return JSON.parse(raw); } catch { return { minutes: 0, history: [] }; }
}
async function setBalance(email, data) {
  const store = getStore('balances');
  await store.set(email, JSON.stringify(data));
}

// --- invio email con Resend ---
async function sendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) return;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [to],
      subject,
      html
    })
  });
  if (!res.ok) {
    const txt = await res.text().catch(()=>'');
    console.error('Resend error:', res.status, txt);
  }
}

exports.handler = async (event) => {
  // Verifica firma Stripe
  const sig = event.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let evt;
  try {
    evt = stripe.webhooks.constructEvent(
      event.body,
      sig,
      endpointSecret
    );
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (evt.type === 'checkout.session.completed') {
    try {
      // Recupero sessione con prodotti espansi per leggere metadata.minutes e sku
      const session = await stripe.checkout.sessions.retrieve(evt.data.object.id, {
        expand: ['line_items.data.price.product']
      });

      const email = session.customer_details?.email || session.customer_email;
      if (!email) {
        console.warn('Checkout completed senza email, salto accredito');
        return { statusCode: 200, body: 'ok' };
      }

      // Somma minuti dai metadata del prodotto
      let totalMinutes = 0;
      for (const li of (session.line_items?.data || [])) {
        const product = li.price?.product;
        const md = product?.metadata || {};
        const mins = parseInt(md.minutes || '0', 10);
        const qty = li.quantity || 1;
        if (mins > 0) totalMinutes += mins * qty;
      }

      // Aggiorna saldo
      const bal = await getBalance(email);
      bal.minutes = (bal.minutes || 0) + totalMinutes;
      bal.history = bal.history || [];
      bal.history.push({
        ts: Date.now(),
        type: 'add',
        delta: totalMinutes,
        reason: 'Acquisto via Stripe',
        session_id: session.id
      });
      await setBalance(email, bal);

      // Email di conferma
      const walletLink  = `${SITE_URL}/wallet.html?email=${encodeURIComponent(email)}`;
      const premiumLink = `${SITE_URL}/index.html#premium?email=${encodeURIComponent(email)}`;
      await sendEmail({
        to: email,
        subject: `Colpa Mia — accreditati ${totalMinutes} minuti`,
        html: `
          <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial">
            <h2>Grazie! 🎉</h2>
            <p>Abbiamo accreditato <strong>${totalMinutes} minuti</strong> sul tuo wallet.</p>
            <p>
              <a href="${walletLink}">Vedi saldo</a> — 
              <a href="${premiumLink}">Sblocca i Premium</a>
            </p>
            <p style="color:#666">Hai pagato in sicurezza con Stripe.</p>
          </div>
        `
      });

    } catch (e) {
      console.error('Webhook processing error:', e);
      return { statusCode: 500, body: 'webhook error' };
    }
  }

  return { statusCode: 200, body: 'ok' };
};

// Netlify richiede il body grezzo per la verifica firma
exports.config = { path: '/.netlify/functions/stripe-webhook', bodyParser: false };
