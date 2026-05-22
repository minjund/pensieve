#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
node --test \
  tests/secrets.test.js \
  tests/scope.test.js \
  tests/files.test.js \
  tests/classify.test.js \
  tests/skills.test.js \
  tests/session-indexer.test.js \
  tests/inject.test.js \
  tests/db.test.js \
  tests/integration.test.js
