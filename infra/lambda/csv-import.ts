/**
 * 에어비앤비 거래내역 CSV / 부킹닷컴 예약 내보내기 CSV → 정산 내역 변환.
 * 수신 주소로 CSV를 첨부해 보내면 과거 매출을 일괄 백필한다.
 * 한글/영문 헤더 모두 지원, 구분자(쉼표/탭/세미콜론) 자동 감지.
 */
import type { ActualPayout } from './parse-email'

/** RFC4180 스타일 파싱 — 따옴표 안 쉼표/줄바꿈 처리 */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '')
  const nl = s.indexOf('\n')
  const firstLine = nl === -1 ? s : s.slice(0, nl)
  const delim = [
    ['\t', (firstLine.match(/\t/g) ?? []).length],
    [';', (firstLine.match(/;/g) ?? []).length],
    [',', (firstLine.match(/,/g) ?? []).length],
  ].sort((a, b) => (b[1] as number) - (a[1] as number))[0][0] as string

  const rows: string[][] = []
  let cur = ''
  let row: string[] = []
  let inQ = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { cur += '"'; i++ } else inQ = false
      } else cur += c
    } else if (c === '"') {
      inQ = true
    } else if (c === delim) {
      row.push(cur); cur = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(cur); cur = ''
      if (row.some((x) => x.trim() !== '')) rows.push(row)
      row = []
    } else cur += c
  }
  row.push(cur)
  if (row.some((x) => x.trim() !== '')) rows.push(row)
  return rows
}

const pad = (v: string | number) => String(Number(v)).padStart(2, '0')

/** 2026-07-25 / 2026. 7. 25. / 07/25/2026(에어비앤비 영문) / 25-07-2026(부킹 일부) */
export function parseAnyDate(v: string): string | null {
  const s = v.trim()
  let m = s.match(/^(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/)
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) return `${m[3]}-${pad(m[1])}-${pad(m[2])}`
  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/)
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`
  return null
}

function num(v: string): number {
  const n = Number(v.replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** 헤더를 보고 에어비앤비/부킹닷컴 CSV를 정산 내역으로 변환 */
export function rowsToPayouts(rows: string[][], receivedAt: string, filename: string): ActualPayout[] {
  if (rows.length < 2) return []
  const header = rows[0].map((h) => h.trim().toLowerCase())
  const find = (re: RegExp) => header.findIndex((h) => re.test(h))
  const col = {
    checkIn: find(/체크인|check.?in|시작 ?날짜|start ?date|arrival/),
    checkOut: find(/체크아웃|check.?out|종료 ?날짜|end ?date|departure/),
    nights: find(/^박 ?수?$|nights/),
    guest: find(/게스트|guest|투숙객|booked ?by/),
    listing: find(/숙소|listing|property/),
    code: find(/확인 ?코드|confirmation|예약 ?번호|book ?number|reservation ?(id|number)/),
    type: find(/^유형$|^type$/),
    status: find(/^상태$|^status$/),
  }
  // 금액 우선순위: 지급액(실수령) → 수익 → 금액 → 요금/총액
  const amountCols = [
    find(/지급액|paid ?out/),
    find(/수익|earnings/),
    find(/^금액$|^amount$/),
    find(/요금|price|총액|total/),
  ].filter((i) => i >= 0)

  if (col.checkIn < 0 || amountCols.length === 0) return []
  const isBooking =
    header.some((h) => /book ?number|commission|수수료율/.test(h)) &&
    !header.some((h) => /확인 ?코드|confirmation/.test(h))

  const out: ActualPayout[] = []
  for (const r of rows.slice(1)) {
    const get = (i: number) => (i >= 0 && i < r.length ? r[i].trim() : '')
    // 에어비앤비 거래내역: 지급/수수료/세금 행은 건너뛰고 예약 행만
    if (col.type >= 0) {
      const t = get(col.type)
      if (t && !/예약|reservation/i.test(t)) continue
    }
    if (col.status >= 0 && /cancel|취소|no.?show/i.test(get(col.status))) continue
    const checkIn = parseAnyDate(get(col.checkIn))
    let amount = 0
    for (const ai of amountCols) {
      amount = num(get(ai))
      if (amount > 0) break
    }
    if (!checkIn || amount <= 0) continue

    const co = parseAnyDate(get(col.checkOut))
    let nights = col.nights >= 0 ? Math.round(num(get(col.nights))) : 0
    if (!nights && co) nights = Math.round((Date.parse(co) - Date.parse(checkIn)) / 86400000)
    const code = get(col.code) || null
    out.push({
      id: code ?? `csv:${checkIn}:${amount}`,
      channel: isBooking ? 'booking' : 'airbnb',
      checkIn,
      nights: nights >= 1 && nights <= 90 ? nights : null,
      amount,
      guestName: get(col.guest) || null,
      listingName: get(col.listing) || null,
      confirmationCode: code,
      subject: `CSV 가져오기 (${filename})`,
      receivedAt,
    })
  }
  return out
}
