import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../lib/store'
import { Card, PageTitle } from '../components/ui'
import type { SmartHomeState, SmartDevice, SmartDeviceStatus, SmartLog, SmartScene, SmartSchedule, SmartCommandName } from '../lib/api'

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

/** 삼성 에어컨 부가 모드 라벨 (custom.airConditionerOptionalMode) */
const OPT_LABEL: Record<string, string> = {
  windFree: '무풍',
  windFreeSleep: '무풍 취침',
  sleep: '열대야 쾌면',
  speed: '스피드',
  quiet: '조용히',
  smart: '스마트',
  longWind: '롱바람',
  motionIndirect: '간접바람',
  motionDirect: '직접바람',
}
function optLabel(v: string): string {
  return OPT_LABEL[v] ?? v
}

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
  if (ev.startsWith('vol:')) return `볼륨 ${ev.slice(4)}`
  if (ev.startsWith('opt:')) return ev.slice(4) === 'off' ? '부가모드 끔' : `${optLabel(ev.slice(4))} 모드`
  if (ev === 'mute') return '음소거'
  if (ev === 'unmute') return '음소거 해제'
  if (ev === 'channelUp') return '채널 ▲'
  if (ev === 'channelDown') return '채널 ▼'
  if (ev === 'play') return '재생'
  if (ev === 'pause') return '일시정지'
  return ev
}

const BY_LABEL = { user: '앱', auto: '자동화', sample: '감지' } as const

/** 재조회한 기기 정보(기능·방·모델)를 배정된 기기 목록에 병합 */
function mergeFreshDevices(current: SmartDevice[], fresh: SmartDevice[]): { devices: SmartDevice[]; changed: boolean } {
  const byId = new Map(fresh.map((f) => [f.deviceId, f]))
  let changed = false
  const devices = current.map((d) => {
    const f = byId.get(d.deviceId)
    if (!f) return d
    const next = { ...d, caps: f.caps, room: f.room, model: f.model, name: f.name }
    if (JSON.stringify(next) !== JSON.stringify(d)) changed = true
    return next
  })
  return { devices, changed }
}

export default function SmartRoom() {
  const { listings, cloud, mode } = useStore()
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
  const [hejToken, setHejToken] = useState('')
  const [hejClientId, setHejClientId] = useState('')
  const [hejClientSecret, setHejClientSecret] = useState('')
  const [hejAppKey, setHejAppKey] = useState('')
  const [hejEmail, setHejEmail] = useState('')
  const [hejPw, setHejPw] = useState('')
  const [editId, setEditId] = useState('')
  const [editAlias, setEditAlias] = useState('')
  const [editZone, setEditZone] = useState('')
  const [sceneEdit, setSceneEdit] = useState(false)
  const [sceneMsg, setSceneMsg] = useState('')
  const [dropTarget, setDropTarget] = useState('')
  const [extraZones, setExtraZones] = useState<{ spaceId: string; name: string }[]>([])
  const [detailId, setDetailId] = useState('')
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
      setShowSetup(!(s.config?.smartthings || s.config?.tuya || s.config?.hejhome) || !(s.devices?.length))
      if (s.devices?.length) {
        refreshStatus()
        // 백그라운드로 기능 목록 최신화 — 드라이버가 새 기능을 감지하면 배정 기기에도 반영
        cloud.smart.listDevices().then(async (r) => {
          setAvailable(r.devices)
          const { devices, changed } = mergeFreshDevices(s.devices ?? [], r.devices)
          if (changed) {
            await cloud.smart.put({ devices })
            setState((p) => ({ ...p, devices }))
          }
        }).catch(() => {})
      }
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

  /**
   * 재조회한 기기 정보(caps·방·모델)를 이미 배정된 기기에도 반영.
   * 드라이버가 새 기능(볼륨·채널 등)을 감지하게 되면 기존 배정 기기도 따라온다.
   */
  const syncAssigned = async (fresh: SmartDevice[]) => {
    const { devices, changed } = mergeFreshDevices(state.devices, fresh)
    if (changed) {
      await cloud.smart.put({ devices })
      setState((p) => ({ ...p, devices }))
    }
  }

  const saveConfig = async () => {
    setBusy('config')
    setMsg('')
    try {
      const config = { ...state.config }
      if (stToken.trim()) config.smartthings = { ...config.smartthings, token: stToken.trim() }
      if (tuyaId.trim() && tuyaKey.trim()) config.tuya = { accessId: tuyaId.trim(), accessKey: tuyaKey.trim(), region: tuyaRegion }
      if (hejToken.trim()) config.hejhome = { token: hejToken.trim() }
      await cloud.smart.put({ config })
      setState((p) => ({ ...p, config }))
      setStToken(''); setTuyaId(''); setTuyaKey(''); setHejToken('')
      const r = await cloud.smart.listDevices()
      setAvailable(r.devices)
      await syncAssigned(r.devices)
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

  const hejConnect = async () => {
    setBusy('hej')
    setMsg('')
    try {
      const r = await cloud.smart.hejLogin({
        clientId: hejClientId.trim(),
        clientSecret: hejClientSecret.trim(),
        appKey: hejAppKey.trim(),
        username: hejEmail.trim(),
        password: hejPw,
      })
      setState((p) => ({
        ...p,
        config: { ...p.config, hejhome: { creds: { clientId: hejClientId.trim() }, oauth: { expiresAt: r.expiresAt } } },
      }))
      setHejClientId(''); setHejClientSecret(''); setHejAppKey(''); setHejEmail(''); setHejPw('')
      const d = await cloud.smart.listDevices()
      setAvailable(d.devices)
      setMsg(d.errors.length ? `일부 실패: ${d.errors.join(' / ')}` : `✓ 헤이홈 연동 성공 — 기기 ${d.devices.length}개 발견`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  const loadDevices = async () => {
    setBusy('devices')
    try {
      const r = await cloud.smart.listDevices()
      setAvailable(r.devices)
      await syncAssigned(r.devices)
      setMsg(r.errors.length ? `일부 실패: ${r.errors.join(' / ')}` : `기기 ${r.devices.length}개`)
    } finally {
      setBusy('')
    }
  }

  // ── 씬 & 시간 예약 ─────────────────────────────────────────
  const persistSmart = (patch: { scenes?: SmartScene[]; schedules?: SmartSchedule[] }) => {
    cloud.smart.put(patch).catch(() => setSceneMsg('저장 실패 — 네트워크를 확인해 주세요'))
  }

  const patchScenes = (fn: (prev: SmartScene[]) => SmartScene[], persist = false) => {
    const scenes = fn(state.scenes ?? [])
    setState((p) => ({ ...p, scenes }))
    if (persist) persistSmart({ scenes })
  }

  const patchSchedules = (fn: (prev: SmartSchedule[]) => SmartSchedule[]) => {
    const schedules = fn(state.schedules ?? [])
    setState((p) => ({ ...p, schedules }))
    persistSmart({ schedules })
  }

  const finishSceneEdit = () => {
    setSceneEdit(false)
    persistSmart({ scenes: state.scenes ?? [] })
    setSceneMsg('✓ 씬 저장 완료')
  }

  const runScene = async (sc: SmartScene) => {
    setBusy(`scene:${sc.id}`)
    setSceneMsg('')
    let fail = 0
    for (const a of sc.actions) {
      if (a.command !== 'on' && a.command !== 'off') continue
      try {
        await cloud.smart.command({ provider: a.provider, deviceId: a.deviceId, command: a.command })
      } catch {
        fail++
      }
    }
    setSceneMsg(fail === 0 ? `✓ ${sc.name} 실행 완료` : `${sc.name}: 기기 ${fail}개 실행 실패`)
    setBusy('')
    refreshStatus()
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

  const command = async (d: SmartDevice, cmd: SmartCommandName, arg?: number | string) => {
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
        if (cmd === 'setVolume') next.volume = Number(arg)
        if (cmd === 'mute') next.mute = true
        if (cmd === 'unmute') next.mute = false
        return { ...p, [d.deviceId]: next }
      })
      setTimeout(refreshStatus, 1500)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  /** 드래그앤드랍으로 기기를 다른 공간(또는 다른 숙소)으로 이동 */
  const moveDevice = async (deviceId: string, listingId: string, zone: string) => {
    const dev = state.devices.find((x) => x.deviceId === deviceId)
    if (!dev || (dev.listingId === listingId && (dev.zone?.trim() || '') === zone)) return
    await updateDevice(deviceId, { zone: zone || undefined, listingId })
  }

  const connected = !!(state.config.smartthings || state.config.tuya || state.config.hejhome)
  const PROVIDER_LABEL = { smartthings: '스마트싱스', tuya: 'Tuya', hejhome: '헤이홈' } as const
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
    if (isOn && s?.volume !== undefined) chips.push(s.mute ? '🔇 음소거' : `🔊 ${s.volume}`)
    if (s && !s.online) chips.push('오프라인')

    const canSwitch = d.caps.includes('switch') || d.caps.includes('ac')
    const isAc = d.caps.includes('ac')
    const sp = s?.coolingSetpoint

    return (
      <div
        key={d.deviceId}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', d.deviceId)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onClick={(e) => {
          // 버튼(토글·모드·✏️ 등)을 누른 게 아니면 카드 어디를 눌러도 상세로
          if ((e.target as HTMLElement).closest('button')) return
          setDetailId(d.deviceId)
          refreshStatus()
        }}
        className={`rounded-2xl border px-3.5 py-3 text-sm transition-colors cursor-pointer md:cursor-grab ${isOn ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200'}`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 truncate">
            <span className={`inline-block w-2 h-2 rounded-full mr-1.5 align-middle ${isOn ? 'bg-emerald-500' : s?.switch === 'off' ? 'bg-slate-300' : 'bg-slate-200'}`} />
            <button
              onClick={() => { setDetailId(d.deviceId); refreshStatus() }}
              title="상세 화면 열기"
              className="font-semibold hover:text-indigo-600"
            >
              {d.alias || d.name} <span className="text-slate-300 text-xs">›</span>
            </button>
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
              <button onClick={() => command(d, 'setCoolingSetpoint', Math.max(16, (sp ?? 24) - 0.5))} disabled={isBusy}
                className="w-9 h-9 rounded-xl border border-slate-300 bg-white text-lg font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40">−</button>
              <span className="w-12 text-center font-bold text-base">{sp !== undefined ? `${sp}°` : '—'}</span>
              <button onClick={() => command(d, 'setCoolingSetpoint', Math.min(30, (sp ?? 24) + 0.5))} disabled={isBusy}
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
            {(s?.acOptionalModes ?? []).filter((m) => m !== 'off').length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-slate-500 w-8">옵션</span>
                {(s?.acOptionalModes ?? []).filter((m) => m !== 'off').map((m) => (
                  <button key={m}
                    onClick={() => command(d, 'setAcOptionalMode', s?.acOptionalMode === m ? 'off' : m)}
                    disabled={isBusy}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-medium border ${s?.acOptionalMode === m ? 'bg-violet-500 border-violet-500 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'} disabled:opacity-40`}>
                    {optLabel(m)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {(d.caps.includes('tv') || d.caps.includes('media')) && isOn && (
          <div className="mt-2.5 flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-slate-500 w-8">TV</span>
            {d.caps.includes('tv') && (
              <>
                <button onClick={() => command(d, 'channelUp')} disabled={isBusy}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-40">채널 ▲</button>
                <button onClick={() => command(d, 'channelDown')} disabled={isBusy}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-40">채널 ▼</button>
              </>
            )}
            {d.caps.includes('media') && (
              <button onClick={() => command(d, s?.playback === 'playing' ? 'pause' : 'play')} disabled={isBusy}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-40">
                {s?.playback === 'playing' ? '⏸ 일시정지' : '▶ 재생'}
              </button>
            )}
          </div>
        )}
        {d.caps.includes('volume') && isOn && (
          <div className="mt-2.5 flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-slate-500 w-8">볼륨</span>
            <button onClick={() => command(d, 'setVolume', Math.max(0, (s?.volume ?? 10) - 5))} disabled={isBusy}
              className="w-9 h-9 rounded-xl border border-slate-300 bg-white text-lg font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40">−</button>
            <span className="w-10 text-center font-bold text-base">{s?.mute ? '🔇' : s?.volume ?? '—'}</span>
            <button onClick={() => command(d, 'setVolume', Math.min(100, (s?.volume ?? 10) + 5))} disabled={isBusy}
              className="w-9 h-9 rounded-xl border border-slate-300 bg-white text-lg font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40">+</button>
            <button onClick={() => command(d, s?.mute ? 'unmute' : 'mute')} disabled={isBusy}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium border disabled:opacity-40 ${s?.mute ? 'bg-slate-600 border-slate-600 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
              {s?.mute ? '🔊 음소거 해제' : '🔇 음소거'}
            </button>
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

  /** 기기 상세 화면 — 스마트싱스 앱처럼 전체 화면 오버레이 */
  const renderDetail = () => {
    const d = state.devices.find((x) => x.deviceId === detailId)
    if (!d) return null
    const s = statuses[d.deviceId]
    const isOn = s?.switch === 'on'
    const isBusy = busy === d.deviceId
    const isAc = d.caps.includes('ac')
    const sp = s?.coolingSetpoint
    const canSwitch = d.caps.includes('switch') || d.caps.includes('ac')
    const events = (log?.events ?? []).filter((e) => e.d === d.deviceId).slice(0, 30)
    const days7 = Array.from({ length: 7 }, (_, i) => {
      const date = kstDate(6 - i)
      return { date, min: log?.days[date]?.[d.deviceId] ?? 0 }
    })
    const maxMin = Math.max(60, ...days7.map((x) => x.min))
    return (
      <div className="fixed inset-0 z-50 bg-slate-50 overflow-y-auto">
        <div className="max-w-lg mx-auto p-4 pb-16" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 1rem)' }}>
          <div className="flex items-center gap-3 mb-4">
            <button onClick={() => setDetailId('')} aria-label="뒤로"
              className="w-10 h-10 rounded-full bg-white border border-slate-200 text-lg text-slate-600 hover:bg-slate-100 shrink-0">←</button>
            <div className="min-w-0">
              <div className="font-bold text-lg truncate">{d.alias || d.name}</div>
              <div className="text-xs text-slate-400 truncate">
                {[...new Set([d.zone, d.room, PROVIDER_LABEL[d.provider] ?? d.provider, d.model].filter(Boolean))].join(' · ')}
              </div>
            </div>
            <button onClick={() => { startEdit(d); setDetailId('') }} title="별칭·공간 수정"
              className="ml-auto text-slate-400 hover:text-indigo-600 text-sm shrink-0">✏️ 편집</button>
          </div>

          <div className={`rounded-3xl p-6 mb-4 transition-colors ${isOn ? 'bg-sky-500 text-white' : 'bg-white border border-slate-200'}`}>
            <div className="flex items-center justify-between">
              <div>
                <div className={`text-sm ${isOn ? 'text-sky-100' : 'text-slate-400'}`}>
                  {isOn ? '켜짐' : s?.switch === 'off' ? '꺼짐' : '상태 확인 중'}
                </div>
                {isAc && (
                  <div className="text-3xl font-bold mt-1">
                    {sp !== undefined ? `${sp}°` : s?.temperature !== undefined ? `${s.temperature.toFixed(1)}°` : '—'}
                    {isOn && s?.acMode && <span className="text-base font-medium ml-2">{modeLabel(s.acMode)}</span>}
                  </div>
                )}
                {!isAc && s?.temperature !== undefined && (
                  <div className="text-3xl font-bold mt-1">{s.temperature.toFixed(1)}°</div>
                )}
              </div>
              {canSwitch && (
                <button
                  onClick={() => command(d, isOn ? 'off' : 'on')}
                  disabled={isBusy}
                  aria-label={isOn ? '끄기' : '켜기'}
                  className={`w-16 h-16 rounded-full text-2xl font-bold border-2 transition-colors ${isOn ? 'bg-white/20 border-white text-white' : 'bg-slate-50 border-slate-300 text-slate-500 hover:bg-slate-100'} ${isBusy ? 'opacity-50' : ''}`}
                >⏻</button>
              )}
            </div>
            <div className={`flex flex-wrap gap-2 mt-3 text-xs ${isOn ? 'text-sky-50' : 'text-slate-500'}`}>
              {s?.temperature !== undefined && <span>실내 {s.temperature.toFixed(1)}°C</span>}
              {s?.humidity !== undefined && <span>습도 {Math.round(s.humidity)}%</span>}
              {isOn && s?.power !== undefined && s.power > 0 && <span>⚡ {Math.round(s.power)}W</span>}
              {s?.energy !== undefined && s.energy > 0 && <span>🔋 {s.energy.toFixed(1)}kWh</span>}
              {s && !s.online && <span>오프라인</span>}
            </div>
          </div>

          {isAc && isOn && (
            <Card className="mb-4 space-y-3">
              <div className="flex items-center justify-center gap-4">
                <button onClick={() => command(d, 'setCoolingSetpoint', Math.max(16, (sp ?? 24) - 0.5))} disabled={isBusy}
                  className="w-12 h-12 rounded-2xl border border-slate-300 bg-white text-xl font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40">−</button>
                <div className="text-center w-24">
                  <div className="text-3xl font-bold">{sp !== undefined ? `${sp}°` : '—'}</div>
                  <div className="text-[11px] text-slate-400">희망 온도</div>
                </div>
                <button onClick={() => command(d, 'setCoolingSetpoint', Math.min(30, (sp ?? 24) + 0.5))} disabled={isBusy}
                  className="w-12 h-12 rounded-2xl border border-slate-300 bg-white text-xl font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40">+</button>
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-center">
                {AC_MODES.map((m) => (
                  <button key={m.value} onClick={() => command(d, 'setAcMode', m.value)} disabled={isBusy}
                    className={`rounded-lg px-3 py-2 text-xs font-medium border ${s?.acMode === m.value ? 'bg-sky-500 border-sky-500 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'} disabled:opacity-40`}>
                    {m.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-center">
                {FAN_MODES.map((m) => (
                  <button key={m.value} onClick={() => command(d, 'setFanMode', m.value)} disabled={isBusy}
                    className={`rounded-lg px-3 py-2 text-xs font-medium border ${s?.fanMode === m.value ? 'bg-sky-500 border-sky-500 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'} disabled:opacity-40`}>
                    팬 {m.label}
                  </button>
                ))}
              </div>
              {(s?.acOptionalModes ?? []).filter((m) => m !== 'off').length > 0 && (
                <div className="flex items-center gap-2 flex-wrap justify-center">
                  {(s?.acOptionalModes ?? []).filter((m) => m !== 'off').map((m) => (
                    <button key={m}
                      onClick={() => command(d, 'setAcOptionalMode', s?.acOptionalMode === m ? 'off' : m)}
                      disabled={isBusy}
                      className={`rounded-lg px-3 py-2 text-xs font-medium border ${s?.acOptionalMode === m ? 'bg-violet-500 border-violet-500 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'} disabled:opacity-40`}>
                      {optLabel(m)}
                    </button>
                  ))}
                </div>
              )}
            </Card>
          )}

          {(d.caps.includes('volume') || d.caps.includes('tv') || d.caps.includes('media')) && isOn && (
            <Card className="mb-4 space-y-3">
              {d.caps.includes('volume') && (
                <div className="flex items-center justify-center gap-4">
                  <button onClick={() => command(d, 'setVolume', Math.max(0, (s?.volume ?? 10) - 5))} disabled={isBusy}
                    className="w-12 h-12 rounded-2xl border border-slate-300 bg-white text-xl font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40">−</button>
                  <div className="text-center w-24">
                    <div className="text-3xl font-bold">{s?.mute ? '🔇' : s?.volume ?? '—'}</div>
                    <div className="text-[11px] text-slate-400">볼륨</div>
                  </div>
                  <button onClick={() => command(d, 'setVolume', Math.min(100, (s?.volume ?? 10) + 5))} disabled={isBusy}
                    className="w-12 h-12 rounded-2xl border border-slate-300 bg-white text-xl font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40">+</button>
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap justify-center">
                {d.caps.includes('volume') && (
                  <button onClick={() => command(d, s?.mute ? 'unmute' : 'mute')} disabled={isBusy}
                    className={`rounded-lg px-3 py-2 text-xs font-medium border disabled:opacity-40 ${s?.mute ? 'bg-slate-600 border-slate-600 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
                    {s?.mute ? '🔊 음소거 해제' : '🔇 음소거'}
                  </button>
                )}
                {d.caps.includes('tv') && (
                  <>
                    <button onClick={() => command(d, 'channelUp')} disabled={isBusy}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium hover:bg-slate-50 disabled:opacity-40">채널 ▲</button>
                    <button onClick={() => command(d, 'channelDown')} disabled={isBusy}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium hover:bg-slate-50 disabled:opacity-40">채널 ▼</button>
                  </>
                )}
                {d.caps.includes('media') && (
                  <button onClick={() => command(d, s?.playback === 'playing' ? 'pause' : 'play')} disabled={isBusy}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium hover:bg-slate-50 disabled:opacity-40">
                    {s?.playback === 'playing' ? '⏸ 일시정지' : '▶ 재생'}
                  </button>
                )}
              </div>
            </Card>
          )}

          <Card>
            <div className="font-semibold text-sm mb-3">📊 최근 7일 가동시간</div>
            <div className="flex items-end gap-2 h-24 mb-1">
              {days7.map((x) => (
                <div key={x.date} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full rounded-t bg-sky-400/80" style={{ height: `${Math.max(2, (x.min / maxMin) * 88)}px` }}
                    title={fmtMin(x.min)} />
                  <div className="text-[10px] text-slate-400">{x.date.slice(8)}일</div>
                </div>
              ))}
            </div>
            <div className="text-xs text-slate-500 mb-3">
              오늘 {fmtMin(days7[6].min)} · 7일 합계 {fmtMin(days7.reduce((a, x) => a + x.min, 0))}
            </div>
            {events.length > 0 ? (
              <div className="border-t border-slate-100 pt-2 space-y-1 max-h-56 overflow-y-auto">
                {events.map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px] text-slate-500">
                    <span className="font-mono text-slate-400">{fmtEventTime(e.ts)}</span>
                    <span className={e.ev === 'on' ? 'text-emerald-600' : e.ev === 'off' ? 'text-slate-400' : ''}>{eventLabel(e.ev)}</span>
                    <span className="rounded bg-slate-100 px-1 text-[10px]">{BY_LABEL[e.by]}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-slate-400">아직 이벤트가 없어요. 켬/끔이 생기면 15분 주기로 여기에 쌓입니다.</p>
            )}
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div>
      {detailId && renderDetail()}
      <div className="flex items-start justify-between gap-3">
        <PageTitle
          title={mode === 'home' ? '우리집 스마트홈' : '스마트룸'}
          desc={mode === 'home'
            ? '기기 켜고 끄기 + 원탭 씬 + 시간 예약'
            : '객실 온도 모니터링 + 조명·에어컨 제어 + 예약 연동 자동화'}
        />
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
          <div className="rounded-xl border border-slate-200 p-3.5">
            <div className="text-sm font-semibold mb-1.5">
              헤이홈 (고퀄){' '}
              {state.config.hejhome?.oauth
                ? <span className="text-emerald-600 text-xs">● 연동됨 (자동 갱신)</span>
                : state.config.hejhome
                  ? <span className="text-amber-600 text-xs">● 연동됨 (수동 토큰)</span>
                  : null}
            </div>
            <p className="text-xs text-slate-400 mb-2">
              헤이홈 오픈API 문서(
              <a href="https://goqual.notion.site/API-078d8c3c22f24b23bda799e38f2c819d" target="_blank" rel="noreferrer" className="underline">goqual.notion.site</a>
              )에서 사용 신청하면 Client ID·Client Secret·App Key를 메일로 보내줍니다.
              받은 3가지와 헤이홈 앱 로그인 계정을 입력하세요. 비밀번호는 토큰 발급에만 쓰고 저장하지 않습니다.
            </p>
            <div className="space-y-2">
              <input value={hejClientId} onChange={(e) => setHejClientId(e.target.value)} placeholder="Client ID"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono" />
              <input type="password" value={hejClientSecret} onChange={(e) => setHejClientSecret(e.target.value)} placeholder="Client Secret"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono" />
              <input type="password" value={hejAppKey} onChange={(e) => setHejAppKey(e.target.value)} placeholder="App Key"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono" />
              <div className="flex gap-2">
                <input value={hejEmail} onChange={(e) => setHejEmail(e.target.value)} placeholder="헤이홈 계정 (이메일/휴대폰)"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                <input type="password" value={hejPw} onChange={(e) => setHejPw(e.target.value)} placeholder="비밀번호"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <button onClick={hejConnect} disabled={busy === 'hej' || !hejClientId.trim() || !hejClientSecret.trim() || !hejAppKey.trim() || !hejEmail.trim() || !hejPw}
                className="w-full rounded-lg bg-amber-500 text-white px-4 py-2.5 text-sm font-semibold hover:bg-amber-600 disabled:opacity-50">
                {busy === 'hej' ? '연동 중…' : '🔗 헤이홈 계정으로 연동 (자동 갱신)'}
              </button>
            </div>
            <details className="text-xs text-slate-400 mt-2">
              <summary className="cursor-pointer">또는 액세스 토큰 직접 입력</summary>
              <input
                type="password"
                value={hejToken}
                onChange={(e) => setHejToken(e.target.value)}
                placeholder="헤이홈 액세스 토큰"
                className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
              />
            </details>
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
          <div className="font-semibold mb-1">발견된 기기 → {mode === 'home' ? '공간에 배정' : '숙소에 배정'}</div>
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
                      {PROVIDER_LABEL[d.provider] ?? d.provider}
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
                    <option value="@home">🏠 우리집{mode === 'home' ? '' : ' (숙소 아님)'}</option>
                    {mode !== 'home' && listings.filter((l) => l.active).map((l) => (
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

      {state.devices.length > 0 && (
        <Card className="mb-4">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
            <div className="font-semibold">🎬 원탭 씬 & 시간 예약</div>
            <button
              onClick={() => (sceneEdit ? finishSceneEdit() : setSceneEdit(true))}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50"
            >
              {sceneEdit ? '완료 (저장)' : '✏️ 씬 편집'}
            </button>
          </div>
          <div className="flex gap-2 flex-wrap">
            {(state.scenes ?? []).map((sc) => (
              <button key={sc.id} onClick={() => runScene(sc)} disabled={busy !== ''}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium shadow-sm hover:bg-slate-50 disabled:opacity-40">
                {busy === `scene:${sc.id}` ? '⏳ 실행 중…' : `${sc.emoji} ${sc.name}`}
              </button>
            ))}
            {(state.scenes ?? []).length === 0 && !sceneEdit && (
              <p className="text-xs text-slate-400">
                "✏️ 씬 편집"에서 외출·귀가·취침 같은 씬을 만들면 버튼 하나로 여러 기기를 한 번에 켜고 끌 수 있어요.
              </p>
            )}
          </div>
          {sceneMsg && (
            <p className={`text-xs mt-2 ${sceneMsg.startsWith('✓') ? 'text-emerald-600' : 'text-amber-600'}`}>{sceneMsg}</p>
          )}
          {sceneEdit && (
            <div className="space-y-3 mt-3">
              {(state.scenes ?? []).map((sc) => (
                <div key={sc.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <input value={sc.emoji} maxLength={4}
                      onChange={(e) => patchScenes((prev) => prev.map((x) => x.id === sc.id ? { ...x, emoji: e.target.value } : x))}
                      className="w-12 rounded border border-slate-300 px-2 py-1 text-sm text-center" />
                    <input value={sc.name} placeholder="씬 이름 (예: 외출)"
                      onChange={(e) => patchScenes((prev) => prev.map((x) => x.id === sc.id ? { ...x, name: e.target.value } : x))}
                      className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm" />
                    <button onClick={() => patchScenes((prev) => prev.filter((x) => x.id !== sc.id), true)}
                      className="text-xs text-rose-500 shrink-0">삭제</button>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-1.5">
                    {(mode === 'home' ? state.devices.filter((d) => d.listingId === '@home') : state.devices).map((d) => {
                      const act = sc.actions.find((a) => a.deviceId === d.deviceId)
                      return (
                        <div key={d.deviceId} className="flex items-center justify-between gap-2 text-xs">
                          <span className="truncate text-slate-600">{d.alias || d.name}</span>
                          <select value={act?.command ?? ''}
                            onChange={(e) => patchScenes((prev) => prev.map((x) => {
                              if (x.id !== sc.id) return x
                              const actions = x.actions.filter((a) => a.deviceId !== d.deviceId)
                              if (e.target.value === 'on' || e.target.value === 'off') {
                                actions.push({ provider: d.provider, deviceId: d.deviceId, command: e.target.value })
                              }
                              return { ...x, actions }
                            }))}
                            className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs shrink-0">
                            <option value="">동작 없음</option>
                            <option value="on">켜기</option>
                            <option value="off">끄기</option>
                          </select>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
              <button
                onClick={() => patchScenes((prev) => [...prev, { id: `sc_${Date.now().toString(36)}`, name: '', emoji: '🌙', actions: [] }])}
                className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500 hover:bg-slate-50">
                ＋ 새 씬 만들기
              </button>
            </div>
          )}

          <div className="mt-4 border-t border-slate-100 pt-3">
            <div className="text-xs font-semibold text-slate-500 mb-2">
              ⏰ 시간 예약 — 정해진 시각에 씬 자동 실행 (15분 주기 확인이라 최대 15분 늦을 수 있어요)
            </div>
            <div className="space-y-2">
              {(state.schedules ?? []).map((s) => (
                <div key={s.id} className="flex items-center gap-2 flex-wrap text-xs">
                  <input type="checkbox" checked={s.enabled} title="사용"
                    onChange={(e) => patchSchedules((prev) => prev.map((x) => x.id === s.id ? { ...x, enabled: e.target.checked } : x))}
                    className="accent-indigo-600" />
                  <input type="time" value={s.time}
                    onChange={(e) => patchSchedules((prev) => prev.map((x) => x.id === s.id ? { ...x, time: e.target.value } : x))}
                    className="rounded border border-slate-300 px-1.5 py-1" />
                  <select value={s.sceneId}
                    onChange={(e) => patchSchedules((prev) => prev.map((x) => x.id === s.id ? { ...x, sceneId: e.target.value } : x))}
                    className="rounded border border-slate-300 bg-white px-1.5 py-1">
                    <option value="">씬 선택</option>
                    {(state.scenes ?? []).map((sc) => <option key={sc.id} value={sc.id}>{sc.emoji} {sc.name}</option>)}
                  </select>
                  <div className="flex gap-0.5">
                    {['일', '월', '화', '수', '목', '금', '토'].map((label, i) => (
                      <button key={i}
                        onClick={() => patchSchedules((prev) => prev.map((x) => x.id === s.id
                          ? { ...x, days: x.days.includes(i) ? x.days.filter((d) => d !== i) : [...x.days, i].sort() }
                          : x))}
                        className={`w-6 h-6 rounded text-[10px] font-medium ${s.days.includes(i) ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => patchSchedules((prev) => prev.filter((x) => x.id !== s.id))}
                    className="text-rose-500">삭제</button>
                </div>
              ))}
            </div>
            <button
              onClick={() => patchSchedules((prev) => [...prev, {
                id: `sd_${Date.now().toString(36)}`, time: '22:00', days: [0, 1, 2, 3, 4, 5, 6],
                sceneId: (state.scenes ?? [])[0]?.id ?? '', enabled: true,
              }])}
              className="mt-2 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50">
              ＋ 예약 추가
            </button>
          </div>
        </Card>
      )}

      {[
        // 집 모드에서는 숙소 카드를 감추고 우리집만 표시
        ...(mode === 'home' ? [] : listings.filter((l) => l.active).map((l) => ({ id: l.id, name: l.name, thumbnail: l.thumbnail, isHome: false }))),
        { id: '@home', name: '우리집', thumbnail: '🏠', isHome: true },
      ].map((l) => {
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
              {[...new Set([
                ...devices.map((d) => d.zone?.trim() || ''),
                ...extraZones.filter((x) => x.spaceId === l.id).map((x) => x.name),
              ])]
                .sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'ko')))
                .map((zone) => {
                  const zoneDevices = devices.filter((d) => (d.zone?.trim() || '') === zone)
                  const showHeader = zone !== '' || zoneDevices.length !== devices.length
                  const dropKey = `${l.id}|${zone}`
                  return (
                    <div
                      key={zone || '_none'}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropTarget(dropKey) }}
                      onDragLeave={() => setDropTarget((p) => (p === dropKey ? '' : p))}
                      onDrop={(e) => {
                        e.preventDefault()
                        setDropTarget('')
                        const id = e.dataTransfer.getData('text/plain')
                        if (id) moveDevice(id, l.id, zone)
                      }}
                      className={`rounded-xl transition-all ${dropTarget === dropKey ? 'ring-2 ring-indigo-400 bg-indigo-50/50 p-1 -m-1' : ''}`}
                    >
                      {showHeader && (
                        <div className="text-xs font-semibold text-slate-500 mb-1.5">
                          {zone ? `🚪 ${zone}` : '공간 미지정'}
                          <span className="font-normal text-slate-400 ml-1">({zoneDevices.length})</span>
                        </div>
                      )}
                      {zoneDevices.length > 0 ? (
                        <div className="grid md:grid-cols-2 gap-2">{zoneDevices.map(renderDevice)}</div>
                      ) : (
                        <div className="rounded-xl border border-dashed border-slate-300 px-3 py-4 text-center text-[11px] text-slate-400">
                          기기를 여기로 드래그하세요
                        </div>
                      )}
                    </div>
                  )
                })}
            </div>
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <button
                onClick={() => {
                  const name = window.prompt('새 공간 이름 (예: 주방, 2층, 테라스)')?.trim()
                  if (name) setExtraZones((p) => [...p, { spaceId: l.id, name }])
                }}
                className="rounded-lg border border-dashed border-slate-300 px-2.5 py-1 text-[11px] text-slate-500 hover:bg-slate-50"
              >
                ＋ 새 공간
              </button>
              <p className="text-[11px] text-slate-400">
                기기 카드를 드래그해서 공간으로 옮기거나, ✏️로 별칭·공간을 직접 지정할 수 있어요.
              </p>
            </div>

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

            {!l.isHome && (
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
            )}
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
