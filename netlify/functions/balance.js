// netlify/functions/balance.js
const { createClient } = require("@netlify/blobs");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS };
  }

  const email = (event.queryStringParameters?.email || "").toLowerCase();
  if (!email) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: "email richiesta" }),
    };
  }

  const blobs = createClient({
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_BLOBS_TOKEN,
  });

  // legge lo stesso key usato dal webhook
  const data = await blobs.get(email, { type: "json" });

  return {
    statusCode: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
    body: JSON.stringify(
      data || {
        minutes: 0,
        points: 0,
        tier: "None",
        history: [],
      }
    ),
  };
};
