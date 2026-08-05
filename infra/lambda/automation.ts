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
  stCommand, tuyaCommand, stStatus, tuyaStatus, hejStatus, hejCommand, resolveStToken, resolveHejToken,
  type SmartHomeConfig, type SmartLog,
} from './smarthome'
import { resolveTtToken, ttGetPasscode, type TtlockConfig } from './ttlock'

const ST_CLIENT_ID = process.env.ST_OAUTH_CLIENT_ID || undefined
const ST_CLIENT_SECRET = process.env.ST_OAUTH_CLIENT_SECRET || undefined

interface MappedDevice {
  provider: 'smartthings' | 'tuya' | 'hejhome' | 'hub'
  deviceId: string
  name: string
  listingId?: string
  caps: string[]
}

interface Rules {
  [listingId: string]: { preheat?: boolean; preheatMinutes?: number; targetTemp?: number; autoOff?: boolean }
}

/** 원탭 씬 — 기기 여러 대를 한 번에 켜기/끄기 */
interface Scene {
  id: string
  name?: string
  actions?: { deviceId: string; command: 'on' | 'off' }[]
}

/** 시간 예약 — 지정 시각(KST)에 씬 실행 (집·숙소 공용) */
interface Schedule {
  id: string
  time?: string // "HH:MM"
  days?: number[] // 0=일 … 6=토, 비어 있으면 매일
  sceneId?: string
  enabled?: boolean
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
      const smart = await getDoc<{
        config: SmartHomeConfig; devices: MappedDevice[]; rules: Rules
        available?: unknown; scenes?: Scene[]; schedules?: Schedule[]
      }>(sub, 'SMARTHOME')
      if (!smart?.config || !smart.devices?.length) continue
      const rules = smart.rules ?? {}
      const bookings = (await getDoc<BookingLite[]>(sub, 'BOOKINGS')) ?? []
      const formResponses = (await getDoc<Record<string, { answers?: Record<string, string> }>>(sub, 'FORMRESP')) ?? {}
      const done = (await getDoc<Record<string, string>>(sub, 'AUTOMATION_DONE')) ?? {}
      const log = (await getDoc<SmartLog>(sub, 'SMARTLOG')) ?? { lastSample: {}, days: {}, events: [] }
      let dirty = false
      let logDirty = false

      // 스마트싱스 토큰 — OAuth면 자동 갱신 후 저장. 저장 직전 최신 doc을
      // 다시 읽어 병합 (낡은 사본으로 덮어쓰면 회전된 리프레시 토큰이 유실됨)
      const stTok = smart.config.smartthings
        ? await resolveStToken(smart.config.smartthings, ST_CLIENT_ID, ST_CLIENT_SECRET, async (oauth) => {
            const latest = (await getDoc<typeof smart>(sub, 'SMARTHOME')) ?? smart
            latest.config.smartthings = { ...latest.config.smartthings, oauth }
            smart.config.smartthings = latest.config.smartthings
            await putDoc(sub, 'SMARTHOME', latest)
          }).catch((e) => { console.error(`st token refresh failed for ${sub}:`, e); return null })
        : null

      // 헤이홈 토큰 — 계정 연동이면 자동 갱신 후 저장
      const hejTok = smart.config.hejhome
        ? await resolveHejToken(smart.config.hejhome, async (oauth) => {
            const latest = (await getDoc<typeof smart>(sub, 'SMARTHOME')) ?? smart
            latest.config.hejhome = { ...latest.config.hejhome, oauth }
            smart.config.hejhome = latest.config.hejhome
            await putDoc(sub, 'SMARTHOME', latest)
          }).catch((e) => { console.error(`hej token refresh failed for ${sub}:`, e); return null })
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
                await sendCommand(stTok, hejTok, smart.config, d, 'on', rule.targetTemp)
                  .then(() => { log.events.unshift({ ts: new Date().toISOString(), d: d.deviceId, ev: 'on', by: 'auto' }); logDirty = true })
                  .catch((e) => console.error('preheat fail', e))
              }
              done[key] = new Date().toISOString()
              dirty = true
              console.log(`preheat fired: ${sub} ${listingId} ${todayCheckin.id}`)
            }
          }
        }

        // 체크아웃 자동 차단 (11:30 이후) — 당일 새 체크인이 있어도 일단 끄고,
        // 체크인 예열 자동화가 예정 시간(N분 전)에 다시 켠다. 단 예열이 이미
        // 켜진 뒤거나 예열 규칙이 꺼져 있으면 게스트 보호를 위해 끄지 않는다.
        if (rule.autoOff && nowMin >= 11 * 60 + 30) {
          const checkoutToday = bookings.find((b) => {
            if (b.listingId !== listingId || b.status === 'cancelled') return false
            const [y, mo, d] = b.checkIn.split('-').map(Number)
            const co = new Date(Date.UTC(y, mo - 1, d + b.nights))
            return co.toISOString().slice(0, 10) === today
          })
          const checkinToday = bookings.find(
            (b) => b.listingId === listingId && b.status !== 'cancelled' && b.checkIn === today,
          )
          const keepOn =
            !!checkinToday && (!rule.preheat || !!done[`preheat:${checkinToday.id}`])
          if (checkoutToday && !keepOn) {
            const key = `autooff:${checkoutToday.id}`
            if (!done[key]) {
              for (const d of devices.filter((x) => x.caps.includes('switch') || x.caps.includes('ac'))) {
                await sendCommand(stTok, hejTok, smart.config, d, 'off')
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

      // ── 시간 예약: 지정 시각(KST) 도래 시 씬 실행 — 하루 1회, 60분 이내에만
      // (람다가 오래 멈췄다 돌아와도 한밤중에 아침 씬이 실행되지 않도록 창을 둔다)
      const dow = now.getUTCDay() // KST 보정된 Date라 UTC getter = KST 요일
      for (const sch of smart.schedules ?? []) {
        if (!sch.enabled || !sch.time || !sch.sceneId) continue
        if (!sch.days?.length || !sch.days.includes(dow)) continue // 요일 미선택 = 실행 안 함
        const [hh, mm] = sch.time.split(':').map(Number)
        if (!Number.isFinite(hh)) continue
        const schedMin = hh * 60 + (Number.isFinite(mm) ? mm : 0)
        const key = `sched:${sch.id}:${today}`
        if (nowMin < schedMin || nowMin >= schedMin + 60 || done[key]) continue
        const scene = (smart.scenes ?? []).find((s) => s.id === sch.sceneId)
        for (const a of scene?.actions ?? []) {
          const d = smart.devices.find((x) => x.deviceId === a.deviceId)
          if (!d || (a.command !== 'on' && a.command !== 'off')) continue
          await sendCommand(stTok, hejTok, smart.config, d, a.command)
            .then(() => { log.events.unshift({ ts: new Date().toISOString(), d: d.deviceId, ev: a.command, by: 'auto' }); logDirty = true })
            .catch((e) => console.error('schedule fail', e))
        }
        done[key] = new Date().toISOString()
        dirty = true
        console.log(`schedule fired: ${sub} ${sch.id} (${scene?.name ?? sch.sceneId})`)
      }

      // ── 상태 샘플링: 켬/끔 감지 + 가동시간(분) 적산 — 15분 주기라 15분 해상도
      const nowIso = new Date().toISOString()
      const hubDoc = smart.devices.some((d) => d.provider === 'hub')
        ? await getDoc<{ statuses?: Record<string, { switch?: 'on' | 'off' }>; seen?: Record<string, string> }>(sub, 'HUBDEVICES')
        : null
      for (const d of smart.devices.slice(0, 20)) {
        let sw: 'on' | 'off' | undefined
        let sampled = false
        try {
          if (d.provider === 'hub') {
            const seenAt = hubDoc?.seen?.[d.deviceId.split(':')[0]]
            if (seenAt && Date.now() - Date.parse(seenAt) < 3 * 60_000) {
              sw = hubDoc?.statuses?.[d.deviceId]?.switch
              sampled = true
            }
          }
          const s = sampled ? null
            : d.provider === 'smartthings' && stTok
              ? await stStatus(stTok, d.deviceId)
              : d.provider === 'tuya' && smart.config.tuya
                ? await tuyaStatus(smart.config.tuya, d.deviceId)
                : d.provider === 'hejhome' && hejTok
                  ? await hejStatus(hejTok, d.deviceId)
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

  await autoIssuePasscodes()
}

/**
 * TTLock 자동 비밀번호 발급 — 연동·잠금배정된 숙소의 예약에 대해
 * 체크인 3일 전부터 미리 기간제 비번을 발급한다. (게이트웨이로 자동 동기화)
 * 이미 발급된 예약은 건너뛴다.
 */
interface DoorDoc {
  config: TtlockConfig
  locks: unknown[]
  passcodes: Record<string, { lockId: number; keyboardPwdId: number; code: string; startDate: number; endDate: number; guestName?: string; issuedAt: string }>
  assign: Record<string, number>
  autoIssue?: boolean
}

async function autoIssuePasscodes(): Promise<void> {
  let lastKey: Record<string, unknown> | undefined
  const users: string[] = []
  do {
    const res = await ddb.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'sk = :sk',
      ExpressionAttributeValues: { ':sk': 'DOORLOCK' },
      ProjectionExpression: 'pk',
      ExclusiveStartKey: lastKey,
    }))
    for (const item of res.Items ?? []) users.push((item.pk as string).replace('USER#', ''))
    lastKey = res.LastEvaluatedKey
  } while (lastKey)

  const today = kstDateStr(kstNow())
  for (const sub of users) {
    try {
      const door = await getDoc<DoorDoc>(sub, 'DOORLOCK')
      // autoIssue는 기본 켜짐(undefined) — 명시적으로 false면 건너뜀
      if (!door?.config?.oauth || door.autoIssue === false) continue
      if (!door.assign || Object.keys(door.assign).length === 0) continue
      const bookings = (await getDoc<BookingLite[]>(sub, 'BOOKINGS')) ?? []
      let tok: string | null = null
      let changed = false
      for (const b of bookings) {
        if (b.status === 'cancelled') continue
        const lockId = door.assign[b.listingId]
        if (!lockId) continue
        if (door.passcodes?.[b.id]) continue // 이미 발급됨
        // 체크아웃 안 지났고, 체크인이 3일 이내(또는 이미 시작)인 예약만
        const [y, mo, d] = b.checkIn.split('-').map(Number)
        const [ty, tmo, td] = today.split('-').map(Number)
        const checkout = new Date(Date.UTC(y, mo - 1, d + b.nights))
        if (kstDateStr(checkout) < today) continue
        const daysToCheckin = Math.round((Date.UTC(y, mo - 1, d) - Date.UTC(ty, tmo - 1, td)) / 86400000)
        if (daysToCheckin > 3) continue
        const startDate = new Date(`${b.checkIn}T15:00:00+09:00`).getTime()
        const endDate = new Date(`${kstDateStr(checkout)}T11:00:00+09:00`).getTime()
        try {
          if (!tok) {
            tok = await resolveTtToken(door.config, async (oauth) => {
              const latest = (await getDoc<DoorDoc>(sub, 'DOORLOCK')) ?? door
              latest.config = { ...latest.config, oauth }
              door.config = latest.config
              await putDoc(sub, 'DOORLOCK', latest)
            })
          }
          if (!tok) break
          const r = await ttGetPasscode(door.config, tok, lockId, b.id, startDate, endDate)
          door.passcodes = { ...(door.passcodes ?? {}) }
          door.passcodes[b.id] = { lockId, keyboardPwdId: r.keyboardPwdId, code: r.keyboardPwd, startDate, endDate, issuedAt: new Date().toISOString() }
          changed = true
          console.log(`passcode auto-issued: ${sub} ${b.id}`)
        } catch (e) {
          console.error(`passcode issue failed ${sub} ${b.id}:`, e)
        }
      }
      if (changed) await putDoc(sub, 'DOORLOCK', door)
    } catch (e) {
      console.error(`door automation failed for ${sub}:`, e)
    }
  }
}

async function sendCommand(
  stTok: string | null,
  hejTok: string | null,
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
  } else if (device.provider === 'hejhome' && hejTok) {
    await hejCommand(hejTok, device.deviceId, cmd)
  } else if (device.provider === 'hub') {
    // 허브 명령 큐에 적재 — 허브 에이전트가 3초 주기로 받아 실행
    const hubId = device.deviceId.split(':')[0]
    const q = (await getDoc<{ items: unknown[] }>(`HUB:${hubId}`, 'QUEUE')) ?? { items: [] }
    q.items.push({ id: `auto-${Date.now()}`, deviceId: device.deviceId, command: cmd, ts: new Date().toISOString() })
    await putDoc(`HUB:${hubId}`, 'QUEUE', { items: q.items.slice(-20) })
  }
}
