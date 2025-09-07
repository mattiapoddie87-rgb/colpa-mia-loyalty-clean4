// ai-excuse.js — genera 3 varianti coerenti con lo SKU
// - NON copia il contesto utente; usa frasi-base per i pacchetti “situazionali”
// - Risponde sempre (no dipendenze esterne)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const j = (s, b) => ({
  statusCode: s,
  headers: { 'Content-Type': 'application/json', ...CORS },
  body: JSON.stringify(b),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return j(204, {});
  if (event.httpMethod !== 'POST') return j(405, { error: 'method_not_allowed' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return j(400, { error: 'bad_json' }); }

  const sku   = String(body.sku || '').toUpperCase();
  const tone  = String(body.tone || 'neutro'); // futuro uso
  const seed  = String(body.seed || Date.now());
  const max   = Math.max(140, Math.min(360, Number(body.maxLen || 320)));

  // Mappa SKU -> “kind”
  const KIND =
    sku.includes('RIUNIONE')           ? 'riunione'     :
    (sku.includes('CONS_KO') || sku.includes('CONN') ) ? 'connessione' :
    sku.includes('TRAFFICO')           ? 'traffico'     :
    sku.includes('DELUXE')             ? 'deluxe'       :
    sku.includes('TRIPLA')             ? 'tripla'       :
                                          'base';

  // Frasi-base (DA MOSTRARE e poi variare leggermente)
  const BASE = {
    riunione: [
      'Mi è subentrata una riunione proprio ora. Appena finisco ti aggiorno.',
      'Call imprevista che sta sforando: chiudo e ti confermo i tempi.',
      'Sono dentro a un punto urgente in riunione; appena libero ti faccio sapere.',
    ],
    traffico: [
      'Penso ci sia un incidente: il navigatore segna tempi più lunghi. Ti aggiorno quando si sblocca.',
      'Traffico anomalo sul percorso: riduco il ritardo e ti tengo allineato.',
      'Coda a fisarmonica in tangenziale; procedo piano ma arrivo. Ti scrivo tra poco con un ETA.',
    ],
    connessione: [
      'Ho finito i giga: questo è uno degli ultimi messaggi che posso inviare. Appena riattivo ti confermo.',
      'Linea/VPN KO proprio ora: sto ripristinando e ti confermo tempi appena aggancio.',
      'Connessione instabile: passo in tethering e ti aggiorno appena torna stabile.',
    ],
    base: [
      'È saltato un imprevisto reale: riduco l’attesa e torno con un orario affidabile.',
      'Sto chiudendo una cosa urgente: preferisco darti tempi precisi tra poco.',
      'Piccolo intoppo organizzativo: mi rimetto in carreggiata e ti aggiorno a breve.',
    ],
    tripla: [
      'Giornata a incastri su più fronti: normalizzo e ti do un orario concreto a breve.',
      'Due sovrapposizioni + un ritardo di filiera: compatto i tempi e ti aggiorno tra poco.',
      'Sto gestendo tre passaggi in sequenza: minimizzo il ritardo e ti confermo quando chiudo.',
    ],
    deluxe: [
      'È emersa una priorità che richiede presenza: riorganizzo con criterio e ti propongo una fascia seria.',
      'Gestisco un imprevisto che merita attenzione: ottimizzo i prossimi passi e ti mando un timing.',
      'Evito promesse a vuoto: ripianifico con margine e torno con un orario affidabile.',
    ],
  };

  const TWISTS_A = [
    'Ti aggiorno a breve.',
    'Appena ho un orario credibile, ti scrivo.',
    'Ti tengo allineato passo passo.',
  ];
  const TWISTS_B = [
    'Riduciamo l’attesa.',
    'Minimizzo il ritardo.',
    'Preferisco essere preciso che frettoloso.',
  ];
  function varyOnce(str, idx){
    const t = (idx % 2 === 0) ? TWISTS_A[idx % TWISTS_A.length] : TWISTS_B[idx % TWISTS_B.length];
    let out = str.trim();
    if (!/[.!?]$/.test(out)) out += '.';
    out += ' ' + t;
    return out.slice(0, max);
  }

  const bank = BASE[KIND] || BASE.base;
  // 3 varianti sempre
  const variants = [0,1,2].map(i => ({ whatsapp_text: varyOnce(bank[i % bank.length], i) }));

  return j(200, { variants });
};
