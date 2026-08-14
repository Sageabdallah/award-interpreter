export async function publicPayrollReference(value) {
  const sourceId = String(value || '').trim()
  if (!sourceId) return ''
  const bytes = new TextEncoder().encode(`axi-workspace/v1/${sourceId}`)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `MSS-${hex.slice(0, 10).toUpperCase()}`
}
