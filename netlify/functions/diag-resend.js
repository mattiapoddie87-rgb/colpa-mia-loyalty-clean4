// netlify/functions/diag-resend.js
const { sendMail } = require('./send-utils');

exports.handler = async (event) => {
  const to =
    (event.queryStringParameters && event.queryStringParameters.to) ||
    process.env.RESPONSABILITA_MAIL;

  try {
    const res = await sendMail({
      from: process.env.MAIL_FROM,            // es. "COLPA MIA <onboarding@resend.dev>"
      to,
      subject: 'Diag Resend/SMTP',
      html: '<p>Diagnostica OK</p>',
      text: 'Diagnostica OK'
    });
    return { statusCode: 200, body: JSON.stringify({ ok: true, res }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
