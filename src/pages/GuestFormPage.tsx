import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { loadConfig } from '../lib/config'
import { publicApi } from '../lib/api'
import type { PublicFormData } from '../lib/api'
import type { FormQuestion } from '../types'
import { DEFAULT_FORM_QUESTIONS } from '../data/formTemplate'

type Phase = 'loading' | 'ready' | 'submitting' | 'done' | 'already' | 'error'

export default function GuestFormPage() {
  const { token } = useParams()
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState('')
  const [data, setData] = useState<PublicFormData | null>(null)
  const [apiUrl, setApiUrl] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [guestName, setGuestName] = useState('')
  const [missing, setMissing] = useState<string[]>([])

  const isPreview = token === 'preview'

  useEffect(() => {
    if (isPreview) {
      setData({
        questions: null,
        meta: { guestName: '게스트', listingName: '미리보기 숙소', checkIn: '2026-01-01', nights: 1 },
        submitted: false,
      })
      setPhase('ready')
      return
    }
    loadConfig().then((cfg) => {
      if (!cfg || !token) {
        setError('설정을 불러올 수 없습니다')
        setPhase('error')
        return
      }
      setApiUrl(cfg.apiUrl)
      publicApi
        .getForm(cfg.apiUrl, token)
        .then((d) => {
          setData(d)
          setGuestName(d.meta.guestName)
          setPhase(d.submitted ? 'already' : 'ready')
        })
        .catch((e) => {
          setError(e instanceof Error ? e.message : String(e))
          setPhase('error')
        })
    })
  }, [token, isPreview])

  const questions: FormQuestion[] = useMemo(
    () => (data?.questions && data.questions.length > 0 ? data.questions : DEFAULT_FORM_QUESTIONS),
    [data],
  )

  const setAnswer = (id: string, value: string) => setAnswers((prev) => ({ ...prev, [id]: value }))

  const toggleMulti = (id: string, option: string) => {
    const cur = answers[id] ? answers[id].split(', ') : []
    const next = cur.includes(option) ? cur.filter((o) => o !== option) : [...cur, option]
    setAnswer(id, next.join(', '))
  }

  const submit = async () => {
    const miss = questions.filter((q) => q.required && !answers[q.id]?.trim()).map((q) => q.id)
    setMissing(miss)
    if (miss.length > 0) {
      document.getElementById(`q-${miss[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    if (isPreview) {
      setPhase('done')
      return
    }
    setPhase('submitting')
    try {
      await publicApi.submitForm(apiUrl, token as string, guestName, answers)
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('ready')
    }
  }

  if (phase === 'loading') {
    return <Shell><p className="text-slate-400 py-10">불러오는 중…</p></Shell>
  }
  if (phase === 'error') {
    return (
      <Shell>
        <div className="text-5xl mb-4">🔒</div>
        <p className="font-semibold">{error}</p>
        <p className="text-sm text-slate-500 mt-1">호스트에게 새 링크를 요청해 주세요.</p>
      </Shell>
    )
  }
  if (phase === 'already' || phase === 'done') {
    return (
      <Shell>
        <div className="text-5xl mb-4">🎉</div>
        <p className="font-semibold text-lg">{phase === 'done' ? '제출 완료!' : '이미 제출하셨습니다'}</p>
        <p className="text-sm text-slate-500 mt-2">
          답변해 주셔서 감사합니다. 말씀해주신 내용을 바탕으로 정성껏 준비하겠습니다 🤗
        </p>
      </Shell>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="mx-auto max-w-xl">
        <div className="rounded-3xl border border-slate-200 bg-white p-7 mb-4">
          <div className="text-xs text-slate-400 mb-1">{data?.meta.listingName}</div>
          <h1 className="text-xl font-bold">환영합니다 🤗</h1>
          <p className="text-sm text-slate-500 mt-1.5">
            편안한 숙박을 위해 아래 질문에 답변해 주시면 정성껏 준비하겠습니다!
            {data?.meta.checkIn && !isPreview && (
              <span className="block mt-1 text-slate-400">
                숙박 일정: {data.meta.checkIn} 부터 {data.meta.nights}박
              </span>
            )}
          </p>
          <div className="mt-4">
            <label className="text-sm font-semibold">예약하신 게스트님의 성함 <span className="text-rose-500">*</span></label>
            <input
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm"
            />
          </div>
        </div>

        {questions.map((q, i) => (
          <div
            key={q.id}
            id={`q-${q.id}`}
            className={`rounded-2xl border bg-white p-5 mb-3 ${
              missing.includes(q.id) ? 'border-rose-400 ring-2 ring-rose-100' : 'border-slate-200'
            }`}
          >
            <label className="text-sm font-semibold block">
              {i + 1}. {q.label} {q.required && <span className="text-rose-500">*</span>}
            </label>
            {q.description && <p className="text-xs text-slate-400 mt-1">{q.description}</p>}
            <div className="mt-2.5">
              {q.type === 'text' && (
                <input
                  value={answers[q.id] ?? ''}
                  onChange={(e) => setAnswer(q.id, e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm"
                />
              )}
              {q.type === 'number' && (
                <input
                  type="number"
                  min={0}
                  value={answers[q.id] ?? ''}
                  onChange={(e) => setAnswer(q.id, e.target.value)}
                  className="w-32 rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm"
                />
              )}
              {q.type === 'longtext' && (
                <textarea
                  rows={3}
                  value={answers[q.id] ?? ''}
                  onChange={(e) => setAnswer(q.id, e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm"
                />
              )}
              {q.type === 'select' && (
                <div className="flex flex-wrap gap-2">
                  {(q.options ?? []).map((o) => (
                    <button
                      key={o}
                      onClick={() => setAnswer(q.id, o)}
                      className={`rounded-full border px-4 py-2 text-sm transition-colors ${
                        answers[q.id] === o
                          ? 'border-rose-400 bg-rose-50 text-rose-600 font-semibold'
                          : 'border-slate-300 hover:border-slate-400'
                      }`}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              )}
              {q.type === 'multiselect' && (
                <div className="flex flex-wrap gap-2">
                  {(q.options ?? []).map((o) => {
                    const on = (answers[q.id] ?? '').split(', ').includes(o)
                    return (
                      <button
                        key={o}
                        onClick={() => toggleMulti(q.id, o)}
                        className={`rounded-full border px-4 py-2 text-sm transition-colors ${
                          on
                            ? 'border-rose-400 bg-rose-50 text-rose-600 font-semibold'
                            : 'border-slate-300 hover:border-slate-400'
                        }`}
                      >
                        {on ? '✓ ' : ''}{o}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        ))}

        {missing.length > 0 && (
          <p className="text-sm text-rose-600 mb-3">필수 항목 {missing.length}개가 비어 있습니다.</p>
        )}
        <button
          onClick={submit}
          disabled={phase === 'submitting'}
          className="w-full rounded-2xl bg-rose-500 text-white py-3.5 font-bold hover:bg-rose-600 disabled:opacity-50"
        >
          {phase === 'submitting' ? '제출 중…' : '제출하기'}
        </button>
        <div className="text-center text-[11px] text-slate-300 mt-4">powered by 스테이프라이스</div>
      </div>
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-8 text-center">
        {children}
        <div className="mt-8 text-[11px] text-slate-300">powered by 스테이프라이스</div>
      </div>
    </div>
  )
}
