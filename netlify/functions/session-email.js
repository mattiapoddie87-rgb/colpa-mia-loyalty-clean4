// netlify/functions/session-email.js
// Modelli interni + leggera variazione GPT-4o.
// 1) Mappa SKU -> modello. 2) Se non basta, deduce dal need. 3) Fallback generico.

const https = require('https');
const { sendMail } = require('./send-utils');

const MAIL_FROM = process.env.MAIL_FROM || 'COLPA MIA <noreply@colpamia.com>';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL_ || 'gpt-4o-mini';

// ---------- NORMALIZZA CONTESTO ----------
function normNeed(s = '') {
  const t = String(s).toLowerCase();
  if (/aper|spritz|drink/.test(t)) return 'APERITIVO';
  if (/cena|ristor/.test(t)) return 'CENA';
  if (/evento|party|festa|concerto/.test(t)) return 'EVENTO';
  if (/lavor|ufficio|meeting|report/.test(t)) return 'LAVORO';
  if (/calcett|partita|calcetto/.test(t)) return 'CALCETTO';
  if (/famigl|figli|marit|mogli|genit|madre|padre|nonna|nonno/.test(t)) return 'FAMIGLIA';
  if (/salute|febbre|medic|dott|tosse|allerg/.test(t)) return 'SALUTE';
  if (/appunt|conseg/.test(t)) return 'APPUNTAMENTO';
  if (/esame|lezion|prof/.test(t)) return 'ESAME';
  return '';
}

// ---------- MODELLI TESTO ----------
const MODELLI = {
  CENA: [
    'Ciao, grazie mille per l’invito: mi fa davvero piacere. Purtroppo quella sera ho già un impegno e non riesco a unirmi.',
    'Ciao, mi dispiace ma mi è capitato un imprevisto e stasera non riesco proprio a venire.',
    'Ciao, onestamente non me la sento di uscire: ho bisogno di una serata tranquilla a casa. Spero capirai.',
    'Ciao, ho già mangiato e sto seguendo la dieta: stasera passo, ma organizziamo presto.',
    'Ciao, non so se riesco a venire: ti aggiorno più tardi se ce la faccio.',
    'Ciao, spero vi divertiate un sacco! Organizziamoci presto per vederci.'
  ],
  APERITIVO: [
    'Ciao, mi spiace tantissimo ma non riesco a venire: ho un altro impegno inderogabile.',
    'Ciao, avevo piacere di esserci, ma è saltato fuori un imprevisto familiare e devo occuparmene.',
    'Ciao, è appena uscita un’urgenza al lavoro e non riesco a partecipare. Recuperiamo presto!'
  ],
  EVENTO: [
    'Ciao, grazie davvero per l’invito. Purtroppo per quella data ho già un impegno e non potrò esserci.',
    'Ciao, mi sarebbe piaciuto molto partecipare ma non riesco a essere presente. Spero in un’altra occasione!',
    'Ciao, non riesco a venire ma ti auguro un evento bellissimo e ti ringrazio per la comprensione.'
  ],
  LAVORO: [
    'Gentile, ti scrivo per scusarmi dell’inconveniente: mi assumo la responsabilità e ho già messo in atto le correzioni. Ti tengo aggiornato con orari aggiornati.',
    'Oggetto: Assenza per indisposizione — ti avviso che oggi non riesco a presentarmi per un malessere improvviso. Mi scuso per il disagio e invierò certificazione appena possibile.'
  ],
  CALCETTO: [
    'Ciao, questa volta passo: ho già un altro impegno fissato.',
    'Ciao, mi sono svegliato con un bel mal di testa: meglio riposare oggi.',
    'Ciao, ho avuto un imprevisto al lavoro/studio e non riesco a liberarmi.',
    'Ciao, sono parecchio stanco e non renderei: meglio non venire oggi.',
    'Ciao, ho un piccolo infortunio e preferisco non rischiare.'
  ],
  FAMIGLIA: [
    'Ciao, mi dispiace ma devo disdire: è subentrato un imprevisto familiare urgente.',
    'Ciao, ho un impegno in famiglia che non posso rimandare e non potrò esserci. Divertitevi!',
    'Ciao, mi scuso per il breve preavviso: devo accompagnare un familiare a una visita. Recuperiamo presto.'
  ],
  SALUTE: [
    'Ciao, mi sono svegliato con febbre e mal di gola: meglio non rischiare di contagiare nessuno.',
    'Ciao, ho un attacco d’allergia forte e oggi devo fermarmi. Appena sto meglio recupero.',
    'Ciao, hanno anticipato una visita medica e devo andarci oggi pomeriggio.'
  ],
  APPUNTAMENTO: [
    'Ciao, mi dispiace ma devo annullare l’appuntamento di [data/ora] per un imprevisto. Possiamo riprogrammare?',
    'C’è stata una sovrapposizione di impegni e non riesco a rispettare l’orario: ti va di fissare un’alternativa?',
    'Purtroppo è subentrata una situazione urgente: posso proporre un’altra data che vada bene a entrambi?'
  ],
  ESAME: [
    'Ciao, mi dispiace per il ritardo: sono rimasto bloccato nel traffico per un incidente e non sono riuscito ad arrivare prima.',
    'Ciao, mi dispiace per il ritardo: sono rimasta bloccata nel traffico per un incidente e non sono riuscita ad arrivare prima.'
  ],
  // per SKU che non chiedono contesto
  TRAFFICO: [
    'Sono in ritardo per un blocco di traffico imprevisto. Mi prendo la responsabilità: arrivo e recupero il tempo, oppure riprogrammiamo oggi stesso in un orario utile per te.'
  ],
  RIUNIONE: [
    'La riunione precedente è sforata e ha impattato il nostro appuntamento. Errore mio di pianificazione: propongo nuovo slot oggi con agenda compressa e materiali in anticipo.'
  ],
  CONNESSIONE: [
    'Problemi di connessione hanno interrotto l’appuntamento. Ho già predisposto rete di backup. Propongo nuova sessione oggi con recap scritto a seguire.'
  ]
};

// SKU -> CONTEX (priorità allo SKU)
const SKU2CTX = (()=>{
  const base = {};
  Object.keys(MODELLI).forEach(k => { base[k] = k; base[`SCUSA_${k}`] = k; });
  base.SCUSA_BASE = null; // usa parsing need
  return base;
})();

// ---------- RISOLUZIONE MODELLO ----------
function resolveCtxBySkuOrNeed({ sku, need }) {
  const S = String(sku || '').toUpperCase().trim();
  const fromSku = SKU2CTX[S] ?? SKU2CTX[S.replace(/^SCUSA_/, '')];
  if (fromSku && MODELLI[fromSku]) return fromSku;

  const fromNeed = normNeed(need);
  if (fromNeed && MODELLI[fromNeed]) return fromNeed;

  return null;
}

// ---------- HTTP ----------
function httpsJson(method, url, headers, body) {
  const u = new URL(url);
  const payload = Buffer.from(JSON.stringify(body || {}));
  const opts = { method, hostname:u.hostname, port:443, path:u.pathname+(u.search||''), headers:{'Content-Type':'application/json','Content-Length':payload.length,...headers}, timeout:15000 };
  return new Promise((resolve,reject)=>{
    const req = https.request(opts, res=>{ let data=''; res.on('data',c=>data+=c);
      res.on('end',()=>{ if(res.statusCode<200||res.statusCode>=300) return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        try{ resolve(data?JSON.parse(data):{});}catch{ resolve({}); } });});
    req.on('error',reject); req.on('timeout',()=>req.destroy(new Error('HTTP timeout')));
    req.write(payload); req.end();
  });
}

// ---------- VARIAZIONE LEGGERA GPT ----------
async function varyLight(text){
  if (!OPENAI_API_KEY) return text;
  const system = 'Parafrasa leggermente in italiano. Mantieni significato e tono. 1-3 frasi, ±15% lunghezza. Niente emoji o saluti. Rispondi solo col testo.';
  const user = `Testo base:\n"""${text}"""`;
  try{
    const r = await httpsJson('POST','https://api.openai.com/v1/chat/completions',
      { Authorization:`Bearer ${OPENAI_API_KEY}` },
      { model: OPENAI_MODEL, temperature:0.3, max_tokens:160,
        messages:[{role:'system',content:system},{role:'user',content:user}] });
    return r?.choices?.[0]?.message?.content?.trim() || text;
  }catch{ return text; }
}

// ---------- SESSION UTILS ----------
function getNeed(session){
  if (session?.metadata?.need) return String(session.metadata.need).trim();
  const cf = Array.isArray(session?.custom_fields)? session.custom_fields : [];
  const f = cf.find(x=>x?.key==='need' && x?.type==='text' && x?.text?.value);
  if (f?.text?.value) return String(f.text.value).trim();
  return '';
}
function getSKU(session){
  return (session?.metadata?.sku || session?.client_reference_id || '').toString().trim().toUpperCase();
}
function escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ---------- RENDER ----------
function renderHtml({ ctx, variants }){
  const items = variants.map(t=>`<div style="margin:12px 0;white-space:pre-wrap">${escapeHtml(t)}</div>`).join('');
  return `<!doctype html><html lang="it"><meta charset="utf-8"><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;line-height:1.5;margin:0;padding:24px;background:#fafafa">
  <div style="max-width:640px;margin:auto;background:#fff;border:1px solid #eee;border-radius:12px;padding:24px">
    <h1 style="font-size:20px;margin:0 0 12px">La tua scusa è pronta</h1>
    <p style="margin:0 0 16px;font-size:14px;color:#555">Contesto: <strong>${escapeHtml(ctx)}</strong></p>
    ${items}
    <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
    <p style="font-size:12px;color:#777">Per modifiche, rispondi a questa email con le istruzioni.</p>
  </div></body></html>`;
}
function renderText({ ctx, variants }){
  return `La tua scusa è pronta\nContesto: ${ctx}\n\n${variants.join('\n\n')}\n`;
}

// ---------- ENTRY DAL WEBHOOK ----------
async function sendCheckoutEmail({ session, lineItems, overrideTo, replyTo }){
  const to = overrideTo || session?.customer_details?.email || session?.customer_email;
  if (!to) throw new Error('destinatario mancante');

  const need = getNeed(session);
  const sku  = getSKU(session);

  const ctx = resolveCtxBySkuOrNeed({ sku, need }) || 'SCUSA_BASE';
  const pool = MODELLI[ctx] || ['Ciao, ho un imprevisto reale: mi riorganizzo e ti aggiorno a breve con orari aggiornati.'];

  const variants = [];
  for (const t of pool) variants.push(await varyLight(t)); // variazione leggera

  const subject = `La tua scusa • ${ctx}`;
  const html = renderHtml({ ctx, variants });
  const text = renderText({ ctx, variants });

  await sendMail({ from: MAIL_FROM, to, subject, html, text, replyTo });
  return { to, subject };
}

module.exports = { sendCheckoutEmail };
