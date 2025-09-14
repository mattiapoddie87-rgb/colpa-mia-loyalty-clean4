// POST { email, minutes, reason, meta? }
const { redeemMinutes } = require('./_wallet-lib.js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const { email, minutes, reason, meta } = JSON.parse(event.body || '{}');
    if (!email || !minutes) return { statusCode: 400, body: 'email e minutes richiesti' };
    const w = await redeemMinutes({ email, minutes, reason: reason || 'redeem', meta });
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(w) };
  } catch (e) {
    return { statusCode: 400, body: String(e.message || e) };
  }
};
