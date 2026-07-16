import { NavLink, Outlet } from 'react-router-dom'

const NAV = [
  { to: '/', label: '대시보드', icon: '📊' },
  { to: '/calendar', label: '가격 캘린더', icon: '📅' },
  { to: '/listings', label: '숙소 관리', icon: '🏠' },
  { to: '/rules', label: '가격 규칙', icon: '⚙️' },
  { to: '/market', label: '시장 분석', icon: '📈' },
  { to: '/channels', label: '채널 연동', icon: '🔗' },
]

export default function Layout() {
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-slate-200 bg-white flex flex-col">
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
          MVP 데모 · 데이터는 브라우저에 저장됩니다
        </div>
      </aside>
      <main className="flex-1 min-w-0 p-6 lg:p-8">
        <Outlet />
      </main>
    </div>
  )
}
