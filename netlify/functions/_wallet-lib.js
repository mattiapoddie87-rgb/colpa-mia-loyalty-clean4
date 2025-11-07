// netlify/functions/_wallet-lib.js
const { getStore } = require('@netlify/blobs');

const WALLET_BUCKET = 'wallet';
const TX_BUCKET = 'wallet-tx';

async function getWallet(email) {
  if (!email) throw new Error('wallet: email mancante');
  const store = getStore({ name: WALLET_BUCKET });
  const data = await store.get(email, { type: 'json' });
  if (!data) {
    return { email, minutes: 0, lastUpdated: new Date().toISOString() };
  }
  return data;
}

async function saveWallet(email, data) {
  const store = getStore({ name: WALLET_BUCKET });
  await store.set(email, data, { type: 'json' });
  return data;
}

// evita doppi accrediti (stesso evento stripe)
async function alreadyProcessed(txKey) {
  if (!txKey) return false;
  const store = getStore({ name: TX_BUCKET });
  const data = await store.get(txKey, { type: 'text' });
  return !!data;
}

async function markProcessed(txKey) {
  if (!txKey) return;
  const store = getStore({ name: TX_BUCKET });
  await store.set(txKey, 'ok', { type: 'text' });
}

// accredita minuti fissi (da SKU)
async function creditMinutes(email, minutes, reason = '', meta = {}, txKey = '') {
  if (!email) throw new Error('wallet: email mancante');
  if (!minutes || minutes <= 0) return;

  if (txKey && await alreadyProcessed(txKey)) {
    return;
  }

  const wallet = await getWallet(email);
  wallet.minutes = (wallet.minutes || 0) + minutes;
  wallet.lastUpdated = new Date().toISOString();
  wallet.lastReason = reason;
  wallet.lastMeta = meta;

  await saveWallet(email, wallet);
  if (txKey) {
    await markProcessed(txKey);
  }
  return wallet;
}

// accredito dinamico: passi start e end e lui calcola
async function creditFromDuration(email, startIso, endIso, reason = '', meta = {}, txKey = '') {
  if (!startIso || !endIso) return;
  const start = new Date(startIso);
  const end = new Date(endIso);
  const diffMs = end - start;
  if (diffMs <= 0) return;
  const minutes = Math.floor(diffMs / 60000);
  return creditMinutes(email, minutes, reason, { ...meta, durationMinutes: minutes }, txKey);
}

module.exports = {
  getWallet,
  creditMinutes,
  creditFromDuration,
};
