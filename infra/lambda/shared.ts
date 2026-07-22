import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'

export const TABLE_NAME = process.env.TABLE_NAME as string
export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
})

export interface IcalBooking {
  id: string
  listingId: string
  guestName: string
  channel: 'airbnb' | 'booking'
  checkIn: string // YYYY-MM-DD
  nights: number
  totalPrice: number // iCal에는 금액이 없어 0 — 프론트에서 추천가로 추정
  status: 'confirmed'
  source: 'ical'
}

export async function getDoc<T>(sub: string, sk: string): Promise<T | null> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { pk: `USER#${sub}`, sk } }),
  )
  return (res.Item?.data as T) ?? null
}

export async function putDoc(sub: string, sk: string, data: unknown): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { pk: `USER#${sub}`, sk, data, updatedAt: new Date().toISOString() },
    }),
  )
}

/** iCal(RFC 5545) 텍스트에서 VEVENT를 파싱한다. 에어비앤비 캘린더 내보내기 형식 대응. */
export function parseICal(text: string): { checkIn: string; nights: number; summary: string; uid: string }[] {
  // 접힌 줄(연속 줄이 공백/탭으로 시작) 펼치기
  const unfolded = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '')
  const events: { checkIn: string; nights: number; summary: string; uid: string }[] = []

  for (const block of unfolded.split('BEGIN:VEVENT').slice(1)) {
    const body = block.split('END:VEVENT')[0]
    const get = (prop: string): string | null => {
      const m = body.match(new RegExp(`^${prop}[^:\\n]*:(.*)$`, 'm'))
      return m ? m[1].trim() : null
    }
    const dtstart = get('DTSTART')
    const dtend = get('DTEND')
    if (!dtstart || !dtend) continue
    const start = toDateOnly(dtstart)
    const end = toDateOnly(dtend)
    if (!start || !end) continue
    const nights = Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 86400000))
    events.push({
      checkIn: start,
      nights,
      summary: get('SUMMARY') ?? 'Reserved',
      uid: get('UID') ?? `${start}-${nights}`,
    })
  }
  return events
}

/** 20260716 / 20260716T150000Z → 2026-07-16 */
function toDateOnly(v: string): string | null {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

export async function fetchAndParseICal(
  listingId: string,
  icalUrl: string,
  channel: 'airbnb' | 'booking',
): Promise<IcalBooking[]> {
  const res = await fetch(icalUrl, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`iCal fetch failed (${res.status}) for ${listingId}`)
  const text = await res.text()
  return parseICal(text).map((e) => ({
    id: `ical-${channel}-${listingId}-${e.uid}`,
    listingId,
    guestName: e.summary,
    channel,
    checkIn: e.checkIn,
    nights: e.nights,
    totalPrice: 0,
    status: 'confirmed' as const,
    source: 'ical' as const,
  }))
}

interface ListingLike {
  id: string
  icalUrl?: string
  bookingIcalUrl?: string
}

/** 사용자의 모든 iCal 연동 숙소(에어비앤비 + 부킹닷컴)를 동기화하고 저장된 예약 목록을 반환 */
export async function syncUserBookings(sub: string): Promise<IcalBooking[]> {
  const listings = (await getDoc<ListingLike[]>(sub, 'LISTINGS')) ?? []
  const jobs = listings.flatMap((l) => [
    ...(l.icalUrl ? [{ listingId: l.id, url: l.icalUrl, channel: 'airbnb' as const }] : []),
    ...(l.bookingIcalUrl
      ? [{ listingId: l.id, url: l.bookingIcalUrl, channel: 'booking' as const }]
      : []),
  ])
  const all: IcalBooking[] = []
  const errors: string[] = []
  for (const job of jobs) {
    try {
      all.push(...(await fetchAndParseICal(job.listingId, job.url, job.channel)))
    } catch (e) {
      errors.push(String(e))
    }
  }
  // 하나라도 성공했거나 연동이 없으면 저장 (전부 실패 시 기존 데이터 유지)
  if (jobs.length === 0 || all.length > 0 || errors.length < jobs.length) {
    await putDoc(sub, 'BOOKINGS', all)
  }
  if (errors.length) console.error('sync errors:', errors)
  return all
}
