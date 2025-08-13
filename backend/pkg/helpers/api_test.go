package helpers

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestOkResponse(t *testing.T) {
	resp, err := Ok(map[string]string{"foo": "bar"})
	assert := assert.New(t)
	assert.NoError(err)
	assert.Equal(200, resp.StatusCode)
	assert.Contains(resp.Body, "foo")
	assert.Equal("application/json", resp.Headers["Content-Type"])
}

func TestNok(t *testing.T) {
	resp, err := Nok(400, "bad request")
	assert := assert.New(t)
	assert.NoError(err)
	assert.Equal(400, resp.StatusCode)
	assert.Equal("bad request", resp.Body)
}
