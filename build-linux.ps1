# build-linux.ps1
$ErrorActionPreference = "Stop"

$NodeVersion = "v20.12.2" # Using a stable LTS version for the Linux binary
$DownloadUrl = "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-linux-x64.tar.xz"
$ArchiveName = "node-$NodeVersion-linux-x64.tar.xz"
$TempDir = "dist\temp-linux"

Write-Host "Creating dist directory..."
if (!(Test-Path -Path "dist")) {
    New-Item -ItemType Directory -Path "dist" | Out-Null
}

Write-Host "Bundling with esbuild..."
node build.js

Write-Host "Generating SEA blob..."
node --experimental-sea-config sea-config.json

Write-Host "Downloading Linux Node.js binary ($NodeVersion)..."
if (!(Test-Path -Path "dist\$ArchiveName")) {
    Invoke-WebRequest -Uri $DownloadUrl -OutFile "dist\$ArchiveName"
}

Write-Host "Extracting Linux node binary..."
if (Test-Path -Path $TempDir) {
    Remove-Item -Path $TempDir -Recurse -Force
}
New-Item -ItemType Directory -Path $TempDir | Out-Null

# Use tar to extract only the node binary
# Note: Windows 'tar' supports .xz since recent versions
tar -xf "dist\$ArchiveName" -C $TempDir --strip-components=2 "node-$NodeVersion-linux-x64/bin/node"

$LinuxNodePath = "$TempDir\node"
$DestPath = "dist\mmex-sync-linux"

Write-Host "Copying Linux node to $DestPath..."
Copy-Item -Path $LinuxNodePath -Destination $DestPath -Force

Write-Host "Detecting sentinel in Linux binary..."
$Sentinel = (Select-String -Pattern 'NODE_SEA_FUSE_[a-f0-9]+' -Path $DestPath | Select-Object -First 1 -ExpandProperty Matches | Select-Object -ExpandProperty Value)
if (-not $Sentinel) {
    Write-Warning "Could not detect sentinel automatically. Falling back to default."
    $Sentinel = "NODE_SEA_FUSE_f1422af715635223"
}
Write-Host "Using sentinel: $Sentinel"

npx postject $DestPath NODE_SEA_BLOB dist\sea-prep.blob --sentinel-fuse $Sentinel

Write-Host "Cleaning up..."
Remove-Item -Path $TempDir -Recurse -Force

Write-Host "Build complete! mmex-sync-linux is ready in dist/"
Write-Host "Note: Native modules (like better_sqlite3.node) are NOT included for Linux in this cross-build."
