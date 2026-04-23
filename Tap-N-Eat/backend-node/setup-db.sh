#!/bin/bash
sudo mariadb -u root << 'SQLEOF'
CREATE DATABASE IF NOT EXISTS qsr_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'tapneat'@'localhost' IDENTIFIED BY 'TapNeat2026!';
GRANT ALL PRIVILEGES ON qsr_system.* TO 'tapneat'@'localhost';
FLUSH PRIVILEGES;
SELECT 'DB_SETUP_DONE' AS status;
SQLEOF
