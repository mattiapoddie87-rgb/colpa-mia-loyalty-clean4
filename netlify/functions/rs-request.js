// netlify/functions/rs-request.js
const { Blobs } = require('@netlify/blobs');
const crypto = require('crypto');
const nodemailer = require('nodemailer'); // o usa la tua utility esistente

const SITE_URL = process.env.SITE_URL || 'https://'+(process.env.URL || '');
const STORE = new Blobs({ siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_TOKEN });

function id() { return crypto.randomBytes(8).toString('hex'); }
function addDays(d){ const m={}; if(d==='24 ore') m.hours=24; else if(d==='3 giorni') m.days=3; else if(d==='7 giorni') m.days=7; return m; }

async function sendMail(to, subject, html){
  if (process.env.RESEND_API_KEY) {
    const fetch = (...a)=>import('node-fetch').then(({default: f})=>f(...a));
    await fetch('https://api.resend.com/emails', {
      method:'POST',
      headers:{'Authorization':`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},
      body: JSON.stringify({ from: process.env.MAIL_FROM, to, subject, html })
    });
    return;
  }
  const t = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: +(process.env.SMTP_PORT||587), secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  await t.sendMail({ from: process.env.MAIL_FROM, to, subject, html });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const { email, context, brief='', expires='', pod='Sì' } = JSON.parse(event.body||'{}');
  if (!email || !context) return { statusCode: 400, body: JSON.stringify({ error:'missing_fields' }) };

  const key = `rs/${id()}.json`;
  const now = new Date();
  let expiresAt = null;
  if (expires) {
    const d = new Date(now);
    const step = addDays(expires);
    if (step.hours) d.setHours(d.getHours()+step.hours);
    if (step.days) d.setDate(d.getDate()+step.days);
    expiresAt = d.toISOString();
  }

  const record = {
    id: key.split('/').pop().replace('.json',''),
    email, context, brief, pod, createdAt: now.toISOString(), expiresAt, status: 'NEW'
  };

  await STORE.set(key, JSON.stringify(record), { contentType: 'application/json' });

  const link = `${SITE_URL}/.netlify/functions/rs-view?id=${record.id}`;
  // mail al richiedente
  await sendMail(email, 'Il tuo Responsibility Switch', `
    <p>Ciao, ecco il link del tuo Responsibility Switch:</p>
    <p><a href="${link}">${link}</a></p>
    <p>Contesto: <b>${context}</b><br/>Scade: ${expiresAt||'—'}<br/>Prova di consegna: ${pod}</p>
  `);

  return { statusCode: 200, body: JSON.stringify({ link }) };
};
