import { App } from 'aws-cdk-lib'
import { StayPriceStack } from '../lib/stayprice-stack'
import { CertStack } from '../lib/cert-stack'
import { EmailStack } from '../lib/email-stack'

const app = new App()

const account = process.env.CDK_DEFAULT_ACCOUNT
const region = process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? 'ap-northeast-2'

// 커스텀 도메인 (예: stayprice.com) — Route 53에 호스팅 영역이 있어야 한다.
// GitHub Actions에서는 저장소 변수(vars.DOMAIN_NAME)로 주입되며, 비어 있으면 CloudFront 기본 도메인만 사용.
const domainName = process.env.DOMAIN_NAME || undefined

const certStack = domainName
  ? new CertStack(app, 'StayPriceCert', {
      env: { account, region: 'us-east-1' }, // CloudFront 인증서는 us-east-1 필수
      crossRegionReferences: true,
      domainName,
    })
  : undefined

const main = new StayPriceStack(app, 'StayPrice', {
  env: { account, region },
  crossRegionReferences: true,
  domainName,
  certificate: certStack?.certificate,
})

// 에어비앤비 정산 메일 자동 수집 — 도메인이 있어야 수신 주소를 만들 수 있다 (SES 수신은 us-east-1)
if (domainName) {
  new EmailStack(app, 'StayPriceEmail', {
    env: { account, region: 'us-east-1' },
    crossRegionReferences: true,
    domainName,
    tableArn: main.table.tableArn,
    tableName: main.table.tableName,
    tableRegion: region,
  })
}
