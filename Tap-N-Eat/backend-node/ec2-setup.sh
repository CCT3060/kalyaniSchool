#!/bin/bash
# =============================================================
# EC2 Setup Script for Tap-N-Eat Backend
# Run this on a fresh Ubuntu 22.04 EC2 instance as: bash ec2-setup.sh
# =============================================================

set -e

echo "==> Updating system packages..."
sudo apt-get update -y
sudo apt-get upgrade -y

# ── 1. Install Node.js 18 ────────────────────────────────────
echo "==> Installing Node.js 18..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "Node version: $(node -v)"
echo "NPM version:  $(npm -v)"

# ── 2. Install MySQL 8 ───────────────────────────────────────
echo "==> Installing MySQL 8..."
sudo apt-get install -y mysql-server

sudo systemctl enable mysql
sudo systemctl start mysql

# Secure MySQL - set root password and create app user
echo "==> Configuring MySQL..."
sudo mysql -e "ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'Change_This_Root_Password!';"
sudo mysql -u root -p'Change_This_Root_Password!' -e "
  CREATE DATABASE IF NOT EXISTS qsr_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  CREATE USER IF NOT EXISTS 'tapneat'@'localhost' IDENTIFIED BY 'Change_This_App_Password!';
  GRANT ALL PRIVILEGES ON qsr_system.* TO 'tapneat'@'localhost';
  FLUSH PRIVILEGES;
"

echo "MySQL configured. Database: qsr_system, User: tapneat"

# ── 3. Install PM2 (process manager) ────────────────────────
echo "==> Installing PM2..."
sudo npm install -g pm2

# ── 4. Install Nginx (reverse proxy) ────────────────────────
echo "==> Installing Nginx..."
sudo apt-get install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx

# ── 5. Create frontend web root ──────────────────────────────
echo "==> Creating frontend directory..."
sudo mkdir -p /var/www/tapneat
sudo chown -R ubuntu:ubuntu /var/www/tapneat

# ── 6. Open firewall ports ───────────────────────────────────
echo "==> Configuring UFW firewall..."
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw allow 5000/tcp   # Node backend direct (optional, Nginx proxies this)
sudo ufw --force enable

echo ""
echo "============================================================"
echo " EC2 Setup COMPLETE!"
echo " Next steps:"
echo ""
echo " BACKEND:"
echo "   1. Upload backend-node/ to /home/ubuntu/tapneat"
echo "      scp -i key.pem -r backend-node ubuntu@EC2_IP:/home/ubuntu/tapneat"
echo "   2. cd /home/ubuntu/tapneat && npm install --omit=dev"
echo "   3. Copy and fill in: cp .env.production .env && nano .env"
echo "   4. pm2 start ecosystem.config.json && pm2 save && pm2 startup"
echo ""
echo " FRONTEND:"
echo "   5. On your local machine: npm run build  (sets VITE_API_BASE_URL=/api)"
echo "   6. Upload dist/ contents to /var/www/tapneat on EC2:"
echo "      scp -i key.pem -r dist/* ubuntu@EC2_IP:/var/www/tapneat/"
echo ""
echo " NGINX:"
echo "   7. sudo cp tapneat.nginx.conf /etc/nginx/sites-available/tapneat"
echo "   8. Edit and set server_name: sudo nano /etc/nginx/sites-available/tapneat"
echo "   9. sudo ln -s /etc/nginx/sites-available/tapneat /etc/nginx/sites-enabled/"
echo "      sudo rm -f /etc/nginx/sites-enabled/default"
echo "  10. sudo nginx -t && sudo systemctl reload nginx"
echo ""
echo " DATABASE:"
echo "  11. mysql -u tapneat -p qsr_system < database.sql"
echo ""
echo " Your site will be live at: http://YOUR_EC2_IP"
echo "============================================================"
