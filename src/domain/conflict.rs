use crate::domain::model::{LocalRecord, RemoteRecord};

/// Strategia o esito della risoluzione di un conflitto tra record
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConflictResolutionAction {
    /// Applica la versione remota sovrascrivendo quella locale (es. Last-Write-Wins o Pull)
    ApplyRemote,
    /// Mantieni la versione locale (es. timestamp locale più recente)
    KeepLocal,
    /// Sostituisci il record locale riallineando il Primary Key e propagando a cascata le Foreign Key
    ReplaceAndCascadeFk {
        old_pk: i64,
        new_pk: i64,
    },
}

/// Helper di risoluzione conflitti basato su timestamp ISO-8601 UTC
pub fn resolve_lww_conflict(
    local_updated_at: Option<&str>,
    remote_updated_at: Option<&str>,
) -> ConflictResolutionAction {
    match (local_updated_at, remote_updated_at) {
        (Some(loc), Some(rem)) => {
            if rem >= loc {
                ConflictResolutionAction::ApplyRemote
            } else {
                ConflictResolutionAction::KeepLocal
            }
        }
        (None, Some(_)) => ConflictResolutionAction::ApplyRemote,
        (Some(_), None) => ConflictResolutionAction::KeepLocal,
        (None, None) => ConflictResolutionAction::ApplyRemote,
    }
}

/// Determina se l'associazione tra un record locale e uno remoto richiede la propagazione a cascata delle FK
pub fn check_pk_cascade_needed(
    pk_name: &str,
    local: &LocalRecord,
    remote: &RemoteRecord,
) -> Option<(i64, i64)> {
    let local_pk = local.fields.get(pk_name).and_then(|v| v.as_i64())?;
    let remote_pk = remote.fields.get(pk_name).and_then(|v| v.as_i64())?;

    if local_pk != remote_pk {
        Some((local_pk, remote_pk))
    } else {
        None
    }
}
