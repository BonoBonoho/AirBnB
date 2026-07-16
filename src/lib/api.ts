import type { Listing, Booking, PriceOverride } from '../types'
import type { AppConfig } from './config'
import { getIdToken } from './auth'

export interface RemoteState {
  listings: Listing[] | null
  overrides: PriceOverride[]
  bookings: Booking[]
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
  if (!res.ok) throw new Error(`API 오류 (${res.status})`)
  return res.json() as Promise<T>
}

export const api = {
  getState: (cfg: AppConfig) => request<RemoteState>(cfg, 'GET', '/api/state'),
  putState: (cfg: AppConfig, listings: Listing[], overrides: PriceOverride[]) =>
    request<{ ok: boolean }>(cfg, 'PUT', '/api/state', { listings, overrides }),
  sync: (cfg: AppConfig) => request<{ bookings: Booking[] }>(cfg, 'POST', '/api/sync'),
}
