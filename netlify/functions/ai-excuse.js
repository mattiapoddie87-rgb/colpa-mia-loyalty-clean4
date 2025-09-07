// netlify/functions/ai-excuse.js
// Generatore SCUSE pro: 3 varianti sempre, coerenti con il pacchetto (kind) e con l'hint utente.
// Per RIUNIONE / TRAFFICO / CONNESSIONE: usa scenari interni (no bisogno di need).
// Per BASE / TRIPLA / DELUXE: usa il need come "hint", non copiarlo testualmente.

// CORS
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const j = (s,b)=>({ statusCode:s, headers:{'Content-Type':'application/json', ...CORS}, body:JSON.stringify(b) });

// Mappa SKU → kind
const KIND_BY_SKU = {
  SCUSA_ENTRY:'base', SCUSA_BASE:'base', SCUSA_TRIPLA:'tripla', SCUSA_DELUXE:'deluxe',
  RIUNIONE:'riunione', TRAFFICO:'traffico', CONS_KO:'connessione', CONN_KO:'connessione'
};
const CONTEXT_NOT_NEEDED = new Set(['riunione','traffico','connessione']);

// Esempi-ancora (NON da copiare, servono per guidare il modello)
const EXEMPLARS = {
  riunione: [
    'Mi è subentrata una riunione che non posso lasciare. Appena chiudo, ti aggiorno con un orario preciso.',
    'La call è partita all’improvviso e sta sforando: finisco e ti confermo i tempi più corretti.',
    'Sono stato agganciato a un punto urgente in riunione: ti scrivo appena libero.'
  ],
  traffico: [
    'Il navigatore segnala un incidente e i tempi si stanno allungando. Appena si sblocca aggiorno l’ETA.',
    'Traffico anomalo sul percorso: faccio il possibile per ridurre il ritardo e ti tengo allineato.',
    'Coda a fisarmonica in tangenziale; procedo lento ma arrivo. Ti do un aggiornamento a breve.'
  ],
  connessione: [
    'La connessione ha mollato e sto passando in tethering: recupero appena torna stabile.',
    'Linea instabile/VPN KO proprio ora: riorganizzo e ti aggiorno quando riaggancio.',
    'Ho esaurito i dati: riattivo il piano e ti confermo i prossimi passi.'
  ],
  base: [
    'È saltato un imprevisto reale: riduco l’attesa e torno da te con un orario affidabile.',
    'Sto chiudendo una cosa urgente: preferisco darti tempi precisi tra poco.',
    'Piccolo intoppo organizzativo: mi rimetto in carreggiata e ti aggiorno a breve.'
  ],
  tripla: [
    'Giornata a incastri (logistica + allineamenti): sto normalizzando e ti do un orario concreto.',
    'Due sovrapposizioni inattese + un ritardo di filiera: compatto i tempi e ti aggiorno a breve.',
    'Sto gestendo tre fronti in sequenza: riduco il ritardo e confermo quando chiudo il giro.'
  ],
  deluxe: [
    'È emersa una priorità che richiede presenza: riorganizzo con criterio e ti propongo subito una fascia solida.',
    'Gestisco un imprevisto che merita attenzione: ottimizzo le prossime tappe e ti condivido una finestra affidabile.',
    'Preferisco non promettere a vuoto: ripianifico con margine e torno con un timing chiaro.'
  ]
};

// Fallback locale in caso di errore OpenAI (con lieve variazione)
function localVariants(kind, hint, maxLen){
  const bank = EXEMPLARS[kind] || EXEMPLARS.base;
  const twists = [
    'Ti tengo aggiornato a breve.',
    'Appena ho un orario credibile, ti scrivo.',
    'Riduciamo l’attesa e sistemiamo tutto.'
  ];
  const out = [];
  for (let i=0;i<3;i++){
    const base = bank[i % bank.length];
    const tail = twists[i % twists.length];
    const s = (base + ' ' + tail).slice(0, maxLen);
    out.push({ whatsapp_text: s });
  }
  return out;
}

// Prompt builder
function buildPrompt({kind, tone, locale, maxLen, hint}) {
  const examples = (EXEMPLARS[kind] || EXEMPLARS.base).map((e,i)=>`${i+1}) ${e}`).join('\n');
  const personaLine = {
    base: 'Contesto generico, usa toni neutri e pratici.',
    tripla: 'Contesto “giornata complicata su più fronti”: mostra organizzazione e priorità.',
    deluxe: 'Contesto “executive”: toni professionali, zero melodramma, rassicurazione.',
    riunione: 'Contesto “riunione che sfora”: riferisci la riunione senza dettagli sensibili.',
    traffico: 'Contesto “traffico anomalo”: riferisci rallentamenti senza dettagli personali.',
    connessione: 'Contesto “connessione/linea/VPN KO”: riferisci problemi di rete senza tecnicismi eccessivi.'
  }[kind] || '';

  const hintLine = CONTEXT_NOT_NEEDED.has(kind)
    ? 'Ignora l’eventuale hint utente: non è necessario in questo scenario.'
    : (hint ? `Usa questo hint SOLO come traccia mentale, senza citarlo né copiarlo: «${hint.slice(0,180)}».`
            : 'Se manca hint, inferisci un motivo plausibile e prudente.');

  return [
    `Sei un copywriter italiano empatico e molto naturale.`,
    `Obiettivo: scrivere SCUSE credibili come messaggi WhatsApp/SMS.`,
    `Regole:`,
    `- 3 varianti tra loro DAVVERO diverse (lessico, struttura, angolazione).`,
    `- 1–2 frasi a variante, massimo ${maxLen} caratteri.`,
    `- Niente emoji, niente toni teatrali, niente accuse a terzi, niente dettagli rischiosi.`,
    `- NON copiare testualmente input/hint: usali solo per orientarti.`,
    `- Adatta lo stile al tono: ${tone || 'neutro'}.`,
    `- Locale: ${locale || 'it-IT'}.`,
    personaLine,
    hintLine,
    ``,
    `Esempi-ancora (da parafrasare, MAI copiare):`,
    examples,
    ``,
    `RISPONDI SOLO con JSON valido (UTF-8) nel formato:`,
    `{"variants":[{"whatsapp_text": "..."},{"whatsapp_text":"..."},{"whatsapp_text":"..."}]}`
  ].join('\n');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return j(204,{});
  if (event.httpMethod !== 'POST')   return j(405,{ error:'method_not_allowed' });

  const apiKey = (process.env.OPENAI_API_KEY||'').trim();
  if (!apiKey) return j(500,{ error:'missing_OPENAI_API_KEY' });

  // Input
  let body={};
  try { body = JSON.parse(event.body||'{}'); } catch { return j(400,{ error:'bad_json' }); }

  const sku    = String(body.sku||'').toUpperCase();
  const kindIn = String(body.kind||'').toLowerCase();
  const kind   = KIND_BY_SKU[sku] || kindIn || 'base';

  const rawNeed= String(body.need||'').trim();        // hint (non verrà copiato)
  const need   = CONTEXT_NOT_NEEDED.has(kind) ? '' : rawNeed;

  const tone   = String(body.tone||'neutro');
  const locale = String(body.locale||'it-IT');
  const maxLen = Math.max(180, Math.min(420, Number(body.maxLen||320)));

  // Prompt
  const prompt = buildPrompt({ kind, tone, locale, maxLen, hint: need });

  // Call OpenAI Responses API
  try{
    const r = await fetch('https://api.openai.com/v1/responses', {
      method:'POST',
      headers:{ 'Authorization':`Bearer ${apiKey}`, 'Content-Type':'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        input: [
          { role:'system', content:'Sei un assistente che restituisce SOLO JSON valido.' },
          { role:'user',   content: prompt }
        ],
        temperature: 0.95, top_p: 0.95, presence_penalty: 0.35, frequency_penalty: 0.3
      })
    });
    const data = await r.json();
    if (!r.ok) return j(r.status, { error: data?.error?.message || 'openai_error' });

    const raw = data.output_text || '';
    let parsed = {};
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }

    let variants = Array.isArray(parsed?.variants) ? parsed.variants : [];
    variants = variants
      .map(v => ({ whatsapp_text: String(v?.whatsapp_text || v?.sms || '').trim().slice(0, maxLen) }))
      .filter(v => v.whatsapp_text);

    // dedupe semplice
    const seen = new Set(); const uniq=[];
    for (const v of variants){
      const k = v.whatsapp_text.toLowerCase();
      if (seen.has(k)) continue; seen.add(k); uniq.push(v);
      if (uniq.length === 3) break;
    }

    if (uniq.length >= 3) return j(200, { variants: uniq.slice(0,3) });

    // fallback parziale
    const fill = localVariants(kind, need, maxLen);
    const merged = [...uniq, ...fill].slice(0,3);
    return j(200, { variants: merged });
  }catch{
    // fallback totale
    return j(200, { variants: localVariants(kind, need, maxLen) });
  }
};
