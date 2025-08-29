// netlify/functions/create-checkout-session.js
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Missing STRIPE_SECRET_KEY. Impostala nelle Environment variables di Netlify."
        })
      };
    }

    const body = JSON.parse(event.body || "{}");

    const price_eur = Number(body.price_eur || 1);
    const redeem_minutes = Number(body.redeem_minutes || 1);
    const service = String(body.service || "Credito minuti");

    if (price_eur <= 0 || redeem_minutes <= 0) {
      return { statusCode: 400, body: JSON.stringify({ error: "Invalid price/minutes" }) };
    }

    const siteUrl =
      process.env.SITE_URL ||
      `${(event.headers["x-forwarded-proto"] || "https")}://${event.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: Math.round(price_eur * 100),
            product_data: {
              name: service,
              description: `${redeem_minutes} minuti`,
            },
          },
        },
      ],
      metadata: {
        redeem_minutes: String(redeem_minutes),
        price_eur: String(price_eur),
      },
      success_url: `${siteUrl}/success.html`,
      cancel_url: `${siteUrl}/cancel.html`,
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error("Stripe error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Stripe error", details: err.message }),
    };
  }
};
