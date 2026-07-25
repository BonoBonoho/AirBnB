import { useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { Card, PageTitle } from '../components/ui'
import { addDays } from '../lib/date'
import type { Booking } from '../types'

type Period = 'staying' | 'upcoming' | 'thisMonth' | 'lastMonth' | 'past' | 'all'

const PERIODS: { key: Period; label: string }[] = [
  { key: 'staying', label: '투숙 중' },
  { key: 'upcoming', label: '체크인 예정' },
  { key: 'thisMonth', label: '이번 달' },
  { key: 'lastMonth', label: '지난 달' },
  { key: 'past', label: '지난 예약' },
  { key: 'all', label: '전체' },
]

const DAY_LABEL = ['일', '월', '화', '수', '목', '금', '토']

function today(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const day = DAY_LABEL[new Date(y, m - 1, d).getDay()]
  return `${m}.${String(d).padStart(2, '0')}(${day})`
}

function checkOut(b: Booking): string {
  return addDays(b.checkIn, b.nights)
}

export default function Guests() {
  const { listings, bookings, cloud } = useStore()
  const [period, setPeriod] = useState<Period>('upcoming')
  const [query, setQuery] = useState('')
  const [listingFilter, setListingFilter] = useState('')
  const [noteEdit, setNoteEdit] = useState('')
  const [noteText, setNoteText] = useState('')
  const [copiedId, setCopiedId] = useState('')
  const [busy, setBusy] = useState('')

  const t = today()

  const filtered = useMemo(() => {
    let list = bookings.filter((b) => b.status !== 'cancelled')
    if (listingFilter) list = list.filter((b) => b.listingId === listingFilter)
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      list = list.filter((b) => b.guestName.toLowerCase().includes(q))
    }
    const [ty, tm] = [Number(t.slice(0, 4)), Number(t.slice(5, 7))]
    const thisMonth = t.slice(0, 7)
    const lastMonth = tm === 1 ? `${ty - 1}-12` : `${ty}-${String(tm - 1).padStart(2, '0')}`
    switch (period) {
      case 'staying':
        list = list.filter((b) => b.checkIn <= t && checkOut(b) > t)
        break
      case 'upcoming':
        list = list.filter((b) => b.checkIn >= t)
        break
      case 'thisMonth':
        list = list.filter((b) => b.checkIn.slice(0, 7) === thisMonth)
        break
      case 'lastMonth':
        list = list.filter((b) => b.checkIn.slice(0, 7) === lastMonth)
        break
      case 'past':
        list = list.filter((b) => checkOut(b) <= t)
        break
    }
    const asc = period === 'upcoming' || period === 'staying'
    return list.sort((a, b) => (asc ? a.checkIn.localeCompare(b.checkIn) : b.checkIn.localeCompare(a.checkIn)))
  }, [bookings, period, query, listingFilter, t])

  const revenue = filtered.reduce((s, b) => s + b.totalPrice, 0)

  const statusOf = (b: Booking): { label: string; cls: string } => {
    const co = checkOut(b)
    if (b.checkIn <= t && co > t) return { label: '투숙 중', cls: 'bg-emerald-100 text-emerald-700' }
    if (b.checkIn === t) return { label: '오늘 체크인', cls: 'bg-rose-100 text-rose-700' }
    if (b.checkIn > t) return { label: `D-${Math.round((Date.parse(b.checkIn) - Date.parse(t)) / 86400000)}`, cls: 'bg-sky-100 text-sky-700' }
    if (co === t) return { label: '오늘 체크아웃', cls: 'bg-amber-100 text-amber-700' }
    return { label: '완료', cls: 'bg-slate-100 text-slate-500' }
  }

  const copyFormLink = async (b: Booking) => {
    if (!cloud) return
    setBusy(b.id)
    try {
      const listing = listings.find((l) => l.id === b.listingId)
      const token =
        cloud.formLinks[b.id] ??
        (await cloud.createFormLink({
          bookingId: b.id,
          guestName: b.guestName,
          listingName: listing?.name ?? '',
          checkIn: b.checkIn,
          nights: b.nights,
        }))
      await navigator.clipboard.writeText(`${location.origin}${location.pathname}#/guestform/${token}`)
      setCopiedId(b.id)
      setTimeout(() => setCopiedId(''), 1500)
    } finally {
      setBusy('')
    }
  }

  const saveNote = async (bookingId: string) => {
    if (!cloud) return
    setBusy(bookingId)
    try {
      await cloud.saveGuestNote(bookingId, noteText)
      setNoteEdit('')
    } finally {
      setBusy('')
    }
  }

  return (
    <div>
      <PageTitle title="👥 게스트 관리" desc="기간별 예약자 조회 · 설문 응답 · 연락처 · 메모" />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
              period === p.key ? 'bg-rose-500 text-white' : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {p.label}
          </button>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="게스트 이름 검색"
          className="ml-auto w-40 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
        />
        {listings.filter((l) => l.active).length > 1 && (
          <select
            value={listingFilter}
            onChange={(e) => setListingFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
          >
            <option value="">모든 숙소</option>
            {listings.filter((l) => l.active).map((l) => (
              <option key={l.id} value={l.id}>{l.name.slice(0, 20)}</option>
            ))}
          </select>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-4 text-sm text-slate-500">
        <span>예약 <b className="text-slate-800">{filtered.length}건</b></span>
        <span>총 <b className="text-slate-800">{filtered.reduce((s, b) => s + b.nights, 0)}박</b></span>
        <span>매출 <b className="text-slate-800">₩{revenue.toLocaleString()}</b></span>
      </div>

      {filtered.length === 0 ? (
        <Card><p className="text-sm text-slate-400">해당 기간의 예약이 없습니다.</p></Card>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((b) => {
            const listing = listings.find((l) => l.id === b.listingId)
            const st = statusOf(b)
            const resp = cloud?.formResponses[b.id]
            const note = cloud?.guestNotes[b.id]
            const editing = noteEdit === b.id
            return (
              <div key={b.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3.5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>{st.label}</span>
                    <span className="font-semibold truncate">{b.guestName}</span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      b.channel === 'booking' ? 'bg-blue-50 text-blue-600' : 'bg-rose-50 text-rose-500'
                    }`}>
                      {b.channel === 'booking' ? '부킹닷컴' : '에어비앤비'}
                    </span>
                  </div>
                  <div className="text-sm text-right">
                    <b>₩{b.totalPrice.toLocaleString()}</b>
                    {b.actual && <span className="text-[10px] text-emerald-600 ml-1" title="정산 메일/CSV 기준 실제 금액">실측✓</span>}
                  </div>
                </div>
                <div className="mt-1.5 text-xs text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5">
                  <span>📅 {fmtDate(b.checkIn)} ~ {fmtDate(checkOut(b))} · {b.nights}박</span>
                  {listing && <span className="truncate max-w-60">🏠 {listing.name}</span>}
                </div>

                {cloud && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    {resp ? (
                      <>
                        <span className="text-emerald-600 font-medium">📋 설문 완료</span>
                        {resp.answers.guests && <span className="text-slate-600">👤 {resp.answers.guests}</span>}
                        {resp.answers.checkinTime && <span className="text-slate-600">도착 {resp.answers.checkinTime}</span>}
                        {resp.answers.phone && <span className="text-slate-600">📞 …{resp.answers.phone}</span>}
                        {resp.answers.transport && <span className="text-slate-400">{resp.answers.transport}</span>}
                      </>
                    ) : (
                      <button
                        onClick={() => copyFormLink(b)}
                        disabled={busy === b.id}
                        className="rounded-lg border border-slate-300 px-2.5 py-1 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {copiedId === b.id ? '✓ 복사됨' : '📋 설문 링크 복사'}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (editing) { setNoteEdit('') } else { setNoteEdit(b.id); setNoteText(note ?? '') }
                      }}
                      className="text-slate-400 underline hover:text-slate-600"
                    >
                      {note ? '📝 메모 수정' : '메모 추가'}
                    </button>
                  </div>
                )}

                {note && !editing && (
                  <p className="mt-1.5 rounded-lg bg-amber-50 border border-amber-100 px-2.5 py-1.5 text-xs text-amber-900 whitespace-pre-wrap">
                    📝 {note}
                  </p>
                )}
                {editing && (
                  <div className="mt-2 flex gap-1.5">
                    <input
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      placeholder="예: 늦은 체크인 요청, 반려견 1마리, 재방문 고객"
                      className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                      onKeyDown={(e) => { if (e.key === 'Enter') saveNote(b.id) }}
                    />
                    <button onClick={() => saveNote(b.id)} disabled={busy === b.id}
                      className="rounded-lg bg-slate-800 text-white px-3 py-1.5 text-xs font-medium disabled:opacity-50">저장</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
