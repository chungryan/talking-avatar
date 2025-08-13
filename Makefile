PROJECT_NAME=talking-avatar
ARTIFACT_BUCKET=chungrya-artifacts

.PHONY: clean build

BUILD_CMD = "GOOS=linux GOARCH=amd64 go build -o"

clean:
	mkdir -p ./backend/build
	rm -rf ./backend/build/*
	cp ./backend/bootstrap ./backend/build/
	chmod +x backend/build/bootstrap

test:
	cd ./backend && go test -coverprofile c.out ./...

cover: test
	cd ./backend && go tool cover -html=c.out

build: clean
	cd ./backend && for cmd in `ls ./cmd/`; do eval "${BUILD_CMD} build/$$cmd ./cmd/$$cmd/*.go"; done

# Deployment and build tasks
package: build
	aws cloudformation package \
		--template-file stack.yml \
		--output-template-file packaged.yml \
		--s3-bucket ${ARTIFACT_BUCKET} \
		--s3-prefix ${PROJECT_NAME}

deploy: package
	aws cloudformation deploy \
		--region ap-southeast-2 \
		--template-file packaged.yml \
		--stack-name ${PROJECT_NAME} \
		--capabilities CAPABILITY_IAM \
		--parameter-overrides \
			ProjectName=${PROJECT_NAME} \
			PollyVoice=Joanna

publish: clean build package deploy

