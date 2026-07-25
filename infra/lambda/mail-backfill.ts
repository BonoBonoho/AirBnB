/**
 * 과거 메일 자동 백필 — IMAP(공식 프로토콜)으로 Gmail/네이버 메일함에서
 * 에어비앤비·부킹닷컴 메일을 스캔해 매출을 일괄 반영한다.
 * 앱 비밀번호는 이 실행에서 1회 사용 후 폐기 (어디에도 저장하지 않음).
 */
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { parseAirbnbEmail } from './parse-email'
import type { ActualPayout } from './parse-email'

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
})
const TABLE = process.env.TABLE_NAME as string

interface BackfillEvent {
  sub: string
  provider: 'gmail' | 'naver'
  email: string
  appPassword: string
}

async function getDoc<T>(sub: string, sk: string): Promise<T | null> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: `USER#${sub}`, sk } }))
  return (res.Item?.data as T) ?? null
}

async function putDoc(sub: string, sk: string, data: unknown): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: { pk: `USER#${sub}`, sk, data, updatedAt: new Date().toISOString() },
  }))
}

export async function handler(ev: BackfillEvent): Promise<void> {
  const finish = (subject: string, snippet: string) =>
    putDoc(ev.sub, 'VERIFICATION', { subject, snippet, receivedAt: new Date().toISOString() })

  const host = ev.provider === 'naver' ? 'imap.naver.com' : 'imap.gmail.com'
  const client = new ImapFlow({
    host,
    port: 993,
    secure: true,
    auth: { user: ev.email, pass: ev.appPassword },
    logger: false,
  })

  // 소켓 타임아웃 등 IMAP 에러가 프로세스를 죽이지 않게 (unhandled 'error' 이벤트 방지)
  client.on('error', (e: unknown) => console.error('imap connection error:', e))

  try {
    await client.connect()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await finish(
      '❌ 메일함 로그인 실패',
      `${host} 접속 오류: ${msg.slice(0, 200)}\n앱 비밀번호가 맞는지, ${ev.provider === 'naver' ? '네이버 메일 환경설정에서 IMAP/SMTP 사용이 켜져 있는지' : 'Google 계정에 2단계 인증 + 앱 비밀번호가 설정되어 있는지'} 확인해 주세요.`,
    )
    return
  }

  const started = Date.now()
  const summary = { scanned: 0, saved: 0, truncated: false, remaining: 0 }
  try {
    // Gmail은 전체보관함(\All)에서 검색해야 보관처리된 메일까지 잡힌다
    let box = 'INBOX'
    if (ev.provider === 'gmail') {
      try {
        const boxes = await client.list()
        const all = boxes.find((b) => b.specialUse === '\\All')
        if (all) box = all.path
      } catch { /* 목록 조회 실패 시 INBOX 사용 */ }
    }

    const lock = await client.getMailboxLock(box)
    try {
      const uids = (await client.search(
        { or: [{ from: 'airbnb' }, { from: 'booking.com' }] },
        { uid: true },
      )) as number[] | false

      // 체크포인트: 이미 처리한 메일은 건너뛰어 재실행 시 이어서 진행 (최신 메일 우선)
      const stateKey = `${ev.provider}:${ev.email.toLowerCase()}`
      const state = (await getDoc<Record<string, number[]>>(ev.sub, 'BACKFILLSTATE')) ?? {}
      const done = new Set(state[stateKey] ?? [])
      const list = (uids ? uids.slice(-800) : []).filter((u) => !done.has(u)).reverse()

      const actuals = (await getDoc<ActualPayout[]>(ev.sub, 'ACTUALS')) ?? []
      const byId = new Map(actuals.map((a) => [a.id, a]))

      for (const uid of list) {
        // Lambda 타임아웃(5분) 보호 — 4분 넘으면 부분 결과로 마무리
        if (Date.now() - started > 240_000) {
          summary.truncated = true
          break
        }
        try {
          const dl = await client.download(String(uid), undefined, { uid: true })
          if (!dl?.content) continue
          const chunks: Buffer[] = []
          for await (const c of dl.content) chunks.push(Buffer.from(c))
          const mail = await simpleParser(Buffer.concat(chunks))
          summary.scanned++
          done.add(uid)
          const from = (mail.from?.value?.[0]?.address ?? '').toLowerCase()
          if (!/airbnb|booking/.test(from)) continue
          const text = mail.text || (typeof mail.html === 'string' ? mail.html : '')
          const p = parseAirbnbEmail(mail.subject ?? '', String(text), (mail.date ?? new Date()).toISOString())
          if (p) {
            byId.set(p.id, p)
            summary.saved++
          }
        } catch (e) {
          console.error('message fetch/parse failed:', uid, e)
        }
      }

      await putDoc(ev.sub, 'ACTUALS', [...byId.values()].slice(-800))
      state[stateKey] = [...done].slice(-3000)
      await putDoc(ev.sub, 'BACKFILLSTATE', state)
      summary.remaining = list.length - summary.scanned
    } finally {
      lock.release()
    }

    await finish(
      `✓ 과거 메일 백필 완료 (${ev.provider === 'naver' ? '네이버' : 'Gmail'})`,
      `에어비앤비·부킹닷컴 메일 ${summary.scanned}통 검사 → ${summary.saved}건 매출 반영.${summary.truncated ? `\n(시간 제한으로 일부만 처리 — 남은 ${summary.remaining}통은 '스캔 시작'을 한 번 더 누르면 이어서 처리됩니다)` : ''}\n앱 비밀번호는 저장하지 않았습니다. 보안을 위해 이제 해당 앱 비밀번호를 삭제하셔도 됩니다.`,
    )
    console.log(`backfill done: scanned=${summary.scanned} saved=${summary.saved} truncated=${summary.truncated}`)
  } catch (e) {
    console.error('backfill failed:', e)
    await finish('❌ 백필 중 오류', String(e instanceof Error ? e.message : e).slice(0, 400))
  } finally {
    await client.logout().catch(() => {})
  }
}
