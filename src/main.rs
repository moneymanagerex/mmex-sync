use anyhow::{Context, Result};
use clap::Parser;
use tracing::{error, info, Level};
use tracing_subscriber::FmtSubscriber;

use mmex_sync::cli::CliArgs;
use mmex_sync::config::ConfigManager;
use mmex_sync::crypto::{protect, unprotect};
use mmex_sync::db::DatabaseService;
use mmex_sync::domain::sync_order::SYNC_ORDER;
use mmex_sync::i18n::{detect_best_locale, set_current_locale, t, t_fmt};
use mmex_sync::remoteserver::create_remote_server;
use mmex_sync::sync::{SyncOptions, SyncRunner};

fn main() -> Result<()> {
    // 1. Carica le variabili da .env se presente
    let _ = dotenvy::dotenv();

    // 2. Parsing degli argomenti da linea di comando
    let args = CliArgs::parse();

    // 3. Rilevamento e impostazione della lingua attiva dell'applicazione
    let initial_lang = ConfigManager::new()
        .ok()
        .and_then(|cm| cm.get_saved_language());
    let best_locale = detect_best_locale(initial_lang.as_deref());
    set_current_locale(best_locale);

    // 4. Inizializzazione del logging con tracing
    let max_level = if args.verbose {
        Level::DEBUG
    } else {
        Level::INFO
    };

    let subscriber = FmtSubscriber::builder()
        .with_max_level(max_level)
        .with_target(false)
        .finish();

    tracing::subscriber::set_global_default(subscriber)
        .context(t("cli.context_logger_init"))?;

    info!("{}", t_fmt("cli.banner", &[("version", env!("CARGO_PKG_VERSION"))]));

    // 5. Determinazione deterministica della modalità di esecuzione: Desktop GUI vs CLI Headless
    let is_profile_cmd = args.list_profile
        || args.show_profile.is_some()
        || args.delete_profile.is_some()
        || args.set_default_profile.is_some()
        || args.rename_profile_to.is_some()
        || args.set_default_mode.is_some();

    if !args.cli && !is_profile_cmd {
        #[cfg(feature = "gui")]
        {
            info!("{}", t("cli.gui_launch"));
            let allow_auto_start = !args.gui;
            return mmex_sync::gui::run_gui(args, allow_auto_start)
                .context(t("cli.context_gui_error"));
        }

        #[cfg(not(feature = "gui"))]
        {
            if args.gui {
                anyhow::bail!("{}", t("cli.no_gui_compiled"));
            }
            use clap::CommandFactory;
            println!("{}", t("cli.cli_edition_help_1"));
            println!("{}", t("cli.cli_edition_help_2"));
            CliArgs::command().print_help()?;
            return Ok(());
        }
    }

    // 6. Esecuzione Headless CLI con Runtime Tokio multithread
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .context(t("cli.context_tokio_init"))?;

    rt.block_on(run_cli(args))
}

async fn run_cli(args: CliArgs) -> Result<()> {
    let config_mgr = ConfigManager::new().context(t("cli.context_config_init"))?;

    // Gestione comandi informativi e di manutenzione dei profili
    if args.list_profile {
        let profiles = config_mgr
            .list_profiles()
            .context(t("cli.context_list_profiles"))?;
        let default_profile = config_mgr.get_default_profile().unwrap_or_default();

        println!("{}", t("cli.profiles_available"));
        for p in profiles {
            if p == default_profile {
                println!("{}", t_fmt("cli.profile_item_default", &[("name", &p)]));
            } else {
                println!("{}", t_fmt("cli.profile_item", &[("name", &p)]));
            }
        }
        return Ok(());
    }

    if let Some(profile_target) = &args.show_profile {
        let name = match profile_target {
            Some(n) if !n.trim().is_empty() => n.trim().to_string(),
            _ => config_mgr
                .get_default_profile()
                .context(t("cli.context_determine_default"))?,
        };
        let profile = config_mgr
            .load_profile(&name)
            .with_context(|| t_fmt("cli.context_load_profile", &[("name", &name)]))?;
        println!("{}", t_fmt("cli.profile_header", &[("name", &name)]));
        println!("{}", serde_json::to_string_pretty(&profile)?);
        return Ok(());
    }

    if let Some(profile_target) = &args.delete_profile {
        let name = match profile_target {
            Some(n) if !n.trim().is_empty() => n.trim().to_string(),
            _ => config_mgr
                .get_default_profile()
                .context(t("cli.context_determine_default"))?,
        };
        let deleted = config_mgr
            .delete_profile(&name)
            .with_context(|| t_fmt("cli.context_delete_profile", &[("name", &name)]))?;
        if deleted {
            info!("{}", t_fmt("cli.profile_deleted", &[("name", &name)]));
        } else {
            info!("{}", t_fmt("cli.profile_not_found", &[("name", &name)]));
        }
        return Ok(());
    }

    if let Some(new_default) = &args.set_default_profile {
        config_mgr
            .set_default_profile(new_default)
            .with_context(|| t_fmt("cli.context_set_default", &[("name", new_default)]))?;
        info!("{}", t_fmt("cli.profile_default_set", &[("name", new_default)]));
        return Ok(());
    }

    if let Some(new_name) = &args.rename_profile_to {
        let current = match &args.profile {
            Some(p) if !p.trim().is_empty() => p.trim().to_string(),
            _ => config_mgr
                .get_default_profile()
                .context(t("cli.context_determine_default"))?,
        };
        config_mgr
            .rename_profile(&current, new_name)
            .with_context(|| t_fmt("cli.context_rename_profile", &[("old", &current), ("new", new_name)]))?;
        info!("{}", t_fmt("cli.profile_renamed", &[("old", &current), ("new", new_name)]));
        return Ok(());
    }

    if let Some(new_mode) = &args.set_default_mode {
        let current = match &args.profile {
            Some(p) if !p.trim().is_empty() => p.trim().to_string(),
            _ => config_mgr
                .get_default_profile()
                .context(t("cli.context_determine_default"))?,
        };
        let mut prof = config_mgr
            .load_profile(&current)
            .with_context(|| t_fmt("cli.context_load_profile", &[("name", &current)]))?;
        prof.default_mode = Some(new_mode.trim().to_lowercase());
        config_mgr.save_profile(&current, &prof)?;
        if !args.cli && !args.run && !args.watch && args.sync.is_none() && !args.clear_db && !args.clear_server {
            return Ok(());
        }
    }

    // Risoluzione della configurazione effettiva
    let config = match config_mgr.get_effective_config(&args) {
        Ok(c) => c,
        Err(err) => {
            error!("{}", t_fmt("cli.config_error", &[("error", &err.to_string())]));
            return Err(err.into());
        }
    };

    info!("{}", t_fmt("cli.active_profile", &[("name", &config.profile)]));
    info!("{}", t_fmt("cli.db_path", &[("path", &config.db_path.display().to_string())]));
    info!("{}", t_fmt("cli.remote_provider", &[("provider", &config.server_type), ("url", &config.url)]));
    if let Some(user) = &config.user {
        info!("{}", t_fmt("cli.remote_user", &[("user", user)]));
    }

    // Connessione al database SQLite locale (o decrittazione trasparente .emb)
    let mut db = DatabaseService::connect(
        &config.db_path,
        config.verbose,
        config.file_password.as_deref(),
        args.create,
    )
    .context(t("cli.context_db_connect"))?;

    // Gestione comandi di pulizia
    if args.clear_db {
        info!("{}", t("cli.cleaning_db_start"));
        db.clear_technical()
            .context(t("cli.context_clear_db"))?;
        db.flush()?;
        info!("{}", t("cli.cleaning_db_done"));
        return Ok(());
    }

    // Inizializzazione Client Remoto tramite Factory
    let mut remote = create_remote_server(&config.server_type, &config.url)
        .context(t("cli.context_remote_create"))?;

    // Gestione credenziali e autenticazione remota
    let mut current_profile = config_mgr.load_profile(&config.profile)?;

    if let (Some(user), Some(pass)) = (&config.user, &config.pass) {
        info!("{}", t("cli.remote_auth_start"));
        match remote.authenticate(user, pass).await {
            Ok(auth) => {
                let uid = auth.user_id.as_deref().unwrap_or("-");
                info!("{}", t_fmt("cli.remote_auth_success", &[("uid", uid)]));
                current_profile.pb_auth_collection = Some(auth.collection.clone());
                if let Ok(enc_tok) = protect(&auth.token, None) {
                    current_profile.encrypted_token = Some(enc_tok);
                }
                let _ = config_mgr.save_profile(&config.profile, &current_profile);
            }
            Err(e) => {
                error!("{}", t_fmt("cli.remote_auth_failed", &[("error", &e.to_string())]));
                return Err(e.into());
            }
        }
    } else if let Some(enc_token) = &current_profile.encrypted_token {
        if let Ok(Some(tok)) = unprotect(enc_token, None) {
            remote.set_token(tok, config.auth_collection.clone());
            match remote.refresh_token().await {
                Ok(refreshed) => {
                    current_profile.pb_auth_collection = Some(refreshed.collection);
                    if let Ok(enc_tok) = protect(&refreshed.token, None) {
                        current_profile.encrypted_token = Some(enc_tok);
                    }
                    let _ = config_mgr.save_profile(&config.profile, &current_profile);
                }
                Err(e) => {
                    error!("{}", t_fmt("cli.remote_token_refresh_failed", &[("error", &e.to_string())]));
                }
            }
        }
    }

    if args.clear_server {
        info!("{}", t("cli.cleaning_server_start"));
        remote
            .clear_remote_server(SYNC_ORDER)
            .await
            .context(t("cli.context_clear_server"))?;
        info!("{}", t("cli.cleaning_server_done"));
        return Ok(());
    }

    // Modalità operativa e ciclo di sincronizzazione
    let requested_mode = if args.run {
        Some("run")
    } else if args.watch {
        Some("watch")
    } else if args.sync.is_some() {
        Some("sync")
    } else {
        Some(config.default_mode.as_str())
    };

    let sync_options = if args.sync.is_some() || args.run || args.watch {
        SyncOptions::from_cli_sync(args.sync.as_ref().or(Some(&None)), config.force, config.verbose)
    } else {
        SyncOptions {
            init: true,
            push: true,
            pull: true,
            force: config.force,
            verbose: config.verbose,
        }
    };

    let runner = SyncRunner::new(
        &mut db,
        remote.as_mut(),
        &config_mgr,
        mmex_sync::sync::runner::RunnerConfig {
            profile_name: config.profile.clone(),
            db_path: &config.db_path,
            mmex_exe: config.mmex_exe.as_deref(),
            default_mode: config.default_mode.clone(),
            options: sync_options,
            last_sync: config.last_sync.clone(),
        },
    );

    runner
        .run(requested_mode)
        .await
        .context(t("cli.context_runner_exec"))?;

    Ok(())
}
