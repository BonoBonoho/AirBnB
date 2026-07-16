import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useStore } from '../lib/store'
import { accessWindow, isAccessValid, backupPin, unlockDoor, appendDoorLog } from '../lib/door'

type Phase = 'idle' | 'opening' | 'opened' | 'failed'

export default function DoorGuest() {
  const { bookingId } = useParams()
  const { bookings, listings } = useStore()
  const [phase, setPhase] = useState<Phase>('idle')

  const booking = useMemo(() => bookings.find((b) => b.id === bookingId), [bookings, bookingId])
  const listing = booking ? listings.find((l) => l.id === booking.listingId) : undefined
  const valid = booking ? isAccessValid(booking) : false

  const open = async () => {
    if (!booking || !listing) return
    if (!valid) {
      appendDoorLog({
        listingId: listing.id, bookingId: booking.id, guestName: booking.guestName,
        at: new Date().toISOString(), result: 'expired',
      })
      return
    }
    setPhase('opening')
    try {
      await unlockDoor(listing.doorLock?.provider ?? 'mock')
      setPhase('opened')
      appendDoorLog({
        listingId: listing.id, bookingId: booking.id, guestName: booking.guestName,
        at: new Date().toISOString(), result: 'success',
      })
      setTimeout(() => setPhase('idle'), 5000)
    } catch {
      setPhase('failed')
      appendDoorLog({
        listingId: listing.id, bookingId: booking.id, guestName: booking.guestName,
        at: new Date().toISOString(), result: 'error',
      })
    }
  }

  if (!booking || !listing) {
    return (
      <Shell>
        <div className="text-5xl mb-4">🔒</div>
        <h1 className="text-lg font-bold mb-2">유효하지 않은 링크입니다</h1>
        <p className="text-sm text-slate-500">호스트에게 새 출입 링크를 요청해 주세요.</p>
      </Shell>
    )
  }

  const w = accessWindow(booking)

  return (
    <Shell>
      <div className="text-sm text-slate-400 mb-1">{listing.name}</div>
      <h1 className="text-xl font-bold mb-1">{booking.guestName}님, 환영합니다 👋</h1>
      <p className="text-xs text-slate-400 mb-8">
        출입 가능: {w.from.slice(5, 16).replace('T', ' ')} ~ {w.to.slice(5, 16).replace('T', ' ')}
      </p>

      {valid ? (
        <>
          <button
            onClick={open}
            disabled={phase === 'opening'}
            className={`mx-auto flex items-center justify-center rounded-full w-44 h-44 text-white text-lg font-bold shadow-lg transition-all ${
              phase === 'opened'
                ? 'bg-emerald-500 scale-105'
                : phase === 'opening'
                  ? 'bg-slate-400 animate-pulse'
                  : 'bg-rose-500 hover:bg-rose-600 active:scale-95'
            }`}
          >
            {phase === 'opened' ? '🔓 열렸습니다!' : phase === 'opening' ? '여는 중…' : '문 열기'}
          </button>
          {phase === 'failed' && (
            <p className="text-sm text-rose-600 mt-4">연결에 실패했어요. 아래 비밀번호를 사용해 주세요.</p>
          )}
          <div className="mt-8 rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 inline-block">
            <div className="text-[11px] text-slate-400 mb-0.5">인터넷이 안 될 때 · 백업 비밀번호</div>
            <div className="text-2xl font-mono font-bold tracking-widest">{backupPin(booking.id)}</div>
          </div>
        </>
      ) : (
        <>
          <div className="text-5xl mb-4">⏰</div>
          <p className="font-semibold">아직 출입 가능 시간이 아니거나 만료되었습니다</p>
          <p className="text-sm text-slate-500 mt-1">체크인 당일 오후 3시부터 이용할 수 있어요.</p>
        </>
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-8 text-center">
        {children}
        <div className="mt-8 text-[11px] text-slate-300">powered by 스테이프라이스</div>
      </div>
    </div>
  )
}
