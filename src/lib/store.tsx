import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Listing, Booking, PriceOverride } from '../types'
import { DEFAULT_LISTINGS, generateBookings, bookedDateSet } from '../data/mock'
import { computeDayPrice } from './pricing'
import { addDays } from './date'
import type { AppConfig } from './config'
import { loadConfig } from './config'
import { initAuth, getIdToken, signOut as cognitoSignOut, currentUserEmail } from './auth'
import { api } from './api'
import Login from '../pages/Login'

const LS_LISTINGS = 'stayprice.listings.v1'
const LS_OVERRIDES = 'stayprice.overrides.v1'

interface Store {
  listings: Listing[]
  bookings: Booking[]
  overrides: PriceOverride[]
  /** null = 데모(로컬) 모드, 아니면 AWS 클라우드 모드 */
  cloud: { email: string; signOut: () => void; syncNow: () => Promise<number> } | null
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
        if (state.listings && state.listings.length > 0) {
          setListings(state.listings)
        } else {
          setListings(DEFAULT_LISTINGS)
          api.putState(config, DEFAULT_LISTINGS, []).catch(console.error)
        }
        setOverrides(state.overrides)
        setRemoteBookings(state.bookings)
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
    if (config) return estimatePrices(remoteBookings, listings, overrides)
    return generateBookings(listings)
  }, [config, remoteBookings, listings, overrides])

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
          }
        : null,
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
    [listings, bookings, overrides, config],
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
