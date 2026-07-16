import { Stack, RemovalPolicy, Duration, CfnOutput } from 'aws-cdk-lib'
import type { StackProps } from 'aws-cdk-lib'
import type { Construct } from 'constructs'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3n from 'aws-cdk-lib/aws-s3-notifications'
import * as ses from 'aws-cdk-lib/aws-ses'
import * as sesActions from 'aws-cdk-lib/aws-ses-actions'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as cr from 'aws-cdk-lib/custom-resources'
import * as path from 'node:path'

interface EmailStackProps extends StackProps {
  domainName: string // 예: stayprice.co → 수신 주소는 <key>@in.stayprice.co
  tableArn: string
  tableName: string
  tableRegion: string
}

/**
 * 에어비앤비 정산 메일 자동 수집 (SES 수신은 us-east-1에서 동작).
 * Gmail 필터 전달 → SES → S3 → Lambda 파싱 → DynamoDB(ap-northeast-2)에 실매출 저장.
 */
export class EmailStack extends Stack {
  constructor(scope: Construct, id: string, props: EmailStackProps) {
    super(scope, id, props)
    const receiveDomain = `in.${props.domainName}`

    const zone = route53.HostedZone.fromLookup(this, 'Zone', { domainName: props.domainName })

    // 도메인 SES 등록 (DKIM 레코드 자동 생성) — 루트 도메인 검증으로 서브도메인 수신 커버
    new ses.EmailIdentity(this, 'Identity', {
      identity: ses.Identity.publicHostedZone(zone),
    })

    // 수신 MX 레코드
    new route53.MxRecord(this, 'InboundMx', {
      zone,
      recordName: 'in',
      values: [{ priority: 10, hostName: `inbound-smtp.${this.region}.amazonaws.com` }],
    })

    // 수신 메일 임시 저장 버킷 (Lambda가 처리 후 즉시 삭제, 보험으로 1일 수명주기)
    const mailBucket = new s3.Bucket(this, 'MailBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [{ expiration: Duration.days(1) }],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    })

    const parseFn = new NodejsFunction(this, 'ParseFn', {
      entry: path.join(__dirname, '../lambda/parse-email.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.minutes(1),
      memorySize: 512,
      environment: {
        TABLE_NAME: props.tableName,
        TABLE_REGION: props.tableRegion,
        RECEIVE_DOMAIN: receiveDomain,
      },
    })
    mailBucket.grantReadWrite(parseFn)
    parseFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem'],
        resources: [props.tableArn],
      }),
    )
    mailBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(parseFn),
      { prefix: 'inbound/' },
    )

    const ruleSet = new ses.ReceiptRuleSet(this, 'RuleSet', {
      rules: [
        {
          recipients: [receiveDomain],
          actions: [new sesActions.S3({ bucket: mailBucket, objectKeyPrefix: 'inbound/' })],
          scanEnabled: true,
        },
      ],
    })

    // 룰셋 활성화 (SES는 활성 룰셋이 하나뿐이라 CDK 기본 기능으로는 못 켠다)
    new cr.AwsCustomResource(this, 'ActivateRuleSet', {
      onCreate: {
        service: 'SES',
        action: 'setActiveReceiptRuleSet',
        parameters: { RuleSetName: ruleSet.receiptRuleSetName },
        physicalResourceId: cr.PhysicalResourceId.of('ActiveRuleSet'),
      },
      onUpdate: {
        service: 'SES',
        action: 'setActiveReceiptRuleSet',
        parameters: { RuleSetName: ruleSet.receiptRuleSetName },
        physicalResourceId: cr.PhysicalResourceId.of('ActiveRuleSet'),
      },
      onDelete: {
        service: 'SES',
        action: 'setActiveReceiptRuleSet',
        parameters: {},
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
    })

    new CfnOutput(this, 'ReceiveDomain', { value: receiveDomain })
  }
}
