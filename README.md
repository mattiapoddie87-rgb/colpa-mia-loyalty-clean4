# Colpa Mia — Netlify Pack (FINAL)

Frontend statico + funzioni Netlify (Stripe opzionale).

## Struttura
- `/public` → file statici (index.html incluso)
- `/netlify/functions` → funzioni serverless
- `netlify.toml` → publish `public`, funzioni in `netlify/functions`
- `package.json` → dipendenze funzioni (Stripe)

## Variabili ambiente richieste (Netlify → Site settings → Environment)
- `STRIPE_SECRET_KEY`  (sk_test_... / sk_live_...)
- `STRIPE_WEBHOOK_SECRET` (facoltativa per /stripe-webhook)
- `SITE_URL` (es. https://colpamia.com)
- `ADMIN_EMAILS` (facoltativa)

## Test rapido
- Apri il sito → premi **Chiama /health** → deve rispondere `ok`.
- Imposta `STRIPE_SECRET_KEY` → clicca **Crea Checkout di test** → reindirizza a Stripe.
