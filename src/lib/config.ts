/** 배포 시 S3에 함께 올라가는 /config.json — 없으면(로컬 개발) 데모 모드로 동작 */
export interface AppConfig {
  apiUrl: string
  region: string
  userPoolId: string
  userPoolClientId: string
}

let cached: AppConfig | null | undefined

export async function loadConfig(): Promise<AppConfig | null> {
  if (cached !== undefined) return cached
  try {
    const res = await fetch('/config.json', { cache: 'no-store' })
    if (!res.ok) throw new Error('no config')
    const cfg = (await res.json()) as AppConfig
    cached = cfg.apiUrl && cfg.userPoolId ? cfg : null
  } catch {
    cached = null
  }
  return cached
}
