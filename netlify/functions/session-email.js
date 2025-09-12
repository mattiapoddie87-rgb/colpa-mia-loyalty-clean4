// netlify/functions/session-email.js
// Costruzione e invio email per Stripe Checkout Session
const { formatCurrency, safeString } = require('./session-info');
const { sendMail } = require('./send-utils');

function renderItems(items, currency) {
  if (!Array.isArray(items) || items.length === 0) {
    return '<p>Dettagli articoli non disponibili.</p>';
  }

  const rows = items.map((it) => {
    const name = safeString(it.description || it.price?.nickname || 'Articolo');
    const qty = it.quantity || 1;
    const amtMinor = (typeof it.amount_total === 'number')
      ? it.amount_total
      : (it.price?.unit_amount ?? 0) * qty;

    return `<tr>
      <td style="padding:8px;border:1px solid #e5e7eb;">${name}</td>
      <td style="padding:8px;border:1px solid #e5e7eb;text-align:center;">${qty}</td>
      <td style="padding:8px;border:1px solid #e5e7eb;text-align:right;">${formatCurrency(amtMinor, currency)}</td>
    </tr>`;
  }).join('');

  return `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;font-family:system-ui,Segoe UI,Arial;">
    <thead>
      <tr>
        <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Articolo</th>
        <th style="padding:8px;border:1px solid #e5e7eb;text-align:center;">Qtà</th>
        <th style="padding:8px;border:1px solid #e5e7eb;text-align:right;">Totale</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function buildEmail({ session, lineItems, overrideTo }) {
  const to =
    overrideTo ||
    session?.customer_details?.email ||
    session?.customer_email ||
    session?.metadata?.email;

  if (!to) throw new Error('Email cliente assente.');

  const orderId = session.id;
  const currency = session.currency || 'eur';
  const grossMinor = session.amount_total || 0;
  const gross = formatCurrency(grossMinor, currency);
  const paymentStatus = session.payment_status || 'paid';
  const brand = process.env.MAIL_BRAND || 'COLPA MIA';

  const itemsTable = renderItems(lineItems, currency);
  const zeroNote = grossMinor === 0
    ? `<p style="margin:8px 0 0 0;color:#6b7280;">Ordine a totale 0 per sconto o coupon.</p>`
    : ``;

  const sku = session?.metadata?.sku || session?.client_reference_id || '';

  const subjectParts = [brand, '— Conferma ordine', orderId.substring(0, 8)];
  if (sku) subjectParts.push(`(${safeString(sku)})`);
  const subject = subjectParts.join(' ');

  const html = `
  <div style="font-family:system-ui,Segoe UI,Arial;max-width:640px;margin:0 auto;color:#111827;">
    <h1 style="font-size:20px;margin:0 0 12px 0;">Conferma ordine</h1>
    <p style="margin:0 0 12px 0;">ID ordine: <strong>${orderId}</strong></p>
    <p style="margin:0 0 12px 0;">Stato pagamento: <strong>${paymentStatus}</strong></p>
    ${itemsTable}
    <p style="margin:16px 0 0 0;font-size:16px;"><strong>Totale:</strong> ${gross}</p>
    ${zeroNote}
    <p style="margin:24px 0 0 0;">Riceverai a breve ulteriori istruzioni.</p>
  </div>`.trim();

  const text = [
    `Conferma ordine`,
    `ID: ${orderId}`,
    `Stato pagamento: ${paymentStatus}`,
    `Totale: ${gross}`,
  ].join('\n');

  return { to, subject, html, text };
}

async function sendCheckoutEmail({ session, lineItems, overrideTo }) {
  const from = process.env.MAIL_FROM;
  if (!from) throw new Error('MAIL_FROM non configurato.');
  const { to, subject, html, text } = buildEmail({ session, lineItems, overrideTo });
  return sendMail({ to, from, subject, html, text });
}

module.exports = { sendCheckoutEmail };
