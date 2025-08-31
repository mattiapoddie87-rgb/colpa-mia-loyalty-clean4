// netlify/functions/stripe-webhook.js
import Stripe from 'stripe';
import { buffer } from 'micro';
import { createClient } from '@netlify/blobs';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
const SIGNING_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const blobs = createClient();

// Mappa SKU → minuti (coerente con shop)
const SKU_MINUTES = {
  SCUSA_BASE: 10,
  SCUSA_TRIPLA: 30,
  SCUSA_DELUXE: 60,
  RIUNIONE: 20,
  TRAFFICO: 20,
  CONN_KO: 20,
};

// Email via Resend (opzionale)
async function sendEmail({ to, minutes, siteUrl }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'Colpa Mia <noreply@localhost>';
  if (!apiKey || !to) return;

  const body = {
    from,
    to,
    subject: 'Grazie! Minuti accreditati ✔',
    html: `
      <h2>Pagamento confermato ✅</h2>
      <p>Abbiamo accreditato <b>${minutes} minuti</b> sul tuo Wallet.</p>
      <p><a href="${siteUrl}/wallet.html?email=${encodeURIComponent(to)}">Vedi saldo</a> — 
         <a href="${siteUrl}/index.html#premium">Sblocca Premium</a></p>
      <p>Grazie da <b>Colpa Mia</b> 🙌</p>
    `,
  };

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const sig = event.headers['stripe-signature'];
    const raw = Buffer.from(event.body || '', 'utf8');
    const evt = stripe.webhooks.constructEvent(raw, sig, SIGNING_SECRET);

    if (evt.type === 'checkout.session.completed') {
      const s = evt.data.object;

      const email =
        s.customer_details?.email || s.customer_email || null;
      const sku = s.client_reference_id || s.metadata?.sku;
      const minutes = SKU_MINUTES[sku] || Number(s.metadata?.minutes || 0);

      if (email && minutes) {
        const key = `u/${encodeURIComponent(email.toLowerCase())}.json`;
        const current = await blobs.get(key);
        const data = current ? JSON.parse(await current.text()) : { minutes: 0, history: [] };
        data.minutes = (data.minutes || 0) + minutes;
        data.history = data.history || [];
        data.history.push({ type: 'purchase', sku, minutes, ts: Date.now() });
        await blobs.set(key, JSON.stringify(data), { contentType: 'application/json' });

        // email di conferma (se configurata)
        await sendEmail({ to: email, minutes, siteUrl: process.env.SITE_URL || '' });
      }
    }

    return { statusCode: 200, body: 'ok' };
  } catch (e) {
    console.error(e);
    return { statusCode: 400, body: `Webhook Error: ${e.message}` };
  }
}
