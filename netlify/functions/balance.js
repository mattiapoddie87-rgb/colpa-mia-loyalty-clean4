// netlify/functions/balance.js
// API pubblica per leggere saldo minuti/punti per email.

const { getBalance } = require('./wallet');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };

    let email = '';
    if (event.httpMethod === 'POST') {
      try { email = (JSON.parse(event.body || '{}').email || '').trim(); } catch { email = ''; }
    } else if (event.httpMethod === 'GET') {
      email = String((event.queryStringParameters || {}).email || '').trim();
    } else {
      return resp(405, { error: 'Method Not Allowed' });
    }

    if (!email) return resp(400, { error: 'Email mancante' });

    const data = await getBalance(email);
    return resp(200, data);
  } catch (err) {
    return resp(500, { error: err.message || 'Errore interno' });
  }
};

function resp(statusCode, body) {
  return { statusCode, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
