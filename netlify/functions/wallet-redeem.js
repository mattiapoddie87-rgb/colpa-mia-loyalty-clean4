const { redeemMinutes } = require('./_wallet-lib.js');
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  try {
    const { email, minutes, reason, meta } = JSON.parse(event.body || '{}');
    if (!email || !minutes) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'email e minutes richiesti' }) };
    const w = await redeemMinutes({ email, minutes, reason, meta });
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(w) };
  } catch (e) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: String(e.message || e) }) };
  }
};
