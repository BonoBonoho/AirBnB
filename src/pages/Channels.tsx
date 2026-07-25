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
  const [bfProvider, setBfProvider] = useState<'gmail' | 'naver'>('gmail')
  const [bfEmail, setBfEmail] = useState('')
  const [bfPw, setBfPw] = useState('')
  const [bfMsg, setBfMsg] = useState('')
  const [bfBusy, setBfBusy] = useState(false)
  const [bfReset, setBfReset] = useState(false)
  if (!cloud) return null

  const startBackfill = async () => {
    setBfMsg('')
    if (!bfEmail.trim() || !bfPw.trim()) {
      setBfMsg('이메일과 앱 비밀번호를 입력해 주세요')
      return
    }
    setBfBusy(true)
    try {
      await cloud.mailBackfill({ provider: bfProvider, email: bfEmail.trim(), appPassword: bfPw.trim(), reset: bfReset })
      setBfPw('')
      setBfMsg('✓ 스캔 시작! 1~3분 후 이 페이지를 새로고침하면 결과가 표시됩니다.')
    } catch (e) {
      setBfMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBfBusy(false)
    }
  }

  const address = cloud.inboundKey && cloud.emailDomain ? `${cloud.inboundKey}@${cloud.emailDomain}` : null

  return (
    <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900">
      <div className="font-semibold mb-1">💰 실매출 자동 수집 (예약·정산 메일 + CSV)</div>
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
              <li>Gmail 검색창에 <code>from:(airbnb.com OR booking.com)</code> 입력 → 검색 옵션에서 <b>필터 만들기</b> → "전달" 체크 후 위 주소 선택</li>
            </ol>
            <p className="mt-1.5 text-emerald-700">
              예약 확정 메일은 예약 즉시, 정산 메일은 지급 시 자동 반영됩니다. 그 외 메일은 서버에서 즉시 삭제돼요.
            </p>
          </details>
          <details className="text-xs">
            <summary className="cursor-pointer font-medium">📎 과거 매출 일괄 가져오기 (CSV 첨부 메일)</summary>
            <ol className="list-decimal ml-4 mt-1.5 space-y-1">
              <li><b>에어비앤비</b>: 호스트 모드 → 수입 → 거래 내역 → <b>CSV 다운로드</b></li>
              <li><b>부킹닷컴</b>: 엑스트라넷 → 예약 → <b>CSV로 내보내기</b></li>
              <li>다운받은 파일을 <b>위 수신 주소로 첨부해서 메일 전송</b> (제목·본문은 아무거나)</li>
              <li>1~2분 내 자동 반영 — 이 페이지를 새로고침하면 "✓ CSV 가져오기 완료" 확인 메시지와 건수가 표시됩니다</li>
            </ol>
            <p className="mt-1.5 text-emerald-700">예약 코드 기준으로 중복은 자동 제거되니 여러 번 보내도 안전합니다.</p>
          </details>
          <details className="text-xs">
            <summary className="cursor-pointer font-medium">⚡ 과거 메일 자동 스캔 (Gmail/네이버 메일함 백필)</summary>
            <p className="mt-1.5 mb-2 text-emerald-700">
              메일함에서 에어비앤비·부킹닷컴 메일을 자동으로 찾아 과거 매출을 한 번에 반영합니다.
              공식 IMAP 방식이라 안전하고, <b>앱 비밀번호는 1회 사용 후 폐기</b>됩니다 (서버에 저장 안 함).
            </p>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <select value={bfProvider} onChange={(e) => setBfProvider(e.target.value as 'gmail' | 'naver')}
                className="rounded-lg border border-emerald-300 bg-white px-2 py-1.5">
                <option value="gmail">Gmail</option>
                <option value="naver">네이버</option>
              </select>
              <input value={bfEmail} onChange={(e) => setBfEmail(e.target.value)} placeholder="메일 주소"
                className="flex-1 min-w-44 rounded-lg border border-emerald-300 px-2 py-1.5" />
              <input type="password" value={bfPw} onChange={(e) => setBfPw(e.target.value)} placeholder="앱 비밀번호"
                className="flex-1 min-w-36 rounded-lg border border-emerald-300 px-2 py-1.5 font-mono" />
              <button onClick={startBackfill} disabled={bfBusy}
                className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 font-semibold hover:bg-emerald-700 disabled:opacity-50">
                {bfBusy ? '시작 중…' : '스캔 시작'}
              </button>
            </div>
            <label className="flex items-center gap-1.5 mb-2 cursor-pointer text-slate-600">
              <input type="checkbox" checked={bfReset} onChange={(e) => setBfReset(e.target.checked)} className="accent-emerald-600" />
              처음부터 다시 스캔 (숙소 이름 매칭 개선을 기존 메일에도 반영)
            </label>
            {bfMsg && <p className={bfMsg.startsWith('✓') ? 'text-emerald-700' : 'text-amber-600'}>{bfMsg}</p>}
            <ul className="list-disc ml-4 space-y-0.5 text-slate-500">
              <li><b>Gmail 앱 비밀번호</b>: myaccount.google.com/apppasswords에서 생성 (2단계 인증 필요, 16자리)</li>
              <li><b>네이버</b>: 메일 환경설정 → POP3/IMAP 설정에서 <b>IMAP 사용</b> 켜기 + 보안설정의 애플리케이션 비밀번호 사용 (전에 만든 것 재사용 가능)</li>
              <li>스캔이 끝나면 앱 비밀번호를 삭제하셔도 됩니다 — 이후 수집은 전달 필터가 자동 처리해요</li>
            </ul>
          </details>
          {cloud.verification && (
            <div className="rounded-lg bg-white border border-emerald-200 p-3 text-xs">
              <div className="font-semibold mb-1">📨 전달 확인 메일 도착 ({cloud.verification.receivedAt.slice(0, 16).replace('T', ' ')})</div>
              <div className="text-slate-600 mb-1">{cloud.verification.subject}</div>
              <pre className="whitespace-pre-wrap text-slate-500 max-h-40 overflow-y-auto">{cloud.verification.snippet}</pre>
            </div>
          )}
          {cloud.actuals.length > 0 && (
            <details className="text-xs" open={cloud.actuals.length <= 8}>
              <summary className="cursor-pointer font-medium">수집된 정산 내역 보기 ({cloud.actuals.length}건)</summary>
              <div className="mt-2 rounded-lg bg-white border border-emerald-200 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400 border-b border-emerald-100">
                      <th className="text-left px-3 py-2 font-medium">체크인</th>
                      <th className="text-left px-3 py-2 font-medium">게스트</th>
                      <th className="text-right px-3 py-2 font-medium">정산액</th>
                      <th className="text-left px-3 py-2 font-medium">출처</th>
                      <th className="text-left px-3 py-2 font-medium">수집 시각</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...cloud.actuals]
                      .sort((a, b) => (b.checkIn ?? '').localeCompare(a.checkIn ?? ''))
                      .map((a) => (
                        <tr key={a.id} className="border-b border-emerald-50 last:border-0">
                          <td className="px-3 py-1.5">{a.checkIn ?? '?'}{a.nights ? ` (${a.nights}박)` : ''}</td>
                          <td className="px-3 py-1.5">{a.guestName ?? '-'}</td>
                          <td className="px-3 py-1.5 text-right font-semibold">₩{a.amount.toLocaleString('ko-KR')}</td>
                          <td className="px-3 py-1.5">{a.channel === 'booking' ? 'Booking.com' : '에어비앤비'}</td>
                          <td className="px-3 py-1.5 text-slate-400">{a.receivedAt.slice(5, 16).replace('T', ' ')}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </details>
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
            <div className="mb-4 grid md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-500">에어비앤비 iCal URL</label>
                <input
                  type="url"
                  value={l.icalUrl ?? ''}
                  onChange={(e) => updateListing(l.id, { icalUrl: e.target.value || undefined })}
                  placeholder="https://www.airbnb.co.kr/calendar/ical/….ics?s=…"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono placeholder:font-sans"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500">부킹닷컴 iCal URL</label>
                <input
                  type="url"
                  value={l.bookingIcalUrl ?? ''}
                  onChange={(e) => updateListing(l.id, { bookingIcalUrl: e.target.value || undefined })}
                  placeholder="https://ical.booking.com/v1/export?t=…"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono placeholder:font-sans"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  엑스트라넷 → 달력 → 캘린더 동기화 → 캘린더 내보내기에서 복사
                </p>
              </div>
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
