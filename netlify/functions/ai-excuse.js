// netlify/functions/ai-excuse.js
const CORS = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'POST,OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type',
};
const j = (s,b)=>({statusCode:s,headers:{'Content-Type':'application/json',...CORS},body:JSON.stringify(b)});

// SKU -> tipo semantico
const KIND_BY_SKU = {
  SCUSA_ENTRY:'base', SCUSA_BASE:'base', SCUSA_TRIPLA:'tripla', SCUSA_DELUXE:'deluxe',
  RIUNIONE:'riunione', TRAFFICO:'traffico', CONS_KO:'connessione'
};
// questi non richiedono contesto in checkout
const CONTEXT_NOT_NEEDED = new Set(['riunione','traffico','connessione']);

function kindBrief(kind){
  switch(kind){
    case 'riunione': return `Riunione imprevista/allungata. Lessico: meeting, allineamento, uscita dalla call. Next-step: proporre nuovo slot breve. Vietato: rete/traffico.`;
    case 'traffico': return `Ingorgo/code. Lessico: coda a fisarmonica, tratto bloccato, ETA prudente. Next-step: aggiornare quando scorre. Vietato: riunioni/rete.`;
    case 'connessione': return `Rete/VPN/ISP instabile. Lessico: tethering/hotspot, fallback, ticket aperto (senza ID). Next-step: attivo fallback e aggiorno. Vietato: traffico/riunioni.`;
    case 'tripla': return `Tre fattori sovrapposti (incastri). Lessico: incastri, doppio imprevisto, priorità. Next-step: piano di rientro prudente. Vietato: termini di rete/traffico.`;
    case 'deluxe': return `Criticità reale con tono executive/ownership. Lessico sobrio, impegno forte, rientro in giornata. Vietato: giustificazioni banali.`;
    default: return `Imprevisto operativo generico, tono naturale e credibile. Next-step: aggiornamento con orario affidabile.`;
  }
}

const ANGLES = [
  'riconosci il disservizio + causa sintetica + impegno concreto',
  'ownership (“me ne occupo io”) + piano di rientro chiaro',
  'empatia sobria + prudenza sui tempi + micro-azione immediata'
];

function fallbackBank(kind, delay=null){
  const d = delay ? ` (≈${delay}′)` : '';
  const pick = (arr)=>arr.slice(0,3);
  switch(kind){
    case 'connessione': return pick([
      `Connessione instabile proprio ora${d}. Passo in tethering e ti aggiorno appena è stabile.`,
      `La VPN è in tilt${d}. Attivo il fallback e ti scrivo quando la linea torna affidabile.`,
      `Router/ISP con un intoppo${d}. Apro il ticket e, intanto, uso hotspot: ti tengo allineato.`
    ]);
    case 'traffico': return pick([
      `Bloccato in un ingorgo${d}. Evito tempi a caso: ti aggiorno appena scorre e recupero.`,
      `Coda a fisarmonica sul tratto che sto percorrendo${d}. Ti scrivo non appena passo il tappo.`,
      `Traffico improvviso${d}. Appena si libera ti raggiungo e riorganizzo senza altri slittamenti.`
    ]);
    case 'riunione': return pick([
      `La riunione si è allungata${d}. Esco e ti propongo subito un nuovo slot concreto.`,
      `È partita un’escalation in meeting${d}. Appena rientro ti aggiorno con un orario affidabile.`,
      `Allineamento urgente ha preso più tempo${d}. Appena libero ti scrivo per fissare.`
    ]);
    case 'tripla': return pick([
      `Giornata a incastri: due imprevisti + un allineamento extra${d}. Metto ordine e ti aggiorno con ETA reale.`,
      `Tre fattori si sono sovrapposti${d}. Chiudo l’essenziale e ti propongo un orario prudente.`,
      `Combo poco fortunata (incastri)${d}. Priorità: rientrare bene; ti scrivo tra poco col piano.`
    ]);
    case 'deluxe': return pick([
      `È emersa una criticità concreta${d}. Me ne occupo e rientro oggi con un piano chiaro.`,
      `Mi prendo la responsabilità: gestione prioritaria${d}. Ti aggiorno a minuti con tempistiche pulite.`,
      `Priorità reale sopraggiunta${d}. Sposto di poco e torno allineato su di te.`
    ]);
    default: return pick([
      `È saltato un imprevisto operativo e mi sto riorganizzando${d}. Appena ho un orario affidabile ti scrivo.`,
      `C’è stata un’urgenza${d}. Evito promesse a vuoto: ti aggiorno tra poco con tempi chiari.`,
      `Piccolo intoppo reale${d}. Minimizzo il ritardo e ti propongo a breve un nuovo slot.`
    ]);
  }
}

exports.handler = async (event)=>{
  if(event.httpMethod==='OPTIONS') return j(204,{});
  if(event.httpMethod!=='POST')    return j(405,{error:'method_not_allowed'});

  const API=(process.env.OPENAI_API_KEY||'').trim();
  if(!API) return j(500,{error:'missing_OPENAI_API_KEY'});

  let body={}; try{ body=JSON.parse(event.body||'{}'); }catch{ return j(400,{error:'bad_json'}); }

  const sku   = String(body.sku||body.productTag||'').toUpperCase();
  const kind  = String(body.kind||KIND_BY_SKU[sku]||'base');
  const delay = Number(body.delay||body.delayMin||0)||null;
  const recip = String(body.recipient||'').slice(0,60);
  const style = String(body.style||'neutro');
  const locale= String(body.locale||'it-IT');
  const max   = Math.max(160, Math.min(420, Number(body.maxLen||320)));
  const hint  = CONTEXT_NOT_NEEDED.has(kind) ? '' : String(body.need||'').slice(0,600);

  const system = [
    'Sei un copywriter italiano, empatico e pratico.',
    'Scrivi scuse credibili, 1–2 frasi, senza emoji né superlativi.',
    'Le 3 varianti DEVONO avere lessico/struttura/strategia diverse.',
    'Ogni variante include un next-step concreto (aggiorno, propongo slot, attivo fallback).',
    'Se presente delay, alludilo con prudenza (mai promesse rigide).',
    'NON copiare né parafrasare l’hint: serve solo come bussola interna.',
    'Niente dati personali o tecnicismi identificanti.',
    'Rispetta le regole del tipo scelto.'
  ].join(' ');

  const user = {
    kind, style, locale, delay, recipient:recip,
    brief: kindBrief(kind),
    angles: ANGLES,
    hint: hint ? `Hint interno: ${hint}` : 'Nessun hint',
    request: `Genera ESATTAMENTE 3 varianti WhatsApp, ognuna <= ${max} caratteri, naturali e non ripetitive.
              Output SOLO JSON: {"variants":[{"whatsapp_text":"...","email_subject":"...","email_body":"..."}]}`
  };

  try{
    const r = await fetch('https://api.openai.com/v1/responses',{
      method:'POST',
      headers:{'Authorization':`Bearer ${API}`,'Content-Type':'application/json'},
      body: JSON.stringify({
        model:(process.env.OPENAI_MODEL_||'gpt-4o-mini').trim(),
        input:[{role:'system',content:system},{role:'user',content:JSON.stringify(user)}],
        temperature:0.95, top_p:0.9, presence_penalty:0.5, frequency_penalty:0.35
      })
    });
    const data = await r.json();
    const raw  = String(data?.output_text||'').trim();
    let parsed=null; try{ parsed=JSON.parse(raw); }catch{}

    let vars = Array.isArray(parsed?.variants) ? parsed.variants : [];
    vars = vars.map(v=>({
      whatsapp_text: String(v.whatsapp_text||v.text||'').slice(0,max),
      email_subject: String(v.email_subject||'La tua scusa'),
      email_body:    String(v.email_body||v.whatsapp_text||'').slice(0,600)
    }))
    .filter(v=>v.whatsapp_text)
    .filter((v,i,arr)=>arr.findIndex(x=>x.whatsapp_text.slice(0,40)===v.whatsapp_text.slice(0,40))===i)
    .slice(0,3);

    if(vars.length===3) return j(200,{variants:vars});

    const pool = fallbackBank(kind,delay).map(t=>({
      whatsapp_text:t.slice(0,max), email_subject:'La tua scusa', email_body:t
    }));
    while(vars.length<3) vars.push(pool[vars.length] || pool[0]);
    return j(200,{variants:vars.slice(0,3),fallback:true});
  }catch{
    const pool = fallbackBank(kind,delay).map(t=>({
      whatsapp_text:t.slice(0,max), email_subject:'La tua scusa', email_body:t
    }));
    return j(200,{variants:pool,fallback:true});
  }
};
