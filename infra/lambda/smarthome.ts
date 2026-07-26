/** 스마트홈 드라이버 — 삼성 스마트싱스(공식 API) + Tuya OpenAPI + 헤이홈(고퀄) */
import { createHmac, createCipheriv } from 'node:crypto'

export interface SmartDevice {
  provider: 'smartthings' | 'tuya' | 'hejhome'
  deviceId: string
  name: string
  /** 감지된 기능: temp/humidity/switch/ac */
  caps: string[]
  /** 스마트싱스 앱에서 지정한 방 이름 (같은 이름 기기 구분용) */
  room?: string
  /** 모델명/카테고리 */
  model?: string
  /** 사용자가 지정한 별칭 (기기 원래 이름 대신 표시) */
  alias?: string
  /** 사용자가 지정한 공간/층 (숙소 안 레이아웃 구분: 거실·안방·2층 등) */
  zone?: string
}

export interface DeviceStatus {
  deviceId: string
  online: boolean
  temperature?: number
  humidity?: number
  switch?: 'on' | 'off'
  coolingSetpoint?: number
  /** 에어컨 운전 모드 (cool/dry/wind/auto/heat) */
  acMode?: string
  /** 팬 세기 (auto/low/medium/high) */
  fanMode?: string
  /** 현재 소비전력 (W) — 지원 기기만 */
  power?: number
  /** 누적 사용량 (kWh) — 전력측정 플러그 등 */
  energy?: number
}

/** OAuth 토큰 묶음 — 액세스 토큰은 24시간, 리프레시 토큰으로 자동 갱신 */
export interface StOauth {
  accessToken: string
  refreshToken: string
  /** epoch ms */
  expiresAt: number
}

/** 헤이홈 오픈API 인증정보 — 사용신청 후 고퀄이 메일로 발급 */
export interface HejCreds {
  clientId: string
  clientSecret: string
  appKey: string
}

export interface SmartHomeConfig {
  smartthings?: { token?: string; oauth?: StOauth }
  tuya?: { accessId: string; accessKey: string; region: 'us' | 'eu' | 'cn' | 'in' }
  hejhome?: { token?: string; creds?: HejCreds; oauth?: StOauth }
}

/** 기기 사용 기록 — 15분 샘플링 기반 가동시간 + 켬/끔 이벤트 (DynamoDB 400KB 제한 때문에 집계형) */
export interface SmartLog {
  /** deviceId → 마지막 샘플 (가동시간 적산용) */
  lastSample: Record<string, { sw?: string; ts: string }>
  /** YYYY-MM-DD → deviceId → 켜져 있던 분(min) */
  days: Record<string, Record<string, number>>
  /** 최근 이벤트: 켬/끔/온도설정 등 */
  events: { ts: string; d: string; ev: string; by: 'user' | 'auto' | 'sample' }[]
}

const ST = 'https://api.smartthings.com/v1'
export const ST_SCOPES = 'r:devices:* x:devices:* r:locations:*'

// ─── SmartThings ───────────────────────────────────────────────

async function stFetch(token: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${ST}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`스마트싱스 API 오류 (${res.status})`)
  return res.json()
}

// ─── SmartThings OAuth (액세스 토큰 자동 갱신) ─────────────────

export function stAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: ST_SCOPES,
    state,
  })
  return `https://api.smartthings.com/oauth/authorize?${q.toString()}`
}

async function stTokenRequest(
  clientId: string, clientSecret: string, params: Record<string, string>,
): Promise<StOauth> {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const body = new URLSearchParams({ client_id: clientId, ...params }).toString()
  let lastErr = ''
  // 토큰 엔드포인트가 auth-global로 이전됨 — 구 엔드포인트도 폴백으로 시도
  for (const host of ['https://auth-global.api.smartthings.com', 'https://api.smartthings.com']) {
    try {
      const res = await fetch(`${host}/oauth/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: AbortSignal.timeout(10000),
      })
      const data = (await res.json()) as {
        access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string
      }
      if (!res.ok || !data.access_token) {
        lastErr = `${res.status} ${data.error_description ?? data.error ?? ''}`.trim()
        continue
      }
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? params.refresh_token ?? '',
        expiresAt: Date.now() + (data.expires_in ?? 86400) * 1000,
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
    }
  }
  throw new Error(`스마트싱스 토큰 발급 실패: ${lastErr}`)
}

export function stExchangeCode(
  clientId: string, clientSecret: string, code: string, redirectUri: string,
): Promise<StOauth> {
  return stTokenRequest(clientId, clientSecret, {
    grant_type: 'authorization_code', code, redirect_uri: redirectUri,
  })
}

export function stRefresh(clientId: string, clientSecret: string, refreshToken: string): Promise<StOauth> {
  return stTokenRequest(clientId, clientSecret, { grant_type: 'refresh_token', refresh_token: refreshToken })
}

/**
 * 사용할 스마트싱스 토큰 결정. OAuth 연동이면 만료 30분 전에 자동 갱신하고
 * persist 콜백으로 새 토큰을 저장한다(리프레시 토큰은 사용 시 회전됨). 없으면 PAT 폴백.
 */
export async function resolveStToken(
  st: SmartHomeConfig['smartthings'],
  clientId: string | undefined,
  clientSecret: string | undefined,
  persist: (oauth: StOauth) => Promise<void>,
): Promise<string | null> {
  if (!st) return null
  if (st.oauth) {
    if (st.oauth.expiresAt - Date.now() > 30 * 60 * 1000) return st.oauth.accessToken
    if (clientId && clientSecret) {
      const next = await stRefresh(clientId, clientSecret, st.oauth.refreshToken)
      await persist(next)
      return next.accessToken
    }
    return st.oauth.accessToken // 갱신 불가 — 만료 임박 토큰이라도 시도
  }
  return st.token ?? null
}

export async function stListDevices(token: string): Promise<SmartDevice[]> {
  const data = (await stFetch(token, '/devices')) as {
    items: {
      deviceId: string; label?: string; name: string
      roomId?: string; locationId?: string
      deviceManufacturerCode?: string
      ocf?: { modelNumber?: string }
      components?: { capabilities: { id: string }[] }[]
    }[]
  }
  const items = data.items ?? []

  // 방 이름 조회 — 같은 이름 기기(에어컨 여러 대) 구분용
  const roomNames = new Map<string, string>()
  const locationIds = [...new Set(items.map((d) => d.locationId).filter((x): x is string => !!x))]
  for (const loc of locationIds) {
    try {
      const rooms = (await stFetch(token, `/locations/${loc}/rooms`)) as {
        items?: { roomId: string; name: string }[]
      }
      for (const r of rooms.items ?? []) roomNames.set(r.roomId, r.name)
    } catch {
      // 방 조회 실패해도 기기 목록은 반환
    }
  }

  return items.map((d) => {
    const capIds = (d.components ?? []).flatMap((c) => c.capabilities.map((x) => x.id))
    const caps: string[] = []
    if (capIds.includes('temperatureMeasurement')) caps.push('temp')
    if (capIds.includes('relativeHumidityMeasurement')) caps.push('humidity')
    if (capIds.includes('switch')) caps.push('switch')
    if (capIds.includes('thermostatCoolingSetpoint') || capIds.includes('airConditionerMode')) caps.push('ac')
    const model = d.ocf?.modelNumber?.split('|')[0] || undefined
    return {
      provider: 'smartthings' as const,
      deviceId: d.deviceId,
      name: d.label || d.name,
      caps,
      room: d.roomId ? roomNames.get(d.roomId) : undefined,
      model,
    }
  })
}

export async function stStatus(token: string, deviceId: string): Promise<DeviceStatus> {
  const s = (await stFetch(token, `/devices/${deviceId}/status`)) as {
    components?: { main?: Record<string, Record<string, { value: unknown }>> }
  }
  const main = s.components?.main ?? {}
  const powerRaw = main.powerConsumptionReport?.powerConsumption?.value as
    | { power?: unknown }
    | undefined
  return {
    deviceId,
    online: true,
    temperature: numOrU(main.temperatureMeasurement?.temperature?.value),
    humidity: numOrU(main.relativeHumidityMeasurement?.humidity?.value),
    switch: main.switch?.switch?.value === 'on' ? 'on' : main.switch?.switch?.value === 'off' ? 'off' : undefined,
    coolingSetpoint: numOrU(main.thermostatCoolingSetpoint?.coolingSetpoint?.value),
    acMode: typeof main.airConditionerMode?.airConditionerMode?.value === 'string'
      ? main.airConditionerMode.airConditionerMode.value : undefined,
    fanMode: typeof main.airConditionerFanMode?.fanMode?.value === 'string'
      ? main.airConditionerFanMode.fanMode.value : undefined,
    // 삼성 가전은 powerConsumptionReport, Matter 플러그(Tapo 등)는 powerMeter/energyMeter로 옴
    power: (powerRaw && typeof powerRaw === 'object' ? numOrU(powerRaw.power) : undefined)
      ?? numOrU(main.powerMeter?.power?.value),
    energy: numOrU(main.energyMeter?.energy?.value),
  }
}

export type StCommandName = 'on' | 'off' | 'setCoolingSetpoint' | 'setAcMode' | 'setFanMode'

export async function stCommand(
  token: string, deviceId: string, command: StCommandName, arg?: number | string,
): Promise<void> {
  const cmd =
    command === 'setCoolingSetpoint'
      ? { component: 'main', capability: 'thermostatCoolingSetpoint', command: 'setCoolingSetpoint', arguments: [Number(arg ?? 24)] }
      : command === 'setAcMode'
        ? { component: 'main', capability: 'airConditionerMode', command: 'setAirConditionerMode', arguments: [String(arg ?? 'cool')] }
        : command === 'setFanMode'
          ? { component: 'main', capability: 'airConditionerFanMode', command: 'setFanMode', arguments: [String(arg ?? 'auto')] }
          : { component: 'main', capability: 'switch', command }
  await stFetch(token, `/devices/${deviceId}/commands`, {
    method: 'POST',
    body: JSON.stringify({ commands: [cmd] }),
  })
}

// ─── Tuya OpenAPI (HMAC-SHA256 서명) ───────────────────────────

const TUYA_HOSTS = {
  us: 'https://openapi.tuyaus.com',
  eu: 'https://openapi.tuyaeu.com',
  cn: 'https://openapi.tuyacn.com',
  in: 'https://openapi.tuyain.com',
}

function tuyaSign(accessKey: string, str: string): string {
  return createHmac('sha256', accessKey).update(str, 'utf8').digest('hex').toUpperCase()
}

export async function tuyaRequest(
  cfg: NonNullable<SmartHomeConfig['tuya']>,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  token?: string,
): Promise<unknown> {
  const host = TUYA_HOSTS[cfg.region] ?? TUYA_HOSTS.us
  const t = String(Date.now())
  const bodyStr = body ? JSON.stringify(body) : ''
  const contentHash = createHmac('sha256', '').update('').digest('hex') // placeholder, 아래에서 교체
  // Tuya 규격: SHA256(body) 필요 — HMAC이 아니라 일반 SHA256
  const { createHash } = await import('node:crypto')
  const bodySha = createHash('sha256').update(bodyStr, 'utf8').digest('hex')
  void contentHash
  const stringToSign = [method, bodySha, '', path].join('\n')
  const signStr = token ? cfg.accessId + token + t + stringToSign : cfg.accessId + t + stringToSign
  const headers: Record<string, string> = {
    client_id: cfg.accessId,
    sign: tuyaSign(cfg.accessKey, signStr),
    t,
    sign_method: 'HMAC-SHA256',
    'Content-Type': 'application/json',
  }
  if (token) headers.access_token = token
  const res = await fetch(`${host}${path}`, {
    method,
    headers,
    body: bodyStr || undefined,
    signal: AbortSignal.timeout(10000),
  })
  const data = (await res.json()) as { success: boolean; msg?: string; result?: unknown }
  if (!data.success) throw new Error(`Tuya API 오류: ${data.msg ?? 'unknown'}`)
  return data.result
}

export async function tuyaToken(cfg: NonNullable<SmartHomeConfig['tuya']>): Promise<string> {
  const r = (await tuyaRequest(cfg, 'GET', '/v1.0/token?grant_type=1')) as { access_token: string }
  return r.access_token
}

export async function tuyaListDevices(cfg: NonNullable<SmartHomeConfig['tuya']>): Promise<SmartDevice[]> {
  const token = await tuyaToken(cfg)
  const r = (await tuyaRequest(cfg, 'GET', '/v1.0/iot-01/associated-users/devices?size=50', undefined, token)) as {
    devices?: { id: string; name: string; category: string; status?: { code: string }[] }[]
  }
  return (r.devices ?? []).map((d) => {
    const codes = (d.status ?? []).map((s) => s.code)
    const caps: string[] = []
    if (codes.some((c) => /temp_current|va_temperature/.test(c))) caps.push('temp')
    if (codes.some((c) => /humidity/.test(c))) caps.push('humidity')
    if (codes.some((c) => /^switch(_1)?$|switch_led/.test(c))) caps.push('switch')
    return { provider: 'tuya' as const, deviceId: d.id, name: d.name, caps, model: d.category }
  })
}

export async function tuyaStatus(
  cfg: NonNullable<SmartHomeConfig['tuya']>, deviceId: string,
): Promise<DeviceStatus> {
  const token = await tuyaToken(cfg)
  const r = (await tuyaRequest(cfg, 'GET', `/v1.0/devices/${deviceId}/status`, undefined, token)) as {
    code: string; value: unknown
  }[] | { code: string; value: unknown }[]
  const arr = Array.isArray(r) ? r : []
  const find = (re: RegExp) => arr.find((s) => re.test(s.code))?.value
  const tempRaw = numOrU(find(/temp_current|va_temperature/))
  const sw = find(/^switch(_1)?$|switch_led/)
  // 전력측정 플러그: cur_power/va_power는 0.1W 단위 (982 = 98.2W)
  const powerRaw = numOrU(find(/^cur_power$|^va_power$/))
  return {
    deviceId,
    online: true,
    // Tuya 온도는 종종 10배 스케일 (245 = 24.5도)
    temperature: tempRaw !== undefined && Math.abs(tempRaw) > 60 ? tempRaw / 10 : tempRaw,
    humidity: numOrU(find(/humidity/)),
    switch: sw === true ? 'on' : sw === false ? 'off' : undefined,
    power: powerRaw !== undefined ? powerRaw / 10 : undefined,
  }
}

export async function tuyaCommand(
  cfg: NonNullable<SmartHomeConfig['tuya']>, deviceId: string, command: 'on' | 'off',
): Promise<void> {
  const token = await tuyaToken(cfg)
  await tuyaRequest(cfg, 'POST', `/v1.0/devices/${deviceId}/commands`, {
    commands: [{ code: 'switch_1', value: command === 'on' }],
  }, token).catch(async () => {
    // switch_1이 없는 기기(전구 등)는 switch/switch_led로 재시도
    await tuyaRequest(cfg, 'POST', `/v1.0/devices/${deviceId}/commands`, {
      commands: [{ code: 'switch', value: command === 'on' }],
    }, token)
  })
}

// ─── 헤이홈(고퀄) 오픈API ──────────────────────────────────────
// 문서: goqual.notion.site (헤이홈 OpenAPI) — Bearer 토큰 인증.
// 토큰 발급은 client_id/secret/appKey(사용신청 후 메일 발급)로
// 로그인 정보를 AES-256-CBC(appKey 앞 32자=키, 앞 16자=IV)로 암호화해
// POST /openapi/token 에 보내는 방식. control 바디의 "requirments"는
// 헤이홈 API 자체의 철자이므로 고치면 안 된다.

const HEJ = 'https://goqual.io/openapi'

function hejEncrypt(appKey: string, payload: unknown): string {
  const cipher = createCipheriv(
    'aes-256-cbc',
    Buffer.from(appKey.slice(0, 32), 'utf8'),
    Buffer.from(appKey.slice(0, 16), 'utf8'),
  )
  const enc = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  // 파이썬 urlsafe_b64encode와 동일: +/ → -_, 패딩(=) 유지
  return enc.toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
}

async function hejTokenRequest(
  creds: HejCreds, path: '/token' | '/token/refresh', payload: Record<string, string>,
): Promise<StOauth> {
  if (creds.appKey.length < 32) throw new Error('헤이홈 App Key가 올바르지 않습니다 (32자 이상이어야 합니다)')
  const data = hejEncrypt(creds.appKey, {
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    ...payload,
  })
  const res = await fetch(`${HEJ}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
    signal: AbortSignal.timeout(10000),
  })
  const text = await res.text()
  let parsed: { access_token?: string; refresh_token?: string; expires_in?: number } = {}
  try { parsed = JSON.parse(text) } catch { /* 아래에서 오류 처리 */ }
  if (!res.ok || !parsed.access_token) {
    throw new Error(`헤이홈 토큰 발급 실패 (${res.status}) — 인증정보와 헤이홈 계정을 확인해 주세요`)
  }
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token ?? payload.refresh_token ?? '',
    expiresAt: Date.now() + (parsed.expires_in ?? 86400) * 1000,
  }
}

/** 헤이홈 계정 로그인으로 토큰 발급 — 비밀번호는 이 요청에만 쓰이고 저장하지 않는다 */
export function hejLogin(creds: HejCreds, username: string, password: string): Promise<StOauth> {
  return hejTokenRequest(creds, '/token', { grant_type: 'password', username, password })
}

export function hejRefresh(creds: HejCreds, refreshToken: string): Promise<StOauth> {
  return hejTokenRequest(creds, '/token/refresh', { grant_type: 'refresh_token', refresh_token: refreshToken })
}

/** 사용할 헤이홈 토큰 결정 — 만료 30분 전 자동 갱신 후 persist로 저장. 수동 토큰 폴백 */
export async function resolveHejToken(
  hej: SmartHomeConfig['hejhome'],
  persist: (oauth: StOauth) => Promise<void>,
): Promise<string | null> {
  if (!hej) return null
  if (hej.oauth) {
    if (hej.oauth.expiresAt - Date.now() > 30 * 60 * 1000) return hej.oauth.accessToken
    if (hej.creds && hej.oauth.refreshToken) {
      const next = await hejRefresh(hej.creds, hej.oauth.refreshToken)
      await persist(next)
      return next.accessToken
    }
    return hej.oauth.accessToken // 갱신 불가 — 만료 임박 토큰이라도 시도
  }
  return hej.token ?? null
}

async function hejFetch(token: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${HEJ}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`헤이홈 API 오류 (${res.status})`)
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function hejCaps(deviceType: string): string[] {
  const t = deviceType.toLowerCase()
  const caps: string[] = []
  if (/th|temp|hum|sensor/.test(t)) {
    caps.push('temp', 'humidity')
  }
  if (/plug|outlet|switch|light|lamp|bulb|curtain|boiler/.test(t)) caps.push('switch')
  if (/aircon|air_?con/.test(t)) caps.push('switch', 'ac')
  return caps
}

export async function hejListDevices(token: string): Promise<SmartDevice[]> {
  const r = (await hejFetch(token, '/devices')) as
    | { id: string | number; name?: string; deviceType?: string; modelName?: string; roomName?: string }[]
    | null
  if (!Array.isArray(r)) return []
  return r.map((d) => ({
    provider: 'hejhome' as const,
    deviceId: String(d.id),
    name: d.name || d.deviceType || String(d.id),
    caps: hejCaps(String(d.deviceType ?? '')),
    room: d.roomName || undefined,
    model: d.modelName || d.deviceType || undefined,
  }))
}

export async function hejStatus(token: string, deviceId: string): Promise<DeviceStatus> {
  const r = (await hejFetch(token, `/device/${encodeURIComponent(deviceId)}`)) as
    | { deviceState?: Record<string, unknown> }
    | { deviceState?: Record<string, unknown> }[]
    | null
  const state = (Array.isArray(r) ? r[0]?.deviceState : r?.deviceState) ?? {}
  const power = state.power ?? state.power1 ?? state.switch
  const tempRaw = numOrU(state.temperature ?? state.curTemp)
  return {
    deviceId,
    online: true,
    // 일부 센서는 10배 스케일(274 = 27.4도)로 보고한다
    temperature: tempRaw !== undefined && Math.abs(tempRaw) > 60 ? tempRaw / 10 : tempRaw,
    humidity: numOrU(state.humidity),
    switch: power === true || power === 'true' ? 'on' : power === false || power === 'false' ? 'off' : undefined,
    power: numOrU(state.curPower ?? state.powerConsumption),
  }
}

export async function hejCommand(token: string, deviceId: string, command: 'on' | 'off'): Promise<void> {
  await hejFetch(token, `/control/${encodeURIComponent(deviceId)}`, {
    method: 'POST',
    body: JSON.stringify({ requirments: { power: command === 'on' } }),
  })
}

function numOrU(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}
