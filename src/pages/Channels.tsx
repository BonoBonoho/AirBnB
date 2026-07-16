import { useState } from 'react'
import { useStore } from '../lib/store'
import { CHANNEL_INFO } from '../data/mock'
import type { ChannelId } from '../types'
import { Card, PageTitle } from '../components/ui'

const ALL_CHANNELS: ChannelId[] = ['airbnb', 'yanolja', 'goodchoice', 'booking']

function PayoutMailCard() {
  const { cloud } = useStore()
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  if (!cloud) return null

  const address = cloud.inboundKey && cloud.emailDomain ? `${cloud.inboundKey}@${cloud.emailDomain}` : null

  return (
    <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900">
      <div className="font-semibold mb-1">💰 실매출 자동 수집 (정산 메일 파싱)</div>
      {!cloud.emailDomain ? (
        <p>
          커스텀 도메인 연결 후 활성화됩니다. 도메인이 연결되면 전용 수신 주소가 발급되고,
          Gmail에서 에어비앤비 메일만 자동 전달하면 실제 정산액이 대시보드에 반영됩니다.
        </p>
      ) : !address ? (
        <div className="flex items-center gap-3">
          <p>전용 수신 주소를 발급하면 Gmail 자동 전달로 실제 정산액을 수집할 수 있습니다.</p>
          <button
            onClick={async () => {
              setBusy(true)
              try { await cloud.requestInboundAddress() } finally { setBusy(false) }
            }}
            disabled={busy}
            className="shrink-0 rounded-lg bg-emerald-600 text-white px-4 py-1.5 text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? '발급 중…' : '수신 주소 발급'}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span>내 수신 주소:</span>
            <code className="rounded bg-white border border-emerald-200 px-2 py-1 font-mono text-xs">{address}</code>
            <button
              onClick={() => { navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
              className="text-xs underline hover:text-emerald-700"
            >
              {copied ? '✓ 복사됨' : '복사'}
            </button>
            <span className="ml-auto text-xs">수집된 정산 내역: <b>{cloud.actualsCount}건</b></span>
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer font-medium">Gmail 자동 전달 설정 방법 (1회, 3분)</summary>
            <ol className="list-decimal ml-4 mt-1.5 space-y-1">
              <li>Gmail → ⚙️ 설정 → <b>전달 및 POP/IMAP</b> → "전달 주소 추가"에 위 주소 입력</li>
              <li>Gmail이 위 주소로 확인 메일을 보냅니다 → 잠시 후 이 페이지를 새로고침하면 아래에 <b>인증 코드</b>가 표시됩니다</li>
              <li>코드 입력으로 전달 주소 인증 완료</li>
              <li>Gmail 검색창에 <code>from:airbnb.com</code> 입력 → 검색 옵션에서 <b>필터 만들기</b> → "전달" 체크 후 위 주소 선택</li>
            </ol>
            <p className="mt-1.5 text-emerald-700">에어비앤비 발신 메일만 전달되며, 그 외 메일이 와도 서버에서 즉시 삭제됩니다.</p>
          </details>
          {cloud.verification && (
            <div className="rounded-lg bg-white border border-emerald-200 p-3 text-xs">
              <div className="font-semibold mb-1">📨 전달 확인 메일 도착 ({cloud.verification.receivedAt.slice(0, 16).replace('T', ' ')})</div>
              <div className="text-slate-600 mb-1">{cloud.verification.subject}</div>
              <pre className="whitespace-pre-wrap text-slate-500 max-h-40 overflow-y-auto">{cloud.verification.snippet}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

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

      {cloud && <PayoutMailCard />}

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
