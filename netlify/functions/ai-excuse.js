// ai-excuse.js — Generatore di scuse pro-grade (3 varianti) ITA
// Richiede OPENAI_API_KEY (sk_live.../sk-...)
// Prova prima /v1/responses, poi /v1/chat/completions; se tutto fallisce produce 3 fallback credibili.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const j = (s,b)=>({statusCode:s,headers:{'Content-Type':'application/json',...CORS},body:JSON.stringify(b)});

exports.handler = async (event)=>{
  if(event.httpMethod==='OPTIONS') return j(204,{});
  if(event.httpMethod!=='POST')   return j(405,{error:'method_not_allowed'});

  const apiKey=(process.env.OPENAI_API_KEY||'').trim();
  if(!/^sk-/.test(apiKey)) return j(500,{error:'server_misconfigured: missing OPENAI_API_KEY'});

  let body={}; try{ body=JSON.parse(event.body||'{}'); }catch{ return j(400,{error:'bad_json'}); }

  const need    = String(body.need||'').trim() || 'ritardo';
  const style   = String(body.style||'neutro').trim();
  const persona = String(body.persona||'generico').trim();
  const locale  = String(body.locale||'it-IT').trim();
  const city    = String(body.city||'').trim();
  const maxLen  = Math.max(140, Math.min(600, Number(body.maxLen||300)));

  // -------- prompt
  const system = [
    "Sei lo scrittore principale di COLPA MIA.",
    "Genera SCUSE in italiano, credibili, naturali, verificabili e senza rischi legali o sanitari.",
    "Vieta contenuti illegali, diffamatori, diagnosi mediche o persone reali identificabili.",
    "Inserisci micro-dettagli plausibili (tempi realistici, riferimenti generici), mai overdrama o toni robotici.",
    "Produci TRE VARIANTI tra loro diverse (taglio/lessico/struttura).",
    "Output SOLO JSON valido con schema { variants:[{style_label,sms,whatsapp_text,email_subject,email_body,escalation,risk_score,red_flags[]}, ...] }."
  ].join(' ');

  const user = {
    context: { need, style, persona, locale, city, maxLen },
    constraints: {
      forbid: ["diagnosi mediche","reati","citare persone reali"],
      must_have: ["tono credibile","nessun overdrama","tempi realistici (es. 'entro le 18')"]
    },
    schema: {
      variants: [
        { style_label:"A", sms:"", whatsapp_text:"", email_subject:"", email_body:"", escalation:"", risk_score:0, red_flags:[] },
        { style_label:"B", sms:"", whatsapp_text:"", email_subject:"", email_body:"", escalation:"", risk_score:0, red_flags:[] },
        { style_label:"C", sms:"", whatsapp_text:"", email_subject:"", email_body:"", escalation:"", risk_score:0, red_flags:[] }
      ]
    }
  };

  try{
    // 1) Responses API
    const r1 = await fetch('https://api.openai.com/v1/responses',{
      method:'POST',
      headers:{'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json'},
      body: JSON.stringify({
        model:'gpt-4o-mini',
        input:[
          {role:'system',content:system},
          {role:'user',content:`Restituisci SOLO JSON valido. Task:\n${JSON.stringify(user)}`}
        ],
        temperature:0.85, top_p:0.9, presence_penalty:0.2, frequency_penalty:0.25
      })
    });
    if(r1.ok){
      const data = await r1.json();
      const raw  = String(data.output_text||'').trim();
      const parsed = safeParseJSON(raw);
      const out = normalize(parsed?.variants||[], maxLen, need);
      if(out.length) return j(200,{variants: out});
    }

    // 2) Chat Completions (fallback)
    const r2 = await fetch('https://api.openai.com/v1/chat/completions',{
      method:'POST',
      headers:{'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json'},
      body: JSON.stringify({
        model:'gpt-4o-mini',
        messages:[
          {role:'system', content:system},
          {role:'user',   content:`Restituisci SOLO JSON valido. Task:\n${JSON.stringify(user)}`}
        ],
        temperature:0.85, top_p:0.9
      })
    });
    if(r2.ok){
      const data = await r2.json();
      const raw  = (data.choices?.[0]?.message?.content||'').trim();
      const parsed = safeParseJSON(raw);
      const out = normalize(parsed?.variants||[], maxLen, need);
      if(out.length) return j(200,{variants: out});
    }
  }catch{}

  // 3) Fallback duro — MAI a mani vuote
  return j(200,{variants: fallback(need).map(v=>wrap(v,maxLen))});
};

// -------- utils
function safeParseJSON(s){
  try{ return JSON.parse(s); }catch{}
  try{ const m=String(s||'').match(/\{[\s\S]*\}$/); return m?JSON.parse(m[0]):{}; }catch{}
  return {};
}
function clamp(s,n){ return String(s||'').slice(0,n); }
function wrap(text,maxLen){
  return {
    style_label:'A',
    sms: clamp(text, Math.min(160,maxLen)),
    whatsapp_text: clamp(text, maxLen),
    email_subject: 'Aggiornamento sui tempi',
    email_body: `Ciao, ${text} Preferisco darti un orario affidabile: ti aggiorno entro le 18 con un nuovo slot. Grazie per la pazienza.`,
    escalation: 'Se chiedono dettagli, proponi nuova fascia (es. domani 9–11) o alternativa breve in call.',
    risk_score: 0.12, red_flags:[]
  };
}
function normalize(list,maxLen,need){
  if(!Array.isArray(list)) return [];
  const out = list.map(v=>({
    style_label: String(v?.style_label||'').slice(0,12)||'A',
    sms:           clamp(v?.sms||v?.whatsapp_text||fallback(need)[0], Math.min(160,maxLen)),
    whatsapp_text: clamp(v?.whatsapp_text||v?.sms||fallback(need)[0], maxLen),
    email_subject: clamp(v?.email_subject||'Aggiornamento sui tempi', 80),
    email_body:    clamp(v?.email_body||`Ciao, ${fallback(need)[0]} Ti invio un nuovo orario entro le 18.`, Math.max(300,maxLen+100)),
    escalation:    clamp(v?.escalation||'Proponi una nuova fascia e alternativa breve in call.',220),
    risk_score:    Math.max(0,Math.min(1,Number(v?.risk_score||0))),
    red_flags:     Array.isArray(v?.red_flags)? v.red_flags.slice(0,5):[]
  }));
  // de-dup su sms/whatsapp_text
  const seen=new Set(), uniq=[];
  for(const v of out){ const k=(v.sms+v.whatsapp_text).toLowerCase(); if(seen.has(k)) continue; seen.add(k); uniq.push(v); }
  return uniq.slice(0,3);
}
function fallback(need){
  const n = need ? ` (${need.slice(0,60)})` : '';
  return [
    `Ho avuto un imprevisto serio e sto riorganizzando al volo: arrivo più tardi ma ti aggiorno entro le 18 con un orario certo.${n}`,
    `È saltata fuori una cosa urgente che non posso rimandare: riduco il ritardo e ti scrivo appena ho un ETA affidabile (oggi).${n}`,
    `Situazione imprevista che mi blocca qualche minuto: non voglio darti buca, mi prendo il tempo di sistemare e ti do un nuovo slot a breve.${n}`
  ];
}
