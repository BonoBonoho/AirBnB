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
  /** 에어비앤비 링크로 불러온 경우의 숙소 사진 URL */
  photoUrl?: string
  /** 에어비앤비 room ID (링크로 불러온 경우) */
  airbnbRoomId?: string
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
