package main

import (
	"context"
	"testing"

	"github.com/aws/aws-lambda-go/events"
	"github.com/stretchr/testify/assert"
)

func TestGenerateReplyTextStub(t *testing.T) {
	assert := assert.New(t)
	assert.Equal("Hello! What would you like to talk about?", generateReplyTextStub(""))
	assert.Contains(generateReplyTextStub("hi"), "You said: hi")
}

func TestHandler_Chat_BadJSON(t *testing.T) {
	req := events.APIGatewayProxyRequest{Body: "notjson"}
	resp, err := handler(context.Background(), req)
	assert := assert.New(t)
	assert.NoError(err)
	assert.Equal(400, resp.StatusCode)
}
