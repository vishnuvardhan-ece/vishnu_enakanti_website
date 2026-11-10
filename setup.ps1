$ErrorActionPreference = 'Stop'
# Always run npm from this script's directory, regardless of the terminal's current folder.
Set-Location -LiteralPath $PSScriptRoot
Write-Host 'Installing MediaPipe 0.10.21 locally (this needs internet access to npm)...' -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) { throw 'npm install failed. Check whether https://registry.npmjs.org is reachable, then retry.' }
$modelDir = Join-Path $PSScriptRoot 'models'
New-Item -ItemType Directory -Force -Path $modelDir | Out-Null
$modelPath = Join-Path $modelDir 'face_landmarker.task'
if (!(Test-Path $modelPath)) {
  $url = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
  Write-Host 'Downloading face landmark model locally...' -ForegroundColor Cyan
  Invoke-WebRequest -Uri $url -OutFile $modelPath
}
Write-Host 'Setup complete. Start server with: python -m http.server 8000' -ForegroundColor Green
