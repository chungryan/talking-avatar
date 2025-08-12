# Talking Avatar (AWS) – React + Go + CloudFormation

End-to-end demo:
- React + TypeScript SPA (Vite) hosted on S3 + CloudFront
- Go Lambda behind API Gateway (HTTP API) that returns text + Polly audio + viseme marks
- Simple canvas-based mouth animation in the browser
- One-click-ish deploy via CloudFormation (infra) + scripts (build, upload, deploy)

## Prereqs
- Node 18+
- Go 1.22+
- AWS CLI v2 configured for your account
- Polly access in your region (default: ap-southeast-2)

## Quick start
```bash
# 1) Build backend and upload code artifact to S3
export ARTIFACT_BUCKET=<an-existing-artifacts-bucket>
./scripts/build_backend.sh $ARTIFACT_BUCKET

# 2) Deploy infrastructure (creates API, Lambda, S3, CloudFront, etc.)
aws cloudformation deploy \
  --template-file infra/template.yaml \
  --stack-name talking-avatar \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    ProjectName=talking-avatar \
    ArtifactBucket=$ARTIFACT_BUCKET \
    LambdaArtifactKey=backend/lambda.zip \
    PollyVoice=Joanna \
    AwsRegion=ap-southeast-2

# 3) Get outputs
aws cloudformation describe-stacks --stack-name talking-avatar \
  --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output table
# Note APIBaseUrl and CloudFrontDomainName

# 4) Configure frontend to point at API
cd frontend
cp .env.sample .env
# edit .env to set VITE_API_BASE=https://<api-id>.execute-api.<region>.amazonaws.com

# 5) Build frontend and upload to the created S3 website bucket
npm ci && npm run build
aws s3 sync dist s3://$(aws cloudformation describe-stacks --stack-name talking-avatar \
  --query 'Stacks[0].Outputs[?OutputKey==`WebsiteBucket`].OutputValue' --output text)/ --delete

# 6) Invalidate CloudFront cache (first deploy only needed if index caching)
aws cloudformation describe-stacks --stack-name talking-avatar \
  --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontDistributionId`].OutputValue' --output text \
  | xargs -I {} aws cloudfront create-invalidation --distribution-id {} --paths '/*'
```

## Local dev
```bash
# Backend local test (Lambda-style unit run not included). Build only:
./scripts/build_backend.sh local-artifacts-bucket (skips upload)

# Frontend
cd frontend && npm i && npm run dev
```

## Notes
- The Lambda artifact upload uses an *existing* S3 bucket you control for artifacts (not created by the stack). Pass its name to the script.
- The stack outputs `APIBaseUrl`, `WebsiteBucket`, and `CloudFrontDomainName`.
- To redeploy new Lambda code: rerun step 1 with same key, then run `aws cloudformation deploy` again (no changes to template required).
