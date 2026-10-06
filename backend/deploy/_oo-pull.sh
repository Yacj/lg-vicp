#!/bin/bash
set -euo pipefail
echo '=== mem/disk before ==='
free -h
df -h / | tail -1

echo '=== prune dangling images (keep named) ==='
docker image prune -f
df -h / | tail -1

echo '=== pull documentbuilder ==='
# Prefer documentbuilder for one-shot convert; fall back notes if pull fails
docker pull onlyoffice/documentbuilder:latest

echo '=== mem after pull ==='
free -h
df -h / | tail -1
docker images onlyoffice/documentbuilder
