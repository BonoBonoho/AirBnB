/**
 * 에어비앤비 공개 검색 결과에서 지역·날짜별 경쟁 숙소 1박 가격을 수집한다 (best-effort).
 * 공식 API가 없어 검색 페이지에 임베드된 가격 표기를 파싱한다 — 차단 시 실패할 수 있다.
 */
export interface MarketScanPoint {
  count: number
  p25: number
  median: number
  p75: number
  p90: number
}

export interface CompetitorRef {
  id: string
  name?: string
}

/** HTML에서 원화 1박 가격 후보들을 추출 — 2만~200만 범위만 인정, 중복 제거 */
export function extractPrices(html: string): number[] {
  const raw = [...html.matchAll(/₩\s?([\d,]{5,10})/g)].map((m) => Number(m[1].replace(/,/g, '')))
  const sane = raw.filter((n) => n >= 20000 && n <= 2000000)
  return [...new Set(sane)]
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo))
}

export function toPoint(prices: number[]): MarketScanPoint | null {
  if (prices.length < 5) return null // 표본이 너무 적으면 신뢰 불가
  const sorted = [...prices].sort((a, b) => a - b)
  return {
    count: sorted.length,
    p25: percentile(sorted, 0.25),
    median: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
  }
}

/** 검색 결과에서 경쟁 숙소 room ID(+가능하면 이름)를 best-effort로 추출 */
export function extractListings(html: string): CompetitorRef[] {
  const ids = [...html.matchAll(/StayListing:(\d{6,20})/g)].map((m) => m[1])
  if (ids.length === 0) {
    ids.push(...[...html.matchAll(/\/rooms\/(\d{6,20})/g)].map((m) => m[1]))
  }
  const uniqueIds = [...new Set(ids)].slice(0, 12)

  // 이름 후보: 카드 title/name 필드 — 순서 기반 매칭이라 어긋나면 이름 생략
  const names = [...html.matchAll(/"(?:title|name)"\s*:\s*"((?:[^"\\]|\\.){8,120})"/g)]
    .map((m) => {
      try {
        return JSON.parse(`"${m[1]}"`) as string
      } catch {
        return null
      }
    })
    .filter((n): n is string => !!n && !/^https?:/.test(n))

  return uniqueIds.map((id, i) => ({
    id,
    ...(names.length === uniqueIds.length ? { name: names[i] } : {}),
  }))
}

export async function scanMarket(
  region: string,
  checkin: string,
  checkout: string,
): Promise<MarketScanPoint & { listings: CompetitorRef[] }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkin) || !/^\d{4}-\d{2}-\d{2}$/.test(checkout)) {
    throw new Error('날짜 형식이 올바르지 않습니다')
  }
  const url =
    `https://www.airbnb.co.kr/s/${encodeURIComponent(region)}/homes` +
    `?checkin=${checkin}&checkout=${checkout}&adults=2&currency=KRW`
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept-Language': 'ko-KR,ko;q=0.9',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(15000),
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`검색 페이지 요청 실패 (${res.status})`)
  const html = await res.text()
  const point = toPoint(extractPrices(html))
  if (!point) throw new Error('이 날짜의 시장 가격 표본을 충분히 찾지 못했습니다')
  return { ...point, listings: extractListings(html) }
}
