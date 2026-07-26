#!/usr/bin/env node
/**
 * 스테이프라이스 허브 에이전트
 *
 * 집/숙소 안의 미니 컴퓨터(라즈베리파이·맥·윈도우 아무거나)에서 실행되어
 * 제조사 클라우드 없이 로컬 기기를 제어하고, 스테이프라이스 클라우드와
 * 3초 주기로 동기화한다 (상태 보고는 30초 주기).
 *
 * 실행: config.json 채운 뒤 `node agent.js`  (Node 18+, 외부 패키지 불필요)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { virtualDriver } from './drivers/virtual.js'

const here = dirname(fileURLToPath(import.meta.url))

let cfg
try {
  cfg = JSON.parse(readFileSync(join(here, 'config.json'), 'utf8'))
} catch {
  console.error('config.json이 없습니다. 스테이프라이스 → 스마트룸 → 연동 설정 → 허브에서')
  console.error('등록 코드를 발급받아 hub/config.json으로 저장하세요. (config.example.json 참고)')
  process.exit(1)
}
if (!cfg.apiUrl || !cfg.hubId || !cfg.key) {
  console.error('config.json에 apiUrl / hubId / key가 모두 필요합니다.')
  process.exit(1)
}

// 드라이버 등록 — Matter/Zigbee 등은 여기에 추가된다
const drivers = [virtualDriver]

async function collectDevices() {
  const out = []
  for (const d of drivers) out.push(...(await d.devices()))
  return out
}

async function collectStatuses() {
  const out = {}
  for (const d of drivers) Object.assign(out, await d.statuses())
  return out
}

async function applyCommand(cmd) {
  const localId = String(cmd.deviceId ?? '').split(':').slice(1).join(':')
  for (const d of drivers) {
    if (await d.has(localId)) {
      console.log(`[명령] ${localId} ← ${cmd.command}`)
      await d.command(localId, cmd.command, cmd.arg)
      return
    }
  }
  console.warn(`[명령] 대상 기기를 찾을 수 없음: ${localId}`)
}

let tick = 0
let lastOk = true

async function sync() {
  const body = { hubId: cfg.hubId, key: cfg.key }
  // 10회에 1번(30초)은 기기 목록·상태를 함께 보고
  if (tick % 10 === 0) {
    body.devices = await collectDevices()
    body.statuses = await collectStatuses()
  }
  tick++
  try {
    const res = await fetch(`${cfg.apiUrl}/public/hub/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) {
      console.error(`[동기화] 실패 (${res.status})${res.status === 401 ? ' — hubId/key를 확인하세요' : ''}`)
      lastOk = false
      return
    }
    if (!lastOk) console.log('[동기화] 연결 복구됨')
    lastOk = true
    const data = await res.json()
    if (Array.isArray(data.commands) && data.commands.length > 0) {
      for (const cmd of data.commands) await applyCommand(cmd)
      tick = 0 // 명령 실행 직후 상태를 바로 보고해 화면에 빠르게 반영
    }
  } catch (e) {
    console.error('[동기화] 네트워크 오류:', e?.message ?? e)
    lastOk = false
  }
}

console.log(`스테이프라이스 허브 시작 — hubId=${cfg.hubId}, 드라이버: ${drivers.map((d) => d.name).join(', ')}`)
console.log('스마트룸 → 기기 다시 불러오기를 누르면 허브 기기가 나타납니다. (Ctrl+C로 종료)')
sync()
setInterval(sync, 3000)
