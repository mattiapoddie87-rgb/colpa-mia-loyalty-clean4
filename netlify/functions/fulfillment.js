// netlify/functions/fulfillment.js
// Interpreta i line items di Checkout: accredita minuti e genera "scuse".
// Regole:
//  - PRICE_RULES_JSON: {"price_...":{"excuse":"base","minutes":10}}
//  - fallback minuti: PRICE_MINUTES_JSON o metadata.minutes su price/product
//
// Se OPENAI_API_KEY è presente, usa l'AI; altrimenti fallback generatore locale.

const RULES = jenv('PRICE_RULES_JSON') || {};
const MAP_MINUTES = jenv('PRICE_MINUTES_JSON') || {};

function jenv(k){ try { return JSON.parse(process.env[k] || '{}'); } catch { return {}; } }
function pick(a){ return a[Math.floor(Math.random() * a.length)]; }

async function generateExcuseAI(kind, need, name){
  if (!process.env.OPENAI_API_KEY) return null;
  const prompt = [
    `Sei un assistente che scrive "scuse" credibili in italiano, in tono professionale ma umano.`,
    `Tipo scusa: ${kind}.`,
    need ? `Esigenza/segnale utente: "${need}".` : `Se non c'è esigenza, usa un motivo plausibile e corto.`,
    `Chi riceve la scusa è una persona singola; inizia con "${name},".`,
    `Fornisci UNA sola scusa di 1–2 frasi, max 380 caratteri, senza emoji e senza ringraziamenti finali.`
  ].join(' ');

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: 'Scrivi scuse credibili e sintetiche.' }, { role: 'user', content: prompt }],
        max_tokens: 180, temperature: 0.7
      })
    });
    const out = await r.json();
    const text = out?.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch { return null; }
}

function generateExcuseLocal(kind, name, need){
  name = name || 'Ciao';
  const n = need ? ` ${need.trim()}` : '';
  const base = {
    base:       `${name}, ho avuto un imprevisto operativo che mi fa slittare di poco.${n ? ' ' + need : ''} Ti aggiorno a breve.`,
    riunione:   `${name}, sono stato trascinato in una riunione urgente che si è allungata.${n ? ' ' + need : ''} Esco e ti scrivo appena libero.`,
    connessione:`${name}, la connessione ha fatto cilecca proprio ora (router in crash). Sto switchando in tethering, ti invio tutto appena stabile.`,
    deluxe:     `${name}, è saltato un imprevisto serio che richiede presenza fisica.${n ? ' ' + need : ''} Recupero entro oggi con extra per il disagio.`,
    tripla:     `${name}, combo sfortunata: traffico, riunione e rete instabile. Sto chiudendo e ti mando appena rientro.`,
  };
  return base[kind] || base.base;
}

async function generateExcuse(kind, opts = {}){
  const name = opts.first_name || 'Ciao';
  const need = opts.need || '';
  const ai = await generateExcuseAI(kind, need, name);
  return ai || generateExcuseLocal(kind, name, need);
}

function extractRule(priceId, price, product){
  // 1) Regola esplicita
  if (priceId && RULES[priceId]) return RULES[priceId]; // {excuse, minutes?}
  // 2) Solo minuti da ENV o metadata
  const envMin = MAP_MINUTES[priceId] || 0;
  const metaMin = parseInt(price?.metadata?.minutes || product?.metadata?.minutes || '', 10) || 0;
  return { minutes: envMin || metaMin || 0 };
}

// items: output di stripe.checkout.sessions.listLineItems(...).data
async function processLineItems(items, opts = {}) {
  let minutes = 0;
  const excuses = [];

  for (const li of items) {
    const q = li.quantity || 1;
    const price = li.price || {};
    const product = price.product || {};
    const priceId = price.id || null;
    const rule = extractRule(priceId, price, product);

    // accredito minuti (anche se c'è scusa, se la regola lo prevede)
    const m = parseInt(rule.minutes || 0, 10) || 0;
    if (m) minutes += m * q;

    // scuse
    const kind = rule.excuse || null;
    if (kind) {
      for (let i = 0; i < q; i++) {
        const txt = await generateExcuse(kind, opts);
        excuses.push(txt);
      }
    }
  }
  return { minutes, excuses };
}

module.exports = { processLineItems, generateExcuse };
