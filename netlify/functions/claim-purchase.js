// netlify/functions/claim-purchase.js
import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

import { blobs } from '@netlify/blobs';
const balances = blobs({ name: 'balances' });
const drafts   = blobs({ name: 'drafts' });

const SITE_URL = process.env.SITE_URL || 'https://colpamia.com';

// --- Email / Phone helpers (usa Resend o il tuo provider):
async function sendEmail(to, subject, html){
  const apiKey = process.env.RESEND_API_KEY;
  const from   = process.env.RESEND_FROM || 'Colpa Mia <noreply@colpamia.com>';
  if(!apiKey) return { ok:false, error:'RESEND non configurato' };

  const r = await fetch('https://api.resend.com/emails', {
    method:'POST',
    headers:{ 'Authorization':`Bearer ${apiKey}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ from, to, subject, html })
  });
  if(!r.ok) return { ok:false, error: await r.text() };
  return { ok:true };
}

// Stub per telefono (da integrare via WhatsApp/SMS provider)
async function sendPhone(phone, text){
  // TODO: integra Twilio / WhatsApp Cloud / SMS provider
  console.log('sendPhone stub ->', phone, text.slice(0,120));
  return { ok:true };
}

// --- Balance store helpers
async function getBalance(email){
  const key = `bal:${email.toLowerCase()}`;
  return (await balances.getJSON(key)) || { email, minutes:0, history:[] };
}
async function setBalance(email, data){
  const key = `bal:${email.toLowerCase()}`;
  await balances.setJSON(key, data, { addRandomSuffix:false });
}

// --- Utility
function escapeHtml(s){return s.replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));}

export default async (req) => {
  try{
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error:'Method Not Allowed' }), { status:405 });
    }
    const { session_id, email: emailIn, phone } = await req.json();
    if(!session_id || !session_id.startsWith('cs_')){
      return new Response(JSON.stringify({ error:'session_id non valido' }), { status:400 });
    }

    // Recupera la sessione e line_items
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['line_items.data.price.product']
    });
    if (session.payment_status !== 'paid'){
      return new Response(JSON.stringify({ error:'La sessione non è pagata' }), { status:400 });
    }

    // Email “vera” dalla sessione (priorità a quella di Stripe)
    const email = (session.customer_details?.email || session.customer_email || emailIn || '').trim();
    if(!email && !phone){
      return new Response(JSON.stringify({ error:'Serve almeno email o telefono per collegare l’acquisto' }), { status:400 });
    }

    // Calcola minuti dai metadata product
    let totalMinutes = 0;
    for(const li of (session.line_items?.data || [])){
      const md  = li.price?.product?.metadata || {};
      const qty = li.quantity || 1;
      const mins = parseInt(md.minutes || '0', 10);
      if(mins>0) totalMinutes += mins * qty;
    }

    // Aggiorna saldo
    if(totalMinutes > 0 && email){
      const bal = await getBalance(email);
      bal.minutes = (bal.minutes||0) + totalMinutes;
      bal.history = bal.history || [];
      bal.history.push({
        ts: Date.now(),
        type: 'add',
        delta: totalMinutes,
        reason: 'Claim post-checkout',
        session_id
      });
      await setBalance(email, bal);
    }

    // Se esiste una bozza AI in attesa, consegnala
    const draftId = session.metadata?.draft_id;
    if(draftId){
      const d = await drafts.getJSON(draftId).catch(()=>null);
      if(d && (d.status==='reserved' || d.status==='queued')){
        const text = d.draft || '';
        if(text){
          let delivered = false;
          if((d.channel==='phone' && (d.phone||phone)) || phone){
            const r = await sendPhone(phone || d.phone, text);
            delivered = r.ok;
          }
          if(!delivered && (d.email || email)){
            const subject = 'La tua scusa è pronta';
            const hr = text.split('\n').map(p=>`<p>${escapeHtml(p)}</p>`).join('');
            const r = await sendEmail((email || d.email), subject, hr);
            delivered = r.ok;
          }
          await drafts.setJSON(draftId, { ...d, status:'sent', sent_at:Date.now(), session_id }, { addRandomSuffix:false });
        }
      }
    }

    return new Response(JSON.stringify({ ok:true, email }), { status:200 });
  }catch(e){
    console.error('claim-purchase error', e);
    return new Response(JSON.stringify({ error:'Errore interno' }), { status:500 });
  }
};

export const config = { path: '/.netlify/functions/claim-purchase' };
