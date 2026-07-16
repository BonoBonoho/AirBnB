import { ScanCommand } from '@aws-sdk/lib-dynamodb'
import { ddb, TABLE_NAME, syncUserBookings } from './shared'

/** EventBridge 스케줄(6시간)마다 모든 사용자의 iCal 예약을 갱신한다. */
export async function handler(): Promise<void> {
  let lastKey: Record<string, unknown> | undefined
  const subs: string[] = []
  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'sk = :sk',
        ExpressionAttributeValues: { ':sk': 'LISTINGS' },
        ProjectionExpression: 'pk',
        ExclusiveStartKey: lastKey,
      }),
    )
    for (const item of res.Items ?? []) {
      subs.push((item.pk as string).replace('USER#', ''))
    }
    lastKey = res.LastEvaluatedKey
  } while (lastKey)

  console.log(`syncing ${subs.length} users`)
  for (const sub of subs) {
    try {
      await syncUserBookings(sub)
    } catch (e) {
      console.error(`sync failed for ${sub}:`, e)
    }
  }
}
