// GET /.netlify/functions/wallet-get?email=foo@bar.com
const { getWallet } = require('./_wallet-lib.js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method Not Allowed' };
  const email = (event.queryStringParameters && event.queryStringParameters.email) || '';
  if (!email) return { statusCode: 400, body: 'email richiesta' };
  try {
    const w = await getWallet(email);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(w) };
  } catch (e) {
    return { statusCode: 500, body: e.message };
  }
};
