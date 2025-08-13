package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path"
	"regexp"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/chungryan/talking-avatar/backend/pkg/helpers"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/session"
	s3 "github.com/aws/aws-sdk-go/service/s3"
)

type reqBody struct {
	ContentType string `json:"contentType"`       // e.g. "image/jpeg"
	FileExt     string `json:"fileExt,omitempty"` // optional, e.g. ".jpg"
	Prefix      string `json:"prefix,omitempty"`  // optional override for key prefix (default "uploads/")
}

type respBody struct {
	URL       string `json:"url"`       // presigned PUT URL
	Key       string `json:"key"`       // s3 object key (store this)
	ExpiresAt int64  `json:"expiresAt"` // epoch seconds
}

var (
	assetsBucket = os.Getenv("ASSETS_BUCKET")
	defaultPref  = "uploads/"
	allowedCTRx  = regexp.MustCompile(`^(image/|audio/|application/octet-stream|application/pdf)`)
	s3c          *s3.S3
)

func main() {
	if assetsBucket == "" {
		panic("ASSETS_BUCKET not set")
	}
	sess := session.Must(session.NewSession(&aws.Config{}))
	s3c = s3.New(sess)
	lambda.Start(handler)
}

func handler(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	// CORS preflight
	if req.HTTPMethod == http.MethodOptions {
		return helpers.Ok("")
	}
	if req.HTTPMethod != http.MethodPost {
		return helpers.Nok(405, "method not allowed")
	}

	var rb reqBody
	if err := json.Unmarshal([]byte(req.Body), &rb); err != nil {
		return helpers.Nok(400, "bad json")
	}
	if rb.ContentType == "" {
		rb.ContentType = "application/octet-stream"
	}
	if !allowedCTRx.MatchString(rb.ContentType) {
		return helpers.Nok(400, "unsupported contentType")
	}

	prefix := rb.Prefix
	if prefix == "" {
		prefix = defaultPref
	}
	if !strings.HasSuffix(prefix, "/") {
		prefix += "/"
	}

	ext := sanitizeExt(rb.FileExt)
	if ext == "" {
		ext = guessExt(rb.ContentType)
	}
	key := path.Join(prefix, time.Now().UTC().Format("20060102")+"-"+randHex(8)+ext)

	url, exp, err := presignPut(ctx, assetsBucket, key, rb.ContentType, 15*time.Minute)
	if err != nil {
		return helpers.Nok(500, err.Error())
	}
	out, _ := json.Marshal(respBody{URL: url, Key: key, ExpiresAt: exp.Unix()})
	return helpers.OkString(string(out))
}

func presignPut(ctx context.Context, bucket, key, contentType string, ttl time.Duration) (string, time.Time, error) {
	if bucket == "" || key == "" {
		return "", time.Time{}, errors.New("bucket/key required")
	}
	req, _ := s3c.PutObjectRequest(&s3.PutObjectInput{
		Bucket:      aws.String(bucket),
		Key:         aws.String(key),
		ContentType: aws.String(contentType),
		// NOTE: don't set SSE headers here; rely on bucket-default encryption.
	})
	req.SetContext(ctx)
	urlStr, err := req.Presign(ttl)
	if err != nil {
		return "", time.Time{}, err
	}
	return urlStr, time.Now().Add(ttl), nil
}

func sanitizeExt(ext string) string {
	ext = strings.TrimSpace(ext)
	if ext == "" {
		return ""
	}
	if !strings.HasPrefix(ext, ".") {
		ext = "." + ext
	}
	// allow only . and alnum
	ok := regexp.MustCompile(`^\.[A-Za-z0-9]+$`).MatchString(ext)
	if !ok {
		return ""
	}
	return ext
}

func guessExt(ct string) string {
	switch ct {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	case "audio/mpeg":
		return ".mp3"
	case "audio/wav":
		return ".wav"
	default:
		return ""
	}
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
