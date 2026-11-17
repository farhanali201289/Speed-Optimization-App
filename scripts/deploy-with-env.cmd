@echo off
rem Copies SHOPIFY_API_KEY and SHOPIFY_API_SECRET from your local .env to the VPS .env,
rem then deploys. Run from the project folder: scripts\deploy-with-env.cmd
findstr /B /C:"SHOPIFY_API_KEY=" /C:"SHOPIFY_API_SECRET=" .env | ssh root@72.62.249.186 "cd /var/www/Speed-Optimization-App && git pull && bash scripts/sync-env.sh && bash scripts/vps-deploy.sh"
