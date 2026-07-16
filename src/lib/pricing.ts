import type { Listing, DayPrice, PriceOverride } from '../types'
import { holidayName } from '../data/holidays'
import { addDays, dayOfWeek, daysBetween, todayStr } from './date'

/** 결정적 의사난수 (같은 숙소·날짜면 항상 같은 수요 점수) */
function seededRandom(seed: string): number {
  let h = 1779033703
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** 수요 점수 0~100. 실제 서비스에서는 검색량·예약 페이스·경쟁 숙소 점유율로 산출한다. */
export function demandScore(listingId: string, date: string): number {
  const base = seededRandom(`${listingId}:${date}`) * 40 + 30 // 30~70
  const dow = dayOfWeek(date)
  const weekendBoost = dow === 5 || dow === 6 ? 15 : 0
  const holidayBoost = holidayName(date) ? 20 : 0
  return Math.min(100, Math.round(base + weekendBoost + holidayBoost))
}

function isPeakSeason(date: string): boolean {
  const month = Number(date.split('-')[1])
  const day = Number(date.split('-')[2])
  return month === 7 || month === 8 || (month === 12 && day >= 20)
}

/** 연휴 가운데 낀 평일(징검다리)도 프리미엄 대상으로 본다 */
function isBridgeDay(date: string): boolean {
  if (holidayName(date)) return false
  const dow = dayOfWeek(date)
  if (dow === 0 || dow === 6) return false
  return !!(holidayName(addDays(date, -1)) && holidayName(addDays(date, 1)))
}

export function computeDayPrice(
  listing: Listing,
  date: string,
  overrides: PriceOverride[],
  bookedDates: Set<string>,
): DayPrice {
  const isBooked = bookedDates.has(date)
  const override = overrides.find((o) => o.listingId === listing.id && o.date === date)
  if (override) {
    return { date, price: override.price, isOverride: true, isBooked, factors: ['수동 지정가'] }
  }

  const r = listing.rules
  let price = r.basePrice
  const factors: string[] = []

  const dow = dayOfWeek(date)
  if (dow === 5 || dow === 6) {
    price *= 1 + r.weekendUpliftPct / 100
    factors.push(`주말 할증 +${r.weekendUpliftPct}%`)
  }

  const hol = holidayName(date)
  if (hol) {
    price *= 1 + r.holidayUpliftPct / 100
    factors.push(`${hol} +${r.holidayUpliftPct}%`)
  } else if (isBridgeDay(date)) {
    price *= 1 + r.holidayUpliftPct / 200
    factors.push(`징검다리 연휴 +${Math.round(r.holidayUpliftPct / 2)}%`)
  }

  if (isPeakSeason(date)) {
    price *= 1 + r.peakSeasonUpliftPct / 100
    factors.push(`성수기 +${r.peakSeasonUpliftPct}%`)
  }

  // 수요 점수에 따라 ±10% 미세 조정
  const demand = demandScore(listing.id, date)
  const demandAdj = (demand - 50) / 5 // -4% ~ +10%
  price *= 1 + demandAdj / 100
  factors.push(`수요 점수 ${demand} (${demandAdj >= 0 ? '+' : ''}${demandAdj.toFixed(1)}%)`)

  // 임박 할인: 7일 이내 미예약 날짜
  const lead = daysBetween(todayStr(), date)
  if (!isBooked && lead >= 0 && lead <= 7 && r.lastMinuteDiscountPct > 0) {
    price *= 1 - r.lastMinuteDiscountPct / 100
    factors.push(`임박 할인 -${r.lastMinuteDiscountPct}%`)
  }

  price = Math.max(r.minPrice, Math.min(r.maxPrice, price))
  price = Math.round(price / 1000) * 1000 // 천원 단위 반올림

  return { date, price, isOverride: false, isBooked, factors }
}

export function computeMonthPrices(
  listing: Listing,
  year: number,
  month: number, // 1~12
  overrides: PriceOverride[],
  bookedDates: Set<string>,
): DayPrice[] {
  const daysInMonth = new Date(year, month, 0).getDate()
  const out: DayPrice[] = []
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    out.push(computeDayPrice(listing, dateStr, overrides, bookedDates))
  }
  return out
}
