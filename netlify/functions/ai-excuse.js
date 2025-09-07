// netlify/functions/ai-excuse.js
// 3 varianti COERENTI al tipo (sku) + VARIAZIONE forte di lessico/struttura.
// Il contesto (need) è SOLO un hint interno: NON va mai copiato.

const CORS = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'POST,OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type',
};
const j = (s,b)=>({statusCode:s,headers:{'Content-Type':'application/json',...CORS},body:JSON.stringify(b)});

// Mappa SKU -> tipo semantico
const KIND_BY_SKU = {
  SCUSA_ENTRY:'base', SCUSA_BASE:'base', SCUSA_TRIPLA:'tripla', SCUSA_DELUXE:'deluxe',
  RIUNIONE:'riunione', TRAFFICO:'traffico', CONS_KO:'connessione', CONN_KO:'connessione'
};

// Questi NON chiedono contesto in checkout (hint opzionale)
const CONTEXT_NOT_NEEDED = new Set(['riunione','traffico','connessione']);

// Ancore linguistiche per rendere il testo aderente al tipo
const LEX = {
  riunione:   ['riunione','call','allineamento','slot','uscire dalla call','aggiorno quando esco'],
  traffico:   ['coda a fisarmonica','ingorgo','tratto','uscita','ETA prudente','si sblocca'],
  connessione:['tethering','hotspot','VPN','fallback','linea instabile','ticket aperto'],
  tripla:     ['incastri','doppio imprevisto','priorità','piano di rientro','ridurre lo slittamento'],
  deluxe:     ['ownership','priorità reale','rientro in giornata','piano chiaro','mi prendo la responsabilità'],
  base:       ['imprevisto operativo','aggiornamento affidabile','ridurre il ritardo','nuovo orario']
};

// Angoli retorici diversi per ogni variante
const ANGLES = [
  'riconoscimento + causa sintetica + next-step concreto',
  'ownership (“me ne occupo io”) + piano di rientro con soglia temporale',
  'empatia sobria + prudenza sui tempi + piccola azione immediata'
];

// Fallback locali differenziati (mai copiare il need)
function fallback(kind, delay=null){
  const d = delay ? ` (~${delay}′)` : '';
  const pick = (arr)=>arr.slice(0,3);
  switch(kind){
    case 'riunione': return pick([
      `Sono bloccato in una riunione che si è allungata${d}. Esco e ti propongo subito uno slot concreto.`,
      `Ci hanno tirato dentro a un allineamento urgente${d}. Appena libero dalla call ti aggiorno con orario realistico.`,
      `La call è slittata oltre il previsto${d}. Chiudo e ti scrivo una fascia pulita senza altri sfori.`
    ]);
    case 'traffico': return pick([
      `Incolonnato su un tratto con coda a fisarmonica${d}. Appena si sblocca ti do un’ETA prudente.`,
      `Ingorgo improvviso in uscita${d}. Evito promesse: ti aggiorno non appena scorre.`,
      `Traffico bloccato${d}. Appena passo il tappo ti raggiungo e recupero senza altri slittamenti.`
    ]);
    case 'connessione': return pick([
      `Linea instabile proprio ora${d}. Passo in tethering come fallback e ti aggiorno appena è stabile.`,
      `La VPN fa i capricci${d}. Attivo hotspot e continuo così; ti tengo allineato sui tempi.`,
      `ISP ballerino${d}. Ho aperto il ticket e nel frattempo lavoro in tethering: ti scrivo quando torna affidabile.`
    ]);
    case 'tripla': return pick([
      `Incastri e doppio imprevisto oggi${d}. Metto ordine e ti mando un piano di rientro con tempi veri.`,
      `Tre fattori si sono accavallati${d}. Riduco lo slittamento e ti propongo una finestra prudente.`,
      `Giornata poco fortunata (incastri)${d}. Priorità rientro: ti arrivo con un orario sensato a breve.`
    ]);
    case 'deluxe': return pick([
      `È emersa una priorità reale${d}. Mi prendo la responsabilità: rientro oggi con piano chiaro.`,
      `Gestisco io la criticità${d}. Ti aggiorno tra poco con tempistiche nette e senza sorprese.`,
      `Ownership piena${d}. Sposto di poco e rientro in giornata con un percorso pulito.`
    ]);
    default: return pick([
      `È saltato un imprevisto operativo${d}. Riduco il ritardo e ti scrivo un orario affidabile a breve.`,
      `C’è stata un’urgenza${d}. Niente promesse a vuoto: ti aggiorno tra poco con tempi chiari.`,
      `Piccolo intoppo reale${d}. Appena stabilizzato, ti propongo una nuova fascia con margine.`
    ]);
  }
}

exports.handler = async (event)=>{
  if (event.httpMethod==='OPTIONS') return j(204,{});
  if (event.httpMethod!=='POST')    return j(405,{error:'method_not_allowed'});

  const API = (process.env.OPENAI_API_KEY||'').trim();
  if (!API) return j(500,{error:'missing_OPENAI_API_KEY'});

  let body={}; try{ body = JSON.parse(event.body||'{}'); }catch{ return j(400,{error:'bad_json'}); }

  // Ingress
  const sku    = String(body.sku||body.productTag||'').toUpperCase();
  const kind   = String(body.kind||KIND_BY_SKU[sku]||'base');
  const tone   = String(body.tone||body.style||'neutro');
  const locale = String(body.locale||'it-IT');
  const delay  = Number(body.delay||body.delayMin||0)||null;
  const recip  = String(body.recipient||'').slice(0,60);
  const maxLen = Math.max(160, Math.min(420, Number(body.maxLen||320)));

  // hint: usato SOLO per guidare la scrittura, MAI riportato testualmente
  const hintRaw = CONTEXT_NOT_NEEDED.has(kind) ? '' : String(body.need||'').slice(0,600);
  const hint    = hintRaw ? `Hint interno (non citare): ${hintRaw}` : 'Senza hint';

  const lex = LEX[kind] || LEX.base;

  const system = [
    'Sei un copywriter italiano, empatico e pratico.',
    'Obiettivo: 3 varianti WhatsApp credibili, coerenti al TIPO e al tono, senza emoji e senza superlativi.',
    'Variazione FORTE: ciascuna variante deve usare lessico e struttura diversi (almeno 1 parola-ancora diversa per variante).',
    'Non ripetere la stessa apertura né gli stessi verbi chiave tra le varianti.',
    'Inserisci SEMPRE un next-step concreto (aggiorno/propongo slot/attivo fallback).',
    'Se c’è un ritardo (delay), citalo con prudenza, senza orari rigidi.',
    'NON copiare/riportare l’hint: serve solo come bussola.',
    'Vietati reati, diagnosi mediche, dati identificabili.'
  ].join(' ');

  const user = {
    kind, tone, locale, delay, recipient: recip,
    anchors_for_kind: lex,                       // parole-ancora utili
    angles: ANGLES,                              // approcci retorici diversi
    hint,                                        // bussola interna
    constraints: {
      per_variant_must_include_at_least_one_anchor: true,
      no_anchor_reuse_across_variants: true,
      forbid_words: ['imprevisto'/*evita eco continuo*/],
      length_max: maxLen
    },
    output_schema: {
      variants: [
        { whatsapp_text: "", email_subject:"", email_body:"" },
        { whatsapp_text: "", email_subject:"", email_body:"" },
        { whatsapp_text: "", email_subject:"", email_body:"" }
      ]
    },
    request: `Genera ESATTAMENTE 3 varianti.
- Ogni variante deve seguire un ANGLE diverso.
- Usa ANCORE diverse per ciascuna variante (almeno 1 per variante).
- Apri in modo differente ogni volta (no frasi-fotocopia).
- WhatsApp: <= ${maxLen} caratteri, 1–2 frasi, italiane naturali.
- Non citare hint né dettagli specifici identificabili.
Restituisci SOLO JSON valido conforme allo schema.`
  };

  try{
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization':`Bearer ${API}`, 'Content-Type':'application/json' },
      body: JSON.stringify({
        model: (process.env.OPENAI_MODEL_||'gpt-4o-mini').trim(),
        temperature: 1.05, top_p: 0.92, presence_penalty: 0.65, frequency_penalty: 0.45,
        // seme variabile per aumentare la diversità run-to-run
        seed: Date.now() % 1000000,
        input: [
          { role:'system', content: system },
          { role:'user',   content: JSON.stringify(user) }
        ]
      })
    });
    const data = await r.json();
    const raw  = String(data?.output_text||'').trim();

    let parsed=null; try{ parsed = JSON.parse(raw); }catch{/* fallback sotto */}
    let out = Array.isArray(parsed?.variants) ? parsed.variants : [];

    // Normalizza, taglia, dedup, e assicura 3 pezzi
    const clamp = (s,n)=>String(s||'').replace(/\s+/g,' ').trim().slice(0,n);
    out = out.map(v=>({
      whatsapp_text: clamp(v.whatsapp_text || v.text || '', maxLen),
      email_subject: clamp(v.email_subject || 'La tua scusa', 80),
      email_body:    clamp(v.email_body || v.whatsapp_text || '', Math.max(300, maxLen+100))
    }))
    .filter(v=>v.whatsapp_text);

    // dedup forte su inizio e su verbi ripetuti
    const seen = new Set(), uniq=[];
    for (const v of out){
      const k = v.whatsapp_text.slice(0,64).toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(v);
      if (uniq.length===3) break;
    }

    if (uniq.length===3) return j(200,{ variants: uniq });

    // Fallback differenziato
    const pool = fallback(kind, delay).map(t=>({
      whatsapp_text: clamp(t, maxLen),
      email_subject: 'La tua scusa',
      email_body:    clamp(t, Math.max(300, maxLen+100))
    }));
    while (uniq.length<3) uniq.push(pool[uniq.length] || pool[0]);
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
