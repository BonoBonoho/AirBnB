import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda'
import { randomBytes } from 'node:crypto'
import { PutCommand } from '@aws-sdk/lib-dynamodb'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { ddb, TABLE_NAME, getDoc, putDoc, syncUserBookings } from './shared'
import { fetchAirbnbListing } from './airbnb-import'
import { scanMarket } from './market-scan'
import { renderListingPage, renderSitemap } from './public-page'

const s3 = new S3Client({})
const SITE_BUCKET = process.env.SITE_BUCKET
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? ''

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(body),
})

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method
  const path = event.rawPath

  // ── 공개 라우트 (게스트 설문 — 로그인 불필요, 토큰이 인증 역할)
  if (path.startsWith('/public/form/')) {
    const token = decodeURIComponent(path.split('/public/form/')[1] ?? '')
    if (!/^[a-z0-9]{8,32}$/.test(token)) return json(404, { error: 'not found' })
    try {
      const link = await getDoc<{
        sub: string; bookingId: string; guestName: string; listingName: string
        checkIn: string; nights: number
      }>(`FORMLINK:${token}`, 'MAP')
      if (!link) return json(404, { error: '유효하지 않은 링크입니다' })

      if (method === 'GET') {
        const [questions, responses] = await Promise.all([
          getDoc(link.sub, 'FORMQUESTIONS'),
          getDoc<Record<string, unknown>>(link.sub, 'FORMRESP'),
        ])
        return json(200, {
          questions, // null이면 프론트가 기본 템플릿 사용
          meta: {
            guestName: link.guestName, listingName: link.listingName,
            checkIn: link.checkIn, nights: link.nights,
          },
          submitted: !!responses?.[link.bookingId],
        })
      }

      if (method === 'POST') {
        const body = JSON.parse(event.body ?? '{}')
        if (!body.answers || typeof body.answers !== 'object') {
          return json(400, { error: 'answers가 필요합니다' })
        }
        const answers: Record<string, string> = {}
        for (const [k, v] of Object.entries(body.answers as Record<string, unknown>).slice(0, 60)) {
          answers[String(k).slice(0, 60)] = String(v).slice(0, 2000)
        }
        const responses = (await getDoc<Record<string, unknown>>(link.sub, 'FORMRESP')) ?? {}
        responses[link.bookingId] = {
          submittedAt: new Date().toISOString(),
          guestName: String(body.guestName ?? link.guestName).slice(0, 100),
          answers,
        }
        await putDoc(link.sub, 'FORMRESP', responses)
        return json(200, { ok: true })
      }
    } catch (e) {
      console.error(e)
      return json(500, { error: 'internal error' })
    }
    return json(404, { error: 'not found' })
  }

  // ── 공개 라우트: 미니홈 가용성 조회 / 예약 문의 접수
  if (path.startsWith('/public/avail/') || path.startsWith('/public/inquiry/')) {
    const slug = decodeURIComponent(path.split('/').pop() ?? '')
    if (!/^[a-z0-9-]{3,40}$/.test(slug)) return json(404, { error: 'not found' })
    try {
      const map = await getDoc<{ sub: string; listingId: string }>(`SLUG:${slug}`, 'MAP')
      if (!map) return json(404, { error: '페이지를 찾을 수 없습니다' })

      if (method === 'GET' && path.startsWith('/public/avail/')) {
        const bookings =
          (await getDoc<{ listingId: string; checkIn: string; nights: number; status: string }[]>(
            map.sub, 'BOOKINGS',
          )) ?? []
        const booked: string[] = []
        for (const b of bookings) {
          if (b.listingId !== map.listingId || b.status === 'cancelled') continue
          const [y, mo, d] = b.checkIn.split('-').map(Number)
          for (let i = 0; i < b.nights; i++) {
            const dt = new Date(y, mo - 1, d + i)
            booked.push(
              `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`,
            )
          }
        }
        return json(200, { booked })
      }

      if (method === 'POST' && path.startsWith('/public/inquiry/')) {
        const body = JSON.parse(event.body ?? '{}')
        if (!body.name || !body.contact) return json(400, { error: '성함과 연락처가 필요합니다' })
        const inquiries =
          (await getDoc<unknown[]>(map.sub, 'INQUIRIES')) ?? []
        inquiries.unshift({
          id: randomBytes(6).toString('hex'),
          slug,
          listingId: map.listingId,
          name: String(body.name).slice(0, 50),
          contact: String(body.contact).slice(0, 80),
          dates: String(body.dates ?? '').slice(0, 80),
          message: String(body.message ?? '').slice(0, 1000),
          at: new Date().toISOString(),
        })
        await putDoc(map.sub, 'INQUIRIES', inquiries.slice(0, 200))
        return json(200, { ok: true })
      }
    } catch (e) {
      console.error(e)
      return json(500, { error: 'internal error' })
    }
    return json(404, { error: 'not found' })
  }

  const sub = event.requestContext.authorizer?.jwt?.claims?.sub as string | undefined
  if (!sub) return json(401, { error: 'unauthorized' })

  try {
    // 전체 상태 조회 (숙소 + 수동가격 + iCal 예약 + 실매출 + 메일수신 설정 + 시장 데이터)
    if (method === 'GET' && path === '/api/state') {
      const [listings, overrides, bookings, actuals, settings, verification, market, formQuestions, formResponses, formLinks, inquiries] =
        await Promise.all([
          getDoc(sub, 'LISTINGS'),
          getDoc(sub, 'OVERRIDES'),
          getDoc(sub, 'BOOKINGS'),
          getDoc(sub, 'ACTUALS'),
          getDoc<{ inboundKey?: string }>(sub, 'SETTINGS'),
          getDoc(sub, 'VERIFICATION'),
          getDoc(sub, 'MARKET'),
          getDoc(sub, 'FORMQUESTIONS'),
          getDoc(sub, 'FORMRESP'),
          getDoc(sub, 'FORMLINKS'),
          getDoc(sub, 'INQUIRIES'),
        ])
      return json(200, {
        listings,
        overrides: overrides ?? [],
        bookings: bookings ?? [],
        actuals: actuals ?? [],
        inboundKey: settings?.inboundKey ?? null,
        verification: verification ?? null,
        market: market ?? {},
        formQuestions,
        formResponses: formResponses ?? {},
        formLinks: formLinks ?? {},
        inquiries: inquiries ?? [],
      })
    }

    // 미니홈 발행 — 정적 HTML을 사이트 버킷에 생성 (네이버/구글 봇 인덱싱 가능)
    if (method === 'POST' && path === '/api/publish-page') {
      if (!SITE_BUCKET) return json(500, { error: '사이트 버킷이 설정되지 않았습니다' })
      const { listingId, slug, page } = JSON.parse(event.body ?? '{}')
      if (!listingId || !slug || !page) return json(400, { error: 'listingId/slug/page 필요' })
      if (!/^[a-z0-9-]{3,40}$/.test(String(slug))) {
        return json(400, { error: '주소는 영문 소문자·숫자·하이픈 3~40자입니다' })
      }
      const existing = await getDoc<{ sub: string; listingId: string }>(`SLUG:${slug}`, 'MAP')
      if (existing && (existing.sub !== sub || existing.listingId !== String(listingId))) {
        return json(409, { error: '이미 사용 중인 주소입니다. 다른 주소를 선택하세요.' })
      }

      const html = renderListingPage({
        slug: String(slug),
        name: String(page.name ?? '').slice(0, 120),
        region: String(page.region ?? '').slice(0, 60),
        type: String(page.type ?? '').slice(0, 40),
        bedrooms: Number(page.bedrooms) || 0,
        maxGuests: Number(page.maxGuests) || 0,
        description: String(page.description ?? '').slice(0, 3000),
        photoUrl: page.photoUrl ? String(page.photoUrl).slice(0, 500) : undefined,
        kakaoUrl: page.kakaoUrl ? String(page.kakaoUrl).slice(0, 300) : undefined,
        phone: page.phone ? String(page.phone).slice(0, 30) : undefined,
        airbnbUrl: page.airbnbUrl ? String(page.airbnbUrl).slice(0, 300) : undefined,
        minPriceText: page.minPriceText ? String(page.minPriceText).slice(0, 60) : undefined,
        apiUrl: `https://${event.requestContext.domainName}`,
        origin: PUBLIC_ORIGIN,
      })

      const slugs = (await getDoc<string[]>('GLOBAL', 'SLUGS')) ?? []
      if (!slugs.includes(String(slug))) slugs.push(String(slug))

      await Promise.all([
        putDoc(`SLUG:${slug}`, 'MAP', { sub, listingId: String(listingId) }),
        putDoc('GLOBAL', 'SLUGS', slugs),
        s3.send(new PutObjectCommand({
          Bucket: SITE_BUCKET,
          Key: `s/${slug}`,
          Body: html,
          ContentType: 'text/html; charset=utf-8',
          CacheControl: 'public, max-age=300',
        })),
        s3.send(new PutObjectCommand({
          Bucket: SITE_BUCKET,
          Key: 'sitemap.xml',
          Body: renderSitemap(PUBLIC_ORIGIN, slugs),
          ContentType: 'application/xml',
          CacheControl: 'public, max-age=3600',
        })),
      ])
      return json(200, { url: `${PUBLIC_ORIGIN}/s/${slug}` })
    }

    // 게스트 설문 질문 저장
    if (method === 'PUT' && path === '/api/form-questions') {
      const { questions } = JSON.parse(event.body ?? '{}')
      if (!Array.isArray(questions)) return json(400, { error: 'questions 배열이 필요합니다' })
      await putDoc(sub, 'FORMQUESTIONS', questions.slice(0, 60))
      return json(200, { ok: true })
    }

    // 예약별 설문 링크 발급 (이미 있으면 재사용)
    if (method === 'POST' && path === '/api/form-link') {
      const { bookingId, guestName, listingName, checkIn, nights } = JSON.parse(event.body ?? '{}')
      if (!bookingId) return json(400, { error: 'bookingId가 필요합니다' })
      const links = (await getDoc<Record<string, string>>(sub, 'FORMLINKS')) ?? {}
      let token = links[String(bookingId)]
      if (!token) {
        token = randomBytes(8).toString('hex')
        links[String(bookingId)] = token
        await Promise.all([
          putDoc(sub, 'FORMLINKS', links),
          putDoc(`FORMLINK:${token}`, 'MAP', {
            sub,
            bookingId: String(bookingId),
            guestName: String(guestName ?? '게스트').slice(0, 100),
            listingName: String(listingName ?? '').slice(0, 120),
            checkIn: String(checkIn ?? ''),
            nights: Number(nights) || 1,
          }),
        ])
      }
      return json(200, { token })
    }

    // 시장 스캔 — 지역·날짜 하나에 대한 경쟁 가격 분포 (저장은 클라이언트가 PUT /api/market으로)
    if (method === 'POST' && path === '/api/market-scan') {
      const { region, checkin, checkout } = JSON.parse(event.body ?? '{}')
      if (!region || !checkin || !checkout) return json(400, { error: 'region/checkin/checkout 필요' })
      try {
        return json(200, await scanMarket(String(region), String(checkin), String(checkout)))
      } catch (e) {
        return json(422, { error: e instanceof Error ? e.message : '스캔 실패' })
      }
    }

    // 시장 데이터 저장 (지역별 병합)
    if (method === 'PUT' && path === '/api/market') {
      const { region, data } = JSON.parse(event.body ?? '{}')
      if (!region || !data) return json(400, { error: 'region/data 필요' })
      const market = (await getDoc<Record<string, unknown>>(sub, 'MARKET')) ?? {}
      market[String(region)] = data
      await putDoc(sub, 'MARKET', market)
      return json(200, { ok: true })
    }

    // 정산 메일 수신 주소 발급 (이미 있으면 재사용)
    if (method === 'POST' && path === '/api/inbound-address') {
      const settings = (await getDoc<{ inboundKey?: string }>(sub, 'SETTINGS')) ?? {}
      if (!settings.inboundKey) {
        settings.inboundKey = randomBytes(6).toString('hex') // 12자 소문자 hex
        await Promise.all([
          putDoc(sub, 'SETTINGS', settings),
          ddb.send(
            new PutCommand({
              TableName: TABLE_NAME,
              Item: { pk: `INBOUND#${settings.inboundKey}`, sk: 'MAP', data: { sub } },
            }),
          ),
        ])
      }
      return json(200, { inboundKey: settings.inboundKey })
    }

    // 전체 상태 저장
    if (method === 'PUT' && path === '/api/state') {
      const body = JSON.parse(event.body ?? '{}')
      if (!Array.isArray(body.listings)) return json(400, { error: 'listings must be an array' })
      await Promise.all([
        putDoc(sub, 'LISTINGS', body.listings),
        putDoc(sub, 'OVERRIDES', Array.isArray(body.overrides) ? body.overrides : []),
      ])
      return json(200, { ok: true })
    }

    // iCal 즉시 동기화
    if (method === 'POST' && path === '/api/sync') {
      const bookings = await syncUserBookings(sub)
      return json(200, { bookings })
    }

    // 에어비앤비 숙소 링크에서 정보 불러오기 (best-effort)
    if (method === 'POST' && path === '/api/import') {
      const { url } = JSON.parse(event.body ?? '{}')
      if (typeof url !== 'string') return json(400, { error: 'url이 필요합니다' })
      try {
        return json(200, await fetchAirbnbListing(url))
      } catch (e) {
        return json(422, { error: e instanceof Error ? e.message : '불러오기 실패' })
      }
    }

    return json(404, { error: 'not found' })
  } catch (e) {
    console.error(e)
    return json(500, { error: 'internal error' })
  }
}
