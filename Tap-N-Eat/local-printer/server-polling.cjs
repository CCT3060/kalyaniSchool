const express = require('express');
const net = require('net');

const app = express();
app.use(express.json());

/* ===============================
   CONFIG
=============================== */
const PRINTER_IP = process.env.PRINTER_IP || '192.168.0.105';
const PRINTER_PORT = Number(process.env.PRINTER_PORT || 9100);
const PORT = Number(process.env.PORT || 8080);
const API_KEY = process.env.API_KEY || 'print_secret';

// Hostinger API configuration
const HOSTINGER_API = process.env.HOSTINGER_API || 'https://qsr.catalystsolutions.eco/Tap-N-Eat/api/print-queue.php';
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL || 2000); // 2 seconds

/* ===============================
   POLLING SYSTEM
=============================== */
let isPolling = false;

async function pollForPrintJobs() {
  if (isPolling) return; // Prevent concurrent polling
  isPolling = true;

  try {
    console.log('📡 Polling for print jobs...');
    
    const response = await fetch(HOSTINGER_API, {
      method: 'GET',
      headers: {
        'X-API-KEY': API_KEY,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error('❌ API error:', response.status, text);
      return;
    }

    const data = await response.json();
    
    if (data.status === 'ok' && data.jobs && data.jobs.length > 0) {
      console.log(`✅ Found ${data.jobs.length} print job(s)`);
      
      // Process each job
      for (const job of data.jobs) {
        await processPrintJob(job);
      }
    }
    
  } catch (error) {
    console.error('❌ Polling error:', error.message);
  } finally {
    isPolling = false;
  }
}

async function processPrintJob(job) {
  console.log(`🖨️  Printing job #${job.id} for ${job.employee_name}`);
  
  try {
    // Build employee and transaction objects from job data
    const employee = {
      emp_name: job.employee_name,
      emp_id: job.employee_id,
      meal_category: job.meal_type,
      balance: job.balance,
      site: 'Catalyst', // Default
      time: new Date(job.timestamp).toLocaleTimeString('en-IN'),
      date: new Date(job.timestamp).toLocaleDateString('en-IN'),
      amount: job.amount
    };

    const transaction = {
      meal_category: job.meal_type,
      amount: job.amount,
      balance: job.balance,
      time: employee.time,
      date: employee.date
    };

    const receipt = buildReceipt(employee, transaction, job.qr_url);
    
    // Send to printer
    await sendToPrinter(receipt);
    
    // Mark as completed
    await updateJobStatus(job.id, 'completed');
    console.log(`✅ Job #${job.id} completed successfully`);
    
  } catch (error) {
    console.error(`❌ Failed to print job #${job.id}:`, error.message);
    await updateJobStatus(job.id, 'failed', error.message);
  }
}

function sendToPrinter(receipt) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    
    socket.connect(PRINTER_PORT, PRINTER_IP, () => {
      console.log(`📟 Connected to printer ${PRINTER_IP}:${PRINTER_PORT}`);
      socket.write(receipt);
      socket.end();
      resolve();
    });

    socket.on('error', (err) => {
      reject(err);
    });

    socket.on('close', () => {
      console.log('📟 Printer connection closed');
    });
  });
}

async function updateJobStatus(jobId, status, errorMessage = null) {
  try {
    const response = await fetch(HOSTINGER_API, {
      method: 'POST',
      headers: {
        'X-API-KEY': API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        job_id: jobId,
        status: status,
        error: errorMessage
      })
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error('Failed to update job status', response.status, text);
    }
  } catch (error) {
    console.error('Error updating job status:', error.message);
  }
}

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
  out += `Employee: ${employee.emp_name}\n`;
  out += `Emp ID  : ${employee.emp_id}\n`;
  out += `Site    : ${employee.site}\n`;
  out += `Time    : ${employee.time || transaction.time}\n`;
  out += `Date    : ${employee.date || transaction.date}\n`;
  out += `${line}\n`;

  // Amount
  out += '\x1B\x45\x01';
  out += `Amount: Rs. ${employee.amount || transaction.amount}\n`;
  out += '\x1B\x45\x00';
  out += `${line}\n`;

  // Balance
  out += '\x1B\x45\x01';
  out += 'AVAILABLE BALANCE\n';
  out += `Rs. ${employee.balance || transaction.balance}\n`;
  out += '\x1B\x45\x00';
  out += `${line}\n\n`;

  // QR
  out += printQRCode(qrData, 4);

  // Footer
  out += '\x1B\x61\x01';
  out += 'Scan QR in Browser\nfor Details\n\n';
  out += 'Thank you!\n\n';

  out += '\x1D\x56\x00'; // cut
  return out;
}

/* ===============================
   QR CODE
=============================== */
function printQRCode(data, size = 4) {
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
    printer: `${PRINTER_IP}:${PRINTER_PORT}`,
    hostinger_api: HOSTINGER_API,
    polling: true
  });
});

/* ===============================
   START SERVICE
=============================== */
app.listen(PORT, () => {
  console.log('🟢 Polling-based printer service started');
  console.log(`🖨️  Target printer: ${PRINTER_IP}:${PRINTER_PORT}`);
  console.log(`📡 Polling: ${HOSTINGER_API}`);
  console.log(`⏱️  Poll interval: ${POLL_INTERVAL}ms`);
  console.log(`🔑 API Key: ${API_KEY}`);
  
  // Start polling
  setInterval(pollForPrintJobs, POLL_INTERVAL);
  
  // Initial poll
  setTimeout(pollForPrintJobs, 1000);
});
