// netlify/functions/ai-excuse.js
// Genera 3 varianti SEMPRE, senza fallire.
// Se kind ∈ {riunione, traffico, connessione} usa le frasi base fornite e le varia leggermente.
// Per {base, tripla, deluxe} usa prompt "intelligente" ma ancora vincola lo stile e produce 3 varianti.
// Output fisso: { variants: [ {whatsapp_text}, {whatsapp_text}, {whatsapp_text} ] }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const j = (s,b)=>({statusCode:s,headers:{'Content-Type':'application/json',...CORS},body:JSON.stringify(b)});

// === Frasi base (le tue) ===
const BASE_BANK = {
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
    'Ho finito i giga: questo è uno degli ultimi messaggi che posso inviare. Appena riattivo ti confermo i tempi.',
    'Linea/VPN KO proprio ora: sto ripristinando e ti confermo tempi appena aggancio.',
    'Connessione instabile: passo in tethering e ti aggiorno appena torna stabile.'
  ],
  base: [
    'È saltato un imprevisto reale: riduco l’attesa e torno con un orario affidabile. Ti aggiorno a breve.',
    'Sto chiudendo una cosa urgente: preferisco darti tempi precisi tra poco. Minimizzo il ritardo.',
    'Piccolo intoppo organizzativo: mi rimetto in carreggiata e ti aggiorno a breve. Ti tengo allineato passo passo.'
  ],
  tripla: [
    'Giornata a incastri su più fronti: normalizzo e ti do un orario concreto a breve.',
    'Due sovrapposizioni + un ritardo di filiera: compatto i tempi e ti aggiorno tra poco.',
    'Sto gestendo tre passaggi in sequenza: minimizzo il ritardo e ti confermo quando chiudo.'
  ],
  deluxe: [
    'È emersa una priorità che richiede presenza: riorganizzo con criterio e ti propongo una fascia credibile.',
    'Gestisco un imprevisto che merita attenzione: ottimizzo i prossimi passi e ti mando un timing pulito.',
    'Evito promesse a vuoto: ripianifico con margine e torno con un orario affidabile.'
  ]
};

// Piccole variazioni lessicali per rendere differenti le 3 uscite (no AI richiesto)
const TWISTS_A = ['Ti aggiorno a breve.', 'Appena ho un orario credibile, ti scrivo.', 'Rientro e ti aggiorno senza ritardi inutili.'];
const TWISTS_B = ['Riduciamo l’attesa.', 'Minimizzo il ritardo.', 'Evito di farti aspettare più del necessario.'];

function tweakOnce(base, tone, i){
  let out = base;

  // micro-varianti safe (non snaturano la frase)
  if (i === 1) out = out.replace(/\.$/, '') + ' ' + TWISTS_A[i % TWISTS_A.length];
  if (i === 2) out = out.replace(/\.$/, '') + ' ' + TWISTS_B[i % TWISTS_B.length];

  // tono
  const t = (tone||'').toLowerCase();
  if (t.includes('formale')) {
    out = out.replace(/ti /g, 'le ');
    out = out.replace(/\sok\b/gi, ' va bene');
  } else if (t.includes('ironico')) {
    out = out.replace(/\.$/, '') + ' (giornata fantastica, eh?).';
  }
  return out.slice(0, 380);
}

async function aiThree(kind, tone, need, maxLen){
  // opzionale: prova ad usare OpenAI per parafrasi più “umane”.
  // Se la chiave non c’è o fallisce, torniamo subito a variazione locale.
  const key = (process.env.OPENAI_API_KEY||'').trim();
  if (!key) return null;
  try{
    const prompt = [
      `Scrivi 3 scuse brevi in italiano (max ${maxLen} caratteri ciascuna), realistiche, senza emoji.`,
      `Tono: ${tone || 'neutro'}.`,
      kind==='base'||kind==='tripla'||kind==='deluxe'
        ? `Contesto (solo come guida, non copiarlo letterale): ${need||'nessuno'}.`
        : `Scenario: ${kind}. Non inventare cause diverse; resta nello scenario.`,
      `Rispondi SOLO come JSON: {"variants":[{"text":"..."},{"text":"..."},{"text":"..."}]}`
    ].join(' ');

    const r = await fetch('https://api.openai.com/v1/responses',{
      method:'POST',
      headers:{'Authorization':`Bearer ${key}`,'Content-Type':'application/json'},
      body: JSON.stringify({ model: (process.env.OPENAI_MODEL_||'gpt-4o'), input: prompt, temperature: 0.5 })
    });
    const data = await r.json().catch(()=> ({}));
    const raw = data?.output_text || '';
    const parsed = JSON.parse(raw||'{}');
    const arr = Array.isArray(parsed?.variants) ? parsed.variants.map(v=>String(v.text||'').trim()).filter(Boolean) : [];
    if (arr.length===3) return arr.map(s => s.slice(0, maxLen));
  }catch{}
  return null;
}

exports.handler = async (event)=>{
  if (event.httpMethod==='OPTIONS') return j(204,{});
  if (event.httpMethod!=='POST')     return j(405,{error:'method_not_allowed'});

  let body={}; try{ body = JSON.parse(event.body||'{}'); }catch{ return j(400,{error:'bad_json'}); }

  // ingressi
  const kindRaw = String(body.kind || body.package || body.tag || '').toLowerCase();
  const kind = ['riunione','traffico','connessione','base','tripla','deluxe'].includes(kindRaw) ? kindRaw : 'base';
  const tone   = String(body.style || body.tone || 'neutro');
  const need   = String(body.need || '').slice(0, 300);
  const maxLen = Math.max(120, Math.min(380, Number(body.maxLen||320)));

  // 1) Se scenario fisso, parti SEMPRE dalle frasi base e varia
  if (['riunione','traffico','connessione'].includes(kind)){
    const originals = BASE_BANK[kind];
    const variants = originals.map((s,i)=>({ whatsapp_text: tweakOnce(s, tone, i) }));
    return j(200,{ variants });
  }

  // 2) Per base/tripla/deluxe: prova AI; se fallisce usa nostre basi + tweak
  const ai = await aiThree(kind, tone, need, maxLen);
  if (ai && ai.length===3){
    return j(200,{ variants: ai.map(s=>({ whatsapp_text: s })) });
  }
  const originals = BASE_BANK[kind];
  const variants = originals.map((s,i)=>({ whatsapp_text: tweakOnce(s, tone, i) }));
  return j(200,{ variants });
};
