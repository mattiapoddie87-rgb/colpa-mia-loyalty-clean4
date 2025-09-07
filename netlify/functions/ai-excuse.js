// netlify/functions/ai-excuse.js
// Sempre 3 varianti, coerenti al pacchetto. Base fissa per RIUNIONE/TRAFFICO/CONNESSIONE.
// Se l'AI fallisce, generiamo localmente 3 parafrasi diverse delle basi.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const j = (s,b)=>({ statusCode:s, headers:{'Content-Type':'application/json', ...CORS}, body:JSON.stringify(b) });

// Mappa SKU → kind
const KIND = {
  SCUSA_ENTRY:'base', SCUSA_BASE:'base', SCUSA_TRIPLA:'tripla', SCUSA_DELUXE:'deluxe',
  RIUNIONE:'riunione', TRAFFICO:'traffico', CONS_KO:'connessione', CONN_KO:'connessione'
};

// === Basi fisse richieste ===
const TEMPLATES = {
  riunione: [
    'Mi è subentrata una riunione proprio ora. Appena finisco ti aggiorno.',
    'Call imprevista che sta sforando: chiudo e ti confermo i tempi.',
    'Sono dentro a un punto urgente in riunione; appena libero ti faccio sapere.'
  ],
  traffico: [
    'Penso ci sia un incidente: il navigatore segna tempi più lunghi. Ti aggiorno quando si sblocca.',
    'Traffico anomalo sul percorso: riduco il ritardo e ti tengo allineato.',
    'Coda a fisarmonica in tangenziale; procedo piano ma arrivo. Ti scrivo tra poco con un ETA.'
  ],
  connessione: [
    'Ho finito i giga: questo è uno degli ultimi messaggi che posso inviare. Appena riattivo il piano ti aggiorno sul da farsi.',
    'Linea/VPN KO proprio ora: sto ripristinando e ti confermo tempi appena aggancio.',
    'Connessione instabile: passo in tethering e ti aggiorno appena torna stabile.'
  ],
  // Famiglie generiche (non copiano l’hint; lo usano solo come guida mentale lato AI)
  base: [
    'È saltato un imprevisto reale: riduco l’attesa e torno con un orario affidabile.',
    'Sto chiudendo una cosa urgente: preferisco darti tempi precisi tra poco.',
    'Piccolo intoppo organizzativo: mi rimetto in carreggiata e ti aggiorno a breve.'
  ],
  tripla: [
    'Giornata a incastri su più fronti: normalizzo e ti do un orario concreto a breve.',
    'Due sovrapposizioni + un ritardo di filiera: compatto i tempi e ti aggiorno tra poco.',
    'Sto gestendo tre passaggi in sequenza: minimizzo il ritardo e ti confermo quando chiudo.'
  ],
  deluxe: [
    'È emersa una priorità che richiede presenza: riorganizzo con criterio e ti propongo una fascia solida.',
    'Gestisco un imprevisto che merita attenzione: ottimizzo i prossimi passi e ti mando un timing chiaro.',
    'Evito promesse a vuoto: ripianifico con margine e torno con un orario affidabile.'
  ],
};

const TWISTS_A = [
  'Ti aggiorno a breve.',
  'Appena ho un orario credibile, ti scrivo.',
  'Ti tengo allineato senza far perdere tempo.'
];
const TWISTS_B = [
  'Riduciamo l’attesa.',
  'Minimizzo il ritardo.',
  'Evito di farti aspettare più del necessario.'
];

function uniq(arr){ return [...new Set(arr.map(s=>s.trim()))]; }

function varyOnce(str, seedIdx){
  let out = String(str||'').trim();
  const repls = [
    [/appena\b/gi, seedIdx%2 ? 'non appena' : 'appena'],
    [/\bti (aggiorno|faccio sapere)\b/gi, seedIdx%3 ? 'ti aggiorno' : 'ti faccio sapere'],
    [/\bchiudo\b/gi, seedIdx%2 ? 'finisco' : 'chiudo'],
    [/\bproprio ora\b/gi, seedIdx%2 ? 'adesso' : 'proprio ora'],
    [/\binstabile\b/gi, seedIdx%2 ? 'ballerina' : 'instabile'],
  ];
  for (const [re,to] of repls) out = out.replace(re, to);
  const tail = (seedIdx%2 ? TWISTS_A[seedIdx%TWISTS_A.length] : TWISTS_B[seedIdx%TWISTS_B.length]);
  if (!/[.!?]$/.test(out)) out += '.';
  return `${out} ${tail}`.trim();
}

function localGenerate(kind, maxLen){
  const base = (TEMPLATES[kind] || TEMPLATES.base).slice(0,3);
  const out  = base.map((b,i)=> varyOnce(b, i)).map(t=> t.slice(0, maxLen));
  return uniq(out).slice(0,3).map(t => ({ whatsapp_text:t }));
}

// ==== OpenAI (timeout + retry) → parafrasi delle basi ====
async function fetchWithTimeout(url, opt={}, ms=6000){
  const ac = new AbortController();
  const t = setTimeout(()=>ac.abort(), ms);
  try{ return await fetch(url, {...opt, signal:ac.signal}); }
  finally{ clearTimeout(t); }
}
async function callOpenAI({apiKey, baseLines, maxLen, tone}){
  const sys = 'Sei un copywriter italiano. Ricevi 3 frasi BASE e per ognuna generi una PARAFRASI breve e naturale (1–2 frasi), stesso significato (riunione/traffico/connessione ecc.). Niente emoji, niente dettagli medici/legali. Rispondi SOLO con JSON: {"variants":[{"whatsapp_text":"..."},...]}.';
  const usr = JSON.stringify({
    istruzioni: `Parafrasa leggermente, tono ${tone||'neutro'}, max ${maxLen} caratteri. Non copiare l\'hint del cliente, usalo solo come contesto mentale.`,
    base: baseLines
  });

  const body = JSON.stringify({
    model:'gpt-4o-mini',
    input:[
      {role:'system', content: sys},
      {role:'user',   content: usr}
    ],
    temperature:0.6, top_p:0.9, presence_penalty:0.1, frequency_penalty:0.2
  });

  let lastErr=null;
  for (let i=0;i<2;i++){
    try{
      const r = await fetchWithTimeout('https://api.openai.com/v1/responses', {
        method:'POST',
        headers:{ 'Authorization':`Bearer ${apiKey}`, 'Content-Type':'application/json' },
        body
      }, 7000);
      const data = await r.json().catch(()=> ({}));
      if (!r.ok) { lastErr = new Error(data?.error?.message || 'openai_error'); continue; }

      const raw = data.output_text || '';
      let parsed={}; try{ parsed = JSON.parse(raw); }catch{}
      let variants = Array.isArray(parsed?.variants) ? parsed.variants : [];
      variants = variants
        .map(v => String(v?.whatsapp_text || v?.sms || '').trim())
        .filter(Boolean)
        .map(s => s.slice(0,maxLen));

      variants = uniq(variants).slice(0,3);
      if (variants.length === 3) return variants.map(s => ({ whatsapp_text:s }));
    }catch(e){ lastErr=e; }
  }
  throw lastErr || new Error('openai_timeout');
}

exports.handler = async (event)=>{
  if (event.httpMethod === 'OPTIONS') return j(204,{});
  if (event.httpMethod !== 'POST')   return j(405,{error:'method_not_allowed'});

  let body={}; try{ body=JSON.parse(event.body||'{}'); }catch{ return j(400,{error:'bad_json'}); }

  const apiKey = (process.env.OPENAI_API_KEY||'').trim();
  const sku    = String(body.sku||'').toUpperCase();
  const kind   = KIND[sku] || String(body.kind||'base').toLowerCase();
  const tone   = String(body.tone||'neutro');
  const maxLen = Math.max(160, Math.min(420, Number(body.maxLen||320)));

  const baseLines = (TEMPLATES[kind] || TEMPLATES.base).slice(0,3);

  // Senza chiave → solo fallback locale (ma variato)
  if (!apiKey) return j(200, { variants: localGenerate(kind, maxLen) });

  try{
    const ai = await callOpenAI({ apiKey, baseLines, maxLen, tone });
    // se l'AI restituisce meno di 3, completiamo con locale
    if (ai.length < 3){
      const fill = localGenerate(kind, maxLen);
      const mix  = uniq([...ai.map(v=>v.whatsapp_text), ...fill.map(v=>v.whatsapp_text)])
                   .slice(0,3).map(s=>({whatsapp_text:s}));
      return j(200, { variants: mix });
    }
    return j(200, { variants: ai });
  }catch{
    return j(200, { variants: localGenerate(kind, maxLen) });
  }
};
