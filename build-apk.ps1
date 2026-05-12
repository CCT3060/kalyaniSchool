Set-Location "D:\TAP_RFID\TapNEat-ParentApp"
Write-Host "==> Installing dependencies..."
npm install
Write-Host "`n==> Starting EAS Build (Android APK - preview)..."
eas build -p android --profile preview
