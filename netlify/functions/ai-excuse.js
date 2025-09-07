// netlify/functions/ai-excuse.js
const CORS = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'POST,OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type',
};
const j = (s,b)=>({ statusCode:s, headers:{'Content-Type':'application/json',...CORS}, body:JSON.stringify(b) });

const KIND_BY_SKU = {
  SCUSA_ENTRY:'base', SCUSA_BASE:'base', SCUSA_TRIPLA:'tripla', SCUSA_DELUXE:'deluxe',
  RIUNIONE:'riunione', TRAFFICO:'traffico', CONS_KO:'connessione'
};
const CONTEXT_NOT_NEEDED = new Set(['riunione','traffico','connessione']);

function bank(kind, delay=null){
  const d = delay ? ` (≈${delay}′)` : '';
  switch(kind){
    case 'riunione': return [
      `Mi spiace, una riunione si è allungata più del previsto${d}. Appena esco ti aggiorno con un orario chiaro.`,
      `Sono ancora bloccato in un meeting imprevisto${d}. Ti scrivo io appena rientro per fissare subito.`,
      `Riunione extra iniziata ora${d}. Non voglio fare promesse vuote: appena libero ti propongo un nuovo slot.`
    ];
    case 'traffico': return [
      `Bloccato nel traffico${d}. Appena scorre ti aggiorno con un’ETA onesta e recupero il ritardo.`,
      `Code a fisarmonica, sto avanzando piano${d}. Preferisco evitare tempi a caso: ti avviso appena passo il tappo.`,
      `Ingorgo improvviso${d}. Appena la strada si sblocca ti raggiungo e mi riorganizzo subito.`
    ];
    case 'connessione': return [
      `Connessione instabile proprio ora${d}. Passo in tethering e ti mando tutto appena torna stabile.`,
      `Router/VPN in tilt${d}. Sto ripristinando: appena la rete è affidabile ti aggiorno senza farti attendere.`,
      `Linea giù all’improvviso${d}. Apro un fallback e ti avviso appena rientra.`
    ];
    case 'deluxe': return [
      `Ti chiedo scusa: è emersa una priorità reale${d}. Recupero oggi stesso e rientro con un piano chiaro.`,
      `Sto gestendo una criticità concreta${d}. Mi assumo la responsabilità e ti aggiorno a minuti con tempistiche pulite.`,
      `C’è un intoppo serio da chiudere bene${d}. Sposto di poco e torno concentrato su di te.`
    ];
    case 'tripla': return [
      `Giornata a incastri: ne chiudo tre in fila${d}. Ti aggiorno a breve con un’ETA realistica.`,
      `Due imprevisti e un allineamento extra${d}. Metto ordine e ti scrivo appena allineato.`,
      `Combo poco fortunata oggi${d}. Chiudo i pezzi e rientro da te senza altri slittamenti.`
    ];
    case 'base':
    default: return [
      `C’è un imprevisto operativo e mi sto riorganizzando${d}. Appena ho un orario affidabile ti scrivo.`,
      `Mi spiace, è saltata una cosa urgente${d}. Evito promesse a vuoto: ti aggiorno tra poco con tempi chiari.`,
      `Piccolo intoppo reale${d}. Priorità: minimizzare il ritardo. Ti propongo a breve un nuovo slot.`
    ];
  }
}

exports.handler = async (event)=>{
  if(event.httpMethod==='OPTIONS') return j(204,{});
  if(event.httpMethod!=='POST')    return j(405,{error:'method_not_allowed'});

  const API = (process.env.OPENAI_API_KEY||'').trim();
  if(!API) return j(500,{error:'missing_OPENAI_API_KEY'});

  let body={}; try{ body=JSON.parse(event.body||'{}'); }catch{ return j(400,{error:'bad_json'}); }

  const sku   = String(body.sku||body.productTag||'').toUpperCase();
  const kind  = String(body.kind||KIND_BY_SKU[sku]||'base');
  const delay = Number(body.delay||body.delayMin||0) || null;
  const recip = String(body.recipient||'').slice(0,60);
  const style = String(body.style||'neutro');
  const locale= String(body.locale||'it-IT');
  const max   = Math.max(160, Math.min(420, Number(body.maxLen||320)));

  // per i kind “tematici” ignoriamo il need; per gli altri lo usiamo come hint NON citabile
  const rawNeed = CONTEXT_NOT_NEEDED.has(kind) ? '' : String(body.need||'').slice(0,600);

  const sys = [
    'Sei un copywriter italiano empatico e pratico.',
    'Scrivi scuse credibili, 1–2 frasi, senza emoji/superlativi.',
    'Tono naturale e umano: riconosci il disagio, proponi un passo successivo concreto e prudente.',
    'Produci ESATTAMENTE 3 VARIANTI, tra loro diverse (lessico/struttura/strategia).',
    'Adatta al tipo di scusa (kind). Se presente recipient, puoi aprire con il suo nome.',
    'Se è presente delay, alludilo con prudenza (niente promesse rigide).',
    'NON riportare/citare il contesto (hint) né in modo esplicito né parafrasando.',
    'Output SOLO JSON: {"variants":[{"whatsapp_text":"...","email_subject":"...","email_body":"..."}]}'
  ].join(' ');

  const usr = {
    kind, style, locale, delay, recipient: recip,
    hint: rawNeed ? `Contesto interno (non citare): ${rawNeed}` : 'Nessun contesto da citare.',
    request: `Genera 3 varianti WhatsApp, ognuna <= ${max} caratteri. Empatiche, concrete, mai ripetitive.`
  };

  try{
    const r = await fetch('https://api.openai.com/v1/responses',{
      method:'POST',
      headers:{'Authorization':`Bearer ${API}`,'Content-Type':'application/json'},
      body: JSON.stringify({
        model:(process.env.OPENAI_MODEL_||'gpt-4o-mini').trim(),
        input:[ {role:'system',content:sys}, {role:'user',content:JSON.stringify(usr)} ],
        temperature:0.9, top_p:0.9, presence_penalty:0.4, frequency_penalty:0.25
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
    })).filter(v=>v.whatsapp_text).slice(0,3);

    if(!vars.length){
      const pool = bank(kind,delay).slice(0,3).map(t=>({
        whatsapp_text:t.slice(0,max), email_subject:'La tua scusa', email_body:t
      }));
      return j(200,{variants:pool,fallback:true});
    }
    while(vars.length<3){
      const t = bank(kind,delay)[vars.length] || bank(kind,delay)[0];
      vars.push({whatsapp_text:t.slice(0,max),email_subject:'La tua scusa',email_body:t});
    }
    return j(200,{variants:vars.slice(0,3)});
  }catch{
    const pool = bank(kind,delay).slice(0,3).map(t=>({
      whatsapp_text:t.slice(0,max), email_subject:'La tua scusa', email_body:t
    }));
    return j(200,{variants:pool,fallback:true});
  }
};
