import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Listing, Booking, PriceOverride } from '../types'
import { DEFAULT_LISTINGS, generateBookings } from '../data/mock'

const LS_LISTINGS = 'stayprice.listings.v1'
const LS_OVERRIDES = 'stayprice.overrides.v1'

interface Store {
  listings: Listing[]
  bookings: Booking[]
  overrides: PriceOverride[]
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

export function StoreProvider({ children }: { children: ReactNode }) {
  const [listings, setListings] = useState<Listing[]>(() => load(LS_LISTINGS, DEFAULT_LISTINGS))
  const [overrides, setOverrides] = useState<PriceOverride[]>(() => load(LS_OVERRIDES, []))

  useEffect(() => {
    localStorage.setItem(LS_LISTINGS, JSON.stringify(listings))
  }, [listings])
  useEffect(() => {
    localStorage.setItem(LS_OVERRIDES, JSON.stringify(overrides))
  }, [overrides])

  const bookings = useMemo(() => generateBookings(listings), [listings])

  const store: Store = useMemo(
    () => ({
      listings,
      bookings,
      overrides,
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
    [listings, bookings, overrides],
  )

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
