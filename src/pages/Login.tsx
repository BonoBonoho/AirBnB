import { useState } from 'react'
import { signIn, signUp, confirmSignUp } from '../lib/auth'

type Mode = 'signin' | 'signup' | 'confirm'

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setError('')
    setBusy(true)
    try {
      if (mode === 'signin') {
        await signIn(email, password)
        onLogin()
      } else if (mode === 'signup') {
        await signUp(email, password)
        setMode('confirm')
      } else {
        await confirmSignUp(email, code)
        await signIn(email, password)
        onLogin()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8">
        <div className="text-2xl font-bold text-rose-500 text-center">스테이프라이스</div>
        <p className="text-xs text-slate-400 text-center mt-1 mb-6">숙소 수익 관리 · 자동 가격</p>

        {mode !== 'confirm' ? (
          <>
            <div className="flex rounded-lg bg-slate-100 p-1 mb-5 text-sm font-medium">
              {(['signin', 'signup'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setError('') }}
                  className={`flex-1 rounded-md py-1.5 transition-colors ${
                    mode === m ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'
                  }`}
                >
                  {m === 'signin' ? '로그인' : '회원가입'}
                </button>
              ))}
            </div>
            <label className="block text-sm font-medium mb-1">이메일</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm mb-3"
              placeholder="you@example.com"
            />
            <label className="block text-sm font-medium mb-1">비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm mb-1"
              placeholder="8자 이상, 숫자 포함"
            />
          </>
        ) : (
          <>
            <p className="text-sm text-slate-600 mb-3">
              <span className="font-medium">{email}</span> 로 발송된 인증 코드를 입력하세요.
            </p>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm mb-1 tracking-widest text-center"
              placeholder="123456"
            />
          </>
        )}

        {error && <p className="text-xs text-rose-600 mt-2">{error}</p>}

        <button
          onClick={submit}
          disabled={busy}
          className="w-full mt-4 rounded-lg bg-rose-500 text-white py-2.5 text-sm font-semibold hover:bg-rose-600 disabled:opacity-50"
        >
          {busy ? '처리 중…' : mode === 'signin' ? '로그인' : mode === 'signup' ? '가입하기' : '인증 완료'}
        </button>
      </div>
    </div>
  )
}
