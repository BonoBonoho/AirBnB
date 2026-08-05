/**
 * TTLock 도어락 드라이버 — 공식 오픈 플랫폼 API (v3)
 * 문서: euopen.ttlock.com
 *
 * 인증: OAuth2 (비밀번호는 MD5 해시로 전송). 액세스 토큰은 리프레시 토큰으로 자동 갱신.
 * 게이트웨이가 있으면 원격 열기/잠그기 + 기간제 비밀번호 발급이 가능하다.
 */
import { createHash } from 'node:crypto'

export interface TtOauth {
  accessToken: string
  refreshToken: string
  uid: number
  expiresAt: number // epoch ms
}

export interface TtlockConfig {
  clientId: string
  clientSecret: string
  /** api(글로벌) | euapi(유럽·기타) — TTLock 계정 지역에 맞춰 자동 판별 */
  region: 'api' | 'euapi'
  oauth?: TtOauth
}

export interface TtLock {
  lockId: number
  alias: string
  hasGateway?: boolean
}

const base = (region: string) => `https://${region === 'api' ? 'api' : 'euapi'}.ttlock.com`

function md5(s: string): string {
  return createHash('md5').update(s, 'utf8').digest('hex')
}

async function ttForm(url: string, params: Record<string, string | number>): Promise<Record<string, unknown>> {
  const body = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)] as [string, string])).toString()
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10000),
  })
  return (await res.json()) as Record<string, unknown>
}

async function ttGet(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
  return (await res.json()) as Record<string, unknown>
}

/** TTLock API 오류 검사 — errcode가 0이 아니면 throw */
function ttCheck(data: Record<string, unknown>): Record<string, unknown> {
  if (typeof data.errcode === 'number' && data.errcode !== 0) {
    throw new Error(`TTLock 오류: ${String(data.errmsg ?? data.errcode)}`)
  }
  return data
}

/** 계정 로그인 → 토큰 발급. 비밀번호는 이 요청에만 쓰고 저장하지 않는다. */
export async function ttLogin(
  cfg: Pick<TtlockConfig, 'clientId' | 'clientSecret' | 'region'>, username: string, password: string,
): Promise<TtOauth> {
  const data = await ttForm(`${base(cfg.region)}/oauth2/token`, {
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    username,
    password: md5(password),
    redirect_uri: 'https://stayprice.co',
  })
  if (!data.access_token) {
    throw new Error(`TTLock 로그인 실패: ${String(data.errmsg ?? data.errcode ?? '인증정보를 확인하세요')}`)
  }
  return {
    accessToken: String(data.access_token),
    refreshToken: String(data.refresh_token ?? ''),
    uid: Number(data.uid ?? 0),
    expiresAt: Date.now() + Number(data.expires_in ?? 7776000) * 1000,
  }
}

export async function ttRefresh(cfg: TtlockConfig, refreshToken: string): Promise<TtOauth> {
  const data = await ttForm(`${base(cfg.region)}/oauth2/token`, {
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    redirect_uri: 'https://stayprice.co',
  })
  if (!data.access_token) throw new Error(`TTLock 토큰 갱신 실패: ${String(data.errmsg ?? '재연동이 필요합니다')}`)
  return {
    accessToken: String(data.access_token),
    refreshToken: String(data.refresh_token ?? refreshToken),
    uid: Number(data.uid ?? 0),
    expiresAt: Date.now() + Number(data.expires_in ?? 7776000) * 1000,
  }
}

/** 사용할 토큰 결정 — 만료 1시간 전 자동 갱신 후 persist */
export async function resolveTtToken(
  cfg: TtlockConfig | undefined, persist: (oauth: TtOauth) => Promise<void>,
): Promise<string | null> {
  if (!cfg?.oauth) return null
  if (cfg.oauth.expiresAt - Date.now() > 60 * 60 * 1000) return cfg.oauth.accessToken
  try {
    const next = await ttRefresh(cfg, cfg.oauth.refreshToken)
    await persist(next)
    return next.accessToken
  } catch {
    return cfg.oauth.accessToken // 갱신 실패 시 기존 토큰이라도 시도
  }
}

export async function ttListLocks(cfg: TtlockConfig, token: string): Promise<TtLock[]> {
  const url = `${base(cfg.region)}/v3/lock/list?clientId=${cfg.clientId}&accessToken=${token}&pageNo=1&pageSize=100&date=${Date.now()}`
  const data = ttCheck(await ttGet(url))
  const list = (data.list as { lockId: number; lockAlias?: string; lockName?: string }[]) ?? []
  return list.map((l) => ({ lockId: l.lockId, alias: l.lockAlias || l.lockName || `잠금 ${l.lockId}` }))
}

/**
 * 기간제 비밀번호 발급 — keyboardPwdType 3(기간). 알고리즘 기반이라 게이트웨이가
 * 없어도 즉시 코드가 나오고, 게이트웨이가 있으면 자동으로 잠금에 동기화된다.
 * startDate/endDate는 epoch ms.
 */
export async function ttGetPasscode(
  cfg: TtlockConfig, token: string, lockId: number, name: string, startDate: number, endDate: number,
): Promise<{ keyboardPwd: string; keyboardPwdId: number }> {
  const url = `${base(cfg.region)}/v3/keyboardPwd/get?clientId=${cfg.clientId}&accessToken=${token}`
    + `&lockId=${lockId}&keyboardPwdType=3&keyboardPwdName=${encodeURIComponent(name)}`
    + `&startDate=${startDate}&endDate=${endDate}&date=${Date.now()}`
  const data = ttCheck(await ttGet(url))
  if (!data.keyboardPwd) throw new Error('비밀번호 발급 실패')
  return { keyboardPwd: String(data.keyboardPwd), keyboardPwdId: Number(data.keyboardPwdId ?? 0) }
}

export async function ttDeletePasscode(cfg: TtlockConfig, token: string, lockId: number, keyboardPwdId: number): Promise<void> {
  ttCheck(await ttForm(`${base(cfg.region)}/v3/keyboardPwd/delete`, {
    clientId: cfg.clientId, accessToken: token, lockId, keyboardPwdId, deleteType: 2, date: Date.now(),
  }))
}

/** 원격 열기 (게이트웨이 + 원격잠금해제 활성화 필요) */
export async function ttUnlock(cfg: TtlockConfig, token: string, lockId: number): Promise<void> {
  ttCheck(await ttForm(`${base(cfg.region)}/v3/lock/unlock`, {
    clientId: cfg.clientId, accessToken: token, lockId, date: Date.now(),
  }))
}

export async function ttLock(cfg: TtlockConfig, token: string, lockId: number): Promise<void> {
  ttCheck(await ttForm(`${base(cfg.region)}/v3/lock/lock`, {
    clientId: cfg.clientId, accessToken: token, lockId, date: Date.now(),
  }))
}
