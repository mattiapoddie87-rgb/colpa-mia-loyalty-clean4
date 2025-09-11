// netlify/functions/stripe-webhook.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

// Generatore testo scuse (già presente nel tuo repo)
const { buildExcuse } = require('./ai-excuse'); // deve esportare buildExcuse({ kind, context })

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  let payload = event.body;

  try {
    const evt = stripe.webhooks.constructEvent(
      payload,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    // Gestiamo SOLO il completamento del checkout pagato
    if (evt.type !== 'checkout.session.completed') {
      return { statusCode: 200, body: 'ignored' };
    }

    const session = evt.data.object;

    // Sicurezza: elaboriamo una sola volta
    if (session.payment_status !== 'paid') {
      return { statusCode: 200, body: 'not_paid' };
    }

    const sku = session.client_reference_id || session.metadata?.sku || '';
    const minutesToAdd = parseInt(session.metadata?.minutes || '0', 10) || 0;

    const email = (session.customer_details?.email || '').toLowerCase();
    const customerId = session.customer;

    // 1) WALLET: somma minuti sul Customer.metadata.wallet_minutes (case-insensitive)
    if (customerId) {
      const cust = await stripe.customers.retrieve(customerId);
      const current = parseInt((cust.metadata?.wallet_minutes || '0'), 10) || 0;
      const next = current + (minutesToAdd > 0 ? minutesToAdd : 0);
      if (next !== current) {
        await stripe.customers.update(customerId, {
          metadata: { ...cust.metadata, wallet_minutes: String(next) }
        });
      }
    }

    // 2) INVIO SCUSA automatica SOLO per gli SKU “SCUSA_*” e per Connessione/Traffico/Riunione
    const isPersonalPackage = sku.startsWith('COLPA_'); // nessun invio automatico
    if (!isPersonalPackage && email) {
      // determina contesto: dal campo custom o dall'hint
      let context = session.metadata?.context_hint || '';
      if (Array.isArray(session.custom_fields)) {
        const f = session.custom_fields.find(x => x.key === 'need');
        if (f?.text?.value) context = f.text.value;
      }

      // mappa semplice “kind” per il generatore
      let kind = 'base';
      if (sku === 'SCUSA_DELUXE') kind = 'deluxe';
      if (sku === 'CONNESSIONE') kind = 'conn';
      if (sku === 'TRAFFICO') kind = 'traffico';
      if (sku === 'RIUNIONE') kind = 'riunione';

      const { subject, lines } = await buildExcuse({ kind, context });

      const html = `
        <h2>La tua Scusa</h2>
        <ol>${lines.map(l => `<li>${l}</li>`).join('')}</ol>
        <p><small>Accreditati ${minutesToAdd} minuti sul tuo wallet.</small></p>
      `;

      await resend.emails.send({
        from: 'COLPA MIA <no-reply@colpamia.com>',
        to: email,
        reply_to: 'colpamiaconsulenze@proton.me',
        subject: subject || 'La tua Scusa — COLPA MIA',
        html
      });
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('webhook_error', err);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }
};
