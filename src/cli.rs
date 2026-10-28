use clap::Parser;
use std::path::PathBuf;

/// MMEX-PocketBase Sync Tool - Gateway di sincronizzazione multipiattaforma per Money Manager Ex
#[derive(Parser, Debug, Clone)]
#[command(
    name = "mmex-sync",
    author = "Wolfsolver",
    version,
    about = "Offline-First synchronization gateway for Money Manager Ex with cloud backends"
)]
pub struct CliArgs {
    // --- GESTIONE PROFILI ---
    /// Seleziona il profilo di configurazione (es. 'home', 'work')
    #[arg(long, env = "MMEX_PROFILE")]
    pub profile: Option<String>,

    /// Ignora la configurazione da profilo salvato e usa i default
    #[arg(long = "ignoreProfile")]
    pub ignore_profile: bool,

    /// Elenca tutti i profili disponibili nella directory di configurazione
    #[arg(long = "listProfile")]
    pub list_profile: bool,

    /// Mostra le informazioni dettagliate del profilo (predefinito o specificato)
    #[arg(long = "showProfile", num_args = 0..=1)]
    pub show_profile: Option<Option<String>>,

    /// Elimina il profilo specificato (o il predefinito)
    #[arg(long = "deleteProfile", num_args = 0..=1)]
    pub delete_profile: Option<Option<String>>,

    /// Imposta il profilo predefinito in mmex-sync.config.json
    #[arg(long = "setDefaultProfile")]
    pub set_default_profile: Option<String>,

    /// Rinomina il profilo corrente con un nuovo nome
    #[arg(long = "renameProfileTo")]
    pub rename_profile_to: Option<String>,

    /// Imposta la modalità operativa predefinita per il profilo (sync, run, watch)
    #[arg(long = "setDefaultMode")]
    pub set_default_mode: Option<String>,

    // --- DATABASE LOCALE MMEX ---
    /// Percorso del file database Money Manager Ex (.mmb standard o .emb cifrato)
    #[arg(long, env = "MMEX_DB_PATH")]
    pub db: Option<PathBuf>,

    /// Password per l'apertura del database cifrato .emb
    #[arg(long = "filePassword", env = "MMEX_FILE_PASSWORD")]
    pub file_password: Option<String>,

    /// Salva la password del database cifrato nel profilo protetta (yes/no)
    #[arg(long = "saveFilePassword")]
    pub save_file_password: Option<String>,

    /// Percorso dell'eseguibile di Money Manager Ex (mmex)
    #[arg(long, env = "MMEX_EXE_PATH")]
    pub exe: Option<PathBuf>,

    /// Crea un nuovo database vuoto inizializzato a partire dallo schema SQL
    #[arg(long)]
    pub create: bool,

    // --- BACKEND REMOTO ---
    /// Tipo di provider remoto da utilizzare (default: pocketbase, pronto per supabase/firebase)
    #[arg(long = "serverType", env = "MMEX_REMOTE_PROVIDER")]
    pub server_type: Option<String>,

    /// URL del server remoto (es. http://127.0.0.1:8090)
    #[arg(long, env = "MMEX_REMOTE_URL")]
    pub url: Option<String>,

    /// Email/Identità per l'autenticazione remota
    #[arg(long, env = "MMEX_REMOTE_USER")]
    pub user: Option<String>,

    /// Password di autenticazione remota (non salvata in chiaro, genera un token)
    #[arg(long, env = "MMEX_REMOTE_PASS")]
    pub pass: Option<String>,

    // --- MODALITÀ DI SINCRONIZZAZIONE ---
    /// Esegue il ciclo di sync (se specificato senza argomenti: init,push,pull; oppure op1,op2)
    #[arg(long, num_args = 0..=1)]
    pub sync: Option<Option<String>>,

    /// Forza l'elaborazione ignorando il timestamp lastSync e i flag dirty
    #[arg(long)]
    pub force: bool,

    // --- MODALITÀ OPERATIVE ---
    /// Modalità Run: Sync iniziale -> Avvia MMEX -> Attende chiusura -> Sync finale
    #[arg(long)]
    pub run: bool,

    /// Modalità Watch: Sync iniziale -> Avvia MMEX -> Monitoraggio real-time locale e remoto
    #[arg(long)]
    pub watch: bool,

    // --- COMANDI DI PULIZIA E MANUTENZIONE ---
    /// Rimuove colonne tecniche e trigger dal database locale
    #[arg(long = "clearDb")]
    pub clear_db: bool,

    /// Cancella tutti i dati dalle collezioni sul server remoto (ordine inverso)
    #[arg(long = "clearServer")]
    pub clear_server: bool,

    // --- ALTRI PARAMETRI ---
    /// Abilita log dettagliati delle operazioni
    #[arg(long, env = "MMEX_VERBOSE")]
    pub verbose: bool,

    /// Disabilita l'attesa di input utente prima della chiusura
    #[arg(long)]
    pub nowait: bool,

    /// Avvia l'interfaccia grafica Web
    #[arg(long)]
    pub gui: bool,

    /// Disabilita la GUI
    #[arg(long)]
    pub nogui: bool,

    /// Controlla la presenza di aggiornamenti
    #[arg(long = "checkForUpdate")]
    pub check_for_update: bool,

    /// Scarica e installa automaticamente l'aggiornamento
    #[arg(long = "autoDownloadUpdate")]
    pub auto_download_update: bool,
}
