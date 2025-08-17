// go.mod should stay on go1.20; use aws-sdk-go v1.x per your constraints.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"os"
	"path"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/credentials/stscreds"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/polly"
	"github.com/aws/aws-sdk-go/service/s3"
	"github.com/chungryan/talking-avatar/backend/pkg/helpers"
)

var (
	sess      *session.Session
	pollySvc  *polly.Polly
	s3Svc     *s3.S3
	bucket    = os.Getenv("ASSETS_BUCKET") // set in CFN env for your API
	voiceID   = os.Getenv("POLLY_VOICE")   // e.g. "Joanna"
	urlExpiry = 15 * time.Minute
)

type chatReq struct {
	UserText string `json:"userText"`
}

type chatResp struct {
	ReplyText string `json:"replyText"`
	AudioKey  string `json:"audioKey"`
	AudioURL  string `json:"audioUrl"` // presigned for playback
	// Optional: include visemes if you still use them elsewhere
}

func init() {
	sess = session.Must(session.NewSession(&aws.Config{}))
	// assume role if needed:
	_ = stscreds.NewCredentials(sess, "")
	pollySvc = polly.New(sess)
	s3Svc = s3.New(sess)
	rand.Seed(time.Now().UnixNano())
}

func synthToPCM16k(text string) ([]byte, error) {
	// PCM bytes (no container)
	out, err := pollySvc.SynthesizeSpeech(&polly.SynthesizeSpeechInput{
		OutputFormat: aws.String("pcm"),
		SampleRate:   aws.String("16000"),
		Text:         aws.String(text),
		VoiceId:      aws.String(voiceID),
		Engine:       aws.String("neural"), // or standard if voice unsupported
	})
	if err != nil {
		return nil, err
	}
	defer out.AudioStream.Close()
	var buf bytes.Buffer
	_, err = buf.ReadFrom(out.AudioStream)
	return buf.Bytes(), err
}

func wavWrapPCM16mono16k(pcm []byte) []byte {
	// Minimal WAV header for PCM 16k mono 16-bit
	byteRate := uint32(16000 * 2)
	blockAlign := uint16(2)
	dataLen := uint32(len(pcm))
	riffLen := 36 + dataLen

	var h bytes.Buffer
	// RIFF
	h.WriteString("RIFF")
	writeU32(&h, riffLen)
	h.WriteString("WAVE")
	// fmt chunk
	h.WriteString("fmt ")
	writeU32(&h, 16)         // PCM header size
	writeU16(&h, 1)          // PCM format
	writeU16(&h, 1)          // mono
	writeU32(&h, 16000)      // sample rate
	writeU32(&h, byteRate)   // byte rate
	writeU16(&h, blockAlign) // block align
	writeU16(&h, 16)         // bits per sample
	// data chunk
	h.WriteString("data")
	writeU32(&h, dataLen)
	h.Write(pcm)
	return h.Bytes()
}

func writeU16(b *bytes.Buffer, v uint16) { b.Write([]byte{byte(v), byte(v >> 8)}) }
func writeU32(b *bytes.Buffer, v uint32) {
	b.Write([]byte{byte(v), byte(v >> 8), byte(v >> 16), byte(v >> 24)})
}

func handle(req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	var in chatReq
	if err := json.Unmarshal([]byte(req.Body), &in); err != nil {
		return helpers.Nok(400, "bad json")
	}
	reply := generateReply(in.UserText) // your logic / LLM
	pcm, err := synthToPCM16k(reply)
	if err != nil {
		log.Println("polly synth err:", err)
		return helpers.Nok(502, "polly synth failed")
	}
	wav := wavWrapPCM16mono16k(pcm)

	// s3 key
	key := path.Join("audio", time.Now().Format("20060102-150405"),
		fmt.Sprintf("%08x.wav", rand.Uint32()))

	_, err = s3Svc.PutObject(&s3.PutObjectInput{
		Bucket:               aws.String(bucket),
		Key:                  aws.String(key),
		Body:                 bytes.NewReader(wav),
		ContentType:          aws.String("audio/wav"),
		ContentDisposition:   aws.String("inline"),
		ServerSideEncryption: aws.String("AES256"),
	})
	if err != nil {
		log.Println("s3 put err:", err)
		return helpers.Nok(502, "s3 put failed")
	}

	// presign for browser playback
	reqGet, _ := s3Svc.GetObjectRequest(&s3.GetObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	})
	urlStr, _ := reqGet.Presign(urlExpiry)

	out := chatResp{
		ReplyText: reply,
		AudioKey:  key,
		AudioURL:  urlStr,
	}
	b, _ := json.Marshal(out)
	return helpers.OkString(string(b))
}

func generateReply(user string) string {
	// minimal stub; replace w/ LLM
	return "Sure! " + user
}

func main() { lambda.Start(handle) }
