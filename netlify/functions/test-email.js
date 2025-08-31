// netlify/functions/test-email.js
const { sendEmail } = require('./send-utils');

exports.handler = async (event) => {
  try {
    const q = event.queryStringParameters || {};
    const to = String(q.to || '').trim();
    const subject = q.subject ? String(q.subject) : 'Test Colpa Mia';
    const body = q.body ? String(q.body) : 'OK, email di prova inviata.';
    if (!to) return { statusCode: 400, body: 'Missing ?to=' };
    const r = await sendEmail(to, subject, `<p>${body}</p>`);
    return { statusCode: 200, body: JSON.stringify(r) };
  } catch (e) {
    return { statusCode: 500, body: e.message || 'error' };
  }
};
