// netlify/functions/rs-choice.js
import { getStore } from '@netlify/blobs'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  try {
    const { id, choice } = JSON.parse(event.body || '{}')
    if (!id || !choice) {
      return { statusCode: 400, body: 'Missing id or choice' }
    }

    const store = getStore('rs')
    const key = `rs:${id}`
    const raw = await store.get(key, { type: 'json' })
    if (!raw) return { statusCode: 404, body: 'RS not found' }

    const now = new Date().toISOString()
    raw.events = Array.isArray(raw.events) ? raw.events : []
    raw.events.push({ ts: now, type: 'choice', choice })

    await store.setJSON(key, raw)

    // Email di notifica (opzionale)
    try {
      if (process.env.RESEND_API_KEY && (raw.requesterEmail || raw.ownerEmail)) {
        const to = raw.ownerEmail || raw.requesterEmail
        const subject = `RS scelta: ${choice} — ${raw.context || ''}`
        const body = `ID: ${id}\nScelta: ${choice}\nContesto: ${raw.context || '-'}\nNote: ${raw.note || '-'}\nQuando: ${now}`
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: process.env.EMAIL_FROM || 'noreply@colpamia.com',
            to: to,
            subject,
            text: body
          })
        })
        await r.text() // ignoro eventuali errori
      }
    } catch (e) {
      console.warn('email_send_failed', e.message)
    }

    // Destinazioni/azioni suggerite lato client
    let next = null
    if (choice === 'back') next = '/#catalogo'

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, next })
    }
  } catch (e) {
    console.error('rs-choice error', e)
    return { statusCode: 500, body: 'server_error' }
  }
}
