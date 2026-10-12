package testutil

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/publira/publira/server/internal/dbmigrate"
)

// searchEngineStartAttempts is how many times a search engine's container is
// started before the test that asked for it fails: one reset connection while
// the image is pulled or built fails the first attempt and not the test.
const searchEngineStartAttempts = 2

// searchEngineStartTimeout bounds one attempt. The first start on a machine
// that has never built the image includes that build, plugin downloads and
// all, before the node's own startup.
const searchEngineStartTimeout = 5 * time.Minute

// searchEngine is one engine's container, as StartOpenSearch and
// StartElasticsearch ask for it.
type searchEngine struct {
	// name names the engine in errors, and the directory under infra/docker
	// whose Dockerfile builds its image with the analysis plugins installed.
	name string
	// imageEnv is the variable naming an image already built from that
	// Dockerfile, which is used as it is instead of building one here.
	imageEnv string
	env      map[string]string
}

// start starts the engine's container and returns it with the node's address,
// starting it a second time when the first attempt fails.
func (e searchEngine) start() (testcontainers.Container, string, error) {
	var errs []error
	for range searchEngineStartAttempts {
		container, url, err := e.startOnce()
		if err == nil {
			return container, url, nil
		}
		if isDockerUnavailable(err) {
			return nil, "", err
		}
		errs = append(errs, err)
	}
	return nil, "", errors.Join(errs...)
}

func (e searchEngine) startOnce() (testcontainers.Container, string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), searchEngineStartTimeout)
	defer cancel()

	req := testcontainers.ContainerRequest{
		ExposedPorts: []string{"9200/tcp"},
		Env:          e.env,
		WaitingFor:   wait.ForHTTP("/").WithPort("9200/tcp").WithStartupTimeout(4 * time.Minute),
	}
	if image := strings.TrimSpace(os.Getenv(e.imageEnv)); image != "" {
		req.Image = image
	} else {
		dir, err := e.dockerfileDir()
		if err != nil {
			return nil, "", err
		}
		// A fixed name and a kept image let Docker's build cache answer every
		// later build, so the plugins are downloaded on the first one alone.
		req.FromDockerfile = testcontainers.FromDockerfile{
			Context:   dir,
			Repo:      "publira/" + e.name,
			Tag:       "test",
			KeepImage: true,
		}
	}

	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: req,
		Started:          true,
	})
	if err != nil {
		_ = testcontainers.TerminateContainer(container)
		return nil, "", fmt.Errorf("start %s container: %w", e.name, err)
	}

	host, err := container.Host(ctx)
	if err != nil {
		_ = testcontainers.TerminateContainer(container)
		return nil, "", fmt.Errorf("%s host: %w", e.name, err)
	}

	port, err := container.MappedPort(ctx, "9200/tcp")
	if err != nil {
		_ = testcontainers.TerminateContainer(container)
		return nil, "", fmt.Errorf("%s mapped port: %w", e.name, err)
	}

	return container, fmt.Sprintf("http://%s:%s", host, port.Port()), nil
}

// dockerfileDir returns infra/docker/<name> of the checkout the test runs in,
// found from db/migrations beside it.
func (e searchEngine) dockerfileDir() (string, error) {
	migrations, err := dbmigrate.RepoDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(filepath.Dir(migrations)), "infra", "docker", e.name), nil
}
