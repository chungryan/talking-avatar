package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/chungryan/talking-avatar/backend/pkg/helpers"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/session"
	polly "github.com/aws/aws-sdk-go/service/polly"
)

type chatRequest struct {
	UserText string `json:"userText"`
}

type visemeMark struct {
	TimeMS int64  `json:"timeMs"`
	Type   string `json:"type"`
}

type chatResponse struct {
	ReplyText   string       `json:"replyText"`
	AudioBase64 string       `json:"audioBase64"`
	Visemes     []visemeMark `json:"visemes"`
}

var pollyClient *polly.Polly
var voiceID = os.Getenv("POLLY_VOICE")

func main() {
	// Use default credential chain / region from env or rolego mod tidy
	sess := session.Must(session.NewSession(&aws.Config{}))
	pollyClient = polly.New(sess)
	if voiceID == "" {
		voiceID = "Joanna"
	}
	lambda.Start(handler)
}

func handler(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	var cr chatRequest
	if err := json.Unmarshal([]byte(req.Body), &cr); err != nil {
		return helpers.Nok(400, "bad json")
	}

	reply := generateReplyTextStub(cr.UserText)

	audioB64, marks, err := synthesizeWithPolly(ctx, reply)
	if err != nil {
		return helpers.Nok(500, err.Error())
	}

	return helpers.Ok(chatResponse{ReplyText: reply, AudioBase64: audioB64, Visemes: marks})
}

func generateReplyTextStub(user string) string {
	if user == "" {
		return "Hello! What would you like to talk about?"
	}
	return fmt.Sprintf("You said: %s. Here's a friendly response from your avatar!", user)
}

func synthesizeWithPolly(ctx context.Context, text string) (string, []visemeMark, error) {
	// Audio (mp3)
	audioOut, err := pollyClient.SynthesizeSpeechWithContext(ctx, &polly.SynthesizeSpeechInput{
		Text:         aws.String(text),
		OutputFormat: aws.String("mp3"),
		VoiceId:      aws.String(voiceID),
	})
	if err != nil {
		return "", nil, err
	}
	defer audioOut.AudioStream.Close()
	audioBytes, _ := io.ReadAll(audioOut.AudioStream)
	audioB64 := base64.StdEncoding.EncodeToString(audioBytes)

	// Speech marks (viseme)
	marksOut, err := pollyClient.SynthesizeSpeechWithContext(ctx, &polly.SynthesizeSpeechInput{
		Text:            aws.String(text),
		OutputFormat:    aws.String("json"),
		SpeechMarkTypes: []*string{aws.String("viseme")},
		VoiceId:         aws.String(voiceID),
	})
	if err != nil {
		return "", nil, err
	}
	defer marksOut.AudioStream.Close()

	dec := json.NewDecoder(marksOut.AudioStream)
	var visemes []visemeMark
	for dec.More() {
		var line map[string]any
		if err := dec.Decode(&line); err != nil {
			break
		}
		if t, _ := line["type"].(string); t != "viseme" {
			continue
		}
		v, _ := line["value"].(string)
		var tms int64
		switch tv := line["time"].(type) {
		case float64:
			tms = int64(tv)
		case int64:
			tms = tv
		}
		visemes = append(visemes, visemeMark{TimeMS: tms, Type: v})
	}
	if len(visemes) == 0 {
		return "", nil, errors.New("no visemes from Polly")
	}

	return audioB64, visemes, nil
}
