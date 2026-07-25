import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../lib/store'
import { Card, PageTitle } from '../components/ui'
import type { SmartHomeState, SmartDevice, SmartDeviceStatus } from '../lib/api'

const EMPTY: SmartHomeState = { config: {}, devices: [], rules: {} }

export default function SmartRoom() {
  const { listings, cloud } = useStore()
  const [state, setState] = useState<SmartHomeState>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [available, setAvailable] = useState<SmartDevice[]>([])
  const [statuses, setStatuses] = useState<Record<string, SmartDeviceStatus>>({})
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')
  const [stToken, setStToken] = useState('')
  const [tuyaId, setTuyaId] = useState('')
  const [tuyaKey, setTuyaKey] = useState('')
  const [tuyaRegion, setTuyaRegion] = useState<'us' | 'eu' | 'cn' | 'in'>('us')
  const [editId, setEditId] = useState('')
  const [editAlias, setEditAlias] = useState('')
  const [editZone, setEditZone] = useState('')

  const refreshStatus = useCallback(() => {
    if (!cloud) return
    cloud.smart.status().then((r) => {
      const map: Record<string, SmartDeviceStatus> = {}
      r.statuses.forEach((s) => { map[s.deviceId] = s })
      setStatuses(map)
    }).catch(() => {})
  }, [cloud])

  useEffect(() => {
    if (!cloud) return
    cloud.smart.get().then((s) => {
      setState({ ...EMPTY, ...s })
      setAvailable(s.available ?? [])
      setLoaded(true)
      if (s.devices?.length) refreshStatus()
    }).catch(() => setLoaded(true))
  }, [cloud, refreshStatus])

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
      if (stToken.trim()) config.smartthings = { token: stToken.trim() }
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

  const command = async (d: SmartDevice, cmd: 'on' | 'off') => {
    setBusy(d.deviceId)
    try {
      await cloud.smart.command({ provider: d.provider, deviceId: d.deviceId, command: cmd })
      setTimeout(refreshStatus, 1200)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  const connected = !!(state.config.smartthings || state.config.tuya)

  const ZONE_DEFAULTS = ['거실', '안방', '작은방', '주방', '테라스', '1층', '2층']
  const zoneSuggest = [
    ...new Set([...state.devices.map((d) => d.zone?.trim()).filter((z): z is string => !!z), ...ZONE_DEFAULTS]),
  ]

  const renderDevice = (d: SmartDevice) => {
    const s = statuses[d.deviceId]
    if (editId === d.deviceId) {
      return (
        <div key={d.deviceId} className="rounded-xl border border-indigo-200 bg-indigo-50/50 px-3 py-2.5 text-sm space-y-1.5">
          <div className="text-[11px] text-slate-400 truncate">
            {d.name}{d.room ? ` · 📍${d.room}` : ''}{d.model ? ` · ${d.model}` : ''}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <input value={editAlias} onChange={(e) => setEditAlias(e.target.value)} placeholder="별칭 (예: 거실 에어컨)"
              className="flex-1 min-w-32 rounded-lg border border-slate-300 px-2 py-1 text-xs" />
            <input value={editZone} onChange={(e) => setEditZone(e.target.value)} list="zone-suggest" placeholder="공간/층 (예: 거실, 2층)"
              className="flex-1 min-w-28 rounded-lg border border-slate-300 px-2 py-1 text-xs" />
            <button onClick={saveEdit}
              className="rounded-lg bg-indigo-600 text-white px-2.5 py-1 text-xs font-medium hover:bg-indigo-700">저장</button>
            <button onClick={() => setEditId('')}
              className="rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">취소</button>
          </div>
        </div>
      )
    }
    return (
      <div key={d.deviceId} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2.5 text-sm">
        <div className="min-w-0 truncate">
          <span className="font-medium" title={d.name}>{d.alias || d.name}</span>
          <button onClick={() => startEdit(d)} title="별칭·공간 수정"
            className="ml-1 text-slate-300 hover:text-indigo-600 text-xs align-middle">✏️</button>
          <span className="text-xs text-slate-400 ml-1.5">
            {s ? (s.online ? (s.switch === 'on' ? '켜짐' : s.switch === 'off' ? '꺼짐' : '') : '오프라인') : ''}
            {s?.coolingSetpoint ? ` · 설정 ${s.coolingSetpoint}°` : ''}
          </span>
        </div>
        {(d.caps.includes('switch') || d.caps.includes('ac')) && (
          <div className="flex gap-1.5 shrink-0">
            <button onClick={() => command(d, 'on')} disabled={busy === d.deviceId}
              className="rounded-lg bg-emerald-500 text-white px-3 py-1 text-xs font-medium hover:bg-emerald-600 disabled:opacity-50">ON</button>
            <button onClick={() => command(d, 'off')} disabled={busy === d.deviceId}
              className="rounded-lg bg-slate-300 text-slate-700 px-3 py-1 text-xs font-medium hover:bg-slate-400 disabled:opacity-50">OFF</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <PageTitle title="스마트룸" desc="객실 온도 모니터링 + 조명·에어컨 제어 + 예약 연동 자동화" />
      <datalist id="zone-suggest">
        {zoneSuggest.map((z) => <option key={z} value={z} />)}
      </datalist>

      <Card className="mb-4">
        <div className="font-semibold mb-3">🔌 계정 연동</div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-200 p-3.5">
            <div className="text-sm font-semibold mb-1.5">
              삼성 스마트싱스 {state.config.smartthings && <span className="text-emerald-600 text-xs">● 연동됨</span>}
            </div>
            <p className="text-xs text-slate-400 mb-2">
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
        <div className="flex items-center gap-3 mt-3">
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

      {listings.filter((l) => l.active).map((l) => {
        const devices = state.devices.filter((d) => d.listingId === l.id)
        if (devices.length === 0) return null
        const rule = state.rules[l.id] ?? {}
        const temps = devices.map((d) => statuses[d.deviceId]?.temperature).filter((t): t is number => t !== undefined)
        const hums = devices.map((d) => statuses[d.deviceId]?.humidity).filter((t): t is number => t !== undefined)
        return (
          <Card key={l.id} className="mb-4">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <div className="font-semibold">{l.thumbnail} {l.name}</div>
              <div className="flex gap-3 text-sm">
                {temps.length > 0 && <span>🌡 <b>{temps[0].toFixed(1)}°C</b></span>}
                {hums.length > 0 && <span>💧 <b>{Math.round(hums[0])}%</b></span>}
                <button onClick={refreshStatus} className="text-xs text-slate-400 underline">새로고침</button>
              </div>
            </div>
            <div className="space-y-3 mb-4">
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
            <p className="text-[11px] text-slate-400 -mt-2 mb-3">
              ✏️를 눌러 기기 별칭과 공간(거실·안방·2층 등)을 지정하면 공간별로 묶어서 보여드려요.
            </p>
            <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-3.5 text-sm space-y-2">
              <div className="font-semibold text-indigo-900 text-xs">⚡ 예약 연동 자동화 (15분 주기로 자동 실행)</div>
              <label className="flex items-center gap-2 cursor-pointer">
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
                체크아웃 후(11:30) 기기 자동 전원 차단 — 당일 새 체크인이 있으면 건너뜀
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
