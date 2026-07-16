export function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d + days)
  return toDateStr(dt)
}

export function dayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).getDay() // 0 = 일요일
}

export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  const ms = new Date(by, bm - 1, bd).getTime() - new Date(ay, am - 1, ad).getTime()
  return Math.round(ms / 86400000)
}

export function todayStr(): string {
  return toDateStr(new Date())
}

export const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토']

export function formatKRW(n: number): string {
  return '₩' + Math.round(n).toLocaleString('ko-KR')
}

/** 만원 단위 축약 표기: 154000 → 15.4만 */
export function formatManwon(n: number): string {
  const man = n / 10000
  return (man >= 100 ? Math.round(man) : Math.round(man * 10) / 10) + '만'
}
