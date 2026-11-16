@echo off
rem Deploys the latest main branch to the VPS. Run from the project folder: scripts\deploy.cmd
rem You will be asked for the VPS password (or your SSH key is used if one is set up).
ssh -t root@72.62.249.186 "cd /var/www/Speed-Optimization-App && git pull && npm install && npm run setup && npm run build && set -a && . ./.env && set +a && pm2 restart speed-optimizer --update-env && pm2 list"
