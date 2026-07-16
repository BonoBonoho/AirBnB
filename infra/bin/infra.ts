import { App } from 'aws-cdk-lib'
import { StayPriceStack } from '../lib/stayprice-stack'
import { CertStack } from '../lib/cert-stack'

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

new StayPriceStack(app, 'StayPrice', {
  env: { account, region },
  crossRegionReferences: true,
  domainName,
  certificate: certStack?.certificate,
})
