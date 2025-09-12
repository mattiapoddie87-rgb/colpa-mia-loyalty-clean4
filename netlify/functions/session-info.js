// Utility minime per formattazione
function formatCurrency(amountInMinor, currency = 'eur') {
  try {
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency: currency.toUpperCase() })
      .format((amountInMinor || 0) / 100);
  } catch {
    return `${(amountInMinor || 0) / 100} ${currency.toUpperCase()}`;
  }
}

function safeString(s) {
  return String(s || '').replace(/[<>]/g, '');
}

module.exports = { formatCurrency, safeString };
