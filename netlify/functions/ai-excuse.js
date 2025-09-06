// netlify/functions/ai-excuse.js
// Genera 3 varianti DAVVERO diverse, pronte per WhatsApp/Email

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
  if (event.httpMethod !== 'POST') return j(405, { error: 'method_not_allowed' });

  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return j(500, { error: 'missing_OPENAI_API_KEY' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return j(400, { error: 'bad_json' }); }

  const need    = String(body.need || '').slice(0, 700);
  const persona = String(body.persona || 'generico');
  const style   = String(body.style || 'neutro');
  const locale  = String(body.locale || 'it-IT');
  const maxLen  = Math.max(160, Math.min(420, Number(body.maxLen || 320)));

  // seed per forzare variazioni (anche a parità di input)
  const seed = Date.now() % 2147483647;

  const model = (process.env.OPENAI_MODEL_ || 'gpt-4o-mini').trim();

  const system = [
    'Sei lo scrittore principale di COLPA MIA. Genera SCUSE credibili e naturali.',
    'Regole:',
    '1) Restituisci SOLO JSON valido.',
    '2) 3 varianti DAVVERO diverse per struttura, lessico e approccio.',
    '3) Evita reati/danni/diagnosi. Niente nomi reali. Tono plausibile e misurato.',
    '4) Tempi realistici (es. "entro le 18", "domattina").',
    '5) Ogni variante in <= ' + maxLen + ' caratteri.',
  ].join(' ');

  const user = {
    need, persona, style, locale,
    request: 'Voglio tre varianti pronte per WhatsApp.',
    hints: [
      'Una variante responsabile con ETA preciso',
      'Una variante che propone alternativa (es. call breve / nuovo slot)',
      'Una variante più soft con richiesta di pazienza'
    ]
  };

  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        input: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(user) }
        ],
        temperature: 0.9,
        top_p: 0.95,
        presence_penalty: 0.3,
        frequency_penalty: 0.2,
        seed
      })
    });

    const data = await r.json();
    if (!r.ok) return j(r.status, { error: data?.error?.message || 'openai_error' });

    const raw = data.output_text || '';
    let parsed = {};
    try { parsed = JSON.parse(raw); } catch {}

    const pick = (v) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
    let variants = [];

    if (Array.isArray(parsed?.variants)) {
      variants = parsed.variants
        .map(v => ({ whatsapp_text: pick(v.whatsapp_text || v.sms || v.text) }))
        .filter(v => v.whatsapp_text)
        .slice(0, 3);
    }

    // Se la AI ha comunque dato poco, genera un mix locale diverso ogni volta
    if (!variants.length) {
      const pool = [
        'Mi è entrato un imprevisto serio e sto riorganizzando. Appena ho un orario affidabile, ti aggiorno entro sera.',
        'Sto chiudendo un’urgenza e temo un piccolo ritardo. Preferisco non promettere a vuoto: ti scrivo tra poco con tempi chiari.',
        'Situazione imprevista che mi blocca. Minimizzare il ritardo è la priorità: ti propongo un nuovo slot a breve.'
      ];
      // mescola
      for (let i = pool.length - 1; i > 0; i--) {
        const k = Math.floor((seed + i) % (i + 1));
        [pool[i], pool[k]] = [pool[k], pool[i]];
      }
      variants = pool.map(t => ({ whatsapp_text: pick(t) })).slice(0, 3);
    }

    return j(200, { variants });
  } catch (e) {
    return j(200, {
      variants: [
        { whatsapp_text: 'Imprevisto serio, sto riorganizzando al volo. Ti aggiorno entro sera con orario preciso.' },
        { whatsapp_text: 'Sto chiudendo un’urgenza e potrei sforare. Ti scrivo a breve con tempi affidabili.' },
        { whatsapp_text: 'Mi scuso: situazione bloccante. Minimizzo il ritardo e ti propongo subito un nuovo slot.' }
      ]
    });
  }
};
