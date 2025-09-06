// sostituisci l'esistente exports.handler con questo blocco (il resto del file resta uguale)

exports.handler = async (event)=>{
  const sig = event.headers['stripe-signature'];
  let type,obj;
  try{
    const whsec = process.env.STRIPE_WEBHOOK_SECRET;
    const evt = stripe.webhooks.constructEvent(event.body, sig, whsec);
    type = evt.type; obj = evt.data.object;
  }catch(err){ return j(400,{error:'invalid_signature',detail:String(err?.message||err)}); }

  if(type!=='checkout.session.completed') return j(200,{ok:true,ignored:true});

  try{
    const session = await stripe.checkout.sessions.retrieve(obj.id,{ expand:['total_details.breakdown','line_items','line_items.data.price.product'] });

    const email = String(session?.customer_details?.email||'').toLowerCase();
    const phone = String(session?.customer_details?.phone||'').trim();

    // ---- minuti (funziona con promo code)
    const minutes = await minutesFromLineItems(session);

    // ---- contesto dal checkout (custom_fields.need)
    let need='';
    for(const cf of (session?.custom_fields||[])){
      if((cf.key||'').toLowerCase()==='need' && cf?.text?.value){ need = String(cf.text.value||'').trim(); break; }
    }
    // fallback
    if(!need) need = `Genera una scusa credibile. SKU=${session?.client_reference_id||''}`;

    // ---- 3 varianti
    const variants = await getExcuses(need,'generico','neutro',session?.locale||'it-IT'); // array 1..3

    // WhatsApp (1ª variante)
    let waSent=false;
    if(variants[0] && phone){
      const wa = await sendWhatsApp(phone, `COLPA MIA — La tua scusa\n\n${variants[0]}\n\n(+${minutes} min accreditati sul wallet)`);
      waSent = !!wa.ok;
    }

    // Email (tutte e 3)
    let emailSent=false;
    if(email){
      const li = variants.map(v=>`<li>${v}</li>`).join('');
      const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.45">
        <h2>La tua scusa</h2><ul>${li}</ul><p style="color:#666">Accreditati <b>${minutes}</b> minuti sul tuo wallet.</p></div>`;
      const em = await sendEmail(email,'La tua Scusa — COLPA MIA',html);
      emailSent = !!em.ok;
    }

    // PI metadata (se esiste) + email per wallet basato su PI
    if(session.payment_intent){
      try{
        await stripe.paymentIntents.update(session.payment_intent,{
          metadata:{
            minutesCredited:String(minutes),
            excusesCount:String(variants.length||0),
            customerEmail: email || '',
            colpamiaEmailSent: emailSent?'true':'false',
            colpamiaWaStatus: waSent?'sent':'skip'
          }
        });
      }catch{}
    }

    // Accumula anche sul Customer (copre i casi senza PI: promo 100%)
    if(session.customer && minutes>0){
      try{
        const cust = await stripe.customers.retrieve(session.customer);
        const cur  = Number(cust?.metadata?.wallet_minutes||0) || 0;
        await stripe.customers.update(session.customer,{
          metadata:{ wallet_minutes:String(cur+minutes), wallet_last_session:session.id }
        });
      }catch{}
    }

    return j(200,{ok:true,minutes,emailSent,waSent,variants:variants.length});
  }catch(err){
    return j(500,{error:'webhook_error',detail:String(err?.message||err)});
  }
};
