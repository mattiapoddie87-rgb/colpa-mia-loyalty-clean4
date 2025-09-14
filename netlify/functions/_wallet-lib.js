// Storage portabile per "wallet minuti" per email
async function getStore() {
  try {
    const token = process.env.NETLIFY_BLOBS_TOKEN;
    const siteID = process.env.NETLIFY_SITE_ID;
    const { createClient } = await import('@netlify/blobs');
    return createClient({ token, siteID }).getStore('wallets');
  } catch (e) {
    throw new Error('Blobs non disponibili');
  }
}
const now = () => Math.floor(Date.now() / 1000);
const keyEmail = (e) => `u:${String(e || '').trim().toLowerCase()}`;
const keyTx = (id) => `tx:${String(id || '').trim()}`;

async function getWallet(email) {
  const store = await getStore();
  const k = keyEmail(email);
  const js = await store.get(k);
  if (!js) return { email: String(email).trim().toLowerCase(), minutes: 0, history: [], updatedAt: now() };
  try { return JSON.parse(js); } catch { return { email, minutes: 0, history: [], updatedAt: now() }; }
}

async function saveWallet(w) {
  const store = await getStore();
  const k = keyEmail(w.email);
  w.updatedAt = now();
  await store.set(k, JSON.stringify(w));
  return w;
}

// idempotente: se esiste txKey non riaccredita
async function creditMinutes({ email, minutes, reason, meta = {}, txKey }) {
  if (!email) throw new Error('email mancante');
  const store = await getStore();
  if (txKey) {
    const seen = await store.get(keyTx(txKey));
    if (seen) return await getWallet(email);
  }
  const w = await getWallet(email);
  const delta = Math.max(0, parseInt(minutes || 0, 10));
  if (delta <= 0) return w;
  w.minutes = (w.minutes || 0) + delta;
  w.history = w.history || [];
  w.history.unshift({ ts: now(), delta, reason, meta });
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
  w.history.unshift({ ts: now(), delta: -delta, reason, meta });
  await saveWallet(w);
  return w;
}

module.exports = { getWallet, creditMinutes, redeemMinutes };
