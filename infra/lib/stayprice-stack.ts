import { Stack, RemovalPolicy, CfnOutput, Duration } from 'aws-cdk-lib'
import type { StackProps } from 'aws-cdk-lib'
import type { Construct } from 'constructs'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2'
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
import * as events from 'aws-cdk-lib/aws-events'
import * as targets from 'aws-cdk-lib/aws-events-targets'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets'
import type * as acm from 'aws-cdk-lib/aws-certificatemanager'
import * as path from 'node:path'

interface StayPriceStackProps extends StackProps {
  /** 커스텀 도메인 (예: stayprice.com). certificate와 함께 지정 */
  domainName?: string
  /** us-east-1의 CloudFront용 ACM 인증서 */
  certificate?: acm.Certificate
}

export class StayPriceStack extends Stack {
  readonly table: dynamodb.Table

  constructor(scope: Construct, id: string, props?: StayPriceStackProps) {
    super(scope, id, props)
    const { domainName, certificate } = props ?? {}

    // ── 데이터: DynamoDB 단일 테이블 (pk=USER#<sub>, sk=LISTINGS|OVERRIDES|BOOKINGS)
    const table = (this.table = new dynamodb.Table(this, 'Table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY, // MVP: 스택 삭제 시 데이터도 삭제
    }))

    // ── 인증: Cognito (이메일 회원가입/로그인)
    const userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: { minLength: 8, requireDigits: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.DESTROY,
    })
    const userPoolClient = userPool.addClient('WebClient', {
      authFlows: { userSrp: true },
      preventUserExistenceErrors: true,
    })

    // ── API: Lambda + HTTP API (Cognito JWT 인증)
    const apiFn = new NodejsFunction(this, 'ApiFn', {
      entry: path.join(__dirname, '../lambda/api.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: { TABLE_NAME: table.tableName },
    })
    table.grantReadWriteData(apiFn)

    const authorizer = new HttpJwtAuthorizer(
      'JwtAuth',
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      { jwtAudience: [userPoolClient.userPoolClientId] },
    )

    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      corsPreflight: {
        allowOrigins: ['*'],
        allowHeaders: ['Authorization', 'Content-Type'],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
      },
    })
    httpApi.addRoutes({
      path: '/api/{proxy+}',
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.PUT, apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration('ApiIntegration', apiFn),
      authorizer,
    })
    // 게스트 설문 등 공개 엔드포인트 — 무작위 토큰이 인증 역할 (JWT 없음)
    httpApi.addRoutes({
      path: '/public/{proxy+}',
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration('PublicIntegration', apiFn),
    })

    // ── iCal 자동 동기화: 6시간마다 전체 사용자 예약 갱신
    const syncFn = new NodejsFunction(this, 'SyncFn', {
      entry: path.join(__dirname, '../lambda/sync.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.minutes(5),
      memorySize: 256,
      environment: { TABLE_NAME: table.tableName },
    })
    table.grantReadWriteData(syncFn)
    new events.Rule(this, 'SyncSchedule', {
      schedule: events.Schedule.rate(Duration.hours(6)),
      targets: [new targets.LambdaFunction(syncFn)],
    })

    // ── 프론트엔드 호스팅: S3(비공개) + CloudFront
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    })
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
      ...(domainName && certificate
        ? { domainNames: [domainName, `www.${domainName}`], certificate }
        : {}),
    })

    // 커스텀 도메인: Route 53 A/AAAA 레코드 → CloudFront (apex + www)
    if (domainName && certificate) {
      const zone = route53.HostedZone.fromLookup(this, 'Zone', { domainName })
      const target = route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(distribution),
      )
      new route53.ARecord(this, 'ApexA', { zone, target })
      new route53.AaaaRecord(this, 'ApexAaaa', { zone, target })
      new route53.ARecord(this, 'WwwA', { zone, recordName: 'www', target })
      new route53.AaaaRecord(this, 'WwwAaaa', { zone, recordName: 'www', target })
      new CfnOutput(this, 'CustomDomainUrl', { value: `https://${domainName}` })
    }

    // 빌드된 SPA + 런타임 설정(config.json) 업로드
    new s3deploy.BucketDeployment(this, 'DeploySite', {
      destinationBucket: siteBucket,
      distribution, // 배포 시 CloudFront 캐시 무효화
      sources: [
        s3deploy.Source.asset(path.join(__dirname, '../../dist')),
        s3deploy.Source.jsonData('config.json', {
          apiUrl: httpApi.apiEndpoint,
          region: this.region,
          userPoolId: userPool.userPoolId,
          userPoolClientId: userPoolClient.userPoolClientId,
          // 도메인이 있으면 정산 메일 수신 주소 도메인도 함께 노출
          ...(domainName ? { emailDomain: `in.${domainName}` } : {}),
        }),
      ],
    })

    new CfnOutput(this, 'SiteUrl', { value: `https://${distribution.distributionDomainName}` })
    new CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint })
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId })
    new CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId })
  }
}
