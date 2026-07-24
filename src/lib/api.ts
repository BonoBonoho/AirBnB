import type { Listing, Booking, PriceOverride, ActualPayout, MarketData, FormQuestion, FormResponse, Inquiry } from '../types'
import type { AppConfig } from './config'
import { getIdToken } from './auth'

export interface VerificationMail {
  subject: string
  snippet: string
  receivedAt: string
}

export interface RemoteState {
  listings: Listing[] | null
  overrides: PriceOverride[]
  bookings: Booking[]
  actuals: ActualPayout[]
  inboundKey: string | null
  verification: VerificationMail | null
  market: Record<string, MarketData>
  formQuestions: FormQuestion[] | null
  formResponses: Record<string, FormResponse>
  formLinks: Record<string, string>
  inquiries: Inquiry[]
}

export interface PublicFormData {
  questions: FormQuestion[] | null
  meta: { guestName: string; listingName: string; checkIn: string; nights: number }
  submitted: boolean
}

/** 공개 설문 API — 로그인 불필요 (게스트용) */
export const publicApi = {
  getForm: async (apiUrl: string, token: string): Promise<PublicFormData> => {
    const res = await fetch(`${apiUrl}/public/form/${encodeURIComponent(token)}`)
    if (!res.ok) throw new Error(res.status === 404 ? '유효하지 않은 링크입니다' : `오류 (${res.status})`)
    return res.json() as Promise<PublicFormData>
  },
  submitForm: async (apiUrl: string, token: string, guestName: string, answers: Record<string, string>) => {
    const res = await fetch(`${apiUrl}/public/form/${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guestName, answers }),
    })
    if (!res.ok) throw new Error(`제출 실패 (${res.status})`)
    return res.json() as Promise<{ ok: boolean }>
  },
}

async function request<T>(cfg: AppConfig, method: string, path: string, body?: unknown): Promise<T> {
  const token = await getIdToken()
  if (!token) throw new Error('로그인이 필요합니다')
  const res = await fetch(`${cfg.apiUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let msg = `API 오류 (${res.status})`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) msg = body.error
    } catch {
      // 본문이 JSON이 아니면 기본 메시지 유지
    }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

export interface ImportedListing {
  airbnbRoomId: string
  name: string | null
  bedrooms: number | null
  maxGuests: number | null
  photoUrl: string | null
  type: string | null
}

export const api = {
  getState: (cfg: AppConfig) => request<RemoteState>(cfg, 'GET', '/api/state'),
  putState: (cfg: AppConfig, listings: Listing[], overrides: PriceOverride[]) =>
    request<{ ok: boolean }>(cfg, 'PUT', '/api/state', { listings, overrides }),
  sync: (cfg: AppConfig) => request<{ bookings: Booking[] }>(cfg, 'POST', '/api/sync'),
  importAirbnb: (cfg: AppConfig, url: string) =>
    request<ImportedListing>(cfg, 'POST', '/api/import', { url }),
  requestInboundAddress: (cfg: AppConfig) =>
    request<{ inboundKey: string }>(cfg, 'POST', '/api/inbound-address'),
  marketScan: (cfg: AppConfig, region: string, checkin: string, checkout: string) =>
    request<{
      count: number; p25: number; median: number; p75: number; p90: number
      listings: { id: string; name?: string }[]
    }>(cfg, 'POST', '/api/market-scan', { region, checkin, checkout }),
  putMarket: (cfg: AppConfig, region: string, data: MarketData) =>
    request<{ ok: boolean }>(cfg, 'PUT', '/api/market', { region, data }),
  putFormQuestions: (cfg: AppConfig, questions: FormQuestion[]) =>
    request<{ ok: boolean }>(cfg, 'PUT', '/api/form-questions', { questions }),
  createFormLink: (
    cfg: AppConfig,
    payload: { bookingId: string; guestName: string; listingName: string; checkIn: string; nights: number },
  ) => request<{ token: string }>(cfg, 'POST', '/api/form-link', payload),
  publishPage: (
    cfg: AppConfig,
    payload: {
      listingId: string
      slug: string
      page: {
        name: string; region: string; type: string; bedrooms: number; maxGuests: number
        description: string; photoUrl?: string; kakaoUrl?: string; phone?: string
        airbnbUrl?: string; minPriceText?: string
      }
    },
  ) => request<{ url: string }>(cfg, 'POST', '/api/publish-page', payload),
}
