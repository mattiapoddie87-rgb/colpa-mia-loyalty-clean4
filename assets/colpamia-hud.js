/* ============ COLPAMIA HUD THEME BOOTSTRAP ============ */
/* Nessuna dipendenza; inserisce il tema + bottone “Torna al catalogo”.   */
/* Usa percorsi RELATIVI per compatibilità con GitHub Pages.              */

(() => {
  // >>>>> IMPOSTA QUI l’URL del CATALOGO (relativo, niente slash iniziale)
  const CATALOG_URL = "index.html"; // es. "./", "index.html", "catalogo.html", "shop/"

  // Evita doppie iniezioni
  if (window.__hudInjected) return;
  window.__hudInjected = true;

  // Root dietro i contenuti
  const root = document.createElement('div');
  root.className = 'hud-root';

  // Layers (ordine importante)
  const sky   = el('div', 'hud-sky');
  const rings = el('div', 'hud-rings');
  const grid  = el('div', 'hud-grid');
  const stars = el('div', 'hud-stars');
  const noise = el('div', 'hud-noise');

  root.append(sky, rings, grid, stars, noise);
  document.body.prepend(root);

  // UI overlay (bottone back solo su wallet)
  const wantsBack = looksLikeWalletPage();
  if (wantsBack) {
    const ui = el('div', 'hud-ui');
    const back = document.createElement('a');
    back.className = 'hud-back';
    back.href = CATALOG_URL;
    back.innerHTML = iconArrow() + 'Torna al catalogo';
    ui.append(back);
    document.body.append(ui);
  }

  // helpers
  function el(tag, cls){ const n=document.createElement(tag); n.className=cls; return n; }
  function looksLikeWalletPage() {
    const path = (location.pathname || "").toLowerCase();
    if (path.includes('wallet')) return true;
    // ulteriori fallback se la pagina non contiene “wallet” nell’URL
    if (document.getElementById('wallet')) return true;
    if (document.querySelector('[data-page="wallet"]')) return true;
    return false;
  }
  function iconArrow(){
    return `
      <svg viewBox="0 0 24 24" fill="none" stroke="var(--hud-glow)" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 19l-7-7 7-7"></path>
        <path d="M5 12h14"></path>
      </svg>`;
  }
})();
