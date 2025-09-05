// netlify/functions/ai-excuse.js
// Generatore di scuse (3 varianti) – ITA

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const j = (s, b) => ({
  statusCode: s,
  headers: { 'Content-Type': 'application/json', ...CORS },
  body: JSON.stringify(b),
});

// --- utils
const clamp = (s, n) => String(s || '').slice(0, n);
const safeJSON = (s) => {
  try {
    const m = String(s || '').match(/\{[\s\S]*\}$/);
    return m ? JSON.parse(m[0]) : {};
  } catch { return {}; }
};

const fallback3 = (need = '') => {
  const n = need ? ` (${clamp(need, 40)})` : '';
  return [
    {
      style_label: 'A',
      sms: `Imprevisto ora, sto riorganizzando. Ti aggiorno entro le 18.${n}`,
      whatsapp_text: `È saltata fuori una cosa urgente. Sto riorganizzando per ridurre il ritardo; ti scrivo entro le 18 con un orario chiaro.`,
      email_subject: `Aggiornamento sui tempi`,
      email_body: `Ciao, è sopraggiunto un imprevisto che sto gestendo. Per non promettere tempi a vuoto, ti invio un nuovo orario affidabile entro le 18. Grazie per la pazienza.`,
      escalation: `Proponi una nuova fascia (es. domani 9–11) + alternativa breve in call.`,
      risk_score: 0.12,
      red_flags: []
    },
    {
      style_label: 'B',
      sms: `Sto chiudendo un imprevisto. Arrivo più tardi; ti aggiorno presto.${n}`,
      whatsapp_text: `Mi è entrata una riunione che sta sforando. Appena libero ti mando l'ETA aggiornato.`,
      email_subject: `Piccolo slittamento`,
      email_body: `Sto gestendo una riunione inattesa che ha sforato. Ti scrivo entro oggi con un ETA preciso e la nuova priorità.`,
      escalation: `Offri un recupero concreto (consegna oggi entro orario X o domani mattina).`,
      risk_score: 0.10,
      red_flags: []
    },
    {
      style_label: 'C',
      sms: `Linea/connessione KO, sto risolvendo. Aggiorno a breve.${n}`,
      whatsapp_text: `Problema tecnico imprevisto; sto sistemando e ti aggiorno appena riparte tutto.`,
      email_subject: `Breve disguido tecnico`,
      email_body: `Un problema tecnico mi sta rallentando. Non voglio darti buca: sto ripristinando e ti mando un nuovo orario affidabile a breve.`,
      escalation: `Se serve, proponi invio parziale/bozza entro oggi.`,
      risk_score: 0.11,
      red_flags: []
    }
  ];
};

const normalize = (v, maxLen) => ({
  style_label: clamp(v.style_label || '', 12),
  sms: clamp(v.sms || '', Math.min(160, maxLen)),
  whatsapp_text: clamp(v.whatsapp_text || v.sms || '', maxLen),
  email_subject: clamp(v.email_subject || '', 80),
  email_body: clamp(v.email_body || v.whatsapp_text || '', Math.max(300, maxLen + 100)),
  escalation: clamp(v.escalation || '', 220),
  risk_score: Math.max(0, Math.min(1, Number(v.risk_score || 0))),
  red_flags: Array.isArray(v.red_flags) ? v.red_flags.slice(0, 5) : []
});

// --- handler
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return j(204, {});
  if (event.httpMethod !== 'POST')   return j(405, { error: 'method_not_allowed' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return j(400, { error: 'bad_json' }); }

  const need    = String(body.need || '').trim();
  const style   = String(body.style || 'neutro').trim();
  const persona = String(body.persona || 'generico').trim();
  const locale  = String(body.locale || 'it-IT').trim();
  const city    = String(body.city || '').trim();
  const maxLen  = Math.max(140, Math.min(600, Number(body.maxLen || 300)));

  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!/^sk-/.test(apiKey)) {
    // nessuna chiave → rispondi comunque con fallback (mai "Nessuna scusa generata")
    return j(200, { variants: fallback3(need) });
  }

  // prompt compatibile con /v1/responses (input = stringa unica)
  const system = [
    "Sei lo scrittore principale di COLPA MIA.",
    "Genera SCUSE credibili, naturali, verificabili, senza rischi legali o sanitari.",
    "Evita contenuti illegali/diffamatori e persone reali. Italiano nativo.",
    "Le tre varianti DEVONO differire per taglio/tono/lessico/struttura.",
    "Restituisci SOLO JSON valido con chiave 'variants' (array di 3 oggetti)."
  ].join(' ');

  const spec = {
    need, style, persona, locale, city, maxLen,
    schema: {
      variants: [
        { style_label:"A", sms:"", whatsapp_text:"", email_subject:"", email_body:"", escalation:"", risk_score:0, red_flags:[] },
        { style_label:"B", sms:"", whatsapp_text:"", email_subject:"", email_body:"", escalation:"", risk_score:0, red_flags:[] },
        { style_label:"C", sms:"", whatsapp_text:"", email_subject:"", email_body:"", escalation:"", risk_score:0, red_flags:[] }
      ]
    },
    constraints: {
      sms_max: Math.min(160, maxLen),
      whatsapp_max: maxLen,
      email_subject_max: 80,
      email_body_max: Math.max(300, maxLen + 100),
      forbid: ["diagnosi mediche", "reati", "persone reali"],
      must_have: ["tono credibile", "tempi realistici (es. 'entro le 18')"]
    }
  };

  const input = `${system}\nTask:\n${JSON.stringify(spec)}`;

  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        input,
        temperature: 0.85, top_p: 0.9, presence_penalty: 0.2, frequency_penalty: 0.25
      })
    });

    const data = await r.json();
    if (!r.ok) {
      // degrada ma NON fallire
      return j(200, { variants: fallback3(need) });
    }

    const raw = data.output_text || '';
    let parsed = {};
    try { parsed = JSON.parse(raw); } catch { parsed = safeJSON(raw); }

    let out = Array.isArray(parsed?.variants) ? parsed.variants.slice(0, 3) : [];
    if (!out.length) out = fallback3(need);

    // normalizza + dedup
    const norm = out.map(v => normalize(v, maxLen));
    const seen = new Set(); const uniq = [];
    for (const v of norm) { const k = (v.sms || '').toLowerCase(); if (seen.has(k)) continue; seen.add(k); uniq.push(v); }
    return j(200, { variants: uniq.slice(0, 3) });

  } catch {
    return j(200, { variants: fallback3(need) });
  }
};
