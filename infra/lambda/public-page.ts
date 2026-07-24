/** 숙소 공개 페이지(미니홈) 정적 HTML 생성 — 네이버/구글 봇이 읽을 수 있는 완성된 HTML */

export interface PublicPageInput {
  slug: string
  name: string
  region: string
  type: string
  bedrooms: number
  maxGuests: number
  description: string
  photoUrl?: string
  kakaoUrl?: string
  phone?: string
  airbnbUrl?: string
  minPriceText?: string // 예: "1박 180,000원부터"
  apiUrl: string
  origin: string
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function renderListingPage(p: PublicPageInput): string {
  const title = `${p.name} — ${p.region} 숙소 예약`
  const desc = p.description.slice(0, 160).replace(/\n/g, ' ')
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'LodgingBusiness',
    name: p.name,
    description: p.description.slice(0, 500),
    address: { '@type': 'PostalAddress', addressRegion: p.region, addressCountry: 'KR' },
    ...(p.photoUrl ? { image: p.photoUrl } : {}),
    ...(p.phone ? { telephone: p.phone } : {}),
    url: `${p.origin}/s/${p.slug}`,
  }

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${p.origin}/s/${p.slug}">
${p.photoUrl ? `<meta property="og:image" content="${esc(p.photoUrl)}">` : ''}
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;background:#f8fafc;color:#0f172a;line-height:1.6}
.wrap{max-width:640px;margin:0 auto;padding:20px 16px 60px}
.hero{border-radius:20px;overflow:hidden;background:#e2e8f0}
.hero img{width:100%;height:300px;object-fit:cover;display:block}
h1{font-size:1.5rem;margin:18px 0 4px}
.sub{color:#64748b;font-size:.9rem}
.price{color:#e11d48;font-weight:700;margin-top:6px}
.desc{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:18px;margin:16px 0;white-space:pre-wrap;font-size:.95rem}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:18px;margin:16px 0}
.card h2{font-size:1.05rem;margin-bottom:10px}
.cal-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.cal-head button{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:4px 12px;cursor:pointer}
.cal{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;text-align:center;font-size:.8rem}
.cal .dow{color:#94a3b8;padding:4px 0}
.cal .d{padding:8px 0;border-radius:8px;background:#f0fdf4;color:#15803d}
.cal .d.x{background:#f1f5f9;color:#cbd5e1;text-decoration:line-through}
.cal .d.p{background:transparent}
.legend{font-size:.75rem;color:#64748b;margin-top:8px}
.btns{display:flex;flex-direction:column;gap:10px;margin:20px 0}
.btn{display:block;text-align:center;padding:14px;border-radius:14px;font-weight:700;text-decoration:none;font-size:1rem}
.btn.kakao{background:#FEE500;color:#191919}
.btn.tel{background:#0f172a;color:#fff}
.btn.abnb{background:#fff;border:1.5px solid #FF5A5F;color:#FF5A5F}
form input,form textarea{width:100%;border:1px solid #cbd5e1;border-radius:10px;padding:10px;font-size:.9rem;margin-top:4px;font-family:inherit}
form label{font-size:.85rem;font-weight:600;display:block;margin-top:10px}
form button{width:100%;margin-top:14px;background:#e11d48;color:#fff;border:none;border-radius:12px;padding:13px;font-size:1rem;font-weight:700;cursor:pointer}
.ok{background:#f0fdf4;border:1px solid #bbf7d0;color:#15803d;border-radius:12px;padding:14px;text-align:center;display:none}
.foot{text-align:center;color:#cbd5e1;font-size:.7rem;margin-top:30px}
</style>
</head>
<body>
<div class="wrap">
  ${p.photoUrl ? `<div class="hero"><img src="${esc(p.photoUrl)}" alt="${esc(p.name)}"></div>` : ''}
  <h1>${esc(p.name)}</h1>
  <div class="sub">${esc(p.region)} · ${esc(p.type)} · 침실 ${p.bedrooms} · 최대 ${p.maxGuests}인</div>
  ${p.minPriceText ? `<div class="price">${esc(p.minPriceText)}</div>` : ''}
  <div class="desc">${esc(p.description)}</div>

  <div class="card">
    <h2>📅 예약 가능 날짜</h2>
    <div class="cal-head">
      <button onclick="mv(-1)">←</button><b id="ym"></b><button onclick="mv(1)">→</button>
    </div>
    <div class="cal" id="cal"></div>
    <div class="legend">초록 = 예약 가능 · 회색 = 마감 · 실시간 동기화</div>
  </div>

  <div class="btns">
    ${p.kakaoUrl ? `<a class="btn kakao" href="${esc(p.kakaoUrl)}" target="_blank">💬 카카오톡으로 문의하기</a>` : ''}
    ${p.phone ? `<a class="btn tel" href="tel:${esc(p.phone)}">📞 전화 문의 ${esc(p.phone)}</a>` : ''}
    ${p.airbnbUrl ? `<a class="btn abnb" href="${esc(p.airbnbUrl)}" target="_blank">에어비앤비에서 보기</a>` : ''}
  </div>

  <div class="card">
    <h2>✉️ 예약 문의 남기기</h2>
    <div class="ok" id="ok">문의가 접수되었습니다! 호스트가 곧 연락드릴게요 🤗</div>
    <form id="f" onsubmit="return send(event)">
      <label>성함 *</label><input name="name" required maxlength="50">
      <label>연락처 (전화/카톡ID) *</label><input name="contact" required maxlength="80">
      <label>희망 날짜</label><input name="dates" placeholder="예: 8월 15일 ~ 17일 (2박)" maxlength="80">
      <label>문의 내용</label><textarea name="message" rows="3" maxlength="1000" placeholder="인원, 바베큐 이용 여부 등"></textarea>
      <button type="submit">문의 보내기</button>
    </form>
  </div>
  <div class="foot">powered by 스테이프라이스 · stayprice.co</div>
</div>
<script>
var API=${JSON.stringify(p.apiUrl)},SLUG=${JSON.stringify(p.slug)};
var booked={},cur=new Date();cur.setDate(1);
fetch(API+"/public/avail/"+SLUG).then(function(r){return r.json()}).then(function(d){(d.booked||[]).forEach(function(x){booked[x]=1});draw()});
function draw(){
  var y=cur.getFullYear(),m=cur.getMonth();
  document.getElementById("ym").textContent=y+"년 "+(m+1)+"월";
  var el=document.getElementById("cal"),h="";
  ["일","월","화","수","목","금","토"].forEach(function(d){h+='<div class="dow">'+d+"</div>"});
  for(var i=0;i<new Date(y,m,1).getDay();i++)h+='<div class="d p"></div>';
  var days=new Date(y,m+1,0).getDate(),today=new Date();today.setHours(0,0,0,0);
  for(var d=1;d<=days;d++){
    var ds=y+"-"+String(m+1).padStart(2,"0")+"-"+String(d).padStart(2,"0");
    var past=new Date(y,m,d)<today;
    h+='<div class="d'+((booked[ds]||past)?" x":"")+'">'+d+"</div>";
  }
  el.innerHTML=h;
}
function mv(n){cur.setMonth(cur.getMonth()+n);draw()}
function send(e){
  e.preventDefault();
  var f=e.target,b=f.querySelector("button");b.disabled=true;b.textContent="전송 중…";
  fetch(API+"/public/inquiry/"+SLUG,{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({name:f.name.value,contact:f.contact.value,dates:f.dates.value,message:f.message.value})})
    .then(function(r){if(!r.ok)throw 0;f.style.display="none";document.getElementById("ok").style.display="block"})
    .catch(function(){b.disabled=false;b.textContent="문의 보내기";alert("전송에 실패했어요. 잠시 후 다시 시도해주세요.")});
  return false;
}
</script>
</body>
</html>`
}

export function renderSitemap(origin: string, slugs: string[]): string {
  const urls = ['', ...slugs.map((s) => `/s/${s}`)]
    .map((path) => `  <url><loc>${origin}${path}</loc></url>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}
