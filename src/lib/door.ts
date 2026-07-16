import type { Booking, DoorLogEntry } from '../types'
import { addDays } from './date'

const LS_DOORLOG = 'stayprice.doorlog.v1'

/** 예약별 백업 비밀번호 — 예약 ID에서 결정적으로 6자리 생성 (실연동 시 도어락 API로 발급) */
export function backupPin(bookingId: string): string {
  let h = 0
  for (let i = 0; i < bookingId.length; i++) h = (Math.imul(h, 31) + bookingId.charCodeAt(i)) | 0
  return String(Math.abs(h) % 1000000).padStart(6, '0')
}

/** 출입 유효 기간: 체크인 15:00 ~ 체크아웃 11:00 */
export function accessWindow(b: Booking): { from: string; to: string } {
  return {
    from: `${b.checkIn}T15:00:00`,
    to: `${addDays(b.checkIn, b.nights)}T11:00:00`,
  }
}

export function isAccessValid(b: Booking, now = new Date()): boolean {
  const { from, to } = accessWindow(b)
  return now >= new Date(from) && now <= new Date(to)
}

/** 게스트에게 보낼 문열기 URL (해시 라우터 기준) */
export function guestDoorUrl(bookingId: string): string {
  return `${location.origin}${location.pathname}#/door/${encodeURIComponent(bookingId)}`
}

export function readDoorLog(): DoorLogEntry[] {
  try {
    return JSON.parse(localStorage.getItem(LS_DOORLOG) ?? '[]') as DoorLogEntry[]
  } catch {
    return []
  }
}

export function appendDoorLog(entry: DoorLogEntry): void {
  const log = [entry, ...readDoorLog()].slice(0, 200)
  localStorage.setItem(LS_DOORLOG, JSON.stringify(log))
}

/** 도어락 해정 — 목업 드라이버 (실제 연동 시 Tuya/TTLock API 호출로 교체) */
export async function unlockDoor(provider: 'mock' | 'tuya' | 'ttlock'): Promise<void> {
  if (provider === 'mock') {
    await new Promise((r) => setTimeout(r, 1200)) // 실제 통신처럼 살짝 대기
    return
  }
  throw new Error('이 도어락 연동은 아직 준비 중입니다')
}
