# =============================================================
# Tap-N-Eat — EC2 Deploy Script (run from Windows PowerShell)
# Usage: .\deploy-ec2.ps1 -KeyPath "C:\path\to\your-key.pem"
# =============================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$KeyPath
)

$EC2_IP  = "13.60.223.109"
$EC2_USER = "ubuntu"
$BACKEND_SRC = "$PSScriptRoot\backend-node"
$DIST_SRC    = "$PSScriptRoot\dist"

# Fix key permissions (required by OpenSSH on Windows)
icacls $KeyPath /inheritance:r /grant:r "${env:USERNAME}:(R)"

Write-Host "`n==> Uploading dist (frontend build) to /var/www/tapneat/ ..."
scp -i $KeyPath -o StrictHostKeyChecking=no -r "${DIST_SRC}\*" "${EC2_USER}@${EC2_IP}:/var/www/tapneat/"

Write-Host "`n==> Uploading backend-node to /home/ubuntu/tapneat/ ..."
scp -i $KeyPath -o StrictHostKeyChecking=no -r $BACKEND_SRC "${EC2_USER}@${EC2_IP}:/home/ubuntu/"

Write-Host "`n==> Running remote setup commands on EC2 ..."
ssh -i $KeyPath -o StrictHostKeyChecking=no "${EC2_USER}@${EC2_IP}" @'
set -e

echo "--- Installing backend npm dependencies ---"
cd /home/ubuntu/backend-node
npm install --omit=dev

echo "--- Restarting PM2 backend process ---"
pm2 restart tapneat-api 2>/dev/null || pm2 start ecosystem.config.json --name tapneat-api
pm2 save

echo "--- Applying nginx config ---"
sudo cp tapneat.nginx.conf /etc/nginx/sites-available/tapneat
sudo ln -sf /etc/nginx/sites-available/tapneat /etc/nginx/sites-enabled/tapneat
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

echo "--- Checking PM2 status ---"
pm2 status

echo "--- Testing /api/health endpoint ---"
curl -sf http://localhost:5000/api/health || echo "WARNING: health check failed — check PM2 logs with: pm2 logs tapneat-api"

echo ""
echo "============================================================"
echo " Deployment complete!  Site: http://13.60.223.109"
echo "============================================================"
'@
