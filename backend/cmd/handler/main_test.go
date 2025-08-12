package main

import (
	"context"
	"errors"
	"io"
	"testing"

	"github.com/aws/aws-lambda-go/events"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

type mockPollyClient struct {
	mock.Mock
}

func (m *mockPollyClient) SynthesizeSpeechWithContext(ctx context.Context, input interface{}) (audioStream io.ReadCloser, err error) {
	args := m.Called(ctx, input)
	return args.Get(0).(io.ReadCloser), args.Error(1)
}

// ...existing code...

func TestGenerateReplyTextStub(t *testing.T) {
	assert := assert.New(t)
	assert.Equal("Hello! What would you like to talk about?", generateReplyTextStub(""))
	assert.Contains(generateReplyTextStub("hi"), "You said: hi")
}

func TestOkResponse(t *testing.T) {
	resp, err := ok(map[string]string{"foo": "bar"})
	assert := assert.New(t)
	assert.NoError(err)
	assert.Equal(200, resp.StatusCode)
	assert.Contains(resp.Body, "foo")
	assert.Equal("application/json", resp.Headers["Content-Type"])
}

func TestClientErr(t *testing.T) {
	resp, err := clientErr(400, "bad request")
	assert := assert.New(t)
	assert.NoError(err)
	assert.Equal(400, resp.StatusCode)
	assert.Equal("bad request", resp.Body)
}

func TestServerErr(t *testing.T) {
	errMsg := errors.New("fail")
	resp, err := serverErr(errMsg)
	assert := assert.New(t)
	assert.NoError(err)
	assert.Equal(500, resp.StatusCode)
	assert.Equal("fail", resp.Body)
}

func TestHandler_Health(t *testing.T) {
	req := events.APIGatewayV2HTTPRequest{RawPath: "/health"}
	resp, err := handler(context.Background(), req)
	assert := assert.New(t)
	assert.NoError(err)
	assert.Equal(200, resp.StatusCode)
	assert.Contains(resp.Body, "ok")
}

func TestHandler_NotFound(t *testing.T) {
	req := events.APIGatewayV2HTTPRequest{RawPath: "/doesnotexist"}
	resp, err := handler(context.Background(), req)
	assert := assert.New(t)
	assert.NoError(err)
	assert.Equal(404, resp.StatusCode)
}

func TestHandler_Chat_BadMethod(t *testing.T) {
	req := events.APIGatewayV2HTTPRequest{RawPath: "/chat", RequestContext: events.APIGatewayV2HTTPRequestContext{HTTP: events.APIGatewayV2HTTPRequestContextHTTPDescription{Method: "GET"}}}
	resp, err := handler(context.Background(), req)
	assert := assert.New(t)
	assert.NoError(err)
	assert.Equal(405, resp.StatusCode)
}

func TestHandler_Chat_BadJSON(t *testing.T) {
	req := events.APIGatewayV2HTTPRequest{RawPath: "/chat", RequestContext: events.APIGatewayV2HTTPRequestContext{HTTP: events.APIGatewayV2HTTPRequestContextHTTPDescription{Method: "POST"}}, Body: "notjson"}
	resp, err := handler(context.Background(), req)
	assert := assert.New(t)
	assert.NoError(err)
	assert.Equal(400, resp.StatusCode)
}
