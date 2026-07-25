import { NavLink, Outlet } from 'react-router-dom'
import { useStore } from '../lib/store'
import type { CoPerms } from '../lib/api'

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
  const { cloud } = useStore()

  const allowed = (perm: NavPerm): boolean => {
    if (!cloud) return perm !== 'owner' // 데모 모드: 관리자 메뉴만 숨김
    if (cloud.perms === 'owner') return true
    if (perm === 'owner') return false
    if (perm === 'view') return true
    return !!cloud.perms[perm]
  }
  const nav = NAV.filter((item) => allowed(item.perm))

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
          <div className="text-xs text-slate-400 mt-0.5">숙소 수익 관리 · 자동 가격</div>
          {wsSwitcher && <div className="mt-3">{wsSwitcher}</div>}
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
          <div className="text-lg font-bold text-rose-500 shrink-0">스테이프라이스</div>
          <div className="flex items-center gap-2 min-w-0">
            {wsSwitcher}
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
