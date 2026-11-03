#!/usr/bin/env bash
set -euo pipefail
: "${EVENT_INGEST_TOKEN:?Set EVENT_INGEST_TOKEN first}"
: "${EVENT_SERVER_URL:=http://localhost:8787}"
curl -sS -X POST "$EVENT_SERVER_URL/api/events" \
  -H "Authorization: Bearer $EVENT_INGEST_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"type":"chat","username":"DemoViewer","message":"Старт"}'
