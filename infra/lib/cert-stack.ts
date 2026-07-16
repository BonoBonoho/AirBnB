import { Stack } from 'aws-cdk-lib'
import type { StackProps } from 'aws-cdk-lib'
import type { Construct } from 'constructs'
import * as acm from 'aws-cdk-lib/aws-certificatemanager'
import * as route53 from 'aws-cdk-lib/aws-route53'

interface CertStackProps extends StackProps {
  domainName: string
}

/**
 * CloudFront용 ACM 인증서는 반드시 us-east-1 리전에 있어야 하므로 별도 스택으로 분리.
 * crossRegionReferences로 메인 스택(ap-northeast-2)에서 참조한다.
 */
export class CertStack extends Stack {
  readonly certificate: acm.Certificate

  constructor(scope: Construct, id: string, props: CertStackProps) {
    super(scope, id, props)

    const zone = route53.HostedZone.fromLookup(this, 'Zone', {
      domainName: props.domainName,
    })

    this.certificate = new acm.Certificate(this, 'SiteCert', {
      domainName: props.domainName,
      subjectAlternativeNames: [`www.${props.domainName}`],
      validation: acm.CertificateValidation.fromDns(zone),
    })
  }
}
