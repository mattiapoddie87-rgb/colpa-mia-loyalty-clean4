// netlify/functions/ai-chat.js
// Proxy sicuro verso OpenAI (Chat Completions) — risolve il problema del "Ok."
// Risponde in italiano, tono semplice. Nessun fallback svuotato.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const j = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', ...CORS },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return j(204, {});
  if (event.httpMethod !== 'POST')   return j(405, { error: 'method_not_allowed' });

  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  const model  = (process.env.OPENAI_MODEL_ || 'gpt-4o-mini').trim();
  if (!apiKey) return j(500, { error: 'missing_OPENAI_API_KEY' });

  // ---- parse body
  let body = {};
  try { body = JSON.parse(event.body || '{}'); }
  catch { return j(400, { error: 'bad_json' }); }

  const userMsg = String(body.message || '').slice(0, 2000).trim();
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
  if (!userMsg) return j(400, { error: 'missing_message' });

  // ---- build messages (chat format)
  const system =
    'Sei l’assistente di COLPA MIA. Rispondi in italiano con tono diretto e chiaro. ' +
    'Dai risposte utili e concise (1–3 frasi). Evita fronzoli, emoji e scuse generiche.';

  const messages = [
    { role: 'system', content: system },
    ...history.map(h => ({
      role: h.role === 'assistant' ? 'assistant' : 'user',
      content: String(h.content || '').slice(0, 2000),
    })),
    { role: 'user', content: userMsg },
  ];

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.6,
        max_tokens: 300,
        presence_penalty: 0.2,
        frequency_penalty: 0.2,
      }),
    });

    const out = await r.json().catch(() => ({}));
    if (!r.ok) {
      return j(r.status, { error: out?.error?.message || 'openai_error' });
    }

    const reply = (out?.choices?.[0]?.message?.content || '').trim();
    return j(200, { reply: reply || 'Non ho capito bene. Vuoi info su prezzi, tempi, rimborso, privacy o come acquistare?' });
  } catch (err) {
    return j(502, { error: 'gateway_error', detail: String(err?.message || err) });
  }
};
