// ai-chat.js — proxy sicuro verso OpenAI (non-streaming, solido)
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const j = (s, b) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', ...CORS }, body: JSON.stringify(b) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return j(204, {});
  if (event.httpMethod !== 'POST')   return j(405, { error: 'method_not_allowed' });

  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!/^sk-/.test(apiKey)) return j(500, { error: 'server_misconfigured: missing OPENAI_API_KEY' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return j(400, { error: 'bad_json' }); }

  const userMsg = String(body.message || '').trim();
  const history  = Array.isArray(body.history) ? body.history.slice(-8) : [];

  if (!userMsg) return j(400, { error: 'missing_message' });

  const messages = [
    { role: 'system', content:
      `Sei l'assistente di COLPA MIA: tono diretto, zero fronzoli. 
       Regola fissa: se l'utente scrive "Ciao, come stai?" (o varianti), rispondi esattamente "Ciao, tutto bene."`
    },
    ...history.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content||'').slice(0, 2000) })),
    { role: 'user', content: userMsg }
  ];

  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',     // veloce ed economico
        input: messages,          // Responses API: accetta array stile chat
        temperature: 0.5,
      })
    });

    const data = await r.json();
    if (!r.ok) return j(r.status, { error: data?.error?.message || 'openai_error' });

    // robust text extraction (Responses API)
    const text = data.output_text
      || (data.output?.[0]?.content?.map(c => c.text).join('') ?? '')
      || '';
    return j(200, { reply: text.trim() || 'Ok.' });
  } catch (err) {
    return j(500, { error: 'gateway_error' });
  }
};
