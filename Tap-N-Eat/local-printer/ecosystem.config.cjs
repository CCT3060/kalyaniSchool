// PM2 Ecosystem Configuration for QSR Printer Service
module.exports = {
  apps: [{
    name: 'qsr-printer',
    script: './server-polling.cjs',
    cwd: 'D:/projects/QSR_New/Myqsr/local-printer',
    env: {
      PRINTER_IP: '192.168.0.105',
      PRINTER_PORT: '9100',
      API_KEY: 'print_secret',
      HOSTINGER_API: 'https://qsr.catalystsolutions.eco/Tap-N-Eat/api/print-queue.php',
      POLL_INTERVAL: '2000'
    },
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '100M',
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true
  }]
};
