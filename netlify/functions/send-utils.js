// send-utils.js (ESM)
export async function sendEmail(to, subject, html){
  if(!process.env.RESEND_API_KEY) return {ok:false, error:'RESEND missing'};
  const r = await fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{'Authorization':`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},
    body: JSON.stringify({
      from: process.env.RESEND_FROM,
      to:[to], subject, html
    })
  });
  const j = await r.json().catch(()=> ({}));
  return {ok:r.ok, data:j, error:j?.error?.message};
}

export async function sendPhone(to, body){
  // WhatsApp preferito
  if(process.env.TWILIO_FROM_WA){
    return twilioSend(to.startsWith('whatsapp:')?to:`whatsapp:${to}`, process.env.TWILIO_FROM_WA, body);
  }
  // SMS altrimenti
  if(process.env.TWILIO_FROM_SMS){
    return twilioSend(to, process.env.TWILIO_FROM_SMS, body);
  }
  return {ok:false, error:'No phone sender configured'};
}

async function twilioSend(to, from, body){
  if(!process.env.TWILIO_SID || !process.env.TWILIO_TOKEN) return {ok:false, error:'TWILIO missing'};
  const url = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_SID}/Messages.json`;
  const r = await fetch(url,{
    method:'POST',
    headers:{'Authorization':'Basic '+ btoa(`${process.env.TWILIO_SID}:${process.env.TWILIO_TOKEN}`),
             'Content-Type':'application/x-www-form-urlencoded'},
    body: new URLSearchParams({To:to, From:from, Body:body})
  });
  const j = await r.json().catch(()=> ({}));
  return {ok:r.ok, data:j, error:j?.message};
}
