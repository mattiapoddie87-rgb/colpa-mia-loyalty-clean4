COLPA MIA — ZIP DEFINITIVO

COSA FARE (MINIMO):
1) Netlify → Site settings → Environment variables (Production):
   - STRIPE_SECRET_KEY = sk_test_... (poi sk_live_... per andare live)
   - SITE_URL = https://colpamia.com
   - STRIPE_WEBHOOK_SECRET = whsec_... (opzionale ma consigliato)
2) Carica TUTTI i file di questo zip nel repo (public/ + netlify/functions/).
3) Deploy. Apri il sito.
4) Test in modalità test Stripe (carta 4242 4242 4242 4242).
5) Wallet: /wallet.html → inserisci email usata al checkout → vedi minuti, punti, tier.

NOTE:
- I prodotti/prezzi Stripe vengono creati automaticamente via lookup_key=SKU, in test o live in base alla chiave.
- Punti = Minuti (1:1). Tier: Bronze ≥1, Silver ≥80, Gold ≥200, Platinum ≥500 punti.
- Tutto lo stile richiesto: tema scuro, pulsanti azzurri con glow, sfondo fluo, particelle e strisce animate.
