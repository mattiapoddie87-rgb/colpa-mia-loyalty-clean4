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

// Risposte curate per i bottoni / intent rapidi
const QUICK = {
  'prezzi': `Catalogo: Base (10 min), Tripla (30), Deluxe (60). Il prezzo è visibile al checkout Stripe; puoi usare anche codici sconto/promo quando disponibili.`,
  'tempi': `Consegna tra 30 secondi e 10 minuti dopo il pagamento. Ricevi su WhatsApp (se inserito) e email di backup.`,
  'rimborso': `Se il testo non ti soddisfa, scrivici rispondendo all’email di consegna: rimborsiamo senza storie.`,
  'privacy': `Usiamo solo i dati necessari per erogare il servizio e inviare la scusa. Non vendiamo dati a terzi. Puoi chiedere la cancellazione in qualsiasi momento.`,
  'come acquistare': `Scegli il pacchetto, completa il checkout Stripe, inserisci WhatsApp/email. Dopo il pagamento generiamo 1–3 varianti e accreditiamo i minuti sul wallet.`,
};

// Routing “keyword” per domande frequenti (più naturale dei soli bottoni)
function keywordAnswer(q) {
  const t = q.toLowerCase();
  if (/\bpaypal\b/.test(t)) {
    return `Al momento no: accettiamo pagamenti tramite Stripe (carte di credito/debito, Apple Pay/Google Pay dove disponibili).`;
  }
  if (/pagare|carta|payment|card|apple ?pay|google ?pay/.test(t)) {
    return `Sì: paghi in modo sicuro con Stripe (carte, Apple Pay/Google Pay dove supportati). In cassa puoi anche inserire un codice promo.`;
  }
  if (/prezzi?|quanto costa|costa/.test(t)) return QUICK['prezzi'];
  if (/tempi?|quando arriva|quanto tempo/.test(t)) return QUICK['tempi'];
  if (/rimborso|refund/.test(t)) return QUICK['rimborso'];
  if (/privacy|dati|gdpr/.test(t)) return QUICK['privacy'];
  if (/come (si )?acquista|comprare|checkout|ordina/.test(t)) return QUICK['come acquistare'];
  if (/sei un bot|bot\?/.test(t)) return `Sono un assistente virtuale: ti rispondo in modo chiaro e veloce. Dimmi pure cosa ti serve.`;
  if (/ciao|buongiorno|salve/.test(t)) return `Ciao! Posso aiutarti su prezzi, tempi, pagamenti, rimborsi e privacy.`;
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return j(204, {});
  if (event.httpMethod !== 'POST')   return j(405, { error: 'method_not_allowed' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return j(400, { error: 'bad_json' }); }

  const message = String(body.message || '').trim();
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
  if (!message) {
    return j(200, { reply: 'Dimmi pure: “Prezzi”, “Tempi”, “Rimborso”, “Privacy” o “Come acquistare”.' });
  }

  // 1) Bottoni rapidi (match esatto)
  const quickKey = Object.keys(QUICK).find(k => message.toLowerCase() === k);
  if (quickKey) return j(200, { reply: QUICK[quickKey] });

  // 2) Heuristics (parole chiave)
  const kw = keywordAnswer(message);
  if (kw) return j(200, { reply: kw });

  // 3) AI (Responses API) – stesso stack dell’engine che già funziona
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  const model  = (process.env.OPENAI_MODEL_ || 'gpt-4o-mini').trim();
  if (!apiKey) {
    return j(200, { reply: 'Posso aiutarti su prezzi, tempi, pagamenti, rimborsi e privacy. (Motore AI non configurato)' });
  }

  const sys = [
    'Sei l’assistente di COLPA MIA. Rispondi in italiano, naturale e concreto, in 1–3 frasi.',
    'Se la domanda riguarda pagamenti: “Usiamo Stripe (carte, Apple/Google Pay dove disponibili). Niente PayPal per ora”.',
    'Tempi: “30s–10m dopo il pagamento, WhatsApp + email di backup”.',
    'Rimborsi: “se il testo non va bene, rimborsiamo, basta rispondere all’email di consegna”.',
    'Privacy: “solo dati necessari, mai rivenduti; cancellazione su richiesta”.',
    'Se la domanda è vaga, chiedi UNA breve chiarificazione.',
  ].join(' ');

  // Few-shot per stabilizzare le risposte su temi ricorrenti
  const examples = [
    { q: 'posso pagare con carta?', a: 'Sì, paghi con Stripe: carte di credito/debito e Apple/Google Pay dove disponibili. In cassa puoi inserire anche un codice promo.' },
    { q: 'avete paypal?', a: 'Per ora no: usiamo Stripe (carte, Apple/Google Pay se supportati).' },
    { q: 'quanto ci mettete a inviare la scusa?', a: 'Di solito tra 30 secondi e 10 minuti dopo il pagamento. La inviamo su WhatsApp e, se l’hai inserita, anche via email.' },
    { q: 'come funziona il rimborso?', a: 'Se il testo non è ok, rispondi all’email di consegna: rimborsiamo senza storie.' },
    { q: 'come compro?', a: 'Scegli il pacchetto, completa il checkout Stripe, inserisci WhatsApp/email. Poi generiamo 1–3 varianti e accreditiamo i minuti sul wallet.' },
  ];

  const userPayload = {
    question: message,
    context: 'Sito Colpa Mia — generatore di scuse',
    history: history.map(h => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content||'') })),
    examples,
  };

  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        input: [
          { role: 'system', content: sys },
          { role: 'user',   content: JSON.stringify(userPayload) }
        ],
        temperature: 0.6,
        top_p: 0.9,
        presence_penalty: 0.2,
        frequency_penalty: 0.1,
      })
    });
    const data = await r.json().catch(() => ({}));
    let reply = String(data?.output_text || '').trim();

    // Fallback robusto se il modello non restituisce testo
    if (!r.ok || !reply) {
      const alt = keywordAnswer(message);
      reply = alt || 'Posso aiutarti su prezzi, tempi, pagamenti, rimborsi e privacy. Dimmi pure cosa ti serve.';
    }
    return j(200, { reply });
  } catch {
    const alt = keywordAnswer(message);
    return j(200, { reply: alt || 'In questo momento ho un intoppo tecnico. Prova a chiedermi “Prezzi”, “Tempi”, “Rimborso”, “Privacy” o “Come acquistare”.' });
  }
};
