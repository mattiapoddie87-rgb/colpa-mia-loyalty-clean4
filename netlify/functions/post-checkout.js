// post-checkout.js
// Recupera la Checkout Session Stripe, legge metadata e genera la scusa finale.
// Regole:
// - CONNESSIONE / TRAFFICO / RIUNIONE => usa TEMPLATES preimpostati (no AI)
// - SCUSA_BASE / SCUSA_DELUXE => usa AI (come prima)
// Env richieste: STRIPE_SECRET_KEY, OPENAI_API_KEY

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,OPTIONS'
};
const j = (s,b)=>({statusCode:s,headers:{'Content-Type':'application/json',...CORS},body:JSON.stringify(b)});

// === TEMPLATES PREIMPOSTATI PER SCENARI ===
// Placeholders: {message} testo utente, {context} contesto, {rimedio} suggerimento pratico.
const TEMPLATES = {
  CONNESSIONE: [
    "Ti scrivo ora perché la connessione mi è appena crollata e non riuscivo a rientrare. È responsabilità mia non avere un piano B.\nSe sei d’accordo, {rimedio}. Grazie per la pazienza.",
    "Linea KO nel momento peggiore: me ne assumo la responsabilità. Avrei dovuto testare prima.\nPropongo {rimedio} così non perdiamo altro tempo.",
    "Colpa mia: la rete è saltata e non avevo una soluzione immediata. Per rimediare, {rimedio}. Posso allinearmi anche in {context} se preferisci."
  ],
  TRAFFICO: [
    "Sono rimasto bloccato in coda per un incidente e non ho calcolato margine. È responsabilità mia.\nPosso {rimedio}; dimmi se va bene o preferisci {context} domani.",
    "Traffico imprevisto e pessima gestione da parte mia: arrivo in ritardo. Per rimediare propongo {rimedio}. Capisco se vuoi riprogrammare.",
    "Ho sbagliato le tempistiche: traffico e zero piano alternativo. Mi scuso. Propongo {rimedio} così recuperiamo."
  ],
  RIUNIONE: [
    "Una riunione è sforata oltre l’orario e non ho difeso l’impegno con te: colpa mia.\nSe ti va, {rimedio} così ti restituisco il tempo.",
    "Mi scuso: call imprevista si è allungata e non ho gestito bene le priorità. Propongo {rimedio}. Se non va, troviamo un’alternativa.",
    "Sono rimasto incastrato in una riunione e non ti ho avvisato per tempo. Errore mio.\nRimedio: {rimedio}. Fammi sapere se preferisci altro slot."
  ]
};

// Rimedio di default se l’utente non ha scritto nulla di utile
function defaultRimedio(sku){
  if (sku === 'CONNESSIONE') return "inviarti subito un riepilogo scritto e fissare un nuovo slot di 15 minuti";
  if (sku === 'TRAFFICO')    return "spostare l’appuntamento su tua scelta e presentarmi con 10’ di anticipo";
  if (sku === 'RIUNIONE')    return "mandarti subito note d’azione e riprogrammare su tua disponibilità";
  return "recuperare con un breve riepilogo e un nuovo slot dedicato";
}

// Semplifica/igienizza testo utente
function clean(s){ return (s||"").toString().trim().replace(/\s+/g,' '); }

// Sceglie template deterministico (in base a session id) così non cambia ad ogni refresh
function pickTemplate(arr, seedStr){
  if (!arr || !arr.length) return "";
  let h = 0;
  for (let i=0;i<seedStr.length;i++) h = (h*31 + seedStr.charCodeAt(i)) >>> 0;
  return arr[h % arr.length];
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return j(204,{});
  if (event.httpMethod !== 'GET')     return j(405,{error:'Method not allowed'});

  const sessionId = new URLSearchParams(event.rawQuery||'').get('session_id');
  if (!sessionId) return j(400,{error:'session_id mancante'});

  try{
    // 1) Recupera sessione Stripe
    const resp = await fetch('https://api.stripe.com/v1/checkout/sessions/'+encodeURIComponent(sessionId), {
      headers: { 'Authorization': 'Bearer ' + process.env.STRIPE_SECRET_KEY }
    });
    const S = await resp.json();
    if (!resp.ok) return j(resp.status, {error: S.error?.message || 'Stripe error'});

    const meta = S.metadata || {};
    const sku  = meta.sku || '';
    const tone = (meta.tone || 'empatica').toLowerCase();
    const message = clean(meta.message);
    const context = clean(meta.context);

    // 2) SCENARI a template fisso
    if (sku === 'CONNESSIONE' || sku === 'TRAFFICO' || sku === 'RIUNIONE') {
      const corpus = TEMPLATES[sku] || [];
      let base = pickTemplate(corpus, sessionId);
      const rimedio = defaultRimedio(sku);

      // Inserisci placeholder
      base = base
        .replace(/\{message\}/g, message || '')
        .replace(/\{context\}/g, context || '')
        .replace(/\{rimedio\}/g, rimedio);

      // Micro-tuning di tono senza AI
      if (tone.includes('formale')) {
        base = base
          .replace(/\b(colpa mia|errore mio)\b/gi, 'è una mia responsabilità')
          .replace(/\b(scusa|mi scuso)\b/gi, 'mi scuso');
      } else if (tone.includes('diretta')) {
        base = base
          .replace(/Mi scuso:?\s*/gi, '')
          .replace(/È responsabilità mia/gi, 'È colpa mia');
      }
      return j(200, {excuse: base, metadata: {sku, tone, context}});
    }

    // 3) SCUSE AI (BASE/DELUXE): come prima, ma con prompt chiaro
    if (sku === 'SCUSA_BASE' || sku === 'SCUSA_DELUXE') {
      const prompt =
        `Genera una scusa breve, concreta e rispettosa.
Tono: ${tone}. Contesto: ${context||'generico'}.
Situazione: ${message||'(non fornita)'}.
Includi: ammissione responsabilità, spiegazione sintetica, rimedio pratico, chiusura positiva.
Massimo 90-120 parole. Niente lista puntata.`;

      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method:'POST',
        headers:{'Authorization':'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.5,
          max_tokens: 220,
          messages: [
            { role:'system', content:'Assistente COLPA MIA per scuse efficaci e rispettose.' },
            { role:'user',   content: prompt }
          ]
        })
      });
      const d = await r.json();
      if(!r.ok) return j(r.status,{error:d.error?.message || 'OpenAI error'});
      const excuse = d.choices?.[0]?.message?.content?.trim() || '';
      return j(200, {excuse, metadata:{sku, tone, context}});
    }

    // 4) Default: conferma pagamento
    return j(200, {message:'Pagamento registrato', metadata:{sku, tone, context}});
  }catch(e){
    return j(500,{error:e.message});
  }
};
