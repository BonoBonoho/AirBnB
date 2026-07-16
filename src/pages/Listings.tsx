import { useState } from 'react'
import { useStore } from '../lib/store'
import { CHANNEL_INFO, bookedDateSet } from '../data/mock'
import { addDays, todayStr, formatKRW } from '../lib/date'
import { Card, PageTitle, ChannelBadge } from '../components/ui'
import type { Listing } from '../types'

const EMOJIS = ['🏠', '🏙️', '🌊', '🏖️', '🌉', '🏡', '🛖', '⛰️', '🌆', '🏘️']

const EMPTY_FORM = {
  name: '',
  region: '',
  type: '아파트 전체',
  bedrooms: 1,
  maxGuests: 2,
  thumbnail: '🏠',
  basePrice: 100000,
}

function AddListingForm({ onDone }: { onDone: () => void }) {
  const { addListing } = useStore()
  const [form, setForm] = useState(EMPTY_FORM)

  const submit = () => {
    if (!form.name.trim() || !form.region.trim() || form.basePrice <= 0) return
    const listing: Listing = {
      id: `lst-${Date.now().toString(36)}`,
      name: form.name.trim(),
      region: form.region.trim(),
      type: form.type,
      bedrooms: form.bedrooms,
      maxGuests: form.maxGuests,
      thumbnail: form.thumbnail,
      channels: ['airbnb'],
      active: true,
      rules: {
        basePrice: form.basePrice,
        minPrice: Math.round((form.basePrice * 0.6) / 1000) * 1000,
        maxPrice: Math.round((form.basePrice * 3) / 1000) * 1000,
        weekendUpliftPct: 25,
        holidayUpliftPct: 40,
        peakSeasonUpliftPct: 25,
        lastMinuteDiscountPct: 10,
        longStayDiscountPct: 10,
        earlyBirdDiscountPct: 5,
      },
    }
    addListing(listing)
    onDone()
  }

  return (
    <Card className="border-rose-200">
      <div className="font-semibold mb-4">새 숙소 등록</div>
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium">숙소 이름 *</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="예: 연남동 포근한 복층"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-sm font-medium">지역 *</label>
          <input
            value={form.region}
            onChange={(e) => setForm({ ...form, region: e.target.value })}
            placeholder="예: 서울 마포구"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-sm font-medium">숙소 유형</label>
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {['아파트 전체', '오피스텔 전체', '독채 펜션', '단독주택', '개인실', '한옥'].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium">기본가 (평일 1박) *</label>
          <div className="relative mt-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">₩</span>
            <input
              type="number"
              step={5000}
              min={0}
              value={form.basePrice}
              onChange={(e) => setForm({ ...form, basePrice: Number(e.target.value) })}
              className="w-full rounded-lg border border-slate-300 pl-8 pr-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="text-sm font-medium">침실</label>
            <input
              type="number" min={0} max={20}
              value={form.bedrooms}
              onChange={(e) => setForm({ ...form, bedrooms: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex-1">
            <label className="text-sm font-medium">최대 인원</label>
            <input
              type="number" min={1} max={30}
              value={form.maxGuests}
              onChange={(e) => setForm({ ...form, maxGuests: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="text-sm font-medium">아이콘</label>
          <div className="flex gap-1.5 mt-1.5 flex-wrap">
            {EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => setForm({ ...form, thumbnail: e })}
                className={`text-xl rounded-lg p-1.5 border ${
                  form.thumbnail === e ? 'border-rose-400 bg-rose-50' : 'border-transparent hover:bg-slate-50'
                }`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex gap-2 mt-5">
        <button
          onClick={submit}
          disabled={!form.name.trim() || !form.region.trim() || form.basePrice <= 0}
          className="rounded-lg bg-rose-500 text-white px-5 py-2 text-sm font-semibold hover:bg-rose-600 disabled:opacity-40"
        >
          등록
        </button>
        <button onClick={onDone} className="rounded-lg border border-slate-300 px-5 py-2 text-sm hover:bg-slate-50">
          취소
        </button>
      </div>
      <p className="text-xs text-slate-400 mt-3">
        가격 범위·할증률은 무난한 기본값으로 설정됩니다. 등록 후 <b>가격 규칙</b>에서 세부 조정하세요.
      </p>
    </Card>
  )
}

export default function Listings() {
  const { listings, bookings, updateListing, deleteListing, resetAll, cloud } = useStore()
  const [adding, setAdding] = useState(false)
  const today = todayStr()

  return (
    <div>
      <div className="flex items-start justify-between">
        <PageTitle title="숙소 관리" desc="숙소별 기본 정보와 활성 상태를 관리합니다" />
        <div className="flex items-center gap-3">
          {!cloud && (
            <button
              onClick={() => { if (confirm('모든 설정을 초기값으로 되돌릴까요?')) resetAll() }}
              className="text-xs text-slate-400 underline hover:text-rose-600"
            >
              데모 데이터 초기화
            </button>
          )}
          <button
            onClick={() => setAdding(true)}
            className="rounded-lg bg-rose-500 text-white px-4 py-2 text-sm font-semibold hover:bg-rose-600"
          >
            + 숙소 추가
          </button>
        </div>
      </div>

      {adding && (
        <div className="mb-4">
          <AddListingForm onDone={() => setAdding(false)} />
        </div>
      )}

      {listings.length === 0 && !adding && (
        <Card className="text-center py-14">
          <div className="text-4xl mb-3">🏠</div>
          <div className="font-semibold mb-1">등록된 숙소가 없습니다</div>
          <p className="text-sm text-slate-500 mb-5">
            운영 중인 숙소를 등록하면 자동 가격 추천이 시작됩니다.
          </p>
          <button
            onClick={() => setAdding(true)}
            className="rounded-lg bg-rose-500 text-white px-5 py-2.5 text-sm font-semibold hover:bg-rose-600"
          >
            첫 숙소 등록하기
          </button>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {listings.map((l) => {
          const set = bookedDateSet(bookings, l.id)
          let booked30 = 0
          for (let i = 0; i < 30; i++) if (set.has(addDays(today, i))) booked30++
          const occ = Math.round((booked30 / 30) * 100)

          return (
            <Card key={l.id} className={l.active ? '' : 'opacity-60'}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="text-3xl">{l.thumbnail}</div>
                  <div>
                    <div className="font-semibold">{l.name}</div>
                    <div className="text-xs text-slate-500">
                      {l.region} · {l.type} · 침실 {l.bedrooms} · 최대 {l.maxGuests}인
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={l.active}
                      onChange={(e) => updateListing(l.id, { active: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="relative w-10 h-5.5 bg-slate-200 rounded-full peer-checked:bg-rose-500 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4.5 after:w-4.5 after:transition-all peer-checked:after:translate-x-4.5" />
                  </label>
                  <button
                    onClick={() => {
                      if (confirm(`"${l.name}" 숙소를 삭제할까요?\n수동 가격과 동기화된 예약 표시도 함께 제거됩니다.`))
                        deleteListing(l.id)
                    }}
                    title="숙소 삭제"
                    className="text-slate-300 hover:text-rose-500 text-sm px-1"
                  >
                    🗑
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 mt-4 text-center">
                <div className="rounded-lg bg-slate-50 py-2">
                  <div className="text-[11px] text-slate-500">기본가</div>
                  <div className="text-sm font-bold">{formatKRW(l.rules.basePrice)}</div>
                </div>
                <div className="rounded-lg bg-slate-50 py-2">
                  <div className="text-[11px] text-slate-500">가격 범위</div>
                  <div className="text-sm font-bold">
                    {Math.round(l.rules.minPrice / 10000)}~{Math.round(l.rules.maxPrice / 10000)}만
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 py-2">
                  <div className="text-[11px] text-slate-500">30일 점유율</div>
                  <div className={`text-sm font-bold ${occ >= 70 ? 'text-emerald-600' : occ >= 40 ? 'text-amber-600' : 'text-rose-600'}`}>
                    {l.active ? `${occ}%` : '—'}
                  </div>
                </div>
              </div>

              <div className="flex gap-1.5 mt-4">
                {l.channels.map((c) => (
                  <ChannelBadge key={c} name={CHANNEL_INFO[c].name} color={CHANNEL_INFO[c].color} />
                ))}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
