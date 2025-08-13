package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/chungryan/talking-avatar/backend/pkg/helpers"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/session"
	v4 "github.com/aws/aws-sdk-go/aws/signer/v4"
	s3 "github.com/aws/aws-sdk-go/service/s3"
)

type avatarReq struct {
	S3Key string `json:"s3Key"`           // e.g. uploads/abc.jpg
	Style string `json:"style,omitempty"` // prompt (optional)
}

type avatarResp struct {
	AvatarKey string `json:"avatarKey"` // e.g. avatars/abc.png
}

var (
	assetsBucket  = os.Getenv("ASSETS_BUCKET")
	modelID       = os.Getenv("IMAGE_MODEL_ID") // e.g. amazon.titan-image-generator-v1
	bedrockRegion = os.Getenv("BEDROCK_REGION")
	sess          *session.Session
	s3c           *s3.S3
	signer        *v4.Signer
	httpClient    = &http.Client{Timeout: 60 * time.Second}
)

func main() {
	if assetsBucket == "" {
		panic("ASSETS_BUCKET not set")
	}
	if modelID == "" {
		modelID = "amazon.titan-image-generator-v1"
	}
	sess = session.Must(session.NewSession(&aws.Config{}))
	s3c = s3.New(sess)
	signer = v4.NewSigner(sess.Config.Credentials)
	lambda.Start(handler)
}

func handler(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	var body avatarReq
	if err := json.Unmarshal([]byte(req.Body), &body); err != nil {
		return helpers.Nok(400, "bad json")
	}
	if body.S3Key == "" {
		return helpers.Nok(400, "s3Key required")
	}
	if body.Style == "" {
		body.Style = "stylized portrait, clean background"
	}

	// 1) Load source photo
	srcBytes, err := getObject(assetsBucket, body.S3Key)
	if err != nil {
		return helpers.Nok(500, err.Error())
	}

	// 2) Invoke Bedrock Runtime (Titan image variation)
	outB64, err := invokeBedrockImage(ctx, modelID, srcBytes, body.Style)
	if err != nil {
		return helpers.Nok(500, err.Error())
	}

	// 3) Save avatar to S3 (PNG)
	avatarKey := path.Join("avatars", stripExt(path.Base(body.S3Key))+".png")
	if err := putPNG(assetsBucket, avatarKey, outB64); err != nil {
		return helpers.Nok(500, err.Error())
	}

	return helpers.Ok(avatarResp{AvatarKey: avatarKey})
}

func getObject(bucket, key string) ([]byte, error) {
	obj, err := s3c.GetObject(&s3.GetObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)})
	if err != nil {
		return nil, err
	}
	defer obj.Body.Close()
	return io.ReadAll(obj.Body)
}

func putPNG(bucket, key, b64 string) error {
	buf, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return err
	}
	_, err = s3c.PutObject(&s3.PutObjectInput{
		Bucket:      aws.String(bucket),
		Key:         aws.String(key),
		Body:        bytes.NewReader(buf),
		ContentType: aws.String("image/png"),
	})
	return err
}

// --- Bedrock (SigV4, no v2 SDK) ---

func invokeBedrockImage(ctx context.Context, modelID string, src []byte, prompt string) (string, error) {
	// Titan Image Generator V1 (IMAGE_VARIATION)
	payload := map[string]any{
		"taskType": "IMAGE_VARIATION",
		"imageVariationParams": map[string]any{
			"images":             []string{base64.StdEncoding.EncodeToString(src)},
			"text":               prompt,
			"similarityStrength": 0.6,
		},
	}
	body, _ := json.Marshal(payload)

	// POST https://bedrock-runtime.{region}.amazonaws.com/model/{modelId}/invoke
	url := fmt.Sprintf("https://bedrock-runtime.%s.amazonaws.com/model/%s/invoke", bedrockRegion, modelID)
	req, _ := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	_, err := signer.Sign(req, bytes.NewReader(body), "bedrock", bedrockRegion, time.Now())
	if err != nil {
		return "", err
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("bedrock runtime %d: %s", resp.StatusCode, string(b))
	}

	// Titan returns { images: [base64, ...], ... }
	var out struct {
		Images []string `json:"images"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	if len(out.Images) == 0 {
		return "", errors.New("no images in bedrock response")
	}
	return out.Images[0], nil
}

// --- helpers ---

func stripExt(fn string) string {
	for i := len(fn) - 1; i >= 0; i-- {
		if fn[i] == '.' {
			return fn[:i]
		}
	}
	return fn
}
