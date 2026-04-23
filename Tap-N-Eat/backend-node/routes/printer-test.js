const express = require('express');
const router  = express.Router();
const net     = require('net');

const PRINTER_IP   = process.env.PRINTER_IP   || '192.168.0.1';
const PRINTER_PORT = parseInt(process.env.PRINTER_PORT) || 9100;
const TIMEOUT_MS   = 5000;

function testConnection() {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(TIMEOUT_MS);
    socket.connect(PRINTER_PORT, PRINTER_IP, () => {
      socket.destroy();
      resolve({ status: 'success', message: `Printer at ${PRINTER_IP}:${PRINTER_PORT} is online` });
    });
    socket.on('timeout', () => { socket.destroy(); resolve({ status: 'error', message: `Timeout connecting to printer at ${PRINTER_IP}:${PRINTER_PORT}` }); });
    socket.on('error',   (err) => resolve({ status: 'error', message: `Cannot connect to printer at ${PRINTER_IP}:${PRINTER_PORT}`, error_details: err.message }));
  });
}

function sendTestPrint() {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(TIMEOUT_MS);
    socket.connect(PRINTER_PORT, PRINTER_IP, () => {
      const sep = '-'.repeat(32);
      const receipt = Buffer.concat([
        Buffer.from([0x1b, 0x40]),          // Init
        Buffer.from([0x1b, 0x61, 0x01]),    // Center
        Buffer.from([0x1b, 0x45, 0x01]),    // Bold on
        Buffer.from('PRINTER TEST\n'),
        Buffer.from([0x1b, 0x45, 0x00]),    // Bold off
        Buffer.from('Epson TM-T20II\n'),
        Buffer.from(`${sep}\n`),
        Buffer.from([0x1b, 0x61, 0x00]),    // Left
        Buffer.from('If you see this,\n'),
        Buffer.from('printer is working!\n'),
        Buffer.from([0x1b, 0x61, 0x01]),    // Center
        Buffer.from('\n\nTest Complete\n'),
        Buffer.from(`${sep}\n\n\n`),
        Buffer.from([0x1d, 0x56, 0x00]),    // Full cut
      ]);
      socket.write(receipt, () => {
        setTimeout(() => { socket.destroy(); resolve({ status: 'success', message: 'Test print sent to printer' }); }, 2000);
      });
    });
    socket.on('timeout', () => { socket.destroy(); resolve({ status: 'error', message: 'Connection timeout' }); });
    socket.on('error',   (err) => resolve({ status: 'error', message: 'Cannot connect to printer', error_details: err.message }));
  });
}

// GET /api/printer-test  — info
router.get('/', (req, res) => {
  res.json({
    message: 'Printer test tool',
    usage: {
      connection: 'POST /api/printer-test?action=connection',
      print:      'POST /api/printer-test?action=print',
    },
  });
});

// POST /api/printer-test?action=connection|print
router.post('/', async (req, res) => {
  const action = req.query.action || 'test';
  if (action === 'connection') return res.json(await testConnection());
  if (action === 'print')      return res.json(await sendTestPrint());
  res.status(400).json({ error: 'Invalid action. Use action=connection or action=print' });
});

module.exports = router;
