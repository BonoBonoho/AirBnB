export type ChannelId = 'airbnb' | 'yanolja' | 'goodchoice' | 'booking'

export interface PricingRules {
  basePrice: number // 1박 기본가 (원)
  minPrice: number
  maxPrice: number
  weekendUpliftPct: number // 금·토 할증 %
  holidayUpliftPct: number // 공휴일·연휴 할증 %
  peakSeasonUpliftPct: number // 성수기(7~8월, 12월 말) 할증 %
  lastMinuteDiscountPct: number // 임박 할인 % (7일 이내 빈 날짜)
  longStayDiscountPct: number // 연박(7박+) 할인 %
  earlyBirdDiscountPct: number // 조기 예약(90일+) 할인 %
}

export interface Listing {
  id: string
  name: string
  region: string // 예: 서울 마포구
  type: string // 예: 아파트 전체
  bedrooms: number
  maxGuests: number
  thumbnail: string // 이모지
  channels: ChannelId[]
  rules: PricingRules
  active: boolean
  /** 에어비앤비 캘린더 내보내기(iCal) URL — 설정 시 실제 예약이 동기화된다 */
  icalUrl?: string
  /** 부킹닷컴 캘린더 내보내기(iCal) URL */
  bookingIcalUrl?: string
  /** 에어비앤비 링크로 불러온 경우의 숙소 사진 URL */
  photoUrl?: string
  /** 에어비앤비 room ID (링크로 불러온 경우) */
  airbnbRoomId?: string
  /** 스마트 도어락 연결 설정 */
  doorLock?: DoorLock
}

export interface DoorLock {
  provider: 'mock' | 'tuya' | 'ttlock'
  /** 도어락 기기 ID (실제 연동 시 사용, 목업은 비움) */
  deviceId?: string
}

/** 시장 스캔 결과 — 특정 체크인 날짜의 경쟁 숙소 가격 분포 */
export interface MarketPoint {
  date: string // 체크인 YYYY-MM-DD
  count: number
  p25: number
  median: number
  p75: number
  p90?: number
}

export interface MarketData {
  scannedAt: string
  points: MarketPoint[]
  /** 검색에서 잡힌 경쟁 숙소 (best-effort) */
  competitors?: { id: string; name?: string }[]
}

/** 게스트 문열기 기록 */
export interface DoorLogEntry {
  listingId: string
  bookingId: string
  guestName: string
  at: string // ISO
  result: 'success' | 'expired' | 'error'
}

export interface Booking {
  id: string
  listingId: string
  guestName: string
  channel: ChannelId
  checkIn: string // YYYY-MM-DD
  nights: number
  totalPrice: number
  status: 'confirmed' | 'pending' | 'cancelled'
  /** 'ical' = 에어비앤비 캘린더에서 동기화된 실제 예약 */
  source?: 'ical' | 'mock'
  /** true = 정산 메일에서 가져온 실제 금액이 반영됨 */
  actual?: boolean
}

/** 정산 메일에서 파싱한 실제 정산 내역 */
export interface ActualPayout {
  id: string
  channel?: 'airbnb' | 'booking'
  checkIn: string | null
  nights?: number | null
  amount: number
  guestName: string | null
  listingName: string | null
  confirmationCode: string | null
  subject: string
  receivedAt: string
}

export interface PriceOverride {
  listingId: string
  date: string // YYYY-MM-DD
  price: number
}

export interface DayPrice {
  date: string
  price: number
  isOverride: boolean
  isBooked: boolean
  factors: string[] // 적용된 규칙 설명 (한국어)
}
