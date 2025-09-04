// public/responsabilita.js
const RESPONSABILITA = [
  {
    id: 'RESP_AZIENDE',
    title: 'Responsabile Azienda',
    desc: 'Audit di 2–3 giorni, report dettagliato e piano di recupero credibilità.',
    price: 2000,
  },
  {
    id: 'RESP_INFLUENCER',
    title: 'Responsabile Influencer',
    desc: 'Gestione della reputazione e delle scuse per influencer e professionisti della comunicazione.',
    price: 1500,
  },
  {
    id: 'RESP_CRISI',
    title: 'Responsabile Crisi H24',
    desc: 'Intervento immediato 24/7 per situazioni di crisi reputazionale.',
    price: 10000,
  },
];

(function renderResponsabilita() {
  const grid = document.getElementById('responsabilita-grid');
  if (!grid) return;
  RESPONSABILITA.forEach(pkg => {
    const el = document.createElement('article');
    el.className = 'card';
    el.innerHTML = `
      <h3>${pkg.title}</h3>
      <p>${pkg.desc}</p>
      <div class="price">a partire da € ${pkg.price.toFixed(0)}</div>
      <button class="btn" data-id="${pkg.id}">Richiedi preventivo</button>
    `;
    grid.appendChild(el);
  });

  grid.addEventListener('click', ev => {
    const btn = ev.target.closest('button.btn');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const pkg = RESPONSABILITA.find(p => p.id === id);
    if (!pkg) return;
    const subject = encodeURIComponent('Richiesta responsabile: ' + pkg.title);
    const body =
      encodeURIComponent(
        'Salve, sono interessato al pacchetto "' +
          pkg.title +
          '".\nVorrei essere contattato per maggiori informazioni.'
      );
    // manda mail al tuo indirizzo commerciale
    window.location.href =
      'mailto:info@colpamia.com?subject=' + subject + '&body=' + body;
  });
})();
