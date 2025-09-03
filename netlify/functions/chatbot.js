// netlify/functions/chatbot.js
const fetch = require('node-fetch');

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const history = body.history || [];

    // Messaggio di sistema per contestualizzare il bot
    const messages = [
      {
        role: 'system',
        content: 'Sei l’assistente di Colpa Mia. Guida i clienti a scegliere il pacchetto più adatto e rispondi in modo colloquiale, diretto e professionale.',
      },
      ...history,
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages,
        max_tokens: 150,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error('Response status ' + response.status);
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply }),
    };
  } catch (e) {
    console.error(e);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Errore interno: ' + e.message }),
    };
  }
};
