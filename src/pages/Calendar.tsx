import { useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { bookedDateSet } from '../data/mock'
import { computeMonthPrices } from '../lib/pricing'
import { holidayName } from '../data/holidays'
import { formatManwon, formatKRW, WEEKDAY_KO } from '../lib/date'
import { Card, PageTitle } from '../components/ui'
import type { DayPrice } from '../types'

export default function Calendar() {
  const { listings, bookings, overrides, setOverride, removeOverride } = useStore()
  const activeListings = listings.filter((l) => l.active)
  const [listingId, setListingId] = useState(activeListings[0]?.id ?? '')
  const now = new Date()
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 })
  const [selected, setSelected] = useState<DayPrice | null>(null)
  const [editPrice, setEditPrice] = useState('')

  const listing = listings.find((l) => l.id === listingId) ?? activeListings[0]

  const days = useMemo(() => {
    if (!listing) return []
    return computeMonthPrices(listing, ym.y, ym.m, overrides, bookedDateSet(bookings, listing.id))
  }, [listing, ym, overrides, bookings])

  const firstDow = new Date(ym.y, ym.m - 1, 1).getDay()

  const moveMonth = (delta: number) => {
    setSelected(null)
    setYm(({ y, m }) => {
      const d = new Date(y, m - 1 + delta, 1)
      return { y: d.getFullYear(), m: d.getMonth() + 1 }
    })
  }

  const monthAvg = days.length ? days.reduce((s, d) => s + d.price, 0) / days.length : 0

  if (!listing) {
    return (
      <div>
        <PageTitle title="가격 캘린더" />
        <Card>활성화된 숙소가 없습니다. 숙소 관리에서 숙소를 활성화하세요.</Card>
      </div>
    )
  }

  return (
    <div>
      <PageTitle title="가격 캘린더" desc="날짜별 자동 추천 가격 — 날짜를 클릭하면 상세 근거와 수동 지정이 가능합니다" />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          value={listing.id}
          onChange={(e) => { setListingId(e.target.value); setSelected(null) }}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          {activeListings.map((l) => (
            <option key={l.id} value={l.id}>{l.thumbnail} {l.name}</option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <button onClick={() => moveMonth(-1)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">←</button>
          <div className="font-semibold w-28 text-center">{ym.y}년 {ym.m}월</div>
          <button onClick={() => moveMonth(1)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">→</button>
        </div>
        <div className="text-sm text-slate-500 ml-auto">이달 평균 추천가 <span className="font-semibold text-slate-900">{formatKRW(monthAvg)}</span></div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 !p-3">
          <div className="grid grid-cols-7 text-center text-xs font-medium text-slate-500 mb-1">
            {WEEKDAY_KO.map((d, i) => (
              <div key={d} className={`py-2 ${i === 0 ? 'text-rose-500' : i === 6 ? 'text-blue-500' : ''}`}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}
            {days.map((d) => {
              const dayNum = Number(d.date.slice(8))
              const hol = holidayName(d.date)
              const isSel = selected?.date === d.date
              return (
                <button
                  key={d.date}
                  onClick={() => { setSelected(d); setEditPrice(String(d.price)) }}
                  className={`rounded-lg border p-1.5 text-left min-h-[64px] transition-colors ${
                    isSel ? 'border-rose-400 ring-2 ring-rose-200' : 'border-slate-100 hover:border-slate-300'
                  } ${d.isBooked ? 'bg-slate-100' : hol ? 'bg-amber-50' : 'bg-white'}`}
                >
                  <div className={`text-xs font-medium ${hol ? 'text-rose-600' : 'text-slate-600'}`}>
                    {dayNum}
                    {hol && <span className="block text-[9px] leading-tight truncate">{hol}</span>}
                  </div>
                  <div className={`text-xs font-bold mt-0.5 ${d.isOverride ? 'text-violet-600' : 'text-slate-900'}`}>
                    {formatManwon(d.price)}
                  </div>
                  {d.isBooked && <div className="text-[9px] text-slate-500">예약됨</div>}
                </button>
              )
            })}
          </div>
          <div className="flex gap-4 mt-3 px-1 text-[11px] text-slate-500">
            <span><span className="inline-block w-2.5 h-2.5 rounded bg-amber-100 border border-amber-300 mr-1" />공휴일</span>
            <span><span className="inline-block w-2.5 h-2.5 rounded bg-slate-200 mr-1" />예약됨</span>
            <span><span className="inline-block w-2.5 h-2.5 rounded bg-violet-100 border border-violet-300 mr-1" />수동 지정가(보라색 숫자)</span>
          </div>
        </Card>

        <Card>
          {selected ? (
            <div>
              <div className="font-semibold mb-1">{selected.date} 가격 상세</div>
              <div className="text-2xl font-bold text-rose-600 mb-3">{formatKRW(selected.price)}</div>
              <div className="text-xs font-medium text-slate-500 mb-2">적용된 규칙</div>
              <ul className="space-y-1.5 mb-4">
                {selected.factors.map((f) => (
                  <li key={f} className="text-sm bg-slate-50 rounded-lg px-3 py-1.5">{f}</li>
                ))}
              </ul>
              <div className="text-xs font-medium text-slate-500 mb-2">수동 가격 지정</div>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={editPrice}
                  onChange={(e) => setEditPrice(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  step={1000}
                />
                <button
                  onClick={() => {
                    const p = Number(editPrice)
                    if (p > 0) {
                      setOverride({ listingId: listing.id, date: selected.date, price: p })
                      setSelected({ ...selected, price: p, isOverride: true, factors: ['수동 지정가'] })
                    }
                  }}
                  className="shrink-0 rounded-lg bg-rose-500 text-white px-4 py-2 text-sm font-medium hover:bg-rose-600"
                >
                  저장
                </button>
              </div>
              {selected.isOverride && (
                <button
                  onClick={() => { removeOverride(listing.id, selected.date); setSelected(null) }}
                  className="mt-2 text-xs text-slate-500 underline hover:text-rose-600"
                >
                  수동 지정 해제 (자동 가격으로 복귀)
                </button>
              )}
            </div>
          ) : (
            <div className="text-sm text-slate-400 py-8 text-center">
              캘린더에서 날짜를 클릭하면<br />가격 산정 근거를 확인할 수 있습니다
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
