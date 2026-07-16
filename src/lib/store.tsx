import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Listing, Booking, PriceOverride, ActualPayout } from '../types'
import { DEFAULT_LISTINGS, generateBookings, bookedDateSet } from '../data/mock'
import { computeDayPrice } from './pricing'
import { addDays } from './date'
import type { AppConfig } from './config'
import { loadConfig } from './config'
import { initAuth, getIdToken, signOut as cognitoSignOut, currentUserEmail } from './auth'
import { api } from './api'
import type { ImportedListing, VerificationMail } from './api'
import Login from '../pages/Login'

const LS_LISTINGS = 'stayprice.listings.v1'
const LS_OVERRIDES = 'stayprice.overrides.v1'

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
    actualsCount: number
    verification: VerificationMail | null
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

/** 정산 메일에서 온 실제 금액을 예약에 매칭 — 체크인 날짜(+숙소 이름) 기준 */
function applyActuals(bookings: Booking[], actuals: ActualPayout[], listings: Listing[]): Booking[] {
  if (!actuals.length) return bookings
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()
  return bookings.map((b) => {
    const match = actuals.find((a) => {
      if (!a.checkIn || a.checkIn !== b.checkIn) return false
      if (!a.listingName || listings.length <= 1) return true
      const listing = listings.find((l) => l.id === b.listingId)
      return listing ? norm(a.listingName).includes(norm(listing.name).slice(0, 10)) ||
        norm(listing.name).includes(norm(a.listingName).slice(0, 10)) : true
    })
    return match ? { ...b, totalPrice: match.amount, actual: true } : b
  })
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
            actualsCount: actuals.length,
            verification,
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
    [listings, bookings, overrides, config, inboundKey, actuals, verification],
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
