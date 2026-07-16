import { useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { Card, PageTitle } from '../components/ui'
import { todayStr, addDays } from '../lib/date'
import { backupPin, accessWindow, guestDoorUrl, readDoorLog } from '../lib/door'

export default function DoorAdmin() {
  const { listings, bookings, updateListing } = useStore()
  const activeListings = listings.filter((l) => l.active)
  const [listingId, setListingId] = useState(activeListings[0]?.id ?? '')
  const listing = listings.find((l) => l.id === listingId) ?? activeListings[0]
  const [copied, setCopied] = useState('')
  const today = todayStr()

  const grants = useMemo(
    () =>
      bookings
        .filter(
          (b) =>
            b.listingId === listing?.id &&
            b.status !== 'cancelled' &&
            addDays(b.checkIn, b.nights) >= today,
        )
        .sort((a, b) => a.checkIn.localeCompare(b.checkIn))
        .slice(0, 10),
    [bookings, listing, today],
  )

  const log = useMemo(() => readDoorLog().filter((e) => e.listingId === listing?.id).slice(0, 8), [listing])

  if (!listing) {
    return (
      <div>
        <PageTitle title="스마트도어" />
        <Card>활성화된 숙소가 없습니다.</Card>
      </div>
    )
  }

  const lock = listing.doorLock

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(''), 1500)
  }

  return (
    <div>
      <PageTitle
        title="스마트도어"
        desc="예약별 문열기 링크와 백업 비밀번호를 자동 발급합니다 — 체크인 15:00 ~ 체크아웃 11:00에만 유효"
      />

      <select
        value={listing.id}
        onChange={(e) => setListingId(e.target.value)}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm mb-4"
      >
        {activeListings.map((l) => (
          <option key={l.id} value={l.id}>{l.thumbnail} {l.name}</option>
        ))}
      </select>

      <Card className="mb-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="font-semibold">🚪 도어락 연결</div>
            <div className="text-xs text-slate-500 mt-0.5">
              {lock
                ? lock.provider === 'mock'
                  ? '데모 도어락 연결됨 — 실제 하드웨어(Tuya/TTLock) 도착 시 드라이버만 교체하면 됩니다'
                  : `${lock.provider.toUpperCase()} 연동 (기기 ID: ${lock.deviceId ?? '미설정'})`
                : '아직 도어락이 연결되지 않았습니다. 데모 도어락으로 전체 흐름을 미리 볼 수 있어요.'}
            </div>
          </div>
          {lock ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-1 text-xs font-medium">
              ● 연결됨 ({lock.provider === 'mock' ? '데모' : lock.provider})
            </span>
          ) : (
            <button
              onClick={() => updateListing(listing.id, { doorLock: { provider: 'mock' } })}
              className="rounded-lg bg-slate-800 text-white px-4 py-2 text-sm font-medium hover:bg-slate-700"
            >
              데모 도어락 연결
            </button>
          )}
        </div>
      </Card>

      {lock && (
        <div className="grid lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <div className="font-semibold mb-3">예약별 출입권 (진행·예정 {grants.length}건)</div>
            {grants.length === 0 && (
              <p className="text-sm text-slate-400 py-6 text-center">진행 중이거나 예정된 예약이 없습니다</p>
            )}
            <div className="space-y-3">
              {grants.map((b) => {
                const w = accessWindow(b)
                const url = guestDoorUrl(b.id)
                return (
                  <div key={b.id} className="rounded-xl border border-slate-100 p-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <span className="font-medium text-sm">{b.guestName}</span>
                        <span className="text-xs text-slate-400 ml-2">
                          {w.from.slice(5, 16).replace('T', ' ')} ~ {w.to.slice(5, 16).replace('T', ' ')}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="rounded bg-slate-100 px-2 py-1 font-mono" title="백업 비밀번호">
                          🔢 {backupPin(b.id)}
                        </span>
                        <button
                          onClick={() => copy(url, b.id)}
                          className="rounded-lg border border-slate-300 px-3 py-1 hover:bg-slate-50"
                        >
                          {copied === b.id ? '✓ 복사됨' : '링크 복사'}
                        </button>
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg bg-rose-500 text-white px-3 py-1 font-medium hover:bg-rose-600"
                        >
                          미리보기
                        </a>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-slate-400 mt-3">
              링크·비밀번호를 에어비앤비 메시지로 게스트에게 보내세요. 유효기간이 지나면 자동으로 만료됩니다.
            </p>
          </Card>

          <Card>
            <div className="font-semibold mb-3">개폐 기록</div>
            {log.length === 0 && <p className="text-sm text-slate-400 py-4 text-center">아직 기록이 없습니다</p>}
            <div className="space-y-2">
              {log.map((e, i) => (
                <div key={i} className="text-xs flex items-center justify-between">
                  <span>
                    {e.result === 'success' ? '🔓' : '⛔'} {e.guestName}
                  </span>
                  <span className="text-slate-400">{e.at.slice(5, 16).replace('T', ' ')}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
