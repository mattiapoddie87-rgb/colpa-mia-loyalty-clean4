// Generatore SCUSE “come il chatbot” – 3 varianti davvero diverse
// Usa lo stesso motore OpenAI del bot (Responses API).
const CORS = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Methods":"POST,OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type"
};
const j = (s,b)=>({statusCode:s,headers:{ "Content-Type":"application/json",...CORS },body:JSON.stringify(b)});

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return j(204,{});
  if (event.httpMethod !== "POST")   return j(405,{error:"method_not_allowed"});

  const apiKey = (process.env.OPENAI_API_KEY||"").trim();
  if (!apiKey) return j(500,{error:"missing_OPENAI_API_KEY"});

  let body={}; try{ body=JSON.parse(event.body||"{}"); }catch{ return j(400,{error:"bad_json"}); }

  const need    = String(body.need||"").slice(0,600);
  const persona = String(body.persona||"generico");
  const style   = String(body.style||"neutro");
  const locale  = String(body.locale||"it-IT");
  const seed    = String(body.seed||"");
  const maxLen  = Math.max(180, Math.min(420, Number(body.maxLen||320)));

  const sys = [
    "Sei lo scrittore principale di COLPA MIA, specializzato in scuse credibili.",
    "Regole:",
    "1) 3 VARIANTI tra loro DAVVERO DIVERSE (lessico, struttura, approccio).",
    "2) Evita reati, diagnosi mediche, nomi reali; toni plausibili, misurati.",
    "3) Usa l’italiano naturale, con tempi realistici (es. entro le 18, domani mattina).",
    "4) Adatta al contesto dell’utente e alla persona/pacchetto.",
    "5) Output SOLO JSON valido: {variants:[{whatsapp_text:\"...\"},{...},{...}]}"
  ].join(" ");

  const usr = {
    need, persona, style, locale, seed, maxLen,
    want:"Tre varianti WhatsApp pronte da inviare, ogni variante <= "+maxLen+" caratteri."
  };

  try{
    const r = await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{ "Authorization":`Bearer ${apiKey}`, "Content-Type":"application/json" },
      body: JSON.stringify({
        model:"gpt-4o-mini",
        input:[
          {role:"system",content:sys},
          {role:"user",content:JSON.stringify(usr)}
        ],
        temperature:0.95, top_p:0.95, presence_penalty:0.3, frequency_penalty:0.25,
        seed: seed ? undefined : undefined
      })
    });
    const data = await r.json();
    if (!r.ok) return j(r.status,{error:data?.error?.message||"openai_error"});

    const raw = data.output_text || "";
    let parsed; try{ parsed = JSON.parse(raw); }catch{ parsed = {}; }
    const variants = Array.isArray(parsed?.variants) ? parsed.variants
      .map(v=>({ whatsapp_text: String(v.whatsapp_text||v.sms||"").slice(0,maxLen) }))
      .filter(v=>v.whatsapp_text).slice(0,3) : [];

    if (variants.length) return j(200,{variants});
  }catch{}

  // Fallback robusto (comunque varie)
  return j(200,{variants:[
    {whatsapp_text:"Mi è entrato un imprevisto serio e sto riorganizzando al volo. Appena ho un orario affidabile, ti scrivo entro sera."},
    {whatsapp_text:"Sto chiudendo un’urgenza e potrei sforare. Preferisco non promettere a vuoto: ti aggiorno tra poco con tempi chiari."},
    {whatsapp_text:"Situazione imprevista che mi blocca. Minimizzare il ritardo è la priorità: ti propongo un nuovo slot a breve."}
  ]});
};
