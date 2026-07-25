import { useEffect, useState } from 'react'
import { useStore } from '../lib/store'
import { Card, PageTitle } from '../components/ui'
import type { TeamMember, CoPerms } from '../lib/api'

const PERM_DEFS: { key: keyof CoPerms; label: string; desc: string }[] = [
  { key: 'pricing', label: '가격·숙소 관리', desc: '숙소 추가/수정, 가격 규칙·캘린더, 시장 분석' },
  { key: 'channels', label: '채널·매출', desc: 'iCal 동기화, 정산 메일 설정' },
  { key: 'smart', label: '스마트룸·도어', desc: '기기 제어, 자동화 설정' },
  { key: 'guest', label: '게스트·미니홈', desc: '설문 관리, 미니홈 발행, 문의함' },
]

export default function Team() {
  const { cloud } = useStore()
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loaded, setLoaded] = useState(false)
  const [email, setEmail] = useState('')
  const [newPerms, setNewPerms] = useState<CoPerms>({ pricing: false, channels: false, smart: false, guest: false })
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!cloud) return
    cloud.team.get().then((t) => {
      setMembers(t.members ?? [])
      setLoaded(true)
    }).catch((e) => {
      setMsg(e instanceof Error ? e.message : String(e))
      setLoaded(true)
    })
  }, [cloud])

  if (!cloud) {
    return (
      <div>
        <PageTitle title="관리자" desc="공동 호스트 초대와 권한 관리" />
        <Card>데모 모드에서는 사용할 수 없습니다. stayprice.co에 로그인 후 이용하세요.</Card>
      </div>
    )
  }
  if (cloud.perms !== 'owner') {
    return (
      <div>
        <PageTitle title="관리자" desc="공동 호스트 초대와 권한 관리" />
        <Card>소유자만 접근할 수 있는 메뉴입니다.</Card>
      </div>
    )
  }
  if (!loaded) return <div className="text-slate-400 p-8">불러오는 중…</div>

  const save = async (next: TeamMember[]) => {
    setBusy(true)
    setMsg('')
    try {
      await cloud.team.put(next)
      setMembers(next)
      setMsg('✓ 저장되었습니다')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const invite = async () => {
    const em = email.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) {
      setMsg('올바른 이메일을 입력해 주세요')
      return
    }
    if (members.some((m) => m.email === em)) {
      setMsg('이미 초대된 이메일입니다')
      return
    }
    await save([...members, { email: em, perms: { ...newPerms }, invitedAt: new Date().toISOString() }])
    setEmail('')
    setNewPerms({ pricing: false, channels: false, smart: false, guest: false })
  }

  const togglePerm = (em: string, key: keyof CoPerms) => {
    const next = members.map((m) =>
      m.email === em ? { ...m, perms: { ...m.perms, [key]: !m.perms[key] } } : m,
    )
    save(next)
  }

  const remove = (em: string) => {
    if (!confirm(`${em} 님을 팀에서 제외할까요? 즉시 접근이 차단됩니다.`)) return
    save(members.filter((m) => m.email !== em))
  }

  return (
    <div>
      <PageTitle title="👑 관리자" desc="공동 호스트를 초대하고 기능별 권한을 관리합니다" />

      <Card className="mb-4">
        <div className="font-semibold mb-1">공동 호스트 초대</div>
        <p className="text-xs text-slate-400 mb-3">
          초대한 사람이 stayprice.co에서 <b>같은 이메일로 가입·로그인</b>하면, 화면 왼쪽 위 워크스페이스 선택에서
          이 숙소로 전환해 사용할 수 있어요. 조회는 항상 가능하고, 아래에 체크한 항목만 수정할 수 있습니다.
        </p>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="이메일 (예: cohost@naver.com)"
            className="flex-1 min-w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button onClick={invite} disabled={busy}
            className="rounded-lg bg-rose-500 text-white px-4 py-2 text-sm font-semibold hover:bg-rose-600 disabled:opacity-50">
            초대하기
          </button>
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          {PERM_DEFS.map((p) => (
            <label key={p.key} className="flex items-start gap-2 rounded-xl border border-slate-200 p-3 cursor-pointer hover:bg-slate-50">
              <input
                type="checkbox"
                checked={!!newPerms[p.key]}
                onChange={(e) => setNewPerms((prev) => ({ ...prev, [p.key]: e.target.checked }))}
                className="mt-0.5 accent-rose-500"
              />
              <span>
                <span className="text-sm font-medium block">{p.label}</span>
                <span className="text-[11px] text-slate-400">{p.desc}</span>
              </span>
            </label>
          ))}
        </div>
        {msg && <p className={`text-xs mt-3 ${msg.startsWith('✓') ? 'text-emerald-600' : 'text-amber-600'}`}>{msg}</p>}
      </Card>

      <Card>
        <div className="font-semibold mb-3">팀원 ({members.length})</div>
        {members.length === 0 ? (
          <p className="text-sm text-slate-400">아직 초대한 공동 호스트가 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {members.map((m) => (
              <div key={m.email} className="rounded-xl border border-slate-200 p-3.5">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-2.5">
                  <div className="min-w-0">
                    <span className="font-medium text-sm">🤝 {m.email}</span>
                    {m.invitedAt && (
                      <span className="text-[11px] text-slate-400 ml-2">
                        {m.invitedAt.slice(0, 10)} 초대
                      </span>
                    )}
                  </div>
                  <button onClick={() => remove(m.email)} disabled={busy}
                    className="text-xs text-slate-400 underline hover:text-rose-600">
                    제외
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className="rounded-full bg-slate-100 text-slate-500 px-2.5 py-1 text-[11px]">조회 (기본)</span>
                  {PERM_DEFS.map((p) => (
                    <button
                      key={p.key}
                      onClick={() => togglePerm(m.email, p.key)}
                      disabled={busy}
                      title={p.desc}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-medium border transition-colors ${
                        m.perms[p.key]
                          ? 'bg-rose-500 border-rose-500 text-white'
                          : 'bg-white border-slate-300 text-slate-400 hover:border-slate-400'
                      }`}
                    >
                      {m.perms[p.key] ? '✓ ' : ''}{p.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
