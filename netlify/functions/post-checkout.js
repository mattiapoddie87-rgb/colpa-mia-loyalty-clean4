const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET,OPTIONS'};
const j=(s,b)=>({statusCode:s,headers:{'Content-Type':'application/json',...CORS},body:JSON.stringify(b)});
exports.handler=async(e)=>{
  if(e.httpMethod==='OPTIONS') return j(204,{});
  if(e.httpMethod!=='GET') return j(405,{error:'Method not allowed'});
  const sessionId=new URLSearchParams(e.rawQuery||'').get('session_id');
  if(!sessionId) return j(400,{error:'session_id mancante'});
  try{
    // Recupera la sessione Stripe
    const r=await fetch('https://api.stripe.com/v1/checkout/sessions/'+encodeURIComponent(sessionId),{
      headers:{'Authorization':'Bearer '+process.env.STRIPE_SECRET_KEY}});
    const data=await r.json();
    if(!r.ok) return j(r.status,{error:data.error?.message||'Stripe error'});
    const meta=data.metadata||{};
    const sku=meta.sku||'';
    // Genera scusa solo per scuse (SKU che iniziano con SCUSA o scenari)
    if(/^SCUSA|TRAFFICO|RIUNIONE|CONNESSIONE/.test(sku)){
      const tone=meta.tone||'empatica';
      const msg=meta.message||'';
      const prompt=`Genera una scusa breve e concreta in tono ${tone}. Situazione: ${msg}. Includi spiegazione, ammissione di responsabilità, rimedio e chiusura positiva.`;
      const ai=await fetch('https://api.openai.com/v1/chat/completions',{
        method:'POST',headers:{'Authorization':'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},
        body:JSON.stringify({model:'gpt-4o-mini',temperature:0.5,max_tokens:220,
          messages:[{role:'system',content:'Assistente COLPA MIA per scuse efficaci'},{role:'user',content:prompt}]})
      });
      const jres=await ai.json();
      if(!ai.ok) return j(ai.status,{error:jres.error?.message||'OpenAI error'});
      const text=jres.choices?.[0]?.message?.content?.trim()||'';
      return j(200,{excuse:text});
    }
    return j(200,{message:'Pagamento registrato',metadata:meta});
  }catch(err){return j(500,{error:err.message})}
};
