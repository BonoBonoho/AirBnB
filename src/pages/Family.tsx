import { useEffect, useState } from 'react'
import { useStore } from '../lib/store'
import { Card, PageTitle } from '../components/ui'
import type { TeamMember } from '../lib/api'

/** 집 모드 — 가족 초대 (스마트홈 권한만 부여, 팀 인프라 재사용) */
export default function Family() {
  const { cloud } = useStore()
  const [list, setList] = useState<TeamMember[] | null>(null)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (cloud && cloud.perms === 'owner') {
      cloud.team.get().then((r) => setList(r.members)).catch(() => setList([]))
    }
  }, [cloud])

  if (!cloud) {
    return (
      <div>
        <PageTitle title="가족 초대" desc="함께 쓸 사람을 초대해요" />
        <Card>데모 모드에서는 사용할 수 없습니다. stayprice.co에 로그인 후 이용하세요.</Card>
      </div>
    )
  }

  if (cloud.perms !== 'owner') {
    return (
      <div>
        <PageTitle title="가족 초대" desc="함께 쓸 사람을 초대해요" />
        <Card>초대는 공간 소유자만 할 수 있어요. 상단에서 "내 공간"으로 전환하면 내 집에 가족을 초대할 수 있습니다.</Card>
      </div>
    )
  }

  const invite = async () => {
    const em = email.trim().toLowerCase()
    if (!/.+@.+\..+/.test(em)) { setMsg('올바른 이메일을 입력해 주세요'); return }
    setBusy(true)
    setMsg('')
    try {
      const members = [
        ...(list ?? []).filter((m) => m.email !== em),
        { email: em, perms: { smart: true }, invitedAt: new Date().toISOString() },
      ]
      await cloud.team.put(members)
      setList(members)
      setEmail('')
      setMsg('✓ 초대 완료 — 같은 이메일로 가입 후 로그인하면 됩니다')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '초대 실패')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (em: string) => {
    const members = (list ?? []).filter((m) => m.email !== em)
    await cloud.team.put(members).catch(() => setMsg('해제 실패'))
    setList(members)
  }

  return (
    <div>
      <PageTitle title="가족 초대" desc="가족이 함께 우리집 기기를 제어할 수 있어요 (스마트홈 기능만 보입니다)" />
      <Card className="mb-4">
        <div className="font-semibold mb-1">👨‍👩‍👧 새 가족 초대</div>
        <p className="text-xs text-slate-400 mb-3 leading-relaxed">
          초대한 가족이 stayprice.co에 <b>같은 이메일로 가입</b> 후 로그인 → <b>집 모드</b> 선택 →
          상단에서 "회원님의 집"을 고르면 됩니다. 폰 홈 화면에 추가하면 앱처럼 쓸 수 있어요.
        </p>
        <div className="flex gap-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') invite() }}
            placeholder="가족 이메일 (예: family@gmail.com)"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button onClick={invite} disabled={busy || !email.trim()}
            className="rounded-lg bg-indigo-500 text-white px-4 py-2 text-sm font-semibold hover:bg-indigo-600 disabled:opacity-50">
            {busy ? '초대 중…' : '초대'}
          </button>
        </div>
        {msg && (
          <p className={`text-xs mt-1.5 ${msg.startsWith('✓') ? 'text-emerald-600' : 'text-amber-600'}`}>{msg}</p>
        )}
      </Card>

      <Card>
        <div className="font-semibold mb-2">함께 쓰는 사람 {list ? `(${list.length})` : ''}</div>
        {list === null ? (
          <p className="text-sm text-slate-400">불러오는 중…</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-slate-400">아직 초대한 사람이 없어요.</p>
        ) : (
          <div className="space-y-1.5">
            {list.map((m) => (
              <div key={m.email} className="flex items-center justify-between gap-2 text-sm rounded-lg bg-slate-50 px-3 py-2">
                <span className="truncate">
                  {m.email}
                  <span className="ml-1.5 text-xs text-slate-400">
                    {m.perms.pricing || m.perms.channels || m.perms.guest ? '(공동 호스트)' : '(가족·스마트홈)'}
                  </span>
                </span>
                <button onClick={() => remove(m.email)} className="text-xs text-rose-500 shrink-0 hover:underline">해제</button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
