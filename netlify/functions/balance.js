// netlify/functions/balance.js
const { getStore } = require('@netlify/blobs');

async function getBalance(email) {
  const store = getStore('balances');
  const raw = await store.get(email);
  if (!raw) return { minutes: 0, history: [] };
  try { return JSON.parse(raw); } catch { return { minutes: 0, history: [] }; }
}

exports.handler = async (event) => {
  try {
    const { email } = event.queryStringParameters || {};
    if (!email) return { statusCode: 400, body: JSON.stringify({ error:'missing email' }) };
    const bal = await getBalance(email);
    return { statusCode: 200, body: JSON.stringify(bal) };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
