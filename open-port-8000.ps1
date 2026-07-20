# Run this script as Administrator to allow your phone to connect to the backend
# Right-click this file and choose "Run with PowerShell" AS ADMINISTRATOR

Write-Host "Opening port 8000 in Windows Firewall for local mobile testing..." -ForegroundColor Cyan

netsh advfirewall firewall delete rule name="Allow Port 8000 for Expo Dev" 2>$null

netsh advfirewall firewall add rule `
  name="Allow Port 8000 for Expo Dev" `
  dir=in `
  action=allow `
  protocol=TCP `
  localport=8000

if ($LASTEXITCODE -eq 0) {
  Write-Host "SUCCESS: Port 8000 is now open. Your phone can reach the backend." -ForegroundColor Green
} else {
  Write-Host "FAILED: Could not add firewall rule. Try running as Administrator." -ForegroundColor Red
}

Read-Host "Press Enter to close"
