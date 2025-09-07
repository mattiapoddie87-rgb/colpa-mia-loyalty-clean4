// netlify/functions/ai-excuse.js
// Motore IA stile ChatGPT-4: 3 varianti naturali, coerenti al pacchetto (SKU) e guidate dal contesto (mai copiato).
// ENV richieste: OPENAI_API_KEY (obbl.), OPENAI_MODEL (opz., default "gpt-4o").

const CORS = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'POST,OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type',
};
const j = (s,b)=>({ statusCode:s, headers:{'Content-Type':'application/json',...CORS}, body:JSON.stringify(b) });

const KIND_BY_SKU = {
  SCUSA_ENTRY:'base', SCUSA_BASE:'base', SCUSA_TRIPLA:'tripla', SCUSA_DELUXE:'deluxe',
  RIUNIONE:'riunione', TRAFFICO:'traffico', CONS_KO:'connessione', CONN_KO:'connessione'
};

// questi NON chiedono contesto in checkout
const CONTEXT_NOT_NEEDED = new Set(['riunione','traffico','connessione']);

// ancore semantiche per far “sentire” il tipo al modello
const LEX = {
  base:['aggiornamento affidabile','ridurre il ritardo','nuova fascia'],
  tripla:['incastri','doppio imprevisto','piano di rientro'],
  deluxe:['ownership','priorità reale','mi prendo la responsabilità'],
  riunione:['call','allineamento','uscire dalla riunione','slot'],
  traffico:['coda a fisarmonica','ingorgo','ETA prudente','si sblocca'],
  connessione:['tethering','hotspot','VPN','fallback','linea instabile']
};

// fallback locali (mai copiare need)
function fallback(kind, delay=null){
  const d = delay ? ` (~${delay}′)` : '';
  const pick = (arr)=>arr.slice(0,3);
  switch(kind){
    case 'riunione': return pick([
      `Sono dentro una riunione che sta sforando${d}. Esco e ti propongo uno slot concreto.`,
      `Allineamento urgente esteso oltre il previsto${d}. Appena libero ti mando un orario realistico.`,
      `La call è andata lunga${d}. Chiudo e ti aggiorno con una finestra pulita.`
    ]);
    case 'traffico': return pick([
      `Bloccato in un tratto con coda a fisarmonica${d}. Appena si muove ti do un’ETA prudente.`,
      `Ingorgo improvviso in uscita${d}. Evito promesse: ti aggiorno appena scorre.`,
      `Traffico fermo${d}. Appena passo il tappo ti arrivo senza altri slittamenti.`
    ]);
    case 'connessione': return pick([
      `Linea instabile proprio ora${d}. Passo in tethering come fallback e ti aggiorno appena è stabile.`,
      `VPN capricciosa${d}. Attivo hotspot e continuo così; ti tengo allineato sui tempi.`,
      `ISP ballerino${d}. Ticket aperto; intanto lavoro in tethering e ti scrivo quando torna affidabile.`
    ]);
    case 'tripla': return pick([
      `Giornata di incastri e doppio imprevisto${d}. Metto ordine e ti mando un piano di rientro con tempi veri.`,
      `Tre fattori si sono accavallati${d}. Riduco lo slittamento e ti propongo una finestra prudente.`,
      `Combinazione sfortunata di incastri${d}. Priorità rientro: ti arrivo con un orario sensato a breve.`
    ]);
    case 'deluxe': return pick([
      `È emersa una priorità reale${d}. Mi prendo la responsabilità: rientro oggi con piano chiaro.`,
      `Gestisco io la criticità${d}. Tra poco ti do tempistiche nette, senza sorprese.`,
      `Ownership piena${d}. Sposto di poco e rientro in giornata con percorso pulito.`
    ]);
    default: return pick([
      `È saltato un intoppo operativo${d}. Riduco il ritardo e ti scrivo un orario affidabile a breve.`,
      `C’è stata un’urgenza${d}. Niente promesse a vuoto: ti aggiorno tra poco con tempi chiari.`,
      `Piccolo imprevisto reale${d}. Appena stabilizzato ti propongo una nuova fascia con margine.`
    ]);
  }
}

exports.handler = async (event)=>{
  if(event.httpMethod==='OPTIONS') return j(204,{});
  if(event.httpMethod!=='POST')    return j(405,{error:'method_not_allowed'});

  const API = (process.env.OPENAI_API_KEY||'').trim();
  if(!API) return j(500,{error:'missing_OPENAI_API_KEY'});

  let body={}; try{ body=JSON.parse(event.body||'{}'); }catch{ return j(400,{error:'bad_json'}); }

  // ingress (dai tuoi webhook/checkout: sku, need, tone, locale, delay…)
  const sku    = String(body.sku||body.productTag||'').toUpperCase();
  const kind   = String(body.kind||KIND_BY_SKU[sku]||'base');
  const tone   = String(body.tone||'neutro');
  const locale = String(body.locale||'it-IT');
  const delay  = Number(body.delay||0)||null;
  const recip  = String(body.recipient||'').slice(0,60);

  // il contesto è solo un “hint” per guidare, MAI da citare testualmente
  const hintRaw = CONTEXT_NOT_NEEDED.has(kind) ? '' : String(body.need||'').slice(0,600);
  const hint    = hintRaw ? `Hint (non citare): ${hintRaw}` : 'Nessun hint';

  const maxLen = Math.max(180, Math.min(420, Number(body.maxLen||320)));
  const model  = (process.env.OPENAI_MODEL||'gpt-4o').trim();
  const anchors= LEX[kind] || LEX.base;

  const system = [
    'Sei un copywriter italiano empatico e concreto.',
    'Obiettivo: 3 varianti WhatsApp naturali, coerenti al TIPO (kind) e al tono, senza emoji/superlativi.',
    'Ogni variante deve avere apertura diversa, lessico e struttura diversi, e un next-step concreto.',
    'NON citare l’hint: usalo solo per orientare la situazione.',
    'Evita reati, diagnosi mediche, dati identificabili.',
  ].join(' ');

  const user = {
    kind, tone, locale, delay, recipient: recip,
    anchors_for_kind: anchors,
    angles: [
      'riconoscimento + causa sintetica + next-step chiaro',
      'ownership + piano di rientro con soglia temporale',
      'empatia sobria + prudenza + piccola azione immediata'
    ],
    hint,
    constraints: {
      per_variant_anchor_required: true,
      no_anchor_reuse_across_variants: true,
      length_max: maxLen
    },
    schema: {
      variants: [
        { whatsapp_text:"", email_subject:"", email_body:"" },
        { whatsapp_text:"", email_subject:"", email_body:"" },
        { whatsapp_text:"", email_subject:"", email_body:"" }
      ]
    },
    request: `Genera ESATTAMENTE 3 varianti. WhatsApp: <= ${maxLen} caratteri, 1–2 frasi, italiano naturale.`
  };

  try{
    const r = await fetch('https://api.openai.com/v1/responses',{
      method:'POST',
      headers:{ 'Authorization':`Bearer ${API}`, 'Content-Type':'application/json' },
      body: JSON.stringify({
        model,
        temperature: 1.05, top_p: 0.92, presence_penalty: 0.6, frequency_penalty: 0.45,
        seed: (Date.now() ^ (sku?sku.length:17)) % 1000000,
        input: [
          { role:'system', content: system },
          { role:'user',   content: JSON.stringify(user) }
        ]
      })
    });
    const data = await r.json();
    const raw  = String(data?.output_text||'').trim();

    let parsed=null; try{ parsed = JSON.parse(raw); }catch{}
    let arr = Array.isArray(parsed?.variants) ? parsed.variants : [];
    const clamp = (s,n)=>String(s||'').replace(/\s+/g,' ').trim().slice(0,n);

    let out = arr.map(v=>({
      whatsapp_text: clamp(v.whatsapp_text || v.text || '', maxLen),
      email_subject: clamp(v.email_subject || 'La tua scusa', 80),
      email_body:    clamp(v.email_body || v.whatsapp_text || '', Math.max(300, maxLen+120))
    })).filter(v=>v.whatsapp_text);

    // dedup forte
    const seen=new Set(), uniq=[];
    for(const v of out){
      const k=v.whatsapp_text.slice(0,72).toLowerCase();
      if(seen.has(k)) continue;
      seen.add(k); uniq.push(v);
      if(uniq.length===3) break;
    }
    if(uniq.length===3) return j(200,{ variants: uniq });

    // fallback coerente al tipo
    const pool = fallback(kind, delay).map(t=>({
      whatsapp_text: clamp(t,maxLen),
      email_subject: 'La tua scusa',
      email_body:    clamp(t, Math.max(300, maxLen+120))
    }));
    while(uniq.length<3) uniq.push(pool[uniq.length] || pool[0]);
    return j(200,{ variants: uniq.slice(0,3), fallback:true });

  }catch{
    const pool = fallback(kind, delay).map(t=>({
      whatsapp_text: t.slice(0,maxLen),
      email_subject: 'La tua scusa',
      email_body:    t
    }));
    return j(200,{ variants: pool, fallback:true });
  }
};
