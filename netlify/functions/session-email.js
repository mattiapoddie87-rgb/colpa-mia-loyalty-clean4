const { formatCurrency, safeString } = require('./session-info');
const { sendMail } = require('./send-utils');

function renderItems(items, currency) { /* invariato */ }

function buildEmail({ session, lineItems, overrideTo }) {
  const to = overrideTo || session?.customer_details?.email || session?.customer_email || session?.metadata?.email;
  if (!to) throw new Error('Email cliente assente.');

  const orderId = session.id;
  const currency = session.currency || 'eur';
  const gross = formatCurrency(session.amount_total || 0, currency);
  const paymentStatus = session.payment_status || 'paid';
  const brand = process.env.MAIL_BRAND || 'COLPA MIA';
  const itemsTable = renderItems(lineItems, currency);
  const summaryNote = (session.amount_total === 0) ? `<p style="margin:8px 0 0 0;color:#6b7280;">Ordine a totale 0 (sconto/coupon).</p>` : ``;

  const subject = `${brand} — Conferma ordine ${orderId.substring(0,8)}`;
  const html = `<div style="font-family:system-ui,Segoe UI,Arial;max-width:640px;margin:0 auto;color:#111827;">
    <h1 style="font-size:20px;margin:0 0 12px 0;">Conferma ordine</h1>
    <p style="margin:0 0 12px 0;">ID ordine: <strong>${orderId}</strong></p>
    <p style="margin:0 0 12px 0;">Stato pagamento: <strong>${paymentStatus}</strong></p>
    ${itemsTable}
    <p style="margin:16px 0 0 0;font-size:16px;"><strong>Totale:</strong> ${gross}</p>
    ${summaryNote}
  </div>`;
  const text = `Conferma ordine ${orderId}\nStato pagamento: ${paymentStatus}\nTotale: ${gross}`;
  return { to, subject, html, text };
}

async function sendCheckoutEmail({ session, lineItems, overrideTo }) {
  const from = process.env.MAIL_FROM;
  if (!from) throw new Error('MAIL_FROM non configurato');
  const { to, subject, html, text } = buildEmail({ session, lineItems, overrideTo });
  return sendMail({ to, from, subject, html, text });
}

module.exports = { sendCheckoutEmail };
