import { useState } from 'react'
import { useStore } from '../lib/store'
import { CHANNEL_INFO } from '../data/mock'
import type { ChannelId } from '../types'
import { Card, PageTitle } from '../components/ui'

const ALL_CHANNELS: ChannelId[] = ['airbnb', 'yanolja', 'goodchoice', 'booking']

export default function Channels() {
  const { listings, updateListing, cloud } = useStore()
  const [syncMsg, setSyncMsg] = useState('')
  const [syncing, setSyncing] = useState(false)

  const runSync = async () => {
    if (!cloud) return
    setSyncing(true)
    setSyncMsg('')
    try {
      const count = await cloud.syncNow()
      setSyncMsg(`✓ 동기화 완료 — 예약 ${count}건`)
    } catch (e) {
      setSyncMsg(`동기화 실패: ${e instanceof Error ? e.message : e}`)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div>
      <PageTitle
        title="채널 연동"
        desc={
          cloud
            ? '에어비앤비 iCal 예약 동기화와 숙소별 판매 채널을 관리합니다'
            : '숙소별로 가격을 내보낼 판매 채널을 관리합니다 (데모 모드)'
        }
      />

      <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm text-blue-800">
        <div className="font-semibold mb-1">📥 에어비앤비 실제 예약 가져오기 (iCal)</div>
        에어비앤비 호스트 화면 → <b>달력 → 가용성 → 캘린더 연결 → 캘린더 내보내기</b>에서 iCal 주소를
        복사해 아래 숙소별 입력란에 붙여넣으세요.{' '}
        {cloud
          ? '6시간마다 자동 동기화되며, 지금 바로 동기화할 수도 있습니다.'
          : '데모 모드에서는 URL 저장만 되고, AWS 배포 후 동기화가 활성화됩니다.'}
        {cloud && (
          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={runSync}
              disabled={syncing}
              className="rounded-lg bg-blue-600 text-white px-4 py-1.5 text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              {syncing ? '동기화 중…' : '지금 동기화'}
            </button>
            {syncMsg && <span className="text-xs">{syncMsg}</span>}
          </div>
        )}
      </div>

      <div className="space-y-4">
        {listings.map((l) => (
          <Card key={l.id}>
            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl">{l.thumbnail}</span>
              <div>
                <div className="font-semibold">{l.name}</div>
                <div className="text-xs text-slate-500">{l.region}</div>
              </div>
              {!l.active && (
                <span className="ml-auto text-xs text-slate-400 bg-slate-100 rounded-full px-2.5 py-1">비활성 숙소</span>
              )}
            </div>
            <div className="mb-4">
              <label className="text-xs font-medium text-slate-500">에어비앤비 iCal URL</label>
              <input
                type="url"
                value={l.icalUrl ?? ''}
                onChange={(e) => updateListing(l.id, { icalUrl: e.target.value || undefined })}
                placeholder="https://www.airbnb.co.kr/calendar/ical/….ics?s=…"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono placeholder:font-sans"
              />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {ALL_CHANNELS.map((c) => {
                const info = CHANNEL_INFO[c]
                const connected = l.channels.includes(c)
                return (
                  <button
                    key={c}
                    onClick={() =>
                      updateListing(l.id, {
                        channels: connected
                          ? l.channels.filter((x) => x !== c)
                          : [...l.channels, c],
                      })
                    }
                    className={`rounded-xl border p-3 text-left transition-colors ${
                      connected ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold" style={{ color: info.color }}>{info.name}</span>
                      <span className={`text-[11px] font-medium ${connected ? 'text-emerald-600' : 'text-slate-400'}`}>
                        {connected ? '● 연동됨' : '○ 미연동'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">수수료 약 {info.feePct}%</div>
                    {connected && (
                      <div className="text-[11px] text-emerald-600 mt-1">가격 동기화: 매일 자동</div>
                    )}
                  </button>
                )
              })}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
