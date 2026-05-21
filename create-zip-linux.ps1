# create-zip-linux.ps1
$ErrorActionPreference = "Stop"

$Timestamp = Get-Date -Format "yyyyMMdd-HHmm"
$ZipName = "dist/output/mmex-sync-linux-$Timestamp.zip"

Write-Host "Inizio creazione archivio Linux: $ZipName"

if (!(Test-Path -Path "dist/output")) {
    New-Item -ItemType Directory -Path "dist/output" | Out-Null
}

# Array dei file strettamente necessari per il pacchetto Linux
$FilesToZip = @(
    "dist\mmex-sync-linux"
    "dist\tables_v1_for_sync.sql"
)

# Verifica che i file esistano prima di procedere
foreach ($File in $FilesToZip) {
    if (-not (Test-Path $File)) {
        Write-Error "File necessario non trovato: $File. Assicurati di aver eseguito build-linux.ps1 prima."
        exit 1
    }
}

# Creazione dell'archivio zip
Compress-Archive -Path $FilesToZip -DestinationPath $ZipName -Force

Write-Host "✅ Archivio Linux creato con successo: $ZipName"
