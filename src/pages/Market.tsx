import { useMemo, useState } from 'react'
import {
  ResponsiveContainer, ComposedChart, Line, Area, Scatter, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, BarChart, Bar,
} from 'recharts'
import { useStore } from '../lib/store'
import { MARKET_DATA, bookedDateSet } from '../data/mock'
import { addDays, todayStr, formatKRW, formatManwon, dayOfWeek } from '../lib/date'
import { computeDayPrice } from '../lib/pricing'
import { holidayName } from '../data/holidays'
import { Card, PageTitle, StatCard } from '../components/ui'
import type { Listing, MarketData } from '../types'

/** 스캔할 체크인 시점 (오늘 기준 일수) — 향후 8주 주중·주말 혼합 14개 */
const SCAN_OFFSETS = [2, 4, 7, 9, 11, 14, 17, 21, 25, 28, 35, 42, 49, 56]

function RealMarket({ listing }: { listing: Listing }) {
  const { cloud, overrides, bookings } = useStore()
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState('')
  const [scanError, setScanError] = useState('')
  const today = todayStr()

  const data = cloud?.market[listing.region]

  const runScan = async () => {
    if (!cloud) return
    setScanning(true)
    setScanError('')
    const points = []
    let competitors: { id: string; name?: string }[] = []
    let failed = 0
    for (let i = 0; i < SCAN_OFFSETS.length; i++) {
      const date = addDays(today, SCAN_OFFSETS[i])
      setProgress(`${i + 1}/${SCAN_OFFSETS.length} — ${date} 스캔 중…`)
      try {
        const p = await cloud.marketScan(listing.region, date, addDays(date, 1))
        points.push({ date, count: p.count, p25: p.p25, median: p.median, p75: p.p75, p90: p.p90 })
        if (p.listings.length > competitors.length) competitors = p.listings
      } catch {
        failed++
      }
    }
    if (points.length === 0) {
      setScanError('시장 데이터를 가져오지 못했습니다. 잠시 후 다시 시도하거나, 지역명을 더 일반적으로(예: "부산") 바꿔보세요.')
    } else {
      const payload: MarketData = { scannedAt: new Date().toISOString(), points, competitors }
      await cloud.saveMarket(listing.region, payload).catch(() => setScanError('저장 실패'))
      if (failed > 0) setScanError(`${failed}개 날짜는 표본 부족으로 제외됐습니다.`)
    }
    setProgress('')
    setScanning(false)
  }

  const chartData = useMemo(() => {
    if (!data) return []
    const set = bookedDateSet(bookings, listing.id)
    return data.points.map((p) => {
      const hol = holidayName(p.date)
      return {
        date: p.date.slice(5).replace('-', '/'),
        rawDate: p.date,
        시장중앙값: p.median,
        내추천가: computeDayPrice(listing, p.date, overrides, set).price,
        band1: [p.p25, p.median] as [number, number],
        band2: [p.median, p.p75] as [number, number],
        band3: [p.p75, p.p90 ?? p.p75] as [number, number],
        휴일: hol ? 0 : null, // 공휴일 마커 (0 위치에 보라 점)
        holidayName: hol,
        count: p.count,
      }
    })
  }, [data, listing, overrides, bookings])

  const summary = useMemo(() => {
    if (!data || data.points.length === 0) return null
    const medians = data.points.map((p) => p.median)
    const marketAvg = medians.reduce((s, v) => s + v, 0) / medians.length
    const myAvg = chartData.reduce((s, d) => s + d.내추천가, 0) / chartData.length
    const avgCount = Math.round(data.points.reduce((s, p) => s + p.count, 0) / data.points.length)
    const isWeekend = (date: string) => [5, 6].includes(dayOfWeek(date))
    const weekend = data.points.filter((p) => isWeekend(p.date)).map((p) => p.median)
    const weekday = data.points.filter((p) => !isWeekend(p.date)).map((p) => p.median)
    const avg = (arr: number[]) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0)
    return {
      marketAvg,
      myAvg,
      diffPct: Math.round(((myAvg - marketAvg) / marketAvg) * 100),
      avgCount,
      weekendMedian: avg(weekend),
      weekdayMedian: avg(weekday),
    }
  }, [data, chartData])

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <button
          onClick={runScan}
          disabled={scanning}
          className="rounded-lg bg-indigo-600 text-white px-4 py-2 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
        >
          {scanning ? progress || '스캔 중…' : data ? '🔄 다시 스캔' : '🔍 시장 스캔 시작'}
        </button>
        {data && (
          <span className="text-xs text-slate-400">
            마지막 스캔: {data.scannedAt.slice(0, 16).replace('T', ' ')} · "{listing.region}" 에어비앤비 검색 기준
          </span>
        )}
        {scanError && <span className="text-xs text-amber-600">{scanError}</span>}
      </div>

      {!data && !scanning && (
        <Card className="text-center py-12">
          <div className="text-4xl mb-3">📡</div>
          <div className="font-semibold mb-1">아직 시장 데이터가 없습니다</div>
          <p className="text-sm text-slate-500">
            "시장 스캔"을 누르면 에어비앤비에서 <b>{listing.region}</b> 지역의 경쟁 숙소 가격을
            향후 45일까지 6개 시점으로 수집합니다 (약 30초 소요).
          </p>
        </Card>
      )}

      {data && summary && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard
              label="Market ADR (중앙값 평균)"
              value={formatKRW(summary.marketAvg)}
              sub={`표본 평균 ${summary.avgCount}개/시점`}
            />
            <StatCard
              label="주말 vs 주중 중앙값"
              value={`${formatManwon(summary.weekendMedian)} / ${formatManwon(summary.weekdayMedian)}`}
              sub="금·토 / 그 외"
            />
            <StatCard label="내 평균 추천가" value={formatKRW(summary.myAvg)} />
            <StatCard
              label="시장 대비 포지션"
              value={`${summary.diffPct >= 0 ? '+' : ''}${summary.diffPct}%`}
              sub={summary.diffPct > 15 ? '시장보다 높음 — 점유율 확인' : summary.diffPct < -15 ? '시장보다 낮음 — 인상 여지' : '시장 수준'}
              accent={Math.abs(summary.diffPct) > 15 ? 'text-amber-600' : 'text-emerald-600'}
            />
          </div>

          <Card>
            <div className="font-semibold mb-1">내 가격은 시장 어디쯤인가?</div>
            <p className="text-xs text-slate-400 mb-4">
              <span className="text-slate-500">■ 25~50%</span> · <span className="text-rose-400">■ 50~75%</span> ·{' '}
              <span className="text-rose-300">■ 75~90%</span> 시장 밴드 · <span className="text-indigo-500">— 시장 중앙값</span> ·{' '}
              <span className="text-rose-600">— 내 추천가</span> · <span className="text-violet-500">● 공휴일</span>
            </p>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={{ fontSize: 12 }} tickLine={false} axisLine={false}
                    tickFormatter={(v: number) => formatManwon(v)} width={48}
                  />
                  <Tooltip
                    content={({ payload, label }) => {
                      if (!payload?.length) return null
                      const d = payload[0].payload as (typeof chartData)[number]
                      return (
                        <div className="rounded-lg bg-white border border-slate-200 shadow-md px-3 py-2 text-xs space-y-0.5">
                          <div className="font-semibold">
                            {label}
                            {d.holidayName && <span className="text-violet-600 ml-1">({d.holidayName})</span>}
                          </div>
                          <div>시장 25~90%: {formatKRW(d.band1[0])} ~ {formatKRW(d.band3[1])}</div>
                          <div className="text-indigo-600">시장 중앙값: {formatKRW(d.시장중앙값)}</div>
                          <div className="text-rose-600">내 추천가: {formatKRW(d.내추천가)}</div>
                          <div className="text-slate-400">표본 {d.count}개</div>
                        </div>
                      )
                    }}
                  />
                  <Area dataKey="band1" fill="#94a3b8" fillOpacity={0.35} stroke="none" />
                  <Area dataKey="band2" fill="#fda4af" fillOpacity={0.5} stroke="none" />
                  <Area dataKey="band3" fill="#fecdd3" fillOpacity={0.5} stroke="none" />
                  <Line type="monotone" dataKey="시장중앙값" stroke="#6366f1" strokeWidth={2} dot={{ r: 2.5 }} />
                  <Line type="monotone" dataKey="내추천가" stroke="#e11d48" strokeWidth={2.5} dot={{ r: 3 }} />
                  <Scatter dataKey="휴일" fill="#8b5cf6" shape="circle" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {data.competitors && data.competitors.length > 0 && (
            <Card className="mt-4">
              <div className="font-semibold mb-1">검색에 잡힌 경쟁 숙소 ({data.competitors.length})</div>
              <p className="text-xs text-slate-400 mb-3">
                스캔 시점의 "{listing.region}" 검색 상위 결과 — 클릭하면 에어비앤비에서 열립니다
              </p>
              <div className="grid md:grid-cols-2 gap-2">
                {data.competitors.map((c) => (
                  <a
                    key={c.id}
                    href={`https://www.airbnb.co.kr/rooms/${c.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm hover:border-rose-300 hover:bg-rose-50/40 transition-colors"
                  >
                    <span className="truncate">{c.name ?? `숙소 #${c.id.slice(-6)}`}</span>
                    <span className="text-slate-300 shrink-0 ml-2">↗</span>
                  </a>
                ))}
              </div>
            </Card>
          )}

          <p className="text-xs text-slate-400 mt-3">
            ⚠️ 에어비앤비 공개 검색 결과 기반 추정치입니다. 검색 노출 순서·프로모션에 따라 표본이 달라질 수 있으며,
            정확한 비교보다 가격 포지션 파악 용도로 활용하세요. (시장 점유율·예약 리드타임 지표는 로드맵에 있습니다)
          </p>
        </>
      )}
    </div>
  )
}

/** 데모 모드 — 기존 목업 시장 데이터 */
function DemoMarket({ listing }: { listing: Listing }) {
  const { bookings, overrides } = useStore()
  const today = todayStr()
  const market = MARKET_DATA[listing.region]

  const myStats = useMemo(() => {
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

  if (!market) {
    return <Card>데모 모드: 이 지역의 목업 시장 데이터가 없습니다.</Card>
  }

  const priceDiffPct = Math.round(((myStats.avgPrice - market.avgPrice) / market.avgPrice) * 100)
  const trendData = market.trend.map((v, i) => ({ week: `${i - market.trend.length + 1}주`, 시장점유율: v }))
  const compareData = [
    { name: '평균 가격(만원)', 내숙소: Math.round(myStats.avgPrice / 10000), 지역평균: Math.round(market.avgPrice / 10000) },
    { name: '점유율(%)', 내숙소: myStats.occupancy, 지역평균: market.occupancyPct },
  ]

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label={`${listing.region} 경쟁 숙소`} value={`${market.competitorCount}곳`} />
        <StatCard label="지역 평균 1박 가격" value={formatKRW(market.avgPrice)} />
        <StatCard
          label="내 평균 추천가 (30일)" value={formatKRW(myStats.avgPrice)}
          sub={`지역 대비 ${priceDiffPct >= 0 ? '+' : ''}${priceDiffPct}%`}
          accent={Math.abs(priceDiffPct) > 20 ? 'text-amber-600' : 'text-emerald-600'}
        />
        <StatCard
          label="점유율 비교" value={`${myStats.occupancy}% vs ${market.occupancyPct}%`}
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
        </Card>
      </div>
    </div>
  )
}

export default function Market() {
  const { listings, cloud } = useStore()
  const activeListings = listings.filter((l) => l.active)
  const [listingId, setListingId] = useState(activeListings[0]?.id ?? '')
  const listing = listings.find((l) => l.id === listingId) ?? activeListings[0]

  if (!listing) {
    return (
      <div>
        <PageTitle title="시장 분석" />
        <Card>활성화된 숙소가 없습니다. 숙소 관리에서 숙소를 등록·활성화하세요.</Card>
      </div>
    )
  }

  return (
    <div>
      <PageTitle
        title="시장 분석"
        desc={
          cloud
            ? '에어비앤비 검색 결과에서 수집한 실제 경쟁 가격과 내 추천가를 비교합니다'
            : '지역 경쟁 숙소 대비 내 숙소의 가격·점유율 포지션 (데모 데이터)'
        }
      />
      <select
        value={listing.id}
        onChange={(e) => setListingId(e.target.value)}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm mb-4"
      >
        {activeListings.map((l) => (
          <option key={l.id} value={l.id}>{l.thumbnail} {l.name} ({l.region})</option>
        ))}
      </select>
      {cloud ? <RealMarket listing={listing} /> : <DemoMarket listing={listing} />}
    </div>
  )
}
