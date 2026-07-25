/** 스마트홈 드라이버 — 삼성 스마트싱스(공식 API) + Tuya OpenAPI */
import { createHmac } from 'node:crypto'

export interface SmartDevice {
  provider: 'smartthings' | 'tuya'
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
}

export interface SmartHomeConfig {
  smartthings?: { token: string }
  tuya?: { accessId: string; accessKey: string; region: 'us' | 'eu' | 'cn' | 'in' }
}

const ST = 'https://api.smartthings.com/v1'

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
  return {
    deviceId,
    online: true,
    temperature: numOrU(main.temperatureMeasurement?.temperature?.value),
    humidity: numOrU(main.relativeHumidityMeasurement?.humidity?.value),
    switch: main.switch?.switch?.value === 'on' ? 'on' : main.switch?.switch?.value === 'off' ? 'off' : undefined,
    coolingSetpoint: numOrU(main.thermostatCoolingSetpoint?.coolingSetpoint?.value),
  }
}

export async function stCommand(
  token: string, deviceId: string, command: 'on' | 'off' | 'setCoolingSetpoint', arg?: number,
): Promise<void> {
  const cmd =
    command === 'setCoolingSetpoint'
      ? { component: 'main', capability: 'thermostatCoolingSetpoint', command: 'setCoolingSetpoint', arguments: [arg ?? 24] }
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
  return {
    deviceId,
    online: true,
    // Tuya 온도는 종종 10배 스케일 (245 = 24.5도)
    temperature: tempRaw !== undefined && Math.abs(tempRaw) > 60 ? tempRaw / 10 : tempRaw,
    humidity: numOrU(find(/humidity/)),
    switch: sw === true ? 'on' : sw === false ? 'off' : undefined,
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

function numOrU(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}
