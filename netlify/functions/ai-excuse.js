// netlify/functions/ai-excuse.js
// Genera SEMPRE 3 scuse (fallback locale se OpenAI non risponde).

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const j = (s,b)=>({ statusCode:s, headers:{'Content-Type':'application/json', ...CORS}, body:JSON.stringify(b) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return j(204,{});
  if (event.httpMethod !== 'POST')   return j(405,{ error:'method_not_allowed' });

  let body={};
  try { body = JSON.parse(event.body||'{}'); } catch { return j(400,{ error:'bad_json' }); }

  const need    = String(body.need||'').trim() || 'ritardo imprevisto';
  const persona = String(body.persona||'generico').trim();
  const style   = String(body.style||'neutro').trim();
  const maxLen  = Math.max(140, Math.min(600, Number(body.maxLen||300)));

  // Fallback locale (sempre disponibile)
  const fallback = () => {
    const v = makeLocalVariants(need, persona, style, maxLen);
    return { variants: v };
  };

  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return j(200, fallback());   // niente chiave → rispondiamo col fallback

  try {
    const system =
      "Sei lo scrittore principale di COLPA MIA. Genera 3 SCUSE credibili, diverse tra loro, " +
      "in italiano naturale, senza rischi legali o sanitari. Evita reati/diagnosi/nomi reali. " +
      "Output SOLO JSON con { variants: [ {style_label,sms,whatsapp_text,email_subject,email_body} x3 ] }.";

    const prompt = {
      need, persona, style, maxLen,
      schema: {
        variants: [
          {style_label:"A", sms:"", whatsapp_text:"", email_subject:"", email_body:""},
          {style_label:"B", sms:"", whatsapp_text:"", email_subject:"", email_body:""},
          {style_label:"C", sms:"", whatsapp_text:"", email_subject:"", email_body:""}
        ]
      }
    };

    const r = await fetch('https://api.openai.com/v1/responses', {
      method:'POST',
      headers:{ 'Authorization':`Bearer ${apiKey}`, 'Content-Type':'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        input: [
          { role:'system', content: system },
          { role:'user',   content: `Restituisci SOLO JSON valido.\nTask:\n${JSON.stringify(prompt)}` }
        ],
        temperature: 0.85, top_p: 0.9, presence_penalty: 0.2, frequency_penalty: 0.25
      })
    });

    const data = await r.json();
    if (!r.ok) return j(200, fallback());

    const raw = data.output_text || '';
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = tryExtractJSON(raw); }

    let variants = Array.isArray(parsed?.variants) ? parsed.variants.slice(0,3) : [];
    // Normalizza e tronca
    variants = variants.map((v,i)=>({
      style_label: String(v?.style_label || ['A','B','C'][i] || 'A').slice(0,12),
      sms:           cut(v?.sms, Math.min(160, maxLen)),
      whatsapp_text: cut(v?.whatsapp_text, maxLen),
      email_subject: cut(v?.email_subject, 80),
      email_body:    cut(v?.email_body, Math.max(300, maxLen+100))
    }));

    if (!variants.length || !variants[0]?.sms) return j(200, fallback());
    return j(200, { variants });

  } catch {
    return j(200, fallback());
  }
};

// ---------- helpers ----------
function cut(s,n){ return String(s||'').slice(0,n); }
function tryExtractJSON(s){
  try{
    const m = String(s||'').match(/\{[\s\S]*\}$/);
    return m ? JSON.parse(m[0]) : {};
  }catch{ return {}; }
}

function makeLocalVariants(need, persona, style, maxLen){
  const base1 = `Ho avuto un imprevisto serio e sto riorganizzando al volo. Ti aggiorno entro le 18 con un orario affidabile. (${need})`;
  const base2 = `È saltata fuori una cosa urgente che non posso rimandare. Preferisco non promettere tempi a vuoto: ti scrivo appena ho un nuovo ETA. (${need})`;
  const base3 = `Situazione imprevista che mi blocca un attimo. Non voglio darti buca: mi prendo qualche minuto e ti aggiorno a breve. (${need})`;

  const tweak = (t)=> cut(t, maxLen);

  const v1 = {
    style_label:'A',
    sms: tweak(base1),
    whatsapp_text: tweak(`Mi scuso: imprevisto ora, sto riorganizzando. Appena ho chiaro l’orario ti scrivo (entro sera).`),
    email_subject: `Aggiornamento tempi — ${persona||'colloquio'}`,
    email_body: cut(
      `Ciao, è sopraggiunto un imprevisto che sto gestendo. Evito promesse a vuoto: ti invio un aggiornamento entro le 18 con un nuovo orario affidabile. Grazie per la pazienza.\n\nContesto: ${need}`,
      Math.max(300, maxLen+100)
    )
  };

  const v2 = {
    style_label:'B',
    sms: tweak(base2),
    whatsapp_text: tweak(`Sto chiudendo un’urgenza e temo un piccolo ritardo. Ti aggiorno a breve con un orario realistico.`),
    email_subject: `Piccolo slittamento`,
    email_body: cut(
      `Ti scrivo per trasparenza: si è presentata una priorità non rimandabile. Sto sistemando e ti confermo una nuova fascia oraria appena possibile (oggi stesso). Grazie per la comprensione.\n\nContesto: ${need}`,
      Math.max(300, maxLen+100)
    )
  };

  const v3 = {
    style_label:'C',
    sms: tweak(base3),
    whatsapp_text: tweak(`Mi dispiace, ho un imprevisto in corso. Minimizzare il ritardo è la priorità: appena definito, ti mando un nuovo slot.`),
    email_subject: `Aggiornamento rapido`,
    email_body: cut(
      `Per correttezza ti aggiorno: sto chiudendo un imprevisto. Voglio darti un’informazione affidabile, quindi ti invio un nuovo orario appena ho certezza (entro sera). Grazie per la pazienza.\n\nContesto: ${need}`,
      Math.max(300, maxLen+100)
    )
  };

  return [v1,v2,v3];
}
