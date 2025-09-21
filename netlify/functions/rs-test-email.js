// rs-test-email.js — invia una mail di prova con Resend o SMTP e ritorna l'esito
const https = require('https');
const nodemailer = require('nodemailer');

exports.handler = async () => {
  const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
  const to = process.env.EMAIL_TO || process.env.TEST_TO || process.env.SMTP_USER;

  const subject = 'Test COLPA MIA (Netlify Function)';
  const html = '<p>Questa è una mail di prova inviata dalla funzione <b>rs-test-email</b>.</p>';

  const debug = { tried: [], errors: [] };

  try {
    if (process.env.RESEND_API_KEY) {
      debug.tried.push('resend');
      try {
        await sendResend({
          apiKey: process.env.RESEND_API_KEY,
          from: process.env.EMAIL_FROM || 'COLPA MIA <onboarding@resend.dev>',
          to, subject, html
        });
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok:true, via:'resend', to }) };
      } catch(e){ debug.errors.push('resend: '+e.message); }
    }
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      debug.tried.push('smtp');
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE || 'false') === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });
      await transporter.sendMail({
        from: process.env.EMAIL_FROM || `COLPA MIA <${process.env.SMTP_USER}>`,
        to, subject, html
      });
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok:true, via:'smtp', to }) };
    }
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ ok:false, error:'nessun provider configurato', debug }) };
  } catch(e){
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ ok:false, error:e.message, debug }) };
  }
};

function sendResend({ apiKey, from, to, subject, html }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ from, to, subject, html });
    const req = https.request({
      method: 'POST',
      hostname: 'api.resend.com',
      path: '/emails',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let data=''; res.on('data', c=>data+=c);
      res.on('end', () => res.statusCode < 300 ? resolve() : reject(new Error(`Resend ${res.statusCode}: ${data}`)));
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}
