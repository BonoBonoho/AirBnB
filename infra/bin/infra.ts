import { App } from 'aws-cdk-lib'
import { StayPriceStack } from '../lib/stayprice-stack'

const app = new App()
new StayPriceStack(app, 'StayPrice', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? 'ap-northeast-2',
  },
})
