// netlify/functions/fulfillment.js
// Regole: PRICE_RULES_JSON (es. {"price_...":{"excuse":"riunione","minutes":15}}) -> scusa+minuti.
// Se manca la regola, cade su PRICE_MINUTES_JSON o metadata.minutes (solo minuti).
// Generazione scuse: AI se OPENAI_API_KEY presente, altrimenti fallback locale.

const RULES = jenv('PRICE_RULES_JSON') || {};
const MAP_MINUTES = jenv('PRICE_MINUTES_JSON') || {};
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

function jenv(k){ try { return JSON.parse(process.env[k] || '{}'); } catch { return {}; } }
function clampLen(s,max){ return String(s||'').slice(0,max); }
function parseIntSafe(x){ const n = parseInt(String(x||'').trim(),10); return Number.isFinite(n) && n>0 ? n : null; }

function extractSignals(opts = {}) {
  return {
    first_name: clampLen(opts.first_name || 'Ciao', 30),
    recipient:  clampLen(opts.recipient || '', 60),
    tone:       clampLen(opts.tone || '', 20),
    need:       clampLen(opts.need || '', 220),
    delay:      parseIntSafe(opts.delay) || null
  };
}

function extractRule(priceId, price, product){
  if (priceId && RULES[priceId]) return RULES[priceId]; // {excuse, minutes}
  const envMin  = priceId ? (MAP_MINUTES[priceId] || 0) : 0;
  const metaMin = parseInt(price?.metadata?.minutes || product?.metadata?.minutes || '', 10) || 0;
  return { minutes: envMin || metaMin || 0 };
}

function promptForAI(kind, sig){
  const to = (sig.tone || '').toLowerCase();
  const forma = to.includes('formale') ? 'formale' : (to.includes('informale') ? 'informale' : 'neutro');
  const h = [
    `Scrivi scuse credibili in ITA, 1–2 frasi (max 380 caratteri), senza emoji, senza superlativi, senza "grazie in anticipo".`,
    `Tono: ${forma}. Tipo: ${kind}.`,
    sig.recipient ? `Destinatario: ${sig.recipient}.` : ``,
    sig.delay ? `Ritardo previsto: ${sig.delay} minuti.` : ``,
    sig.need ? `Esigenza: "${sig.need}".` : '',
    `Inizia con "${sig.recipient || sig.first_name},".`,
    `Genera 3 varianti diverse, naturali, realistiche.`,
  ].filter(Boolean).join(' ');
  return h;
}

async function aiGenerate(kind, sig){
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: 'Sei un copywriter italiano. Scrivi scuse credibili, sintetiche, senza fronzoli.' },
          { role: 'user', content: promptForAI(kind, sig) }
        ],
        temperature: 0.7,
        max_tokens: 240,
        n: 1
      })
    });
    const out = await r.json().catch(()=> ({}));
    const txt = out?.choices?.[0]?.message?.content || '';
    const candidates = txt
      .split(/\n{2,}|^- |\d\.\s/mi)
      .map(s => s.trim())
      .filter(s => s && s.length >= 30)
      .slice(0,3)
      .map(s => clampLen(s, 380));
    return candidates.length ? candidates : null;
  } catch {
    return null;
  }
}

function localGenerate(kind, sig){
  const name = sig.recipient || sig.first_name || 'Ciao';
  const need = sig.need ? ` ${sig.need}` : '';
  const delay = sig.delay ? ` (${sig.delay}′)` : '';
  const bank = {
    base: [
      `${name}, ho un imprevisto operativo che mi fa slittare di poco${delay}.${need} Ti aggiorno a brevissimo.`,
      `${name}, è saltata una cosa urgente e sto riorganizzando${delay}.${need} Arrivo appena libero.`
    ],
    riunione: [
      `${name}, mi hanno tirato dentro a una riunione che si è allungata${delay}.${need} Esco e ti scrivo appena rientro.`,
      `${name}, riunione straordinaria partita ora e sto dentro${delay}.${need} Ti avviso appena posso muovermi.`
    ],
    connessione: [
      `${name}, la connessione ha mollato proprio adesso${delay}.${need} Sto andando in tethering e ti mando tutto appena stabile.`,
      `${name}, router in crash e rete instabile${delay}.${need} Riparto tra poco e recupero subito dopo.`
    ],
    deluxe: [
      `${name}, è saltato un imprevisto serio che richiede presenza fisica${delay}.${need} Recupero oggi stesso e mi faccio perdonare.`,
      `${name}, sordina d’emergenza per un problema reale${delay}.${need} Sposto di poco e priorità a te al rientro.`
    ],
    tripla: [
      `${name}, oggi combo infelice: incastro+riunione+rete${delay}.${need} Sto chiudendo i pezzi e ti aggiorno fra poco.`,
      `${name}, giornata a incastri e sto rientrando ora${delay}.${need} Appena libero ti arrivo con tutto.`
    ]
  };
  const arr = bank[kind] || bank.base;
  // 3 varianti (se poche, duplichiamo con minime variazioni)
  const out = [...arr];
  while (out.length < 3) out.push(`${name}, ho un imprevisto e posticipo di poco${delay}.${need} Ti aggiorno a breve.`);
  return out.slice(0,3).map(s => clampLen(s, 380));
}

async function generateExcuses(kind, sig){
  const signals = extractSignals(sig);
  const ai = await aiGenerate(kind, signals);
  return ai || localGenerate(kind, signals);
}

// items: listLineItems(...).data
async function processLineItems(items, sig = {}) {
  let minutes = 0;
  let variants = []; // 3 scuse

  for (const li of items) {
    const price = li.price || {};
    const product = price.product || {};
    const priceId = price.id || null;
    const rule = extractRule(priceId, price, product); // {excuse?, minutes?}
    const q = li.quantity || 1;

    // minuti (anche quando c'è scusa)
    const m = parseInt(rule.minutes || 0, 10) || 0;
    if (m) minutes += m * q;

    // scusa (solo una per item; se compri 2 scuse, moltiplichiamo le varianti poi)
    if (rule.excuse) {
      const chunk = await generateExcuses(String(rule.excuse), sig);
      for (let i = 0; i < q; i++) variants.push(...chunk);
    }
  }

  // limitiamo a 3 varianti finali
  if (variants.length > 3) variants = variants.slice(0,3);

  return { minutes, excuses: variants };
}

module.exports = { processLineItems, extractSignals };
