// Serverless: crea una Sessione di Stripe Checkout
// Requisiti: ENV STRIPE_SECRET_KEY, SITE_URL (opzionale)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};
const j = (s,b)=>({statusCode:s, headers:{'Content-Type':'application/json',...CORS}, body:JSON.stringify(b)});

const PRICE_BY_SKU = {
  // TODO: sostituisci con i tuoi price_XXXX di Stripe
  BASE_5:      'price_xxx_base5',
  BASE_15:     'price_xxx_base15',
  PREMIUM_30:  'price_xxx_premium30',
  // Alias dalla home, se vuoi collegarli direttamente
  SCUSA_BASE:     'price_xxx_base5',
  SCUSA_DELUXE:   'price_xxx_base15',
  TRAFFICO:       'price_xxx_base5',
  RIUNIONE:       'price_xxx_base5',
  CONNESSIONE:    'price_xxx_base5'
};

exports.handler = async (event) => {
  if(event.httpMethod==='OPTIONS') return j(204,{});
  if(event.httpMethod!=='POST')    return j(405,{error:'Method not allowed'});
  try{
    const { sku, email, title, context } = JSON.parse(event.body || '{}');
    if(!sku || !email) return j(400,{error:'sku e email richiesti.'});

    const price = PRICE_BY_SKU[sku];
    if(!price) return j(400,{error:`SKU non valido: ${sku}`});

    const origin = event.headers.origin || process.env.SITE_URL || 'https://colpamia.com';
    const success = `${origin}/?ok=1`;
    const cancel  = `${origin}/checkout.html?canceled=1`;

    // Stripe REST (no SDK) – form-encoded
    const form = new URLSearchParams();
    form.append('mode','payment');
    form.append('success_url', success);
    form.append('cancel_url', cancel);
    form.append('customer_email', email);
    form.append('line_items[0][price]', price);
    form.append('line_items[0][quantity]','1');
    // metadata utili
    if(title)   form.append('metadata[title]', title);
    if(context) form.append('metadata[context]', context);
    form.append('metadata[sku]', sku);

    const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method:'POST',
      headers:{
        'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type':'application/x-www-form-urlencoded'
      },
      body: form.toString()
    });
    const data = await resp.json();
    if(!resp.ok) return j(resp.status, { error: data.error?.message || 'Stripe error' });

    return j(200, { url: data.url });
  }catch(e){
    return j(500,{error:e.message});
  }
};
