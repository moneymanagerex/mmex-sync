# MMEX-Sync su Linux

Questa guida spiega come configurare ed eseguire MMEX-Sync su un sistema Linux. Poiché il progetto utilizza Node.js Single Executable Application (SEA) e moduli nativi come SQLite, sono necessari alcuni passaggi specifici.

## Prerequisiti

1.  **Node.js**: È consigliato avere Node.js installato (versione 20 o superiore).
2.  **Librerie di sistema**: Assicurati che il sistema abbia le librerie standard (glibc).

## Installazione dei Componenti Linux

Per far funzionare l'applicazione su Linux, sono necessari tre componenti principali:

### 1. L'Eseguibile Principale (`mmex-sync-linux`)
Questo file viene generato dallo script `build-linux.ps1` su Windows. 
- Se non lo hai già fatto, esegui `.\build-linux.ps1` su Windows.
- Copia il file `dist/mmex-sync-linux` sul tuo sistema Linux.
- Dai i permessi di esecuzione:
  ```bash
  chmod +x mmex-sync-linux
  ```

### 2. Il Modulo Nativo SQLite (`better_sqlite3.node`)
Poiché SQLite è un modulo nativo, la versione Windows non funziona su Linux. Hai due opzioni:

**Opzione A (Consigliata): Scaricare il binario precompilato**
Scarica il file corrispondente alla tua versione di Node.js dai release ufficiali di `better-sqlite3`:
- Vai su: [WiseLibs/better-sqlite3 Releases](https://github.com/WiseLibs/better-sqlite3/releases/tag/v12.9.0)
- Espandi la sezione **Assets**.
- Cerca un file che termina con `linux-x64.tar.gz` (es. `better-sqlite3-v12.9.0-node-v115-linux-x64.tar.gz` per Node 20).
- Estrai il file `better_sqlite3.node` dall'archivio e mettilo nella stessa cartella dell'eseguibile.

**Opzione B: Compilazione locale**
Se hai `npm` e `python3/make/g++` su Linux:
```bash
npm install better-sqlite3
# Prendi il file generato in node_modules/better-sqlite3/build/Release/better_sqlite3.node
```

### 3. Script SQL (`tables_v1_for_sync.sql`)
Copia il file `assets/sql/tables_v1_for_sync.sql` nella stessa cartella dell'eseguibile.

## Esecuzione

Una volta che hai tutti i file nella stessa cartella:
```bash
./mmex-sync-linux
```

## Note sulla Distribuzione

Per una distribuzione "portable", la cartella dovrebbe contenere:
- `mmex-sync-linux` (l'eseguibile)
- `better_sqlite3.node` (il driver database per Linux)
- `tables_v1_for_sync.sql` (lo schema del database)
