// netlify/functions/send-utils.js
// CommonJS – REST puro (niente SDK Twilio/Resend per build più veloce)
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM    = process.env.RESEND_FROM || 'Colpa Mia <noreply@example.com>';
const TWILIO_SID     = process.env.TWILIO_SID;
const TWILIO_TOKEN   = process.env.TWILIO_TOKEN;
const TWILIO_FROM_WA = process.env.TWILIO_FROM_WA; // es. whatsapp:+1...
const TWILIO_FROM_SMS= process.env.TWILIO_FROM_SMS; // es. +1...

async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY || !to) return { ok:false, error:'RESEND not configured or missing to' };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, html })
  });
  const j = await res.json().catch(()=> ({}));
  return { ok: res.ok, data: j, error: j?.error?.message };
}

async function twilioSend(to, from, body) {
  if (!TWILIO_SID || !TWILIO_TOKEN) return { ok:false, error:'TWILIO not configured' };
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ To: to, From: from, Body: body })
  });
  const j = await r.json().catch(()=> ({}));
  return { ok: r.ok, data: j, error: j?.message || j?.error };
}

async function sendPhone(toRaw, body) {
  if (TWILIO_FROM_WA) {
    const to = toRaw.startsWith('whatsapp:') ? toRaw : `whatsapp:${toRaw}`;
    return twilioSend(to, TWILIO_FROM_WA, body);
  }
  if (TWILIO_FROM_SMS) {
    return twilioSend(toRaw, TWILIO_FROM_SMS, body);
  }
  return { ok:false, error:'No TWILIO sender configured' };
}

module.exports = { sendEmail, sendPhone };

