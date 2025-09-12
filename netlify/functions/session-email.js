// Costruzione e invio email legata a Checkout Session
const { formatCurrency, safeString } = require('./session-info');
const { sendMail } = require('./send-utils');

function renderItems(items, currency) {
  if (!items?.length) return '<p>Nessun dettaglio articoli disponibile.</p>';
  const rows = items.map(it => {
    const name = safeString(it.description || it.price?.nickname || 'Articolo');
    const qty = it.quantity || 1;
    const amt = it.amount_total ?? (it.price?.unit_amount ?? 0) * qty;
    return `<tr>
      <td style="padding:8px;border:1px solid #e5e7eb;">${name}</td>
      <td style="padding:8px;border:1px solid #e5e7eb;text-align:center;">${qty}</td>
      <td style="padding:8px;border:1px solid #e5e7eb;text-align:right;">${formatCurrency(amt, currency)}</td>
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

function buildEmail({ session, lineItems }) {
  const to = session?.customer_details?.email || session?.customer_email || session?.metadata?.email;
  if (!to) throw new Error('Email cliente assente nella sessione Stripe.');

  const orderId = session.id;
  const currency = session.currency || 'eur';
  const gross = formatCurrency(session.amount_total || 0, currency);
  const paymentStatus = session.payment_status || 'paid';

  const itemsTable = renderItems(lineItems, currency);
  const brand = process.env.MAIL_BRAND || 'COLPA MIA';

  const subject = `${brand} — Conferma ordine ${orderId.substring(0,8)}`;
  const html = `
  <div style="font-family:system-ui,Segoe UI,Arial;max-width:640px;margin:0 auto;color:#111827;">
    <h1 style="font-size:20px;margin:0 0 12px 0;">Grazie per l'ordine</h1>
    <p style="margin:0 0 12px 0;">ID ordine: <strong>${orderId}</strong></p>
    <p style="margin:0 0 12px 0;">Stato pagamento: <strong>${paymentStatus}</strong></p>
    ${itemsTable}
    <p style="margin:16px 0 0 0;font-size:16px;"><strong>Totale:</strong> ${gross}</p>
    <p style="margin:24px 0 0 0;">Riceverai ulteriori istruzioni a breve.</p>
  </div>`;

  const text = `Grazie per l'ordine ${orderId}.
Stato pagamento: ${paymentStatus}.
Totale: ${gross}.`;

  return { to, subject, html, text };
}

async function sendCheckoutEmail({ session, lineItems }) {
  const { to, subject, html, text } = buildEmail({ session, lineItems });
  const from = process.env.MAIL_FROM;
  if (!from) throw new Error('MAIL_FROM non configurato.');
  await sendMail({ to, from, subject, html, text });
}

module.exports = { sendCheckoutEmail };
