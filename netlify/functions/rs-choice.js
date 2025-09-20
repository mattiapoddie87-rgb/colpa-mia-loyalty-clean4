// netlify/functions/rs-choice.js
import { getStore } from '@netlify/blobs';

const CALENDLY_URL   = process.env.CALENDLY_URL || '';           // es. https://calendly.com/colpamia/15min
const WHATSAPP_NUM   = process.env.WHATSAPP_NUMBER || '';         // es. 393331234567 (senza +)
const SUPPORT_EMAIL  = process.env.SUPPORT_EMAIL || 'colpamiaconsulenze@proton.me';
const VOUCHER_PAGE   = process.env.VOUCHER_PAGE || '/voucher.html';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { token, choice } = JSON.parse(event.body || '{}');
    if (!token || !choice) {
      return { statusCode: 400, body: 'missing_params' };
    }

    // Salva la scelta (idempotente semplice)
    const store = getStore({ name: 'rs-choices' });
    const key = `choice:${token}:${Date.now()}`;
    await store.set(key, JSON.stringify({
      token, choice, ts: new Date().toISOString(),
      ua: event.headers['user-agent'] || '',
      ip: event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'] || ''
    }), { metadata: { token, choice } });

    // Prepara azione successiva
    let nextAction = null;

    if (choice === 'reprogram') {
      if (CALENDLY_URL) {
        nextAction = { type: 'redirect', url: CALENDLY_URL };
      } else {
        // fallback: email precompilata
        const subject = encodeURIComponent('Riprogrammazione appuntamento');
        const body = encodeURIComponent(`Ciao, vorrei riprogrammare. Token RS: ${token}\n\nGrazie!`);
        nextAction = { type: 'open', url: `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}` };
      }
    }

    if (choice === 'callme') {
      // WhatsApp se disponibile, altrimenti email
      if (WHATSAPP_NUM) {
        const msg = encodeURIComponent(`Ciao, puoi richiamarmi? Token RS: ${token}`);
        nextAction = { type: 'redirect', url: `https://wa.me/${WHATSAPP_NUM}?text=${msg}` };
      } else {
        const subject = encodeURIComponent('Richiamami');
        const body = encodeURIComponent(`Ciao, puoi richiamarmi? Token RS: ${token}`);
        nextAction = { type: 'open', url: `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}` };
      }
    }

    if (choice === 'voucher') {
      // passa il token alla pagina voucher
      nextAction = { type: 'redirect', url: `${VOUCHER_PAGE}?token=${encodeURIComponent(token)}` };
    }

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ ok: true, next_action: nextAction })
    };
  } catch (e) {
    console.error('rs-choice error:', e);
    return { statusCode: 500, body: 'server_error' };
  }
};
