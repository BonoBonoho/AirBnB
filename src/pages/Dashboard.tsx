import { useMemo, useState } from 'react'
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { useStore } from '../lib/store'
import { CHANNEL_INFO, bookedDateSet } from '../data/mock'
import { addDays, todayStr, formatKRW, formatManwon, daysBetween, WEEKDAY_KO, dayOfWeek } from '../lib/date'
import { Card, PageTitle, StatCard, ChannelBadge } from '../components/ui'
import { holidayName } from '../data/holidays'

export default function Dashboard() {
  const { listings, bookings } = useStore()
  const today = todayStr()
  const activeListings = listings.filter((l) => l.active)

  const stats = useMemo(() => {
    const next30 = bookings.filter(
      (b) => b.status !== 'cancelled' && b.checkIn >= today && daysBetween(today, b.checkIn) < 30,
    )
    const revenue30 = next30.reduce((s, b) => s + b.totalPrice, 0)

    // 향후 30일 점유율
    let bookedNights = 0
    for (const l of activeListings) {
      const set = bookedDateSet(bookings, l.id)
      for (let i = 0; i < 30; i++) if (set.has(addDays(today, i))) bookedNights++
    }
    const occupancy = activeListings.length
      ? Math.round((bookedNights / (activeListings.length * 30)) * 100)
      : 0

    const pending = bookings.filter((b) => b.status === 'pending').length

    const past30 = bookings.filter(
      (b) => b.status === 'confirmed' && b.checkIn < today && daysBetween(b.checkIn, today) <= 30,
    )
    const adr = past30.length
      ? past30.reduce((s, b) => s + b.totalPrice / b.nights, 0) / past30.length
      : 0

    return { revenue30, occupancy, pending, adr, upcomingCount: next30.length }
  }, [bookings, activeListings, today])

  // 매출 추이 — 주별/월별/년별 (체크인 기준, 예정 예약 포함)
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('week')
  const revenueSeries = useMemo(() => {
    const valid = bookings.filter((b) => b.status !== 'cancelled')
    const sumRange = (start: string, end: string) =>
      valid.filter((b) => b.checkIn >= start && b.checkIn < end).reduce((s, b) => s + b.totalPrice, 0)

    if (period === 'week') {
      // 지난 8주 + 앞으로 4주
      const out: { label: string; revenue: number; future: boolean }[] = []
      for (let w = -8; w < 4; w++) {
        const start = addDays(today, w * 7)
        out.push({
          label: start.slice(5).replace('-', '/'),
          revenue: sumRange(start, addDays(start, 7)),
          future: w >= 0,
        })
      }
      return out
    }

    const [y, m] = today.split('-').map(Number)
    if (period === 'month') {
      // 지난 9개월 + 이번 달 + 앞으로 2개월
      const out: { label: string; revenue: number; future: boolean }[] = []
      for (let i = -9; i <= 2; i++) {
        const d = new Date(y, m - 1 + i, 1)
        const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
        const e = new Date(y, m + i, 1)
        const end = `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}-01`
        out.push({
          label: `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}`,
          revenue: sumRange(start, end),
          future: i > 0,
        })
      }
      return out
    }

    // 년별: 예약이 존재하는 모든 연도
    const years = valid.map((b) => Number(b.checkIn.slice(0, 4)))
    const minY = years.length ? Math.min(...years) : y
    const maxY = years.length ? Math.max(...years) : y
    const out: { label: string; revenue: number; future: boolean }[] = []
    for (let yy = minY; yy <= maxY; yy++) {
      out.push({
        label: `${yy}년`,
        revenue: sumRange(`${yy}-01-01`, `${yy + 1}-01-01`),
        future: yy > y,
      })
    }
    return out
  }, [bookings, today, period])

  const upcoming = useMemo(
    () =>
      bookings
        .filter((b) => b.status !== 'cancelled' && b.checkIn >= today)
        .sort((a, b) => a.checkIn.localeCompare(b.checkIn))
        .slice(0, 8),
    [bookings, today],
  )

  const nextHoliday = useMemo(() => {
    for (let i = 0; i < 120; i++) {
      const d = addDays(today, i)
      const name = holidayName(d)
      if (name) return { date: d, name, dday: i }
    }
    return null
  }, [today])

  return (
    <div>
      <PageTitle
        title="대시보드"
        desc={`${today} (${WEEKDAY_KO[dayOfWeek(today)]}) · 활성 숙소 ${activeListings.length}곳 기준`}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="향후 30일 예상 매출" value={formatKRW(stats.revenue30)} accent="text-rose-600" />
        <StatCard label="향후 30일 점유율" value={`${stats.occupancy}%`} sub={`예약 ${stats.upcomingCount}건`} />
        <StatCard label="평균 일일 요금 (ADR)" value={formatKRW(stats.adr)} sub="최근 30일 체크인 기준" />
        <StatCard label="승인 대기 예약" value={`${stats.pending}건`} accent={stats.pending > 0 ? 'text-amber-600' : 'text-slate-900'} />
      </div>

      {nextHoliday && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm">
          <span className="font-semibold text-amber-800">
            📌 다가오는 연휴: {nextHoliday.name} ({nextHoliday.date}, D-{nextHoliday.dday})
          </span>
          <span className="text-amber-700"> — 공휴일 할증이 자동 적용됩니다. 가격 캘린더에서 확인하세요.</span>
        </div>
      )}

      <div className="grid lg:grid-cols-5 gap-4">
        <Card className="lg:col-span-3">
          <div className="flex items-center justify-between mb-4">
            <div className="font-semibold">매출 추이 <span className="text-xs font-normal text-slate-400">(체크인 기준 · 옅은 색은 예정)</span></div>
            <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
              {([['week', '주별'], ['month', '월별'], ['year', '년별']] as const).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setPeriod(k)}
                  className={`rounded-md px-3 py-1.5 transition-colors ${
                    period === k ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              {period === 'week' ? (
                <AreaChart data={revenueSeries} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => formatManwon(v)}
                    width={48}
                  />
                  <Tooltip formatter={(v) => [formatKRW(Number(v)), '매출']} labelFormatter={(l) => `${l} 주`} />
                  <Area type="monotone" dataKey="revenue" stroke="#f43f5e" strokeWidth={2} fill="url(#rev)" />
                </AreaChart>
              ) : (
                <BarChart data={revenueSeries} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => formatManwon(v)}
                    width={48}
                  />
                  <Tooltip formatter={(v) => [formatKRW(Number(v)), '매출']} />
                  <Bar dataKey="revenue" radius={[4, 4, 0, 0]} maxBarSize={44}>
                    {revenueSeries.map((d) => (
                      <Cell key={d.label} fill={d.future ? '#fda4af' : '#f43f5e'} />
                    ))}
                  </Bar>
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <div className="font-semibold mb-4">다가오는 예약</div>
          <div className="space-y-3">
            {upcoming.map((b) => {
              const listing = listings.find((l) => l.id === b.listingId)
              const ch = CHANNEL_INFO[b.channel]
              return (
                <div key={b.id} className="flex items-center justify-between text-sm">
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {b.guestName}
                      {b.status === 'pending' && (
                        <span className="ml-1.5 text-[11px] text-amber-600 font-semibold">대기중</span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 truncate">
                      {listing?.name} · {b.checkIn.slice(5).replace('-', '/')} · {b.nights}박
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <div className="font-semibold">
                      {formatKRW(b.totalPrice)}
                      {b.actual && (
                        <span className="ml-1 text-[10px] font-semibold text-emerald-600 align-middle" title="정산 메일 기준 실제 금액">
                          실제
                        </span>
                      )}
                    </div>
                    <ChannelBadge name={ch.name} color={ch.color} />
                  </div>
                </div>
              )
            })}
            {upcoming.length === 0 && <div className="text-sm text-slate-400">예약이 없습니다</div>}
          </div>
        </Card>
      </div>
    </div>
  )
}
