// Registra la scelta dell'utente per un link RS
const { createClient } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  try {
    const { token, choice } = JSON.parse(event.body || '{}');
    if (!token || !choice)
      return { statusCode: 400, headers: CORS, body: 'bad_request' };

    // client esplicito per evitare MissingBlobsEnvironmentError
    const blobs = createClient({
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN
    });

    // store separati: link e scelte
    const linksStore   = blobs.getStore('rs-links');
    const choicesStore = blobs.getStore('rs-choices');

    // esiste il link?
    const link = await linksStore.getJSON(`links/${token}.json`);
    if (!link) return { statusCode: 404, headers: CORS, body: 'not_found' };

    // salva scelta (accumula più scelte)
    const now = Date.now();
    await choicesStore.setJSON(`choices/${token}/${now}.json`, {
      token, choice, ts: now,
      ip: event.headers['x-nf-client-connection-ip'] || ''
    });

    // ultimo stato (utile per recap veloce)
    await choicesStore.setJSON(`last/${token}.json`, { token, choice, ts: now });

    // Azione coerente con il servizio:
    // - reprogram  => apre mail con oggetto + contesto
    // - callme     => idem
    // - voucher    => rimanda al catalogo (o pagina voucher se la aggiungi)
    let next = null;
    if (choice === 'reprogram') {
      next = {
        type: 'open',
        url: `mailto:${encodeURIComponent(link.email||'')}` +
             `?subject=${encodeURIComponent('Riprogrammazione — ' + (link.context||'RS'))}` +
             `&body=${encodeURIComponent('Ciao, riprogrammiamo. Il mio token: '+token)}`
      };
    } else if (choice === 'callme') {
      next = {
        type: 'open',
        url: `mailto:${encodeURIComponent(link.email||'')}` +
             `?subject=${encodeURIComponent('Richiamami — ' + (link.context||'RS'))}` +
             `&body=${encodeURIComponent('Mi puoi richiamare? Token: '+token)}`
      };
    } else if (choice === 'voucher') {
      next = { type: 'redirect', url: '/#catalogo' };
    }

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok:true, choice, next_action: next })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: CORS,
      body: `server_error: ${e.message || e}`
    };
  }
};
