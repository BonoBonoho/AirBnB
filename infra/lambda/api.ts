import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda'
import { randomBytes } from 'node:crypto'
import { PutCommand } from '@aws-sdk/lib-dynamodb'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'
import { ddb, TABLE_NAME, getDoc, putDoc, syncUserBookings } from './shared'
import { fetchAirbnbListing } from './airbnb-import'
import { scanMarket } from './market-scan'
import { renderListingPage, renderSitemap } from './public-page'
import {
  stListDevices, stStatus, stCommand, tuyaListDevices, tuyaStatus, tuyaCommand,
  hejListDevices, hejStatus, hejCommand, hejLogin, resolveHejToken,
  resolveStToken, stAuthorizeUrl, stExchangeCode,
} from './smarthome'
import type { SmartHomeConfig, SmartDevice, DeviceStatus, SmartLog, StCommandName } from './smarthome'

const s3 = new S3Client({})
const lambdaClient = new LambdaClient({})
const BACKFILL_FN = process.env.BACKFILL_FN
const SITE_BUCKET = process.env.SITE_BUCKET
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ?? ''
const ST_CLIENT_ID = process.env.ST_OAUTH_CLIENT_ID || undefined
const ST_CLIENT_SECRET = process.env.ST_OAUTH_CLIENT_SECRET || undefined

type SmartDoc = {
  config: SmartHomeConfig
  devices: (SmartDevice & { listingId?: string })[]
  rules: unknown
  available?: SmartDevice[]
}

/** 공동 호스트 권한 — 조회는 팀원 모두 가능, 수정은 켜진 항목만 */
interface CoPerms {
  pricing?: boolean
  channels?: boolean
  smart?: boolean
  guest?: boolean
}
interface TeamMember {
  email: string
  perms: CoPerms
  invitedAt?: string
}
interface CohostMap {
  owners: { sub: string; ownerEmail: string; perms: CoPerms }[]
}

/** 스마트싱스 토큰 결정 — OAuth면 자동 갱신 후 저장, 아니면 PAT */
async function stTokenFor(sub: string, smart: SmartDoc): Promise<string | null> {
  return resolveStToken(smart.config.smartthings, ST_CLIENT_ID, ST_CLIENT_SECRET, async (oauth) => {
    smart.config.smartthings = { ...smart.config.smartthings, oauth }
    await putDoc(sub, 'SMARTHOME', smart)
  })
}

/** 헤이홈 토큰 결정 — 계정 연동이면 자동 갱신 후 저장, 아니면 수동 토큰 */
async function hejTokenFor(sub: string, smart: SmartDoc): Promise<string | null> {
  return resolveHejToken(smart.config.hejhome, async (oauth) => {
    smart.config.hejhome = { ...smart.config.hejhome, oauth }
    await putDoc(sub, 'SMARTHOME', smart)
  })
}

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(body),
})

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method
  const path = event.rawPath

  // ── 공개 라우트 (게스트 설문 — 로그인 불필요, 토큰이 인증 역할)
  if (path.startsWith('/public/form/')) {
    const token = decodeURIComponent(path.split('/public/form/')[1] ?? '')
    if (!/^[a-z0-9]{8,32}$/.test(token)) return json(404, { error: 'not found' })
    try {
      const link = await getDoc<{
        sub: string; bookingId: string; guestName: string; listingName: string
        checkIn: string; nights: number
      }>(`FORMLINK:${token}`, 'MAP')
      if (!link) return json(404, { error: '유효하지 않은 링크입니다' })

      if (method === 'GET') {
        const [questions, responses] = await Promise.all([
          getDoc(link.sub, 'FORMQUESTIONS'),
          getDoc<Record<string, unknown>>(link.sub, 'FORMRESP'),
        ])
        return json(200, {
          questions, // null이면 프론트가 기본 템플릿 사용
          meta: {
            guestName: link.guestName, listingName: link.listingName,
            checkIn: link.checkIn, nights: link.nights,
          },
          submitted: !!responses?.[link.bookingId],
        })
      }

      if (method === 'POST') {
        const body = JSON.parse(event.body ?? '{}')
        if (!body.answers || typeof body.answers !== 'object') {
          return json(400, { error: 'answers가 필요합니다' })
        }
        const answers: Record<string, string> = {}
        for (const [k, v] of Object.entries(body.answers as Record<string, unknown>).slice(0, 60)) {
          answers[String(k).slice(0, 60)] = String(v).slice(0, 2000)
        }
        const responses = (await getDoc<Record<string, unknown>>(link.sub, 'FORMRESP')) ?? {}
        responses[link.bookingId] = {
          submittedAt: new Date().toISOString(),
          guestName: String(body.guestName ?? link.guestName).slice(0, 100),
          answers,
        }
        await putDoc(link.sub, 'FORMRESP', responses)
        return json(200, { ok: true })
      }
    } catch (e) {
      console.error(e)
      return json(500, { error: 'internal error' })
    }
    return json(404, { error: 'not found' })
  }

  // ── 공개 라우트: 미니홈 가용성 조회 / 예약 문의 접수
  if (path.startsWith('/public/avail/') || path.startsWith('/public/inquiry/')) {
    const slug = decodeURIComponent(path.split('/').pop() ?? '')
    if (!/^[a-z0-9-]{3,40}$/.test(slug)) return json(404, { error: 'not found' })
    try {
      const map = await getDoc<{ sub: string; listingId: string }>(`SLUG:${slug}`, 'MAP')
      if (!map) return json(404, { error: '페이지를 찾을 수 없습니다' })

      if (method === 'GET' && path.startsWith('/public/avail/')) {
        const bookings =
          (await getDoc<{ listingId: string; checkIn: string; nights: number; status: string }[]>(
            map.sub, 'BOOKINGS',
          )) ?? []
        const booked: string[] = []
        for (const b of bookings) {
          if (b.listingId !== map.listingId || b.status === 'cancelled') continue
          const [y, mo, d] = b.checkIn.split('-').map(Number)
          for (let i = 0; i < b.nights; i++) {
            const dt = new Date(y, mo - 1, d + i)
            booked.push(
              `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`,
            )
          }
        }
        return json(200, { booked })
      }

      if (method === 'POST' && path.startsWith('/public/inquiry/')) {
        const body = JSON.parse(event.body ?? '{}')
        if (!body.name || !body.contact) return json(400, { error: '성함과 연락처가 필요합니다' })
        const inquiries =
          (await getDoc<unknown[]>(map.sub, 'INQUIRIES')) ?? []
        inquiries.unshift({
          id: randomBytes(6).toString('hex'),
          slug,
          listingId: map.listingId,
          name: String(body.name).slice(0, 50),
          contact: String(body.contact).slice(0, 80),
          dates: String(body.dates ?? '').slice(0, 80),
          message: String(body.message ?? '').slice(0, 1000),
          at: new Date().toISOString(),
        })
        await putDoc(map.sub, 'INQUIRIES', inquiries.slice(0, 200))
        return json(200, { ok: true })
      }
    } catch (e) {
      console.error(e)
      return json(500, { error: 'internal error' })
    }
    return json(404, { error: 'not found' })
  }

  // ── 공개 라우트: 스마트싱스 OAuth 콜백 (삼성 로그인 후 리다이렉트 도착지)
  if (path === '/public/st-oauth/callback' && method === 'GET') {
    const q = event.queryStringParameters ?? {}
    const back = (msg: string): APIGatewayProxyResultV2 => ({
      statusCode: 302,
      headers: { Location: `${PUBLIC_ORIGIN}/#/smartroom?st=${encodeURIComponent(msg)}` },
      body: '',
    })
    try {
      const state = q.state ?? ''
      if (!q.code || !/^[a-f0-9]{16,64}$/.test(state)) return back('error')
      const link = await getDoc<{ sub: string; createdAt: string; used?: boolean }>(`STOAUTH:${state}`, 'MAP')
      if (!link || link.used || Date.parse(link.createdAt) < Date.now() - 10 * 60 * 1000) return back('expired')
      if (!ST_CLIENT_ID || !ST_CLIENT_SECRET) return back('noapp')
      const redirectUri = `https://${event.requestContext.domainName}/public/st-oauth/callback`
      const oauth = await stExchangeCode(ST_CLIENT_ID, ST_CLIENT_SECRET, q.code, redirectUri)
      const smart = (await getDoc<SmartDoc>(link.sub, 'SMARTHOME')) ?? { config: {}, devices: [], rules: {} }
      smart.config.smartthings = { ...smart.config.smartthings, oauth }
      await Promise.all([
        putDoc(link.sub, 'SMARTHOME', smart),
        putDoc(`STOAUTH:${state}`, 'MAP', { ...link, used: true }),
      ])
      return back('connected')
    } catch (e) {
      console.error('st-oauth callback failed', e)
      return back('error')
    }
  }

  const callerSub = event.requestContext.authorizer?.jwt?.claims?.sub as string | undefined
  if (!callerSub) return json(401, { error: 'unauthorized' })
  const callerEmail = String(event.requestContext.authorizer?.jwt?.claims?.email ?? '').toLowerCase()

  try {
    // ── 팀(공동 호스트) 관리 — 항상 로그인한 본인 계정 기준 (워크스페이스 전환과 무관)
    if (path === '/api/workspaces' && method === 'GET') {
      const share = callerEmail ? await getDoc<CohostMap>(`COHOST:${callerEmail}`, 'MAP') : null
      return json(200, { workspaces: share?.owners ?? [] })
    }

    if (path === '/api/team' && method === 'GET') {
      const team = await getDoc<{ members: TeamMember[] }>(callerSub, 'TEAM')
      return json(200, team ?? { members: [] })
    }

    if (path === '/api/team' && method === 'PUT') {
      const body = JSON.parse(event.body ?? '{}')
      if (!Array.isArray(body.members)) return json(400, { error: 'members 배열이 필요합니다' })
      const members: TeamMember[] = body.members
        .slice(0, 20)
        .map((m: { email?: unknown; perms?: CoPerms; invitedAt?: unknown }) => ({
          email: String(m.email ?? '').toLowerCase().trim().slice(0, 120),
          perms: {
            pricing: !!m.perms?.pricing,
            channels: !!m.perms?.channels,
            smart: !!m.perms?.smart,
            guest: !!m.perms?.guest,
          },
          invitedAt: typeof m.invitedAt === 'string' ? m.invitedAt : new Date().toISOString(),
        }))
        .filter((m: TeamMember) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m.email) && m.email !== callerEmail)
      const prev = (await getDoc<{ members: TeamMember[] }>(callerSub, 'TEAM')) ?? { members: [] }
      await putDoc(callerSub, 'TEAM', { members })
      // 역방향 맵 갱신 — 공동 호스트가 로그인했을 때 자기 워크스페이스 목록을 찾는 용도
      const emails = new Set([...prev.members.map((m) => m.email), ...members.map((m) => m.email)])
      for (const email of emails) {
        const cur = members.find((m) => m.email === email)
        const map = (await getDoc<CohostMap>(`COHOST:${email}`, 'MAP')) ?? { owners: [] }
        map.owners = (map.owners ?? []).filter((o) => o.sub !== callerSub)
        if (cur) map.owners.push({ sub: callerSub, ownerEmail: callerEmail, perms: cur.perms })
        await putDoc(`COHOST:${email}`, 'MAP', map)
      }
      return json(200, { ok: true })
    }

    // ── 워크스페이스 전환: 공동 호스트가 x-workspace 헤더로 소유자 데이터에 접근
    let sub = callerSub
    let perms: 'owner' | CoPerms = 'owner'
    const wsHeader = event.headers?.['x-workspace']
    if (wsHeader && wsHeader !== callerSub) {
      const share = callerEmail ? await getDoc<CohostMap>(`COHOST:${callerEmail}`, 'MAP') : null
      const grant = share?.owners?.find((o) => o.sub === wsHeader)
      if (!grant) return json(403, { error: '이 워크스페이스에 대한 권한이 없습니다' })
      sub = wsHeader
      perms = grant.perms ?? {}
    }
    const can = (k: keyof CoPerms) => perms === 'owner' || !!(perms as CoPerms)[k]
    // 전체 상태 조회 (숙소 + 수동가격 + iCal 예약 + 실매출 + 메일수신 설정 + 시장 데이터)
    if (method === 'GET' && path === '/api/state') {
      const [listings, overrides, bookings, actuals, settings, verification, market, formQuestions, formResponses, formLinks, inquiries, guestNotes] =
        await Promise.all([
          getDoc(sub, 'LISTINGS'),
          getDoc(sub, 'OVERRIDES'),
          getDoc(sub, 'BOOKINGS'),
          getDoc(sub, 'ACTUALS'),
          getDoc<{ inboundKey?: string }>(sub, 'SETTINGS'),
          getDoc(sub, 'VERIFICATION'),
          getDoc(sub, 'MARKET'),
          getDoc(sub, 'FORMQUESTIONS'),
          getDoc(sub, 'FORMRESP'),
          getDoc(sub, 'FORMLINKS'),
          getDoc(sub, 'INQUIRIES'),
          getDoc(sub, 'GUESTNOTES'),
        ])
      return json(200, {
        listings,
        overrides: overrides ?? [],
        bookings: bookings ?? [],
        actuals: actuals ?? [],
        inboundKey: settings?.inboundKey ?? null,
        verification: verification ?? null,
        market: market ?? {},
        formQuestions,
        formResponses: formResponses ?? {},
        formLinks: formLinks ?? {},
        inquiries: inquiries ?? [],
        guestNotes: guestNotes ?? {},
      })
    }

    // 게스트 메모 저장 (예약별)
    if (method === 'PUT' && path === '/api/guest-notes') {
      if (!can('guest')) return json(403, { error: '게스트 메모 권한이 없습니다. 소유자에게 요청하세요.' })
      const { bookingId, note } = JSON.parse(event.body ?? '{}')
      if (!bookingId) return json(400, { error: 'bookingId가 필요합니다' })
      const notes = (await getDoc<Record<string, string>>(sub, 'GUESTNOTES')) ?? {}
      const trimmed = String(note ?? '').slice(0, 1000)
      if (trimmed) notes[String(bookingId)] = trimmed
      else delete notes[String(bookingId)]
      await putDoc(sub, 'GUESTNOTES', notes)
      return json(200, { ok: true })
    }

    // 미니홈 발행 — 정적 HTML을 사이트 버킷에 생성 (네이버/구글 봇 인덱싱 가능)
    if (method === 'POST' && path === '/api/publish-page') {
      if (!can('guest')) return json(403, { error: '미니홈 발행 권한이 없습니다. 소유자에게 요청하세요.' })
      if (!SITE_BUCKET) return json(500, { error: '사이트 버킷이 설정되지 않았습니다' })
      const { listingId, slug, page } = JSON.parse(event.body ?? '{}')
      if (!listingId || !slug || !page) return json(400, { error: 'listingId/slug/page 필요' })
      if (!/^[a-z0-9-]{3,40}$/.test(String(slug))) {
        return json(400, { error: '주소는 영문 소문자·숫자·하이픈 3~40자입니다' })
      }
      const existing = await getDoc<{ sub: string; listingId: string }>(`SLUG:${slug}`, 'MAP')
      if (existing && (existing.sub !== sub || existing.listingId !== String(listingId))) {
        return json(409, { error: '이미 사용 중인 주소입니다. 다른 주소를 선택하세요.' })
      }

      const html = renderListingPage({
        slug: String(slug),
        name: String(page.name ?? '').slice(0, 120),
        region: String(page.region ?? '').slice(0, 60),
        type: String(page.type ?? '').slice(0, 40),
        bedrooms: Number(page.bedrooms) || 0,
        maxGuests: Number(page.maxGuests) || 0,
        description: String(page.description ?? '').slice(0, 3000),
        photoUrl: page.photoUrl ? String(page.photoUrl).slice(0, 500) : undefined,
        kakaoUrl: page.kakaoUrl ? String(page.kakaoUrl).slice(0, 300) : undefined,
        phone: page.phone ? String(page.phone).slice(0, 30) : undefined,
        airbnbUrl: page.airbnbUrl ? String(page.airbnbUrl).slice(0, 300) : undefined,
        minPriceText: page.minPriceText ? String(page.minPriceText).slice(0, 60) : undefined,
        apiUrl: `https://${event.requestContext.domainName}`,
        origin: PUBLIC_ORIGIN,
      })

      const slugs = (await getDoc<string[]>('GLOBAL', 'SLUGS')) ?? []
      if (!slugs.includes(String(slug))) slugs.push(String(slug))

      await Promise.all([
        putDoc(`SLUG:${slug}`, 'MAP', { sub, listingId: String(listingId) }),
        putDoc('GLOBAL', 'SLUGS', slugs),
        s3.send(new PutObjectCommand({
          Bucket: SITE_BUCKET,
          Key: `s/${slug}`,
          Body: html,
          ContentType: 'text/html; charset=utf-8',
          CacheControl: 'public, max-age=300',
        })),
        s3.send(new PutObjectCommand({
          Bucket: SITE_BUCKET,
          Key: 'sitemap.xml',
          Body: renderSitemap(PUBLIC_ORIGIN, slugs),
          ContentType: 'application/xml',
          CacheControl: 'public, max-age=3600',
        })),
      ])
      return json(200, { url: `${PUBLIC_ORIGIN}/s/${slug}` })
    }

    // ── 스마트홈 (스마트싱스 + Tuya) ──
    if (path === '/api/smarthome' && method === 'GET') {
      const smart = await getDoc(sub, 'SMARTHOME')
      return json(200, smart ?? { config: {}, devices: [], rules: {} })
    }

    if (path === '/api/smarthome' && method === 'PUT') {
      if (!can('smart')) return json(403, { error: '스마트룸 설정 권한이 없습니다. 소유자에게 요청하세요.' })
      const body = JSON.parse(event.body ?? '{}')
      const prev = (await getDoc<{ config: SmartHomeConfig; devices: SmartDevice[]; rules: unknown; available: SmartDevice[]; scenes?: unknown; schedules?: unknown }>(sub, 'SMARTHOME')) ?? { config: {}, devices: [], rules: {}, available: [] }
      const next = {
        config: body.config !== undefined ? body.config : prev.config,
        devices: body.devices !== undefined ? body.devices : prev.devices,
        rules: body.rules !== undefined ? body.rules : prev.rules,
        scenes: body.scenes !== undefined ? body.scenes : (prev.scenes ?? []),
        schedules: body.schedules !== undefined ? body.schedules : (prev.schedules ?? []),
        available: body.available !== undefined ? body.available : (prev.available ?? []),
      }
      await putDoc(sub, 'SMARTHOME', next)
      return json(200, { ok: true })
    }

    // 스마트싱스 OAuth 시작 — 삼성 로그인 URL 발급 (토큰 자동 갱신 연동)
    if (path === '/api/smarthome/st-oauth-url' && method === 'POST') {
      if (perms !== 'owner') return json(403, { error: '삼성 계정 연동은 소유자만 할 수 있습니다' })
      const redirectUri = `https://${event.requestContext.domainName}/public/st-oauth/callback`
      if (!ST_CLIENT_ID) {
        return json(400, {
          error: `서비스에 스마트싱스 OAuth 앱이 아직 등록되지 않았습니다. 운영자가 SmartThings CLI로 앱을 만들고(리다이렉트 URI: ${redirectUri}) GitHub 시크릿 ST_OAUTH_CLIENT_ID/ST_OAUTH_CLIENT_SECRET을 등록해야 합니다.`,
          redirectUri,
        })
      }
      const state = randomBytes(16).toString('hex')
      await putDoc(`STOAUTH:${state}`, 'MAP', { sub, createdAt: new Date().toISOString() })
      return json(200, { url: stAuthorizeUrl(ST_CLIENT_ID, redirectUri, state), redirectUri })
    }

    // 헤이홈 계정 연동 — 인증정보(client_id/secret/appKey) + 헤이홈 로그인으로
    // 토큰을 발급받아 저장. 비밀번호는 발급 요청에만 쓰고 저장하지 않는다.
    if (path === '/api/smarthome/hejhome-login' && method === 'POST') {
      if (!can('smart')) return json(403, { error: '헤이홈 연동 권한이 없습니다. 소유자에게 요청하세요.' })
      const b = JSON.parse(event.body ?? '{}')
      const clientId = String(b.clientId ?? '').trim()
      const clientSecret = String(b.clientSecret ?? '').trim()
      const appKey = String(b.appKey ?? '').trim()
      const username = String(b.username ?? '').trim()
      const password = String(b.password ?? '')
      if (!clientId || !clientSecret || !appKey || !username || !password) {
        return json(400, { error: '인증정보 3가지와 헤이홈 계정(아이디·비밀번호)을 모두 입력해 주세요' })
      }
      try {
        const creds = { clientId, clientSecret, appKey }
        const oauth = await hejLogin(creds, username, password)
        const smart = (await getDoc<SmartDoc>(sub, 'SMARTHOME')) ?? { config: {}, devices: [], rules: {} }
        smart.config.hejhome = { creds, oauth }
        await putDoc(sub, 'SMARTHOME', smart)
        return json(200, { ok: true, expiresAt: oauth.expiresAt })
      } catch (e) {
        return json(422, { error: e instanceof Error ? e.message : '헤이홈 연동 실패' })
      }
    }

    // 연동된 계정의 기기 목록 (양쪽 provider 합침) — 조회 결과는 저장해서 새로고침 후에도 유지
    if (path === '/api/smarthome/devices' && method === 'GET') {
      if (!can('smart')) return json(403, { error: '기기 불러오기 권한이 없습니다. 소유자에게 요청하세요.' })
      const smart = (await getDoc<SmartDoc>(sub, 'SMARTHOME')) ?? { config: {}, devices: [], rules: {} }
      const cfg = smart.config ?? {}
      const out: SmartDevice[] = []
      const errors: string[] = []
      if (cfg.smartthings) {
        try {
          const tok = await stTokenFor(sub, smart)
          if (tok) out.push(...(await stListDevices(tok)))
        } catch (e) { errors.push(`스마트싱스: ${e instanceof Error ? e.message : e}`) }
      }
      if (cfg.tuya?.accessId) {
        try { out.push(...(await tuyaListDevices(cfg.tuya))) }
        catch (e) { errors.push(`Tuya: ${e instanceof Error ? e.message : e}`) }
      }
      if (cfg.hejhome) {
        try {
          const tok = await hejTokenFor(sub, smart)
          if (tok) out.push(...(await hejListDevices(tok)))
        } catch (e) { errors.push(`헤이홈: ${e instanceof Error ? e.message : e}`) }
      }
      if (out.length > 0) {
        // 전체 doc 스프레드로 저장 — scenes/schedules 등 다른 필드 보존
        await putDoc(sub, 'SMARTHOME', {
          ...smart,
          devices: smart.devices ?? [],
          rules: smart.rules ?? {},
          available: out,
        })
      }
      return json(200, { devices: out, errors })
    }

    // 매핑된 기기들의 실시간 상태
    if (path === '/api/smarthome/status' && method === 'GET') {
      const smart = await getDoc<SmartDoc>(sub, 'SMARTHOME')
      if (!smart) return json(200, { statuses: [] })
      const stTok = smart.config.smartthings ? await stTokenFor(sub, smart).catch(() => null) : null
      const hejTok = smart.config.hejhome ? await hejTokenFor(sub, smart).catch(() => null) : null
      const statuses: (DeviceStatus & { provider: string })[] = []
      for (const d of (smart.devices ?? []).slice(0, 20)) {
        try {
          const s = d.provider === 'smartthings' && stTok
            ? await stStatus(stTok, d.deviceId)
            : d.provider === 'tuya' && smart.config.tuya
              ? await tuyaStatus(smart.config.tuya, d.deviceId)
              : d.provider === 'hejhome' && hejTok
                ? await hejStatus(hejTok, d.deviceId)
                : null
          if (s) statuses.push({ ...s, provider: d.provider })
        } catch {
          statuses.push({ deviceId: d.deviceId, online: false, provider: d.provider })
        }
      }
      return json(200, { statuses })
    }

    // 기기 사용 기록 (가동시간 집계 + 최근 이벤트)
    if (path === '/api/smarthome/history' && method === 'GET') {
      const log = (await getDoc<SmartLog>(sub, 'SMARTLOG')) ?? { lastSample: {}, days: {}, events: [] }
      return json(200, { log })
    }

    // 기기 제어
    if (path === '/api/smarthome/command' && method === 'POST') {
      if (!can('smart')) return json(403, { error: '기기 제어 권한이 없습니다. 소유자에게 요청하세요.' })
      const { provider, deviceId, command, arg } = JSON.parse(event.body ?? '{}')
      const ALLOWED: StCommandName[] = ['on', 'off', 'setCoolingSetpoint', 'setAcMode', 'setFanMode', 'setVolume', 'mute', 'unmute']
      if (!ALLOWED.includes(command)) return json(400, { error: '지원하지 않는 명령입니다' })
      const smart = await getDoc<SmartDoc>(sub, 'SMARTHOME')
      if (!smart?.config) return json(400, { error: '스마트홈 연동이 설정되지 않았습니다' })
      try {
        if (provider === 'smartthings' && smart.config.smartthings) {
          const tok = await stTokenFor(sub, smart)
          if (!tok) return json(400, { error: '스마트싱스 토큰이 없습니다. 다시 연동해 주세요.' })
          await stCommand(tok, String(deviceId), command as StCommandName, arg)
        } else if (provider === 'tuya' && smart.config.tuya) {
          if (command !== 'on' && command !== 'off') return json(400, { error: 'Tuya 기기는 켜기/끄기만 지원합니다' })
          await tuyaCommand(smart.config.tuya, String(deviceId), command)
        } else if (provider === 'hejhome' && smart.config.hejhome) {
          if (command !== 'on' && command !== 'off') return json(400, { error: '헤이홈 기기는 켜기/끄기만 지원합니다' })
          const tok = await hejTokenFor(sub, smart)
          if (!tok) return json(400, { error: '헤이홈 토큰이 없습니다. 다시 연동해 주세요.' })
          await hejCommand(tok, String(deviceId), command)
        } else {
          return json(400, { error: '해당 provider가 연동되지 않았습니다' })
        }
        // 사용 기록에 남기기
        const log = (await getDoc<SmartLog>(sub, 'SMARTLOG')) ?? { lastSample: {}, days: {}, events: [] }
        const ev = command === 'on' || command === 'off' || command === 'mute' || command === 'unmute' ? command
          : command === 'setCoolingSetpoint' ? `temp:${arg}`
            : command === 'setAcMode' ? `mode:${arg}`
              : command === 'setVolume' ? `vol:${arg}` : `fan:${arg}`
        log.events.unshift({ ts: new Date().toISOString(), d: String(deviceId), ev, by: 'user' })
        log.events = log.events.slice(0, 300)
        await putDoc(sub, 'SMARTLOG', log)
        return json(200, { ok: true })
      } catch (e) {
        return json(422, { error: e instanceof Error ? e.message : '명령 실패' })
      }
    }

    // 게스트 설문 질문 저장
    if (method === 'PUT' && path === '/api/form-questions') {
      if (!can('guest')) return json(403, { error: '게스트 설문 수정 권한이 없습니다. 소유자에게 요청하세요.' })
      const { questions } = JSON.parse(event.body ?? '{}')
      if (!Array.isArray(questions)) return json(400, { error: 'questions 배열이 필요합니다' })
      await putDoc(sub, 'FORMQUESTIONS', questions.slice(0, 60))
      return json(200, { ok: true })
    }

    // 예약별 설문 링크 발급 (이미 있으면 재사용)
    if (method === 'POST' && path === '/api/form-link') {
      if (!can('guest')) return json(403, { error: '설문 링크 발급 권한이 없습니다. 소유자에게 요청하세요.' })
      const { bookingId, guestName, listingName, checkIn, nights } = JSON.parse(event.body ?? '{}')
      if (!bookingId) return json(400, { error: 'bookingId가 필요합니다' })
      const links = (await getDoc<Record<string, string>>(sub, 'FORMLINKS')) ?? {}
      let token = links[String(bookingId)]
      if (!token) {
        token = randomBytes(8).toString('hex')
        links[String(bookingId)] = token
        await Promise.all([
          putDoc(sub, 'FORMLINKS', links),
          putDoc(`FORMLINK:${token}`, 'MAP', {
            sub,
            bookingId: String(bookingId),
            guestName: String(guestName ?? '게스트').slice(0, 100),
            listingName: String(listingName ?? '').slice(0, 120),
            checkIn: String(checkIn ?? ''),
            nights: Number(nights) || 1,
          }),
        ])
      }
      return json(200, { token })
    }

    // 시장 스캔 — 지역·날짜 하나에 대한 경쟁 가격 분포 (저장은 클라이언트가 PUT /api/market으로)
    if (method === 'POST' && path === '/api/market-scan') {
      if (!can('pricing')) return json(403, { error: '시장 스캔 권한이 없습니다. 소유자에게 요청하세요.' })
      const { region, checkin, checkout } = JSON.parse(event.body ?? '{}')
      if (!region || !checkin || !checkout) return json(400, { error: 'region/checkin/checkout 필요' })
      try {
        return json(200, await scanMarket(String(region), String(checkin), String(checkout)))
      } catch (e) {
        return json(422, { error: e instanceof Error ? e.message : '스캔 실패' })
      }
    }

    // 시장 데이터 저장 (지역별 병합)
    if (method === 'PUT' && path === '/api/market') {
      if (!can('pricing')) return json(403, { error: '시장 데이터 저장 권한이 없습니다. 소유자에게 요청하세요.' })
      const { region, data } = JSON.parse(event.body ?? '{}')
      if (!region || !data) return json(400, { error: 'region/data 필요' })
      const market = (await getDoc<Record<string, unknown>>(sub, 'MARKET')) ?? {}
      market[String(region)] = data
      await putDoc(sub, 'MARKET', market)
      return json(200, { ok: true })
    }

    // 과거 메일 IMAP 백필 시작 — 앱 비밀번호는 백필 Lambda로 전달만 하고 저장하지 않는다
    if (method === 'POST' && path === '/api/mail-backfill') {
      if (!can('channels')) return json(403, { error: '채널·매출 권한이 없습니다. 소유자에게 요청하세요.' })
      if (!BACKFILL_FN) return json(500, { error: '백필 기능이 아직 배포되지 않았습니다' })
      const { provider, email, appPassword, reset } = JSON.parse(event.body ?? '{}')
      if (provider !== 'gmail' && provider !== 'naver') return json(400, { error: 'provider는 gmail 또는 naver' })
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email ?? ''))) return json(400, { error: '올바른 이메일이 필요합니다' })
      const pw = String(appPassword ?? '').trim()
      if (pw.length < 8 || pw.length > 64) return json(400, { error: '앱 비밀번호를 확인해 주세요' })
      await lambdaClient.send(new InvokeCommand({
        FunctionName: BACKFILL_FN,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ sub, provider, email: String(email), appPassword: pw, reset: !!reset })),
      }))
      await putDoc(sub, 'VERIFICATION', {
        subject: '⏳ 과거 메일 백필 진행 중…',
        snippet: '메일함을 스캔하고 있습니다 (보통 1~3분). 잠시 후 이 페이지를 새로고침하면 결과가 표시됩니다.',
        receivedAt: new Date().toISOString(),
      })
      return json(200, { ok: true })
    }

    // 정산 메일 수신 주소 발급 (이미 있으면 재사용)
    if (method === 'POST' && path === '/api/inbound-address') {
      if (!can('channels')) return json(403, { error: '정산 메일 설정 권한이 없습니다. 소유자에게 요청하세요.' })
      const settings = (await getDoc<{ inboundKey?: string }>(sub, 'SETTINGS')) ?? {}
      if (!settings.inboundKey) {
        settings.inboundKey = randomBytes(6).toString('hex') // 12자 소문자 hex
        await Promise.all([
          putDoc(sub, 'SETTINGS', settings),
          ddb.send(
            new PutCommand({
              TableName: TABLE_NAME,
              Item: { pk: `INBOUND#${settings.inboundKey}`, sk: 'MAP', data: { sub } },
            }),
          ),
        ])
      }
      return json(200, { inboundKey: settings.inboundKey })
    }

    // 전체 상태 저장
    if (method === 'PUT' && path === '/api/state') {
      if (!can('pricing')) return json(403, { error: '가격·숙소 수정 권한이 없습니다. 소유자에게 요청하세요.' })
      const body = JSON.parse(event.body ?? '{}')
      if (!Array.isArray(body.listings)) return json(400, { error: 'listings must be an array' })
      await Promise.all([
        putDoc(sub, 'LISTINGS', body.listings),
        putDoc(sub, 'OVERRIDES', Array.isArray(body.overrides) ? body.overrides : []),
      ])
      return json(200, { ok: true })
    }

    // iCal 즉시 동기화
    if (method === 'POST' && path === '/api/sync') {
      if (!can('channels')) return json(403, { error: '예약 동기화 권한이 없습니다. 소유자에게 요청하세요.' })
      const bookings = await syncUserBookings(sub)
      return json(200, { bookings })
    }

    // 에어비앤비 숙소 링크에서 정보 불러오기 (best-effort)
    if (method === 'POST' && path === '/api/import') {
      if (!can('pricing')) return json(403, { error: '숙소 가져오기 권한이 없습니다. 소유자에게 요청하세요.' })
      const { url } = JSON.parse(event.body ?? '{}')
      if (typeof url !== 'string') return json(400, { error: 'url이 필요합니다' })
      try {
        return json(200, await fetchAirbnbListing(url))
      } catch (e) {
        return json(422, { error: e instanceof Error ? e.message : '불러오기 실패' })
      }
    }

    return json(404, { error: 'not found' })
  } catch (e) {
    console.error(e)
    return json(500, { error: 'internal error' })
  }
}
