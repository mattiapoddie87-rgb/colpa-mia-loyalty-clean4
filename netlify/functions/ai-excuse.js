// netlify/functions/ai-excuse.js
// Genera 3 varianti realmente diverse (WhatsApp-ready) usando OpenAI Responses.
// Se il JSON non è perfetto, fa un secondo tentativo; infine riempie con fallback.

const CORS = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'POST,OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type',
};
const j = (s,b)=>({ statusCode:s, headers:{'Content-Type':'application/json',...CORS}, body:JSON.stringify(b) });

exports.handler = async (event)=>{
  if (event.httpMethod==='OPTIONS') return j(204,{});
  if (event.httpMethod!=='POST')    return j(405,{error:'method_not_allowed'});

  const apiKey = (process.env.OPENAI_API_KEY||'').trim();
  if (!/^sk-/.test(apiKey)) return j(500,{error:'missing_OPENAI_API_KEY'});

  let body={}; try{ body=JSON.parse(event.body||'{}'); }catch{ return j(400,{error:'bad_json'}); }

  const need    = String(body.need||'').slice(0,600) || 'ritardo breve da giustificare';
  const persona = String(body.persona||'generico');
  const style   = String(body.style||'neutro');
  const locale  = String(body.locale||'it-IT');
  const maxLen  = Math.max(180, Math.min(420, Number(body.maxLen||320)));
  const seedIn  = Number(body.seed||0) || Math.floor(Math.random()*1e9);

  const system = [
    'Sei lo scrittore principale di COLPA MIA.',
    'Genera SCUSE credibili in ITA, pronte per WhatsApp, massimo',maxLen,'caratteri.',
    'Niente reati, diagnosi mediche, nomi reali. Tono naturale, micro-dettagli plausibili.',
    'Devi restituire SOLO JSON valido: {"variants":[{"whatsapp_text":"..."}, {...}, {...}]}',
    'Le 3 varianti DEVONO essere tra loro DAVVERO diverse (lessico/struttura/approccio).'
  ].join(' ');

  async function call(seed){
    const r = await fetch('https://api.openai.com/v1/responses',{
      method:'POST',
      headers:{ 'Authorization':`Bearer ${apiKey}`, 'Content-Type':'application/json' },
      body: JSON.stringify({
        model:'gpt-4o-mini',
        temperature:0.9, top_p:0.95, presence_penalty:0.35, frequency_penalty:0.25,
        seed,
        input:[
          {role:'system', content: system},
          {role:'user', content: JSON.stringify({
            locale, persona, style,
            need,
            want:`Tre scuse WhatsApp ${style} per "${need}", persona=${persona}, locale=${locale}. Max ${maxLen} caratteri ciascuna. Output SOLO JSON come da schema.`
          })}
        ]
      })
    });
    const data = await r.json().catch(()=> ({}));
    if (!r.ok) throw new Error(data?.error?.message||'openai_error');
    const raw = data.output_text || '';
    let parsed={}; try{ parsed = JSON.parse(raw); }catch{}
    const arr = Array.isArray(parsed?.variants) ? parsed.variants : [];
    return arr
      .map(v => String(v?.whatsapp_text || v?.sms || '').trim())
      .filter(Boolean)
      .map(s => s.slice(0,maxLen));
  }

  try{
    let v = await call(seedIn);
    if (v.length < 3) {
      const extra = await call(seedIn + 1);
      const set = new Set(v);
      for (const s of extra){ if (set.size>=3) break; if(!set.has(s)) set.add(s); }
      v = Array.from(set);
    }
    if (v.length < 3) {
      // riempiamo in modo sicuro
      const base = v[0] || 'Imprevisto ora: sto riorganizzando. Ti aggiorno entro oggi con un orario chiaro.';
      const v2 = base.replace(/sto /,'mi sto ').replace(/entro oggi/,'entro le 18');
      const v3 = base.replace(/Ti aggiorno/,'Preferisco non promettere tempi: ti aggiorno');
      v = [base, v2, v3].slice(0,3);
    }
    // de-dup finale
    const seen=new Set(), out=[];
    for (const s of v){ const k=s.toLowerCase(); if(!seen.has(k)){ seen.add(k); out.push(s); } }
    return j(200,{ variants: out.slice(0,3).map(t=>({whatsapp_text:t})) });
  }catch(e){
    // fallback duro
    return j(200,{ variants:[
      {whatsapp_text:'Mi è entrato un imprevisto reale e sto riorganizzando. Ti scrivo entro le 18 con un orario affidabile.'},
      {whatsapp_text:'Sto chiudendo un’urgenza e potrei sforare. Appena ho visibilità, ti aggiorno con tempi precisi.'},
      {whatsapp_text:'Situazione imprevista: minimizzo il ritardo e ti propongo un nuovo slot appena possibile.'}
    ]});
  }
};
