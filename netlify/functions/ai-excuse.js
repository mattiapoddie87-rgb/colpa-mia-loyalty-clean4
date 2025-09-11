// netlify/functions/ai-excuse.js
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const reply = (s,b)=>({ statusCode:s, headers:{ 'Content-Type':'application/json', ...CORS }, body:JSON.stringify(b) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(204,{});
  try{
    const { sku = '', need = '' } = JSON.parse(event.body || '{}');

    // normalizza contesto dalla stringa utente
    const norm = (s='')=>{
      const t = s.toLowerCase();
      if (/aper|spritz|drink/.test(t)) return 'APERITIVO';
      if (/cena|ristor/.test(t)) return 'CENA';
      if (/evento|party|festa|concerto/.test(t)) return 'EVENTO';
      if (/lavor|ufficio|meeting|report/.test(t)) return 'LAVORO';
      if (/calcett|partita|calcetto/.test(t)) return 'CALCETTO';
      if (/famigl|figli|marit|mogli|genit|madre|padre|nonna|nonno/.test(t)) return 'FAMIGLIA';
      if (/salute|febbre|medic|dott|tosse|allerg/.test(t)) return 'SALUTE';
      if (/appunt|conseg/.test(t)) return 'APPUNTAMENTO';
      if (/esame|lezion|prof/.test(t)) return 'ESAME';
      return '';
    };
    const ctx = norm(need);

    // modelli per contesto (tono naturale)
    const MODELLI = {
      CENA: [
        'Ciao, grazie mille per l’invito: mi fa davvero piacere. Purtroppo quella sera ho già un impegno e non riesco a unirmi.',
        'Ciao, mi dispiace ma mi è capitato un imprevisto e stasera non riesco proprio a venire.',
        'Ciao, onestamente non me la sento di uscire: ho bisogno di una serata tranquilla a casa. Spero capirai.',
        'Ciao, ho già mangiato e sto seguendo la dieta: stasera passo, ma organizziamo presto.',
        'Ciao, non so se riesco a venire: ti aggiorno più tardi se ce la faccio.',
        'Ciao, spero vi divertiate un sacco! Organizziamoci presto per vederci.'
      ],
      APERITIVO: [
        'Ciao, mi spiace tantissimo ma non riesco a venire: ho un altro impegno inderogabile.',
        'Ciao, avevo piacere di esserci, ma è saltato fuori un imprevisto familiare e devo occuparmene.',
        'Ciao, è appena uscita un’urgenza al lavoro e non riesco a partecipare. Recuperiamo presto!'
      ],
      EVENTO: [
        'Ciao, grazie davvero per l’invito. Purtroppo per quella data ho già un impegno e non potrò esserci.',
        'Ciao, mi sarebbe piaciuto molto partecipare ma non riesco a essere presente. Spero in un’altra occasione!',
        'Ciao, non riesco a venire ma ti auguro un evento bellissimo e ti ringrazio per la comprensione.'
      ],
      LAVORO: [
        'Gentile, ti scrivo per scusarmi dell’inconveniente: mi assumo la responsabilità e ho già messo in atto le correzioni. Ti tengo aggiornato con orari aggiornati.',
        'Oggetto: Assenza per indisposizione — ti avviso che oggi non riesco a presentarmi per un malessere improvviso. Mi scuso per il disagio e invierò certificazione appena possibile.'
      ],
      CALCETTO: [
        'Ciao, questa volta passo: ho già un altro impegno fissato.',
        'Ciao, mi sono svegliato con un bel mal di testa: meglio riposare oggi.',
        'Ciao, ho avuto un imprevisto al lavoro/studio e non riesco a liberarmi.',
        'Ciao, sono parecchio stanco e non renderei: meglio non venire oggi.',
        'Ciao, ho un piccolo infortunio e preferisco non rischiare.'
      ],
      FAMIGLIA: [
        'Ciao, mi dispiace ma devo disdire: è subentrato un imprevisto familiare urgente.',
        'Ciao, ho un impegno in famiglia che non posso rimandare e non potrò esserci. Divertitevi!',
        'Ciao, mi scuso per il breve preavviso: devo accompagnare un familiare a una visita. Recuperiamo presto.'
      ],
      SALUTE: [
        'Ciao, mi sono svegliato con febbre e mal di gola: meglio non rischiare di contagiare nessuno.',
        'Ciao, ho un attacco d’allergia forte e oggi devo fermarmi. Appena sto meglio recupero.',
        'Ciao, hanno anticipato una visita medica e devo andarci oggi pomeriggio.'
      ],
      APPUNTAMENTO: [
        'Ciao, mi dispiace ma devo annullare l’appuntamento di [data/ora] per un imprevisto. Possiamo riprogrammare?',
        'C’è stata una sovrapposizione di impegni e non riesco a rispettare l’orario: ti va di fissare un’alternativa?',
        'Purtroppo è subentrata una situazione urgente: posso proporre un’altra data che vada bene a entrambi?'
      ],
      ESAME: [
        'Ciao, mi dispiace per il ritardo: sono rimasto bloccato nel traffico per un incidente e non sono riuscito ad arrivare prima.',
        'Ciao, mi dispiace per il ritardo: sono rimasta bloccata nel traffico per un incidente e non sono riuscita ad arrivare prima.'
      ]
    };

    const isDeluxe = String(sku).toUpperCase() === 'SCUSA_DELUXE';
    const pool = MODELLI[ctx] || [
      'Ciao, ho un imprevisto reale: mi riorganizzo e ti aggiorno a breve con orari aggiornati.'
    ];

    const pick = (arr, n)=>arr.slice(0, Math.max(1, Math.min(n, arr.length)));
    const selected = isDeluxe ? pick(pool, 3) : pick(pool, 1);

    return reply(200, {
      variants: selected.map(t => ({ text: t, whatsapp_text: t }))
    });
  }catch(e){
    return reply(500,{ error:'ai_excuse_error', detail:String(e.message||e) });
  }
};
