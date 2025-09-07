// netlify/functions/ai-excuse.js
// Genera 3 VARIANTI realmente diverse e COERENTI con il prodotto acquistato
// e con il contesto inserito dal cliente nel checkout (custom field "need").
// Output JSON: { variants: [{ whatsapp_text, sms, email_subject, email_body }, ...] }

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

// Mappa da SKU/alias a "kind" semantico
const KIND_BY_SKU = {
  SCUSA_ENTRY:  'base',
  SCUSA_BASE:   'base',
  SCUSA_TRIPLA: 'tripla',
  SCUSA_DELUXE: 'deluxe',
  RIUNIONE:     'riunione',
  TRAFFICO:     'traffico',
  CONS_KO:      'connessione',
};

// fallback locale per ogni kind (3 varianti)
function localBank(kind, need = '', delay = null) {
  const d = delay ? ` (≈${delay}′)` : '';
  const extra = need ? ` ${need}` : '';
  switch (kind) {
    case 'riunione':
      return [
        `Mi hanno agganciato a una riunione che si è allungata${d}.${extra} Esco e ti scrivo appena libero.`,
        `Riunione straordinaria partita adesso: rientro a breve${d}.${extra} Appena fuori ti aggiorno con un orario preciso.`,
        `Meeting operativo imprevisto${d}.${extra} Appena chiudo ti propongo un nuovo slot senza farti perdere tempo.`,
      ];
    case 'traffico':
      return [
        `Bloccato nel traffico${d}.${extra} Preferisco non promettere a vuoto: arrivo e ti avviso all’istante.`,
        `Incrocio ingolfato e scorre lento${d}.${extra} Recupero il ritardo appena passo il tappo e ti aggiorno subito.`,
        `Code a fisarmonica, sto avanzando piano${d}.${extra} Appena libero ti raggiungo e tengo il passo stretto.`,
      ];
    case 'connessione':
      return [
        `La connessione è andata giù${d}.${extra} Passo in tethering e ti mando tutto appena la rete è stabile.`,
        `Router in crash/VPN non su${d}.${extra} Sto ripristinando: appena torna stabile ti invio aggiornamento.`,
        `Linea ballerina proprio ora${d}.${extra} Apro ticket e intanto provo un fallback: ti scrivo appena torna ok.`,
      ];
    case 'deluxe':
      return [
        `È intervenuto un imprevisto reale che richiede presenza${d}.${extra} Recupero oggi stesso e ti porto una soluzione chiara.`,
        `Sto gestendo una criticità concreta${d}.${extra} Ti aggiorno con un piano preciso e mi prendo la responsabilità.`,
        `Situazione prioritaria da chiudere bene${d}.${extra} Sposto di poco e rientro focalizzato su di te.`,
      ];
    case 'tripla':
      return [
        `Combo infelice (incastro+riunione+rete)${d}.${extra} Sto chiudendo i pezzi e ti aggiorno appena allineati.`,
        `Giornata a incastri: ne risolvo tre in fila${d}.${extra} Ti scrivo tra poco con ETA realistica.`,
        `Due ritardi a catena e un imprevisto tecnico${d}.${extra} Metto in ordine e torno da te senza slittare oltre.`,
      ];
    case 'base':
    default:
      return [
        `Imprevisto operativo, sto riorganizzando${d}.${extra} Appena ho un orario affidabile ti scrivo.`,
        `È saltata una cosa urgente${d}.${extra} Preferisco non promettere a vuoto: ti aggiorno tra poco con tempi chiari.`,
        `Piccolo intoppo reale${d}.${extra} Minimizzare il ritardo è la priorità: ti propongo a breve un nuovo slot.`,
      ];
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return j(204, {});
  if (event.httpMethod !== 'POST')   return j(405, { error: 'method_not_allowed' });

  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return j(500, { error: 'missing_OPENAI_API_KEY' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return j(400, { error: 'bad_json' }); }

  // Input
  const need   = String(body.need || '').slice(0, 600);          // contesto libero dal checkout
  const skuRaw = String(body.sku || body.productTag || '').toUpperCase();
  const kind   = String(body.kind || KIND_BY_SKU[skuRaw] || 'base');
  const style  = String(body.style || 'neutro');
  const locale = String(body.locale || 'it-IT');
  const delay  = Number(body.delay || body.delayMin || 0) || null; // opzionale (minuti)
  const recip  = String(body.recipient || '').slice(0, 60);        // opzionale
  const maxLen = Math.max(160, Math.min(420, Number(body.maxLen || 320)));

  // Prompt di controllo: regole + “policy” per i vari kind
  const system = [
    'Sei il copywriter principale di COLPA MIA.',
    'Scrivi SCUSE credibili in italiano, brevi (1–2 frasi), mai romanzate, niente emoji, niente superlativi.',
    'Devi generare ESATTAMENTE 3 VARIANTI tra loro DAVVERO DIVERSE (lessico/struttura/strategia).',
    'Adatta il testo al PRODOTTO ("kind") e al CONTEX ("need").',
    'Se è presente "recipient", apri col suo nome; se "delay" è presente, alludi al tempo senza vendere promesse irrealistiche.',
    'Tono controllato: neutro/professionale; evita diagnosi mediche, reati, nomi reali.',
    'Output SOLO JSON valido: {"variants":[{ "whatsapp_text":"...", "sms":"...", "email_subject":"...", "email_body":"..."}, ...]}',
    '',
    'Regole per kind:',
    '- base: piccolo imprevisto/riorganizzazione; soft, concreto.',
    '- tripla: più incastri in fila; riconosci la giornata complicata e proponi allineamento breve.',
    '- deluxe: tono più formale/solido; assunzione di responsabilità e impegno a recuperare.',
    '- riunione: meeting che si allunga; evita dettagli inutili, prometti aggiornamento appena esci.',
    '- traffico: ritardo per code/ingorghi; niente frasi da ufficio (“controllo i dati”), resta su mobilità.',
    '- connessione: problemi rete/VPN; menziona ripiego (tethering/fallback) e aggiornamento appena stabile.',
  ].join(' ');

  const user = {
    kind, need, style, locale, delay, recipient: recip,
    request: `Genera 3 varianti WhatsApp pronte da inviare, ognuna <= ${maxLen} caratteri.`
  };

  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: (process.env.OPENAI_MODEL_ || 'gpt-4o-mini').trim(),
        input: [
          { role: 'system', content: system },
          // few-shot minimali per stabilizzare coerenza
          { role: 'user', content: JSON.stringify({ kind: 'traffico', need: 'coda in A4, uscita chiusa', request: 'Tre varianti' }) },
          { role: 'assistant', content: JSON.stringify({
              variants: [
                { whatsapp_text: 'Bloccato in coda sull’A4 (uscita chiusa). Appena scorre ti aggiorno con ETA onesta.', sms:'', email_subject:'Aggiornamento traffico', email_body:'Bloccato in coda sull’A4: appena riparte ti aggiorno con un orario realistico.' },
                { whatsapp_text: 'Traffico fermo, sto avanzando piano. Non prometto un orario a vuoto: ti scrivo appena passo il tappo.', sms:'', email_subject:'Ritardo per traffico', email_body:'Coda intensa: preferisco aggiornarti appena libero per non darti tempi falsi.' },
                { whatsapp_text: 'Ingorgo improvviso: recupero appena possibile e ti avviso io senza farti attendere a vuoto.', sms:'', email_subject:'Ingorgo improvviso', email_body:'C’è un ingorgo; recupero appena possibile e ti aggiorno subito dopo.' }
              ]
          }) },
          { role: 'user', content: JSON.stringify(user) }
        ],
        temperature: 0.85,
        top_p: 0.9,
        presence_penalty: 0.35,
        frequency_penalty: 0.25,
      })
    });

    const data = await r.json();
    // quando va bene, Responses API restituisce output_text (stringa JSON)
    const raw = String(data?.output_text || '').trim();
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }

    let variants = Array.isArray(parsed?.variants) ? parsed.variants : [];
    variants = variants
      .map(v => ({
        whatsapp_text: String(v.whatsapp_text || v.sms || v.text || '').slice(0, maxLen),
        sms:           String(v.sms || v.whatsapp_text || '').slice(0, maxLen),
        email_subject: String(v.email_subject || 'La tua scusa'),
        email_body:    String(v.email_body || v.whatsapp_text || '').slice(0, 600),
      }))
      .filter(v => v.whatsapp_text)
      .slice(0, 3);

    // Fallback locale robusto e coerente col kind
    if (!variants.length) {
      const pool = localBank(kind, need, delay).slice(0, 3).map(t => ({
        whatsapp_text: t.slice(0, maxLen),
        sms: t.slice(0, maxLen),
        email_subject: 'La tua scusa',
        email_body: t,
      }));
      return j(200, { variants: pool });
    }
    // Se l’AI ha prodotto <3, completa con fallback coerente
    while (variants.length < 3) {
      const add = localBank(kind, need, delay)[variants.length] || localBank(kind, need, delay)[0];
      variants.push({
        whatsapp_text: add.slice(0, maxLen),
        sms: add.slice(0, maxLen),
        email_subject: 'La tua scusa',
        email_body: add,
      });
    }
    return j(200, { variants: variants.slice(0, 3) });

  } catch (err) {
    // Fallback totale
    const pool = localBank(kind, need, delay).slice(0, 3).map(t => ({
      whatsapp_text: t.slice(0, maxLen),
      sms: t.slice(0, maxLen),
      email_subject: 'La tua scusa',
      email_body: t,
    }));
    return j(200, { variants: pool, fallback: true });
  }
};
