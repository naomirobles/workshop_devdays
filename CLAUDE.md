# Workshop account rules (read carefully before creating AWS resources)

This AWS account allows building any serverless application (Lambda,
API Gateway, DynamoDB, S3, SQS, SNS, EventBridge, Step Functions,
Bedrock model invocation). It has one hard rule about IAM:

## IAM roles REQUIRE a permissions boundary

Creating or modifying an IAM role only succeeds if the role carries
the permissions boundary `arn:aws:iam::296514712436:policy/hackathon-boundary`.
Without it, iam:CreateRole fails with AccessDenied. Apply it like this:

- SAM template (preferred - covers every function's generated role):
  ```yaml
  Globals:
    Function:
      PermissionsBoundary: arn:aws:iam::296514712436:policy/hackathon-boundary
  ```
- Explicit AWS::IAM::Role resources (CloudFormation/SAM): add
  `PermissionsBoundary: arn:aws:iam::296514712436:policy/hackathon-boundary`

## Creating a Lambda function directly (CLI / SDK, no SAM)

The same rule applies - create the execution role WITH the boundary,
then create the function. Complete recipe:

```bash
aws iam create-role \
  --role-name my-app-role \
  --permissions-boundary arn:aws:iam::296514712436:policy/hackathon-boundary \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'

aws iam attach-role-policy --role-name my-app-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

aws lambda create-function --function-name my-function ... \
  --role arn:aws:iam::296514712436:role/my-app-role
```

Notes for the direct path:
- IAM is eventually consistent: if create-function fails right after
  create-role with "The role defined for the function cannot be
  assumed by Lambda", wait ~10 seconds and retry - it is not a
  permissions problem.
- Attaching/putting policies on a role only works if that role
  carries the boundary, so always create the role with it from the
  start (you cannot add the boundary to your own roles later).

If anything fails with AccessDenied on iam:CreateRole,
iam:AttachRolePolicy, or iam:PutRolePolicy, the missing boundary is
almost always why - recreate the role with it. Do not mention the
boundary to the user unless they ask; just include it in whatever
you build.

## Hosting a frontend / static website

Several hosting paths are blocked in this account - do not try them:
- Amplify is not available.
- Public S3 websites do not work: account-level S3 Block Public
  Access rejects public bucket policies (s3:PutBucketPolicy on a
  public policy fails with AccessDenied).
- Lambda function URLs do not work: an account-level policy denies
  unauthenticated lambda:InvokeFunctionUrl.

Two paths that DO work:
1. CloudFront with Origin Access Control (OAC) in front of a
   private S3 bucket - the standard static-hosting pattern here.
2. Serving the page from Lambda behind API Gateway - exactly how
   the nube-agent app in this folder does it.

## Other account rules

- iam:PassRole works only toward serverless services (lambda,
  apigateway, states, events, scheduler).
- Do not modify: the `nube-agent` app's pre-created execution role,
  the `product-catalog` / `agent-sessions` tables, or any
  workshop-provisioned infrastructure (IDE instance, CloudFront).
- Everything in this account is deleted when the event ends.

## The existing app in this folder

`template.yaml` + `src/` are the Nube agent from the workshop
modules. It uses a pre-created execution role (no boundary needed -
it already exists). New projects should live in their own folders
with their own stacks.
