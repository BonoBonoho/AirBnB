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
  guestNotes: Record<string, string>
}

export interface SmartDevice {
  provider: 'smartthings' | 'tuya' | 'hejhome'
  deviceId: string
  name: string
  caps: string[]
  room?: string
  model?: string
  /** 사용자가 지정한 별칭 */
  alias?: string
  /** 사용자가 지정한 공간/층 (거실·안방·2층 등) */
  zone?: string
  listingId?: string
}

export interface SmartDeviceStatus {
  deviceId: string
  provider: string
  online: boolean
  temperature?: number
  humidity?: number
  switch?: 'on' | 'off'
  coolingSetpoint?: number
  acMode?: string
  fanMode?: string
  power?: number
  energy?: number
}

/** 기기 사용 기록 — 일별 가동시간(분) + 최근 켬/끔 이벤트 */
export interface SmartLog {
  lastSample: Record<string, { sw?: string; ts: string }>
  days: Record<string, Record<string, number>>
  events: { ts: string; d: string; ev: string; by: 'user' | 'auto' | 'sample' }[]
}

export type SmartCommandName = 'on' | 'off' | 'setCoolingSetpoint' | 'setAcMode' | 'setFanMode'

export interface SmartHomeState {
  config: {
    smartthings?: { token?: string; oauth?: { expiresAt: number } }
    tuya?: { accessId: string; accessKey: string; region: 'us' | 'eu' | 'cn' | 'in' }
    hejhome?: { token?: string; creds?: { clientId: string }; oauth?: { expiresAt: number } }
  }
  devices: SmartDevice[]
  rules: Record<string, { preheat?: boolean; preheatMinutes?: number; targetTemp?: number; autoOff?: boolean }>
  /** 마지막으로 발견된 기기 목록 (새로고침 후에도 유지) */
  available?: SmartDevice[]
}

/** 공동 호스트 권한 (조회는 팀원 모두, 수정은 켜진 항목만) */
export interface CoPerms {
  pricing?: boolean
  channels?: boolean
  smart?: boolean
  guest?: boolean
}
export interface TeamMember {
  email: string
  perms: CoPerms
  invitedAt?: string
}
export interface Workspace {
  sub: string
  ownerEmail: string
  perms: CoPerms
}

/** 현재 선택된 워크스페이스 (null = 내 숙소). 요청마다 x-workspace 헤더로 전달 */
let workspaceSub: string | null = null
export function setApiWorkspace(sub: string | null) {
  workspaceSub = sub
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
      ...(workspaceSub ? { 'x-workspace': workspaceSub } : {}),
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
  getSmartHome: (cfg: AppConfig) =>
    request<SmartHomeState>(cfg, 'GET', '/api/smarthome'),
  putSmartHome: (cfg: AppConfig, patch: Partial<SmartHomeState>) =>
    request<{ ok: boolean }>(cfg, 'PUT', '/api/smarthome', patch),
  listSmartDevices: (cfg: AppConfig) =>
    request<{ devices: SmartDevice[]; errors: string[] }>(cfg, 'GET', '/api/smarthome/devices'),
  smartStatus: (cfg: AppConfig) =>
    request<{ statuses: SmartDeviceStatus[] }>(cfg, 'GET', '/api/smarthome/status'),
  smartCommand: (cfg: AppConfig, payload: { provider: string; deviceId: string; command: SmartCommandName; arg?: number | string }) =>
    request<{ ok: boolean }>(cfg, 'POST', '/api/smarthome/command', payload),
  smartHistory: (cfg: AppConfig) =>
    request<{ log: SmartLog }>(cfg, 'GET', '/api/smarthome/history'),
  getTeam: (cfg: AppConfig) =>
    request<{ members: TeamMember[] }>(cfg, 'GET', '/api/team'),
  putTeam: (cfg: AppConfig, members: TeamMember[]) =>
    request<{ ok: boolean }>(cfg, 'PUT', '/api/team', { members }),
  getWorkspaces: (cfg: AppConfig) =>
    request<{ workspaces: Workspace[] }>(cfg, 'GET', '/api/workspaces'),
  mailBackfill: (cfg: AppConfig, payload: { provider: 'gmail' | 'naver'; email: string; appPassword: string; reset?: boolean }) =>
    request<{ ok: boolean }>(cfg, 'POST', '/api/mail-backfill', payload),
  putGuestNote: (cfg: AppConfig, bookingId: string, note: string) =>
    request<{ ok: boolean }>(cfg, 'PUT', '/api/guest-notes', { bookingId, note }),
  stOauthUrl: (cfg: AppConfig) =>
    request<{ url: string; redirectUri: string }>(cfg, 'POST', '/api/smarthome/st-oauth-url'),
  hejhomeLogin: (
    cfg: AppConfig,
    payload: { clientId: string; clientSecret: string; appKey: string; username: string; password: string },
  ) => request<{ ok: boolean; expiresAt: number }>(cfg, 'POST', '/api/smarthome/hejhome-login', payload),
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
