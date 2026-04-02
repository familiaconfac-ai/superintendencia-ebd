function ensureAbsoluteUrl(value) {
  if (!value) return null

  try {
    return new URL(value)
  } catch {
    try {
      return new URL(`https://${String(value).replace(/^\/+/, '')}`)
    } catch {
      return null
    }
  }
}

export function normalizeWhatsAppNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('55')) return digits
  if (digits.length === 10 || digits.length === 11) return `55${digits}`
  return digits
}

export function buildWhatsAppTeacherUrl(phone, message) {
  const number = normalizeWhatsAppNumber(phone)
  const encodedMessage = encodeURIComponent(message || '')

  if (!number) {
    return `https://wa.me/?text=${encodedMessage}`
  }

  return `https://wa.me/${number}?text=${encodedMessage}`
}

export function buildWhatsAppGroupDestination(groupLink, message) {
  const parsedUrl = ensureAbsoluteUrl(groupLink)
  if (!parsedUrl) {
    return {
      url: '',
      supportsPrefill: false,
      sourceLabel: 'Grupo da EBD',
    }
  }

  const encodedMessage = encodeURIComponent(message || '')
  const hostname = parsedUrl.hostname.toLowerCase()
  const url = new URL(parsedUrl.toString())
  const isDirectChatLink =
    hostname.includes('wa.me')
    || hostname.includes('api.whatsapp.com')
    || hostname.includes('web.whatsapp.com')

  if (isDirectChatLink) {
    url.searchParams.set('text', message || '')
  }

  return {
    url: url.toString(),
    supportsPrefill: isDirectChatLink && !!encodedMessage,
    sourceLabel: hostname.includes('chat.whatsapp.com') ? 'convite do grupo' : 'grupo da EBD',
  }
}
