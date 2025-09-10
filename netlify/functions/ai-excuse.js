// netlify/functions/ai-excuse.js
// 3 varianti SEMPRE. Tutti i testi iniziano con "Ciao," e suonano naturali.
// Priorità: scenari fissi (riunione/traffico/connessione) → contesto (CENA, APERITIVO, …) per BASE/DELUXE → fallback base/deluxe.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const j = (s, b) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', ...CORS }, body: JSON.stringify(b) });

const clampLen = (s, max) => String(s || '').slice(0, Math.max(120, Math.min(380, Number(max || 320))));

// ————————————————— Scenari fissi (kind) —————————————————
const BANK_KIND = {
  riunione: [
    'Ciao, mi è entrata una riunione al volo. Finisco e ti aggiorno tra poco.',
    'Ciao, una call sta sforando. Chiudo e ti dico quando arrivo.',
    'Ciao, sono bloccato in riunione su un punto urgente. Appena libero ti scrivo.'
  ],
  traffico: [
    'Ciao, sembra ci sia stato un incidente e il navigatore allunga i tempi. Ti aggiorno a breve.',
    'Ciao, traffico fuori scala sul percorso. Sto accorciando dove posso e ti aggiorno a momenti.',
    'Ciao, coda a fisarmonica in tangenziale. Procedo piano, arrivo e ti scrivo la tempistica.'
  ],
  connessione: [
    'Ciao, la connessione è instabile in questo momento. Rientro in rete e ti confermo.',
    'Ciao, VPN/linea a terra proprio ora. Ripristino e poi ti do orari aggiornati.',
    'Ciao, la rete salta di continuo. Passo in tethering e ti aggiorno quando torna stabile.'
  ],
  base: [
    'Ciao, ho un intoppo reale. Sistemo e ti do un orario credibile a breve.',
    'Ciao, sto chiudendo una cosa urgente. Tra poco ti passo orari aggiornati.',
    'Ciao, piccolo imprevisto organizzativo. Mi rimetto in carreggiata e ti aggiorno.'
  ],
  deluxe: [
    'Ciao, è emersa una priorità che richiede presenza. Riorganizzo con criterio e ti propongo una fascia concreta con orari aggiornati.',
    'Ciao, sto gestendo un imprevisto che merita attenzione. Ottimizzo i prossimi passi e ti mando orari aggiornati affidabili.',
    'Ciao, niente promesse a caso: ripianifico con margine e torno con un orario credibile e chiaro.'
  ]
};

// ————————————————— Contesti (contextTag) per BASE/DELUXE —————————————————
// NOTA: tutti i testi vengono prefissati con "Ciao," se mancasse.
const BANK_CTX = {
  CENA: [
    "grazie mille per l'invito, mi fa molto piacere che tu abbia pensato a me. Sfortunatamente, ho già un impegno per quella sera e non potrò unirmi a voi.",
    'mi dispiace, ma ho un imprevisto e non riesco proprio a venire stasera.',
    'mi dispiace, ma non sono in vena di uscire: avrei bisogno di una serata tranquilla a casa.',
    'ho già mangiato e sto tenendo la dieta, stasera passo. Organizziamo presto?',
    'non so se riesco a venire, ti faccio sapere più tardi.',
    'spero vi divertiate tantissimo, vediamoci presto e recuperiamo!'
  ],
  APERITIVO: [
    'mi spiace molto, ma non riesco a venire. Ho un altro impegno inderogabile.',
    'purtroppo ho già altri impegni per quella sera e non mi sarà possibile partecipare. Spero ci sia una prossima volta.',
    'mi dispiace, avrei voluto esserci, ma ho un imprevisto familiare che richiede la mia attenzione adesso.',
    'purtroppo un’urgenza lavorativa improvvisa mi impedisce di partecipare. Mi rifaccio presto.'
  ],
  EVENTO: [
    'ti ringrazio sinceramente per l’invito all’evento. Mi dispiace, ma non potrò esserci per un impegno precedente e inderogabile.',
    'mi dispiace non poter partecipare, mi sarebbe piaciuto. Spero in un’altra occasione per vederci.',
    'non riesco a esserci, ti auguro un evento meraviglioso e grazie per la comprensione.'
  ],
  LAVORO: [
    // Scuse formali/operative (uso bracket come placeholder)
    'gentile [Nome], ti porgo le mie scuse per [errore/ritardo specifico]. Mi assumo la responsabilità: ho già avviato le correzioni e definito i prossimi passi. Condivido orari aggiornati a breve. Cordiali saluti, [Il tuo nome]',
    'oggetto: assenza dal lavoro — [Il tuo nome]. gentile [Responsabile], oggi [Data] non potrò presentarmi per un’improvvisa indisposizione. Invio certificazione appena possibile. Per urgenze: [collega] — [email]. Cordiali saluti, [Il tuo nome]'
  ],
  CALCETTO: [
    'mi dispiace, ma non posso partecipare questa volta: ho già un altro impegno.',
    'mi sono svegliato con un po’ di mal di testa, meglio riposare oggi.',
    'ho avuto un imprevisto al lavoro/studio e non riesco a liberarmi in tempo.',
    'ho un appuntamento importante che non posso spostare.',
    'sono molto stanco e non renderei al meglio, passo questa.',
    'ho un piccolo infortunio e preferisco non rischiare.'
  ],
  FAMIGLIA: [
    'mi dispiace molto, devo disdire l’appuntamento di [data] alle [ora] per un imprevisto familiare urgente. Riprogrammiamo appena possibile.',
    'ho un impegno familiare che non posso rimandare e non potrò esserci. Spero vi divertiate.',
    'mio marito ha avuto un piccolo incidente: devo correre in pronto soccorso.',
    'devo cancellare stasera: mio padre ha avuto un piccolo incidente domestico e sono al pronto soccorso.',
    'mi hanno appena avvisato che mia madre è caduta: vado a controllare che stia bene.',
    'mia figlia giovedì alle 10:00 deve andare dal dentista: arriverò tardi, la accompagno io.'
  ],
  SALUTE: [
    'mi sono svegliato con mal di gola e tosse. Per non contagiare nessuno, oggi è meglio evitare.',
    'ho un attacco forte di allergia e non tengo a bada i sintomi: devo prendermi un giorno.',
    'si è liberato un appuntamento medico atteso da settimane: devo approfittarne.',
    'mi sono svegliato con febbre alta e ho fissato un controllo al volo: oggi non riesco.',
    'mi hanno anticipato una visita nel pomeriggio: dovrò andare via prima.'
  ],
  APP_CONS: [
    'devo annullare l’appuntamento di [data/ora] per una conflittualità di impegni. Possiamo riprogrammare?',
    'non riesco a rispettare l’appuntamento per [motivo sintetico]. Scusa il disagio: troviamo un’altra data?',
    'c’è stato un cambio piani: non sarò presente all’appuntamento di [data/ora]. Proponi tu una nuova fascia?',
    'ho avuto un contrattempo e non potrò essere all’appuntamento di [data/ora]. Chiedo scusa per la cancellazione.',
    'a causa di circostanze impreviste non potrò partecipare: felice di fissare un nuovo incontro quando possibile.',
    'a malincuore devo disdire l’appuntamento di [data/ora] per un’urgenza. Rimandiamo?'
  ],
  ESAME_M: [
    'mi dispiace per il ritardo: sono rimasto bloccato nel traffico per un incidente e non sono riuscito ad arrivare prima.',
    'mi dispiace per il ritardo: un incidente ha fermato la strada e sono rimasto imbottigliato.'
  ],
  ESAME_F: [
    'mi dispiace per il ritardo: sono rimasta bloccata nel traffico per un incidente e non sono riuscita ad arrivare prima.',
    'mi dispiace per il ritardo: c’è stato un incidente e sono rimasta imbottigliata.'
  ]
};

// ————————————————— micro-varianti leggere —————————————————
const TWISTS_A = [
  'Ti aggiorno più tardi.',
  'Appena ho un orario credibile, ti scrivo.',
  'Meglio darti orari reali tra poco.'
];
const TWISTS_B = [
  'Riduco l’attesa.',
  'Minimizzo il ritardo.',
  'Preferisco essere preciso che frettoloso.'
];

function ensureCiao(s) {
  const t = String(s || '').trim();
  if (/^ciao[,!\s]/i.test(t)) return t;
  return 'Ciao, ' + t.replace(/^Ciao[,!\s]*/i, '');
}

function sanitizeTerms(s) {
  return s
    .replace(/\bETA\b/gi, 'tempistica')
    .replace(/timing\s+pulito/gi, 'orari aggiornati')
    .replace(/fascia\s+sensata/gi, 'orario credibile');
}

function varyOnce(base, i, maxLen) {
  let out = ensureCiao(sanitizeTerms(base)).trim();
  if (!/[.!?]$/.test(out)) out += '.';
  const tail = (i % 2 === 0) ? TWISTS_A[i % TWISTS_A.length] : TWISTS_B[i % TWISTS_B.length];
  // Evita doppioni troppo “gonfi”
  if (out.length < 260) out += ' ' + tail;
  return clampLen(out, maxLen);
}

// Determinismo semplice con seed (se fornito)
function pickThree(arr, seed) {
  const a = Array.from(arr);
  if (a.length <= 3) return a.slice(0, 3);
  let h = 0; const s = String(seed || '');
  for (let i = 0; i < s.length; i++) h = (h * 131 + s.charCodeAt(i)) >>> 0;
  const start = h % a.length;
  const out = [];
  for (let k = 0; k < 3; k++) out.push(a[(start + k) % a.length]);
  return out;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return j(204, {});
  if (event.httpMethod !== 'POST')   return j(405, { error: 'method_not_allowed' });

  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch { return j(400, { error: 'bad_json' }); }

  const kindRaw = String(body.kind || 'base').toLowerCase();
  const kind = ['riunione','traffico','connessione','base','deluxe'].includes(kindRaw) ? kindRaw : 'base';

  const tagRaw = String(body.contextTag || '').toUpperCase(); // es. CENA, LAVORO, APP_CONS, ESAME
  let tag = tagRaw;
  if (tag === 'APPUNTAMENTO' || tag === 'APPUNTAMENTO/CONSEGNA') tag = 'APP_CONS';

  const genderRaw = String(body.gender || '').toUpperCase(); // 'M' | 'F' | '' (solo per ESAME)
  const seed = body.seed || Date.now();

  const maxLen = Number(body.maxLen || 320);

  // Scelta banca frasi
  let bank = null;

  if (['riunione','traffico','connessione'].includes(kind)) {
    bank = BANK_KIND[kind];
  } else {
    // base/deluxe con contesto
    if (tag) {
      if (tag === 'ESAME') {
        bank = (genderRaw === 'F') ? BANK_CTX.ESAME_F : (genderRaw === 'M' ? BANK_CTX.ESAME_M : BANK_CTX.ESAME_M);
      } else {
        bank = BANK_CTX[tag] || null;
      }
    }
    if (!bank) bank = BANK_KIND[kind] || BANK_KIND.base;
  }

  // Prendi 3 frasi dalla banca scelta con rotazione deterministica
  const chosen = pickThree(bank, seed);

  const variants = chosen.map((s, i) => ({ whatsapp_text: varyOnce(s, i, maxLen) }));
  return j(200, { variants });
};
