// netlify/functions/stripe-webhook.js
// Webhook Stripe: accredita minuti/punti, genera 3 scuse naturali e invia email + (opzionale) WhatsApp.

const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// Twilio è opzionale; se non configurato, lo saltiamo.
let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  try {
    const twilio = require("twilio");
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  } catch (_) {
    // nessun crash: semplicemente non invieremo WhatsApp
  }
}

// -------- Utilità comuni --------
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Stripe-Signature",
};
const ok = (b) => ({ statusCode: 200, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify(b) });
const bad = (s, m) => ({ statusCode: s, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ error: m }) });

const PRICE_RULES = safeJSON(process.env.PRICE_RULES_JSON) || {}; // { price_id: { excuse:"base|riunione|...", minutes:number } }
const OPENAI_URL = "https://api.openai.com/v1/responses";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const RESEND_KEY = process.env.RESEND_API_KEY || "";
const MAIL_FROM = process.env.RESEND_FROM || process.env.MAIL_FROM || "COLPA MIA <no-reply@colpamia.com>";
const TWILIO_FROM_WA = process.env.TWILIO_FROM_WA || "";
const DEFAULT_COUNTRY = process.env.DEFAULT_COUNTRY_CODE || "+39";

function safeJSON(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }
const take = (x, n) => (Array.isArray(x) ? x.slice(0, n) : []);

// Strippa nomi/greeting superflui e evita eco diretto del contesto
function postProcessExcuse(txt, { buyerName, rawContext }) {
  let t = String(txt || "").trim();

  // 1) niente saluti + nome dell'acquirente
  const candidates = [
    `ciao ${buyerName}`, `ciao, ${buyerName}`, `ehi ${buyerName}`, `${buyerName},`,
    `ciao`, `ehi`, `hey`
  ].filter(Boolean).map(s => s.toLowerCase());
  const low = t.toLowerCase();
  for (const c of candidates) {
    if (low.startsWith(c + " ")) { t = t.slice(c.length + 1).trim(); break; }
    if (low.startsWith(c + ",")) { t = t.slice(c.length + 1).trim(); break; }
  }

  // 2) se contiene troppo del contesto, accorcia/parafrasa un minimo
  const ctx = String(rawContext || "").toLowerCase().trim();
  if (ctx && t.toLowerCase().includes(ctx) && ctx.length > 10) {
    // Togliamo la frase più simile al contesto
    t = t.replace(new RegExp(ctx.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "").trim();
    if (!t) t = "Sto incastrando un imprevisto, arrivo più tardi e ti aggiorno presto.";
  }

  // 3) pulizia minima
  t = t.replace(/\s+/g, " ").trim();
  if (t.length > 220) t = t.slice(0, 220).trim();
  if (!/[.!?]$/.test(t)) t += ".";

  return t;
}

// -------- AI: prompt curato per naturalezza/varietà --------
async function generateExcuses({ excuseType, context, buyerName, lang = "it" }) {
  // Guidiamo lo stile: 3 varianti con toni diversi, NO nome acquirente, NO eco letterale, 1–2 frasi ciascuna.
  const sys = `
Sei uno scrittore esperto di messaggi brevi per WhatsApp/SMS/Email.
Devi creare SCUSE credibili in prima persona singolare che sembrino scritte da un umano.
Regole tassative:
- Lingua: ${lang}.
- NON salutare e NON usare nomi propri (non usare "${buyerName}" né altri).
- NON copiare letteralmente il "Contesto"; usalo solo come ispirazione e parafrasa.
- 1–2 frasi per variante, massimo ~220 caratteri.
- Sii credibile e vario: una variante più professionale, una più informale, una più empatica.
- Non menzionare piani/livelli (es. "base", "deluxe"), AI o Stripe.
- Tono: diretto, naturale; piccola promessa di aggiornamento o alternativa è ben accetta.
- Tema scusa: ${excuseType || "generico"}.
Ritorna SOLO un JSON valido:
{"varianti": ["...", "...", "..."]}
`;

  const user = `
Contesto (ispirazione, da parafrasare): """${(context || "").trim()}"""
`;

  // Chiamata Responses API (Node 18: fetch nativo)
  const r = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [{ role: "system", content: sys }, { role: "user", content: user }],
      temperature: 0.95,
      max_output_tokens: 320,
    }),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`OpenAI error ${r.status}: ${txt}`);
  }
  const data = await r.json();
  const raw = data?.output?.[0]?.content?.[0]?.text || data?.output_text || "";

  // Proviamo a leggere JSON
  let out = [];
  try {
    const parsed = JSON.parse(raw);
    out = take(parsed.varianti, 3).map(x => String(x || "").trim());
  } catch {
    // Fallback: separiamo per righe/punti elenco
    out = raw.split(/\n+/g).map(s => s.replace(/^[-•\d.)\s]+/, "").trim()).filter(Boolean);
    out = take(out, 3);
  }

  // Post-process robusto
  const uniq = new Set();
  const final = [];
  for (const x of out) {
    const y = postProcessExcuse(x, { buyerName, rawContext: context });
    if (y && !uniq.has(y.toLowerCase())) {
      uniq.add(y.toLowerCase());
      final.push(y);
    }
  }
  // Se per qualunque motivo meno di 3, completiamo con mini-varianti sicure
  while (final.length < 3) {
    final.push("Sto gestendo un imprevisto, potrei tardare un po’. Ti aggiorno appena posso.");
  }
  return take(final, 3);
}

// -------- invio email (Resend) --------
async function sendEmail({ to, subject, html }) {
  if (!RESEND_KEY || !to) return;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: MAIL_FROM, to, subject, html }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Resend ${r.status}: ${t}`);
  }
}

// -------- invio WhatsApp (Twilio) --------
async function sendWhatsApp({ toPhone, body }) {
  if (!twilioClient || !TWILIO_FROM_WA || !toPhone) return;
  let to = String(toPhone).trim();
  if (!to.startsWith("whatsapp:")) {
    // normalizziamo a E.164 con prefisso
    if (!to.startsWith("+")) to = DEFAULT_COUNTRY + to.replace(/\D+/g, "");
    to = "whatsapp:" + to;
  }
  await twilioClient.messages.create({
    from: TWILIO_FROM_WA,
    to,
    body,
  });
}

// -------- HTML email semplice --------
function emailHTML(varianti, minutes) {
  const item = (t) => `<div style="margin:8px 0;padding:10px;border:1px solid #e5e7eb;border-radius:10px;background:#0f1623;color:#e9eef5">${escapeHTML(t)}</div>`;
  return `
  <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color:#e9eef5; background:#0b0d12; padding:18px">
    <h2 style="margin:0 0 8px">La tua scusa</h2>
    ${varianti.map(item).join("")}
    <p style="margin-top:16px">Accreditati <b>${minutes}</b> minuti sul tuo wallet.</p>
    <p style="opacity:.8;font-size:13px">Suggerimento: copia la variante che preferisci e incollala nel canale giusto.</p>
  </div>`;
}
function escapeHTML(s){return String(s||"").replace(/[&<>"]/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[m]));}

// -------- minutes/tier dalle line items --------
async function minutesFromSession(sessionId) {
  const items = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 100, expand: ["data.price"] });
  let tot = 0;
  let type = "generico";
  for (const li of items.data) {
    const priceId = li?.price?.id;
    const q = li?.quantity || 1;
    const rule = priceId && PRICE_RULES[priceId];
    if (rule) {
      tot += (Number(rule.minutes) || 0) * q;
      if (rule.excuse) type = rule.excuse;
    }
  }
  return { minutes: tot, excuseType: type };
}

// -------- Handler principale --------
exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };
    if (event.httpMethod !== "POST") return bad(405, "Method not allowed");

    const sig = event.headers["stripe-signature"];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return bad(500, "Missing STRIPE_WEBHOOK_SECRET");

    let stripeEvent;
    try {
      stripeEvent = stripe.webhooks.constructEvent(event.body, sig, secret);
    } catch (err) {
      return bad(400, `Signature error: ${err.message}`);
    }

    if (stripeEvent.type !== "checkout.session.completed") {
      return ok({ received: true, skipped: stripeEvent.type });
    }

    const session = stripeEvent.data.object;
    // Email e telefono autorevoli dalla sessione Stripe
    const email = session?.customer_details?.email || session?.customer_email || null;
    const phone = session?.customer_details?.phone || null;
    const buyerName = (session?.customer_details?.name || "").split(" ")[0] || ""; // solo per evitare di usarlo

    const { minutes, excuseType } = await minutesFromSession(session.id);
    const piId = String(session.payment_intent || "");
    if (!piId) return ok({ received: true, note: "no PI" });

    // Idempotenza: se già accreditato, skip (ma possiamo rigenerare e reinviare se vuoi; qui evitiamo doppio accredito)
    const pi = await stripe.paymentIntents.retrieve(piId);
    if (pi?.metadata?.colpamiaCredited === "true") {
      return ok({ received: true, credited: false, reason: "already-credited" });
    }

    // Preleva "contesto" dal campo personalizzato
    let context = "";
    try {
      const cf = session?.custom_fields || [];
      const found = cf.find(f => (f.key === "need" || f.key === "contesto") && f.text?.value);
      context = found?.text?.value || "";
    } catch {}

    // --- Accredito minuti nel tuo sistema (se hai una funzione wallet locale la chiami qui) ---
    try {
      const wallet = require("./wallet");
      if (wallet && typeof wallet.creditMinutes === "function") {
        await wallet.creditMinutes(email, minutes, { session_id: session.id, piId });
      }
    } catch (_) { /* opzionale */ }

    // Marca il PI come accreditato su Stripe (idempotenza)
    const newMeta = { ...(pi.metadata || {}), colpamiaCredited: "true" };
    await stripe.paymentIntents.update(piId, { metadata: newMeta });

    // --- Genera scuse (AI migliorata) ---
    let varianti = ["Sto gestendo un imprevisto, ti aggiorno appena posso.", "Ritardo per un contrattempo, recupero tra poco.", "Mi scuso, ho dovuto cambiare i piani all’ultimo: ti faccio sapere a breve."];
    if (OPENAI_API_KEY) {
      try {
        varianti = await generateExcuses({
          excuseType,
          context,
          buyerName, // usato solo per vietarne l’uso
          lang: "it",
        });
      } catch (err) {
        // fallback soft senza bloccare il flusso
        console.error("AI generation failed:", err?.message || err);
      }
    }

    // --- Invii ---
    const subject = "La tua scusa è pronta";
    const html = emailHTML(varianti, minutes);
    if (RESEND_KEY && email) {
      try {
        await sendEmail({ to: email, subject, html });
        await stripe.paymentIntents.update(piId, {
          metadata: { ...(pi.metadata || {}), colpamiaEmailSent: "true" },
        });
      } catch (err) {
        console.error("Resend error:", err?.message || err);
      }
    }

    // WhatsApp: inviamo solo la variante 2 (informale) per non essere prolissi
    if (twilioClient && TWILIO_FROM_WA && phone) {
      const waBody = `La tua scusa (variante breve):\n${varianti[1]}\n\n(+${minutes} minuti nel wallet)`;
      try { await sendWhatsApp({ toPhone: phone, body: waBody }); } catch (err) { console.error("Twilio error:", err?.message || err); }
    }

    return ok({ received: true, credited: true, email, minutes, excuseType });
  } catch (err) {
    console.error("Webhook error:", err);
    return bad(500, err.message || "internal error");
  }
};
