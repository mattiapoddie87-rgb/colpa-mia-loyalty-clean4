// netlify/functions/ai-excuse.js
// 3 varianti SEMPRE. Coerenti col pacchetto. Basate su template-ancora + piccole variazioni.
// Per RIUNIONE/TRAFFICO/CONNESSIONE ignora l’hint (il contesto è nel pacchetto).
// Per BASE/TRIPLA/DELUXE l’hint orienta il tono, ma non viene mai copiato nel testo.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const j = (s,b)=>({ statusCode:s, headers:{'Content-Type':'application/json', ...CORS}, body:JSON.stringify(b) });

// Map SKU → kind
const KIND = {
  SCUSA_ENTRY:'base', SCUSA_BASE:'base', SCUSA_TRIPLA:'tripla', SCUSA_DELUXE:'deluxe',
  RIUNIONE:'riunione', TRAFFICO:'traffico', CONS_KO:'connessione', CONN_KO:'connessione'
};
const FIXED_KINDS = new Set(['riunione','traffico','connessione']); // non richiedono hint

// === Template-ancora (come richiesto) ===
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
  ]
};

// Piccole varianti lessicali per rendere naturali le 3 uscite anche senza AI
const TWISTS_A = ['Ti aggiorno a breve.', 'Appena ho un orario credibile, ti scrivo.', 'Ti tengo allineato senza far perdere tempo.'];
const TWISTS_B = ['Riduciamo l’attesa.', 'Minimizzo il ritardo.', 'Evito di farti aspettare più del necessario.'];

function varyOnce(str, seedIdx){
  // micro-varianti lessicali senza snaturare la frase
  const repls = [
    [/appena/gi, seedIdx%2 ? 'non appena' : 'appena'],
    [/ti (aggiorno|faccio sapere)/gi, seedIdx%3 ? 'ti aggiorno' : 'ti faccio sapere'],
    [/\bchiudo\b/gi, seedIdx%2 ? 'finisco' : 'chiudo'],
    [/\bsubentrata\b/gi, seedIdx%2 ? 'entrata' : 'subentrata'],
  ];
  let out = str;
  for (const [re,to] of repls) out = out.replace(re, to);
  const tail = (seedIdx%2 ? TWISTS_A[seedIdx%TWISTS_A.length] : TWISTS_B[seedIdx%TWISTS_B.length]);
  if (!/[.!?]$/.test(out)) out += '.';
  return `${out} ${tail}`.trim();
}

function localGenerate(kind, maxLen){
  const base = TEMPLATES[kind] || TEMPLATES.base;
  const out = [0,1,2].map(i => ({ whatsapp_text: (varyOnce(base[i%base.length], i)).slice(0, maxLen) }));
  return out;
}

function buildSystem(){ return 'Sei un copywriter italiano. Ti verranno forniti 3 messaggi “base”. Per ciascuno, restituisci una PARAFRASI breve e naturale, 1–2 frasi, mantenendo lo stesso significato e i riferimenti impliciti (riunione/traffico/connessione ecc.). Niente emoji né dettagli rischiosi. Rispondi SOLO con JSON: {"variants":[{"whatsapp_text": "..."},{"whatsapp_text":"..."},{"whatsapp_text":"..."}]}'; }

function buildUser({baseLines, maxLen, tone}){
  return JSON.stringify({
    instruction: `Parafrasa leggermente, tono ${tone||'neutro'}, mai teatrale, max ${maxLen} caratteri per variante.`,
    base: baseLines
  });
}

exports.handler = async (event)=>{
  if (event.httpMethod === 'OPTIONS') return j(204,{});
  if (event.httpMethod !== 'POST')   return j(405,{error:'method_not_allowed'});

  const apiKey = (process.env.OPENAI_API_KEY||'').trim();
  let body={}; try{ body=JSON.parse(event.body||'{}'); }catch{ return j(400,{error:'bad_json'}); }

  const sku    = String(body.sku||'').toUpperCase();
  const kindIn = String(body.kind||'').toLowerCase();
  const kind   = KIND[sku] || kindIn || 'base';

  const rawNeed= String(body.need||'').trim();
  const tone   = String(body.tone||'neutro');
  const locale = String(body.locale||'it-IT'); // tenuto per compatibilità futura
  const maxLen = Math.max(160, Math.min(420, Number(body.maxLen||320)));

  // Se pacchetto fisso, ignoriamo l’hint; altrimenti lo usiamo SOLO per scegliere sfumature (non lo copiamo)
  const baseLines = (() => {
    const arr = (TEMPLATES[kind] || TEMPLATES.base).slice(0,3);
    if (!FIXED_KINDS.has(kind) && rawNeed) {
      // micro adattamento “mentale”: scegliamo la famiglia più adatta ma NON copiamo l’hint
      // (qui potresti sofisticare con keyword matching; restiamo leggeri e robusti)
      return arr;
    }
    return arr;
  })();

  // Se manca chiave OpenAI → solo fallback locale (3 varianti assicurate)
  if (!apiKey) return j(200, { variants: localGenerate(kind, maxLen) });

  // Proviamo con OpenAI: parafrasa le 3 righe base e restituisci JSON
  try{
    const r = await fetch('https://api.openai.com/v1/responses', {
      method:'POST',
      headers:{ 'Authorization':`Bearer ${apiKey}`, 'Content-Type':'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        input: [
          { role:'system', content: buildSystem() },
          { role:'user',   content: buildUser({ baseLines, maxLen, tone }) }
        ],
        temperature: 0.6, top_p: 0.9, presence_penalty: 0.1, frequency_penalty: 0.2
      })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error?.message || 'openai_error');

    const raw = data.output_text || '';
    let parsed = {};
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }

    let variants = Array.isArray(parsed?.variants) ? parsed.variants : [];
    variants = variants
      .map(v => ({ whatsapp_text: String(v?.whatsapp_text || v?.sms || '').trim().slice(0, maxLen) }))
      .filter(v => v.whatsapp_text);

    // Se meno di 3 → riempi con fallback locale
    if (variants.length < 3) {
      const fill = localGenerate(kind, maxLen);
      // completa senza dedup aggressivo (le parafrasi sono già vicine)
      while (variants.length < 3) variants.push(fill[variants.length]);
    }

    // Esattamente 3
    return j(200, { variants: variants.slice(0,3) });

  }catch{
    // Fallback totale
    return j(200, { variants: localGenerate(kind, maxLen) });
  }
};
