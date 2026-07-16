import { useMemo } from 'react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
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

  // 주간 매출 추이 (지난 8주)
  const weeklyRevenue = useMemo(() => {
    const weeks: { week: string; revenue: number }[] = []
    for (let w = 7; w >= 0; w--) {
      const start = addDays(today, -(w + 1) * 7)
      const end = addDays(today, -w * 7)
      const sum = bookings
        .filter((b) => b.status === 'confirmed' && b.checkIn >= start && b.checkIn < end)
        .reduce((s, b) => s + b.totalPrice, 0)
      weeks.push({ week: start.slice(5).replace('-', '/'), revenue: sum })
    }
    return weeks
  }, [bookings, today])

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
          <div className="font-semibold mb-4">주간 매출 추이 (최근 8주)</div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={weeklyRevenue} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="week" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
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
                    <div className="font-semibold">{formatKRW(b.totalPrice)}</div>
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
