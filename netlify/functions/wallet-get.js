// netlify/functions/wallet-get.js
import { get } from '@netlify/blobs';

const STORE = 'colpamia';
const KEY   = 'wallets.json';

export const handler = async (event) => {
  const email = (event.queryStringParameters?.email || '').trim().toLowerCase();
  if (!email) return { statusCode: 400, body: JSON.stringify({ error: 'missing_email' }) };

  const wallets = (await get({ name: KEY, type: 'json', store: STORE })) || {};
  const wallet = Number(wallets[email] || 0);

  return { statusCode: 200, body: JSON.stringify({ wallet }) };
};
