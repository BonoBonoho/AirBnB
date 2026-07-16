/**
 * 에어비앤비 숙소 링크에서 공개 메타데이터(og 태그 + 임베디드 JSON)를 best-effort로 추출.
 * 공식 API가 없어 페이지의 링크 미리보기용 정보를 읽는다 — 실패할 수 있으며
 * 그 경우 프론트에서 수동 입력으로 폴백한다.
 */
export interface ImportedListing {
  airbnbRoomId: string
  name: string | null
  bedrooms: number | null
  maxGuests: number | null
  photoUrl: string | null
  type: string | null
}

export function extractRoomId(url: string): string | null {
  const m = url.match(/airbnb\.[a-z.]+\/rooms\/(?:plus\/)?(\d+)/i)
  return m ? m[1] : null
}

function meta(html: string, property: string): string | null {
  // <meta property="og:title" content="..."> 또는 content가 먼저 오는 형태 모두 대응
  const re1 = new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i')
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${property}["']`, 'i')
  const m = html.match(re1) ?? html.match(re2)
  return m ? decodeEntities(m[1]) : null
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&middot;/g, '·')
    .replace(/&nbsp;/g, ' ')
}

function firstNumber(patterns: RegExp[], ...sources: (string | null)[]): number | null {
  for (const src of sources) {
    if (!src) continue
    for (const re of patterns) {
      const m = src.match(re)
      if (m) return Number(m[1])
    }
  }
  return null
}

export async function fetchAirbnbListing(url: string): Promise<ImportedListing> {
  const roomId = extractRoomId(url)
  if (!roomId) throw new Error('올바른 에어비앤비 숙소 링크가 아닙니다 (예: airbnb.co.kr/rooms/12345)')

  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
    Accept: 'text/html,application/xhtml+xml',
  }

  let html = ''
  for (const host of ['www.airbnb.co.kr', 'www.airbnb.com']) {
    try {
      const res = await fetch(`https://${host}/rooms/${roomId}`, {
        headers,
        signal: AbortSignal.timeout(12000),
        redirect: 'follow',
      })
      if (res.ok) {
        html = await res.text()
        break
      }
    } catch {
      // 다음 호스트 시도
    }
  }
  if (!html) throw new Error('에어비앤비 페이지를 불러오지 못했습니다. 수동으로 입력해 주세요.')

  const ogTitle = meta(html, 'og:title')
  const ogDesc = meta(html, 'og:description')
  const ogImage = meta(html, 'og:image')

  // "숙소 이름 - 지역의 아파트 임대 - 에어비앤비" 형태에서 이름만 추출
  const name = ogTitle ? ogTitle.split(/\s+[-–]\s+/)[0].trim() || null : null

  const bedrooms = firstNumber(
    [/침실\s*(\d+)/, /(\d+)\s*bedroom/i, /"bedrooms"\s*:\s*(\d+)/],
    ogDesc, ogTitle, html,
  )
  const maxGuests = firstNumber(
    [/(?:최대\s*)?인원\s*(\d+)\s*명/, /(\d+)\s*guests?/i, /"personCapacity"\s*:\s*(\d+)/, /"person_capacity"\s*:\s*(\d+)/],
    ogDesc, ogTitle, html,
  )

  let type: string | null = null
  const src = `${ogTitle ?? ''} ${ogDesc ?? ''}`
  if (/한옥/.test(src)) type = '한옥'
  else if (/개인실|private room/i.test(src)) type = '개인실'
  else if (/펜션|단독|집 전체|entire home|entire house|villa/i.test(src)) type = '독채 펜션'
  else if (/오피스텔/.test(src)) type = '오피스텔 전체'
  else if (/아파트|apartment|rental unit/i.test(src)) type = '아파트 전체'

  return { airbnbRoomId: roomId, name, bedrooms, maxGuests, photoUrl: ogImage, type }
}
