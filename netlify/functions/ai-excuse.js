// netlify/functions/ai-excuse.js
const CORS={ "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"POST,OPTIONS", "Access-Control-Allow-Headers":"Content-Type" };
const j=(s,b)=>({statusCode:s,headers:{ "Content-Type":"application/json",...CORS },body:JSON.stringify(b)});

exports.handler = async (event)=>{
  if(event.httpMethod==="OPTIONS") return j(204,{});
  if(event.httpMethod!=="POST")   return j(405,{error:"method_not_allowed"});

  const apiKey=(process.env.OPENAI_API_KEY||"").trim();
  const model =(process.env.OPENAI_MODEL_||"gpt-4o-mini").trim();
  if(!apiKey) return j(500,{error:"missing_OPENAI_API_KEY"});

  let body={}; try{ body=JSON.parse(event.body||"{}"); }catch{ return j(400,{error:"bad_json"}); }
  const need   = String(body.need||"").slice(0,600);
  const persona= String(body.persona||"generico");
  const style  = String(body.style||"neutro");
  const locale = String(body.locale||"it-IT");
  const maxLen = Math.max(160,Math.min(420,Number(body.maxLen||320)));
  const seed   = Date.now(); // forza variabilità

  const system =
`Sei lo scrittore di COLPA MIA. Genera SCUSE credibili in italiano.
Regole: (1) restituisci SOLO JSON valido, nessun markdown. (2) 3 VARIANTI davvero diverse
(lessico/struttura/approccio). (3) Tono ${style}. (4) Adatta a persona "${persona}" e al contesto.
Schema JSON: {"variants":[{"whatsapp_text": "..."},{"whatsapp_text":"..."},{"whatsapp_text":"..."}]}`;

  const user = `Contesto: ${need || "imprevisto generico"}. Locale: ${locale}. max=${maxLen}. seed=${seed}`;

  try{
    const r = await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{ "Authorization":`Bearer ${apiKey}`, "Content-Type":"application/json" },
      body: JSON.stringify({
        model, temperature:0.9, top_p:0.95, presence_penalty:0.3, frequency_penalty:0.2,
        input: [
          {role:"system", content:system},
          {role:"user",   content:user}
        ]
      })
    });
    const data = await r.json();
    if(!r.ok) return j(r.status,{error:data?.error?.message||"openai_error"});

    // testo → JSON pulito (niente ```json)
    const raw = (data.output_text || "")
      .replace(/```json|```/gi,"")
      .trim();

    let parsed=null; try{ parsed=JSON.parse(raw); }catch{}
    let variants = Array.isArray(parsed?.variants) ? parsed.variants : [];

    // fallback: prova a splittare righe/elenco
    if(!variants.length){
      const lines = raw.split(/\n+/).map(s=>s.replace(/^-+\s*/,'').trim()).filter(Boolean).slice(0,3);
      variants = lines.map(t=>({whatsapp_text:t}));
    }

    variants = variants
      .map(v=>({whatsapp_text:String(v.whatsapp_text||v.sms||v.text||"").slice(0,maxLen)}))
      .filter(v=>v.whatsapp_text)
      .slice(0,3);

    if(variants.length===3) return j(200,{variants});
  }catch(e){/* fallthrough */}

  // fallback locale (comunque 3 diverse)
  return j(200,{variants:[
    {whatsapp_text:"Mi è entrato un imprevisto serio e sto riorganizzando al volo. Appena ho un orario affidabile ti aggiorno entro sera."},
    {whatsapp_text:"Sto chiudendo un’urgenza e potrei sforare. Preferisco non promettere a vuoto: ti aggiorno tra poco con tempi chiari."},
    {whatsapp_text:"Situazione imprevista che mi blocca. Minimizzare il ritardo è la priorità: ti propongo subito un nuovo slot."}
  ]});
};
