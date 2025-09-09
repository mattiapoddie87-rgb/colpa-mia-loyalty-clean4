exports.handler = async () => {
  const v = (process.env.RESEND_API_KEY || '').trim();
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hasKey: !!v,
      prefix: v ? v.slice(0,5) : null,
      suffix: v ? v.slice(-5) : null,
      len: v.length
    })
  };
};
