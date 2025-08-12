#!/usr/bin/env bash
set -euo pipefail
ARTIFACT_BUCKET=${1:-}
KEY=backend/lambda.zip
ROOT=$(cd "$(dirname "$0")/.." && pwd)

cd "$ROOT/backend"
GOOS=linux GOARCH=amd64 go build -o bootstrap ./cmd/handler
zip -9 lambda.zip bootstrap
rm -f bootstrap

if [ -n "$ARTIFACT_BUCKET" ] && [ "$ARTIFACT_BUCKET" != "local-artifacts-bucket" ]; then
  aws s3 cp lambda.zip s3://$ARTIFACT_BUCKET/$KEY
  echo "Uploaded: s3://$ARTIFACT_BUCKET/$KEY"
else
  echo "Built backend/lambda.zip (local)."
fi
