# create-zip.ps1
$ErrorActionPreference = "Stop"

$Timestamp = Get-Date -Format "yyyyMMdd-HHmm"
$ZipName = "dist/output/mmex-sync-$Timestamp.zip"

Write-Host "Inizio creazione archivio: $ZipName"

# Array dei file strettamente necessari per il pacchetto portable
$FilesToZip = @(
    "dist\mmex-sync.exe",
    "dist\better_sqlite3.node",
    "dist\tables_v1_for_sync.sql"
)

# Verifica che i file esistano prima di procedere
foreach ($File in $FilesToZip) {
    if (-not (Test-Path $File)) {
        Write-Error "File necessario non trovato: $File. Assicurati di aver eseguito build.ps1 prima."
        exit 1
    }
}

# Creazione dell'archivio zip
Compress-Archive -Path $FilesToZip -DestinationPath $ZipName -Force

Write-Host "✅ Archivio creato con successo: $ZipName"
