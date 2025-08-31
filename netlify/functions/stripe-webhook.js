// netlify/functions/stripe-webhook.js
// CommonJS – compatibile con il tuo progetto
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getStore } = require('@netlify/blobs');
const { sendEmail, sendPhone } = require('./send-utils.js');

const SITE_URL = process.env.SITE_URL || process.env.URL || 'http://localhost:8888';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// Helpers saldo (stesso spazio usato per wallet/redeem)
async function getBalance(email) {
  const store = getStore('balances');
  const raw = await store.get(email);
  if (!raw) return { minutes: 0, history: [] };
  try { return JSON.parse(raw); } catch { return { minutes: 0, history: [] }; }
}
async function setBalance(email, data) {
  const store = getStore('balances');
  await store.set(email, JSON.stringify(data));
}

// Helper oggetto email
function makeSubject(sku, fields = {}) {
  switch (sku) {
    case 'TRAFFICO': {
      const m = fields.minuti ? `(${fields.minuti}’) ` : '';
      return `Arrivo in ritardo ${m}- traffico`;
    }
    case 'CONN_KO':      return 'Connessione non disponibile — aggiornamento';
    case 'RIUNIONE':     return 'Riunione spostata/aggiornata';
    case 'SCUSA_DELUXE': return 'Richiesta di rinvio / aggiornamento';
    case 'SCUSA_TRIPLA': return 'Aggiornamento disponibilità';
    default:             return 'Aggiornamento rapido';
  }
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));
}

// Netlify richiede body grezzo per la firma
exports.config = { path: '/.netlify/functions/stripe-webhook', bodyParser: false };

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let stripeEvent;
  try {
    const sig = event.headers['stripe-signature'];
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    try {
      // 1) Recupera sessione con prodotti espansi (per metadata.minutes)
      const session = await stripe.checkout.sessions.retrieve(stripeEvent.data.object.id, {
        expand: ['line_items.data.price.product']
      });

      // 2) Accredito minuti (Product.metadata.minutes * qty)
      const email = session.customer_details?.email || session.customer_email || null;
      if (email) {
        let totalMinutes = 0;
        for (const li of (session.line_items?.data || [])) {
          const product = li.price?.product;
          const md = product?.metadata || {};
          const mins = parseInt(md.minutes || '0', 10);
          const qty = li.quantity || 1;
          if (mins > 0) totalMinutes += mins * qty;
        }

        if (totalMinutes > 0) {
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

          // Email di conferma (se RESEND_* configurati in env)
          const walletLink  = `${SITE_URL}/wallet.html?email=${encodeURIComponent(email)}`;
          const premiumLink = `${SITE_URL}/index.html#premium?email=${encodeURIComponent(email)}`;
          await sendEmail(email, `Colpa Mia — accreditati ${totalMinutes} minuti`, `
            <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial">
              <h2>Grazie! 🎉</h2>
              <p>Abbiamo accreditato <strong>${totalMinutes} minuti</strong> sul tuo wallet.</p>
              <p>
                <a href="${walletLink}">Vedi saldo</a> — 
                <a href="${premiumLink}">Sblocca i Premium</a>
              </p>
              <p style="color:#666">Pagamento sicuro con Stripe.</p>
            </div>
          `);
        }
      }

      // 3) Invio SCUSA se proviene dal Motore AI (metadata.draft_id)
      const meta = session.metadata || {};
      const sku  = session.client_reference_id || 'SCUSA_BASE';
      if (meta.draft_id) {
        const drafts = getStore('drafts');
        const raw = await drafts.get(meta.draft_id);
        const d = raw ? JSON.parse(raw) : null;

        if (d && d.status === 'reserved') {
          // Usa il testo salvato nel draft (rigenerazione facoltativa)
          const text = d.draft;
          const subject = makeSubject(sku, d.fields || {});

          let sent = false; const errors = [];

          // Canale preferito: telefono → WhatsApp/SMS
          if (d.channel === 'phone' && d.phone) {
            const r = await sendPhone(d.phone, text);
            sent = r.ok; if (!r.ok) errors.push(r.error || 'sendPhone failed');
          }
          // Email di backup o fallback
          if (d.email && !sent) {
            const html = text.split('\n').map(p => `<p>${escapeHtml(p)}</p>`).join('');
            const r = await sendEmail(d.email, subject, html);
            sent = r.ok; if (!r.ok) errors.push(r.error || 'sendEmail failed');
          }

          // marca draft come inviato (anche se solo email)
          await drafts.set(meta.draft_id, JSON.stringify({
            ...d,
            status: 'sent',
            sent_at: Date.now(),
            sid: session.id,
            errors
          }));
        }
      }

    } catch (e) {
      console.error('Webhook processing error:', e);
      return { statusCode: 500, body: 'webhook error' };
    }
  }

  return { statusCode: 200, body: 'ok' };
};
