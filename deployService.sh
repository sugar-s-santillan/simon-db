#!/usr/bin/env bash
set -euo pipefail

while getopts k:h:s: flag; do
    case "${flag}" in
        k) key=${OPTARG};;
        h) hostname=${OPTARG};;
        s) service=${OPTARG};;
    esac
done

if [[ -z "${key:-}" || -z "${hostname:-}" || -z "${service:-}" ]]; then
    echo 'Usage: deployService.sh -k <pem key file> -h <hostname> -s <service>' >&2
    exit 1
fi
[[ "$service" =~ ^[a-zA-Z0-9_-]+$ ]] || exit 1
[[ "$hostname" =~ ^[a-zA-Z0-9.-]+$ ]] || exit 1
[[ -f service/dbConfig.json ]] || { echo 'Missing service/dbConfig.json' >&2; exit 1; }

# Build locally; never modify a running service during dependency installation.
trap 'rm -rf build dist' EXIT
rm -rf build
mkdir -m 700 build
npm ci
npm run build
cp -R dist build/public
cp service/*.js build/
cp service/package.json service/package-lock.json service/dbConfig.json build/
chmod 600 build/dbConfig.json

ssh -i "$key" "ubuntu@$hostname" "mkdir -p services; stage=\$(mktemp -d services/${service}-stage.XXXXXX); printf '%s' \"\$stage\"" > build/.stage
stage=$(cat build/.stage)
[[ "$stage" =~ ^services/${service}-stage\.[a-zA-Z0-9]+$ ]] || exit 1
scp -r -i "$key" build/public build/*.js build/*.json "ubuntu@$hostname:$stage/"
ssh -i "$key" "ubuntu@$hostname" bash -s -- "$service" "$stage" <<'ENDSSH'
set -euo pipefail
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
service=$1
stage=$2
cd "$HOME/$stage"
chmod 600 dbConfig.json
npm ci --omit=dev
# A failed ping leaves the existing service untouched.
node -e 'const db=require("./database"); db.connect().then(()=>db.close()).catch(async e=>{console.error("Atlas preflight failed: "+e.name);await db.close();process.exit(1)})'
cd "$HOME"
pm2 stop "$service"
rm -rf "services/${service}-previous"
mv "services/$service" "services/${service}-previous"
mv "$stage" "services/$service"
pm2 restart "$service"
ENDSSH
