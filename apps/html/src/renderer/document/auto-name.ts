const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function decode(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code =
        e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

function textOf(html: string, tag: string): string {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}\\s*>`, 'i').exec(html)
  if (!m) return ''
  return decode(m[1]!.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
}

const MIN_TITLE_NAME = 2
const MAX_TITLE_NAME = 60

/** The document <title> as a file name; empty when missing, a placeholder, or too long to be a name.
 *  Only the head region is searched so an inline <svg><title> in the body cannot stand in for it;
 *  </head> is optional in HTML, so the region ends at whichever of </head>, <body or <svg comes first. */
export function derivePageTitleName(html: string): string {
  const end = /<\/head\s*>|<body[\s>]|<svg[\s>]/i.exec(html)
  const title = textOf(end ? html.slice(0, end.index) : html, 'title')
  return title.length >= MIN_TITLE_NAME && title.length <= MAX_TITLE_NAME ? title : ''
}

/** File name for an AI-generated untitled document: <title>, else the first <h1>, else the first words of the body */
export function deriveAutoFileName(html: string): string {
  const title = textOf(html, 'title') || textOf(html, 'h1')
  if (title) return title.slice(0, 60)
  const body = textOf(html, 'body') || html.replace(/<[^>]*>/g, ' ')
  return decode(body).replace(/\s+/g, ' ').trim().split(' ').slice(0, 8).join(' ').slice(0, 60)
}
