import { getErrorCode } from './errors.js'

type SearchResult = {
  title: string
  link: string
  snippet: string
  date: string
  display_link: string
}

type SearchProvider = 'duckduckgo-lite' | 'sogou' | 'youcom'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 MiniCode/0.1'
const DEFAULT_TIMEOUT_MS = 12000
const DEFAULT_MAX_RETRIES = 2

/**
 * Provider chain for the built-in web_search tool. You.com is opt-in and only
 * tried first when YDC_API_KEY is set; DuckDuckGo and Sogou remain the defaults.
 */
export function getSearchProviders(): SearchProvider[] {
  const providers: SearchProvider[] = []
  if (String(process.env.YDC_API_KEY ?? '').trim().length > 0) {
    providers.push('youcom')
  }
  providers.push('duckduckgo-lite', 'sogou')
  return providers
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)))
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600)
}

function isRetryableNetworkError(error: unknown): boolean {
  const code = getErrorCode(error)
  if (!code) {
    return error instanceof Error && error.name === 'AbortError'
  }

  return (
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'EAI_AGAIN' ||
    code === 'ENOTFOUND' ||
    code === 'ECONNREFUSED' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'UND_ERR_BODY_TIMEOUT'
  )
}

function formatWebErrorMessage(args: {
  url: string
  error: unknown
  timeoutMs: number
}): string {
  const code = getErrorCode(args.error)
  if (code) {
    return `request failed (${code}) for ${args.url}`
  }

  if (args.error instanceof Error && args.error.name === 'AbortError') {
    return `request timed out after ${args.timeoutMs}ms for ${args.url}`
  }

  if (args.error instanceof Error && args.error.message) {
    return `${args.error.message} (${args.url})`
  }

  return `request failed for ${args.url}`
}

async function fetchWithRetry(
  url: string | URL,
  init: RequestInit,
  options?: {
    timeoutMs?: number
    maxRetries?: number
  },
): Promise<Response> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES
  const target = typeof url === 'string' ? url : url.toString()

  let lastError: unknown = null
  let lastResponse: Response | null = null
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort()
    }, timeoutMs)

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      })
      clearTimeout(timeout)
      lastResponse = response

      if (isRetryableStatus(response.status) && attempt < maxRetries) {
        await sleep(300 * Math.pow(2, attempt))
        continue
      }

      return response
    } catch (error) {
      clearTimeout(timeout)
      lastError = error
      if (attempt < maxRetries && isRetryableNetworkError(error)) {
        await sleep(300 * Math.pow(2, attempt))
        continue
      }
      throw new Error(
        formatWebErrorMessage({
          url: target,
          error,
          timeoutMs,
        }),
      )
    }
  }

  if (lastResponse) {
    return lastResponse
  }

  throw new Error(
    formatWebErrorMessage({
      url: target,
      error: lastError,
      timeoutMs,
    }),
  )
}

export async function searchDuckDuckGoLite(options: {
  query: string
  maxResults?: number
  allowedDomains?: string[]
  blockedDomains?: string[]
}): Promise<{
  organic: SearchResult[]
  base_resp: { status_code: number; status_msg: string; source: string }
}> {
  const allowed = normalizeDomainList(options.allowedDomains)
  const blocked = normalizeDomainList(options.blockedDomains)
  const maxResults = options.maxResults ?? 5
  const errors: string[] = []
  const providers: SearchProvider[] = getSearchProviders()

  for (const provider of providers) {
    try {
      const response = await fetchSearchPage(provider, options.query)
      if (!response.ok) {
        errors.push(`${provider}: HTTP ${response.status}`)
        continue
      }

      const html = await response.text()
      const parsed = parseSearchResults(provider, html)
      const organic = parsed
        .filter(r => passesDomainFilter(r.link, allowed, blocked))
        .slice(0, maxResults)

      if (organic.length > 0) {
        return {
          organic,
          base_resp: {
            status_code: response.status,
            status_msg: response.statusText,
            source: provider,
          },
        }
      }

      errors.push(`${provider}: no results`)
    } catch (error) {
      errors.push(`${provider}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (errors.length > 0) {
    throw new Error(`all search providers failed (${errors.join('; ')})`)
  }

  return {
    organic: [],
    base_resp: {
      status_code: 200,
      status_msg: 'OK',
      source: 'fallback-empty',
    },
  }
}

export async function fetchWebPage(options: {
  url: string
  maxChars?: number
}): Promise<{
  url: string
  finalUrl: string
  status: number
  statusText: string
  contentType: string
  title: string | null
  content: string
}> {
  const requestInit: RequestInit = {
    headers: {
      'user-agent': USER_AGENT,
      accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
      'accept-language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  }

  let response = await fetchWithRetry(options.url, requestInit)
  let text = await response.text()
  let contentType = response.headers.get('content-type') ?? ''
  let finalUrl = response.url || options.url

  if (contentType.includes('html')) {
    const htmlRedirectUrl = extractHtmlRedirectUrl(text, finalUrl)
    if (htmlRedirectUrl && htmlRedirectUrl !== finalUrl) {
      response = await fetchWithRetry(htmlRedirectUrl, requestInit)
      text = await response.text()
      contentType = response.headers.get('content-type') ?? ''
      finalUrl = response.url || htmlRedirectUrl
    }
  }
  const maxChars = options.maxChars ?? 12000

  if (contentType.includes('html')) {
    return {
      url: options.url,
      finalUrl,
      status: response.status,
      statusText: response.statusText,
      contentType,
      title: extractTitle(text),
      content: extractReadableText(text).slice(0, maxChars),
    }
  }

  return {
    url: options.url,
    finalUrl,
    status: response.status,
    statusText: response.statusText,
    contentType,
    title: null,
    content: text.slice(0, maxChars),
  }
}

function fetchSearchPage(provider: SearchProvider, query: string): Promise<Response> {
  const headers: Record<string, string> = {
    'user-agent': USER_AGENT,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  }

  if (provider === 'duckduckgo-lite') {
    const url = new URL('https://lite.duckduckgo.com/lite/')
    url.searchParams.set('q', query)
    headers['accept-language'] = 'en-US,en;q=0.9'
    return fetchWithRetry(url, { headers })
  }

  if (provider === 'sogou') {
    const url = new URL('https://www.sogou.com/web')
    url.searchParams.set('query', query)
    headers['accept-language'] = 'zh-CN,zh;q=0.9,en;q=0.6'
    return fetchWithRetry(url, { headers })
  }

  if (provider === 'youcom') {
    const apiKey = String(process.env.YDC_API_KEY ?? '').trim()
    if (!apiKey) {
      throw new Error('youcom provider requires YDC_API_KEY')
    }
    const url = new URL('https://api.ydc-index.io/search')
    url.searchParams.set('query', query)
    // The You.com endpoint is a JSON API, not a search results page.
    return fetchWithRetry(url, {
      headers: {
        'X-API-Key': apiKey,
        accept: 'application/json',
      },
    })
  }

  throw new Error(`unsupported search provider: ${provider}`)
}

function parseSearchResults(provider: SearchProvider, html: string): SearchResult[] {
  if (provider === 'duckduckgo-lite') {
    return parseDuckDuckGoLite(html)
  }

  if (provider === 'youcom') {
    return parseYoucomResults(html)
  }

  return parseSogouSearch(html)
}

type YoucomHit = {
  title?: string
  url?: string
  snippets?: string[]
  description?: string
  published_date?: string
}

/**
 * Parse the JSON response from the You.com Search API
 * (https://api.ydc-index.io/search). Falls back to an empty list on malformed
 * payloads so the provider chain can continue to the next engine.
 */
function parseYoucomResults(body: string): SearchResult[] {
  let data: { hits?: YoucomHit[] }
  try {
    data = JSON.parse(body) as { hits?: YoucomHit[] }
  } catch {
    return []
  }

  const hits = Array.isArray(data.hits) ? data.hits : []
  const results: SearchResult[] = []
  for (const hit of hits) {
    const link = typeof hit.url === 'string' ? hit.url : ''
    const title = typeof hit.title === 'string' ? hit.title : link
    if (!link || !title) continue
    const snippets = Array.isArray(hit.snippets) ? hit.snippets.filter(s => typeof s === 'string') : []
    const snippet = snippets.join(' ') || (typeof hit.description === 'string' ? hit.description : '')
    const date = typeof hit.published_date === 'string' ? hit.published_date : ''
    let displayLink = link
    try {
      displayLink = new URL(link).hostname
    } catch {
      // keep raw link as display
    }
    results.push({ title, link, snippet, date, display_link: displayLink })
  }
  return results
}

function parseDuckDuckGoLite(html: string): SearchResult[] {
  const results: SearchResult[] = []
  const anchorPattern = /<a\b[^>]*>[\s\S]*?<\/a>/giu
  const matches = [...html.matchAll(anchorPattern)]

  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i]
    const anchorHtml = match?.[0] ?? ''
    if (!anchorHtml) continue

    const classValue = firstMatch(/class=(['"])([\s\S]*?)\1/iu, anchorHtml, 2) ?? ''
    if (!/\bresult-link\b/i.test(classValue)) continue

    const rawHref = firstMatch(/href=(['"])([\s\S]*?)\1/iu, anchorHtml, 2) ?? ''
    const title = decodeHtml(stripTags(firstMatch(/<a\b[^>]*>([\s\S]*?)<\/a>/iu, anchorHtml) ?? ''))
    const nextMatch = matches[i + 1]
    const block = html.slice(match?.index ?? 0, nextMatch?.index ?? html.length)
    const snippet = decodeHtml(
      stripTags(
        firstMatch(
          /<td[^>]*class=(['"])[^'"]*\bresult-snippet\b[^'"]*\1[^>]*>\s*([\s\S]*?)\s*<\/td>/iu,
          block,
          2,
        ) ?? '',
      ),
    )
    const displayLink = decodeHtml(
      stripTags(
        firstMatch(
          /<span[^>]*class=(['"])[^'"]*\blink-text\b[^'"]*\1[^>]*>([\s\S]*?)<\/span>/iu,
          block,
          2,
        ) ?? '',
      ),
    )
    const link = normalizeDuckDuckGoLink(rawHref)

    if (!title || !link) continue
    results.push({ title, link, snippet, date: '', display_link: displayLink })
  }

  return results
}

function parseSogouSearch(html: string): SearchResult[] {
  const h3Pattern = /<h3\b[^>]*>\s*([\s\S]*?)<\/h3>/giu
  const matches = [...html.matchAll(h3Pattern)]
  const results: SearchResult[] = []

  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i]
    if (!match) continue

    const h3Html = match[0]
    const rawHref = decodeHtml(firstMatch(/href=(['"])([\s\S]*?)\1/iu, h3Html, 2) ?? '')
    const title = decodeHtml(
      stripTags(firstMatch(/<a\b[^>]*>([\s\S]*?)<\/a>/iu, h3Html, 1) ?? ''),
    )
    const link = normalizeSogouLink(rawHref)

    if (!title || !link) continue

    const next = matches[i + 1]
    const block = html.slice(match.index ?? 0, next?.index ?? html.length)
    const snippet = decodeHtml(
      stripTags(
        firstMatch(
          /<(div|p)\b[^>]*class=(['"])[^'"]*(fz-mid|str-text-info|text-layout|space-txt)[^'"]*\2[^>]*>([\s\S]*?)<\/\1>/iu,
          block,
          4,
        ) ?? '',
      ),
    )

    let displayLink = ''
    try {
      displayLink = new URL(link).hostname
    } catch {
      displayLink = link
    }

    results.push({
      title,
      link,
      snippet,
      date: '',
      display_link: displayLink,
    })
  }

  return results
}

function normalizeDomainList(domains: string[] | undefined): string[] {
  return (domains ?? [])
    .map((d) => {
      const raw = d.trim().toLowerCase()
      if (!raw) return ''
      const withoutWildcard = raw.replace(/^\*\./, '').replace(/^\./, '')
      try {
        return new URL(withoutWildcard).hostname.toLowerCase()
      } catch {
        return withoutWildcard
      }
    })
    .filter(Boolean)
}

function passesDomainFilter(
  link: string,
  allowed: string[],
  blocked: string[],
): boolean {
  let host = ''
  try {
    host = new URL(link).hostname.toLowerCase()
  } catch {
    return false
  }
  if (blocked.some((d) => matchesDomain(host, d))) return false
  if (allowed.length === 0) return true
  return allowed.some((d) => matchesDomain(host, d))
}

function matchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

function firstMatch(pattern: RegExp, text: string, group: number = 1): string | null {
  return text.match(pattern)?.[group] ?? null
}

function normalizeDuckDuckGoLink(rawHref: string): string {
  const href = decodeHtml(rawHref).trim()
  if (!href) return ''
  const absolute = href.startsWith('//') ? `https:${href}` : href
  try {
    const url = new URL(absolute)
    const redirect = url.searchParams.get('uddg')
    return redirect ? decodeURIComponent(redirect) : url.toString()
  } catch {
    return absolute
  }
}

function normalizeSogouLink(rawHref: string): string {
  if (!rawHref) return ''
  const href = decodeHtml(rawHref).trim()
  if (!href) return ''
  if (href.startsWith('/')) {
    return `https://www.sogou.com${href}`
  }
  if (href.startsWith('//')) {
    return `https:${href}`
  }
  return href
}

function extractHtmlRedirectUrl(html: string, baseUrl: string): string | null {
  const scriptRedirect =
    firstMatch(
      /window\.location(?:\.href)?(?:\.replace)?\((['"])(.*?)\1\)/iu,
      html,
      2,
    ) ??
    firstMatch(
      /window\.location(?:\.href)?\s*=\s*(['"])(.*?)\1/iu,
      html,
      2,
    )
  const metaRefresh =
    firstMatch(
      /<meta[^>]*http-equiv=(['"])refresh\1[^>]*content=(['"])[\s\S]*?url\s*=\s*('?)([^"'>;]+)\3[\s\S]*?\2[^>]*>/iu,
      html,
      4,
    ) ??
    firstMatch(
      /<meta[^>]*content=(['"])[\s\S]*?url\s*=\s*('?)([^"'>;]+)\2[\s\S]*?\1[^>]*http-equiv=(['"])refresh\4[^>]*>/iu,
      html,
      3,
    )

  const raw = decodeHtml((scriptRedirect ?? metaRefresh ?? '').trim())
  if (!raw) return null

  try {
    return new URL(raw, baseUrl).toString()
  } catch {
    return null
  }
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/iu)
  return match ? decodeHtml(stripTags(match[1] ?? '')).trim() : null
}

function extractReadableText(html: string): string {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/giu, ' ')
      .replace(/<style[\s\S]*?<\/style>/giu, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/giu, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/giu, ' ')
      .replace(/<[^>]+>/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim(),
  )
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim()
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gu, '&')
    .replace(/&quot;/gu, '"')
    .replace(/&#x27;/gu, "'")
    .replace(/&#39;/gu, "'")
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&#x2F;/gu, '/')
    .replace(/&#47;/gu, '/')
    .replace(/&nbsp;/gu, ' ')
}
