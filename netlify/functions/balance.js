// netlify/functions/balance.js
const { getWallet } = require('./_wallet-lib');

exports.handler = async (event) => {
  // permetti sia GET che POST
  const method = event.httpMethod;

  // prendi l'email
  let email = '';
  if (method === 'GET') {
    email = event.queryStringParameters?.email;
  } else if (method === 'POST') {
    try {
      const body = JSON.parse(event.body || '{}');
      email = body.email;
    } catch (_) {
      // ignore
    }
  } else {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'method_not_allowed' }),
    };
  }

  if (!email) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'email_missing' }),
    };
  }

  try {
    const wallet = await getWallet(email);
    // il tuo frontend si aspetta: minuti, punti, tier
    const response = {
      minutes: wallet.minutes || 0,
      points: wallet.points || 0,
      tier: wallet.tier || 'None',
      lastUpdated: wallet.lastUpdated || null,
      lastReason: wallet.lastReason || null,
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(response),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
