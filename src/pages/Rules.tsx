import { useState } from 'react'
import { useStore } from '../lib/store'
import { Card, PageTitle } from '../components/ui'
import type { PricingRules } from '../types'

const PRICE_FIELDS: { key: keyof PricingRules; label: string; desc: string }[] = [
  { key: 'basePrice', label: '기본가 (1박)', desc: '모든 계산의 기준이 되는 평일 1박 요금' },
  { key: 'minPrice', label: '최저가', desc: '어떤 할인이 적용돼도 이 가격 아래로 내려가지 않음' },
  { key: 'maxPrice', label: '최고가', desc: '어떤 할증이 적용돼도 이 가격을 넘지 않음' },
]

const PCT_FIELDS: { key: keyof PricingRules; label: string; desc: string }[] = [
  { key: 'weekendUpliftPct', label: '주말 할증 (%)', desc: '금·토요일에 적용' },
  { key: 'holidayUpliftPct', label: '공휴일·연휴 할증 (%)', desc: '설날·추석 등 한국 공휴일. 징검다리 평일은 절반 적용' },
  { key: 'peakSeasonUpliftPct', label: '성수기 할증 (%)', desc: '7~8월, 12월 하순에 적용' },
  { key: 'lastMinuteDiscountPct', label: '임박 할인 (%)', desc: '7일 이내 비어있는 날짜에 적용해 공실 최소화' },
  { key: 'longStayDiscountPct', label: '연박 할인 (%)', desc: '7박 이상 예약 시 (채널 연동 시 적용 예정)' },
  { key: 'earlyBirdDiscountPct', label: '조기 예약 할인 (%)', desc: '90일 이전 예약 시 (채널 연동 시 적용 예정)' },
]

export default function Rules() {
  const { listings, updateListing } = useStore()
  const [listingId, setListingId] = useState(listings[0]?.id ?? '')
  const listing = listings.find((l) => l.id === listingId) ?? listings[0]
  const [saved, setSaved] = useState(false)

  if (!listing) return null

  const setRule = (key: keyof PricingRules, value: number) => {
    updateListing(listing.id, { rules: { ...listing.rules, [key]: value } })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div>
      <PageTitle title="가격 규칙" desc="숙소별 자동 가격 산정 규칙 — 변경 즉시 캘린더에 반영됩니다" />

      <div className="flex items-center gap-3 mb-4">
        <select
          value={listing.id}
          onChange={(e) => setListingId(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          {listings.map((l) => (
            <option key={l.id} value={l.id}>{l.thumbnail} {l.name}</option>
          ))}
        </select>
        {saved && <span className="text-sm text-emerald-600 font-medium">✓ 저장됨</span>}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <div className="font-semibold mb-4">기준 가격</div>
          <div className="space-y-4">
            {PRICE_FIELDS.map((f) => (
              <div key={f.key}>
                <label className="text-sm font-medium">{f.label}</label>
                <p className="text-xs text-slate-400 mb-1.5">{f.desc}</p>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">₩</span>
                  <input
                    type="number"
                    step={5000}
                    min={0}
                    value={listing.rules[f.key]}
                    onChange={(e) => setRule(f.key, Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 pl-8 pr-3 py-2 text-sm"
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="font-semibold mb-4">할증 · 할인 규칙</div>
          <div className="space-y-4">
            {PCT_FIELDS.map((f) => (
              <div key={f.key}>
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">{f.label}</label>
                  <span className="text-sm font-bold text-rose-600 w-12 text-right">
                    {listing.rules[f.key]}%
                  </span>
                </div>
                <p className="text-xs text-slate-400 mb-1.5">{f.desc}</p>
                <input
                  type="range"
                  min={0}
                  max={f.key.includes('Discount') ? 50 : 100}
                  value={listing.rules[f.key]}
                  onChange={(e) => setRule(f.key, Number(e.target.value))}
                  className="w-full accent-rose-500"
                />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
