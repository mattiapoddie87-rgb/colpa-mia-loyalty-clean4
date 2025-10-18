const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};

const j = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', ...CORS },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return j(204, {});
  if (event.httpMethod !== 'POST') return j(405, { error: 'Method not allowed' });

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (err) {
    return j(400, { error: 'Invalid JSON' });
  }

  const message = (body.message || '').trim();
  const tone = (body.tone || '').trim();

  if (!message) return j(400, { error: 'message_required' });

  const apiKey = process.env.OPENAI_API_KEY || '';
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  if (!apiKey) {
    return j(200, { preview: '(api_key_missing)' });
  }

  const systemPrompt = `Sei l'agente di COLPA MIA. Produci scuse efficaci, brevi, non passive-aggressive.`;
  const userPrompt = `Situazione: ${message}\nTono richiesto: ${tone}\nOutput: testo di scusa 80-120 parole, lingua italiana, includi proposta concreta di rimedio e chiusura che riapre il dialogo. Evita emoji.`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.5,
        max_tokens: 300,
      }),
    });

    const data = await res.json();
    const preview = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
      ? data.choices[0].message.content.trim()
      : 'Errore di generazione';
    return j(200, { preview });
  } catch (err) {
    return j(500, { error: 'api_error', details: err.message });
  }
};
