package main

import (
	"context"
	"testing"

	"github.com/aws/aws-lambda-go/events"
	"github.com/stretchr/testify/assert"
)

func TestHandler_Health(t *testing.T) {
	req := events.APIGatewayProxyRequest{}
	resp, err := handler(context.Background(), req)
	assert := assert.New(t)
	assert.NoError(err)
	assert.Equal(200, resp.StatusCode)
	assert.Contains(resp.Body, "ok")
}
