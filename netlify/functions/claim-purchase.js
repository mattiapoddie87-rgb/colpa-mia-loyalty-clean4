//**
 * netlify/functions/claim-purchase.js
 * Invia via email la scusa finale post-acquisto.
 * - SCUSA_BASE: invia la stessa scusa contestuale di post-checkout.
 * - SCUSA_DELUXE: genera 3 varianti diverse e le invia.
 * - CONNESSIONE/TRAFFICO/RIUNIONE: usa il template finale di post-checkout.
 *
 * Env richieste: STRIPE_SECRET_KEY, RESEND_API_KEY, MAIL_FROM (es. "COLPA MIA <no-reply@colpamia.com>")
 * Facoltative: URL o SITE_URL per costruire l’endpoint post-checkout.
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const MAIL_FROM = process.env.MAIL_FROM || 'COLPA MIA <no-reply@colpamia.com>';

function clean(s){ return (s||'').toString().trim().replace(/\s+/g,' '); }

async function fetchFinalExcuseFromPostCheckout(sessionId) {
  const base = process.env.URL || process.env.SITE_URL || 'https://colpamia.com';
  const url = `${base}/.netlify/functions/post-checkout?session_id=${encodeURIComponent(sessionId)}`;
  const r = await fetch(url);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Errore generazione finale');
  // Preferisce campo "excuse", fallback a "message"
  return data.excuse || data.message || '';
}

async function generateDeluxeExcuses({ message, tone = 'empatica', context = '' }) {
  const prompt =
`Genera una scusa breve, concreta e rispettosa.
Tono: ${tone}. Contesto: ${context || 'generico'}.
Situazione: ${message || '(non fornita)'}.
Includi: ammissione responsabilità, spiegazione sintetica, rimedio pratico, chiusura positiva.
Varia sempre lessico e struttura d’apertura, evita formule ricorrenti.
Niente elenco puntato. Limite 90–120 parole.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method:'POST',
    headers:{
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.85,
      top_p: 0.9,
      frequency_penalty: 0.6,
      presence_penalty: 0.4,
      n: 3,
      max_tokens: 240,
      messages: [
        { role:'system', content:'Assistente COLPA MIA per scuse efficaci e rispettose.' },
        { role:'user',   content: prompt }
      ]
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'OpenAI error');
  return (data.choices||[]).map(c => clean(c?.message?.content)).filter(Boolean);
}

function buildEmailHtml({ title, context, tone, excuses }) {
  let html = `<p>Grazie per il tuo acquisto!</p>`;
  html += `<p>Prodotto: <strong>${title}</strong></p>`;
  html += `<p>Contesto: ${context || '-'}</p>`;
  html += `<p>Tono: ${tone || '-'}</p>`;
  html += `<hr>`;
  if (excuses.length <= 1) {
    const txt = (excuses[0] || '').replace(/\n/g,'<br>');
    html += `<p><strong>Scusa generata:</strong></p><p>${txt}</p>`;
  } else {
    html += `<p><strong>Scuse generate:</strong></p>`;
    html += excuses.map((exc, i) =>
      `<p><em>Versione ${i+1}:</em><br>${(exc||'').replace(/\n/g,'<br>')}</p>`
    ).join('');
  }
  return html;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
    }
    const { session_id } = JSON.parse(event.body || '{}');
    if (!session_id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'session_id mancante' }) };
    }

    // Stripe session + metadata
    const session = await stripe.checkout.sessions.retrieve(session_id, { expand: ['line_items'] });
    const sku     = session.metadata?.sku || '';
    const title   = session.metadata?.title || sku;
    const context = clean(session.metadata?.context);
    const tone    = clean(session.metadata?.tone || 'empatica');
    const message = clean(session.metadata?.message);
    const toEmail = session.customer_details?.email || session.customer_email;

    if (!sku || !toEmail) {
      return { statusCode: 400, body: JSON.stringify({ error: 'SKU o email non disponibili' }) };
    }

    let excuses = [];

    if (sku === 'SCUSA_BASE') {
      // Stessa scusa definitiva della pagina di successo
      const final = await fetchFinalExcuseFromPostCheckout(session_id);
      excuses = [final];
    } else if (sku === 'SCUSA_DELUXE') {
      // Tre varianti diverse
      excuses = await generateDeluxeExcuses({ message, tone, context });
      if (!excuses.length) {
        // fallback minimo
        const final = await fetchFinalExcuseFromPostCheckout(session_id);
        excuses = [final];
      }
    } else {
      // Scenari fissi: template già applicato in post-checkout
      const final = await fetchFinalExcuseFromPostCheckout(session_id);
      excuses = [final];
    }

    const html = buildEmailHtml({ title, context, tone, excuses });

    // Invio email via Resend
    if (!process.env.RESEND_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'RESEND_API_KEY mancante' }) };
    }
    await resend.emails.send({
      from: MAIL_FROM,
      to: toEmail,
      subject: `La tua scusa ${title}`,
      html
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, sent_to: toEmail, sku, count: excuses.length })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
