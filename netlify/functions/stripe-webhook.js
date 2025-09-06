"use strict";

const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const { Resend } = require("resend");
const RESEND_KEY = (process.env.RESEND_API_KEY||"").trim();
const resend = RESEND_KEY ? new Resend(RESEND_KEY) : null;
const MAIL_FROM = process.env.RESEND_FROM || process.env.MAIL_FROM || "COLPA MIA <onboarding@resend.dev>";

const SITE = (process.env.SITE_URL || "https://colpamia.com").replace(/\/+$/,"");

const twSid=(process.env.TWILIO_ACCOUNT_SID||"").trim();
const twTok=(process.env.TWILIO_AUTH_TOKEN||"").trim();
const twFrom=(process.env.TWILIO_FROM_WA||"").trim();
const twilio = (twSid&&twTok)? require("twilio")(twSid,twTok) : null;

const CORS = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"POST,OPTIONS", "Access-Control-Allow-Headers":"Content-Type" };
const j=(s,b)=>({statusCode:s,headers:{ "Content-Type":"application/json", ...CORS },body:JSON.stringify(b)});
const parse = (s,f)=>{try{return JSON.parse(s)}catch{return f}};

const RULES = parse(process.env.PRICE_RULES_JSON||"{}",{});  // { price_xxx OR SKU: {minutes, excuse} }

// --------- minuti per line-item: usa id, lookup_key, metadata, product name ----------
function inferMinutes(li){
  const price   = li?.price || {};
  const prod    = price.product || {};
  const qty     = li?.quantity || 1;

  // 1) regole per price.id
  let r = RULES[price.id];
  if (r?.minutes) return { minutes: Number(r.minutes)*qty, tag: r.excuse||"" };

  // 2) regole per lookup_key/SKU
  const sku = price.lookup_key || price.metadata?.sku || prod?.metadata?.sku;
  r = sku ? RULES[sku] : null;
  if (r?.minutes) return { minutes: Number(r.minutes)*qty, tag: r.excuse||"" };

  // 3) metadata minuti su price/product (se presenti)
  const metaMin = Number(price.metadata?.minutes || prod?.metadata?.minutes || 0);
  if (metaMin>0) return { minutes: metaMin*qty, tag: (price.metadata?.excuse || prod?.metadata?.excuse || "") };

  // 4) euristiche sul nome (ultima rete di sicurezza)
  const name = String(prod?.name || price?.nickname || "").toLowerCase();
  if (/deluxe|executive/.test(name)) return { minutes: 60*qty, tag:"deluxe" };
  if (/tripla|triple/.test(name))   return { minutes: 30*qty, tag:"tripla" };
  if (/base|prima|entry/.test(name))return { minutes: 10*qty, tag:"base" };
  return { minutes: 0, tag: "" };
}

function getCF(session, key){
  const cfs = Array.isArray(session?.custom_fields)? session.custom_fields : [];
  for (const cf of cfs) if ((cf.key||"").toLowerCase()===key) return cf?.text?.value||"";
  return "";
}
function asWA(raw, cc="+39"){
  let t=(raw||"").trim();
  if (/^whatsapp:\+\d{6,15}$/.test(t)) return t;
  if (/^\+\d{6,15}$/.test(t)) return `whatsapp:${t}`;
  let d=String(t).replace(/[^\d]/g,""); if (d.startsWith("00")) d=d.slice(2);
  const p=String(cc).replace("+","");
  if (!d.startsWith(p)) d=p+d;
  return `whatsapp:+${d}`;
}
async function sendWA(to, body){
  if (!twilio||!twFrom||!to) return false;
  try{ await twilio.messages.create({from:twFrom,to:asWA(to),body}); return true; }catch{ return false; }
}
async function emailExcuse(to, minutes, variants){
  if (!resend||!to) return;
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111">
      <h2 style="margin:0 0 12px">La tua scusa</h2>
      ${variants.map(v=>`<p style="margin:10px 0;padding:12px;background:#f6f7fb;border-radius:10px">${(v.whatsapp_text||v.sms||"").replace(/\n/g,"<br>")}</p>`).join("")}
      <p style="margin-top:12px">Accreditati <b>${minutes} minuti</b> sul tuo wallet.</p>
    </div>`;
  await resend.emails.send({ from:MAIL_FROM, to, subject:"La tua scusa ✅", html });
}
async function addMinutes(customerId, delta){
  try{
    const c = await stripe.customers.retrieve(customerId);
    const cur = Number(c?.metadata?.cm_minutes_total||0)||0;
    const next = Math.max(0, cur + (Number(delta)||0));
    await stripe.customers.update(customerId,{ metadata:{ ...c.metadata, cm_minutes_total:String(next) }});
    return next;
  }catch{ return null; }
}

async function genExcuses({need, persona, seed}){
  try{
    const r = await fetch(`${SITE}/.netlify/functions/ai-excuse`,{
      method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ need, persona, style:"neutro", locale:"it-IT", seed, maxLen:320 })
    });
    const d = await r.json();
    const v = Array.isArray(d?.variants)? d.variants.slice(0,3) : [];
    if (v.length) return v;
  }catch{}
  return [
    {whatsapp_text:"Mi è entrato un imprevisto e sto riorganizzando. Appena definito l’orario, ti scrivo entro sera."},
    {whatsapp_text:"Sto chiudendo un’urgenza e rischio ritardo. Ti aggiorno tra poco con un orario realistico."},
    {whatsapp_text:"Situazione imprevista: preferisco non promettere a vuoto. Ti mando a breve un nuovo slot."}
  ];
}

exports.handler = async (event)=>{
  if (event.httpMethod==="OPTIONS") return j(204,{});
  if (event.httpMethod!=="POST")   return j(405,{error:"method_not_allowed"});

  const sig = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
  if (!sig) return j(400,{error:"missing_signature"});

  let ev; try{ ev = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET); }
  catch(e){ return j(400,{error:"bad_signature"}); }

  if (!/^checkout\.session\.(completed|async_payment_succeeded)$/.test(ev.type))
    return j(200,{received:true,ignored:ev.type});

  const session = ev.data.object;

  // line items + expand price & product
  const items = await stripe.checkout.sessions.listLineItems(session.id,{
    limit:100, expand:["data.price.product","data.price"]
  });

  // minuti totali + tag persona
  let minutes = 0, persona = "";
  for (const li of items.data){
    const {minutes:m, tag} = inferMinutes(li);
    minutes += m;
    if (!persona && tag) persona = tag;
  }

  const email = (session?.customer_details?.email || session?.customer_email || "").toLowerCase();
  const need  = getCF(session,"need");
  const variants = await genExcuses({ need, persona: persona||"generico", seed: session.id });

  // accredito sul customer (anche con promo 100%)
  if (session.customer && minutes>0) await addMinutes(session.customer, minutes);

  // email + whatsapp
  try{ await emailExcuse(email, minutes, variants); }catch{}
  try{
    const phones = [ session?.customer_details?.phone, getCF(session,"phone") ].filter(Boolean);
    if (phones.length){
      const text = [
        "La tua Scusa (3 varianti):",
        ...variants.map((v,i)=>`${i+1}) ${v.whatsapp_text||v.sms||""}`),
        "", `(+${minutes} min accreditati su COLPA MIA)`
      ].join("\n");
      for (const p of phones){ if (await sendWA(p, text)) break; }
    }
  }catch{}

  return j(200,{ok:true, minutes, persona, email});
};
