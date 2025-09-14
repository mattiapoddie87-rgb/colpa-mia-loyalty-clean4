const { getWallet } = require('./_wallet-lib.js');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };
  if (event.httpMethod !== 'GET')
    return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  const email =
    (event.queryStringParameters && (event.queryStringParameters.email || event.queryStringParameters.addr)) || '';

  if (!email) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'email richiesta' }) };

  try {
    const w = await getWallet(email);
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(w) };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: String(e.message || e) }),
    };
  }
};
