// netlify/functions/redeem.js
import { createClient } from '@netlify/blobs';

const blobs = createClient();

export async function handler(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const { email, premiumId, cost } = JSON.parse(event.body || '{}');
    if (!email || !premiumId || !Number.isFinite(cost)) {
      return { statusCode: 400, body: 'Parametri invalidi' };
    }
    const key = `u/${encodeURIComponent(email.trim().toLowerCase())}.json`;
    const raw = await blobs.get(key);
    const data = raw ? JSON.parse(await raw.text()) : { minutes: 0, history: [] };

    if ((data.minutes || 0) < cost) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Saldo insufficiente' }) };
    }

    data.minutes = (data.minutes || 0) - cost;
    data.history = data.history || [];
    data.history.push({ type: 'redeem', premiumId, cost, ts: Date.now() });

    await blobs.set(key, JSON.stringify(data), { contentType: 'application/json' });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, minutes: data.minutes }),
    };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
}
