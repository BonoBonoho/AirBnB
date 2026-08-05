import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { Card, PageTitle } from '../components/ui'
import { todayStr, addDays } from '../lib/date'
import { backupPin, accessWindow, guestDoorUrl, readDoorLog } from '../lib/door'

type DoorState = Awaited<ReturnType<NonNullable<ReturnType<typeof useStore>['cloud']>['door']['get']>>

export default function DoorAdmin() {
  const { listings, bookings, updateListing, cloud } = useStore()
  const activeListings = listings.filter((l) => l.active)
  const [listingId, setListingId] = useState(activeListings[0]?.id ?? '')
  const listing = listings.find((l) => l.id === listingId) ?? activeListings[0]
  const [copied, setCopied] = useState('')
  const today = todayStr()

  // TTLock 연동 상태
  const [door, setDoor] = useState<DoorState | null>(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [codes, setCodes] = useState<Record<string, string>>({})
  // 연동 폼
  const [showConnect, setShowConnect] = useState(false)
  const [ttClientId, setTtClientId] = useState('')
  const [ttSecret, setTtSecret] = useState('')
  const [ttUser, setTtUser] = useState('')
  const [ttPw, setTtPw] = useState('')
  const [ttRegion, setTtRegion] = useState<'api' | 'euapi'>('euapi')

  useEffect(() => {
    if (!cloud) return
    cloud.door.get().then((d) => {
      setDoor(d)
      const c: Record<string, string> = {}
      for (const [bid, p] of Object.entries(d.passcodes)) c[bid] = p.code
      setCodes(c)
    }).catch(() => {})
  }, [cloud])

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
  const connected = !!door?.connected
  const assignedLockId = door?.assign?.[listing.id]
  const assignedLock = door?.locks.find((l) => l.lockId === assignedLockId)

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(''), 1500)
  }

  const connectTtlock = async () => {
    if (!cloud) return
    setBusy('connect'); setMsg('')
    try {
      const r = await cloud.door.connect({
        clientId: ttClientId.trim(), clientSecret: ttSecret.trim(),
        username: ttUser.trim(), password: ttPw, region: ttRegion,
      })
      const d = await cloud.door.get()
      setDoor(d)
      setTtClientId(''); setTtSecret(''); setTtUser(''); setTtPw('')
      setShowConnect(false)
      setMsg(`✓ TTLock 연동 완료 — 잠금 ${r.locks.length}개 발견`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally { setBusy('') }
  }

  const assignLock = async (lockId: number) => {
    if (!cloud) return
    await cloud.door.assign(listing.id, lockId).catch(() => {})
    setDoor((p) => p ? { ...p, assign: { ...p.assign, [listing.id]: lockId } } : p)
  }

  const issuePasscode = async (b: typeof grants[number]) => {
    if (!cloud || !assignedLockId) return
    setBusy(`pass:${b.id}`); setMsg('')
    const w = accessWindow(b)
    try {
      const r = await cloud.door.passcode({
        bookingId: b.id, lockId: assignedLockId,
        startDate: new Date(w.from).getTime(), endDate: new Date(w.to).getTime(),
        guestName: b.guestName,
      })
      setCodes((p) => ({ ...p, [b.id]: r.code }))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally { setBusy('') }
  }

  const remote = async (kind: 'unlock' | 'lock') => {
    if (!cloud || !assignedLockId) return
    setBusy(kind); setMsg('')
    try {
      if (kind === 'unlock') await cloud.door.unlock(assignedLockId)
      else await cloud.door.lock(assignedLockId)
      setMsg(kind === 'unlock' ? '✓ 문을 열었습니다' : '✓ 문을 잠갔습니다')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally { setBusy('') }
  }

  return (
    <div>
      <PageTitle
        title="스마트도어"
        desc="예약별 문열기 링크와 비밀번호를 자동 발급합니다 — 체크인 15:00 ~ 체크아웃 11:00에만 유효"
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

      {/* TTLock 연동 (클라우드 모드) */}
      {cloud ? (
        <Card className="mb-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="font-semibold">🔐 TTLock 도어락</div>
              <div className="text-xs text-slate-500 mt-0.5">
                {connected
                  ? `연동됨 — 잠금 ${door?.locks.length ?? 0}개 · 이 숙소: ${assignedLock?.alias ?? '미배정'}`
                  : '개발자 인증정보 + TTLock 계정으로 연동하면 실제 비밀번호 발급·원격 제어가 됩니다'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {connected && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-1 text-xs font-medium">● 연결됨</span>
              )}
              <button
                onClick={() => setShowConnect((v) => !v)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50"
              >
                {connected ? '재연동' : '연동하기'}{showConnect ? ' ▴' : ' ▾'}
              </button>
            </div>
          </div>

          {connected && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-500">이 숙소 잠금:</span>
              <select
                value={assignedLockId ?? ''}
                onChange={(e) => assignLock(Number(e.target.value))}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
              >
                <option value="">선택</option>
                {door?.locks.map((l) => <option key={l.lockId} value={l.lockId}>{l.alias}</option>)}
              </select>
              {assignedLockId && (
                <>
                  <button onClick={() => remote('unlock')} disabled={busy === 'unlock'}
                    className="rounded-lg bg-rose-500 text-white px-3 py-1.5 text-xs font-medium hover:bg-rose-600 disabled:opacity-50">
                    {busy === 'unlock' ? '여는 중…' : '🔓 원격 열기'}
                  </button>
                  <button onClick={() => remote('lock')} disabled={busy === 'lock'}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50">
                    🔒 잠그기
                  </button>
                </>
              )}
            </div>
          )}

          {connected && (
            <label className="mt-3 flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={door?.autoIssue !== false}
                onChange={async (e) => {
                  const enabled = e.target.checked
                  setDoor((p) => p ? { ...p, autoIssue: enabled } : p)
                  await cloud.door.auto(enabled).catch(() => {})
                }}
                className="accent-rose-500"
              />
              예약 확정 시 비밀번호 자동 발급 (체크인 3일 전 미리 생성 · 15분 주기)
            </label>
          )}

          {showConnect && (
            <div className="mt-3 rounded-xl border border-slate-200 p-3 space-y-2">
              <p className="text-xs text-slate-500 leading-relaxed">
                <a href="https://euopen.ttlock.com" target="_blank" rel="noreferrer" className="underline">euopen.ttlock.com</a>에서
                개발자 가입 후 앱을 만들면 <b>Client ID·Client Secret</b>을 받습니다. TTLock 계정은 앱에서 쓰는 그 계정이에요.
                비밀번호는 토큰 발급에만 쓰고 저장하지 않습니다.
              </p>
              <div className="grid sm:grid-cols-2 gap-2">
                <input value={ttClientId} onChange={(e) => setTtClientId(e.target.value)} placeholder="Client ID"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono" />
                <input type="password" value={ttSecret} onChange={(e) => setTtSecret(e.target.value)} placeholder="Client Secret"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono" />
                <input value={ttUser} onChange={(e) => setTtUser(e.target.value)} placeholder="TTLock 계정 (아이디/이메일/휴대폰)"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                <input type="password" value={ttPw} onChange={(e) => setTtPw(e.target.value)} placeholder="TTLock 비밀번호"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <select value={ttRegion} onChange={(e) => setTtRegion(e.target.value as 'api' | 'euapi')}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm">
                  <option value="euapi">유럽·기타 (euapi)</option>
                  <option value="api">글로벌 (api)</option>
                </select>
                <button onClick={connectTtlock} disabled={busy === 'connect' || !ttClientId.trim() || !ttUser.trim() || !ttPw}
                  className="rounded-lg bg-slate-800 text-white px-4 py-2 text-sm font-semibold hover:bg-slate-700 disabled:opacity-50">
                  {busy === 'connect' ? '연동 중…' : 'TTLock 연동'}
                </button>
              </div>
            </div>
          )}
          {msg && <p className={`text-xs mt-2 ${msg.startsWith('✓') ? 'text-emerald-600' : 'text-amber-600'}`}>{msg}</p>}
        </Card>
      ) : (
        // 데모 모드 (로그인 전) — 기존 목업
        <Card className="mb-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="font-semibold">🚪 도어락 연결</div>
              <div className="text-xs text-slate-500 mt-0.5">
                {lock ? '데모 도어락 연결됨' : '데모 모드 — 로그인하면 실제 TTLock을 연동할 수 있어요'}
              </div>
            </div>
            {!lock && (
              <button
                onClick={() => updateListing(listing.id, { doorLock: { provider: 'mock' } })}
                className="rounded-lg bg-slate-800 text-white px-4 py-2 text-sm font-medium hover:bg-slate-700"
              >
                데모 도어락 연결
              </button>
            )}
          </div>
        </Card>
      )}

      {(connected || lock) && (
        <div className="grid lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <div className="font-semibold mb-3">예약별 출입권 (진행·예정 {grants.length}건)</div>
            {connected && !assignedLockId && (
              <p className="text-xs text-amber-600 mb-2">이 숙소에 잠금을 먼저 배정하면 실제 비밀번호가 발급됩니다.</p>
            )}
            {grants.length === 0 && (
              <p className="text-sm text-slate-400 py-6 text-center">진행 중이거나 예정된 예약이 없습니다</p>
            )}
            <div className="space-y-3">
              {grants.map((b) => {
                const w = accessWindow(b)
                const url = guestDoorUrl(b.id)
                const realCode = codes[b.id]
                const canIssue = connected && !!assignedLockId
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
                        {realCode ? (
                          <span className="rounded bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-1 font-mono font-semibold" title="TTLock 실제 비밀번호">
                            🔑 {realCode}
                          </span>
                        ) : canIssue ? (
                          <button onClick={() => issuePasscode(b)} disabled={busy === `pass:${b.id}`}
                            className="rounded-lg bg-slate-800 text-white px-3 py-1 font-medium hover:bg-slate-700 disabled:opacity-50">
                            {busy === `pass:${b.id}` ? '발급 중…' : '비번 발급'}
                          </button>
                        ) : (
                          <span className="rounded bg-slate-100 px-2 py-1 font-mono" title="데모 비밀번호">
                            🔢 {backupPin(b.id)}
                          </span>
                        )}
                        <button
                          onClick={() => copy(url, b.id)}
                          className="rounded-lg border border-slate-300 px-3 py-1 hover:bg-slate-50"
                        >
                          {copied === b.id ? '✓ 복사됨' : '링크 복사'}
                        </button>
                        <a href={url} target="_blank" rel="noreferrer"
                          className="rounded-lg bg-rose-500 text-white px-3 py-1 font-medium hover:bg-rose-600">
                          미리보기
                        </a>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-slate-400 mt-3">
              {connected
                ? '발급된 비밀번호는 게이트웨이를 통해 도어락에 자동 반영되고, 유효기간이 지나면 만료됩니다. 에어비앤비 메시지로 게스트에게 보내세요.'
                : '링크·비밀번호를 에어비앤비 메시지로 게스트에게 보내세요. 유효기간이 지나면 자동으로 만료됩니다.'}
            </p>
          </Card>

          <Card>
            <div className="font-semibold mb-3">개폐 기록</div>
            {log.length === 0 && <p className="text-sm text-slate-400 py-4 text-center">아직 기록이 없습니다</p>}
            <div className="space-y-2">
              {log.map((e, i) => (
                <div key={i} className="text-xs flex items-center justify-between">
                  <span>{e.result === 'success' ? '🔓' : '⛔'} {e.guestName}</span>
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
