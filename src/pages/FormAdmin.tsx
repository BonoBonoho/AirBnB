import { useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { Card, PageTitle } from '../components/ui'
import { todayStr, addDays } from '../lib/date'
import { DEFAULT_FORM_QUESTIONS } from '../data/formTemplate'
import type { FormQuestion } from '../types'

function formUrl(token: string): string {
  return `${location.origin}${location.pathname}#/guestform/${token}`
}

function QuestionEditor() {
  const { cloud } = useStore()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<FormQuestion[]>([])
  const [saved, setSaved] = useState(false)
  if (!cloud) return null

  const current = cloud.formQuestions ?? DEFAULT_FORM_QUESTIONS

  const startEdit = () => {
    setDraft(JSON.parse(JSON.stringify(current)) as FormQuestion[])
    setEditing(true)
  }
  const patch = (i: number, p: Partial<FormQuestion>) =>
    setDraft((prev) => prev.map((q, idx) => (idx === i ? { ...q, ...p } : q)))
  const save = async () => {
    await cloud.saveFormQuestions(draft.filter((q) => q.label.trim()))
    setEditing(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <Card className="mb-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="font-semibold">📝 설문 질문 ({current.length}개)</div>
          <p className="text-xs text-slate-400 mt-0.5">
            기존 Notion 양식(산티아고 숙소 설문지)을 기본 템플릿으로 옮겨왔습니다
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-emerald-600 font-medium">✓ 저장됨</span>}
          <a
            href={`${location.origin}${location.pathname}#/guestform/preview`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50"
          >
            미리보기
          </a>
          {!editing ? (
            <button onClick={startEdit} className="rounded-lg bg-slate-800 text-white px-3 py-1.5 text-xs font-medium hover:bg-slate-700">
              질문 편집
            </button>
          ) : (
            <>
              <button onClick={save} className="rounded-lg bg-rose-500 text-white px-3 py-1.5 text-xs font-semibold hover:bg-rose-600">
                저장
              </button>
              <button onClick={() => setEditing(false)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50">
                취소
              </button>
            </>
          )}
        </div>
      </div>

      {editing && (
        <div className="mt-4 space-y-3">
          {draft.map((q, i) => (
            <div key={q.id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-start gap-2">
                <span className="text-xs text-slate-400 mt-2.5 w-5">{i + 1}.</span>
                <div className="flex-1 space-y-1.5">
                  <input
                    value={q.label}
                    onChange={(e) => patch(i, { label: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-medium"
                    placeholder="질문"
                  />
                  <input
                    value={q.description ?? ''}
                    onChange={(e) => patch(i, { description: e.target.value || undefined })}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500"
                    placeholder="설명 (선택)"
                  />
                  {(q.type === 'select' || q.type === 'multiselect') && (
                    <input
                      value={(q.options ?? []).join(', ')}
                      onChange={(e) => patch(i, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-mono"
                      placeholder="옵션을 쉼표로 구분"
                    />
                  )}
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <label className="text-[11px] flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!q.required}
                      onChange={(e) => patch(i, { required: e.target.checked })}
                      className="accent-rose-500"
                    />
                    필수
                  </label>
                  <button
                    onClick={() => setDraft((prev) => prev.filter((_, idx) => idx !== i))}
                    className="text-slate-300 hover:text-rose-500 text-sm"
                    title="삭제"
                  >
                    🗑
                  </button>
                </div>
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            {(
              [['text', '단답'], ['longtext', '장문'], ['number', '숫자'], ['select', '단일선택'], ['multiselect', '복수선택']] as const
            ).map(([type, label]) => (
              <button
                key={type}
                onClick={() =>
                  setDraft((prev) => [
                    ...prev,
                    {
                      id: `q${Date.now().toString(36)}`,
                      label: '',
                      type,
                      ...(type === 'select' || type === 'multiselect' ? { options: ['옵션1', '옵션2'] } : {}),
                    },
                  ])
                }
                className="rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs text-slate-500 hover:border-rose-300 hover:text-rose-500"
              >
                + {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

export default function FormAdmin() {
  const { listings, bookings, cloud } = useStore()
  const [copied, setCopied] = useState('')
  const [busy, setBusy] = useState('')
  const [openResp, setOpenResp] = useState('')
  const today = todayStr()

  const upcoming = useMemo(
    () =>
      bookings
        .filter((b) => b.status !== 'cancelled' && addDays(b.checkIn, b.nights) >= today)
        .sort((a, b) => a.checkIn.localeCompare(b.checkIn))
        .slice(0, 20),
    [bookings, today],
  )

  if (!cloud) {
    return (
      <div>
        <PageTitle title="게스트 설문" desc="예약별 사전 체크인 설문 — 게스트 답변으로 미리 준비하세요" />
        <Card>
          <p className="text-sm text-slate-500">
            데모 모드에서는{' '}
            <a href={`${location.origin}${location.pathname}#/guestform/preview`} target="_blank" rel="noreferrer" className="text-rose-500 underline">
              설문 미리보기
            </a>
            만 볼 수 있습니다. 링크 발급과 응답 수집은 stayprice.co 로그인 후 이용하세요.
          </p>
        </Card>
      </div>
    )
  }

  const questions = cloud.formQuestions ?? DEFAULT_FORM_QUESTIONS

  const getLink = async (b: (typeof upcoming)[number]) => {
    setBusy(b.id)
    try {
      const listing = listings.find((l) => l.id === b.listingId)
      const token =
        cloud.formLinks[b.id] ??
        (await cloud.createFormLink({
          bookingId: b.id,
          guestName: b.guestName,
          listingName: listing?.name ?? '',
          checkIn: b.checkIn,
          nights: b.nights,
        }))
      await navigator.clipboard.writeText(formUrl(token))
      setCopied(b.id)
      setTimeout(() => setCopied(''), 1500)
    } finally {
      setBusy('')
    }
  }

  return (
    <div>
      <PageTitle
        title="게스트 설문"
        desc="설문 링크를 에어비앤비 자동 메시지에 넣어 보내면, 게스트 답변이 예약별로 정리됩니다"
      />

      <QuestionEditor />

      <Card>
        <div className="font-semibold mb-3">예약별 설문 현황 (진행·예정 {upcoming.length}건)</div>
        {upcoming.length === 0 && (
          <p className="text-sm text-slate-400 py-6 text-center">진행 중이거나 예정된 예약이 없습니다</p>
        )}
        <div className="space-y-2.5">
          {upcoming.map((b) => {
            const resp = cloud.formResponses[b.id]
            const listing = listings.find((l) => l.id === b.listingId)
            return (
              <div key={b.id} className="rounded-xl border border-slate-100 p-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="min-w-0">
                    <span className="font-medium text-sm">{resp?.guestName || b.guestName}</span>
                    <span className="text-xs text-slate-400 ml-2">
                      {listing?.thumbnail} {b.checkIn.slice(5).replace('-', '/')} · {b.nights}박
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    {resp ? (
                      <>
                        <span className="rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 px-2.5 py-1 font-medium">
                          ✓ 제출됨 {resp.submittedAt.slice(5, 10)}
                        </span>
                        <button
                          onClick={() => setOpenResp(openResp === b.id ? '' : b.id)}
                          className="rounded-lg border border-slate-300 px-3 py-1 hover:bg-slate-50"
                        >
                          {openResp === b.id ? '접기' : '응답 보기'}
                        </button>
                      </>
                    ) : (
                      <span className="rounded-full bg-slate-50 border border-slate-200 text-slate-400 px-2.5 py-1">대기중</span>
                    )}
                    <button
                      onClick={() => getLink(b)}
                      disabled={busy === b.id}
                      className="rounded-lg bg-rose-500 text-white px-3 py-1 font-medium hover:bg-rose-600 disabled:opacity-50"
                    >
                      {copied === b.id ? '✓ 복사됨' : busy === b.id ? '…' : '설문 링크 복사'}
                    </button>
                  </div>
                </div>
                {openResp === b.id && resp && (
                  <div className="mt-3 rounded-lg bg-slate-50 p-3 space-y-1.5">
                    {questions.map((q) =>
                      resp.answers[q.id] ? (
                        <div key={q.id} className="text-xs">
                          <span className="text-slate-400">{q.label}</span>
                          <div className="font-medium text-slate-700 whitespace-pre-wrap">{resp.answers[q.id]}</div>
                        </div>
                      ) : null,
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <p className="text-xs text-slate-400 mt-3">
          💡 에어비앤비 호스트 → 메시지 → 예약 확정 자동 메시지에 설문 링크를 넣어두면 게스트가 알아서 작성합니다.
        </p>
      </Card>
    </div>
  )
}
