import { useStore } from '../lib/store'
import { CHANNEL_INFO, bookedDateSet } from '../data/mock'
import { addDays, todayStr, formatKRW } from '../lib/date'
import { Card, PageTitle, ChannelBadge } from '../components/ui'

export default function Listings() {
  const { listings, bookings, updateListing, resetAll } = useStore()
  const today = todayStr()

  return (
    <div>
      <div className="flex items-start justify-between">
        <PageTitle title="숙소 관리" desc="숙소별 기본 정보와 활성 상태를 관리합니다" />
        <button
          onClick={() => { if (confirm('모든 설정을 초기값으로 되돌릴까요?')) resetAll() }}
          className="text-xs text-slate-400 underline hover:text-rose-600"
        >
          데모 데이터 초기화
        </button>
      </div>

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
                <label className="inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={l.active}
                    onChange={(e) => updateListing(l.id, { active: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="relative w-10 h-5.5 bg-slate-200 rounded-full peer-checked:bg-rose-500 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4.5 after:w-4.5 after:transition-all peer-checked:after:translate-x-4.5" />
                </label>
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
