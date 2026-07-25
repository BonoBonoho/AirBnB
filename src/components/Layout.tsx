import { NavLink, Outlet } from 'react-router-dom'
import { useStore } from '../lib/store'

const NAV = [
  { to: '/', label: '대시보드', icon: '📊' },
  { to: '/calendar', label: '가격 캘린더', icon: '📅' },
  { to: '/listings', label: '숙소 관리', icon: '🏠' },
  { to: '/rules', label: '가격 규칙', icon: '⚙️' },
  { to: '/market', label: '시장 분석', icon: '📈' },
  { to: '/channels', label: '채널 연동', icon: '🔗' },
  { to: '/door', label: '스마트도어', icon: '🚪' },
  { to: '/guestform', label: '게스트 설문', icon: '📋' },
  { to: '/site', label: '미니홈', icon: '🌐' },
  { to: '/smartroom', label: '스마트룸', icon: '🌡️' },
]

export default function Layout() {
  const { cloud } = useStore()
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* 데스크톱 사이드바 */}
      <aside className="hidden md:flex w-56 shrink-0 border-r border-slate-200 bg-white flex-col">
        <div className="px-5 py-5 border-b border-slate-100">
          <div className="text-xl font-bold text-rose-500">스테이프라이스</div>
          <div className="text-xs text-slate-400 mt-0.5">숙소 수익 관리 · 자동 가격</div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map((item) => (
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
        <div className="flex items-center justify-between px-4 pt-3 pb-1.5">
          <div className="text-lg font-bold text-rose-500">스테이프라이스</div>
          {cloud && (
            <button onClick={cloud.signOut} className="text-[11px] text-slate-400 underline">로그아웃</button>
          )}
        </div>
        <nav className="flex gap-1.5 overflow-x-auto px-3 pb-2 [-webkit-overflow-scrolling:touch] [scrollbar-width:none]">
          {NAV.map((item) => (
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
