const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

// TODO: sostituisci con il tuo accesso DB reale
const store = { orders: new Map() }; // Map session_id -> order

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    let { session_id, email_fallback, phone } = body;

    session_id = String(session_id || '').replace(/\s/g, '');
    if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(session_id)) return resp(400, { error: 'Session ID non valido' });

    const isLiveId = session_id.startsWith('cs_live_');
    const isLiveKey = String(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live_');
    if (isLiveId !== isLiveKey) return resp(400, { error: 'Session ID Live/Test non coerente con la chiave' });

    const s = await stripe.checkout.sessions.retrieve(session_id);
    if (s.mode !== 'payment') return resp(400, { error: 'Sessione non di pagamento' });
    if (s.payment_status !== 'paid') return resp(409, { error: 'Pagamento non riuscito o non acquisito' });

    if (store.orders.has(session_id)) return resp(200, { ok: true, credited: false, reason: 'già accreditato' });

    const items = await stripe.checkout.sessions.listLineItems(session_id, { limit: 100 });

    // Mappa prezzi -> minuti (metti i tuoi price_id reali)
    let minutes = 0;
    for (const li of items.data) {
      switch (li.price?.id) {
        case process.env.PRICE_BASE_5: minutes += 5; break;
        case process.env.PRICE_BASE_15: minutes += 15; break;
        case process.env.PRICE_PREMIUM_30: minutes += 30; break;
        default: throw new Error(`Prezzo non mappato: ${li.price?.id}`);
      }
    }
    if (minutes <= 0) return resp(400, { error: 'Nessun articolo valido per accredito' });

    const email =
      s.customer_details?.email ||
      s.customer_email ||
      (email_fallback && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email_fallback) ? email_fallback : null);

    if (!email) return resp(400, { error: 'Email assente/illeggibile' });

    // Idempotenza (qui simulata; nel tuo DB crea UNIQUE(session_id))
    store.orders.set(session_id, { email, minutes, phone });

    // TODO: accredita minuti nel tuo wallet + invia email/whatsapp
    return resp(200, { ok: true, credited: true, minutes, email });
  } catch (e) { return resp(500, { error: e.message }); }
};

function resp(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
