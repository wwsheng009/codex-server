SHELL := /usr/bin/env bash

FRONTEND_PACKAGE_MANAGER ?= npm
GO_BUILD_TAGS ?= embed_frontend
OUTPUT_PATH ?= ./backend/bin/codex-server-embedded
EMBEDDED_API_TEST_PATTERN ?= Test(ConfigAndSearchRoutesValidateRequestBody|EmbeddedRouter.*)

.PHONY: embedded-build embedded-build-from-dist embedded-validate embedded-build-check

embedded-build:
	PACKAGE_MANAGER=$(FRONTEND_PACKAGE_MANAGER) GO_BUILD_TAGS=$(GO_BUILD_TAGS) OUTPUT_PATH=$(OUTPUT_PATH) bash ./scripts/build-embedded-backend.sh

embedded-build-from-dist:
	SKIP_FRONTEND_BUILD=1 PACKAGE_MANAGER=$(FRONTEND_PACKAGE_MANAGER) GO_BUILD_TAGS=$(GO_BUILD_TAGS) OUTPUT_PATH=$(OUTPUT_PATH) bash ./scripts/build-embedded-backend.sh

embedded-validate:
	cd backend && go test -count=1 ./internal/servercmd ./internal/webui
	cd backend && go test -count=1 ./internal/api -run 'TestConfigAndSearchRoutesValidateRequestBody'
	cd backend && go test -count=1 -tags $(GO_BUILD_TAGS) ./internal/servercmd ./internal/webui
	cd backend && go test -count=1 -tags $(GO_BUILD_TAGS) ./internal/api -run '$(EMBEDDED_API_TEST_PATTERN)'

embedded-build-check:
	cd frontend && $(FRONTEND_PACKAGE_MANAGER) run i18n:check
	bash -n ./scripts/build-embedded-backend.sh
	$(MAKE) embedded-build
	$(MAKE) embedded-validate
