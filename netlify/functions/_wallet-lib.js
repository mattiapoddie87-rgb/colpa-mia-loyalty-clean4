// _wallet-lib.js — wallet minuti per email (idempotente), fallback Blobs manuale

function now() { return Math.floor(Date.now() / 1000); }
const keyEmail = (e) => `u:${String(e || '').trim().toLowerCase()}`;
const keyTx    = (id) => `tx:${String(id || '').trim()}`;

async function getStore() {
  const blobs = await import('@netlify/blobs');

  // 1) tentativo auto-config (Blobs abilitati nel sito)
  if (typeof blobs.getStore === 'function') {
    try {
      return blobs.getStore('wallets'); // può lanciare se l'env non è configurato
    } catch (_) { /* fallback sotto */ }
  }

  // 2) fallback manuale con env
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token  = process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) {
    return blobs.createClient({ siteID, token }).getStore('wallets');
  }

  // 3) ultimo fallback: no-op store (non persistente) per NON rompere le altre funzioni
  console.warn('Blobs non configurati: usa NETLIFY_SITE_ID e NETLIFY_BLOBS_TOKEN o abilita Blobs nel sito.');
  const mem = new Map();
  return {
    async get(k){ return mem.get(k) || null; },
    async set(k,v){ mem.set(k, v); },
  };
}

async function getWallet(email) {
  const store = await getStore();
  const js = await store.get(keyEmail(email));
  if (!js) return { email: String(email||'').toLowerCase(), minutes: 0, history: [], updatedAt: now() };
  try { return JSON.parse(js); }
  catch { return { email: String(email||'').toLowerCase(), minutes: 0, history: [], updatedAt: now() }; }
}

async function saveWallet(w) {
  const store = await getStore();
  w.updatedAt = now();
  await store.set(keyEmail(w.email), JSON.stringify(w));
  return w;
}

async function creditMinutes({ email, minutes, reason, meta = {}, txKey }) {
  if (!email) throw new Error('email mancante');
  const store = await getStore();

  if (txKey) {
    const seen = await store.get(keyTx(txKey));
    if (seen) return getWallet(email); // idempotenza
  }

  const w = await getWallet(email);
  const delta = Math.max(0, parseInt(minutes || 0, 10));
  if (delta <= 0) return w;

  w.minutes = (w.minutes || 0) + delta;
  w.history = w.history || [];
  w.history.unshift({ ts: now(), delta, reason: reason || 'credit', meta });
  await saveWallet(w);

  if (txKey) await store.set(keyTx(txKey), '1');
  return w;
}

async function redeemMinutes({ email, minutes, reason, meta = {} }) {
  const w = await getWallet(email);
  const delta = Math.max(0, parseInt(minutes || 0, 10));
  if (delta <= 0) throw new Error('minuti non validi');
  if ((w.minutes || 0) < delta) throw new Error('saldo insufficiente');
  w.minutes -= delta;
  w.history = w.history || [];
  w.history.unshift({ ts: now(), delta: -delta, reason: reason || 'redeem', meta });
  await saveWallet(w);
  return w;
}

module.exports = { getWallet, creditMinutes, redeemMinutes };
