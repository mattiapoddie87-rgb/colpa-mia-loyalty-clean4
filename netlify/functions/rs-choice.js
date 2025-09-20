// Netlify Function: registra la scelta del Responsibility Switch
// npm i @netlify/blobs  (ce l'hai già nel package.json)
import { getStore } from '@netlify/blobs';

const ok = (body = {}) => ({
  statusCode: 200,
  headers: cors(),
  body: JSON.stringify(body),
});

const bad = (msg, code = 400) => ({
  statusCode: code,
  headers: cors(),
  body: JSON.stringify({ error: msg }),
});

const cors = () => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
});

export const handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return ok();       // preflight
    if (event.httpMethod !== 'POST') return bad('method_not_allowed', 405);

    // body JSON
    let payload;
    try { payload = JSON.parse(event.body || '{}'); }
    catch { return bad('invalid_json'); }

    const id = String(payload.id || '').trim();
    const choice = String(payload.choice || '').trim();

    const ALLOWED = new Set(['reprogram', 'recall', 'voucher', 'back']);
    if (!id) return bad('missing_id');
    if (!ALLOWED.has(choice)) return bad('invalid_choice');

    // store Blobs (nome "rs-choices")
    const store = getStore({ name: 'rs-choices' });

    const ts = Date.now();
    const key = `${id}/${ts}.json`;

    const record = {
      id,
      choice,
      ts,
      ip: event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || null,
      ua: event.headers['user-agent'] || null,
    };

    // salva come JSON
    await store.set(key, JSON.stringify(record), { contentType: 'application/json' });

    // opzionale: se vuoi un redirect dopo la scelta (es. torna al catalogo sul bottone "back")
    let next = null;
    if (choice === 'back') next = '/#catalogo';

    return ok({ ok: true, key, next });
  } catch (e) {
    console.error('rs-choice error:', e);
    return bad('server_error', 500);
  }
};
