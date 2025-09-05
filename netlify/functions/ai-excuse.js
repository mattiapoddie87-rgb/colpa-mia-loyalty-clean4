// ai-excuse.js — Generatore di scuse pro-grade (3 varianti) ITA
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const j = (s,b) => ({ statusCode:s, headers:{'Content-Type':'application/json', ...CORS}, body:JSON.stringify(b) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return j(204,{});
  if (event.httpMethod !== 'POST')   return j(405,{ error:'method_not_allowed' });

  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!/^sk-/.test(apiKey)) return j(500,{ error:'server_misconfigured: missing OPENAI_API_KEY' });

  let body={};
  try { body = JSON.parse(event.body||'{}'); } catch { return j(400,{ error:'bad_json' }); }

  const need = String(body.need||'').trim();              // contesto che l’utente scrive
  const style = String(body.style||'neutro').trim();      // es: soft | executive | romantico | tecnico
  const persona = String(body.persona||'generico').trim();// es: lavoro | relazioni | traffico
  const locale = String(body.locale||'it-IT');            // IT by default
  const city = String(body.city||'').trim();              // opzionale (Pioltello, Milano, ecc.)
  const maxLen = Math.max(140, Math.min(600, Number(body.maxLen||300))); // lunghezza sicurezza

  if (!need) return j(400,{ error:'missing_need' });

  const system = [
    "Sei lo scrittore principale di COLPA MIA.",
    "Obiettivo: generare SCUSE credibili, naturali, verificabili, senza rischi legali o sanitari.",
    "Evitare contenuti illegali, diffamatori, o che incitino a danni. Bandite entità reali identificabili.",
    "Stile: italiano nativo, micro-dettagli plausibili (tempi, luoghi generici), zero gergo robotico.",
    "Variazione: le tre varianti DEVONO differire per taglio, tono, lessico e struttura.",
    "Se l’input è scarno, inferisci un contesto minimo senza inventare fatti specifici rischiosi.",
    "Formato output: JSON stretto secondo lo schema richiesto."
  ].join(' ');

  const user = JSON.stringify({
    need, style, persona, locale, city, maxLen,
    schema: {
      variants: [
        { style_label: "A", sms: "", whatsapp_text: "", email_subject: "", email_body: "", escalation: "", risk_score: 0, red_flags: [] },
        { style_label: "B", sms: "", whatsapp_text: "", email_subject: "", email_body: "", escalation: "", risk_score: 0, red_flags: [] },
        { style_label: "C", sms: "", whatsapp_text: "", email_subject: "", email_body: "", escalation: "", risk_score: 0, red_flags: [] }
      ]
    },
    constraints: {
      sms_max: Math.min(160, maxLen),
      whatsapp_max: maxLen,
      email_subject_max: 80,
      email_body_max: Math.max(300, maxLen + 100),
      forbid: ["diagnosi mediche", "scuse che implicano reati", "citare persone reali"],
      must_have: ["tono credibile", "nessun overdrama", "tempi realistici (es. 'entro le 18')"]
    }
  });

  // OpenAI Responses API
  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method:'POST',
      headers:{ 'Authorization':`Bearer ${apiKey}`, 'Content-Type':'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        input: [
          { role:'system', content: system },
          { role:'user',   content: `Restituisci SOLO JSON valido. Task:\n${user}` }
        ],
        temperature: 0.85, top_p: 0.9, presence_penalty: 0.2, frequency_penalty: 0.25
      })
    });
    const data = await r.json();
    if (!r.ok) return j(r.status, { error: data?.error?.message || 'openai_error' });

    const raw = data.output_text || '';
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = safeJSON(raw); }
    const variants = Array.isArray(parsed?.variants) ? parsed.variants.slice(0,3) : [];

    // normalizza + taglio lunghezze
    const clamp = (s,n)=> String(s||'').slice(0, n);
    const clean = v => ({
      style_label: String(v.style_label||'').slice(0,12),
      sms: clamp(v.sms, Math.min(160, maxLen)),
      whatsapp_text: clamp(v.whatsapp_text, maxLen),
      email_subject: clamp(v.email_subject, 80),
      email_body: clamp(v.email_body, Math.max(300, maxLen+100)),
      escalation: clamp(v.escalation||'', 220),
      risk_score: Math.max(0, Math.min(1, Number(v.risk_score||0))),
      red_flags: Array.isArray(v.red_flags) ? v.red_flags.slice(0,5) : []
    });

    const out = variants.map(clean);
    if (!out.length) return j(200, { variants:[ demo(need) ] });

    // de-dup semplice su sms
    const seen = new Set(); const uniq=[];
    for (const v of out) { const k=(v.sms||'').toLowerCase(); if(seen.has(k)) continue; seen.add(k); uniq.push(v); }
    return j(200, { variants: uniq.slice(0,3) });

  } catch (e) {
    return j(500,{ error:'gateway_error' });
  }
};

function safeJSON(s){
  try{
    const m = String(s||'').match(/\{[\s\S]*\}$/);
    return m ? JSON.parse(m[0]) : {};
  }catch{ return {}; }
}

function demo(need){
  // fallback minimale
  return {
    style_label:'A',
    sms:`Imprevisto ora, sto riorganizzando. Ti aggiorno entro sera. (${need.slice(0,40)})`,
    whatsapp_text:`È saltata fuori una cosa urgente e sto riorganizzando: arrivo più tardi. Ti scrivo entro le 18 con un orario chiaro.`,
    email_subject:`Aggiornamento sui tempi`,
    email_body:`Ciao, è sopraggiunto un imprevisto che sto gestendo. Preferisco non fare promesse a vuoto: ti mando un aggiornamento entro le 18 con un nuovo orario affidabile. Grazie per la pazienza.`,
    escalation:`Se chiedono dettagli, proponi una nuova fascia (es. domani 9–11) e offri alternativa breve in call.`,
    risk_score:0.12, red_flags:[]
  };
}
