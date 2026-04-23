const express = require('express');
const net = require('net');

const app = express();
app.use(express.json());

// Permissive CORS for local browser calls
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-API-KEY');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* ===============================
   CONFIG
=============================== */
const PRINTER_IP   = process.env.PRINTER_IP || '192.168.0.105'; // 🔴 SET PRINTER IP
const PRINTER_PORT = Number(process.env.PRINTER_PORT || 9100);
const PORT         = Number(process.env.PORT || 8080);

// Disable API key for now (enable later)
const API_KEY = process.env.API_KEY || null;

function checkKey(req, res, next) {
  if (!API_KEY) return next();
  const key = req.headers['x-api-key'];
  if (key === API_KEY) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

/* ===============================
   PRINT ENDPOINT
=============================== */
app.post('/print', checkKey, (req, res) => {
  console.log('🖨️  PRINT REQUEST RECEIVED');

  const { employee, transaction, qr_url } = req.body || {};
  if (!employee || !transaction || !qr_url) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const receipt = buildReceipt(employee, transaction, qr_url);
  const socket = new net.Socket();

  socket.connect(PRINTER_PORT, PRINTER_IP, () => {
    console.log(`✅ Connected to printer ${PRINTER_IP}:${PRINTER_PORT}`);
    socket.write(receipt);
    socket.end();
    res.json({ status: 'ok', printed: true });
  });

  socket.on('error', (err) => {
    console.error('❌ Printer error:', err.message);
    res.status(500).json({ error: 'Printer connection failed' });
  });
});

/* ===============================
   RECEIPT BUILDER
=============================== */
function buildReceipt(employee, transaction, qrData) {
  const line = '-'.repeat(32);
  let out = '';

  out += '\x1B\x40'; // reset
  out += '\x1D\x4C\x00\x00';

  // Header
  out += '\x1B\x61\x01\x1B\x45\x01';
  out += 'CATALYST\n';
  out += '\x1B\x45\x00';
  out += 'PARTNERING FOR\nSUSTAINABILITY\n';
  out += `${line}\n`;

  // Meal
  out += '\x1B\x45\x01';
  out += (employee.meal_category || transaction.meal_category).toUpperCase() + '\n';
  out += '\x1B\x45\x00';
  out += `${line}\n`;

  // Details
  out += '\x1B\x61\x01';
  out += centerText(`Employee: ${employee.emp_name}`);
  out += centerText(`Emp ID  : ${employee.emp_id}`);
  out += centerText(`Site    : ${employee.site}`);
  out += centerText(`Time    : ${employee.time || transaction.time}`);
  out += centerText(`Date    : ${employee.date || transaction.date}`);
  out += `${line}\n`;

  // Amount
  out += '\x1B\x45\x01';
  out += centerText(`Amount: Rs. ${employee.amount || transaction.amount}`);
  out += '\x1B\x45\x00';
  out += `${line}\n`;

  // Balance
  out += '\x1B\x45\x01';
  out += centerText('AVAILABLE BALANCE');
  out += centerText(`Rs. ${employee.balance || transaction.balance}`);
  out += '\x1B\x45\x00';
  out += `${line}\n\n`;

  // QR
  out += printQRCode(qrData, 6);

  // Footer
  out += '\x1B\x61\x01';
  out += 'Scan QR in Browser\nfor Details\n\n';
  out += 'Thank you!\n\n';

  out += '\x1D\x56\x00'; // cut
  return out;
}

function centerText(text, width = 32) {
  const str = String(text || '');
  const truncated = str.length > width ? str.slice(0, width) : str;
  const pad = Math.max(0, Math.floor((width - truncated.length) / 2));
  return ' '.repeat(pad) + truncated + '\n';
}

/* ===============================
   QR CODE
=============================== */
function printQRCode(data, size = 6) {
  let qr = '';
  qr += '\x1B\x61\x01';
  qr += '\x1D\x28\x6B\x04\x00\x31\x41\x32\x00';
  qr += '\x1D\x28\x6B\x03\x00\x31\x43' + String.fromCharCode(size);
  qr += '\x1D\x28\x6B\x03\x00\x31\x45\x30';
  const len = data.length + 3;
  qr += '\x1D\x28\x6B' + String.fromCharCode(len, 0) + '\x31\x50\x30' + data;
  qr += '\x1D\x28\x6B\x03\x00\x31\x51\x30\n\n';
  return qr;
}

/* ===============================
   HEALTH CHECK
=============================== */
app.get('/health', (_, res) => {
  res.json({
    status: 'ok',
    printer: `${PRINTER_IP}:${PRINTER_PORT}`
  });
});

app.listen(PORT, () => {
  console.log(`🟢 Local printer service running on ${PORT}`);
  console.log(`🖨️  Target printer ${PRINTER_IP}:${PRINTER_PORT}`);
});
