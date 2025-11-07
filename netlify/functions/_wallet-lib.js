// netlify/functions/_wallet-lib.js
const { getStore } = require('@netlify/blobs');

const SITE_ID = process.env.NETLIFY_SITE_ID;
const BLOBS_TOKEN = process.env.NETLIFY_BLOBS_TOKEN;

function store(name) {
  return getStore({
    name,
    siteId: SITE_ID,
    token: BLOBS_TOKEN,
  });
}

const WALLET_BUCKET = 'wallet';
const TX_BUCKET = 'wallet-tx';

async function getWallet(email) {
  if (!email) throw new Error('wallet: email mancante');
  const s = store(WALLET_BUCKET);
  const data = await s.get(email, { type: 'json' });
  if (!data) {
    return {
      email,
      minutes: 0,
      lastUpdated: new Date().toISOString(),
    };
  }
  return data;
}

async function saveWallet(email, data) {
  const s = store(WALLET_BUCKET);
  await s.set(email, data, { type: 'json' });
  return data;
}

async function alreadyProcessed(txKey) {
  if (!txKey) return false;
  const s = store(TX_BUCKET);
  const data = await s.get(txKey, { type: 'text' });
  return !!data;
}

async function markProcessed(txKey) {
  if (!txKey) return;
  const s = store(TX_BUCKET);
  await s.set(txKey, 'ok', { type: 'text' });
}

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
  if (txKey) await markProcessed(txKey);
  return wallet;
}

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
