// netlify/functions/wa-test.js
const twilioSid   = process.env.TWILIO_ACCOUNT_SID || '';
const twilioToken = process.env.TWILIO_AUTH_TOKEN  || '';
const fromWa      = process.env.TWILIO_FROM_WA     || ''; // es. whatsapp:+14155238886 (sandbox)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const j = (s,b)=>({statusCode:s,headers:{'Content-Type':'application/json',...CORS},body:JSON.stringify(b)});

exports.handler = async (event)=>{
  if(event.httpMethod==='OPTIONS') return j(204,{});
  try{
    if(!twilioSid || !twilioToken || !fromWa)
      return j(400,{ok:false, error:'missing_twilio_env', twilioSid:!!twilioSid, fromWa});

    const toParam = (event.queryStringParameters?.to || '').trim();
    const msgParam= (event.queryStringParameters?.msg || '').trim();
    const to = toParam.startsWith('whatsapp:') ? toParam :
               toParam ? `whatsapp:${toParam}` : null;

    if(!to) return j(400,{ok:false, error:'missing_to', example:'/wa-test?to=+39XXXXXXXXXX&msg=ciao'});

    const client = require('twilio')(twilioSid, twilioToken);
    const res = await client.messages.create({
      from: fromWa,
      to,
      body: msgParam || 'Test COLPA MIA: messaggio WhatsApp sandbox OK.'
    });
    return j(200,{ok:true, sid:res.sid, status:res.status});
  }catch(e){
    return j(500,{ok:false, error:String(e.message||e)});
  }
};
