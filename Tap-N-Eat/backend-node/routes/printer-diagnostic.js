const express = require('express');
const router  = express.Router();
const net     = require('net');

const PRINTER_IP   = process.env.PRINTER_IP   || '192.168.0.1';
const PRINTER_PORT = parseInt(process.env.PRINTER_PORT) || 9100;
const TIMEOUT_MS   = 5000;

// GET /api/printer-diagnostic
router.get('/', (req, res) => {
  const results = {
    step_1_ping: {
      name: 'Network Connectivity (Ping)',
      description: `Testing if printer responds at ${PRINTER_IP}:${PRINTER_PORT}...`,
    },
    step_2_port: {
      name: 'Port Connectivity',
      ip: PRINTER_IP,
      port: PRINTER_PORT,
      status: 'Testing...',
    },
    environment: {
      node_version: process.version,
      os: process.platform,
      printer_ip: PRINTER_IP,
      printer_port: PRINTER_PORT,
    },
  };

  const socket = new net.Socket();
  socket.setTimeout(TIMEOUT_MS);

  socket.connect(PRINTER_PORT, PRINTER_IP, () => {
    results.step_2_port.status = '✅ SUCCESS - Port is open and accepting connections';

    // Send ESC @ (initialize)
    socket.write(Buffer.from([0x1b, 0x40]), () => {
      setTimeout(() => socket.destroy(), 500);
    });

    results.step_3_init = {
      name: 'Printer Initialization',
      status: '✅ SUCCESS - Initialization command sent',
      next: 'Your printer should respond. Check the printer display/lights.',
    };
    results.summary = {
      status: 'SUCCESS',
      message: 'Printer is online and ready!',
      configuration: `IP: ${PRINTER_IP} | Port: ${PRINTER_PORT}`,
      action: 'Try scanning an RFID card in the Admin Dashboard',
    };
    res.json(results);
  });

  socket.on('timeout', () => {
    socket.destroy();
    results.step_2_port.status = `❌ FAILED - Timeout connecting to ${PRINTER_IP}:${PRINTER_PORT}`;
    results.summary = {
      status: 'CONNECTION_FAILED',
      message: 'Connection timed out',
      configuration: `IP: ${PRINTER_IP} | Port: ${PRINTER_PORT}`,
      troubleshooting: [
        '1. Verify printer IP address is correct',
        '2. Ensure printer is powered on',
        '3. Check network cable is connected',
        '4. Verify printer is on the same network',
        `5. Check firewall settings (port ${PRINTER_PORT} may be blocked)`,
        `6. Try pinging the printer: ping ${PRINTER_IP}`,
        '7. Check printer display for network settings',
      ],
    };
    if (!res.headersSent) res.json(results);
  });

  socket.on('error', (err) => {
    results.step_2_port.status = `❌ FAILED - Cannot connect to ${PRINTER_IP}:${PRINTER_PORT}`;
    results.step_2_port.error  = err.message;
    results.summary = {
      status: 'CONNECTION_FAILED',
      message: 'Cannot connect to printer',
      configuration: `IP: ${PRINTER_IP} | Port: ${PRINTER_PORT}`,
      troubleshooting: [
        '1. Verify printer IP address is correct',
        '2. Ensure printer is powered on',
        '3. Check network cable is connected',
        '4. Verify printer is on the same network',
        `5. Check firewall settings (port ${PRINTER_PORT} may be blocked)`,
        `6. Try pinging the printer: ping ${PRINTER_IP}`,
        '7. Check printer display for network settings',
      ],
    };
    if (!res.headersSent) res.json(results);
  });
});

module.exports = router;
