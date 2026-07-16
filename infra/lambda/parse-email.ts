import type { S3Event } from 'aws-lambda'
import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { simpleParser } from 'mailparser'

const s3 = new S3Client({})
const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.TABLE_REGION }),
  { marshallOptions: { removeUndefinedValues: true } },
)
const TABLE = process.env.TABLE_NAME as string

/** 이메일에서 추출한 실제 정산 내역 */
export interface ActualPayout {
  id: string // 예약 코드 또는 체크인+금액 기반 중복 방지 키
  checkIn: string | null // YYYY-MM-DD
  amount: number
  guestName: string | null
  listingName: string | null
  confirmationCode: string | null
  subject: string
  receivedAt: string
}

export function parseAirbnbEmail(
  subject: string,
  text: string,
  receivedAt: string,
): ActualPayout | null {
  const src = `${subject}\n${text}`

  // 금액: '호스트 수익/예상 수익/총액 ₩423,000' 우선, 없으면 본문 최대 ₩금액
  let amount: number | null = null
  const labeled = src.match(/(?:호스트\s*수익|예상\s*수익|총\s*수익|정산|payout)[^\d₩$]{0,40}[₩]\s*([\d,]+)/i)
  if (labeled) {
    amount = Number(labeled[1].replace(/,/g, ''))
  } else {
    const all = [...src.matchAll(/₩\s*([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, '')))
    if (all.length) amount = Math.max(...all)
  }
  if (!amount || amount <= 0) return null

  // 체크인: '체크인 ... 2026년 8월 1일' 또는 '체크인 8월 1일'
  let checkIn: string | null = null
  const ci = src.match(/체크인[^\d]{0,20}(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/)
  if (ci) {
    const year = ci[1] ? Number(ci[1]) : Number(receivedAt.slice(0, 4))
    checkIn = `${year}-${String(Number(ci[2])).padStart(2, '0')}-${String(Number(ci[3])).padStart(2, '0')}`
  } else {
    const iso = src.match(/체크인[^\d]{0,20}(\d{4})-(\d{2})-(\d{2})/)
    if (iso) checkIn = `${iso[1]}-${iso[2]}-${iso[3]}`
  }

  const code = src.match(/\b(HM[A-Z0-9]{6,12})\b/)?.[1] ?? null
  const guest = subject.match(/(?:예약\s*확정|예약)[^-–:]*[-–:]\s*(.+?)\s*님/)?.[1] ?? null
  const listingName = src.match(/숙소[:\s]+([^\n]{2,80})/)?.[1]?.trim() ?? null

  return {
    id: code ?? `${checkIn ?? 'unknown'}:${amount}`,
    checkIn,
    amount,
    guestName: guest,
    listingName,
    confirmationCode: code,
    subject: subject.slice(0, 200),
    receivedAt,
  }
}

async function subForInboundKey(key: string): Promise<string | null> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { pk: `INBOUND#${key}`, sk: 'MAP' } }),
  )
  return (res.Item?.data as { sub: string } | undefined)?.sub ?? null
}

async function getDoc<T>(sub: string, sk: string): Promise<T | null> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { pk: `USER#${sub}`, sk } }),
  )
  return (res.Item?.data as T) ?? null
}

async function putDoc(sub: string, sk: string, data: unknown): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: { pk: `USER#${sub}`, sk, data, updatedAt: new Date().toISOString() },
    }),
  )
}

export async function handler(event: S3Event): Promise<void> {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '))
    try {
      const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      const raw = await obj.Body?.transformToByteArray()
      if (!raw) continue
      const mail = await simpleParser(Buffer.from(raw))

      const to = [mail.to, mail.cc]
        .flatMap((a) => (a ? ('value' in a ? a.value : a.flatMap((x) => x.value)) : []))
        .map((v) => v.address?.toLowerCase() ?? '')
      const inboundKey = to
        .map((addr) => addr.split('@')[0])
        .find((local) => /^[a-z0-9]{8,32}$/.test(local))
      const from = (mail.from?.value?.[0]?.address ?? '').toLowerCase()
      const subject = mail.subject ?? ''
      const text = mail.text ?? mail.html ?? ''
      const receivedAt = (mail.date ?? new Date()).toISOString()

      const sub = inboundKey ? await subForInboundKey(inboundKey) : null
      if (!sub) {
        console.log('unknown inbound key, dropping', to.join(','))
        continue
      }

      const isAirbnbSender = from.endsWith('@airbnb.com') || from.endsWith('.airbnb.com')
      // 수동 전달(백필) 지원: 발신자가 에어비앤비가 아니어도 본문이 에어비앤비 정산 메일이면 인정.
      // 수신 주소가 사용자별 비공개 키라서 위험은 낮다.
      const looksLikeAirbnb = /airbnb|에어비앤비/i.test(`${subject}\n${text}`.slice(0, 3000))

      if (isAirbnbSender || looksLikeAirbnb) {
        const payout = parseAirbnbEmail(subject, String(text), receivedAt)
        if (payout && (isAirbnbSender || payout.confirmationCode || payout.checkIn)) {
          const actuals = (await getDoc<ActualPayout[]>(sub, 'ACTUALS')) ?? []
          const rest = actuals.filter((a) => a.id !== payout.id)
          await putDoc(sub, 'ACTUALS', [...rest, payout].slice(-500))
          console.log(`actual saved: ${payout.id} ₩${payout.amount} (forwarded=${!isAirbnbSender})`)
          continue
        }
        if (isAirbnbSender) {
          console.log('airbnb mail without payout amount, skipped:', subject)
          continue
        }
      }

      if (!looksLikeAirbnb && /google|gmail|naver/.test(from) && /전달|확인|인증|verif|forward/i.test(subject + text)) {
        // Gmail/네이버 전달 확인 메일 — 사용자가 UI에서 인증 코드/링크를 볼 수 있게 저장
        await putDoc(sub, 'VERIFICATION', {
          subject: subject.slice(0, 200),
          snippet: String(text).slice(0, 1500),
          receivedAt,
        })
        console.log('verification mail stored')
      } else {
        console.log('non-airbnb mail dropped:', from)
      }
    } finally {
      // 처리 후 원본 메일 즉시 삭제 (프라이버시)
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => {})
    }
  }
}
