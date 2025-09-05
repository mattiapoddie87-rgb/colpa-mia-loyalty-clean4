// netlify/functions/lead-pdf.js
const { Resend } = require('resend');

const CORS = {
  'Access-Control-Allow-Origin': process.env.SITE_URL || 'https://colpamia.com',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const j = (s,b) => ({ statusCode:s, headers:{'Content-Type':'application/json', ...CORS}, body: JSON.stringify(b) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return j(204,{});
  if (event.httpMethod !== 'POST')   return j(405,{ error:'method_not_allowed' });

  let body={}; try { body = JSON.parse(event.body||'{}'); } catch { return j(400,{error:'bad_json'}); }
  const email = String(body.email||'').trim().toLowerCase();
  const phone = String(body.phone||'').trim();
  const pdf   = String(body.pdf||'/assets/lead.pdf');

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return j(400,{ error:'invalid_email' });

  if (!/^sk-/.test(process.env.RESEND_API_KEY||'')) {
    return j(500,{ error:'server_misconfigured: RESEND_API_KEY' });
  }
  const from = process.env.RESEND_FROM || process.env.MAIL_FROM || 'COLPA MIA <onboarding@resend.dev>';

  const resend = new Resend(process.env.RESEND_API_KEY);
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;line-height:1.45">
      <h2 style="margin:0 0 12px">Il tuo PDF: 7 scuse che non funzionano più</h2>
      <p>Scaricalo da qui: <a href="${pdf}">${pdf}</a></p>
      ${phone ? `<p style="font-size:13px;color:#555">Telefono indicato: ${phone}</p>` : ''}
      <hr style="border:none;border-top:1px solid #eee;margin:16px 0">
      <p style="font-size:13px;color:#555">Se non riconosci la richiesta, ignora questa email.</p>
    </div>
  `;

  try{
    await resend.emails.send({ from, to: email, subject: 'Il tuo PDF — Colpa Mia', html });
    return j(200,{ ok:true });
  }catch(err){
    return j(500,{ error: String(err?.message||'send_error') });
  }
};
