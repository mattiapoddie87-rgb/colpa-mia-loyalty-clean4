// Genera un link RS "stateless": i dati sono nel token (base64url JSON).
// NIENTE Blobs, NIENTE storage esterno -> zero 500 per dipendenze.

exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  try {
    const { email = '', context = '', note = '', proof = 'yes', ttl = 0 } = JSON.parse(event.body || '{}');

    const payload = {
      email: String(email).trim(),
      context: String(context || ''),
      note: String(note || ''),
      proof: String(proof || 'yes'),
      iat: Date.now(),
      ttl: Number(ttl || 0) // opzionale, non obbligatorio
    };

    const token = toBase64Url(JSON.stringify(payload));
    const url = `/rs/${token}?ctx=${encodeURIComponent(payload.context || '')}`;

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, token, url })
    };
  } catch (e) {
    return { statusCode: 500, body: 'server_error: ' + (e.message || e), headers: CORS };
  }
};

function toBase64Url(str) {
  return Buffer.from(str, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/,'');
}
