// SOLO piccola modifica rispetto alla tua versione: prendiamo il CONTENUTO del campo custom `need`
// e lo passiamo 1:1 all'AI. Il resto identico a prima.

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion:'2024-06-20' });

const SITE_URL   = (process.env.SITE_URL || '').replace(/\/+$/,'');
const RESEND_KEY = (process.env.RESEND_API_KEY || '').trim();
const MAIL_FROM  = process.env.RESEND_FROM || process.env.MAIL_FROM || 'COLPA MIA <onboarding@resend.dev>';
const TW_SID     = (process.env.TWILIO_ACCOUNT_SID || '').trim();
const TW_TOKEN   = (process.env.TWILIO_AUTH_TOKEN || '').trim();
const TW_FROM_WA = (process.env.TWILIO_FROM_WA || '').trim();

const j=(s,b)=>({statusCode:s,headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
const pick=(x,p,d=null)=>{try{return p.split('.').reduce((a,c)=>(a&&a[c]!=null?a[c]:null),x)??d;}catch{return d;}};
function rules(){try{return JSON.parse(process.env.PRICE_RULES_JSON||'{}');}catch{return{};}}

async function listItems(sessionId){
  return await stripe.checkout.sessions.listLineItems(sessionId,{limit:100,expand:['data.price.product']})
    .then(r=>r.data||[]).catch(()=>[]);
}
function personaFrom(items, map){
  for (const li of items){ const pid=pick(li,'price.id',''); if(pid && map[pid]?.excuse) return String(map[pid].excuse); }
  return 'base';
}
function minutesFrom(items, map){
  let tot=0;
  for (const li of items){
    const q=li.quantity||1, pid=pick(li,'price.id','');
    if (pid && map[pid]) { tot += Number(map[pid].minutes||0)*q; continue; }
    const m1=Number(pick(li,'price.metadata.minutes',0))||0;
    const m2=Number(pick(li,'price.product.metadata.minutes',0))||0;
    tot += (m1||m2)*q;
  }
  return tot;
}
function getNeed(session){
  const cfs = Array.isArray(session?.custom_fields) ? session.custom_fields : [];
  for (const cf of cfs){ if((cf.key||'').toLowerCase()==='need' && cf?.text?.value) return String(cf.text.value).trim(); }
  return '';
}

async function sendWA(to, text){
  if(!TW_SID||!TW_TOKEN||!TW_FROM_WA) return {ok:false};
  if(!/^\+\d{6,15}$/.test(String(to||''))) return {ok:false};
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`,{
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded','Authorization':'Basic '+Buffer.from(`${TW_SID}:${TW_TOKEN}`).toString('base64')},
    body: new URLSearchParams({From:TW_FROM_WA, To:`whatsapp:${to}`, Body:text}).toString()
  });
  return { ok:r.ok };
}
async function sendEmail(to, subject, html){
  if(!RESEND_KEY) return {ok:false};
  const r = await fetch('https://api.resend.com/emails',{
    method:'POST', headers:{'Authorization':`Bearer ${RESEND_KEY}`,'Content-Type':'application/json'},
    body: JSON.stringify({from:MAIL_FROM,to:[to],subject,html})
  });
  return { ok:r.ok };
}
async function getExcuses(need, persona, locale){
  const seed = Math.floor(Math.random()*1e9);
  const r = await fetch(`${SITE_URL}/.netlify/functions/ai-excuse`,{
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ need, persona, style:'neutro', locale, maxLen:320, seed })
  });
  const d = await r.json().catch(()=> ({}));
  const arr = Array.isArray(d?.variants)? d.variants: [];
  return arr.map(v=>String(v?.whatsapp_text||'').trim()).filter(Boolean).slice(0,3);
}
async function incCustomerMinutes(customerId, add){
  if(!customerId || !add) return;
  try{
    const c=await stripe.customers.retrieve(customerId);
    const prev=Number(c?.metadata?.wallet_minutes||0)||0;
    await stripe.customers.update(customerId,{ metadata:{ wallet_minutes:String(prev+add) }});
  }catch{}
}

exports.handler = async (event)=>{
  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  let evt; try{ evt=stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET); }
  catch(e){ return j(400,{error:'invalid_signature'}); }

  if (evt.type!=='checkout.session.completed') return j(200,{ok:true,ignored:true});

  try{
    const s = await stripe.checkout.sessions.retrieve(evt.data.object.id);
    const items = await listItems(s.id);
    const map = rules();

    const email = (s.customer_details?.email||'').toLowerCase().trim();
    const phone = (s.customer_details?.phone||'').trim();
    const need  = getNeed(s) || 'Ritardo reale: serve una scusa credibile legata al contesto.';
    const persona = personaFrom(items, map);
    const locale  = s.locale || 'it-IT';
    const minutes = minutesFrom(items, map);

    const variants = await getExcuses(need, persona, locale);
    const v3 = variants.length ? variants : [
      'Imprevisto reale: sto riorganizzando. Ti aggiorno entro le 18 con tempi chiari.',
      'Urgenza in corso: minimizzo il ritardo e ti propongo un nuovo slot a breve.',
      'Preferisco non promettere orari a vuoto: ti scrivo tra poco con un timing concreto.'
    ];

    // WA = 3 varianti numerate
    let waSent=false;
    if (phone){
      const text = 'COLPA MIA — La tua Scusa (3 varianti):\n\n'
        + v3.map((t,i)=>`${i+1}) ${t}`).join('\n\n')
        + (minutes? `\n\n(+${minutes} min accreditati sul wallet)` : '');
      const wa = await sendWA(phone, text); waSent = !!wa.ok;
    }

    // Email = elenco 3 varianti
    let emailSent=false;
    if (email){
      const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111">
        <h2 style="margin:0 0 10px">La tua scusa</h2>
        <ol>${v3.map(t=>`<li>${t}</li>`).join('')}</ol>
        ${minutes? `<p style="margin-top:12px;color:#444">Accreditati <b>${minutes}</b> minuti sul tuo wallet.</p>`:''}
      </div>`;
      const em = await sendEmail(email,'La tua Scusa — COLPA MIA',html); emailSent=!!em.ok;
    }

    // Accredito persistito (anche con promo)
    if (minutes && s.customer) await incCustomerMinutes(s.customer, minutes);

    // Metadati su PI (se esiste)
    if (s.payment_intent){
      try{
        await stripe.paymentIntents.update(s.payment_intent,{
          metadata:{
            customerEmail: email||'',
            minutesCredited:String(minutes||0),
            excusesCount:String(v3.length||0),
            colpamiaEmailSent: emailSent?'true':'false',
            colpamiaWaStatus: waSent?'sent':'skip'
          }
        });
      }catch{}
    }

    return j(200,{ok:true,variants:v3.length,usedNeed:need,persona,minutes,emailSent,waSent});
  }catch(e){
    return j(500,{error:'webhook_error',detail:String(e?.message||e)});
  }
};

