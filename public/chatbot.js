const fetch = require('node-fetch');

// Funzione serverless: chatbot AI per Colpa Mia
exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const history = Array.isArray(body.history) ? body.history : [];

    // Taglia la cronologia alle ultime 6 interazioni per ridurre l’uso di token
    const trimmedHistory = history.slice(-6);

    // Messaggio di sistema per contestualizzare il bot
    const messages = [
      {
        role: 'system',
        content:
          'Sei l’assistente di Colpa Mia. Guida i clienti a scegliere il pacchetto più adatto, spiega le differenze tra i servizi e rispondi con tono diretto e professionale.',
      },
      ...trimmedHistory,
    ];

    // Modello da usare: legge la variabile OPENAI_MODEL o cade su gpt-4o
    const model = process.env.OPENAI_MODEL || 'gpt-4o';

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 200,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error('Errore OpenAI ' + response.status);
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim() || '';

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply }),
    };
  } catch (e) {
    // Restituisce l’errore al client: verrà mostrato dallo script del chatbot
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message || 'Errore interno' }),
    };
  }
};
