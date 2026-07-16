import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda'
import { getDoc, putDoc, syncUserBookings } from './shared'

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
    // 전체 상태 조회 (숙소 + 수동가격 + iCal 예약)
    if (method === 'GET' && path === '/api/state') {
      const [listings, overrides, bookings] = await Promise.all([
        getDoc(sub, 'LISTINGS'),
        getDoc(sub, 'OVERRIDES'),
        getDoc(sub, 'BOOKINGS'),
      ])
      return json(200, { listings, overrides: overrides ?? [], bookings: bookings ?? [] })
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

    return json(404, { error: 'not found' })
  } catch (e) {
    console.error(e)
    return json(500, { error: 'internal error' })
  }
}
