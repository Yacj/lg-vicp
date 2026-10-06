#!/bin/bash
set -euo pipefail
echo '=== network to registries ==='
curl -sI --max-time 8 https://registry-1.docker.io/v2/ | head -3 || echo 'dockerhub fail'
curl -sI --max-time 8 https://docker.m.daocloud.io/v2/ | head -3 || echo 'daocloud fail'
curl -sI --max-time 8 https://mirror.ccs.tencentyun.com/v2/ | head -5 || echo 'tencent fail'

# configure temporary mirror for this daemon if possible
mkdir -p /etc/docker
if [ -f /etc/docker/daemon.json ]; then
  cp /etc/docker/daemon.json /etc/docker/daemon.json.bak.oo-poc || true
  cat /etc/docker/daemon.json
else
  echo '{}'
fi

cat > /etc/docker/daemon.json <<'JSON'
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://docker.1ms.run"
  ]
}
JSON
systemctl restart docker
sleep 3
echo '=== pull via mirror ==='
docker pull onlyoffice/documentbuilder:latest
docker images onlyoffice/documentbuilder
