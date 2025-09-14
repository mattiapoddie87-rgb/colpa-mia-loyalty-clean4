// _wallet-lib.js — storage minuti per email, idempotente

function now() { return Math.floor(Date.now() / 1000); }
const keyEmail = (e) => `u:${String(e || '').trim().toLowerCase()}`;
const keyTx    = (id) => `tx:${String(id || '').trim()}`;

async function getStore() {
  // Dentro Netlify Functions: getStore() è auto-configurato.
  const blobs = await import('@netlify/blobs');
  if (typeof blobs.getStore === 'function') return blobs.getStore('wallets');

  // Fallback manuale con token+siteID (per CLI o se Blobs non abilitati sul sito)
  const token  = process.env.NETLIFY_BLOBS_TOKEN;
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  if (!token || !siteID) throw new Error('Blobs non configurati');
  return blobs.createClient({ token, siteID }).getStore('wallets');
}

async function getWallet(email) {
  const store = await getStore();
  const js = await store.get(keyEmail(email));
  if (!js) return { email: String(email || '').toLowerCase(), minutes: 0, history: [], updatedAt: now() };
  try { return JSON.parse(js); }
  catch { return { email: String(email || '').toLowerCase(), minutes: 0, history: [], updatedAt: now() }; }
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
