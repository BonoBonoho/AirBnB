import type { Listing, Booking, ChannelId } from '../types'
import { addDays, todayStr, dayOfWeek } from '../lib/date'
import { demandScore } from '../lib/pricing'

export const CHANNEL_INFO: Record<ChannelId, { name: string; color: string; feePct: number }> = {
  airbnb: { name: '에어비앤비', color: '#FF5A5F', feePct: 3 },
  yanolja: { name: '야놀자', color: '#F43099', feePct: 10 },
  goodchoice: { name: '여기어때', color: '#0D57FF', feePct: 10 },
  booking: { name: 'Booking.com', color: '#003580', feePct: 15 },
}

export const DEFAULT_LISTINGS: Listing[] = [
  {
    id: 'lst-hongdae',
    name: '홍대 감성 스테이',
    region: '서울 마포구',
    type: '아파트 전체',
    bedrooms: 2,
    maxGuests: 4,
    thumbnail: '🏙️',
    channels: ['airbnb', 'yanolja'],
    active: true,
    rules: {
      basePrice: 120000,
      minPrice: 80000,
      maxPrice: 350000,
      weekendUpliftPct: 25,
      holidayUpliftPct: 40,
      peakSeasonUpliftPct: 20,
      lastMinuteDiscountPct: 15,
      longStayDiscountPct: 10,
      earlyBirdDiscountPct: 5,
    },
  },
  {
    id: 'lst-jeju',
    name: '제주 오션뷰 독채',
    region: '제주 애월읍',
    type: '독채 펜션',
    bedrooms: 3,
    maxGuests: 6,
    thumbnail: '🌊',
    channels: ['airbnb', 'goodchoice', 'booking'],
    active: true,
    rules: {
      basePrice: 250000,
      minPrice: 150000,
      maxPrice: 600000,
      weekendUpliftPct: 30,
      holidayUpliftPct: 50,
      peakSeasonUpliftPct: 35,
      lastMinuteDiscountPct: 20,
      longStayDiscountPct: 12,
      earlyBirdDiscountPct: 7,
    },
  },
  {
    id: 'lst-gangneung',
    name: '강릉 바다뷰 아파트',
    region: '강원 강릉시',
    type: '아파트 전체',
    bedrooms: 1,
    maxGuests: 2,
    thumbnail: '🏖️',
    channels: ['airbnb'],
    active: true,
    rules: {
      basePrice: 90000,
      minPrice: 60000,
      maxPrice: 250000,
      weekendUpliftPct: 35,
      holidayUpliftPct: 45,
      peakSeasonUpliftPct: 40,
      lastMinuteDiscountPct: 10,
      longStayDiscountPct: 8,
      earlyBirdDiscountPct: 5,
    },
  },
  {
    id: 'lst-busan',
    name: '해운대 시티뷰 오피스텔',
    region: '부산 해운대구',
    type: '오피스텔 전체',
    bedrooms: 1,
    maxGuests: 3,
    thumbnail: '🌉',
    channels: ['airbnb', 'yanolja', 'goodchoice'],
    active: false,
    rules: {
      basePrice: 100000,
      minPrice: 70000,
      maxPrice: 280000,
      weekendUpliftPct: 20,
      holidayUpliftPct: 35,
      peakSeasonUpliftPct: 25,
      lastMinuteDiscountPct: 15,
      longStayDiscountPct: 10,
      earlyBirdDiscountPct: 5,
    },
  },
]

const GUEST_NAMES = [
  '김민준', '이서연', '박도윤', '최지우', '정하은', '강시우', 'Sarah M.', 'Kenji T.',
  '윤지호', '임수아', '한예준', 'Emma L.', '오하린', '신준서', 'Wei C.', '송아윤',
]

/** 결정적으로 예약 목업 생성 — 지난 60일 + 향후 90일 */
export function generateBookings(listings: Listing[]): Booking[] {
  const bookings: Booking[] = []
  const today = todayStr()
  let seq = 0
  for (const listing of listings) {
    if (!listing.active) continue
    let cursor = addDays(today, -60)
    const end = addDays(today, 90)
    while (cursor < end) {
      const demand = demandScore(listing.id, cursor)
      // 수요가 높을수록 예약 확률이 높다 (결정적)
      if (demand > 58) {
        const nights = 1 + (demand % 3)
        const channel = listing.channels[seq % listing.channels.length]
        const dow = dayOfWeek(cursor)
        const nightly =
          listing.rules.basePrice *
          (dow === 5 || dow === 6 ? 1 + listing.rules.weekendUpliftPct / 100 : 1)
        bookings.push({
          id: `bk-${listing.id}-${seq}`,
          listingId: listing.id,
          guestName: GUEST_NAMES[(seq * 7 + demand) % GUEST_NAMES.length],
          channel,
          checkIn: cursor,
          nights,
          totalPrice: Math.round((nightly * nights) / 1000) * 1000,
          status: demand > 90 && cursor > today ? 'pending' : 'confirmed',
        })
        seq++
        cursor = addDays(cursor, nights + 1)
      } else {
        cursor = addDays(cursor, 1)
      }
    }
  }
  return bookings
}

export function bookedDateSet(bookings: Booking[], listingId: string): Set<string> {
  const set = new Set<string>()
  for (const b of bookings) {
    if (b.listingId !== listingId || b.status === 'cancelled') continue
    for (let i = 0; i < b.nights; i++) set.add(addDays(b.checkIn, i))
  }
  return set
}

/** 시장(경쟁 숙소) 목업 데이터 — 지역별 평균가·점유율 */
export const MARKET_DATA: Record<
  string,
  { avgPrice: number; occupancyPct: number; competitorCount: number; trend: number[] }
> = {
  '서울 마포구': { avgPrice: 135000, occupancyPct: 78, competitorCount: 342, trend: [72, 74, 71, 76, 78, 80, 78] },
  '제주 애월읍': { avgPrice: 280000, occupancyPct: 65, competitorCount: 187, trend: [58, 60, 63, 61, 64, 66, 65] },
  '강원 강릉시': { avgPrice: 110000, occupancyPct: 70, competitorCount: 256, trend: [62, 65, 68, 72, 71, 69, 70] },
  '부산 해운대구': { avgPrice: 125000, occupancyPct: 74, competitorCount: 411, trend: [70, 71, 73, 75, 72, 74, 74] },
}
