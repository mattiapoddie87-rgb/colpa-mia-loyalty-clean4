/*
 * Updated version of the post-checkout Netlify function.
 *
 * This implementation retrieves Stripe session metadata and generates a
 * personalized excuse using OpenAI for **all** SKUs.  It takes into
 * account not only the context and message but also any optional
 * `details` provided by the user during checkout.  Static templates
 * have been removed in favour of a unified AI-driven approach.
 */

// CORS headers to support cross-origin requests from the frontend.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,OPTIONS'
};

// Helper to build a JSON response with appropriate headers.
const j = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', ...CORS },
  body: JSON.stringify(body)
});

// Sanitize and normalize input strings: trim, collapse whitespace,
// return an empty string when undefined/null.
function clean(s) {
  return (s || '').toString().trim().replace(/\s+/g, ' ');
}

// Compute a simple diversity score to pick the most varied AI reply
// relative to the user's message.  This encourages variety and
// reduces echoing back the input.
function diversityScore(text, userMsg) {
  const t = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '');
  const u = (userMsg || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '');
  const tWords = t.split(/\s+/).filter(Boolean);
  const uSet  = new Set(u.split(/\s+/).filter(Boolean));
  const uniq  = new Set(tWords);
  const overlap = tWords.filter(w => uSet.has(w)).length;
  const ratioUniq = uniq.size / Math.max(1, tWords.length);
  const antiEcho  = 1 - (overlap / Math.max(1, tWords.length));
  const lenBonus  = Math.min(tWords.length, 140) / 140;
  return ratioUniq * 0.5 + antiEcho * 0.35 + lenBonus * 0.15;
}

exports.handler = async (event) => {
  // Preflight for CORS
  if (event.httpMethod === 'OPTIONS') return j(204, {});
  if (event.httpMethod !== 'GET')     return j(405, { error: 'Method not allowed' });

  // Expect a session_id in the query string
  const sessionId = new URLSearchParams(event.rawQuery || '').get('session_id');
  if (!sessionId) return j(400, { error: 'session_id mancante' });

  try {
    // Fetch checkout session from Stripe
    const resp = await fetch('https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(sessionId), {
      headers: { 'Authorization': 'Bearer ' + process.env.STRIPE_SECRET_KEY }
    });
    const S = await resp.json();
    if (!resp.ok) return j(resp.status, { error: S.error?.message || 'Stripe error' });

    const meta    = S.metadata || {};
    const sku     = meta.sku || '';
    const tone    = (meta.tone || 'empatica').toLowerCase();
    const message = clean(meta.message);
    const context = clean(meta.context);
    const details = clean(meta.details);

    // Build the prompt for OpenAI.  Incorporate tone, context, message
    // and details when present.  The instructions ask the model to
    // include responsibility, a concise explanation, a practical remedy,
    // and a positive closing.  The prompt avoids bullet lists and
    // requests varied structure and wording.
    const prompt =
`Genera una scusa breve, concreta e rispettosa.
Tono: ${tone}. Contesto: ${context || 'generico'}.
Situazione: ${message || '(non fornita)'}.
${details ? `Dettagli da includere: ${details}.\n` : ''}
Includi: ammissione responsabilità, spiegazione sintetica, rimedio pratico, chiusura positiva.
Varia sempre lessico e struttura d’apertura, evita formule ricorrenti.
Niente elenco puntato. Limite 90–120 parole.`;

    // Call OpenAI chat completion API for 3 candidate excuses.  The
    // model, temperature and penalty parameters mirror those used in
    // the original implementation, encouraging variety and avoiding
    // repetition.
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY,
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

    const d = await r.json();
    if (!r.ok) return j(r.status, { error: d.error?.message || 'OpenAI error' });

    const candidates = (d.choices || [])
      .map(c => (c?.message?.content || '').trim())
      .filter(Boolean);

    // Select the candidate with the highest diversity score relative to
    // the user's provided message.
    let best = candidates[0] || '';
    let bestScore = -1;
    for (const c of candidates) {
      const s = diversityScore(c, message);
      if (s > bestScore) { bestScore = s; best = c; }
    }

    return j(200, { excuse: best, metadata: { sku, tone, context } });
  } catch (e) {
    return j(500, { error: e.message });
  }
};
