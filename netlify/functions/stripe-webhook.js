// netlify/functions/stripe-webhook.js
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { createClient } = require("@netlify/blobs");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    };
  }

  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!endpointSecret) {
    console.log("manca STRIPE_WEBHOOK_SECRET");
    return { statusCode: 500, body: "missing secret" };
  }

  let stripeEvent;
  try {
    const sig = event.headers["stripe-signature"];
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      endpointSecret
    );
  } catch (err) {
    console.log("errore signature", err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  // consideriamo solo i pagamenti riusciti
  if (stripeEvent.type !== "checkout.session.completed") {
    return { statusCode: 200, body: "ignored" };
  }

  const session = stripeEvent.data.object;

  // email usata in checkout
  const email = session.customer_details?.email || session.customer_email;
  const sku = session.metadata?.sku;
  const minutes = Number(session.metadata?.minutes || 0);
  const amount = session.amount_total || 0;
  const currency = session.currency || "eur";

  console.log(
    "webhook ->",
    "email:",
    email,
    "sku:",
    sku,
    "minutes:",
    minutes
  );

  if (!email) {
    console.log("nessuna email nella sessione");
    return { statusCode: 200, body: "no email" };
  }

  // client blobs inizializzato con i tuoi env
  const blobs = createClient({
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_BLOBS_TOKEN,
  });

  // nome oggetto = email
  const key = email.toLowerCase();
  let current = await blobs.get(key, { type: "json" });

  if (!current) {
    current = {
      minutes: 0,
      points: 0,
      tier: "None",
      history: [],
    };
  }

  // somma i minuti che arrivano dal checkout
  const newMinutes = (current.minutes || 0) + minutes;

  const newHistory = [
    {
      id: session.id,
      created: session.created,
      amount,
      currency,
      sku,
      minutes,
    },
    ...(current.history || []),
  ].slice(0, 50);

  const updated = {
    ...current,
    minutes: newMinutes,
    history: newHistory,
  };

  await blobs.set(key, updated, { contentType: "application/json" });

  console.log("wallet aggiornato per", email);

  return {
    statusCode: 200,
    body: "ok",
  };
};
