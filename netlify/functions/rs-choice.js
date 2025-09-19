// netlify/functions/rs-choice.js
const { Blobs } = require('@netlify/blobs');
const nodemailer = require('nodemailer');
const STORE = new Blobs({ siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_TOKEN });

async function send(to, subject, html){
  if (process.env.RESEND_API_KEY) {
    const fetch = (...a)=>import('node-fetch').then(({default:f})=>f(...a));
    await fetch('https://api.resend.com/emails', {
      method:'POST',
      headers:{'Authorization':`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},
      body: JSON.stringify({ from: process.env.MAIL_FROM, to, subject, html })
    });
    return;
  }
  const t = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: +(process.env.SMTP_PORT||587), secure:false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  await t.sendMail({ from: process.env.MAIL_FROM, to, subject, html });
}

exports.handler = async (event)=>{
  if (event.httpMethod !== 'POST') return { statusCode:405, body:'Method Not Allowed' };
  const { id, choice } = JSON.parse(event.body||'{}');
  if(!id || !choice) return { statusCode:400, body: JSON.stringify({ error:'missing_fields' }) };

  const key = `rs/${id}.json`;
  const raw = await STORE.get(key, { type:'json' });
  if(!raw) return { statusCode:404, body: JSON.stringify({ error:'not_found' }) };

  const when = new Date().toISOString();
  raw.choice = { value: choice, at: when };
  raw.status = 'COMPLETED';
  await STORE.set(key, JSON.stringify(raw), { contentType:'application/json' });

  await send(raw.email, 'Nuova scelta sul tuo Responsibility Switch',
    `<p>Il destinatario ha scelto: <b>${choice}</b></p>
     <p>Contesto: <b>${raw.context}</b></p>
     <p>Quando: ${when}</p>`);

  return { statusCode:200, body: JSON.stringify({ ok:true }) };
};
