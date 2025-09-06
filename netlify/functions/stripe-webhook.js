// netlify/functions/stripe-webhook.js
"use strict";

const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const { Resend } = require("resend");
const resendKey = (process.env.RESEND_API_KEY || "").trim();
const resend = resendKey ? new Resend(resendKey) : null;
const MAIL_FROM = process.env.RESEND_FROM || process.env.MAIL_FROM || "COLPA MIA <onboarding@resend.dev>";

const SITE = (process.env.SITE_URL || "https://colpamia.com").replace(/\/+$/, "");

// Twilio (opzionale)
const twSid   = (process.env.TWILIO_ACCOUNT_SID || "").trim();
const twTok   = (process.env.TWILIO_AUTH_TOKEN || "").trim();
const twFrom  = (process.env.TWILIO_FROM_WA || "").trim(); // es. whatsapp:+14155238886
const twilio  = (twSid && twTok) ? require("twilio")(twSid, twTok) : null;

const CORS = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"POST,OPTIONS", "Access-Control-Allow-Headers":"Content-Type" };
const j = (s,b)=>({ statusCode:s, headers:{ "Content-Type":"application/json", ...CORS }, body:JSON.stringify(b) });

function safeParse(json, fallback) { try{ return JSON.parse(json); }catch{ return fallback; } }

// ---- Regole minuti (supporta sia chiavi = price.id che chiavi = SKU) ----
const RULES = safeParse(process.env.PRICE_RULES_JSON || "{}", {});
function minutesForLineItem(li){
  const price = li?.price || {};
  const byId  = RULES[price.id];
  if (byId && byId.minutes) return { minutes: Number(byId.minutes)||0, tag: byId.excuse || "" };
  const sku = price.lookup_key || price.metadata?.sku;  // SKU usato come lookup_key
  const bySku = sku ? RULES[sku] : null;
  if (bySku && bySku.minutes) return { minutes: Number(bySku.minutes)||0, tag: bySku.excuse || "" };
  return { minutes:0, tag:"" };
}

// ---- Helpers telefono -> WhatsApp ----
function onlyDigits(s){return String(s||"").replace(/[^\d]/g,"")}
function isE164(s){return /^\+\d{6,15}$/.test(String(s||""))}
function asWhatsApp(raw, defaultCC="+39"){
  let t = (raw||"").trim();
  if (/^whatsapp:\+\d{6,15}$/.test(t)) return t;
  if (isE164(t)) return `whatsapp:${t}`;
  let d = onlyDigits(t);
  if (d.startsWith("00")) d = d.slice(2);
  const cc = String(defaultCC||"+39").replace("+","");
  if (!d.startsWith(cc)) d = cc + d;
  return `whatsapp:+${d}`;
}

// ---- Recupero “need” e telefono dalla sessione ----
function getCustomField(session, key){
  const cfs = Array.isArray(session?.custom_fields) ? session.custom_fields : [];
  for (const cf of cfs) if ((cf.key||"").toLowerCase() === key) return cf?.text?.value || "";
  return "";
}
function phoneCandidates(session, pi){
  const out = new Set();
  const sPhone  = session?.customer_details?.phone; if (sPhone) out.add(sPhone);
  const cfPhone = getCustomField(session, "phone");  if (cfPhone) out.add(cfPhone);
  const chPhone = pi?.charges?.data?.[0]?.billing_details?.phone; if (chPhone) out.add(chPhone);
  return [...out];
}

// ---- Scuse via funzione AI (variazione garantita con seed=session.id) ----
async function generateExcuses({ need, persona, style, seed }){
  const payload = {
    need: need || "",
    persona: persona || "generico",
    style: style || "neutro",
    locale: "it-IT",
    maxLen: 320,
    seed: seed || ""
  };
  try{
    const r = await fetch(`${SITE}/.netlify/functions/ai-excuse`, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(payload)
    });
    const data = await r.json();
    const vs = Array.isArray(data?.variants) ? data.variants.slice(0,3) : [];
    if (vs.length) return vs;
  }catch{}
  // Fallback robusto (3 varianti diverse)
  return [
    { whatsapp_text:"Mi scuso: imprevisto ora, sto riorganizzando. Appena ho chiaro l’orario ti scrivo (entro sera)." },
    { whatsapp_text:"Sto chiudendo un’urgenza e temo un piccolo ritardo. Ti aggiorno a breve con un orario realistico." },
    { whatsapp_text:"Mi dispiace, ho un imprevisto in corso. Minimizzare il ritardo è la priorità: appena definito, ti mando un nuovo slot." }
  ];
}

// ---- Email (Resend) ----
async function sendEmail({ to, minutes, variants }){
  if (!resend) return;
  const rows = (variants||[]).map(v=> `<p style="margin:10px 0;padding:12px;background:#f6f7fb;border-radius:10px">${(v.whatsapp_text||v.sms||"").replace(/\n/g,"<br>")}</p>` ).join("");
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111">
      <h2 style="margin:0 0 12px">La tua scusa</h2>
      ${rows}
      <p style="margin-top:12px">Accreditati <b>${minutes} minuti</b> sul tuo wallet.</p>
    </div>`;
  await resend.emails.send({ from: MAIL_FROM, to, subject:"La tua scusa ✅", html });
}

// ---- WhatsApp (opzionale) ----
async function sendWhatsApp(to, body){
  if (!twilio || !twFrom || !to) return false;
  try{
    await twilio.messages.create({ from: twFrom, to: asWhatsApp(to), body });
    return true;
  }catch{ return false; }
}

// ---- Somma minuti sul Customer metadata ----
async function addMinutesToCustomer(customerId, delta){
  try{
    const c = await stripe.customers.retrieve(customerId);
    const cur = Number(c?.metadata?.cm_minutes_total || 0) || 0;
    const next = Math.max(0, cur + (Number(delta)||0));
    await stripe.customers.update(customerId, { metadata:{ ...c.metadata, cm_minutes_total:String(next) }});
    return next;
  }catch{ return null; }
}

// ===================== HANDLER =====================
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return j(204,{});
  if (event.httpMethod !== "POST")   return j(405,{ error:"method_not_allowed" });

  const sig = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
  if (!sig) return j(400,{ error:"missing_signature" });

  let swEvent;
  try{
    swEvent = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  }catch(e){
    return j(400,{ error:"bad_signature" });
  }

  if (swEvent.type !== "checkout.session.completed" && swEvent.type !== "checkout.session.async_payment_succeeded"){
    return j(200,{ received:true, ignored: swEvent.type });
  }

  const session = swEvent.data.object;

  // Line items -> minuti + “tag” (persona) con supporto promo al 100%
  const items = await stripe.checkout.sessions.listLineItems(session.id, { limit:100, expand:["data.price"] });
  let totalMinutes = 0, tag = "";
  for (const li of items.data){
    const { minutes, tag: t } = minutesForLineItem(li);
    totalMinutes += (minutes || 0) * (li.quantity || 1);
    if (!tag && t) tag = t;
  }

  // Email + telefono
  const email = (session?.customer_details?.email || session?.customer_email || "").toLowerCase();
  const need  = getCustomField(session, "need");
  const persona = tag || "generico";
  const variants = await generateExcuses({
    need,
    persona,
    style: "neutro",
    seed: session.id
  });

  // Accredito minuti sul Customer (anche con promo 100%)
  const customerId = session.customer || null;
  if (customerId && totalMinutes > 0){
    await addMinutesToCustomer(customerId, totalMinutes);
  }

  // Email (best-effort)
  try{ if (email) await sendEmail({ to: email, minutes: totalMinutes, variants }); }catch{}

  // WhatsApp (best-effort)
  try{
    const piId = session.payment_intent || null; // può essere null con sconto 100%
    let pi = null; try{ if (piId) pi = await stripe.paymentIntents.retrieve(piId); }catch{}
    const phones = phoneCandidates(session, pi);
    if (phones.length){
      const text = [
        "La tua Scusa (3 varianti):",
        ...variants.map((v,i)=> `${i+1}) ${(v.whatsapp_text || v.sms || "").trim()}`),
        "",
        `(+${totalMinutes} min accreditati su COLPA MIA)`
      ].join("\n");
      for (const p of phones){ if (await sendWhatsApp(p, text)) break; }
    }
  }catch{}

  return j(200,{ ok:true, minutes: totalMinutes, email, sku_tag: persona });
};
