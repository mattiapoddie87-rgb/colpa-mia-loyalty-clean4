const byId = (id)=>document.getElementById(id);
const form = byId('ai-form');
const msg  = byId('msg');

const SKUS = {
  SCUSA_BASE: {
    label:'Scusa Base',
    dest:['capo','collega','partner','amico','cliente'],
    fields:[
      {name:'ritardo', label:'Ritardo/differimento (minuti)', type:'number', min:1, max:180, required:true},
      {name:'motivo',  label:'Motivo leggero', placeholder:'es. consegna corriere / coda ascensore', required:true},
    ],
  },
  SCUSA_TRIPLA:{
    label:'Scusa Tripla',
    dest:['capo','collega','partner','amico'],
    fields:[
      {name:'scenario',label:'Scenario comune', placeholder:'es. imprevisto logistico al mattino', required:true},
    ],
  },
  SCUSA_DELUXE:{
    label:'Scusa Deluxe',
    dest:['capo','hr','cliente'],
    fields:[
      {name:'contesto',label:'Contesto formale', placeholder:'es. verifica documentale non risolta', required:true},
    ],
  },
  RIUNIONE:{
    label:'Riunione improvvisa',
    dest:['team','cliente','capo'],
    fields:[
      {name:'titolo', label:'Titolo riunione', required:true},
      {name:'ora',    label:'Ora prevista', placeholder:'es. 11:30', required:true},
    ],
  },
  TRAFFICO:{
    label:'Traffico assurdo',
    dest:['capo','collega','partner','amico'],
    fields:[
      {name:'minuti',  label:'Ritardo stimato (min)', type:'number', min:1, max:180, required:true},
      {name:'strada',  label:'Strada/linea', placeholder:'es. A4 / M1', required:true},
      {name:'evento',  label:'Evento', placeholder:'incidente / lavori / coda a fisarmonica', required:true},
    ],
  },
  CONN_KO:{
    label:'Connessione KO',
    dest:['capo','collega','cliente'],
    fields:[
      {name:'diagnosi', label:'Problema (VPN/ISP)', placeholder:'es. PPPoE down – ticket aperto', required:true},
      {name:'temp',     label:'Ripristino previsto (min)', type:'number', min:5, max:240, required:true},
    ],
  },
};

function showErr(t){ msg.hidden=false; msg.classList.add('error'); msg.textContent=t; }
function showOk(t){ msg.hidden=false; msg.classList.remove('error'); msg.textContent=t; }

window.addEventListener('DOMContentLoaded', ()=>{
  const sku = new URLSearchParams(location.search).get('sku') || 'SCUSA_BASE';
  byId('sku').value = sku;
  const conf = SKUS[sku] || SKUS.SCUSA_BASE;

  const destSel = byId('dest');
  destSel.innerHTML = conf.dest.map(d=>`<option value="${d}">${d}</option>`).join('');

  const dyn = byId('dyn-fields');
  dyn.innerHTML = conf.fields.map(f=>{
    const attrs = [
      f.type?`type="${f.type}"`:'type="text"',
      f.placeholder?`placeholder="${f.placeholder}"`:'',
      f.min?`min="${f.min}"`:'', f.max?`max="${f.max}"`:'',
      f.required?'required':''
    ].join(' ');
    return `<label>${f.label}</label><input ${attrs} name="${f.name}" />`;
  }).join('');
});

form.addEventListener('submit', async (e)=>{
  e.preventDefault();
  msg.hidden = true;

  const fd = new FormData(form);
  const payload = Object.fromEntries(fd.entries());

  // canale default = telefono (WhatsApp/SMS); email di backup se presente
  let channel = 'phone';
  if(!payload.phone && payload.email) channel = 'email';

  try{
    showOk('Creo il draft in modo riservato…');
    const r = await fetch('/.netlify/functions/ai-reserve',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        sku: payload.sku,
        tone: payload.tone,
        dest: payload.dest,
        channel,
        phone: payload.phone || null,
        email: payload.email || null,
        fields: Object.fromEntries(Object.entries(payload).filter(([k])=>!['sku','tone','dest','phone','email'].includes(k))),
      })
    });
    const data = await r.json();
    if(!r.ok) throw new Error(data.error || 'Errore generazione');

    // draft pronto lato server (non visibile). Ora apriamo il checkout con
    // metadata non invasive (retro-compatibili).
    const cr = await fetch('/.netlify/functions/create-checkout-session',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        sku: payload.sku,
        draft_id: data.draft_id,
        tone: payload.tone,
        dest: payload.dest,
        channel,
        phone: payload.phone || null,
        email: payload.email || null
      })
    });

    // comportamento identico al tuo: 303 Location oppure JSON{url}
    if(cr.status===303){
      const loc = cr.headers.get('Location'); if(loc) return location.href=loc;
    }
    const cd = await cr.json().catch(()=>({}));
    if(cd?.url) return location.href = cd.url;

    throw new Error(cd?.error || 'Errore checkout');
  }catch(err){
    showErr(err.message);
    console.error(err);
  }
});
