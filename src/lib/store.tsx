import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Listing, Booking, PriceOverride, ActualPayout, MarketData, FormQuestion, FormResponse, Inquiry } from '../types'
import { DEFAULT_LISTINGS, generateBookings, bookedDateSet } from '../data/mock'
import { computeDayPrice } from './pricing'
import { addDays } from './date'
import type { AppConfig } from './config'
import { loadConfig } from './config'
import { initAuth, getIdToken, signOut as cognitoSignOut, currentUserEmail } from './auth'
import { api, setApiWorkspace } from './api'
import type { ImportedListing, VerificationMail, Workspace, CoPerms, TeamMember } from './api'
import Login from '../pages/Login'

const LS_LISTINGS = 'stayprice.listings.v1'
const LS_OVERRIDES = 'stayprice.overrides.v1'
const LS_WORKSPACE = 'stayprice.workspace.v1'

interface Store {
  listings: Listing[]
  bookings: Booking[]
  overrides: PriceOverride[]
  /** null = 데모(로컬) 모드, 아니면 AWS 클라우드 모드 */
  cloud: {
    email: string
    signOut: () => void
    syncNow: () => Promise<number>
    importAirbnb: (url: string) => Promise<ImportedListing>
    /** 정산 메일 수신 도메인 (도메인 연결 전엔 null) */
    emailDomain: string | null
    inboundKey: string | null
    requestInboundAddress: () => Promise<string>
    /** 과거 메일 IMAP 백필 (앱 비밀번호는 서버에 저장되지 않음) */
    mailBackfill: (p: { provider: 'gmail' | 'naver'; email: string; appPassword: string; reset?: boolean }) => Promise<void>
    actualsCount: number
    actuals: ActualPayout[]
    verification: VerificationMail | null
    /** 지역별 실제 시장 스캔 데이터 */
    market: Record<string, MarketData>
    /** 게스트 설문: 질문(null=기본 템플릿), 예약별 응답, 예약별 링크 토큰 */
    formQuestions: FormQuestion[] | null
    formResponses: Record<string, FormResponse>
    formLinks: Record<string, string>
    /** 스마트홈 API (스마트룸 페이지에서 사용) */
    smart: {
      get: () => ReturnType<typeof api.getSmartHome>
      put: (patch: Parameters<typeof api.putSmartHome>[1]) => ReturnType<typeof api.putSmartHome>
      listDevices: () => ReturnType<typeof api.listSmartDevices>
      status: () => ReturnType<typeof api.smartStatus>
      command: (p: Parameters<typeof api.smartCommand>[1]) => ReturnType<typeof api.smartCommand>
      history: () => ReturnType<typeof api.smartHistory>
      oauthUrl: () => ReturnType<typeof api.stOauthUrl>
    }
    /** 게스트 메모 (예약 id → 메모) */
    guestNotes: Record<string, string>
    saveGuestNote: (bookingId: string, note: string) => Promise<void>
    /** 미니홈 문의함 + 발행 */
    inquiries: Inquiry[]
    publishPage: (payload: Parameters<typeof api.publishPage>[1]) => Promise<string>
    saveFormQuestions: (questions: FormQuestion[]) => Promise<void>
    createFormLink: (b: { bookingId: string; guestName: string; listingName: string; checkIn: string; nights: number }) => Promise<string>
    marketScan: (
      region: string, checkin: string, checkout: string,
    ) => Promise<{
      count: number; p25: number; median: number; p75: number; p90: number
      listings: { id: string; name?: string }[]
    }>
    saveMarket: (region: string, data: MarketData) => Promise<void>
    /** 팀(공동 호스트) 관리 — 소유자 전용 */
    team: {
      get: () => ReturnType<typeof api.getTeam>
      put: (members: TeamMember[]) => ReturnType<typeof api.putTeam>
    }
    /** 워크스페이스: 내 숙소 ↔ 공동 호스트로 초대받은 숙소 전환 */
    workspaces: {
      list: Workspace[]
      current: string | null
      switch: (sub: string | null) => void
    }
    /** 현재 워크스페이스에서의 내 권한 ('owner' = 전체) */
    perms: 'owner' | CoPerms
  } | null
  addListing: (listing: Listing) => void
  deleteListing: (id: string) => void
  updateListing: (id: string, patch: Partial<Listing>) => void
  setOverride: (o: PriceOverride) => void
  removeOverride: (listingId: string, date: string) => void
  resetAll: () => void
}

const StoreContext = createContext<Store | null>(null)

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

/**
 * 정산 메일에서 온 실제 금액을 예약에 매칭 — 체크인 날짜(+숙소 이름) 기준.
 * 매칭되는 예약이 없는 정산 내역(과거 백필 등)은 독립 예약으로 추가해 매출 차트에 잡히게 한다.
 */
function applyActuals(bookings: Booking[], actualsRaw: ActualPayout[], listings: Listing[]): Booking[] {
  if (!actualsRaw.length) return bookings
  // 과거에 잘못 추출된 숙소명("이용규칙을 업데이트" 등 안내문)은 이름 없음으로 취급
  const actuals = actualsRaw.map((a) =>
    a.listingName && /이용\s*규칙|업데이트|도착\s*정보|가이드|체크인\s*방법/.test(a.listingName)
      ? { ...a, listingName: null }
      : a,
  )
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()
  // [단체특가]·[오픈특가] 같은 프로모션 태그는 숙소 정체성이 아니므로 떼고 비교
  const stripTags = (s: string) => norm(s).replace(/\[[^\]]{1,14}\]/g, '')
  /** 이름 유사도: 공통 접두사 길이 (포함 관계면 짧은 쪽 전체) — 클수록 정확한 매칭 */
  const matchScore = (mailName: string, listingName: string): number => {
    const a = stripTags(mailName)
    const b = stripTags(listingName)
    if (!a || !b) return 0
    let i = 0
    while (i < a.length && i < b.length && a[i] === b[i]) i++
    if (a.includes(b) || b.includes(a)) i = Math.max(i, Math.min(a.length, b.length))
    return i
  }
  const MIN_SCORE = 6
  const matchListing = (a: ActualPayout): Listing | undefined => {
    if (a.listingName) {
      let best: Listing | undefined
      let bestScore = 0
      for (const l of listings) {
        const s = matchScore(a.listingName, l.name)
        if (s > bestScore) {
          bestScore = s
          best = l
        }
      }
      // 유사도가 낮으면 첫 숙소에 몰아넣지 않고 '미등록'으로 분류
      return bestScore >= MIN_SCORE ? best : undefined
    }
    return listings[0]
  }

  // iCal 예약의 자리표시 이름("Reserved" 등)은 메일에서 찾은 실제 게스트명으로 교체
  const isPlaceholderName = (name: string) => /^reserved$|^airbnb|^booking|게스트$/i.test(name.trim())
  const applyMatch = (b: Booking, a: ActualPayout): Booking => ({
    ...b,
    totalPrice: a.amount,
    actual: true,
    guestName: a.guestName && isPlaceholderName(b.guestName) ? a.guestName : b.guestName,
  })

  const usedActualIds = new Set<string>()
  const merged = [...bookings]
  const matchedIdx = new Set<number>()

  // 1차: 숙소명이 있는 정산부터 — 같은 날짜 예약 중 이름 유사도가 가장 높은 숙소에 매칭
  for (const a of actuals) {
    if (!a.checkIn || !a.listingName) continue
    let bestIdx = -1
    let bestScore = 0
    merged.forEach((b, i) => {
      if (matchedIdx.has(i) || b.checkIn !== a.checkIn) return
      const listing = listings.find((l) => l.id === b.listingId)
      if (!listing) return
      const s = matchScore(a.listingName as string, listing.name)
      if (s > bestScore) {
        bestScore = s
        bestIdx = i
      }
    })
    if (bestIdx >= 0 && bestScore >= MIN_SCORE) {
      matchedIdx.add(bestIdx)
      usedActualIds.add(a.id)
      merged[bestIdx] = applyMatch(merged[bestIdx], a)
    }
  }

  // 1.5차: 숙소명이 없는 정산은 남은 같은 날짜 예약에 배정
  for (const a of actuals) {
    if (usedActualIds.has(a.id) || !a.checkIn || a.listingName) continue
    const idx = merged.findIndex((b, i) => !matchedIdx.has(i) && b.checkIn === a.checkIn)
    if (idx >= 0) {
      matchedIdx.add(idx)
      usedActualIds.add(a.id)
      merged[idx] = applyMatch(merged[idx], a)
    }
  }

  // 2차: 미매칭 정산 내역 → 독립 예약으로 추가 (iCal에 없는 과거 매출·미등록 숙소 백필)
  for (const a of actuals) {
    if (usedActualIds.has(a.id) || !a.checkIn) continue
    const listing = matchListing(a)
    if (!listing && !a.listingName) continue
    merged.push({
      id: `actual-${a.id}`,
      listingId: listing?.id ?? 'unknown',
      srcListingName: listing ? undefined : (a.listingName ?? undefined),
      guestName: a.guestName ?? (a.channel === 'booking' ? 'Booking.com 게스트' : 'Airbnb 게스트'),
      channel: a.channel ?? 'airbnb',
      checkIn: a.checkIn,
      nights: a.nights ?? 1, // 메일에서 박수를 못 얻으면 1박으로 집계 (매출 금액은 정확)
      totalPrice: a.amount,
      status: 'confirmed',
      source: 'ical',
      actual: true,
    })
  }
  return merged
}

/** iCal 예약(가격 정보 없음)에 추천가 기반 추정 매출을 채운다 */
function estimatePrices(bookings: Booking[], listings: Listing[], overrides: PriceOverride[]): Booking[] {
  const empty = new Set<string>()
  return bookings.map((b) => {
    if (b.totalPrice > 0) return b
    const listing = listings.find((l) => l.id === b.listingId)
    if (!listing) return b
    let sum = 0
    for (let i = 0; i < b.nights; i++) {
      sum += computeDayPrice(listing, addDays(b.checkIn, i), overrides, empty).price
    }
    return { ...b, totalPrice: sum }
  })
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null | undefined>(undefined)
  const [authed, setAuthed] = useState(false)
  const [remoteLoaded, setRemoteLoaded] = useState(false)

  const [listings, setListings] = useState<Listing[]>(() => load(LS_LISTINGS, DEFAULT_LISTINGS))
  const [overrides, setOverrides] = useState<PriceOverride[]>(() => load(LS_OVERRIDES, []))
  const [remoteBookings, setRemoteBookings] = useState<Booking[]>([])
  const [actuals, setActuals] = useState<ActualPayout[]>([])
  const [inboundKey, setInboundKey] = useState<string | null>(null)
  const [verification, setVerification] = useState<VerificationMail | null>(null)
  const [market, setMarket] = useState<Record<string, MarketData>>({})
  const [formQuestions, setFormQuestions] = useState<FormQuestion[] | null>(null)
  const [formResponses, setFormResponses] = useState<Record<string, FormResponse>>({})
  const [formLinks, setFormLinks] = useState<Record<string, string>>({})
  const [inquiries, setInquiries] = useState<Inquiry[]>([])
  const [guestNotes, setGuestNotes] = useState<Record<string, string>>({})
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  // 선택된 워크스페이스는 첫 렌더 전에 API 모듈에 주입 (이후 모든 요청에 헤더로 실림)
  const [wsCurrent] = useState<string | null>(() => {
    const saved = localStorage.getItem(LS_WORKSPACE)
    setApiWorkspace(saved)
    return saved
  })

  // 1) 설정 로드 → 클라우드/데모 모드 결정
  useEffect(() => {
    loadConfig().then((cfg) => {
      if (cfg) {
        initAuth(cfg)
        getIdToken().then((t) => setAuthed(!!t))
      }
      setConfig(cfg)
    })
  }, [])

  // 워크스페이스 목록 로드 + 유효성 확인 (초대가 취소된 워크스페이스면 내 숙소로 복귀)
  useEffect(() => {
    if (!config || !authed) return
    api.getWorkspaces(config)
      .then((r) => {
        setWorkspaces(r.workspaces)
        if (wsCurrent && !r.workspaces.some((w) => w.sub === wsCurrent)) {
          localStorage.removeItem(LS_WORKSPACE)
          setApiWorkspace(null)
          window.location.reload()
        }
      })
      .catch(() => setWorkspaces([]))
  }, [config, authed, wsCurrent])

  // 2) 클라우드 모드: 로그인 후 서버 상태 로드 (처음이면 기본 숙소 시드)
  useEffect(() => {
    if (!config || !authed) return
    api
      .getState(config)
      .then((state) => {
        // 클라우드 모드는 실제 데이터만 사용 — 데모 숙소를 자동 생성하지 않는다
        setListings(state.listings ?? [])
        setOverrides(state.overrides)
        setRemoteBookings(state.bookings)
        setActuals(state.actuals ?? [])
        setInboundKey(state.inboundKey)
        setVerification(state.verification)
        setMarket(state.market ?? {})
        setFormQuestions(state.formQuestions)
        setFormResponses(state.formResponses ?? {})
        setFormLinks(state.formLinks ?? {})
        setInquiries(state.inquiries ?? [])
        setGuestNotes(state.guestNotes ?? {})
        setRemoteLoaded(true)
      })
      .catch(console.error)
  }, [config, authed])

  // 3) 저장: 데모 모드 → localStorage, 클라우드 모드 → API (800ms 디바운스)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    if (config === undefined) return
    if (!config) {
      localStorage.setItem(LS_LISTINGS, JSON.stringify(listings))
      localStorage.setItem(LS_OVERRIDES, JSON.stringify(overrides))
      return
    }
    if (!remoteLoaded) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      api.putState(config, listings, overrides).catch(console.error)
    }, 800)
    return () => clearTimeout(saveTimer.current)
  }, [listings, overrides, config, remoteLoaded])

  const bookings = useMemo(() => {
    if (!config) return generateBookings(listings)
    const estimated = estimatePrices(remoteBookings, listings, overrides)
    return applyActuals(estimated, actuals, listings)
  }, [config, remoteBookings, listings, overrides, actuals])

  const store: Store = useMemo(
    () => ({
      listings,
      bookings,
      overrides,
      cloud: config
        ? {
            email: currentUserEmail() ?? '',
            signOut: () => {
              cognitoSignOut()
              setAuthed(false)
              setRemoteLoaded(false)
            },
            syncNow: async () => {
              const res = await api.sync(config)
              setRemoteBookings(res.bookings)
              return res.bookings.length
            },
            importAirbnb: (url: string) => api.importAirbnb(config, url),
            emailDomain: config.emailDomain ?? null,
            inboundKey,
            requestInboundAddress: async () => {
              const res = await api.requestInboundAddress(config)
              setInboundKey(res.inboundKey)
              return res.inboundKey
            },
            mailBackfill: async (p) => {
              await api.mailBackfill(config, p)
            },
            actualsCount: actuals.length,
            actuals,
            verification,
            market,
            formQuestions,
            formResponses,
            formLinks,
            smart: {
              get: () => api.getSmartHome(config),
              put: (patch) => api.putSmartHome(config, patch),
              listDevices: () => api.listSmartDevices(config),
              status: () => api.smartStatus(config),
              command: (p) => api.smartCommand(config, p),
              history: () => api.smartHistory(config),
              oauthUrl: () => api.stOauthUrl(config),
            },
            guestNotes,
            saveGuestNote: async (bookingId: string, note: string) => {
              await api.putGuestNote(config, bookingId, note)
              setGuestNotes((prev) => {
                const next = { ...prev }
                if (note.trim()) next[bookingId] = note.trim()
                else delete next[bookingId]
                return next
              })
            },
            inquiries,
            publishPage: async (payload) => {
              const res = await api.publishPage(config, payload)
              return res.url
            },
            saveFormQuestions: async (questions: FormQuestion[]) => {
              await api.putFormQuestions(config, questions)
              setFormQuestions(questions)
            },
            createFormLink: async (b) => {
              const res = await api.createFormLink(config, b)
              setFormLinks((prev) => ({ ...prev, [b.bookingId]: res.token }))
              return res.token
            },
            marketScan: (region: string, checkin: string, checkout: string) =>
              api.marketScan(config, region, checkin, checkout),
            saveMarket: async (region: string, data: MarketData) => {
              await api.putMarket(config, region, data)
              setMarket((prev) => ({ ...prev, [region]: data }))
            },
            team: {
              get: () => api.getTeam(config),
              put: (members: TeamMember[]) => api.putTeam(config, members),
            },
            workspaces: {
              list: workspaces,
              current: wsCurrent,
              switch: (sub: string | null) => {
                if (sub) localStorage.setItem(LS_WORKSPACE, sub)
                else localStorage.removeItem(LS_WORKSPACE)
                window.location.reload()
              },
            },
            perms: wsCurrent
              ? (workspaces.find((w) => w.sub === wsCurrent)?.perms ?? {})
              : ('owner' as const),
          }
        : null,
      addListing: (listing) => setListings((prev) => [...prev, listing]),
      deleteListing: (id) => {
        setListings((prev) => prev.filter((l) => l.id !== id))
        setOverrides((prev) => prev.filter((o) => o.listingId !== id))
        setRemoteBookings((prev) => prev.filter((b) => b.listingId !== id))
      },
      updateListing: (id, patch) =>
        setListings((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l))),
      setOverride: (o) =>
        setOverrides((prev) => [
          ...prev.filter((p) => !(p.listingId === o.listingId && p.date === o.date)),
          o,
        ]),
      removeOverride: (listingId, date) =>
        setOverrides((prev) => prev.filter((p) => !(p.listingId === listingId && p.date === date))),
      resetAll: () => {
        setListings(DEFAULT_LISTINGS)
        setOverrides([])
      },
    }),
    [listings, bookings, overrides, config, inboundKey, actuals, verification, market, formQuestions, formResponses, formLinks, inquiries, guestNotes, workspaces, wsCurrent],
  )

  if (config === undefined) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400">불러오는 중…</div>
  }
  if (config && !authed) {
    return <Login onLogin={() => setAuthed(true)} />
  }
  if (config && !remoteLoaded) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400">데이터 동기화 중…</div>
  }
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}

export { bookedDateSet }
