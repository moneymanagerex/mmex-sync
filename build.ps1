# build.ps1
$ErrorActionPreference = "Stop"

Write-Host "Creating dist directory..."
if (!(Test-Path -Path "dist")) {
    New-Item -ItemType Directory -Path "dist" | Out-Null
}

Write-Host "Bundling with esbuild..."
node build.js

Write-Host "Generating SEA blob..."
node --experimental-sea-config sea-config.json

Write-Host "Copying node.exe to mmex-sync.exe..."
$NodePath = (Get-Command node).Source
Copy-Item -Path $NodePath -Destination "dist\mmex-sync.exe" -Force

if (Test-Path "assets/icons/icon.ico") {
    Write-Host "Applicazione icona personalizzata (assets/icons/icon.ico)..."
    node_modules\rcedit\bin\rcedit-x64.exe dist\mmex-sync.exe --set-icon "assets\icons\icon.ico"
} else {
    Write-Host "Nessun file 'icon.ico' trovato. Verrà usata l'icona predefinita di Node.js."
}

Write-Host "Injecting blob with postject..."
$Sentinel = (Select-String -Pattern 'NODE_SEA_FUSE_[a-f0-9]+' -Path "dist\mmex-sync.exe" | Select-Object -First 1 -ExpandProperty Matches | Select-Object -ExpandProperty Value)
if (-not $Sentinel) { $Sentinel = "NODE_SEA_FUSE_f1422af715635223" }
Write-Host "Using sentinel: $Sentinel"
npx postject dist\mmex-sync.exe NODE_SEA_BLOB dist\sea-prep.blob --sentinel-fuse $Sentinel

Write-Host "Copying native modules..."
$SQLiteNode = "node_modules\better-sqlite3\build\Release\better_sqlite3.node"
if (Test-Path -Path $SQLiteNode) {
    Copy-Item -Path $SQLiteNode -Destination "dist\better_sqlite3.node" -Force
} else {
    Write-Warning "better_sqlite3.node not found! Ensure better-sqlite3 is installed."
}

Write-Host "Copying distribution files..."
Copy-Item -Path ".\assets\sql\tables_v1_for_sync.sql" -Destination "dist\tables_v1_for_sync.sql" -Force

Write-Host "Build complete! mmex-sync.exe is ready in dist/"

## Optional: Build MSI if WiX is installed
#if (Get-Command "candle" -ErrorAction SilentlyContinue) {
#    Write-Host "WiX Toolset found. Building MSI..."
#    candle installer.wxs -out dist\installer.wixobj
#    light dist\installer.wixobj -out dist\mmex-sync.msi
#    Write-Host "MSI created successfully!"
#} else {
#    Write-Host "WiX Toolset (candle/light) not found in PATH. Skipping MSI creation."
#}
