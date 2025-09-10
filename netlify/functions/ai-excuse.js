// netlify/functions/ai-excuse.js
const CORS = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'POST,OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type'
};
const j=(s,b)=>({statusCode:s,headers:{'Content-Type':'application/json',...CORS},body:JSON.stringify(b)});
const cap=(s,max)=>String(s||'').slice(0, Math.max(120, Math.min(2000, max||600)));

function pickN(arr,n){
  const a=[...arr]; const out=[];
  while(a.length&&out.length<n){ out.push(a.splice(Math.floor(Math.random()*a.length),1)[0]); }
  while(out.length<n) out.push(arr[out.length%arr.length]);
  return out.slice(0,n);
}

// --- BANCHE TESTI ---
// Scenari fissi (3 varianti)
const FIXED = {
  riunione: [
    'Ciao, mi è subentrata una riunione proprio ora. Appena chiudo ti aggiorno con orari aggiornati.',
    'Ciao, call imprevista che sta sforando: finisco e ti do orari aggiornati.',
    'Ciao, sono in un punto urgente di riunione; appena libero ti confermo un orario credibile.'
  ],
  traffico: [
    'Ciao, c’è stato un incidente e i tempi si sono allungati. Ti aggiorno appena ho una tempistica chiara.',
    'Ciao, traffico anomalo sul percorso: sto recuperando e ti do una tempistica appena si sblocca.',
    'Ciao, coda a fisarmonica in tangenziale; arrivo ma vado lento. Ti scrivo a breve con una tempistica.'
  ],
  connessione: [
    'Ciao, la connessione è KO e sto passando al tethering. Ti aggiorno non appena ho una tempistica affidabile.',
    'Ciao, VPN/linea giù proprio ora: ripristino e ti do una tempistica appena aggancio.',
    'Ciao, rete instabile: sistemo e torno con orari aggiornati.'
  ]
};

// Contesti (tuoi modelli). Base = 1, Deluxe = 3 da queste liste.
const CTX = {
  CENA: [
    'Ciao, grazie mille per l’invito, mi fa piacere che tu abbia pensato a me. Sfortunatamente ho già un impegno per quella sera e non potrò unirmi.',
    'Ciao, mi dispiace ma ho un imprevisto e stasera non riesco proprio a venire.',
    'Ciao, non sono in vena di uscire: ho bisogno di una serata tranquilla a casa.',
    'Ciao, ho già mangiato / sono a dieta e stasera non ho molta fame.',
    'Ciao, non so se riesco a venire: ti faccio sapere più tardi.',
    'Ciao, spero vi divertiate; organizziamo presto per vederci.'
  ],
  APERITIVO: [
    'Ciao, mi spiace moltissimo ma non riesco a venire: ho un altro impegno inderogabile.',
    'Ciao, ho già un impegno per quella sera e non mi sarà possibile partecipare. Spero nella prossima.',
    'Ciao, avrei voluto esserci ma ho un imprevisto familiare che richiede la mia attenzione.',
    'Ciao, urgenza lavorativa improvvisa che mi blocca; cerco di rifarmi presto.'
  ],
  EVENTO: [
    'Ciao, grazie per l’invito all’evento. Purtroppo non potrò esserci per un impegno precedente e inderogabile.',
    'Ciao, mi dispiace non poter partecipare: mi sarebbe piaciuto essere presente. Spero in un’altra occasione.',
    'Ciao, non riuscirò a esserci: ti auguro un evento riuscito e grazie per la comprensione.'
  ],
  LAVORO: [
    // Scusa per errore
    'Ciao, ti chiedo scusa per il disguido su [tema]. Mi assumo la responsabilità: ho già avviato le correzioni e condivido gli orari aggiornati a breve.',
    // Assenza per indisposizione
    'Ciao, oggi non riesco a presentarmi per un’improvvisa indisposizione. Mi scuso per il disagio e invierò certificazione appena possibile.'
  ],
  CALCETTO: [
    'Ciao, non posso partecipare questa volta: ho già un altro impegno.',
    'Ciao, mi sono svegliato con mal di testa; meglio riposare oggi.',
    'Ciao, imprevisto lavoro/studio e non riesco a liberarmi.',
    'Ciao, ho un appuntamento importante che non posso spostare.',
    'Ciao, oggi sono stanco e non renderei al meglio.',
    'Ciao, ho un piccolo infortunio e preferisco non rischiare.'
  ],
  FAMIGLIA: [
    'Ciao, devo disdire l’appuntamento: è subentrato un imprevisto familiare urgente. Riprogrammiamo appena possibile.',
    'Ciao, ho un impegno familiare che non posso rimandare e non potrò esserci. Spero vi divertiate.',
    'Ciao, mi hanno appena chiamato: devo correre in pronto soccorso per un parente. Ti aggiorno più tardi.'
  ],
  SALUTE: [
    'Ciao, mi sono svegliato con mal di gola e tosse. Evito di contagiare: oggi non riesco a venire.',
    'Ciao, allergia forte oggi e sintomi fuori controllo: devo fermarmi un giorno.',
    'Ciao, si è liberato un appuntamento medico urgente: devo assentarmi.'
  ],
  APP_CONS: [
    'Ciao, devo annullare l’appuntamento di [data/ora] per una sovrapposizione imprevista. Possiamo riprogrammare?',
    'Ciao, non riesco a rispettare l’appuntamento per un imprevisto. Scusa il disagio, troviamo un’altra data?',
    'Ciao, è cambiata la mia agenda e non potrò partecipare all’appuntamento previsto. Possiamo rimandare?'
  ],
  ESAME: [
    'Ciao, mi dispiace per il ritardo: sono rimasto bloccato nel traffico per un incidente.',
    'Ciao, mi dispiace per il ritardo: sono rimasta bloccata nel traffico per un incidente.'
  ]
};

exports.handler=async(event)=>{
  if(event.httpMethod==='OPTIONS') return j(204,{});
  if(event.httpMethod!=='POST') return j(405,{error:'method_not_allowed'});

  let body={}; try{body=JSON.parse(event.body||'{}');}catch{return j(400,{error:'bad_json'});}

  const kind = String(body.kind||'base').toLowerCase();            // base | deluxe | riunione | traffico | connessione
  const tag  = String(body.contextTag||'').toUpperCase().trim();   // es. CENA, APERITIVO...
  const need = String(body.need||'');
  const max  = Number(body.maxLen|| (kind==='deluxe'?600:480));

  // Scenari fissi → 3 varianti
  if(['riunione','traffico','connessione'].includes(kind)){
    const arr = FIXED[kind]||[];
    return j(200,{variants: pickN(arr,3).map(s=>({whatsapp_text: cap(s,max)}))});
  }

  // Base/Deluxe con contesto
  if(tag && CTX[tag]){
    if(kind==='base'){
      const one = pickN(CTX[tag],1)[0];
      return j(200,{variants:[{whatsapp_text: cap(one,max)}]});
    }
    // deluxe → 3
    const three = pickN(CTX[tag],3);
    return j(200,{variants: three.map(s=>({whatsapp_text: cap(s,max)}))});
  }

  // Fallback se tag mancante: frasi neutrali coerenti
  const FALLBACK = (kind==='deluxe'
    ? ['Ciao, ho avuto un imprevisto serio: sistemo le priorità e ti aggiorno con orari aggiornati.',
       'Ciao, sto chiudendo un’urgenza: preferisco darti un orario credibile tra poco.',
       'Ciao, sto riorganizzando l’agenda per ridurre l’attesa: ti scrivo con una tempistica affidabile.']
    : ['Ciao, ho un imprevisto reale: mi riorganizzo e ti aggiorno a breve con orari aggiornati.']);
  const out = (kind==='deluxe')?pickN(FALLBACK,3):pickN(FALLBACK,1);
  return j(200,{variants: out.map(s=>({whatsapp_text: cap(s,max)}))});
};
