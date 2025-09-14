// _wallet-lib.js — Wallet minuti persistito su Netlify Blobs con fallback
function now() { return Math.floor(Date.now() / 1000); }
const kEmail = (e) => `u:${String(e || '').trim().toLowerCase()}`;
const kTx    = (id) => `tx:${String(id || '').trim()}`;

async function getStore() {
  const mod = await import('@netlify/blobs');

  // 1) tentativo auto-config
  if (typeof mod.getStore === 'function') {
    try { return mod.getStore('wallets'); } catch { /* fallback */ }
  }

  // 2) client manuale: gestisci tutte le varianti dell’SDK
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token  = process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) {
    let client = null;

    if (typeof mod.createClient === 'function') {
      client = mod.createClient({ siteID, token });
    } else if (mod && typeof mod.BlobsClient === 'function') {
      client = new mod.BlobsClient({ siteID, token });
    } else if (mod.default && typeof mod.default.createClient === 'function') {
      client = mod.default.createClient({ siteID, token });
    }

    if (client && typeof client.getStore === 'function') {
      return client.getStore('wallets');
    }
  }

  // 3) fallback in-memory per non rompere il sito
  console.warn('Blobs non configurati o SDK diverso: uso store in-memory.');
  const mem = new Map();
  return {
    async get(k){ return mem.get(k) ?? null; },
    async set(k,v){ mem.set(k, v); },
  };
}

async function load(email) {
  const store = await getStore();
  const raw = await store.get(kEmail(email));
  if (!raw) return { email: String(email||'').toLowerCase(), minutes: 0, history: [], updatedAt: now() };
  try { return JSON.parse(raw); }
  catch { return { email: String(email||'').toLowerCase(), minutes: 0, history: [], updatedAt: now() }; }
}

async function save(w) {
  const store = await getStore();
  w.updatedAt = now();
  await store.set(kEmail(w.email), JSON.stringify(w));
  return w;
}

async function creditMinutes({ email, minutes, reason, meta = {}, txKey }) {
  if (!email) throw new Error('email mancante');
  const store = await getStore();

  if (txKey) {
    const seen = await store.get(kTx(txKey));
    if (seen) return load(email);
  }

  const w = await load(email);
  const delta = Math.max(0, parseInt(minutes || 0, 10));
  if (delta <= 0) return w;

  w.minutes = (w.minutes || 0) + delta;
  w.history = w.history || [];
  w.history.unshift({ ts: now(), delta, reason: reason || 'credit', meta });
  await save(w);

  if (txKey) await store.set(kTx(txKey), '1');
  return w;
}

async function redeemMinutes({ email, minutes, reason, meta = {} }) {
  const w = await load(email);
  const delta = Math.max(0, parseInt(minutes || 0, 10));
  if (delta <= 0) throw new Error('minuti non validi');
  if ((w.minutes || 0) < delta) throw new Error('saldo insufficiente');
  w.minutes -= delta;
  w.history = w.history || [];
  w.history.unshift({ ts: now(), delta: -delta, reason: reason || 'redeem', meta });
  await save(w);
  return w;
}

module.exports = { getWallet: load, creditMinutes, redeemMinutes };
