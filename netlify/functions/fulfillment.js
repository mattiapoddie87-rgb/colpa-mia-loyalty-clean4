// netlify/functions/fulfillment.js
// Interpreta i line items: somma minuti e genera "scuse" secondo regole.
// Regole: ENV PRICE_RULES_JSON (override) oppure PRICE_MINUTES_JSON/metadata.minutes.

const MAP_MINUTES = safeJson(process.env.PRICE_MINUTES_JSON) || {};
const RULES = safeJson(process.env.PRICE_RULES_JSON) || {}; // es: {"price_...":{"excuse":"traffico"}}

function safeJson(s){ try{ return s ? JSON.parse(s) : null; } catch { return null; } }

function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

// Generatore “scusa” semplice (niente API esterne)
function generateExcuse(kind, opts = {}) {
  const name = opts.name || 'Ciao';
  switch (String(kind)) {
    case 'traffico':
      return `${name}, sono bloccato in un imbuto assurdo: incidente + chiusura corsia. Arrivo appena sbloccano, ti aggiorno a breve.`;
    case 'riunione':
      return `${name}, mi hanno appena chiamato in una riunione straordinaria con il capo. Esco appena posso, perdonami per il disguido.`;
    case 'connessione':
      return `${name}, la connessione è andata KO (router morto). Sto switchando in tethering ma è instabile: ti mando tutto appena torna stabile.`;
    case 'deluxe':
      return `${name}, ho avuto un imprevisto serio (no, non dramma) che richiede presenza fisica. Recupero entro oggi e mi faccio perdonare con extra.`;
    case 'tripla':
      return `${name}, oggi è combo: traffico+riunione+Wi-Fi morto. Sto risolvendo uno alla volta: priorità consegna appena riemergo.`;
    case 'base':
    default:
      return `${name}, mi è saltato un imprevisto al volo. Posticipiamo di poco? Ti aggiorno tra breve.`;
  }
}

function extractRule(li){
  // 1) Regola esplicita da ENV
  const rid = li.price?.id || null;
  if (rid && RULES[rid]) return RULES[rid];

  // 2) Altrimenti: solo minuti (ENV), o metadata.minutes
  const price = li.price || {};
  const product = price.product || {};
  const mEnv = rid ? MAP_MINUTES[rid] : 0;
  const mMeta = parseInt(price.metadata?.minutes || product.metadata?.minutes || '', 10) || 0;

  return { minutes: mEnv || mMeta || 0 };
}

// items: stripe.checkout.sessions.listLineItems(...).data
async function processLineItems(items, opts = {}) {
  let minutes = 0;
  const excuses = [];

  for (const li of items) {
    const q = li.quantity || 1;
    const rule = extractRule(li);

    // Minuti
    if (rule.minutes) minutes += rule.minutes * q;

    // Scuse
    const excuseKind = rule.excuse || null;
    if (excuseKind) {
      for (let i=0;i<q;i++){
        excuses.push(generateExcuse(excuseKind, { name: opts.first_name || 'Ciao' }));
      }
    }
  }

  return { minutes, excuses }; // il chiamante decide come consegnare
}

module.exports = { processLineItems, generateExcuse };
