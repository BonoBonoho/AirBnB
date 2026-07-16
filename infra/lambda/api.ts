import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda'
import { randomBytes } from 'node:crypto'
import { PutCommand } from '@aws-sdk/lib-dynamodb'
import { ddb, TABLE_NAME, getDoc, putDoc, syncUserBookings } from './shared'
import { fetchAirbnbListing } from './airbnb-import'

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(body),
})

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  const sub = event.requestContext.authorizer?.jwt?.claims?.sub as string | undefined
  if (!sub) return json(401, { error: 'unauthorized' })

  const method = event.requestContext.http.method
  const path = event.rawPath

  try {
    // 전체 상태 조회 (숙소 + 수동가격 + iCal 예약 + 실매출 + 메일수신 설정)
    if (method === 'GET' && path === '/api/state') {
      const [listings, overrides, bookings, actuals, settings, verification] = await Promise.all([
        getDoc(sub, 'LISTINGS'),
        getDoc(sub, 'OVERRIDES'),
        getDoc(sub, 'BOOKINGS'),
        getDoc(sub, 'ACTUALS'),
        getDoc<{ inboundKey?: string }>(sub, 'SETTINGS'),
        getDoc(sub, 'VERIFICATION'),
      ])
      return json(200, {
        listings,
        overrides: overrides ?? [],
        bookings: bookings ?? [],
        actuals: actuals ?? [],
        inboundKey: settings?.inboundKey ?? null,
        verification: verification ?? null,
      })
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
