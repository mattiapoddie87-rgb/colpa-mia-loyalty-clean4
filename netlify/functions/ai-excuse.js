// netlify/functions/ai-excuse.js
// 3 varianti WhatsApp realmente diverse, ancorate al CONTENUTO di `need`.
const CORS = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'POST,OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type',
};
const j=(s,b)=>({statusCode:s,headers:{'Content-Type':'application/json',...CORS},body:JSON.stringify(b)});

function extractSignals(needRaw){
  const need = String(needRaw||'').slice(0,600);
  const lower = need.toLowerCase();

  // destinatario grezzo (heuristics)
  const recipient =
    /capo|manager|responsab/.test(lower) ? 'capo' :
    /cliente|fornitore/.test(lower)      ? 'cliente' :
    /partner|ragazzo|ragazza|compagno|compagna/.test(lower) ? 'partner' :
    /collega|team|ufficio/.test(lower)   ? 'collega' : '';

  // persona/scenario
  const persona =
    /riunion|meeting|call|brief/.test(lower) ? 'riunione' :
    /traffico|coda|incidente|autostrada|metro|treno|bus/.test(lower) ? 'traffico' :
    /(connession|internet|vpn|modem|rete|wifi|linea)/.test(lower) ? 'connessione' :
    /(deluxe|formale|cliente grande|direzione)/.test(lower) ? 'deluxe' :
    'base';

  // tempi (minuti, orari)
  const minutes = (()=>{ const m=need.match(/\b(\d{1,3})\s*(min(uti)?|')\b/i); return m? Number(m[1]) : null; })();
  const timeRef = (()=>{ const m=need.match(/\b(\d{1,2}[:.]\d{2}|\b(?:alle|per le)\s*\d{1,2})\b/i); return m? m[0] : ''; })();

  // luoghi/linee semplici (A4, M1, Tangenziale, SS.)
  const place = (()=>{ const m=need.match(/\b(A\d|SS\d+|E\d+|M\d|tangenziale|circonvallazione|passante|metro\s*[A-Z]?\d?)\b/i); return m? m[0] : ''; })();

  return { need, recipient, persona, minutes, timeRef, place };
}

exports.handler = async (event)=>{
  if (event.httpMethod==='OPTIONS') return j(204,{});
  if (event.httpMethod!=='POST')    return j(405,{error:'method_not_allowed'});

  const apiKey = (process.env.OPENAI_API_KEY||'').trim();
  if(!/^sk-/.test(apiKey)) return j(500,{error:'missing_OPENAI_API_KEY'});

  let body={}; try{ body=JSON.parse(event.body||'{}'); }catch{ return j(400,{error:'bad_json'})}

  const seed  = Number(body.seed||0) || Math.floor(Math.random()*1e9);
  const maxLen= Math.max(180, Math.min(420, Number(body.maxLen||320)));
  const sig   = extractSignals(body.need||'');
  const persona = String(body.persona||sig.persona||'base');
  const style   = String(body.style||'neutro');
  const locale  = String(body.locale||'it-IT');

  const system = [
    'Sei lo scrittore principale di COLPA MIA.',
    'Scrivi SCUSE in italiano naturale, concise (max',maxLen,'caratteri),',
    'senza reati/diagnosi/nomi reali. Evita toni melodrammatici.',
    'Usa i DETTAGLI utili presi dal testo utente (riunione, traffico, linea A4/M1, orari, ecc.),',
    'ma rendili plausibili e non rischiosi. Genera 3 varianti DAVVERO diverse.',
    'Restituisci SOLO JSON valido: {"variants":[{"whatsapp_text":"..."},{...},{...}]}'
  ].join(' ');

  const user = {
    locale, style, persona,
    context: {
      raw_need: sig.need,
      recipient_hint: sig.recipient,
      delay_minutes_hint: sig.minutes,
      time_hint: sig.timeRef,
      place_hint: sig.place
    },
    requirements: [
      'Includi i dettagli utili se presenti (riunione che sfora, A4, M1, ora prevista).',
      'Apri con un saluto implicito (senza nome reale).',
      'Proponi una finestra temporale credibile (es. “entro le 18” o “domani mattina”).',
      'Stile: ' + style + ', persona: ' + persona + '.',
      '3 varianti tra loro diverse.'
    ]
  };

  async function call(seedVal){
    const r = await fetch('https://api.openai.com/v1/responses', {
      method:'POST',
      headers:{ 'Authorization':`Bearer ${apiKey}`, 'Content-Type':'application/json' },
      body: JSON.stringify({
        model:'gpt-4o-mini',
        temperature:0.9, top_p:0.95, presence_penalty:0.35, frequency_penalty:0.25,
        seed: seedVal,
        input:[
          {role:'system', content: system},
          {role:'user',   content: JSON.stringify(user)}
        ]
      })
    });
    const data = await r.json().catch(()=> ({}));
    if (!r.ok) throw new Error(data?.error?.message||'openai_error');
    let raw = data.output_text || '';
    let parsed={}; try{ parsed=JSON.parse(raw); }catch{}
    const arr = Array.isArray(parsed?.variants) ? parsed.variants : [];
    return arr.map(v => String(v?.whatsapp_text||v?.sms||'').trim()).filter(Boolean).map(t=>t.slice(0,maxLen));
  }

  try{
    let v = await call(seed);
    if (v.length<3){
      const extra = await call(seed+1);
      const set=new Set(v);
      for(const s of extra){ if(set.size>=3) break; if(!set.has(s.toLowerCase())) set.add(s); }
      v = Array.from(set);
    }
    if (!v.length){
      v = [
        'Mi hanno tirato dentro in una riunione che sta sforando; riorganizzo e ti scrivo entro le 18 con tempi chiari.',
        'Blocco imprevisto (traffico/rete instabile): minimizzo il ritardo e ti aggiorno a breve con un orario affidabile.',
        'Sto gestendo un’urgenza reale; appena libero ti propongo un nuovo slot concreto (oggi entro sera).'
      ];
    }
    // de-dup finale
    const seen=new Set(), out=[];
    for(const s of v){ const k=s.toLowerCase(); if(!seen.has(k)){ seen.add(k); out.push({whatsapp_text:s}); } }
    return j(200,{ variants: out.slice(0,3) });
  }catch(e){
    return j(200,{ variants:[
      {whatsapp_text:'Imprevisto reale, sto riorganizzando. Ti aggiorno entro le 18 con un orario chiaro.'},
      {whatsapp_text:'Urgenza in corso: preferisco non promettere tempi falsi; ti scrivo appena ho visibilità.'},
      {whatsapp_text:'Ridimensiono il ritardo e ti propongo un nuovo slot a breve.'}
    ]});
  }
};
