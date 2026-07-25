import { useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { bookedDateSet } from '../data/mock'
import { computeMonthPrices } from '../lib/pricing'
import { holidayName } from '../data/holidays'
import { formatManwon, formatKRW, WEEKDAY_KO, addDays } from '../lib/date'
import { Card, PageTitle } from '../components/ui'
import type { DayPrice, Booking } from '../types'

/** 2026-07-25 → "7월 25일 (토)" */
function fmtKoDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${m}월 ${d}일 (${WEEKDAY_KO[new Date(y, m - 1, d).getDay()]})`
}

const isPlaceholder = (name: string) => /^reserved$|^airbnb|^booking|게스트$/i.test(name.trim())

export default function Calendar() {
  const { listings, bookings, overrides, setOverride, removeOverride, cloud } = useStore()
  const activeListings = listings.filter((l) => l.active)
  const [listingId, setListingId] = useState(activeListings[0]?.id ?? '')
  const now = new Date()
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 })
  const [selected, setSelected] = useState<DayPrice | null>(null)
  const [editPrice, setEditPrice] = useState('')
  const [memoText, setMemoText] = useState('')
  const [memoBookingId, setMemoBookingId] = useState('')
  const [memoBusy, setMemoBusy] = useState(false)

  const listing = listings.find((l) => l.id === listingId) ?? activeListings[0]

  const days = useMemo(() => {
    if (!listing) return []
    return computeMonthPrices(listing, ym.y, ym.m, overrides, bookedDateSet(bookings, listing.id))
  }, [listing, ym, overrides, bookings])

  // 날짜 → 해당 예약 (게스트명 표시·예약 상세 패널용)
  const bookingMap = useMemo(() => {
    const m = new Map<string, Booking>()
    if (!listing) return m
    for (const b of bookings) {
      if (b.listingId !== listing.id || b.status === 'cancelled') continue
      for (let i = 0; i < b.nights; i++) m.set(addDays(b.checkIn, i), b)
    }
    return m
  }, [bookings, listing])

  const selectedBooking = selected ? bookingMap.get(selected.date) ?? null : null
  const selResp = selectedBooking && cloud ? cloud.formResponses[selectedBooking.id] : undefined
  const selNote = selectedBooking && cloud ? cloud.guestNotes[selectedBooking.id] : undefined

  // 이달 숙소별 수익 요약 (체크인 기준)
  const monthKey = `${ym.y}-${String(ym.m).padStart(2, '0')}`
  const monthRows = useMemo(() => {
    return listings
      .filter((l) => l.active)
      .map((l) => {
        const bs = bookings.filter(
          (b) => b.listingId === l.id && b.status !== 'cancelled' && b.checkIn.slice(0, 7) === monthKey,
        )
        return {
          l,
          count: bs.length,
          nights: bs.reduce((s, b) => s + b.nights, 0),
          revenue: bs.reduce((s, b) => s + b.totalPrice, 0),
          actuals: bs.filter((b) => b.actual).length,
        }
      })
  }, [listings, bookings, monthKey])
  const monthTotal = monthRows.reduce((s, r) => s + r.revenue, 0)

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
                  {d.isBooked && (() => {
                    const b = bookingMap.get(d.date)
                    const label = b && !isPlaceholder(b.guestName) ? b.guestName.slice(0, 6) : '예약됨'
                    return (
                      <div className="text-[9px] font-medium text-teal-700 bg-teal-50 rounded px-1 truncate">
                        {label}
                      </div>
                    )
                  })()}
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
          {selected && selectedBooking ? (
            <div className="mb-5 pb-5 border-b border-slate-100">
              <div className="text-lg font-bold mb-0.5">예약</div>
              <div className="text-xs text-slate-400 mb-3">
                {selResp?.answers.guests ? `게스트 ${selResp.answers.guests}` : '게스트'} · {selectedBooking.nights}박
                {selectedBooking.actual && <span className="text-emerald-600 ml-1">· 실측 금액 ✓</span>}
              </div>
              <div className="flex items-center justify-between mb-3">
                <div className="font-semibold text-base">
                  {isPlaceholder(selectedBooking.guestName) ? '게스트 (이름 미확인)' : selectedBooking.guestName}
                </div>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  selectedBooking.channel === 'booking' ? 'bg-blue-50 text-blue-600' : 'bg-rose-50 text-rose-500'
                }`}>
                  {selectedBooking.channel === 'booking' ? '부킹닷컴' : '에어비앤비'}
                </span>
              </div>
              <div className="text-sm divide-y divide-slate-100">
                <div className="flex justify-between py-2">
                  <span className="text-slate-500">체크인</span>
                  <span className="font-medium">{fmtKoDate(selectedBooking.checkIn)}</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-slate-500">체크아웃</span>
                  <span className="font-medium">{fmtKoDate(addDays(selectedBooking.checkIn, selectedBooking.nights))}</span>
                </div>
                {selResp?.answers.checkinTime && (
                  <div className="flex justify-between py-2">
                    <span className="text-slate-500">도착 예정</span>
                    <span className="font-medium">{selResp.answers.checkinTime}</span>
                  </div>
                )}
                {selResp?.answers.phone && (
                  <div className="flex justify-between py-2">
                    <span className="text-slate-500">연락처</span>
                    <span className="font-medium">…{selResp.answers.phone}</span>
                  </div>
                )}
                <div className="flex justify-between py-2">
                  <span className="text-slate-500">총 입금액</span>
                  <span className="font-bold">{formatKRW(selectedBooking.totalPrice)}</span>
                </div>
              </div>
              {cloud && (
                <div className="mt-2">
                  <div className="text-xs font-medium text-slate-500 mb-1">비공개 메모</div>
                  {memoBookingId === selectedBooking.id ? (
                    <div className="flex gap-1.5">
                      <input
                        value={memoText}
                        onChange={(e) => setMemoText(e.target.value)}
                        placeholder="게스트에게 보이지 않는 메모"
                        className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                        onKeyDown={async (e) => {
                          if (e.key !== 'Enter') return
                          setMemoBusy(true)
                          try { await cloud.saveGuestNote(selectedBooking.id, memoText) } finally { setMemoBusy(false); setMemoBookingId('') }
                        }}
                      />
                      <button
                        onClick={async () => {
                          setMemoBusy(true)
                          try { await cloud.saveGuestNote(selectedBooking.id, memoText) } finally { setMemoBusy(false); setMemoBookingId('') }
                        }}
                        disabled={memoBusy}
                        className="rounded-lg bg-slate-800 text-white px-3 py-1.5 text-xs disabled:opacity-50"
                      >
                        저장
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setMemoBookingId(selectedBooking.id); setMemoText(selNote ?? '') }}
                      className={`w-full text-left rounded-lg border px-2.5 py-1.5 text-xs ${
                        selNote ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-dashed border-slate-300 text-slate-400 hover:border-slate-400'
                      }`}
                    >
                      {selNote ?? '이 예약에 대한 메모를 작성하세요'}
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : null}
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
              캘린더에서 날짜를 클릭하면<br />가격 산정 근거와 예약 상세를 확인할 수 있습니다
            </div>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div className="font-semibold">💰 {ym.y}년 {ym.m}월 숙소별 수익 <span className="text-xs font-normal text-slate-400">(체크인 기준 · ← → 로 월 이동)</span></div>
          <div className="text-sm">합계 <b className="text-rose-600">{formatKRW(monthTotal)}</b></div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-400 border-b border-slate-100">
                <th className="text-left py-2 pr-3 font-medium">숙소</th>
                <th className="text-right py-2 px-3 font-medium">예약</th>
                <th className="text-right py-2 px-3 font-medium">박수</th>
                <th className="text-right py-2 px-3 font-medium">수익</th>
                <th className="text-right py-2 pl-3 font-medium">비중</th>
              </tr>
            </thead>
            <tbody>
              {monthRows.map((r) => (
                <tr
                  key={r.l.id}
                  onClick={() => { setListingId(r.l.id); setSelected(null) }}
                  className={`border-b border-slate-50 cursor-pointer hover:bg-slate-50 ${r.l.id === listing.id ? 'bg-rose-50/50' : ''}`}
                >
                  <td className="py-2.5 pr-3 max-w-64 truncate">{r.l.thumbnail} {r.l.name}</td>
                  <td className="py-2.5 px-3 text-right">{r.count}건</td>
                  <td className="py-2.5 px-3 text-right">{r.nights}박</td>
                  <td className="py-2.5 px-3 text-right font-semibold">
                    {formatKRW(r.revenue)}
                    {r.actuals > 0 && <span className="text-[10px] text-emerald-600 ml-1">실측{r.actuals}</span>}
                  </td>
                  <td className="py-2.5 pl-3 text-right text-slate-500">
                    {monthTotal > 0 ? `${Math.round((r.revenue / monthTotal) * 100)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-400 mt-2">
          숙소 행을 클릭하면 위 캘린더가 해당 숙소로 전환됩니다. 주별·연별 추이는 대시보드, 기간별 게스트 상세는 게스트 관리에서 볼 수 있어요.
        </p>
      </Card>
    </div>
  )
}
