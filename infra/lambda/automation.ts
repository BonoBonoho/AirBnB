/**
 * 예약 연동 스마트홈 자동화 — 15분마다 실행
 * - 체크인 예열: 체크인 예정시간 N분 전 에어컨 ON + 목표온도 (게스트 설문의 체크인 예정시간 우선, 없으면 15:00)
 * - 체크아웃 자동 차단: 체크아웃(11:00) 후 매핑된 기기 전원 OFF
 * - 상태 샘플링: 배정된 기기의 켬/끔을 기록해 가동시간을 적산 (사용 기록)
 */
import { ScanCommand } from '@aws-sdk/lib-dynamodb'
import { ddb, TABLE_NAME } from './shared'
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import {
  stCommand, tuyaCommand, stStatus, tuyaStatus, resolveStToken,
  type SmartHomeConfig, type SmartLog,
} from './smarthome'

const ST_CLIENT_ID = process.env.ST_OAUTH_CLIENT_ID || undefined
const ST_CLIENT_SECRET = process.env.ST_OAUTH_CLIENT_SECRET || undefined

interface MappedDevice {
  provider: 'smartthings' | 'tuya'
  deviceId: string
  name: string
  listingId?: string
  caps: string[]
}

interface Rules {
  [listingId: string]: { preheat?: boolean; preheatMinutes?: number; targetTemp?: number; autoOff?: boolean }
}

interface BookingLite {
  listingId: string
  checkIn: string
  nights: number
  status: string
  id: string
}

async function getDoc<T>(pk: string, sk: string): Promise<T | null> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: `USER#${pk}`, sk } }))
  return (res.Item?.data as T) ?? null
}

async function putDoc(pk: string, sk: string, data: unknown): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: { pk: `USER#${pk}`, sk, data, updatedAt: new Date().toISOString() },
  }))
}

const KST_OFFSET = 9 * 60 * 60 * 1000

function kstNow(): Date {
  return new Date(Date.now() + KST_OFFSET)
}

function kstDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** "15:00", "오후 3시", "3시" 등에서 시각 추출 — 실패 시 15:00 */
export function parseCheckinTime(text: string | undefined): { h: number; m: number } {
  if (!text) return { h: 15, m: 0 }
  const hm = text.match(/(\d{1,2})\s*[:시]\s*(\d{1,2})?/)
  if (!hm) return { h: 15, m: 0 }
  let h = Number(hm[1])
  const m = hm[2] ? Number(hm[2]) : 0
  if (/오후|저녁|밤|pm/i.test(text) && h < 12) h += 12
  if (h < 8) h += 12 // "3시"처럼 모호하면 오후로 간주 (체크인은 보통 오후)
  if (h > 23) h = 23
  return { h, m: m < 60 ? m : 0 }
}

export async function handler(): Promise<void> {
  // SMARTHOME 설정이 있는 사용자 스캔
  let lastKey: Record<string, unknown> | undefined
  const users: string[] = []
  do {
    const res = await ddb.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'sk = :sk',
      ExpressionAttributeValues: { ':sk': 'SMARTHOME' },
      ProjectionExpression: 'pk',
      ExclusiveStartKey: lastKey,
    }))
    for (const item of res.Items ?? []) users.push((item.pk as string).replace('USER#', ''))
    lastKey = res.LastEvaluatedKey
  } while (lastKey)

  const now = kstNow()
  const today = kstDateStr(now)
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes() // KST 보정된 Date라 UTC getter = KST 시각

  for (const sub of users) {
    try {
      const smart = await getDoc<{ config: SmartHomeConfig; devices: MappedDevice[]; rules: Rules; available?: unknown }>(sub, 'SMARTHOME')
      if (!smart?.config || !smart.devices?.length) continue
      const rules = smart.rules ?? {}
      const bookings = (await getDoc<BookingLite[]>(sub, 'BOOKINGS')) ?? []
      const formResponses = (await getDoc<Record<string, { answers?: Record<string, string> }>>(sub, 'FORMRESP')) ?? {}
      const done = (await getDoc<Record<string, string>>(sub, 'AUTOMATION_DONE')) ?? {}
      const log = (await getDoc<SmartLog>(sub, 'SMARTLOG')) ?? { lastSample: {}, days: {}, events: [] }
      let dirty = false
      let logDirty = false

      // 스마트싱스 토큰 — OAuth면 자동 갱신 후 저장 (전체 doc을 다시 써서 available 등 보존)
      const stTok = smart.config.smartthings
        ? await resolveStToken(smart.config.smartthings, ST_CLIENT_ID, ST_CLIENT_SECRET, async (oauth) => {
            smart.config.smartthings = { ...smart.config.smartthings, oauth }
            await putDoc(sub, 'SMARTHOME', smart)
          }).catch((e) => { console.error(`st token refresh failed for ${sub}:`, e); return null })
        : null

      for (const [listingId, rule] of Object.entries(rules)) {
        const devices = smart.devices.filter((d) => d.listingId === listingId)
        if (devices.length === 0) continue

        // 체크인 예열
        if (rule.preheat) {
          const todayCheckin = bookings.find(
            (b) => b.listingId === listingId && b.status !== 'cancelled' && b.checkIn === today,
          )
          if (todayCheckin) {
            const t = parseCheckinTime(formResponses[todayCheckin.id]?.answers?.checkinTime)
            const fireAt = t.h * 60 + t.m - (rule.preheatMinutes ?? 60)
            const key = `preheat:${todayCheckin.id}`
            if (nowMin >= fireAt && !done[key]) {
              for (const d of devices.filter((x) => x.caps.includes('ac') || x.caps.includes('switch'))) {
                await sendCommand(stTok, smart.config, d, 'on', rule.targetTemp)
                  .then(() => { log.events.unshift({ ts: new Date().toISOString(), d: d.deviceId, ev: 'on', by: 'auto' }); logDirty = true })
                  .catch((e) => console.error('preheat fail', e))
              }
              done[key] = new Date().toISOString()
              dirty = true
              console.log(`preheat fired: ${sub} ${listingId} ${todayCheckin.id}`)
            }
          }
        }

        // 체크아웃 자동 차단 (11:30 이후, 오늘이 체크아웃일이고 오늘 새 체크인이 없을 때)
        if (rule.autoOff && nowMin >= 11 * 60 + 30) {
          const checkoutToday = bookings.find((b) => {
            if (b.listingId !== listingId || b.status === 'cancelled') return false
            const [y, mo, d] = b.checkIn.split('-').map(Number)
            const co = new Date(Date.UTC(y, mo - 1, d + b.nights))
            return co.toISOString().slice(0, 10) === today
          })
          const checkinToday = bookings.some(
            (b) => b.listingId === listingId && b.status !== 'cancelled' && b.checkIn === today,
          )
          if (checkoutToday && !checkinToday) {
            const key = `autooff:${checkoutToday.id}`
            if (!done[key]) {
              for (const d of devices.filter((x) => x.caps.includes('switch') || x.caps.includes('ac'))) {
                await sendCommand(stTok, smart.config, d, 'off')
                  .then(() => { log.events.unshift({ ts: new Date().toISOString(), d: d.deviceId, ev: 'off', by: 'auto' }); logDirty = true })
                  .catch((e) => console.error('autooff fail', e))
              }
              done[key] = new Date().toISOString()
              dirty = true
              console.log(`autooff fired: ${sub} ${listingId} ${checkoutToday.id}`)
            }
          }
        }
      }

      // ── 상태 샘플링: 켬/끔 감지 + 가동시간(분) 적산 — 15분 주기라 15분 해상도
      const nowIso = new Date().toISOString()
      for (const d of smart.devices.slice(0, 20)) {
        let sw: 'on' | 'off' | undefined
        let sampled = false
        try {
          const s = d.provider === 'smartthings' && stTok
            ? await stStatus(stTok, d.deviceId)
            : d.provider === 'tuya' && smart.config.tuya
              ? await tuyaStatus(smart.config.tuya, d.deviceId)
              : null
          if (s) { sw = s.switch; sampled = true }
        } catch {
          // 오프라인/일시 오류 — 이번 샘플은 건너뜀
        }
        if (!sampled) continue
        const prev = log.lastSample[d.deviceId]
        if (prev?.sw === 'on') {
          const mins = Math.min(30, Math.round((Date.now() - Date.parse(prev.ts)) / 60000))
          if (mins > 0) {
            const day = (log.days[today] ??= {})
            day[d.deviceId] = (day[d.deviceId] ?? 0) + mins
          }
        }
        if (prev?.sw && sw && prev.sw !== sw) {
          // 리모컨·앱 등 외부에서 바뀐 켬/끔도 이벤트로 남김
          log.events.unshift({ ts: nowIso, d: d.deviceId, ev: sw, by: 'sample' })
        }
        log.lastSample[d.deviceId] = { sw, ts: nowIso }
        logDirty = true
      }

      if (logDirty) {
        const dayCutoff = kstDateStr(new Date(now.getTime() - 30 * 86400000))
        for (const k of Object.keys(log.days)) if (k < dayCutoff) delete log.days[k]
        log.events = log.events.slice(0, 300)
        await putDoc(sub, 'SMARTLOG', log)
      }

      if (dirty) {
        // 오래된 마커 정리 (30일)
        const cutoff = new Date(Date.now() - 30 * 86400000).toISOString()
        for (const [k, v] of Object.entries(done)) if (v < cutoff) delete done[k]
        await putDoc(sub, 'AUTOMATION_DONE', done)
      }
    } catch (e) {
      console.error(`automation failed for ${sub}:`, e)
    }
  }
}

async function sendCommand(
  stTok: string | null,
  config: SmartHomeConfig,
  device: MappedDevice,
  cmd: 'on' | 'off',
  targetTemp?: number,
): Promise<void> {
  if (device.provider === 'smartthings' && stTok) {
    await stCommand(stTok, device.deviceId, cmd)
    if (cmd === 'on' && targetTemp && device.caps.includes('ac')) {
      await stCommand(stTok, device.deviceId, 'setCoolingSetpoint', targetTemp)
    }
  } else if (device.provider === 'tuya' && config.tuya) {
    await tuyaCommand(config.tuya, device.deviceId, cmd)
  }
}
