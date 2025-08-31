// netlify/functions/redeem.js
const { getStore } = require('@netlify/blobs');

async function getBalance(email) {
  const store = getStore('balances');
  const raw = await store.get(email);
  if (!raw) return { minutes: 0, history: [] };
  try { return JSON.parse(raw); } catch { return { minutes: 0, history: [] }; }
}
async function setBalance(email, data) {
  const store = getStore('balances');
  await store.set(email, JSON.stringify(data));
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }
    const { email, itemId, cost, title } = JSON.parse(event.body || '{}');
    if (!email || !itemId || !cost) {
      return { statusCode: 400, body: JSON.stringify({ error: 'missing email/itemId/cost' }) };
    }

    const bal = await getBalance(email);
    if ((bal.minutes || 0) < cost) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Saldo insufficiente' }) };
    }

    bal.minutes -= cost;
    bal.history = bal.history || [];
    bal.history.push({
      ts: Date.now(),
      type: 'redeem',
      delta: -cost,
      reason: `Premium: ${title || itemId}`,
      itemId
    });
    await setBalance(email, bal);

    // TODO: qui potresti generare/richiamare contenuto (link, file, AI ecc.)
    return { statusCode: 200, body: JSON.stringify({ ok:true, minutes: bal.minutes }) };

  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
