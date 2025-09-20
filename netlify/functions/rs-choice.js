// Netlify Function (CommonJS): registra la scelta del Responsibility Switch
// Richiede @netlify/blobs già presente nel package.json

const { getStore } = require('@netlify/blobs');

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  };
}
function ok(body) { return { statusCode: 200, headers: cors(), body: JSON.stringify(body || {}) }; }
function bad(msg, code = 400) { return { statusCode: code, headers: cors(), body: JSON.stringify({ error: msg }) }; }

exports.handler = async (event) => {
  try {
    // Preflight
    if (event.httpMethod === 'OPTIONS') return ok();

    if (event.httpMethod !== 'POST') return bad('method_not_allowed', 405);

    // Body JSON
    let payload = {};
    try { payload = JSON.parse(event.body || '{}'); }
    catch (e) { return bad('invalid_json'); }

    const id = String(payload.id || '').trim();
    const choice = String(payload.choice || '').trim();

    const ALLOWED = new Set(['reprogram', 'recall', 'voucher', 'back']);
    if (!id) return bad('missing_id');
    if (!ALLOWED.has(choice)) return bad('invalid_choice');

    // Store blobs (creato automaticamente da Netlify)
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

    // Salva la scelta
    await store.set(key, JSON.stringify(record), { contentType: 'application/json' });

    // Redirect opzionale per "Torna al catalogo"
    let next = null;
    if (choice === 'back') next = '/#catalogo';

    return ok({ ok: true, key, next });
  } catch (err) {
    console.error('rs-choice error:', err);
    return bad('server_error', 500);
  }
};
