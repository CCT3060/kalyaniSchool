# AWS EC2 Deployment Guide — Tap-N-Eat
# Stack: React (Vite) + Node.js (Express) + MySQL 8 + Nginx + PM2
# OS: Ubuntu 22.04 LTS
# All commands in order — run top to bottom

---

## ARCHITECTURE OVERVIEW

```
Internet
   │
   ▼
EC2 (Ubuntu 22.04)
   ├── Nginx :80  ──► /var/www/tapneat/  (React static files)
   │              └─► proxy /api/* ──► Node.js :5000
   ├── Node.js :5000  (managed by PM2)
   └── MySQL   :3306  (local, not exposed)
```

---

## PART 0 — AWS CONSOLE SETUP (Do this first in the browser)

### 0.1 Launch an EC2 Instance
1. Go to AWS Console → EC2 → Launch Instance
2. Choose:  **Ubuntu Server 22.04 LTS (HVM), SSD Volume Type**
3. Instance type: **t2.micro** (free tier) or **t2.small** for production
4. Key pair: Create a new key pair → download `tapneat-key.pem`
5. Network settings → Edit:
   - Add inbound rule: **HTTP** — Port 80 — Source: 0.0.0.0/0
   - Add inbound rule: **HTTPS** — Port 443 — Source: 0.0.0.0/0
   - SSH (port 22) is already there — keep it
6. Storage: 20 GB gp3 (minimum)
7. Click **Launch Instance**
8. Copy the **Public IPv4 address** (e.g. 54.123.45.67) — you'll need it everywhere below

### 0.2 Allocate an Elastic IP (Recommended — keeps IP fixed on restarts)
1. EC2 → Elastic IPs → Allocate Elastic IP address → Allocate
2. Select the new EIP → Actions → Associate Elastic IP Address
3. Select your instance → Associate
4. Your fixed public IP is now permanent

---

## PART 1 — CONNECT TO EC2 FROM YOUR LOCAL WINDOWS MACHINE

```powershell
# On your Windows machine (PowerShell or terminal)

# Fix key file permissions (required or SSH refuses it)
icacls "C:\path\to\tapneat-key.pem" /inheritance:r /grant:r "%USERNAME%:(R)"

# SSH into EC2 (replace 54.123.45.67 with your EC2 public IP)
ssh -i "C:\path\to\tapneat-key.pem" ubuntu@54.123.45.67
```

---

## PART 2 — INITIAL SERVER SETUP (Run on EC2 via SSH)

### 2.1 Update System
```bash
sudo apt-get update -y
sudo apt-get upgrade -y
sudo apt-get install -y curl git unzip
```

### 2.2 Install Node.js 18
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify
node -v    # should show v18.x.x
npm -v     # should show 10.x.x
```

### 2.3 Install PM2 (Process Manager — keeps Node running)
```bash
sudo npm install -g pm2

# Verify
pm2 -v
```

### 2.4 Install MySQL 8
```bash
sudo apt-get install -y mysql-server

sudo systemctl enable mysql
sudo systemctl start mysql

# Verify MySQL is running
sudo systemctl status mysql
```

### 2.5 Install Nginx (Reverse Proxy)
```bash
sudo apt-get install -y nginx

sudo systemctl enable nginx
sudo systemctl start nginx

# Verify
sudo systemctl status nginx
```

### 2.6 Configure UFW Firewall
```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable

# Verify
sudo ufw status
```

---

## PART 3 — DATABASE SETUP (Run on EC2)

### 3.1 Secure MySQL Root & Create App Database
```bash
# Enter MySQL as root (Ubuntu installs MySQL with auth_socket — no password needed initially)
sudo mysql

# Inside MySQL shell — run all these commands:
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'YourRootPassword123!';
CREATE DATABASE IF NOT EXISTS qsr_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'tapneat'@'localhost' IDENTIFIED BY 'YourAppPassword123!';
GRANT ALL PRIVILEGES ON qsr_system.* TO 'tapneat'@'localhost';
FLUSH PRIVILEGES;
SHOW DATABASES;
EXIT;
```

### 3.2 Verify App User Can Connect
```bash
mysql -u tapneat -p'YourAppPassword123!' -e "USE qsr_system; SHOW TABLES;"
# Should show empty set (no tables yet) — this is fine
```

### 3.3 Import Existing Schema (if you have a .sql dump)
```bash
# From local machine — upload your SQL dump first (run in PowerShell, not SSH):
scp -i "C:\path\to\tapneat-key.pem" C:\path\to\schema.sql ubuntu@54.123.45.67:/home/ubuntu/

# Back in SSH — import it:
mysql -u tapneat -p'YourAppPassword123!' qsr_system < /home/ubuntu/schema.sql
```

---

## PART 4 — BACKEND DEPLOYMENT (Node.js / Express)

### 4.1 Upload Backend Files from Local Machine
```powershell
# Run in PowerShell on your LOCAL Windows machine
# Make sure you are in the project root: d:\TAP_RFID\Tap-N-Eat

# Upload the entire backend-node folder to EC2
scp -i "C:\path\to\tapneat-key.pem" -r backend-node ubuntu@54.123.45.67:/home/ubuntu/tapneat
```

### 4.2 Install Backend Dependencies (Run on EC2)
```bash
cd /home/ubuntu/tapneat
npm install --omit=dev

# Verify node_modules exists
ls node_modules | head -5
```

### 4.3 Create the .env File (Run on EC2)
```bash
cd /home/ubuntu/tapneat
nano .env
```

Paste the following content (edit values to match your setup):

```env
# Server
NODE_ENV=production
PORT=5000

# Database
DB_HOST=localhost
DB_PORT=3306
DB_USER=tapneat
DB_PASSWORD=YourAppPassword123!
DB_NAME=qsr_system

# JWT / Session Secret (use a long random string)
JWT_SECRET=replace_with_a_very_long_random_secret_string_here

# Razorpay (if used)
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret

# Frontend origin for CORS
FRONTEND_URL=http://54.123.45.67
```

Save with `Ctrl+O`, `Enter`, `Ctrl+X`

### 4.4 Start Backend with PM2
```bash
cd /home/ubuntu/tapneat

# Start using the ecosystem config
pm2 start ecosystem.config.json

# Save PM2 process list so it survives reboots
pm2 save

# Generate and enable PM2 startup script
pm2 startup
# PM2 will print a command — COPY IT AND RUN IT (it looks like below):
# sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u ubuntu --hp /home/ubuntu

# Check status
pm2 status
pm2 logs tapneat-api --lines 30
```

### 4.5 Test Backend is Running
```bash
# Should return JSON from your API
curl http://localhost:5000/api/schools
```

---

## PART 5 — FRONTEND DEPLOYMENT (React / Vite)

### 5.1 Build the Frontend on Your LOCAL Machine
```powershell
# Run in PowerShell on LOCAL Windows machine in project root
cd d:\TAP_RFID\Tap-N-Eat

# Set env variable for production API (Nginx will proxy /api/* to Node)
# Create a .env.production file:
```

Create `d:\TAP_RFID\Tap-N-Eat\.env.production`:
```env
VITE_API_BASE_URL=/api
```

Then build:
```powershell
npm run build
# This creates the dist/ folder
```

### 5.2 Create Web Root on EC2 (Run on EC2)
```bash
sudo mkdir -p /var/www/tapneat
sudo chown -R ubuntu:ubuntu /var/www/tapneat
```

### 5.3 Upload Built Files to EC2 (Run in PowerShell on LOCAL machine)
```powershell
# Upload the entire dist folder contents
scp -i "C:\path\to\tapneat-key.pem" -r dist\* ubuntu@54.123.45.67:/var/www/tapneat/

# Verify upload
ssh -i "C:\path\to\tapneat-key.pem" ubuntu@54.123.45.67 "ls /var/www/tapneat/"
# Should show: index.html  assets/
```

---

## PART 6 — NGINX CONFIGURATION (Run on EC2)

### 6.1 Copy Nginx Config
```bash
# The config file was uploaded with your backend files
sudo cp /home/ubuntu/tapneat/tapneat.nginx.conf /etc/nginx/sites-available/tapneat
```

### 6.2 Edit the Config — Replace the IP/Domain
```bash
sudo nano /etc/nginx/sites-available/tapneat
# Change this line:
#   server_name YOUR_EC2_PUBLIC_IP_OR_DOMAIN;
# To:
#   server_name 54.123.45.67;   ← your actual EC2 IP

# Save: Ctrl+O, Enter, Ctrl+X
```

### 6.3 Enable the Site
```bash
# Link to sites-enabled
sudo ln -s /etc/nginx/sites-available/tapneat /etc/nginx/sites-enabled/tapneat

# Remove default site to avoid conflicts
sudo rm -f /etc/nginx/sites-enabled/default

# Test config syntax
sudo nginx -t
# Expected: nginx: configuration file /etc/nginx/nginx.conf test is successful

# Reload Nginx
sudo systemctl reload nginx
```

### 6.4 Verify Full Stack is Working
```bash
# Test frontend (should return HTML)
curl -s http://54.123.45.67 | head -5

# Test backend via Nginx proxy (should return JSON)
curl http://54.123.45.67/api/schools

# Check all services are up
pm2 status
sudo systemctl status nginx
sudo systemctl status mysql
```

---

## PART 7 — OPTIONAL: ADD HTTPS WITH CERTBOT (Free SSL)

**You need a domain name pointing to your EC2 IP for this step.**

### 7.1 Point Your Domain to EC2
- In your DNS provider (GoDaddy, Namecheap, Route53, etc.)
- Add an **A record**: `@` → `54.123.45.67`
- Add an **A record**: `www` → `54.123.45.67`
- Wait 5–10 minutes for DNS propagation

### 7.2 Install Certbot
```bash
sudo apt-get install -y certbot python3-certbot-nginx
```

### 7.3 Obtain SSL Certificate
```bash
# Replace yourdomain.com with your actual domain
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Follow prompts: enter email, agree to terms
# Certbot will automatically update nginx config for HTTPS
```

### 7.4 Auto-Renew SSL (Already configured by Certbot)
```bash
# Test auto-renewal
sudo certbot renew --dry-run

# Check the timer is active
sudo systemctl status certbot.timer
```

### 7.5 Update Your Backend CORS (on EC2)
```bash
nano /home/ubuntu/tapneat/.env
# Update FRONTEND_URL to:
# FRONTEND_URL=https://yourdomain.com

pm2 restart tapneat-api
```

---

## PART 8 — REDEPLOYMENT (After Code Changes)

### 8.1 Redeploy Backend Only
```powershell
# On LOCAL machine — upload changed backend files
scp -i "C:\path\to\tapneat-key.pem" -r backend-node\* ubuntu@54.123.45.67:/home/ubuntu/tapneat/
```
```bash
# On EC2 — restart PM2 (NO downtime needed with pm2 reload)
pm2 reload tapneat-api
pm2 logs tapneat-api --lines 20
```

### 8.2 Redeploy Frontend Only
```powershell
# On LOCAL machine — build and upload
cd d:\TAP_RFID\Tap-N-Eat
npm run build
scp -i "C:\path\to\tapneat-key.pem" -r dist\* ubuntu@54.123.45.67:/var/www/tapneat/
```
```bash
# Nginx serves static files — no restart needed
# Just clear browser cache (Ctrl+Shift+R)
```

### 8.3 Redeploy Database Schema Changes
```powershell
# Upload latest SQL file
scp -i "C:\path\to\tapneat-key.pem" migrations.sql ubuntu@54.123.45.67:/home/ubuntu/
```
```bash
# On EC2 — run the migration
mysql -u tapneat -p'YourAppPassword123!' qsr_system < /home/ubuntu/migrations.sql
```

---

## PART 9 — USEFUL COMMANDS (Day-to-Day)

```bash
# ── PM2 ──────────────────────────────────────────────────────
pm2 status                      # see all processes
pm2 logs tapneat-api            # live logs
pm2 logs tapneat-api --lines 100  # last 100 log lines
pm2 restart tapneat-api         # restart (brief downtime)
pm2 reload tapneat-api          # reload (zero downtime)
pm2 stop tapneat-api            # stop
pm2 monit                       # live dashboard

# ── Nginx ────────────────────────────────────────────────────
sudo nginx -t                       # test config
sudo systemctl reload nginx         # apply config changes
sudo systemctl restart nginx        # full restart
sudo tail -f /var/log/nginx/error.log    # error log
sudo tail -f /var/log/nginx/access.log   # access log

# ── MySQL ────────────────────────────────────────────────────
sudo systemctl status mysql
mysql -u tapneat -p'YourAppPassword123!' qsr_system
SHOW TABLES;
SELECT COUNT(*) FROM employees;

# ── System ───────────────────────────────────────────────────
df -h               # disk usage
free -h             # RAM usage
htop                # interactive process monitor (install: sudo apt install htop)
```

---

## PART 10 — TROUBLESHOOTING

| Problem | Command to Debug |
|---------|-----------------|
| Site not loading | `sudo systemctl status nginx` |
| 502 Bad Gateway | `pm2 status` — backend may have crashed |
| Backend crashed | `pm2 logs tapneat-api --lines 50` |
| Database connection error | Check `.env` DB_PASSWORD, run `mysql -u tapneat -p` |
| Port 80 blocked | `sudo ufw status` — check Nginx Full is allowed |
| After reboot, app not running | `pm2 resurrect` or check `pm2 startup` was run |
| Nginx config error | `sudo nginx -t` — shows exact error line |
| API returning 404 | Check `/api/` prefix in nginx config proxy_pass |

---

## SUMMARY OF KEY PATHS ON EC2

| What | Path |
|------|------|
| Backend code | `/home/ubuntu/tapneat/` |
| Backend env file | `/home/ubuntu/tapneat/.env` |
| Frontend static files | `/var/www/tapneat/` |
| Nginx config | `/etc/nginx/sites-available/tapneat` |
| Nginx error log | `/var/log/nginx/error.log` |
| PM2 logs | `~/.pm2/logs/` |
| MySQL data | `/var/lib/mysql/` |

---

## QUICK REFERENCE — PORTS

| Service | Port | Exposed? |
|---------|------|----------|
| Nginx | 80 / 443 | Yes (public) |
| Node.js (PM2) | 5000 | No (Nginx proxies internally) |
| MySQL | 3306 | No (localhost only) |
| SSH | 22 | Yes (your IP only recommended) |
