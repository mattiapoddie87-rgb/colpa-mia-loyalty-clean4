// netlify/functions/ai-excuse.js
// 3 scuse COERENTI con il prodotto/kind, VARIE, e
// il "need" viene usato SOLO come contesto interno (mai citato/riportato).

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

// SKU -> kind semantico
const KIND_BY_SKU = {
  SCUSA_ENTRY:'base', SCUSA_BASE:'base',
  SCUSA_TRIPLA:'tripla', SCUSA_DELUXE:'deluxe',
  RIUNIONE:'riunione', TRAFFICO:'traffico', CONS_KO:'connessione'
};

// --- Fallback locale: MAI inserire il "need" nel testo
function localBank(kind, delay = null) {
  const d = delay ? ` (≈${delay}′)` : '';
  switch (kind) {
    case 'riunione':
      return [
        `Mi hanno agganciato a una riunione che si è allungata${d}. Esco e ti scrivo appena libero.`,
        `Riunione straordinaria partita adesso: rientro a breve${d}. Appena fuori ti aggiorno con un orario preciso.`,
        `Meeting operativo imprevisto${d}. Appena chiudo ti propongo un nuovo slot senza farti perdere tempo.`,
      ];
    case 'traffico':
      return [
        `Bloccato nel traffico${d}. Preferisco non promettere a vuoto: arrivo e ti avviso all’istante.`,
        `Incrocio ingolfato e scorre lento${d}. Recupero il ritardo appena passo il tappo e ti aggiorno subito.`,
        `Code a fisarmonica, sto avanzando piano${d}. Appena libero ti raggiungo e tengo il passo stretto.`,
      ];
    case 'connessione':
      return [
        `La connessione è andata giù${d}. Passo in tethering e ti mando tutto appena la rete è stabile.`,
        `Router in crash/VPN non su${d}. Sto ripristinando: appena torna stabile ti invio aggiornamento.`,
        `Linea ballerina proprio ora${d}. Apro ticket e intanto provo un fallback: ti scrivo appena torna ok.`,
      ];
    case 'deluxe':
      return [
        `È intervenuto un imprevisto reale che richiede presenza${d}. Recupero oggi stesso e ti porto una soluzione chiara.`,
        `Sto gestendo una criticità concreta${d}. Ti aggiorno con un piano preciso e mi prendo la responsabilità.`,
        `Situazione prioritaria da chiudere bene${d}. Sposto di poco e rientro focalizzato su di te.`,
      ];
    case 'tripla':
      return [
        `Combo infelice (incastro+riunione+rete)${d}. Sto chiudendo i pezzi e ti aggiorno appena allineati.`,
        `Giornata a incastri: ne risolvo tre in fila${d}. Ti scrivo tra poco con ETA realistica.`,
        `Due ritardi a catena e un imprevisto tecnico${d}. Metto in ordine e torno da te senza slittare oltre.`,
      ];
    case 'base':
    default:
      return [
        `Imprevisto operativo, sto riorganizzando${d}. Appena ho un orario affidabile ti scrivo.`,
        `È saltata una cosa urgente${d}. Preferisco non promettere a vuoto: ti aggiorno tra poco con tempi chiari.`,
        `Piccolo intoppo reale${d}. Minimizzare il ritardo è la priorità: ti propongo a breve un nuovo slot.`,
      ];
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return j(204, {});
  if (event.httpMethod !== 'POST')   return j(405, { error:'method_not_allowed' });

  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return j(500, { error:'missing_OPENAI_API_KEY' });

  let body={}; try{ body=JSON.parse(event.body||'{}'); }catch{ return j(400,{error:'bad_json'}); }

  // INPUT
  const rawNeed = String(body.need||'').slice(0,600);   // usato solo come SEGNale
  const skuRaw  = String(body.sku||body.productTag||'').toUpperCase();
  const kind    = String(body.kind||KIND_BY_SKU[skuRaw]||'base');
  const style   = String(body.style||'neutro');
  const locale  = String(body.locale||'it-IT');
  const delay   = Number(body.delay||body.delayMin||0) || null;
  const recip   = String(body.recipient||'').slice(0,60);
  const maxLen  = Math.max(160, Math.min(420, Number(body.maxLen||320)));

  // Prompt: il need è SOLO contesto implicito -> vietato citarlo/riportarlo
  const system = [
    'Sei il copywriter principale di COLPA MIA.',
    'Scrivi scuse credibili in ITALIANO, 1–2 frasi, senza emoji, senza superlativi.',
    'Devi produrre ESATTAMENTE 3 VARIANTI, davvero diverse (lessico/struttura/strategia).',
    'Adatta sempre al PRODOTTO (kind) e al contesto, ma:',
    '⚠️ NON riportare mai parole/frasi del contesto (need), non citarlo, non parafrasarlo, non includere nomi, luoghi o dettagli sensibili.',
    'Se "recipient" è presente, puoi iniziare con il suo nome, altrimenti no.',
    'Se "delay" è presente, alludi al tempo in modo prudente (senza promesse rigide).',
    'Tono controllato (neutro/professionale).',
    'Output SOLO JSON: {"variants":[{"whatsapp_text":"...","sms":"...","email_subject":"...","email_body":"..."}]}',
    '',
    'Linee guida per kind:',
    '- base: piccolo imprevisto/riorganizzazione.',
    '- tripla: più incastri in fila, allineamento breve.',
    '- deluxe: più formale/solido, responsabilità e recupero.',
    '- riunione: meeting che si allunga, aggiornamento appena esci.',
    '- traffico: mobilità/ingorghi, niente frasi da ufficio.',
    '- connessione: rete/VPN instabile, accenna a fallback.',
  ].join(' ');

  const user = {
    kind, style, locale, delay, recipient: recip,
    // Passo il need come "hint" NON citabile
    hidden_context_hint: rawNeed,
    request: `Genera 3 varianti WhatsApp, ognuna <= ${maxLen} caratteri. Non citare mai il contesto.`
  };

  try{
    const r = await fetch('https://api.openai.com/v1/responses',{
      method:'POST',
      headers:{ 'Authorization':`Bearer ${apiKey}`, 'Content-Type':'application/json' },
      body: JSON.stringify({
        model: (process.env.OPENAI_MODEL_ || 'gpt-4o-mini').trim(),
        input: [
          { role:'system', content: system },
          // few-shot anti-eco: dimostra che l'hint non va ripetuto
          { role:'user', content: JSON.stringify({ kind:'traffico', hidden_context_hint:'coda in A4 uscita X chiusa', request:'Tre varianti' }) },
          { role:'assistant', content: JSON.stringify({
            variants:[
              { whatsapp_text:'Bloccato nel traffico. Appena scorre ti aggiorno con un orario onesto.', sms:'', email_subject:'Aggiornamento traffico', email_body:'Traffico intenso: ti aggiorno appena libero con un’ETA realistica.' },
              { whatsapp_text:'Traffico fermo, sto avanzando piano. Evito tempi a caso: ti scrivo appena passo il tappo.', sms:'', email_subject:'Ritardo per traffico', email_body:'Preferisco non promettere tempi non veritieri: ti aggiorno appena riparte.' },
              { whatsapp_text:'Ingorgo improvviso: recupero appena possibile e ti avviso io.', sms:'', email_subject:'Ingorgo', email_body:'Appena la situazione si sblocca, ti avviso e recupero subito.' }
            ]
          })},
          { role:'user', content: JSON.stringify(user) }
        ],
        temperature: 0.85, top_p: 0.9, presence_penalty: 0.35, frequency_penalty: 0.25,
      })
    });
    const data = await r.json();
    const raw  = String(data?.output_text || '').trim();
    let parsed = null; try{ parsed = JSON.parse(raw); }catch{}

    let variants = Array.isArray(parsed?.variants) ? parsed.variants : [];
    variants = variants
      .map(v => ({
        whatsapp_text: String(v.whatsapp_text || v.sms || v.text || '').slice(0, maxLen),
        sms:           String(v.sms || v.whatsapp_text || '').slice(0, maxLen),
        email_subject: String(v.email_subject || 'La tua scusa'),
        email_body:    String(v.email_body || v.whatsapp_text || '').slice(0, 600),
      }))
      // scarta qualunque eco del need
      .filter(v => v.whatsapp_text && !rawNeed || !new RegExp(String(rawNeed).slice(0,40).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'i').test(v.whatsapp_text))
      .slice(0,3);

    if (!variants.length) {
      const pool = localBank(kind, delay).slice(0,3).map(t => ({
        whatsapp_text: t.slice(0, maxLen), sms: t.slice(0, maxLen),
        email_subject: 'La tua scusa', email_body: t
      }));
      return j(200,{ variants: pool });
    }
    while (variants.length < 3) {
      const add = localBank(kind, delay)[variants.length] || localBank(kind, delay)[0];
      variants.push({ whatsapp_text:add.slice(0,maxLen), sms:add.slice(0,maxLen), email_subject:'La tua scusa', email_body:add });
    }
    return j(200,{ variants: variants.slice(0,3) });
  }catch{
    const pool = localBank(kind, delay).slice(0,3).map(t => ({
      whatsapp_text: t.slice(0, maxLen), sms: t.slice(0, maxLen),
      email_subject: 'La tua scusa', email_body: t
    }));
    return j(200,{ variants: pool, fallback:true });
  }
};
