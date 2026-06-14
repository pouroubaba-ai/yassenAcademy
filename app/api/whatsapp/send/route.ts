import { NextRequest, NextResponse } from 'next/server'

const WA_API = 'https://wasenderapi.com/api/send-message'

export async function POST(req: NextRequest) {
  const { apiKey, messages } = await req.json()

  if (!apiKey) return NextResponse.json({ error: 'apiKey required' }, { status: 400 })
  if (!Array.isArray(messages) || messages.length === 0) return NextResponse.json({ error: 'messages required' }, { status: 400 })

  const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  const results = []

  for (const msg of messages) {
    const { to, text, documentUrl, filename } = msg
    if (!to || !text) { results.push({ to, success: false, error: 'missing fields' }); continue }

    try {
      const textRes = await fetch(WA_API, {
        method: 'POST',
        headers,
        body: JSON.stringify({ to, text }),
      })
      const textData = await textRes.json()

      if (!textRes.ok) {
        results.push({ to, success: false, error: textData?.message ?? 'send failed' })
        continue
      }

      if (documentUrl) {
        await fetch(WA_API, {
          method: 'POST',
          headers,
          body: JSON.stringify({ to, documentUrl, fileName: filename ?? 'avis-paiement.pdf' }),
        })
      }

      results.push({ to, success: true })
    } catch (err) {
      results.push({ to, success: false, error: String(err) })
    }
  }

  return NextResponse.json({ results })
}
