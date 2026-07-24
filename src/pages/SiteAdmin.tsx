import { useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { Card, PageTitle } from '../components/ui'
import { formatManwon } from '../lib/date'

export default function SiteAdmin() {
  const { listings, cloud, updateListing } = useStore()
  const activeListings = listings.filter((l) => l.active)
  const [listingId, setListingId] = useState(activeListings[0]?.id ?? '')
  const listing = listings.find((l) => l.id === listingId) ?? activeListings[0]

  const cfg = listing?.publicPage
  const [slug, setSlug] = useState(cfg?.slug ?? '')
  const [description, setDescription] = useState(cfg?.description ?? '')
  const [kakaoUrl, setKakaoUrl] = useState(cfg?.kakaoUrl ?? '')
  const [phone, setPhone] = useState(cfg?.phone ?? '')
  const [airbnbUrl, setAirbnbUrl] = useState(cfg?.airbnbUrl ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [publishedUrl, setPublishedUrl] = useState('')

  const selectListing = (id: string) => {
    setListingId(id)
    const l = listings.find((x) => x.id === id)
    const p = l?.publicPage
    setSlug(p?.slug ?? '')
    setDescription(p?.description ?? '')
    setKakaoUrl(p?.kakaoUrl ?? '')
    setPhone(p?.phone ?? '')
    setAirbnbUrl(p?.airbnbUrl ?? (l?.airbnbRoomId ? `https://www.airbnb.co.kr/rooms/${l.airbnbRoomId}` : ''))
    setPublishedUrl('')
    setMsg('')
  }

  const myInquiries = useMemo(
    () => (cloud ? cloud.inquiries : []),
    [cloud],
  )

  if (!listing) {
    return (
      <div>
        <PageTitle title="미니홈" />
        <Card>활성화된 숙소가 없습니다.</Card>
      </div>
    )
  }

  if (!cloud) {
    return (
      <div>
        <PageTitle title="미니홈" desc="숙소 공개 페이지 — 네이버 검색 노출과 다이렉트 예약 문의를 위한 기능" />
        <Card>데모 모드에서는 사용할 수 없습니다. stayprice.co에 로그인 후 이용하세요.</Card>
      </div>
    )
  }

  const publish = async () => {
    if (!slug.trim() || !description.trim()) {
      setMsg('주소와 소개글은 필수입니다')
      return
    }
    setBusy(true)
    setMsg('')
    try {
      const url = await cloud.publishPage({
        listingId: listing.id,
        slug: slug.trim(),
        page: {
          name: listing.name,
          region: listing.region,
          type: listing.type,
          bedrooms: listing.bedrooms,
          maxGuests: listing.maxGuests,
          description: description.trim(),
          photoUrl: listing.photoUrl,
          kakaoUrl: kakaoUrl.trim() || undefined,
          phone: phone.trim() || undefined,
          airbnbUrl: airbnbUrl.trim() || undefined,
          minPriceText: `1박 ${formatManwon(listing.rules.minPrice)}원부터`,
        },
      })
      updateListing(listing.id, {
        publicPage: {
          slug: slug.trim(),
          description: description.trim(),
          kakaoUrl: kakaoUrl.trim() || undefined,
          phone: phone.trim() || undefined,
          airbnbUrl: airbnbUrl.trim() || undefined,
          publishedAt: new Date().toISOString(),
        },
      })
      setPublishedUrl(url)
      setMsg('✓ 발행 완료!')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const liveUrl = publishedUrl || (cfg?.slug ? `${location.origin}/s/${cfg.slug}` : '')

  return (
    <div>
      <PageTitle
        title="미니홈"
        desc="숙소 공개 페이지를 발행하면 네이버 검색에 노출되고, 게스트가 캘린더 확인 후 직접 문의할 수 있습니다"
      />

      <select
        value={listing.id}
        onChange={(e) => selectListing(e.target.value)}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm mb-4"
      >
        {activeListings.map((l) => (
          <option key={l.id} value={l.id}>{l.thumbnail} {l.name}</option>
        ))}
      </select>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <div className="font-semibold mb-4">🌐 페이지 설정</div>
          <div className="space-y-3.5">
            <div>
              <label className="text-sm font-medium">페이지 주소 *</label>
              <div className="flex items-center gap-1 mt-1">
                <span className="text-sm text-slate-400">{location.origin}/s/</span>
                <input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="santiago-yeongdo"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
              <p className="text-xs text-slate-400 mt-1">영문 소문자·숫자·하이픈, 3~40자. 전체 서비스에서 유일해야 합니다.</p>
            </div>
            <div>
              <label className="text-sm font-medium">숙소 소개글 * <span className="text-xs text-slate-400 font-normal">(네이버 검색 결과에 표시됨)</span></label>
              <textarea
                rows={6}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={`부산 영도 오션뷰 독채 숙소입니다.\n부산항대교 뷰와 루프탑 바베큐를 즐길 수 있어요.\n최대 16인, 반려동물 동반 가능!`}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium">카카오톡 채널 URL</label>
              <input
                value={kakaoUrl}
                onChange={(e) => setKakaoUrl(e.target.value)}
                placeholder="https://pf.kakao.com/_xxxxx"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">전화번호</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="010-1234-5678"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium">에어비앤비 링크</label>
                <input
                  value={airbnbUrl}
                  onChange={(e) => setAirbnbUrl(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <button
              onClick={publish}
              disabled={busy}
              className="w-full rounded-lg bg-rose-500 text-white py-2.5 text-sm font-semibold hover:bg-rose-600 disabled:opacity-50"
            >
              {busy ? '발행 중…' : cfg?.publishedAt ? '다시 발행 (변경사항 반영)' : '페이지 발행하기'}
            </button>
            {msg && <p className={`text-sm ${msg.startsWith('✓') ? 'text-emerald-600' : 'text-rose-600'}`}>{msg}</p>}
            {liveUrl && (
              <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5 text-sm flex items-center justify-between gap-2">
                <a href={liveUrl} target="_blank" rel="noreferrer" className="text-rose-600 underline truncate">{liveUrl}</a>
                <button
                  onClick={() => navigator.clipboard.writeText(liveUrl)}
                  className="shrink-0 text-xs rounded-lg border border-slate-300 px-2.5 py-1 hover:bg-white"
                >
                  복사
                </button>
              </div>
            )}
          </div>
          <details className="mt-4 text-xs text-slate-500">
            <summary className="cursor-pointer font-medium">📌 네이버에 노출시키는 방법 (발행 후 1회)</summary>
            <ol className="list-decimal ml-4 mt-2 space-y-1">
              <li><b>네이버 서치어드바이저</b>(searchadvisor.naver.com)에 stayprice.co 페이지 URL 등록 → 웹문서 검색 노출</li>
              <li><b>네이버 스마트플레이스</b>(smartplace.naver.com)에 숙소 등록 (사업자등록 필요) → 지도·플레이스 노출. 홈페이지 항목에 위 미니홈 주소 입력</li>
              <li>에어비앤비 숙소 설명 첫 줄에 숙소 이름을 명확히 — 게스트가 검색할 이름 그대로</li>
            </ol>
            <p className="mt-1.5">노출까지 보통 며칠~몇 주 걸립니다.</p>
          </details>
        </Card>

        <Card>
          <div className="font-semibold mb-3">📬 예약 문의함 ({myInquiries.length})</div>
          {myInquiries.length === 0 && (
            <p className="text-sm text-slate-400 py-8 text-center">
              아직 문의가 없습니다.<br />페이지를 발행하고 네이버에 등록하면 문의가 이곳에 쌓입니다.
            </p>
          )}
          <div className="space-y-3">
            {myInquiries.map((q) => {
              const l = listings.find((x) => x.id === q.listingId)
              return (
                <div key={q.id} className="rounded-xl border border-slate-100 p-3.5">
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <div className="font-medium text-sm">
                      {q.name} <span className="text-xs font-normal text-slate-400">{l?.thumbnail} {l?.name}</span>
                    </div>
                    <span className="text-xs text-slate-400">{q.at.slice(5, 16).replace('T', ' ')}</span>
                  </div>
                  <div className="text-sm mt-1">
                    📞 <span className="font-mono">{q.contact}</span>
                    {q.dates && <span className="ml-3">🗓 {q.dates}</span>}
                  </div>
                  {q.message && <p className="text-sm text-slate-600 mt-1.5 whitespace-pre-wrap">{q.message}</p>}
                </div>
              )
            })}
          </div>
        </Card>
      </div>
    </div>
  )
}
