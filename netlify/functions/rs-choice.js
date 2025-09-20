// netlify/functions/rs-choice.js
// Endpoint: POST /.netlify/functions/rs-choice
//
// Scopo: riceve una scelta (choice) da un link RS e risponde 200.
//        Niente Netlify Blobs (per evitare MissingBlobsEnvironmentError).
//        Opzionale: invio email notifica via RESEND o fallback log.

export async function handler(event) {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders(),
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'method_not_allowed' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  const id = (payload.id || '').trim();            // id del link (UUID)
  const choice = (payload.choice || '').trim();    // es. "reschedule|call|voucher"
  const ip = event.headers['x-nf-client-connection-ip']
         || event.headers['x-forwarded-for']
         || '';
  const ua = event.headers['user-agent'] || '';

  if (!id || !choice) {
    return json(400, { error: 'missing_fields', need: ['id', 'choice'] });
  }

  // Log “persistente” minimo: console + timestamp
  const record = {
    ts: new Date().toISOString(),
    id,
    choice,
    ip,
    ua,
  };
  console.log('RS-CHOICE', record);

  // --- OPZIONALE: notifica via RESEND (se presenti le env) ---
  try {
    const TO = process.env.RS_NOTIFY_TO || process.env.CONTACT_EMAIL;
    const RESEND_KEY = process.env.RESEND_API_KEY;
    if (RESEND_KEY && TO) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${RESEND_KEY}`,
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM || 'ColpaMia <no-reply@colpamia.com>',
          to: [TO],
          subject: `RS choice: ${choice} — ${id}`,
          html: `<p>Scelta registrata.</p>
                 <ul>
                   <li><b>ID</b>: ${escapeHtml(id)}</li>
                   <li><b>Choice</b>: ${escapeHtml(choice)}</li>
                   <li><b>IP</b>: ${escapeHtml(ip)}</li>
                   <li><b>UA</b>: ${escapeHtml(ua)}</li>
                   <li><b>TS</b>: ${escapeHtml(record.ts)}</li>
                 </ul>`,
        }),
      });
      // Non bloccare mai la response se la mail fallisce
      if (!res.ok) {
        const txt = await res.text();
        console.warn('RESEND_FAIL', res.status, txt);
      }
    }
  } catch (e) {
    console.warn('RESEND_ERROR', e?.message || e);
  }

  // Risposta OK: il bottone smette di dare 500
  return {
    statusCode: 200,
    headers: corsHeaders(),
    body: JSON.stringify({ ok: true }),
  };
}

// ----------------- helpers -----------------
function json(status, obj) {
  return {
    statusCode: status,
    headers: corsHeaders(),
    body: JSON.stringify(obj),
  };
}
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Content-Type': 'application/json; charset=utf-8',
  };
}
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
