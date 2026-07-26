import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../lib/store'
import { Card, PageTitle } from '../components/ui'
import type { SmartHomeState, SmartDevice, SmartDeviceStatus, SmartLog } from '../lib/api'

const EMPTY: SmartHomeState = { config: {}, devices: [], rules: {} }

const AC_MODES: { value: string; label: string }[] = [
  { value: 'cool', label: '냉방' },
  { value: 'dry', label: '제습' },
  { value: 'wind', label: '송풍' },
  { value: 'auto', label: '자동' },
  { value: 'heat', label: '난방' },
]
const FAN_MODES: { value: string; label: string }[] = [
  { value: 'auto', label: '자동' },
  { value: 'low', label: '약' },
  { value: 'medium', label: '중' },
  { value: 'high', label: '강' },
  { value: 'turbo', label: '터보' },
]

function modeLabel(v?: string): string {
  return AC_MODES.find((m) => m.value === v)?.label ?? v ?? ''
}
function fanLabel(v?: string): string {
  return FAN_MODES.find((m) => m.value === v)?.label ?? v ?? ''
}

/** KST 기준 YYYY-MM-DD */
function kstDate(offsetDays = 0): string {
  return new Date(Date.now() + 9 * 3600_000 - offsetDays * 86400_000).toISOString().slice(0, 10)
}

function fmtMin(min: number): string {
  if (min <= 0) return '0분'
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? (m > 0 ? `${h}시간 ${m}분` : `${h}시간`) : `${m}분`
}

function fmtEventTime(ts: string): string {
  const d = new Date(Date.parse(ts) + 9 * 3600_000)
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

function eventLabel(ev: string): string {
  if (ev === 'on') return '켜짐'
  if (ev === 'off') return '꺼짐'
  if (ev.startsWith('temp:')) return `온도 ${ev.slice(5)}°설정`
  if (ev.startsWith('mode:')) return `${modeLabel(ev.slice(5))} 모드`
  if (ev.startsWith('fan:')) return `팬 ${fanLabel(ev.slice(4))}`
  return ev
}

const BY_LABEL = { user: '앱', auto: '자동화', sample: '감지' } as const

export default function SmartRoom() {
  const { listings, cloud } = useStore()
  const location = useLocation()
  const navigate = useNavigate()
  const [state, setState] = useState<SmartHomeState>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [available, setAvailable] = useState<SmartDevice[]>([])
  const [statuses, setStatuses] = useState<Record<string, SmartDeviceStatus>>({})
  const [log, setLog] = useState<SmartLog | null>(null)
  const [showHistory, setShowHistory] = useState<Record<string, boolean>>({})
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')
  const [stToken, setStToken] = useState('')
  const [tuyaId, setTuyaId] = useState('')
  const [tuyaKey, setTuyaKey] = useState('')
  const [tuyaRegion, setTuyaRegion] = useState<'us' | 'eu' | 'cn' | 'in'>('us')
  const [editId, setEditId] = useState('')
  const [editAlias, setEditAlias] = useState('')
  const [editZone, setEditZone] = useState('')
  // 연동·기기 배정 섹션 — 설정이 끝난 계정은 기본 접힘 (운영 화면 깔끔하게)
  const [showSetup, setShowSetup] = useState(false)

  const refreshStatus = useCallback(() => {
    if (!cloud) return
    cloud.smart.status().then((r) => {
      const map: Record<string, SmartDeviceStatus> = {}
      r.statuses.forEach((s) => { map[s.deviceId] = s })
      setStatuses(map)
    }).catch(() => {})
    cloud.smart.history().then((r) => setLog(r.log)).catch(() => {})
  }, [cloud])

  useEffect(() => {
    if (!cloud) return
    cloud.smart.get().then((s) => {
      setState({ ...EMPTY, ...s })
      setAvailable(s.available ?? [])
      setLoaded(true)
      // 아직 연동 전이거나 배정된 기기가 없으면 설정 섹션을 펼쳐서 시작
      setShowSetup(!(s.config?.smartthings || s.config?.tuya) || !(s.devices?.length))
      if (s.devices?.length) refreshStatus()
    }).catch(() => setLoaded(true))
  }, [cloud, refreshStatus])

  // 스마트싱스 OAuth 콜백 결과 (?st=connected 등)
  useEffect(() => {
    const st = new URLSearchParams(location.search).get('st')
    if (!st) return
    if (st === 'connected') setMsg('✓ 삼성 계정 연동 완료 — 이제 토큰이 자동 갱신됩니다')
    else if (st === 'expired') setMsg('연동 링크가 만료되었습니다. 다시 시도해 주세요.')
    else if (st === 'noapp') setMsg('서비스에 OAuth 앱이 등록되지 않았습니다.')
    else setMsg('삼성 계정 연동에 실패했습니다. 다시 시도해 주세요.')
    setShowSetup(true)
    navigate('/smartroom', { replace: true })
  }, [location.search, navigate])

  if (!cloud) {
    return (
      <div>
        <PageTitle title="스마트룸" desc="객실 온도 모니터링과 조명·에어컨 제어 (스마트싱스/Tuya)" />
        <Card>데모 모드에서는 사용할 수 없습니다. stayprice.co에 로그인 후 이용하세요.</Card>
      </div>
    )
  }
  if (!loaded) return <div className="text-slate-400 p-8">불러오는 중…</div>

  const saveConfig = async () => {
    setBusy('config')
    setMsg('')
    try {
      const config = { ...state.config }
      if (stToken.trim()) config.smartthings = { ...config.smartthings, token: stToken.trim() }
      if (tuyaId.trim() && tuyaKey.trim()) config.tuya = { accessId: tuyaId.trim(), accessKey: tuyaKey.trim(), region: tuyaRegion }
      await cloud.smart.put({ config })
      setState((p) => ({ ...p, config }))
      setStToken(''); setTuyaId(''); setTuyaKey('')
      const r = await cloud.smart.listDevices()
      setAvailable(r.devices)
      setMsg(r.errors.length ? `일부 실패: ${r.errors.join(' / ')}` : `✓ 연동 성공 — 기기 ${r.devices.length}개 발견`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  const startOauth = async () => {
    setBusy('oauth')
    setMsg('')
    try {
      const r = await cloud.smart.oauthUrl()
      window.location.href = r.url
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
      setBusy('')
    }
  }

  const loadDevices = async () => {
    setBusy('devices')
    try {
      const r = await cloud.smart.listDevices()
      setAvailable(r.devices)
      setMsg(r.errors.length ? `일부 실패: ${r.errors.join(' / ')}` : `기기 ${r.devices.length}개`)
    } finally {
      setBusy('')
    }
  }

  const assign = async (d: SmartDevice, listingId: string) => {
    const prev = state.devices.find((x) => x.deviceId === d.deviceId)
    const devices = state.devices.filter((x) => x.deviceId !== d.deviceId)
    if (listingId) devices.push({ ...d, alias: prev?.alias, zone: prev?.zone, listingId })
    await cloud.smart.put({ devices })
    setState((p) => ({ ...p, devices }))
    refreshStatus()
  }

  const updateDevice = async (deviceId: string, patch: Partial<SmartDevice>) => {
    const devices = state.devices.map((x) => (x.deviceId === deviceId ? { ...x, ...patch } : x))
    await cloud.smart.put({ devices })
    setState((p) => ({ ...p, devices }))
  }

  const startEdit = (d: SmartDevice) => {
    setEditId(d.deviceId)
    setEditAlias(d.alias ?? '')
    setEditZone(d.zone ?? '')
  }

  const saveEdit = async () => {
    await updateDevice(editId, { alias: editAlias.trim() || undefined, zone: editZone.trim() || undefined })
    setEditId('')
  }

  const setRule = async (listingId: string, patch: Partial<SmartHomeState['rules'][string]>) => {
    const rules = { ...state.rules, [listingId]: { preheatMinutes: 60, targetTemp: 24, ...state.rules[listingId], ...patch } }
    await cloud.smart.put({ rules })
    setState((p) => ({ ...p, rules }))
  }

  const command = async (d: SmartDevice, cmd: 'on' | 'off' | 'setCoolingSetpoint' | 'setAcMode' | 'setFanMode', arg?: number | string) => {
    setBusy(d.deviceId)
    try {
      await cloud.smart.command({ provider: d.provider, deviceId: d.deviceId, command: cmd, arg })
      // 낙관적 반영 (실제 값은 1.2초 후 재조회로 확정)
      setStatuses((p) => {
        const s = p[d.deviceId]
        if (!s) return p
        const next = { ...s }
        if (cmd === 'on' || cmd === 'off') next.switch = cmd
        if (cmd === 'setCoolingSetpoint') next.coolingSetpoint = Number(arg)
        if (cmd === 'setAcMode') next.acMode = String(arg)
        if (cmd === 'setFanMode') next.fanMode = String(arg)
        return { ...p, [d.deviceId]: next }
      })
      setTimeout(refreshStatus, 1500)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  const connected = !!(state.config.smartthings || state.config.tuya)
  const stOauth = !!state.config.smartthings?.oauth

  const ZONE_DEFAULTS = ['거실', '안방', '작은방', '주방', '테라스', '1층', '2층']
  const zoneSuggest = [
    ...new Set([...state.devices.map((d) => d.zone?.trim()).filter((z): z is string => !!z), ...ZONE_DEFAULTS]),
  ]

  /** 최근 7일 가동시간 합 (분) */
  const weekMin = (deviceId: string): number => {
    if (!log) return 0
    let sum = 0
    for (let i = 0; i < 7; i++) sum += log.days[kstDate(i)]?.[deviceId] ?? 0
    return sum
  }

  const deviceName = (deviceId: string): string => {
    const d = state.devices.find((x) => x.deviceId === deviceId)
    return d?.alias || d?.name || '기기'
  }

  const renderDevice = (d: SmartDevice) => {
    const s = statuses[d.deviceId]
    const isOn = s?.switch === 'on'
    const isBusy = busy === d.deviceId

    if (editId === d.deviceId) {
      return (
        <div key={d.deviceId} className="rounded-2xl border border-indigo-200 bg-indigo-50/50 px-3.5 py-3 text-sm space-y-1.5">
          <div className="text-[11px] text-slate-400 truncate">
            {d.name}{d.room ? ` · 📍${d.room}` : ''}{d.model ? ` · ${d.model}` : ''}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <input value={editAlias} onChange={(e) => setEditAlias(e.target.value)} placeholder="별칭 (예: 거실 에어컨)"
              className="flex-1 min-w-32 rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
            <input value={editZone} onChange={(e) => setEditZone(e.target.value)} list="zone-suggest" placeholder="공간/층 (예: 거실, 2층)"
              className="flex-1 min-w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
            <button onClick={saveEdit}
              className="rounded-lg bg-indigo-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-indigo-700">저장</button>
            <button onClick={() => setEditId('')}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs hover:bg-slate-50">취소</button>
          </div>
        </div>
      )
    }

    const chips: string[] = []
    if (s?.temperature !== undefined) chips.push(`🌡 ${s.temperature.toFixed(1)}°`)
    if (s?.humidity !== undefined) chips.push(`💧 ${Math.round(s.humidity)}%`)
    if (isOn && s?.acMode) chips.push(`❄️ ${modeLabel(s.acMode)}`)
    if (isOn && s?.fanMode) chips.push(`🌀 팬 ${fanLabel(s.fanMode)}`)
    if (isOn && s?.power !== undefined && s.power > 0) chips.push(`⚡ ${Math.round(s.power)}W`)
    if (s?.energy !== undefined && s.energy > 0) chips.push(`🔋 누적 ${s.energy.toFixed(1)}kWh`)
    if (s && !s.online) chips.push('오프라인')

    const canSwitch = d.caps.includes('switch') || d.caps.includes('ac')
    const isAc = d.caps.includes('ac')
    const sp = s?.coolingSetpoint

    return (
      <div key={d.deviceId} className={`rounded-2xl border px-3.5 py-3 text-sm transition-colors ${isOn ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200'}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 truncate">
            <span className={`inline-block w-2 h-2 rounded-full mr-1.5 align-middle ${isOn ? 'bg-emerald-500' : s?.switch === 'off' ? 'bg-slate-300' : 'bg-slate-200'}`} />
            <span className="font-semibold" title={d.name}>{d.alias || d.name}</span>
            <button onClick={() => startEdit(d)} title="별칭·공간 수정"
              className="ml-1 text-slate-300 hover:text-indigo-600 text-xs align-middle">✏️</button>
          </div>
          {canSwitch && (
            <button
              onClick={() => command(d, isOn ? 'off' : 'on')}
              disabled={isBusy}
              aria-label={isOn ? '끄기' : '켜기'}
              className={`relative shrink-0 w-14 h-8 rounded-full transition-colors ${isOn ? 'bg-emerald-500' : 'bg-slate-300'} ${isBusy ? 'opacity-50' : ''}`}
            >
              <span className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow transition-all ${isOn ? 'left-7' : 'left-1'}`} />
            </button>
          )}
        </div>
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {chips.map((c) => (
              <span key={c} className="rounded-full bg-white/80 border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600">{c}</span>
            ))}
          </div>
        )}
        {isAc && isOn && (
          <div className="mt-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-500 w-8">온도</span>
              <button onClick={() => command(d, 'setCoolingSetpoint', Math.max(16, (sp ?? 24) - 1))} disabled={isBusy}
                className="w-9 h-9 rounded-xl border border-slate-300 bg-white text-lg font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40">−</button>
              <span className="w-12 text-center font-bold text-base">{sp !== undefined ? `${sp}°` : '—'}</span>
              <button onClick={() => command(d, 'setCoolingSetpoint', Math.min(30, (sp ?? 24) + 1))} disabled={isBusy}
                className="w-9 h-9 rounded-xl border border-slate-300 bg-white text-lg font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40">+</button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-slate-500 w-8">모드</span>
              {AC_MODES.map((m) => (
                <button key={m.value} onClick={() => command(d, 'setAcMode', m.value)} disabled={isBusy}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium border ${s?.acMode === m.value ? 'bg-sky-500 border-sky-500 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'} disabled:opacity-40`}>
                  {m.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-slate-500 w-8">팬</span>
              {FAN_MODES.map((m) => (
                <button key={m.value} onClick={() => command(d, 'setFanMode', m.value)} disabled={isBusy}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium border ${s?.fanMode === m.value ? 'bg-sky-500 border-sky-500 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'} disabled:opacity-40`}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {log && (
          <div className="mt-2 text-[11px] text-slate-400">
            오늘 가동 {fmtMin(log.days[kstDate()]?.[d.deviceId] ?? 0)} · 7일 {fmtMin(weekMin(d.deviceId))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <PageTitle title="스마트룸" desc="객실 온도 모니터링 + 조명·에어컨 제어 + 예약 연동 자동화" />
        <button
          onClick={() => setShowSetup(!showSetup)}
          className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
            showSetup ? 'border-slate-400 bg-slate-100 text-slate-700' : 'border-slate-300 bg-white text-slate-500 hover:bg-slate-50'
          }`}
        >
          ⚙️ 연동 설정{showSetup ? ' ▴' : ' ▾'}
        </button>
      </div>
      <datalist id="zone-suggest">
        {zoneSuggest.map((z) => <option key={z} value={z} />)}
      </datalist>

      {showSetup && (
      <>
      <Card className="mb-4">
        <div className="font-semibold mb-3">🔌 계정 연동</div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-200 p-3.5">
            <div className="text-sm font-semibold mb-1.5">
              삼성 스마트싱스{' '}
              {stOauth
                ? <span className="text-emerald-600 text-xs">● 연동됨 (자동 갱신)</span>
                : state.config.smartthings?.token
                  ? <span className="text-amber-600 text-xs">● 연동됨 (수동 토큰 · 24시간 만료 주의)</span>
                  : null}
            </div>
            <button onClick={startOauth} disabled={busy === 'oauth'}
              className="w-full rounded-lg bg-[#1428a0] text-white px-4 py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50 mb-2">
              {busy === 'oauth' ? '이동 중…' : stOauth ? '🔄 삼성 계정 다시 연동' : '🔗 삼성 계정으로 연동 (권장 · 자동 갱신)'}
            </button>
            <details className="text-xs text-slate-400">
              <summary className="cursor-pointer">또는 수동 토큰 입력 (24시간 만료)</summary>
              <p className="my-2">
                <a href="https://account.smartthings.com/tokens" target="_blank" rel="noreferrer" className="underline">account.smartthings.com/tokens</a>에서
                토큰 발급 (권한: Devices 전체 체크) 후 붙여넣기
              </p>
              <input
                type="password"
                value={stToken}
                onChange={(e) => setStToken(e.target.value)}
                placeholder="개인 액세스 토큰"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
              />
            </details>
          </div>
          <div className="rounded-xl border border-slate-200 p-3.5">
            <div className="text-sm font-semibold mb-1.5">
              Tuya (스마트라이프) {state.config.tuya && <span className="text-emerald-600 text-xs">● 연동됨</span>}
            </div>
            <p className="text-xs text-slate-400 mb-2">
              <a href="https://iot.tuya.com" target="_blank" rel="noreferrer" className="underline">iot.tuya.com</a> 클라우드 프로젝트의 Access ID/Secret
            </p>
            <div className="flex gap-2">
              <input value={tuyaId} onChange={(e) => setTuyaId(e.target.value)} placeholder="Access ID"
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono" />
              <select value={tuyaRegion} onChange={(e) => setTuyaRegion(e.target.value as typeof tuyaRegion)}
                className="rounded-lg border border-slate-300 bg-white px-2 text-sm">
                <option value="us">미주</option><option value="eu">유럽</option>
                <option value="cn">중국</option><option value="in">인도</option>
              </select>
            </div>
            <input type="password" value={tuyaKey} onChange={(e) => setTuyaKey(e.target.value)} placeholder="Access Secret"
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono" />
          </div>
        </div>
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          <button onClick={saveConfig} disabled={busy === 'config'}
            className="rounded-lg bg-rose-500 text-white px-4 py-2 text-sm font-semibold hover:bg-rose-600 disabled:opacity-50">
            {busy === 'config' ? '연동 중…' : '저장 & 기기 불러오기'}
          </button>
          {connected && (
            <button onClick={loadDevices} disabled={busy === 'devices'}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">
              기기 다시 불러오기
            </button>
          )}
          {msg && <span className={`text-xs ${msg.startsWith('✓') ? 'text-emerald-600' : 'text-amber-600'}`}>{msg}</span>}
        </div>
      </Card>

      {available.length > 0 && (
        <Card className="mb-4">
          <div className="font-semibold mb-1">발견된 기기 → 숙소에 배정</div>
          <p className="text-xs text-slate-400 mb-3">기기 목록은 자동 저장되어 새로고침해도 유지됩니다.</p>
          <div className="space-y-2">
            {available.map((d) => {
              const mapped = state.devices.find((x) => x.deviceId === d.deviceId)
              return (
                <div key={d.deviceId} className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0 truncate">
                    <span className="font-medium">{mapped?.alias || d.name}</span>
                    {mapped?.alias && <span className="text-[11px] text-slate-400 ml-1">({d.name})</span>}
                    {d.room && (
                      <span className="ml-1.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 px-2 py-0.5 text-[11px] font-medium">
                        📍 {d.room}
                      </span>
                    )}
                    <span className="text-xs text-slate-400 ml-2">
                      {d.provider === 'smartthings' ? '스마트싱스' : 'Tuya'}
                      {d.model ? ` · ${d.model}` : ''}
                      {' · '}
                      {d.caps.map((c) => ({ temp: '온도', humidity: '습도', switch: '스위치', ac: '에어컨' }[c] ?? c)).join('·') || '기타'}
                    </span>
                  </div>
                  <select
                    value={mapped?.listingId ?? ''}
                    onChange={(e) => assign(d, e.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs shrink-0"
                  >
                    <option value="">배정 안 함</option>
                    {listings.filter((l) => l.active).map((l) => (
                      <option key={l.id} value={l.id}>{l.thumbnail} {l.name}</option>
                    ))}
                  </select>
                </div>
              )
            })}
          </div>
        </Card>
      )}
      </>
      )}

      {listings.filter((l) => l.active).map((l) => {
        const devices = state.devices.filter((d) => d.listingId === l.id)
        if (devices.length === 0) return null
        const rule = state.rules[l.id] ?? {}
        const temps = devices.map((d) => statuses[d.deviceId]?.temperature).filter((t): t is number => t !== undefined)
        const hums = devices.map((d) => statuses[d.deviceId]?.humidity).filter((t): t is number => t !== undefined)
        const deviceIds = new Set(devices.map((d) => d.deviceId))
        const listingEvents = (log?.events ?? []).filter((e) => deviceIds.has(e.d)).slice(0, 12)
        return (
          <Card key={l.id} className="mb-4">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <div className="font-semibold">{l.thumbnail} {l.name}</div>
              <div className="flex gap-3 text-sm items-center">
                {temps.length > 0 && <span>🌡 <b>{temps[0].toFixed(1)}°C</b></span>}
                {hums.length > 0 && <span>💧 <b>{Math.round(hums[0])}%</b></span>}
                <button onClick={refreshStatus} className="text-xs text-slate-400 underline">새로고침</button>
              </div>
            </div>
            <div className="space-y-3 mb-2">
              {[...new Set(devices.map((d) => d.zone?.trim() || ''))]
                .sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'ko')))
                .map((zone) => {
                  const zoneDevices = devices.filter((d) => (d.zone?.trim() || '') === zone)
                  const showHeader = zone !== '' || zoneDevices.length !== devices.length
                  return (
                    <div key={zone || '_none'}>
                      {showHeader && (
                        <div className="text-xs font-semibold text-slate-500 mb-1.5">
                          {zone ? `🚪 ${zone}` : '공간 미지정'}
                          <span className="font-normal text-slate-400 ml-1">({zoneDevices.length})</span>
                        </div>
                      )}
                      <div className="grid md:grid-cols-2 gap-2">{zoneDevices.map(renderDevice)}</div>
                    </div>
                  )
                })}
            </div>
            <p className="text-[11px] text-slate-400 mb-3">
              ✏️를 눌러 기기 별칭과 공간(거실·안방·2층 등)을 지정하면 공간별로 묶어서 보여드려요.
            </p>

            <button
              onClick={() => setShowHistory((p) => ({ ...p, [l.id]: !p[l.id] }))}
              className="text-xs font-semibold text-slate-500 mb-2 hover:text-slate-700"
            >
              📊 사용 기록 {showHistory[l.id] ? '▴' : '▾'}
            </button>
            {showHistory[l.id] && (
              <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5 mb-3 text-sm">
                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 mb-3">
                  {devices.map((d) => (
                    <div key={d.deviceId} className="flex justify-between text-xs">
                      <span className="text-slate-500 truncate mr-2">{d.alias || d.name}</span>
                      <span className="shrink-0">
                        오늘 <b>{fmtMin(log?.days[kstDate()]?.[d.deviceId] ?? 0)}</b> · 7일 <b>{fmtMin(weekMin(d.deviceId))}</b>
                      </span>
                    </div>
                  ))}
                </div>
                {listingEvents.length > 0 ? (
                  <div className="border-t border-slate-200 pt-2 space-y-1">
                    {listingEvents.map((e, i) => (
                      <div key={i} className="flex items-center gap-2 text-[11px] text-slate-500">
                        <span className="font-mono text-slate-400">{fmtEventTime(e.ts)}</span>
                        <span className="font-medium text-slate-600">{deviceName(e.d)}</span>
                        <span className={e.ev === 'on' ? 'text-emerald-600' : e.ev === 'off' ? 'text-slate-400' : ''}>{eventLabel(e.ev)}</span>
                        <span className="rounded bg-slate-200/70 px-1 text-[10px]">{BY_LABEL[e.by]}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400">아직 기록이 없어요. 15분마다 자동으로 켬/끔과 가동시간을 수집합니다.</p>
                )}
              </div>
            )}

            <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-3.5 text-sm space-y-2">
              <div className="font-semibold text-indigo-900 text-xs">⚡ 예약 연동 자동화 (15분 주기로 자동 실행)</div>
              <label className="flex items-center gap-2 cursor-pointer flex-wrap">
                <input type="checkbox" checked={!!rule.preheat} onChange={(e) => setRule(l.id, { preheat: e.target.checked })} className="accent-indigo-600" />
                체크인
                <input type="number" value={rule.preheatMinutes ?? 60} min={0} max={240}
                  onChange={(e) => setRule(l.id, { preheatMinutes: Number(e.target.value) })}
                  className="w-16 rounded border border-indigo-200 px-1.5 py-0.5 text-xs" />
                분 전 에어컨 켜기 (목표
                <input type="number" value={rule.targetTemp ?? 24} min={16} max={30}
                  onChange={(e) => setRule(l.id, { targetTemp: Number(e.target.value) })}
                  className="w-14 rounded border border-indigo-200 px-1.5 py-0.5 text-xs" />
                °C) — 게스트 설문의 체크인 예정시간 기준
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={!!rule.autoOff} onChange={(e) => setRule(l.id, { autoOff: e.target.checked })} className="accent-indigo-600" />
                체크아웃 후(11:30) 기기 자동 전원 차단 — 당일 새 체크인이 있어도 껐다가, 위의 체크인 예열이 시간에 맞춰 다시 켭니다
              </label>
            </div>
          </Card>
        )
      })}

      {connected && state.devices.length === 0 && (
        <Card>
          <p className="text-sm text-slate-500">위에서 기기를 불러온 뒤 숙소에 배정하면 온도·제어 카드가 나타납니다.</p>
        </Card>
      )}
    </div>
  )
}
