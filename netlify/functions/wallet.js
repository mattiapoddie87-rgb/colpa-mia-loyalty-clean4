// netlify/functions/wallet.js
import { createClient } from '@netlify/blobs';

const blobs = createClient();

export async function handler(event) {
  try {
    const email = (event.queryStringParameters?.email || '').trim().toLowerCase();
    if (!email) return { statusCode: 400, body: 'email mancante' };

    const key = `u/${encodeURIComponent(email)}.json`;
    const raw = await blobs.get(key);
    const data = raw ? JSON.parse(await raw.text()) : { minutes: 0, history: [] };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ email, minutes: data.minutes || 0, history: data.history || [] }),
    };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
}
