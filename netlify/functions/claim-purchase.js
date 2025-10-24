/**
 * claim-purchase.js
 *
 * Viene invocato da un webhook o da una procedura interna appena un ordine è confermato.
 * Recupera la sessione Stripe, estrae SKU, contesto e tono, genera le scuse da inviare via email o WhatsApp,
 * poi invia il messaggio tramite il provider configurato (Resend, Twilio, ecc.).
 *
 * Modifiche principali:
 * - Per SCUSA_BASE: chiama post-checkout e invia la stessa scusa contestuale vista dall’utente.
 * - Per SCUSA_DELUXE: genera 3 varianti diverse con l’AI e le invia tutte.
 * - Per scenari fissi (CONNESSIONE, TRAFFICO, RIUNIONE): usa il template finale di post-checkout.
 * - Usa il codice promo già gestito durante il checkout tramite create-checkout-session.js.
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const fetch  = require('node-fetch');
const Resend = require('resend').Resend;

// Inizializza Resend se usi l’email. Oppure usa Twilio per WhatsApp (non mostrato qui).
const resend = new Resend(process.env.RESEND_API_KEY);

// Utility per generare tre varianti con l’AI (scusa deluxe)
async function generateDeluxeExcuses({ message, tone = 'empatica', context = '' }) {
  const prompt =
`Genera una scusa breve, concreta e rispettosa.
Tono: ${tone}. Contesto: ${context || 'generico'}.
Situazione: ${message || '(non fornita)'}.
Includi: ammissione responsabilità, spiegazione sintetica, rimedio pratico, chiusura positiva.
Varia sempre lessico e struttura d’apertura, evita formule ricorrenti.
Niente elenco puntato. Limite 90–120 parole.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
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
        { role: 'system', content: 'Assistente COLPA MIA per scuse efficaci e rispettose.' },
        { role: 'user',   content: prompt }
      ]
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'OpenAI error');

  return (data.choices || [])
    .map(c => c.message?.content?.trim())
    .filter(Boolean);
}

exports.handler = async (event) => {
  try {
    const { session_id } = JSON.parse(event.body || '{}');
    if (!session_id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'session_id mancante' }) };
    }

    // Recupera la sessione Stripe con line_items e metadata
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['line_items']
    });

    // SKU e metadata impostati nel checkout
    const sku     = session.metadata?.sku || '';
    const title   = session.metadata?.title || sku;
    const context = session.metadata?.context || '';
    const tone    = session.metadata?.tone || 'empatica';
    const message = session.metadata?.message || '';

    // Se non abbiamo SKU valido, abortiamo
    if (!sku) {
      return { statusCode: 400, body: JSON.stringify({ error: 'SKU non presente nella sessione' }) };
    }

    // Generazione delle scuse in base allo SKU
    let excuses = [];

    if (sku === 'SCUSA_BASE') {
      // Usa la scusa definitiva (contestuale) generata da post-checkout
      const res = await fetch(`${process.env.URL || process.env.SITE_URL}/.netlify/functions/post-checkout?session_id=${encodeURIComponent(session_id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Errore generazione finale');
      excuses = [data.excuse];
    } else if (sku === 'SCUSA_DELUXE') {
      // Genera tre varianti diverse con l’AI
      excuses = await generateDeluxeExcuses({ message, tone, context });
    } else {
      // Per scenari fissi (CONNESSIONE, TRAFFICO, RIUNIONE) chiama post-checkout per avere la scusa finale
      const res = await fetch(`${process.env.URL || process.env.SITE_URL}/.netlify/functions/post-checkout?session_id=${encodeURIComponent(session_id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Errore generazione finale');
      excuses = [data.excuse];
    }

    // Componi il testo dell’email: elenca tutte le varianti per la deluxe, una sola per gli altri
    let html = `<p>Grazie per il tuo acquisto!</p>`;
    html += `<p>Prodotto: <strong>${title}</strong></p>`;
    html += `<p>Contesto: ${context || '-'}</p>`;
    html += `<p>Tono: ${tone}</p>`;
    html += `<hr>`;
    if (excuses.length === 1) {
      html += `<p><strong>Scusa generata:</strong></p><p>${excuses[0].replace(/\n/g, '<br>')}</p>`;
    } else {
      html += `<p><strong>Scuse generate:</strong></p>`;
      html += excuses.map((exc, i) => `<p><em>Versione ${i + 1}:</em><br>${exc.replace(/\n/g, '<br>')}</p>`).join('');
    }

    // Invia l’e-mail tramite Resend (sostituisci con il tuo provider)
    // NB: assicurati di avere RESEND_API_KEY e un dominio verificato.
    await resend.emails.send({
      from: 'COLPA MIA <no-reply@colpamia.com>',
      to: session.customer_details?.email || session.customer_email,
      subject: `La tua scusa ${title}`,
      html
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Email inviata', excuses })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
