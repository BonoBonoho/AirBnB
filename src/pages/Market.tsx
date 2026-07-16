import { useMemo, useState } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar,
} from 'recharts'
import { useStore } from '../lib/store'
import { MARKET_DATA, bookedDateSet } from '../data/mock'
import { addDays, todayStr, formatKRW } from '../lib/date'
import { computeDayPrice } from '../lib/pricing'
import { Card, PageTitle, StatCard } from '../components/ui'

export default function Market() {
  const { listings, bookings, overrides } = useStore()
  const activeListings = listings.filter((l) => l.active)
  const [listingId, setListingId] = useState(activeListings[0]?.id ?? '')
  const listing = listings.find((l) => l.id === listingId) ?? activeListings[0]
  const today = todayStr()

  const market = listing ? MARKET_DATA[listing.region] : undefined

  const myStats = useMemo(() => {
    if (!listing) return { avgPrice: 0, occupancy: 0 }
    const set = bookedDateSet(bookings, listing.id)
    let sum = 0
    let booked = 0
    for (let i = 0; i < 30; i++) {
      const d = addDays(today, i)
      sum += computeDayPrice(listing, d, overrides, set).price
      if (set.has(d)) booked++
    }
    return { avgPrice: sum / 30, occupancy: Math.round((booked / 30) * 100) }
  }, [listing, bookings, overrides, today])

  const trendData = useMemo(() => {
    if (!market) return []
    return market.trend.map((v, i) => ({
      week: `${i - market.trend.length + 1}주`,
      시장점유율: v,
    }))
  }, [market])

  const compareData = useMemo(() => {
    if (!market) return []
    return [
      { name: '평균 가격(만원)', 내숙소: Math.round(myStats.avgPrice / 10000), 지역평균: Math.round(market.avgPrice / 10000) },
      { name: '점유율(%)', 내숙소: myStats.occupancy, 지역평균: market.occupancyPct },
    ]
  }, [market, myStats])

  if (!listing) {
    return (
      <div>
        <PageTitle title="시장 분석" />
        <Card>활성화된 숙소가 없습니다. 숙소 관리에서 숙소를 등록·활성화하세요.</Card>
      </div>
    )
  }

  if (!market) {
    return (
      <div>
        <PageTitle title="시장 분석" desc="지역 경쟁 숙소 대비 내 숙소의 가격·점유율 포지션" />
        <select
          value={listing.id}
          onChange={(e) => setListingId(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm mb-4"
        >
          {activeListings.map((l) => (
            <option key={l.id} value={l.id}>{l.thumbnail} {l.name} ({l.region})</option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-4 mb-6 max-w-xl">
          <StatCard label="내 평균 추천가 (30일)" value={formatKRW(myStats.avgPrice)} />
          <StatCard label="내 점유율 (30일)" value={`${myStats.occupancy}%`} />
        </div>
        <Card>
          <div className="font-semibold mb-1">📊 "{listing.region}" 지역 시장 데이터 준비 중</div>
          <p className="text-sm text-slate-500">
            이 지역의 경쟁 숙소 가격·점유율 데이터는 아직 수집되지 않았습니다.
            시장 데이터 수집(경쟁 숙소 분석)은 로드맵에 있는 다음 단계 기능입니다.
          </p>
        </Card>
      </div>
    )
  }

  const priceDiffPct = Math.round(((myStats.avgPrice - market.avgPrice) / market.avgPrice) * 100)

  return (
    <div>
      <PageTitle title="시장 분석" desc="지역 경쟁 숙소 대비 내 숙소의 가격·점유율 포지션 (데모 데이터)" />

      <select
        value={listing.id}
        onChange={(e) => setListingId(e.target.value)}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm mb-4"
      >
        {activeListings.map((l) => (
          <option key={l.id} value={l.id}>{l.thumbnail} {l.name} ({l.region})</option>
        ))}
      </select>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label={`${listing.region} 경쟁 숙소`} value={`${market.competitorCount}곳`} />
        <StatCard label="지역 평균 1박 가격" value={formatKRW(market.avgPrice)} />
        <StatCard
          label="내 평균 추천가 (30일)"
          value={formatKRW(myStats.avgPrice)}
          sub={`지역 대비 ${priceDiffPct >= 0 ? '+' : ''}${priceDiffPct}%`}
          accent={Math.abs(priceDiffPct) > 20 ? 'text-amber-600' : 'text-emerald-600'}
        />
        <StatCard
          label="점유율 비교"
          value={`${myStats.occupancy}% vs ${market.occupancyPct}%`}
          sub="내 숙소 vs 지역 평균"
          accent={myStats.occupancy >= market.occupancyPct ? 'text-emerald-600' : 'text-rose-600'}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <div className="font-semibold mb-4">지역 점유율 추이 (최근 7주)</div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="week" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} unit="%" width={40} domain={[40, 90]} />
                <Tooltip formatter={(v) => [`${v}%`]} />
                <Line type="monotone" dataKey="시장점유율" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <div className="font-semibold mb-4">내 숙소 vs 지역 평균</div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={compareData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={40} />
                <Tooltip />
                <Bar dataKey="내숙소" fill="#f43f5e" radius={[4, 4, 0, 0]} maxBarSize={48} />
                <Bar dataKey="지역평균" fill="#cbd5e1" radius={[4, 4, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-slate-400 mt-2">
            {priceDiffPct > 15
              ? '💡 지역 평균보다 가격이 높습니다. 점유율이 낮다면 기본가 하향을 검토하세요.'
              : priceDiffPct < -15
                ? '💡 지역 평균보다 가격이 낮습니다. 기본가를 올려 수익을 높일 여지가 있습니다.'
                : '✅ 가격이 지역 평균과 비슷한 수준입니다.'}
          </p>
        </Card>
      </div>
    </div>
  )
}
