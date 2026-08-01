#!/usr/bin/env node
/**
 * 로컬 개발용 설정 받아오기 — `npm run dev` 실행 시 자동으로 돈다(predev).
 *
 * 배포된 실제 사이트의 /config.json(공개 파일: apiUrl·Cognito ID 등 비밀 아님)을
 * public/config.json으로 저장해, 로컬 vite dev 서버가 실제 AWS API·로그인에
 * 그대로 붙게 한다. 이미 파일이 있으면 건너뛴다(FORCE_CONFIG=1로 강제 갱신).
 *
 * 다른 사이트를 보려면:  CONFIG_URL=https://다른도메인/config.json npm run dev
 */
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dest = join(root, 'public', 'config.json')
const url = process.env.CONFIG_URL || 'https://stayprice.co/config.json'

if (existsSync(dest) && !process.env.FORCE_CONFIG) {
  console.log('[dev] public/config.json 이미 있음 — 실제 API에 연결됩니다. (갱신하려면 FORCE_CONFIG=1)')
  process.exit(0)
}

try {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const cfg = await res.json()
  if (!cfg.apiUrl || !cfg.userPoolId) throw new Error('설정에 apiUrl/userPoolId가 없습니다')
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, JSON.stringify(cfg, null, 2) + '\n')
  console.log(`[dev] 실제 설정을 받아왔습니다 (${url}). 로컬에서 실제 API·로그인에 연결됩니다.`)
} catch (e) {
  console.warn(`[dev] 설정을 받지 못했습니다 (${e.message}). 데모 모드(브라우저 저장)로 실행됩니다.`)
  console.warn('[dev] 실제 데이터로 개발하려면 인터넷 연결 후 다시 실행하거나,')
  console.warn('[dev] 배포된 사이트의 config.json을 public/config.json으로 직접 저장하세요.')
}
