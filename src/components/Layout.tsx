import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useStore } from '../lib/store'
import type { CoPerms } from '../lib/api'

/** 집 모드에서 보여줄 메뉴 (스마트홈 관련만) */
const HOME_PATHS = new Set(['/smartroom', '/door'])

type NavPerm = 'view' | keyof CoPerms | 'owner'

const NAV: { to: string; label: string; icon: string; perm: NavPerm }[] = [
  { to: '/', label: '대시보드', icon: '📊', perm: 'view' },
  { to: '/calendar', label: '가격 캘린더', icon: '📅', perm: 'view' },
  { to: '/guests', label: '게스트 관리', icon: '👥', perm: 'view' },
  { to: '/listings', label: '숙소 관리', icon: '🏠', perm: 'pricing' },
  { to: '/rules', label: '가격 규칙', icon: '⚙️', perm: 'pricing' },
  { to: '/market', label: '시장 분석', icon: '📈', perm: 'pricing' },
  { to: '/channels', label: '채널 연동', icon: '🔗', perm: 'channels' },
  { to: '/door', label: '스마트도어', icon: '🚪', perm: 'smart' },
  { to: '/guestform', label: '게스트 설문', icon: '📋', perm: 'guest' },
  { to: '/site', label: '미니홈', icon: '🌐', perm: 'guest' },
  { to: '/smartroom', label: '스마트룸', icon: '🌡️', perm: 'smart' },
  { to: '/team', label: '관리자', icon: '👑', perm: 'owner' },
]

export default function Layout() {
  const { cloud, mode, setMode } = useStore()
  const location = useLocation()

  const allowed = (perm: NavPerm): boolean => {
    if (!cloud) return perm !== 'owner' // 데모 모드: 관리자 메뉴만 숨김
    if (cloud.perms === 'owner') return true
    if (perm === 'owner') return false
    if (perm === 'view') return true
    return !!cloud.perms[perm]
  }
  const nav = NAV.filter((item) => allowed(item.perm) && (mode !== 'home' || HOME_PATHS.has(item.to)))

  // 첫 접속: 용도 선택 화면
  if (mode === null) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 px-6 bg-slate-50">
        <div className="text-center">
          <div className="text-2xl font-bold text-rose-500 mb-1">스테이프라이스</div>
          <p className="text-sm text-slate-500">어떤 용도로 사용하시나요? 언제든 왼쪽 메뉴에서 전환할 수 있어요.</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4 w-full max-w-lg">
          <button onClick={() => setMode('host')}
            className="rounded-2xl border-2 border-rose-200 bg-white p-6 text-left hover:border-rose-400 hover:shadow-md transition-all">
            <div className="text-3xl mb-2">🏨</div>
            <div className="font-bold mb-1">호스트 모드</div>
            <p className="text-xs text-slate-500 leading-relaxed">
              숙소 운영 전체 — 가격·예약 캘린더·수익·게스트 관리·채널 연동·스마트룸
            </p>
          </button>
          <button onClick={() => setMode('home')}
            className="rounded-2xl border-2 border-indigo-200 bg-white p-6 text-left hover:border-indigo-400 hover:shadow-md transition-all">
            <div className="text-3xl mb-2">🏠</div>
            <div className="font-bold mb-1">집 모드</div>
            <p className="text-xs text-slate-500 leading-relaxed">
              우리집 스마트홈만 간단하게 — 기기 켜고 끄기·원탭 씬·시간 예약
            </p>
          </button>
        </div>
      </div>
    )
  }

  // 집 모드에서 호스트 전용 화면에 있으면 스마트룸으로
  if (mode === 'home' && !HOME_PATHS.has(location.pathname)) {
    return <Navigate to="/smartroom" replace />
  }

  const modeSwitch = (
    <button
      onClick={() => setMode(mode === 'home' ? 'host' : 'home')}
      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
    >
      {mode === 'home' ? '🏨 호스트 모드로 전환' : '🏠 집 모드로 전환'}
    </button>
  )

  const wsSwitcher = cloud && cloud.workspaces.list.length > 0 && (
    <select
      value={cloud.workspaces.current ?? ''}
      onChange={(e) => cloud.workspaces.switch(e.target.value || null)}
      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-600"
    >
      <option value="">🏠 내 숙소</option>
      {cloud.workspaces.list.map((w) => (
        <option key={w.sub} value={w.sub}>🤝 {w.ownerEmail}님의 숙소</option>
      ))}
    </select>
  )

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* 데스크톱 사이드바 */}
      <aside className="hidden md:flex w-56 shrink-0 border-r border-slate-200 bg-white flex-col">
        <div className="px-5 py-5 border-b border-slate-100">
          <div className="text-xl font-bold text-rose-500">스테이프라이스</div>
          <div className="text-xs text-slate-400 mt-0.5">
            {mode === 'home' ? '🏠 우리집 스마트홈' : '숙소 수익 관리 · 자동 가격'}
          </div>
          {mode !== 'home' && wsSwitcher && <div className="mt-3">{wsSwitcher}</div>}
          <div className="mt-3">{modeSwitch}</div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-rose-50 text-rose-600'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`
              }
            >
              <span>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 text-[11px] text-slate-400 border-t border-slate-100">
          {cloud ? (
            <div className="flex items-center justify-between gap-2">
              <span className="truncate" title={cloud.email}>☁️ {cloud.email}</span>
              <button onClick={cloud.signOut} className="shrink-0 underline hover:text-rose-600">
                로그아웃
              </button>
            </div>
          ) : (
            'MVP 데모 · 데이터는 브라우저에 저장됩니다'
          )}
        </div>
      </aside>

      {/* 모바일 헤더 + 가로 스크롤 탭 */}
      <div className="md:hidden sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-1.5">
          <div className="text-lg font-bold text-rose-500 shrink-0">
            스테이프라이스{mode === 'home' && <span className="ml-1 text-xs font-medium text-indigo-500">집</span>}
          </div>
          <div className="flex items-center gap-2 min-w-0">
            {mode !== 'home' && wsSwitcher}
            <button
              onClick={() => setMode(mode === 'home' ? 'host' : 'home')}
              className="text-[11px] text-slate-500 underline shrink-0"
            >
              {mode === 'home' ? '호스트 모드' : '집 모드'}
            </button>
            {cloud && (
              <button onClick={cloud.signOut} className="text-[11px] text-slate-400 underline shrink-0">로그아웃</button>
            )}
          </div>
        </div>
        <nav className="flex gap-1.5 overflow-x-auto px-3 pb-2 [-webkit-overflow-scrolling:touch] [scrollbar-width:none]">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                  isActive
                    ? 'bg-rose-500 text-white'
                    : 'bg-slate-100 text-slate-600 active:bg-slate-200'
                }`
              }
            >
              <span>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <main className="flex-1 min-w-0 p-4 pb-10 md:p-6 lg:p-8">
        <Outlet />
      </main>
    </div>
  )
}
