/**
 * statementParser.js
 *
 * Parses bank statement files (CSV and OFX/QFX) into a normalised list of
 * raw transaction rows, ready for classification by transactionClassifier.js.
 *
 * Supported formats:
 *   âœ… CSV  â€“ generic delimited text files exported by most Brazilian banks
 *   âœ… OFX  â€“ Open Financial Exchange (also .qfx, .ofx from Bradesco, ItaÃº, BB, etc.)
 *   âŒ PDF  â€“ not supported; binary parsing is unreliable
 *
 * Each parsed row:
 *   {
 *     date:        string     -- ISO "YYYY-MM-DD"
 *     description: string     -- raw description from the file
 *     amount:      number     -- absolute value (always positive)
 *     direction:   'credit' | 'debit' | 'unknown'
 *     balance:     number | null
 *     rawLine:     string     -- original line (for debugging)
 *   }
 */

// â”€â”€ Error class â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class ParseError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ParseError'
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  AMOUNT NORMALISATION
//  This is the most critical piece. Brazilian banks use:
//    â€¢ dot as thousands separator  and  comma as decimal separator: 1.234,56
//    â€¢ plain integer/decimal (no separator): 1234.56 or 1234,56
//    â€¢ signed values: -45,90 or (45,90) for negative
//    â€¢ currency prefix: R$ 1.234,56
//  US format (comma = thousands, dot = decimal): 1,234.56
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Normalises a raw amount string to a signed JS number.
 *
 * Handles:
 *   "123,45"        â†’ 123.45    (BR comma-decimal, no thousands)
 *   "1.234,56"      â†’ 1234.56   (BR dot-thousands + comma-decimal)
 *   "-45,90"        â†’ -45.90    (negative BR)
 *   "R$ 2.150,00"   â†’ 2150.00   (BR with currency prefix)
 *   "2150.00"       â†’ 2150.00   (US/plain)
 *   "2,150.00"      â†’ 2150.00   (US with thousands comma)
 *   "(1.234,56)"    â†’ -1234.56  (accounting negative parens)
 *   ""              â†’ NaN
 *
 * Returns a SIGNED float (negative = debit in signed-value CSVs).
 */
export function normaliseBRAmount(raw) {
  if (raw === null || raw === undefined) return NaN
  let s = String(raw).trim()
  if (!s) return NaN

  // Accounting negative â€” parentheses notation: (1.234,56)
  const isParenNeg = s.startsWith('(') && s.endsWith(')')
  if (isParenNeg) s = '-' + s.slice(1, -1)

  // Preserve leading minus
  const isNeg = s.startsWith('-')
  if (isNeg) s = s.slice(1).trim()

  // Strip currency symbols and non-numeric noise EXCEPT . , 
  // Handles: R$, BRL, US$, $, â‚¬, spaces
  s = s.replace(/[R$USâ‚¬Â£Â¥BRL\s]+/gi, '').trim()

  // After stripping, s should be something like: 1.234,56 | 1234.56 | 1,234.56 | 1234,56 | 1234

  let numeric

  if (s === '' || s === '.' || s === ',') return NaN

  // Count dots and commas
  const dotCount   = (s.match(/\./g) || []).length
  const commaCount = (s.match(/,/g)  || []).length

  if (dotCount === 0 && commaCount === 0) {
    // Plain integer: "1234"
    numeric = parseFloat(s)

  } else if (dotCount > 0 && commaCount === 0) {
    // Could be:
    //   US decimal "1234.56"  â€” exactly 1 dot with â‰¤2 digits after
    //   BR thousands "1.234"  â€” exactly 1 dot with exactly 3 digits after and no decimal part
    //   Multiple dots "1.234.567" â€” all are thousands separators
    const afterDot = s.split('.').pop()
    if (dotCount === 1 && afterDot.length !== 3) {
      // US decimal: 1234.56 or edge case like .5
      numeric = parseFloat(s)
    } else {
      // BR thousands-only (no decimal): 1.234 or 1.234.567
      numeric = parseFloat(s.replace(/\./g, ''))
    }

  } else if (dotCount === 0 && commaCount > 0) {
    // Could be:
    //   BR decimal "1234,56" â€” exactly 1 comma
    //   US thousands "1,234,567" â€” multiple commas (no decimal)
    const afterComma = s.split(',').pop()
    if (commaCount === 1 && afterComma.length !== 3) {
      // BR decimal: 1234,56
      numeric = parseFloat(s.replace(',', '.'))
    } else {
      // US thousands: 1,234 or 1,234,567
      numeric = parseFloat(s.replace(/,/g, ''))
    }

  } else {
    // Both dots AND commas present.
    // Determine which is decimal separator by position:
    // The decimal separator always comes LAST.
    const lastDot   = s.lastIndexOf('.')
    const lastComma = s.lastIndexOf(',')

    if (lastComma > lastDot) {
      // Comma is last â†’ comma is decimal, dots are thousands: 1.234,56
      numeric = parseFloat(s.replace(/\./g, '').replace(',', '.'))
    } else {
      // Dot is last â†’ dot is decimal, commas are thousands: 1,234.56
      numeric = parseFloat(s.replace(/,/g, ''))
    }
  }

  if (isNaN(numeric)) return NaN

  // Sanity cap: amounts > 100 million in a single transaction are almost certainly
  // a parsing error (e.g. balance being read as transaction amount).
  // We log a warning but still return the value â€” caller decides what to do.
  if (numeric > 100_000_000) {
    console.warn(`[Parser] âš ï¸ Suspiciously large amount: ${numeric} (raw: "${raw}") â€” possible balance-column mis-read`)
  }

  const result = isNeg ? -numeric : numeric
  console.log(`[Parser] ðŸ’° normaliseBRAmount("${raw}") â†’ ${result}`)
  return result
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  DATE PARSING
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Parse a date string to ISO YYYY-MM-DD.
 * Supported input formats:
 *   DD/MM/YYYY  DD-MM-YYYY  DD.MM.YYYY  (Brazilian)
 *   YYYY-MM-DD  YYYYMMDD              (ISO / OFX)
 * MM/DD/YYYY is intentionally NOT auto-detected to avoid ambiguity.
 */
function parseDateToISO(str) {
  if (!str) return null
  const s = String(str).trim()

  // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
  const brMatch = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/)
  if (brMatch) {
    const [, d, m, y] = brMatch
    const ds = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    return isNaN(new Date(ds).getTime()) ? null : ds
  }

  // YYYYMMDD[HHMMSS...] â€” OFX compact
  const compactMatch = s.match(/^(\d{4})(\d{2})(\d{2})/)
  if (compactMatch) {
    const [, y, m, d] = compactMatch
    const ds = `${y}-${m}-${d}`
    return isNaN(new Date(ds).getTime()) ? null : ds
  }

  // YYYY-MM-DD â€” already ISO
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) {
    return isNaN(new Date(s).getTime()) ? null : s
  }

  return null
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  OFX PARSER
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function parseOFX(text) {
  console.log('[Parser] ðŸ¦ OFX/QFX format detected')

  const rows = []

  // Strategy 1: XML-style with closing tags <STMTTRN>...<\/STMTTRN>
  const xmlBlocks = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || []

  if (xmlBlocks.length > 0) {
    console.log(`[Parser] OFX: found ${xmlBlocks.length} XML-style STMTTRN blocks`)
    xmlBlocks.forEach((b) => processOFXBlock(b, rows))
  } else {
    // Strategy 2: SGML-style (no closing tags, one field per line)
    // Split on <STMTTRN> and treat each chunk as a block
    const sgmlParts = text.split(/<STMTTRN>/gi)
    const sgmlBlocks = sgmlParts.slice(1).map((chunk) => {
      // Each block ends at the next top-level tag (e.g. <STMTTRN> again or </STMTTRNLIST>)
      const endMatch = chunk.match(/^([\s\S]*?)(?=<\/?[A-Z]{4,}(?:\s|>))/i)
      return '<STMTTRN>' + (endMatch ? endMatch[1] : chunk)
    })
    console.log(`[Parser] OFX: found ${sgmlBlocks.length} SGML-style STMTTRN blocks`)
    if (sgmlBlocks.length === 0) {
      throw new ParseError('Nenhuma transaÃ§Ã£o encontrada no arquivo OFX. Verifique se Ã© um extrato vÃ¡lido.')
    }
    sgmlBlocks.forEach((b) => processOFXBlock(b, rows))
  }

  console.log(`[Parser] âœ… OFX parsed: ${rows.length} valid transactions`)
  return rows
}

function getOFXField(block, field) {
  const re = new RegExp(`<${field}>([^<\\r\\n]+)`, 'i')
  const m  = block.match(re)
  return m ? m[1].trim() : null
}

function processOFXBlock(block, rows) {
  try {
    const trnType = getOFXField(block, 'TRNTYPE') || 'DEBIT'
    const dateStr = getOFXField(block, 'DTPOSTED') || getOFXField(block, 'DTUSER') || ''
    const amtStr  = getOFXField(block, 'TRNAMT')  || '0'
    const memo    = getOFXField(block, 'MEMO')    || ''
    const name    = getOFXField(block, 'NAME')    || ''
    const fitid   = getOFXField(block, 'FITID')   || ''
    const balStr  = getOFXField(block, 'BALAMT')  || null

    const isoDate = parseDateToISO(dateStr)
    if (!isoDate) {
      console.warn('[Parser] âš ï¸ OFX: skipping block â€” invalid date:', dateStr)
      return
    }

    const signedAmt = normaliseBRAmount(amtStr)
    if (isNaN(signedAmt)) {
      console.warn('[Parser] âš ï¸ OFX: skipping block â€” invalid amount:', amtStr)
      return
    }

    const amount    = Math.abs(signedAmt)
    const direction = signedAmt >= 0 ? 'credit' : 'debit'
    const desc      = [memo, name].filter(Boolean).join(' Â· ') || trnType || fitid || 'Sem descriÃ§Ã£o'

    const balRaw = balStr ? normaliseBRAmount(balStr) : null
    console.log(`[Parser] OFX row: ${isoDate} | ${direction} | R$${amount} | "${desc}"`)

    rows.push({
      date:        isoDate,
      description: desc,
      amount,
      direction,
      balance:     (balRaw !== null && !isNaN(balRaw)) ? balRaw : null,
      rawLine:     block.replace(/\s+/g, ' ').slice(0, 160),
    })
  } catch (err) {
    console.warn('[Parser] âš ï¸ OFX: could not process block:', err.message)
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  CSV PARSER
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function parseCSV(text) {
  console.log('[Parser] ðŸ“„ CSV format detected')

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  if (lines.length < 2) {
    throw new ParseError('O arquivo CSV parece vazio ou sem dados suficientes.')
  }

  // â”€â”€ 1. Detect separator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const sep = detectCSVSeparator(lines[0])
  console.log(`[Parser] CSV separator detected: "${sep === '\t' ? 'TAB' : sep}"`)

  const parsed = lines.map((l) => splitCSVLine(l, sep))

  // â”€â”€ 2. Find header row â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Skip top metadata lines (bank name, period header, etc.) until a row
  // that looks like a data header is found.

  let headerIdx = -1
  for (let i = 0; i < Math.min(parsed.length, 25); i++) {
    const rowLower = parsed[i].map((c) => stripAccents(c.toLowerCase()))
    const hasDate  = rowLower.some((c) => /\bdata\b|date|\bdt\b/.test(c))
    const hasAmt   = rowLower.some((c) => /\bvalor\b|value|amount|\bvlr\b|debito|credito|saida|entrada/.test(c))
    if (hasDate && hasAmt) {
      headerIdx = i
      console.log(`[Parser] CSV header row found at line ${i}: [${parsed[i].join(' | ')}]`)
      break
    }
  }

  // No conventional header â€” try to parse from first row as data
  const headers  = headerIdx >= 0 ? parsed[headerIdx].map((h) => stripAccents(h.toLowerCase().trim())) : null
  const dataRows = parsed.slice(headerIdx >= 0 ? headerIdx + 1 : 0)

  // â”€â”€ 3. Detect column mapping â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const colMap = detectCSVColumns(headers, dataRows)
  console.log('[Parser] CSV column map:', JSON.stringify(colMap))

  // â”€â”€ 4. Extract rows â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const rows = []
  dataRows.forEach((cells, idx) => {
    try {
      const row = extractCSVRow(cells, colMap, idx + 1)
      if (row) {
        rows.push({ ...row, rawLine: cells.join(sep).slice(0, 160) })
      }
    } catch (err) {
      console.warn(`[Parser] âš ï¸ CSV row ${idx + 1} error:`, err.message, '| cells:', cells)
    }
  })

  if (rows.length === 0) {
    throw new ParseError('Nenhuma transaÃ§Ã£o vÃ¡lida encontrada no CSV. Verifique o formato e tente novamente.')
  }

  console.log(`[Parser] âœ… CSV parsed: ${rows.length} valid rows from ${dataRows.length} data lines`)
  return rows
}

// â”€â”€ CSV helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function stripAccents(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function detectCSVSeparator(line) {
  // Prefer semicolon (most common in Brazilian bank exports), then comma, tab, pipe
  const candidates = [';', ',', '\t', '|']
  let best = ','
  let bestCount = 0
  for (const c of candidates) {
    const count = (line.match(new RegExp('\\' + (c === '\t' ? 't' : c === '|' ? '\\|' : c), 'g')) || []).length
    if (count > bestCount) { bestCount = count; best = c }
  }
  return best
}

function splitCSVLine(line, sep) {
  // RFC-4180 aware: handle quoted fields with embedded separators
  const result = []
  let field = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { field += '"'; i++ } // escaped quote
      else inQuote = !inQuote
    } else if (ch === sep && !inQuote) {
      result.push(field.trim())
      field = ''
    } else {
      field += ch
    }
  }
  result.push(field.trim())
  return result
}

/**
 * CRITICAL: detectCSVColumns
 *
 * The key insight: for Brazilian bank CSVs we must distinguish between:
 *   1. Single signed amount column  ("Valor" â€” BR: negative = debit)
 *   2. Split debit + credit columns ("DÃ©bito" and "CrÃ©dito" separately)
 *   3. Balance/saldo column â€” must NEVER be used as amount
 *
 * Priority when both `valor` and `debito/credito` exist: prefer split columns.
 * The balance column is identified last and excluded from amount.
 */
function detectCSVColumns(headers, dataRows) {
  const col = {
    dateIdx:       -1,
    descIdx:       -1,
    amountIdx:     -1,  // single signed amount column
    debitIdx:      -1,  // separate debit column
    creditIdx:     -1,  // separate credit column
    directionIdx:  -1,  // D/C or Tipo column
    balanceIdx:    -1,  // saldo â€” must not be used as amount
  }

  if (headers && headers.length > 0) {
    // Strip accents and lowercase for matching
    const h = headers.map(stripAccents)

    // Balance column â€” identify FIRST so it can be excluded from amount search
    col.balanceIdx   = h.findIndex((c) => /\bsaldo\b|balance|\bsal\b/.test(c))

    // Date
    col.dateIdx      = h.findIndex((c) => /\bdata\b|\bdate\b|\bdt\b/.test(c))

    // Description / histÃ³rico
    col.descIdx      = h.findIndex((c) =>
      /\bdescr|\bmemo\b|\bhistorico\b|\bhist\b|\bdetalhe\b|\bnarrativa\b|\blancamento\b|\bcomplemento\b/.test(c)
    )

    // Separate debit column (DÃ©bito / SaÃ­da / Valor DÃ©bito)
    col.debitIdx     = h.findIndex((c, i) => i !== col.balanceIdx &&
      /\bdebito\b|\bdebit\b|\bsaida\b|\bsaidas\b|\bvlr.?deb\b/.test(c)
    )

    // Separate credit column (CrÃ©dito / Entrada / Valor CrÃ©dito)
    col.creditIdx    = h.findIndex((c, i) => i !== col.balanceIdx &&
      /\bcredito\b|\bcredit\b|\bentrada\b|\bentradas\b|\bvlr.?cred\b/.test(c)
    )

    // Direction indicator column (D/C, Tipo, Natureza)
    col.directionIdx = h.findIndex((c) =>
      /^\s*d\s*[\/|]\s*c\s*$|^tipo$|natureza$|^dc$/.test(c)
    )

    // Single amount column â€” only if we DON'T have a split debit/credit pair
    // Exclude balance column from this search
    if (col.debitIdx < 0 || col.creditIdx < 0) {
      col.amountIdx = h.findIndex((c, i) =>
        i !== col.balanceIdx &&
        i !== col.debitIdx   &&
        i !== col.creditIdx  &&
        /\bvalor\b|\bvalue\b|\bamount\b|\bvlr\b|\bvl\.?\b/.test(c)
      )
    }

    console.log('[Parser] CSV header analysis:', h)
    console.log('[Parser] CSV colMap from headers:', JSON.stringify(col))

  } else {
    // Headerless: guess from first data row content
    const sample = dataRows[0] || []
    sample.forEach((cell, i) => {
      if (col.dateIdx < 0 && parseDateToISO(cell) !== null) {
        col.dateIdx = i
      } else if (cell.length > 3 && /[A-Za-z\u00C0-\u00FF]/.test(cell)) {
        if (col.descIdx < 0) col.descIdx = i
      } else {
        const n = normaliseBRAmount(cell)
        if (!isNaN(n) && Math.abs(n) > 0) {
          if (col.amountIdx < 0) col.amountIdx = i
        }
      }
    })
    console.log('[Parser] CSV headerless guesses:', JSON.stringify(col))
  }

  // â”€â”€ Safety defaults â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // If critical columns were not found, apply conservative defaults
  // (never default amountIdx to the last column â€” that is typically saldo)

  if (col.dateIdx < 0) col.dateIdx = 0
  if (col.descIdx < 0) col.descIdx = (col.dateIdx === 0) ? 1 : 0

  // If no amount column found AND no split debit/credit found:
  // Try to find ANY numeric column that is not balance
  if (col.amountIdx < 0 && col.debitIdx < 0 && col.creditIdx < 0) {
    console.warn('[Parser] âš ï¸ No amount column identified from headers â€” scanning data rows for numeric column')
    const sample = dataRows.slice(0, 5)
    const numericCols = {}
    sample.forEach((cells) => {
      cells.forEach((cell, i) => {
        if (i === col.dateIdx || i === col.descIdx || i === col.balanceIdx) return
        const n = normaliseBRAmount(cell)
        if (!isNaN(n) && n !== 0) numericCols[i] = (numericCols[i] || 0) + 1
      })
    })
    const candidates = Object.entries(numericCols).sort((a, b) => b[1] - a[1])
    if (candidates.length > 0) {
      // Prefer a column that is NOT the last one (last is often saldo)
      const nonLast = candidates.filter(([idx]) => Number(idx) < (dataRows[0]?.length ?? 0) - 1)
      col.amountIdx = Number((nonLast.length > 0 ? nonLast : candidates)[0][0])
      console.log('[Parser] âš ï¸ Fallback amountIdx chosen:', col.amountIdx)
    }
  }

  return col
}

function extractCSVRow(cells, colMap, rowNum) {
  const dateStr = colMap.dateIdx >= 0 ? (cells[colMap.dateIdx] || '') : ''
  const isoDate = parseDateToISO(dateStr)

  if (!isoDate) {
    // Skip rows that don't start with a date (sub-totals, headers, empty lines)
    return null
  }

  const desc = colMap.descIdx >= 0 ? (cells[colMap.descIdx] || '').trim() : `LanÃ§amento ${rowNum}`
  if (!desc) return null

  let amount, direction

  // â”€â”€ Case A: split DÃ©bito / CrÃ©dito columns â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (colMap.debitIdx >= 0 && colMap.creditIdx >= 0) {
    const debitRaw  = cells[colMap.debitIdx]  || ''
    const creditRaw = cells[colMap.creditIdx] || ''

    console.log(`[Parser] CSV row ${rowNum}: split cols | debit="${debitRaw}" credit="${creditRaw}"`)

    const debitVal  = normaliseBRAmount(debitRaw)
    const creditVal = normaliseBRAmount(creditRaw)

    if (!isNaN(creditVal) && Math.abs(creditVal) > 0) {
      amount    = Math.abs(creditVal)
      direction = 'credit'
    } else if (!isNaN(debitVal) && Math.abs(debitVal) > 0) {
      amount    = Math.abs(debitVal)
      direction = 'debit'
    } else {
      console.log(`[Parser] CSV row ${rowNum}: both debit/credit empty or zero â€” skipping`)
      return null
    }

  // â”€â”€ Case B: single signed amount column â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  } else if (colMap.amountIdx >= 0) {
    const rawCell = cells[colMap.amountIdx] || ''
    const signed  = normaliseBRAmount(rawCell)

    console.log(`[Parser] CSV row ${rowNum}: single amount col[${colMap.amountIdx}]="${rawCell}" â†’ ${signed}`)

    if (isNaN(signed) || signed === 0) return null

    // Check if there's a D/C direction column
    if (colMap.directionIdx >= 0) {
      const dc = stripAccents((cells[colMap.directionIdx] || '').toLowerCase().trim())
      direction = /^c|cred|entrada/.test(dc) ? 'credit' : 'debit'
      amount    = Math.abs(signed)
    } else {
      // Use sign of amount
      amount    = Math.abs(signed)
      direction = signed < 0 ? 'debit' : signed > 0 ? 'credit' : 'unknown'
    }

  } else {
    console.warn(`[Parser] CSV row ${rowNum}: no amount column â€” skipping`)
    return null
  }

  // Sanity check: reject absurd amounts (likely saldo mis-read)
  if (amount > 10_000_000) {
    console.warn(`[Parser] âš ï¸ CSV row ${rowNum}: amount ${amount} exceeds sanity limit â€” skipping (possible saldo columns mis-read)`)
    return null
  }

  const balRaw = (colMap.balanceIdx >= 0) ? normaliseBRAmount(cells[colMap.balanceIdx] || '') : null

  console.log(`[Parser] âœ… CSV row ${rowNum}: ${isoDate} | ${direction} | R$${amount} | "${desc}"`)

  return {
    date:        isoDate,
    description: desc,
    amount,
    direction,
    balance:     (balRaw !== null && !isNaN(balRaw)) ? balRaw : null,
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  PUBLIC API
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Detects format and dispatches to OFX or CSV parser.
 * @param   {string} text       raw UTF-8 (or Latin-1) file content
 * @param   {string} fileName   original filename (for extension detection)
 * @returns {Array}             array of normalised rows
 * @throws  {ParseError}
 */
export function parseStatement(text, fileName) {
  const ext  = (fileName || '').toLowerCase().split('.').pop()
  const head = text.slice(0, 800).toLowerCase()

  console.log(`[Parser] â”€â”€ parseStatement â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€`)
  console.log(`[Parser] File: "${fileName}" | ext: ".${ext}"`)
  console.log(`[Parser] First 200 chars: ${text.slice(0, 200).replace(/\n/g, 'â†µ')}`)

  // PDF â€” explicitly unsupported
  if (ext === 'pdf' || head.startsWith('%pdf')) {
    throw new ParseError(
      'Arquivos PDF nÃ£o sÃ£o suportados.\n' +
      'Exporte o extrato como CSV ou OFX no internet banking e tente novamente.'
    )
  }

  // OFX / QFX â€” detected by extension or content signature
  if (ext === 'ofx' || ext === 'qfx' || head.includes('<ofx>') || head.includes('<stmttrn>') || head.includes('ofxheader')) {
    return parseOFX(text)
  }

  // CSV / TXT / TSV â€” everything else
  return parseCSV(text)
}

/**
 * Read a File as UTF-8 text, with ISO-8859-1 fallback for older Brazilian bank exports.
 * @param   {File} file
 * @returns {Promise<{ text: string, encoding: string }>}
 */
export async function readStatementFile(file) {
  const readAs = (f, enc) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload  = (e) => resolve(e.target.result)
      reader.onerror = () => reject(new Error('Erro ao ler o arquivo.'))
      reader.readAsText(f, enc)
    })

  try {
    const utf8 = await readAs(file, 'UTF-8')
    // U+FFFD replacement char indicates failed UTF-8 decode
    if (utf8.includes('\uFFFD')) {
      console.log('[Parser] UTF-8 decode had replacement chars â€” retrying as ISO-8859-1')
      const latin = await readAs(file, 'ISO-8859-1')
      return { text: latin, encoding: 'ISO-8859-1' }
    }
    return { text: utf8, encoding: 'UTF-8' }
  } catch (err) {
    throw new Error('NÃ£o foi possÃ­vel ler o arquivo: ' + err.message)
  }
}

export { ParseError }
