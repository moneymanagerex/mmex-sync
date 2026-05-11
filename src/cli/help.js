// src/cli/help.js

export function showHelp() {
  console.log(`
===========================================================
🚀 MMEX-PocketBase Sync Tool | Manuale Utente
===========================================================

Utilizzo: mmex-sync [PARAMETRI] [MODALITÀ]

-----------------------------------------------------------
📂 GESTIONE PROFILI E CONFIGURAZIONE
-----------------------------------------------------------
  --profile=nome      Sceglie il profilo (es. 'casa', 'lavoro'). 
                      Default: 'default'
  --ignoreProfile     Ignore profile configuration and use default values
  --listProfile       Mostra l'elenco dei profili disponibili
  --db=percorso       Percorso del file .mmb di MoneyManagerEx
  --url=indirizzo     URL dell'istanza PocketBase
  --user=email        Email di login PocketBase
  --pass=password     Password (non viene salvata, genera un token)
  --setDefaultMode=X  Imposta la modalità di default per il profilo
                      Valori: sync (default), run, watch
  --exe=percorso      Percorso dell'eseguibile MMEX.exe
                      Default: C:\\Program Files\\MoneyManagerEx\\bin\\mmex.exe					  
  --create            Delete and Recreates a new empty database
  --verbose           Mostra log dettagliati di ogni operazione.

-----------------------------------------------------------
🕹️ MODALITÀ DI SINCRONIZZAZIONE
-----------------------------------------------------------
  --sync              Esegue il ciclo completo (Init + Push + Pull).
  --sync=op1,op2      Esegue solo le operazioni specificate.
                      Operazioni disponibili: init, push, pull
  --force             Ignore flag and timestamp and process all records

  Esempi:
    node index.js --sync=pull           (Scarica solo i dati remoti)
    node index.js --sync=init           (Inizializza senza trasmettere nulla)
    node index.js --sync --force        (Ciclo completo con invio e scarico totale)

-----------------------------------------------------------
🕹️ MODALITÀ OPERATIVE
-----------------------------------------------------------
  --run               1. Sync iniziale 
                      2. Apre MMEX e attende la chiusura
                      3. Sync finale
  --watch             1. Sync iniziale
                      2. Apre MMEX (detached)
                      3. Monitora cambiamenti locali/remoti in tempo reale

-----------------------------------------------------------
⚡ COMANDI DI FORZATURA E MANUTENZIONE
-----------------------------------------------------------

-----------------------------------------------------------
🧹 PULIZIA (Attenzione!)
   Questi comandi vengono eseguiti da soli. 
   Altri parametri vengono ignorati.
-----------------------------------------------------------
  --clearDb           Rimuove colonne tecniche e trigger dal DB locale.
  --clearServer       Rimuove tutti i dati dalle collezioni sul server.

Esempio:
  node index.js --profile=casa --watch --verbose
===========================================================
    `);
}