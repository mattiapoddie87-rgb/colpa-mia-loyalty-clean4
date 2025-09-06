// netlify/functions/ai-chat.js
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const j = (s, b) => ({
  statusCode: s,
  headers: { 'Content-Type': 'application/json', ...CORS },
  body: JSON.stringify(b),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return j(204, {});
  if (event.httpMethod !== 'POST')   return j(405, { error: 'method_not_allowed' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return j(400, { error: 'bad_json' }); }

  const message = String(body.message || '').trim();
  let history   = Array.isArray(body.history) ? body.history.slice(-8) : [];
  if (!message) return j(200, { reply: 'Dimmi pure: “Prezzi”, “Tempi”, “Rimborso”, “Privacy” o “Come acquistare”.' });

  // Quick intents (per bottoni)
  const QUICK = {
    'prezzi': 'Vedi il Catalogo: pacchetti Base (10 min), Tripla (30), Deluxe (60). Paghi con Stripe; i codici promo sono accettati in cassa.',
    'tempi': 'Consegna 30s–10m dopo il pagamento. WhatsApp immediato, email di backup se inserita.',
    'rimborso': 'Se il testo non è ok ti rimborsiamo: rispondi all’email di consegna o contattaci dal sito.',
    'privacy': 'Usiamo solo i dati necessari alla consegna. Niente condivisioni con terzi. Puoi chiedere cancellazione in ogni momento.',
    'come acquistare': 'Scegli il pacchetto, completa il checkout Stripe, inserisci WhatsApp/email. Ricevi 1–3 varianti e minuti accreditati nel wallet.',
  };
  const low = message.toLowerCase();
  for (const k of Object.keys(QUICK)) {
    if (low.includes(k)) return j(200, { reply: QUICK[k] });
  }

  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    return j(200, { reply: 'Ciao! Posso aiutarti su prezzi, tempi, rimborsi, privacy o su come acquistare. (AI offline ora).' });
  }

  const model = (process.env.OPENAI_MODEL_ || 'gpt-4o-mini').trim();
  const messages = [
    { role: 'system',
      content: 'Sei assistente di COLPA MIA. Rispondi in italiano, chiaro e conciso. Dai info pratiche su prezzi, tempi, rimborsi, privacy e come acquistare.' },
    ...history.map(h => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content||'').slice(0,2000) })),
    { role: 'user', content: message.slice(0,2000) }
  ];

  try {
    // Chat Completions (più semplice da parsare del Responses)
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, temperature: 0.5 })
    });
    const data = await r.json().catch(() => ({}));

    let reply =
      data?.choices?.[0]?.message?.content ||
      data?.output_text ||
      (Array.isArray(data?.output) && data.output[0]?.content?.[0]?.text?.value) || '';

    reply = String(reply || '').trim();
    if (!r.ok || !reply) throw new Error('empty_reply');

    // aggiorna history lato client (il client già la gestisce)
    return j(200, { reply });
  } catch {
    return j(200, { reply: 'Posso aiutarti con prezzi, tempi, rimborsi, privacy o ordine. Chiedimi pure!' });
  }
};
