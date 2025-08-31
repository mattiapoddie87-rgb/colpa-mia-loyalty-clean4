// ai-reserve.js
export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed',{status:405});
  const { sku, tone, dest, channel, phone, email, fields } = await req.json().catch(()=> ({}));

  if(!sku || !tone || !dest) return Response.json({error:'Parametri mancanti'}, {status:400});

  // Piccola whitelist
  const ALLOWED = ['SCUSA_BASE','SCUSA_TRIPLA','SCUSA_DELUXE','RIUNIONE','TRAFFICO','CONN_KO'];
  if(!ALLOWED.includes(sku)) return Response.json({error:'SKU non valido'},{status:400});

  // Prompt costruito in modo "ultra-credibile", antiripetizione
  const sys = `Sei un assistente che scrive scuse ultra-credibili, concise, coerenti al contesto.
- Evita ripetizioni, toni teatrali o superlativi.
- Mantieni lunghezza 60–120 parole per email; 20–40 per messaggio breve.
- Adatta stile a TONE e DESTINATARIO (mai ironico verso capo/HR).
- Nessun dato sensibile inventato (usa indicatori generici: "ticket aperto", "verifica in corso").`;

  const user = `SKU: ${sku}
TONE: ${tone}
DESTINATARIO: ${dest}
CANALE: ${channel}
DETTAGLI: ${JSON.stringify(fields)}`;

  // Chiama OpenAI (REST)
  const body = {
    model: "gpt-4o-mini",
    messages: [{role:"system", content:sys}, {role:"user", content:user}],
    temperature: 0.6
  };

  const ai = await fetch('https://api.openai.com/v1/chat/completions',{
    method:'POST',
    headers:{
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const out = await ai.json();
  if(!ai.ok) return Response.json({error: out?.error?.message || 'AI failure'}, {status:500});

  const text = out.choices?.[0]?.message?.content?.trim() || 'Testo generato.';
  const teaser = text.split('\n').join(' ').slice(0,110)+'…';

  // Salva draft (Netlify Blobs)
  const { blobs } = await import('@netlify/blobs');
  const store = blobs({name:'drafts'});
  const draft_id = crypto.randomUUID();

  await store.setJSON(draft_id, {
    status:'reserved',
    sku, tone, dest, channel, phone: phone||null, email: email||null,
    fields,
    teaser,
    // opzionalmente salviamo anche il testo bozza; al webhook potremmo rigenerare
    draft:text,
    created_at: Date.now()
  });

  return Response.json({ draft_id, teaser });
};
