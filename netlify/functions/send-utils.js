// Resend via HTTPS nativo → fallback SMTP. Normalizzazione FROM.
const https = require('https');
const { URL } = require('url');
const nodemailer = require('nodemailer');

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const BCC_ADMIN = (process.env.RESPONSABILITA_MAIL || '').trim();
const FORCE_SMTP = (process.env.FORCE_SMTP || '').toLowerCase() === 'true';

function asArray(v){ if(!v) return undefined; return Array.isArray(v)?v.filter(Boolean):[String(v).trim()].filter(Boolean); }

// normalizza 'from' rimuovendo virgolette, newline e spazi doppi; valida formato
function normalizeFrom(v){
  let s = String(v||'').replace(/[\u2018\u2019\u201C\u201D]/g,'"'); // smart quotes -> "
  s = s.replace(/^\s*["']|["']\s*$/g,''); // togli virgolette esterne
  s = s.replace(/[\r\n]+/g,' ').replace(/\s{2,}/g,' ').trim();   // no newline, no doppi spazi
  // match "Name <email>" o "email"
  const m1 = s.match(/^([^<>]+)<\s*([^<>@\s]+@[^<>@\s]+)\s*>$/);
  const m2 = s.match(/^([^<>@\s]+@[^<>@\s]+)$/);
  if (m1) return `${m1[1].trim()} <${m1[2].trim()}>`;
  if (m2) return m2[1].trim();
  throw new Error('MAIL_FROM non valido dopo normalizzazione');
}

function httpsJson(method, url, headers, bodyObj){
  const u = new URL(url);
  const payload = bodyObj ? Buffer.from(JSON.stringify(bodyObj)) : Buffer.alloc(0);
  const opts = { method, hostname:u.hostname, port:443, path:u.pathname+(u.search||''), headers:{
    Accept:'application/json','Content-Type':'application/json','Content-Length':payload.length,...headers}, timeout:15000 };
  return new Promise((resolve,reject)=>{
    const req = https.request(opts,(res)=>{ let data=''; res.on('data',c=>data+=c);
      res.on('end',()=>{ if(res.statusCode<200||res.statusCode>=300) return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        try{ resolve(data?JSON.parse(data):{});}catch{ resolve({}); } });});
    req.on('error',reject); req.on('timeout',()=>req.destroy(new Error('HTTP timeout')));
    if(payload.length) req.write(payload); req.end();
  });
}

async function sendWithResend({ from, to, subject, html, text, replyTo }){
  if (FORCE_SMTP) throw new Error('Forzato SMTP');
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY mancante');
  const fromClean = normalizeFrom(from);

  const body = {
    from: fromClean,
    to: asArray(to),
    subject, html, text,
    reply_to: asArray(replyTo) || undefined,
    bcc: asArray(BCC_ADMIN) || undefined,
  };

  const res = await httpsJson('POST','https://api.resend.com/emails',
    { Authorization:`Bearer ${RESEND_API_KEY}` }, body);
  console.log('Resend OK', { id: res.id, to: body.to });
  return res;
}

async function sendWithSMTP({ from, to, subject, html, text, replyTo }){
  const fromClean = normalizeFrom(from);
  const host = process.env.SMTP_HOST; if(!host) throw new Error('SMTP_HOST mancante');
  const port = parseInt(process.env.SMTP_PORT || '587',10);
  const secure = (process.env.SMTP_SECURE||'').toLowerCase()==='true' || port===465;
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;

  const transporter = nodemailer.createTransport({ host, port, secure, auth: user&&pass?{user,pass}:undefined });
  const mail = { from: fromClean, to: asArray(to), subject, html, text, replyTo: asArray(replyTo), bcc: asArray(BCC_ADMIN) };
  const info = await transporter.sendMail(mail);
  console.log('SMTP OK', { to: mail.to, messageId: info.messageId });
  return info;
}

async function sendMail(opts){
  try { return await sendWithResend(opts); }
  catch(e){ console.warn('Resend fallito:', e.message); if(!process.env.SMTP_HOST) throw e; }
  return sendWithSMTP(opts);
}

module.exports = { sendMail };
    
