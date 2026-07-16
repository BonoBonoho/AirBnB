import type { Listing, Booking, PriceOverride, ActualPayout, MarketData } from '../types'
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
    request<{ count: number; p25: number; median: number; p75: number }>(
      cfg, 'POST', '/api/market-scan', { region, checkin, checkout },
    ),
  putMarket: (cfg: AppConfig, region: string, data: MarketData) =>
    request<{ ok: boolean }>(cfg, 'PUT', '/api/market', { region, data }),
}
