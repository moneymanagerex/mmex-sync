use base64::prelude::*;
use mmex_sync::remoteserver::{create_remote_server, PocketBaseClient, RemoteServer};

#[test]
fn test_factory_creation() {
    let client =
        create_remote_server("pocketbase", "http://127.0.0.1:8090").expect("create pocketbase");
    assert_eq!(client.get_token(), None);
    assert_eq!(client.get_auth_collection(), Some("users".to_string()));
    assert!(!client.is_token_valid());

    let invalid = create_remote_server("unknown_provider", "http://127.0.0.1:8090");
    assert!(invalid.is_err());
}

#[tokio::test]
async fn test_failed_auth_keeps_users_collection_internally() {
    let mut client = PocketBaseClient::new("http://127.0.0.1:1").expect("client new");
    // Impostiamo temporaneamente una collection diversa per verificare il ripristino a "users" in caso di errore
    client.set_token("dummy".to_string(), Some("_superusers".to_string()));
    assert_eq!(
        client.get_auth_collection(),
        Some("_superusers".to_string())
    );

    // L'autenticazione verso una porta chiusa fallirà sia su "users" sia su "_superusers"
    let res = client.authenticate("test@example.com", "wrong").await;
    assert!(res.is_err());
    assert_eq!(
        client.get_auth_collection(),
        Some("users".to_string()),
        "In caso di fallimento di entrambi i tentativi, la collection interna deve rimanere 'users'"
    );
}

#[test]
fn test_token_lifecycle_and_jwt_validation() {
    let mut client = PocketBaseClient::new("http://127.0.0.1:8090").expect("client new");
    assert_eq!(client.get_token(), None);
    assert!(!client.is_token_valid());

    // Simuliamo un JWT valido con scadenza nel futuro (anno 2030)
    let header = BASE64_URL_SAFE_NO_PAD.encode(r#"{"alg":"HS256","typ":"JWT"}"#);
    let future_exp = 1900000000i64; // ben oltre il 2026
    let payload =
        BASE64_URL_SAFE_NO_PAD.encode(format!(r#"{{"id":"user_123","exp":{}}}"#, future_exp));
    let valid_jwt = format!("{}.{}.fake_signature", header, payload);

    client.set_token(valid_jwt.clone(), Some("users".to_string()));
    assert_eq!(client.get_token(), Some(valid_jwt));
    assert_eq!(client.get_auth_collection(), Some("users".to_string()));
    assert!(client.is_token_valid());

    // Simuliamo un JWT scaduto nel passato (anno 2020)
    let past_exp = 1580000000i64;
    let expired_payload =
        BASE64_URL_SAFE_NO_PAD.encode(format!(r#"{{"id":"user_123","exp":{}}}"#, past_exp));
    let expired_jwt = format!("{}.{}.fake_signature", header, expired_payload);

    client.set_token(expired_jwt, None);
    assert!(
        !client.is_token_valid(),
        "Il token con scadenza passata deve risultare non valido"
    );

    // Invalidazione del token
    client.invalidate_token();
    assert_eq!(client.get_token(), None);
    assert!(!client.is_token_valid());
}
