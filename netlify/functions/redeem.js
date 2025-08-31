// netlify/functions/redeem.js
// Redeem Premium: scala minuti dal wallet utente e crea un "ticket" di delivery.
// Input (POST JSON): { email, phone, item_id }
// Risposta: { ok:true, remaining, ticket_id, message } oppure { ok:false, error }

const { blobs } = require('@netlify/blobs');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Mappa costi (minuti) dei premium: deve combaciare con public/premium.js
const PREMIUM_COSTS = {
  ai_custom: 30,
  voice: 20,
  med: 40,
  ics: 15,
  email_pack: 25,
};

exports.handler = async (event) => {
  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const email = (body.email || '').trim().toLowerCase();
    const phone = (body.phone || '').trim();
    const itemId = body.item_id;

    if (!itemId || !PREMIUM_COSTS[itemId]) {
      return resp(400, { ok:false, error:'Item non valido' });
    }
    if (!email && !phone) {
      return resp(400, { ok:false, error:'Inserisci almeno telefono o email' });
    }

    // Stores Blobs
    const balances = blobs({ name: 'balances' });   // saldo e history
    const deliveries = blobs({ name: 'deliveries' });// ticket da evadere

    // Chiave per il wallet: preferisco l'email. Se manca, uso phone come chiave.
    const key = email || `tel:${phone}`;

    // Carica saldo
    let bal = await balances.getJSON(key).catch(()=>null);
    if (!bal) bal = { minutes: 0, history: [] };

    const cost = PREMIUM_COSTS[itemId];

    if ((bal.minutes || 0) < cost) {
      return resp(400, {
        ok:false,
        error:`Minuti insufficienti. Servono ${cost} min, saldo attuale ${bal.minutes||0} min.`
      });
    }

    // Scala minuti + history
    bal.minutes = (bal.minutes || 0) - cost;
    bal.history = bal.history || [];
    const now = Date.now();
    const entry = {
      ts: now,
      type: 'redeem_premium',
      delta: -cost,
      item_id: itemId,
    };
    bal.history.push(entry);

    await balances.setJSON(key, bal);

    // Crea un "ticket" per la delivery (da evadere con AI/telefono/mail)
    const ticketId = `${key}:${itemId}:${now}`;
    await deliveries.setJSON(ticketId, {
      ticket_id: ticketId,
      created_at: now,
      item_id: itemId,
      via: phone ? 'phone' : 'email',
      phone: phone || null,
      email: email || null,
      status: 'queued',
    });

    return resp(200, {
      ok: true,
      remaining: bal.minutes,
      ticket_id: ticketId,
      message: 'Premium sbloccato! Ti invieremo il contenuto sul canale scelto.'
    });

  } catch (e) {
    console.error('redeem error', e);
    return resp(500, { ok:false, error:'Errore interno' });
  }
};

function resp(code, obj){
  return {
    statusCode: code,
    headers: { ...corsHeaders, 'Content-Type':'application/json' },
    body: JSON.stringify(obj),
  };
}
