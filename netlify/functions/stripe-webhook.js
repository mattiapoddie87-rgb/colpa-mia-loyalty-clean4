// Placeholder sicuro: registra l'evento e risponde 200
export async function handler(event) {
  console.log('Webhook payload length:', (event.body||'').length);
  return { statusCode: 200, body: 'ok' };
}
