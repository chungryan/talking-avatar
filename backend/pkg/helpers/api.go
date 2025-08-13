package helpers

import (
	"encoding/json"

	"github.com/aws/aws-lambda-go/events"
)

func Ok(v any) (events.APIGatewayProxyResponse, error) {
	b, _ := json.Marshal(v)
	return OkString(string(b))
}

func OkString(b string) (events.APIGatewayProxyResponse, error) {
	return events.APIGatewayProxyResponse{
		StatusCode: 200,
		Headers: map[string]string{
			"Content-Type":                 "application/json",
			"Access-Control-Allow-Origin":  "*",
			"Access-Control-Allow-Headers": "Content-Type,Authorization,X-Requested-With",
			"Access-Control-Allow-Methods": "GET,POST,OPTIONS",
		},
		Body: b,
	}, nil
}

func Nok(code int, msg string) (events.APIGatewayProxyResponse, error) {
	return events.APIGatewayProxyResponse{StatusCode: code, Body: msg, Headers: map[string]string{"Access-Control-Allow-Origin": "*"}}, nil
}
