// netlify/functions/lead-pdf.js
const { Resend } = require('resend');

const ORIGIN = (process.env.SITE_URL || 'https://colpamia.com').replace(/\/+$/,'');
...
const pdfReq = String(body.pdf||'/assets/lead.pdf');
const pdfUrl = /^https?:\/\//i.test(pdfReq) ? pdfReq : `${ORIGIN}${pdfReq.startsWith('/')? pdfReq : '/'+pdfReq}`;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return j(400,{ error:'invalid_email' });

  let emailSent = false, reason = null;

  // INVIO EMAIL (best-effort): se manca la key o il dominio non è verificato, NON facciamo fallire la richiesta.
  const key = (process.env.RESEND_API_KEY || '').trim();               // Resend usa "re_..."
  const fromCfg = process.env.RESEND_FROM || process.env.MAIL_FROM || '';
  const from = /@/.test(fromCfg) ? fromCfg : 'COLPA MIA <onboarding@resend.dev>';

  if (key) {
    const resend = new Resend(key);
    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;line-height:1.45">
        <h2 style="margin:0 0 12px">Il tuo PDF: 7 scuse che non funzionano più</h2>
        <p>Scaricalo da qui: <a href="${pdf}">${pdf}</a></p>
        ${phone ? `<p style="font-size:13px;color:#555">Telefono indicato: ${phone}</p>` : ''}
        <hr style="border:none;border-top:1px solid #eee;margin:16px 0">
        <p style="font-size:13px;color:#555">Se non riconosci la richiesta, ignora questa email.</p>
      </div>
    `;
    try {
      await resend.emails.send({ from, to: email, subject: 'Il tuo PDF — Colpa Mia', html });
      emailSent = true;
    } catch (err) {
      console.error('resend_error', err?.message || err);
      reason = String(err?.message || 'send_error');
      // niente throw: vogliamo comunque restituire 200
    }
  } else {
    reason = 'no_resend_key';
  }

  return j(200, { ok:true, emailSent, reason, pdf });
};

