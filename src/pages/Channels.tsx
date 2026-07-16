import { useStore } from '../lib/store'
import { CHANNEL_INFO } from '../data/mock'
import type { ChannelId } from '../types'
import { Card, PageTitle } from '../components/ui'

const ALL_CHANNELS: ChannelId[] = ['airbnb', 'yanolja', 'goodchoice', 'booking']

export default function Channels() {
  const { listings, updateListing } = useStore()

  return (
    <div>
      <PageTitle
        title="채널 연동"
        desc="숙소별로 가격을 내보낼 판매 채널을 관리합니다 (MVP에서는 연동 상태 시뮬레이션)"
      />

      <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm text-blue-800">
        ℹ️ 실제 API 연동(에어비앤비 공식 API, 야놀자·여기어때 파트너 API)은 다음 단계입니다.
        현재는 어떤 채널에 가격을 동기화할지 설정만 저장됩니다.
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
