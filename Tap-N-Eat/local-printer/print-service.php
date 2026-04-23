<?php
// Simple PHP local print service for ESC/POS over RAW socket
// Run on the PC inside the printer LAN (NOT on Hostinger)
// Usage: php -S 0.0.0.0:8080 print-service.php
// Env vars: PRINTER_IP (e.g. 192.168.1.28), PRINTER_PORT (default 9100), API_KEY (optional)

// Permissive CORS for browser calls on local LAN
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-KEY');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$printerIp   = getenv('PRINTER_IP') ?: '192.168.0.105';
$printerPort = (int)(getenv('PRINTER_PORT') ?: 9100);
$apiKey      = getenv('API_KEY') ?: 'print_secret';

if ($_SERVER['REQUEST_METHOD'] === 'GET' && $_SERVER['REQUEST_URI'] === '/health') {
    header('Content-Type: application/json');
    echo json_encode(['status' => 'ok', 'printer' => "$printerIp:$printerPort"]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !str_starts_with($_SERVER['REQUEST_URI'], '/print')) {
    http_response_code(404);
    exit;
}

if ($apiKey && ($_SERVER['HTTP_X_API_KEY'] ?? '') !== $apiKey) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized']);
    exit;
}

$body = file_get_contents('php://input');
$data = json_decode($body, true);
if (!is_array($data) || !isset($data['employee'], $data['transaction'], $data['qr_url'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid payload']);
    exit;
}

$receipt = build_receipt($data['employee'], $data['transaction'], $data['qr_url']);

$fp = @fsockopen($printerIp, $printerPort, $errno, $errstr, 5);
if (!$fp) {
    http_response_code(500);
    echo json_encode(['error' => 'Printer connection failed', 'details' => $errstr]);
    exit;
}

fwrite($fp, $receipt);
fclose($fp);

header('Content-Type: application/json');
echo json_encode(['status' => 'ok', 'mode' => 'printed', 'printer' => "$printerIp:$printerPort"]);
exit;

// -------- Helpers --------
function build_receipt($employee, $transaction, $qrData) {
    $mealCategory = ($employee['meal_category'] ?? $transaction['meal_category'] ?? '');
    $time         = ($employee['time'] ?? $transaction['time'] ?? '');
    $date         = ($employee['date'] ?? $transaction['date'] ?? '');
    $amount       = ($employee['amount'] ?? $transaction['amount'] ?? '');
    $balance      = ($employee['balance'] ?? $transaction['balance'] ?? '');

    $line = str_repeat('-', 33);
    $out  = '';

    // RESET
    $out .= "\x1B\x40";
    $out .= "\x1D\x4C\x00\x00";

    // HEADER (center)
    $out .= "\x1B\x61\x01";
    $out .= "\x1B\x45\x01CATALYST\n";
    $out .= "\x1B\x45\x00";
    $out .= "PARTNERING FOR\n";
    $out .= "SUSTAINABILITY\n";
    $out .= "$line\n";

    // MEAL (center)
    $out .= "\x1B\x45\x01" . strtoupper($mealCategory) . "\n";
    $out .= "\x1B\x45\x00";
    $out .= "$line\n";

    // DETAILS (center)
    $out .= "\x1B\x61\x01";
    $out .= center_line("Employee: " . ($employee['emp_name'] ?? ''));
    $out .= center_line("Emp ID: " . ($employee['emp_id'] ?? ''));
    $out .= center_line("Site: " . ($employee['site'] ?? ''));
    $out .= center_line("Time: " . $time);
    $out .= center_line("Date: " . $date);
    $out .= "$line\n";

    // AMOUNT (center)
    $out .= "\x1B\x61\x01";
    $out .= "\x1B\x45\x01";
    $out .= "Amount: Rs. {$amount}\n";
    $out .= "\x1B\x45\x00";
    $out .= "$line\n";

    // BALANCE (center)
    $out .= "\x1B\x61\x01";
    $out .= "\x1B\x45\x01";
    $out .= "AVAILABLE BALANCE\n";
    $out .= "Rs. {$balance}\n";
    $out .= "\x1B\x45\x00";
    $out .= "$line\n\n";

    // QR centered, larger module size
    $out .= print_qr_native($qrData, 7);
    $out .= "\n";

    // FOOTER (center)
    $out .= "\x1B\x61\x01";
    $out .= "Scan QR in Browser\n";
    $out .= "for Details\n\n";
    $out .= "Thank you!\n\n";

    // CUT
    $out .= "\x1D\x56\x00";

    return $out;
}

function center_line($text, $width = 32) {
    $text = (string)$text;
    if (strlen($text) > $width) {
        $text = substr($text, 0, $width);
    }
    $padding = max(0, (int)floor(($width - strlen($text)) / 2));
    return str_repeat(' ', $padding) . $text . "\n";
}

function print_qr_native($data, $size = 4) {
    $size = max(3, min(8, (int)$size));
    $qr  = "\x1B\x61\x01"; // center
    $qr .= "\x1D\x28\x6B\x04\x00\x31\x41\x32\x00"; // model 2
    $qr .= "\x1D\x28\x6B\x03\x00\x31\x43" . chr($size); // module size
    $qr .= "\x1D\x28\x6B\x03\x00\x31\x45\x30"; // error correction L
    $len = strlen($data) + 3;
    $qr .= "\x1D\x28\x6B" . chr($len) . chr(0) . "\x31\x50\x30" . $data; // store
    $qr .= "\x1D\x28\x6B\x03\x00\x31\x51\x30\n\n"; // print
    return $qr;
}
?>
