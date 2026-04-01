let pdfWorkerConfigured = false

const LOWERCASE_PARTS = new Set(['da', 'de', 'do', 'das', 'dos', 'e'])
const HEADING_KEYWORDS = [
  'igreja',
  'lista',
  'membros',
  'member',
  'members',
  'pagina',
  'page',
  'telefone',
  'telefones',
  'celular',
  'nome',
  'nomes',
  'endereco',
  'enderecos',
  'bairro',
  'cidade',
  'cpf',
  'rg',
  'email',
]

function normalizeWhitespace(value = '') {
  return String(value).replace(/\s+/g, ' ').trim()
}

function normalizePersonName(value = '') {
  return normalizeWhitespace(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function formatPersonName(value = '') {
  return normalizeWhitespace(value)
    .split(' ')
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase()
      if (LOWERCASE_PARTS.has(lower)) return lower
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join(' ')
}

function looksLikeHeading(line = '') {
  const normalized = normalizePersonName(line)
  if (!normalized) return true
  if (HEADING_KEYWORDS.some((keyword) => normalized.startsWith(keyword))) return true
  if (/^\d+\s*(de|\/)\s*\d+$/.test(normalized)) return true
  return false
}

function stripMetadata(line = '') {
  let candidate = normalizeWhitespace(line)

  candidate = candidate.replace(/^[\-\u2022*]+\s*/, '')
  candidate = candidate.replace(/\s+(cpf|rg|email|telefone|tel|cel|celular|nasc|nascimento|endereco|bairro|cidade)\b.*$/i, '')
  candidate = candidate.replace(/\s+\(?\d{2}\)?\s*\d[\d\s.\-]{6,}.*$/, '')
  candidate = candidate.replace(/\s+\d{1,2}[/-]\d{1,2}[/-]\d{2,4}.*$/, '')
  candidate = candidate.replace(/\s+-\s+.*$/, '')
  candidate = candidate.replace(/\s+\|\s+.*$/, '')
  candidate = candidate.replace(/;\s+.*$/, '')
  candidate = candidate.replace(/:\s+.*$/, '')
  candidate = candidate.replace(/\s{2,}.*$/, '')

  return normalizeWhitespace(candidate.replace(/[|;,:-]+$/, ''))
}

function extractNameCandidate(line = '') {
  const candidate = stripMetadata(line)
  if (!candidate || looksLikeHeading(candidate)) return ''
  if (!/[A-Za-zÀ-ÿ]/.test(candidate)) return ''

  const digitCount = (candidate.match(/\d/g) || []).length
  if (digitCount >= 3) return ''

  const words = candidate.split(' ').filter(Boolean)
  if (words.length === 1 && candidate.length < 6) return ''
  if (words.length > 8) return ''

  return formatPersonName(candidate)
}

function groupPdfTextToLines(items = []) {
  const sorted = [...items]
    .map((item) => ({
      text: normalizeWhitespace(item.str || ''),
      x: item.transform?.[4] || 0,
      y: item.transform?.[5] || 0,
    }))
    .filter((item) => item.text)
    .sort((a, b) => {
      if (Math.abs(b.y - a.y) > 1.5) return b.y - a.y
      return a.x - b.x
    })

  const lines = []
  let current = []
  let currentY = null

  sorted.forEach((item) => {
    if (currentY === null || Math.abs(currentY - item.y) <= 1.5) {
      current.push(item)
      currentY = currentY ?? item.y
      return
    }

    lines.push(current.sort((a, b) => a.x - b.x).map((entry) => entry.text).join(' '))
    current = [item]
    currentY = item.y
  })

  if (current.length > 0) {
    lines.push(current.sort((a, b) => a.x - b.x).map((entry) => entry.text).join(' '))
  }

  return lines.map(normalizeWhitespace).filter(Boolean)
}

async function extractPdfLines(file) {
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist')

  if (!pdfWorkerConfigured) {
    GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
    pdfWorkerConfigured = true
  }

  const buffer = await file.arrayBuffer()
  const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise
  const lines = []

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    lines.push(...groupPdfTextToLines(content.items || []))
  }

  return lines
}

export async function parsePeoplePdfFile(file, existingPeople = []) {
  const lines = await extractPdfLines(file)
  const existingNames = new Set(
    (existingPeople || [])
      .map((person) => normalizePersonName(person?.fullName || person?.name || ''))
      .filter(Boolean),
  )
  const seen = new Set()
  const items = []

  lines.forEach((line, index) => {
    const fullName = extractNameCandidate(line)
    const normalizedName = normalizePersonName(fullName)
    if (!normalizedName || seen.has(normalizedName)) return
    seen.add(normalizedName)
    items.push({
      id: `${normalizedName}-${index}`,
      fullName,
      normalizedName,
      sourceLine: line,
      isDuplicate: existingNames.has(normalizedName),
    })
  })

  if (items.length === 0) {
    throw new Error('Nao encontrei nomes aproveitaveis neste PDF. Tente um PDF com texto selecionavel.')
  }

  return {
    items,
    totalLines: lines.length,
    duplicateCount: items.filter((item) => item.isDuplicate).length,
    newCount: items.filter((item) => !item.isDuplicate).length,
  }
}
