# AS-IS Technical Specification: 02 — Remote Providers (`RemoteServer` Trait & PocketBase Adapter)

> **Baseline Version:** `0.3.0` (Rust Edition 2021)  
> **Scope:** Hexagonal `RemoteServer` port definition (`src/remoteserver/mod.rs`), factory instantiation (`create_remote_server`), and the concrete `PocketBaseClient` REST implementation (`src/remoteserver/pocketbase.rs`).

---

## 1. Hexagonal Port: `RemoteServer` Trait (`src/remoteserver/mod.rs`)

The synchronization engine (`SyncEngine`) is completely decoupled from concrete HTTP/cloud APIs through the `RemoteServer` trait (`#[async_trait] pub trait RemoteServer: Send + Sync`).

### 1.1 Data Structures

#### `AuthResponse` (`src/remoteserver/mod.rs`)
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthResponse {
    pub token: String,
    pub collection: String,
    pub user_id: Option<String>,
}
```

#### `RemoteRecord` (`src/domain/model.rs`)
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteRecord {
    pub id: String,
    #[serde(default)]
    pub is_deleted: bool,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(flatten)]
    pub fields: HashMap<String, serde_json::Value>,
}
```

### 1.2 Trait Methods Contract

| Method Signature | Purpose & Return Type |
| :--- | :--- |
| `async fn authenticate(&mut self, user: &str, pass: &str) -> Result<AuthResponse, SyncError>` | Authenticates with user identity/email and password, stores the active token and auth collection internally, and returns `AuthResponse`. |
| `async fn refresh_token(&mut self) -> Result<AuthResponse, SyncError>` | Refreshes the currently stored authentication token and updates internal state. |
| `fn is_token_valid(&self) -> bool` | Checks locally whether a non-empty token is present and (if JWT) its `exp` claim is in the future. |
| `fn get_token(&self) -> Option<String>` | Returns a clone of the currently stored token. |
| `fn set_token(&mut self, token: String, auth_collection: Option<String>)` | Restores a previously saved token and optional auth collection name. |
| `fn invalidate_token(&mut self)` | Clears `self.token` (`None`). |
| `fn get_auth_collection(&self) -> Option<String>` | Returns the active authentication collection name (e.g., `"users"` or `"_superusers"`). |
| `async fn get_full_list(&self, collection: &str, filter: Option<&str>) -> Result<Vec<RemoteRecord>, SyncError>` | Downloads all pages of records from `collection`, optionally filtered by `filter`, sorted by `_updated_at`. |
| `async fn get_by_row_id(&self, collection: &str, row_id: i64) -> Result<Option<RemoteRecord>, SyncError>` | Queries `collection` for a record whose local Primary Key column (looked up via `get_table_config(collection).pk`) equals `row_id`. |
| `async fn get_by_unique_keys(&self, collection: &str, keys: &[(&str, &str)]) -> Result<Option<RemoteRecord>, SyncError>` | Queries `collection` for an active (`_is_deleted = 0`) record matching all `(column, value)` pairs. |
| `async fn get_by_id(&self, collection: &str, id: &str) -> Result<Option<RemoteRecord>, SyncError>` | Fetches a single record by its remote `id` (`None` on HTTP `404`). |
| `async fn create(&self, collection: &str, data: &HashMap<String, Value>) -> Result<RemoteRecord, SyncError>` | Creates a new record in `collection`. Maps uniqueness violations to `SyncError::UniqueConstraintViolation`. |
| `async fn update(&self, collection: &str, id: &str, data: &HashMap<String, Value>) -> Result<RemoteRecord, SyncError>` | Updates record `id` in `collection`. Maps `404` to `SyncError::NotFound`, `409` to `SyncError::Conflict`, and uniqueness violations to `SyncError::UniqueConstraintViolation`. |
| `async fn delete(&self, collection: &str, id: &str) -> Result<(), SyncError>` | Hard-deletes record `id` in `collection` (treats HTTP `404` as `Ok(())`). |
| `async fn clear_remote_server(&self, sync_order: &[&str]) -> Result<(), SyncError>` | Iterates through `sync_order` in **reverse order**, fetches all records in each collection, and calls `delete()` on every record. |

### 1.3 Provider Factory (`create_remote_server`)
```rust
pub fn create_remote_server(
    server_type: &str,
    url: &str,
) -> Result<Box<dyn RemoteServer>, SyncError>
```
- Matches `server_type.to_lowercase().as_str()`:
  - `"pocketbase"` -> `Ok(Box::new(PocketBaseClient::new(url)?))`
  - Any other value -> `Err(SyncError::Config(t_fmt("remote.unsupported_provider", &[("provider", other)])))`

---

## 2. PocketBase Adapter Implementation (`src/remoteserver/pocketbase.rs`)

### 2.1 Initialization & HTTP Headers
- `PocketBaseClient::new(url)` strips any trailing `/` from `url` (`url.trim_end_matches('/')`) and builds a `reqwest::Client` using pure-Rust `rustls-tls`.
- `auth_headers()` sets:
  - `Content-Type: application/json`
  - `Authorization: <token>` (raw token value without a `"Bearer "` prefix, which PocketBase accepts directly).

### 2.2 Authentication & Fallback Flow (`authenticate` & `refresh_token`)
1. **Primary Attempt (`users` collection):**
   - `POST {base_url}/api/collections/users/auth-with-password`
   - Body: `{"identity": user, "password": pass}`
   - On HTTP 2xx: stores `self.token = Some(token)` and `self.auth_collection = Some("users")`, returning `AuthResponse`.
2. **Fallback Attempt (`_superusers` collection):**
   - If the `users` attempt fails for any reason, logs a debug message and retries against:
     `POST {base_url}/api/collections/_superusers/auth-with-password`
   - On HTTP 2xx: stores `self.token = Some(token)` and `self.auth_collection = Some("_superusers")`.
   - On failure: returns `SyncError::RemoteAuth`.
3. **Token Refresh (`refresh_token`):**
   - Uses `self.auth_collection.as_deref().unwrap_or("users")`.
   - `POST {base_url}/api/collections/{collection}/auth-refresh` with `auth_headers()`.
   - Updates `self.token` with the newly issued token.
4. **Local JWT Expiration Check (`is_token_valid`):**
   - Splits token on `'.'`. If at least 2 parts exist, Base64URL-decodes (`BASE64_URL_SAFE_NO_PAD`) `parts[1]`, parses JSON, and checks if `"exp"` (i64 Unix timestamp) is strictly greater than `Utc::now().timestamp()`.
   - If the token is non-empty but does not contain a parseable `"exp"` claim, returns `true`.

### 2.3 Endpoints, Pagination, and Filtering

| Operation | HTTP Method & URL | Query Parameters / Notes |
| :--- | :--- | :--- |
| **`get_full_list`** | `GET {base_url}/api/collections/{collection}/records` | `page={page}&perPage=500&sort=_updated_at` (`&filter={url_encoded}` if `filter` is `Some`). Loops incrementing `page` starting at `1` until `page >= totalPages` or `items.is_empty()`. |
| **`get_by_row_id`** | `GET {base_url}/api/collections/{collection}/records` | Looks up `pk = get_table_config(collection)?.pk`. Builds filter `{pk} = "{row_id}"` with `page=1&perPage=1`. Returns `Ok(None)` on non-2xx status or empty items. |
| **`get_by_unique_keys`** | `GET {base_url}/api/collections/{collection}/records` | Escapes `"` as `\"` in each value, builds `{k1} = "{v1}" && {k2} = "{v2}" && _is_deleted = 0` with `page=1&perPage=1`. Returns `Ok(None)` on non-2xx status or empty items. |
| **`get_by_id`** | `GET {base_url}/api/collections/{collection}/records/{id}` | Returns `Ok(None)` on `404 Not Found`, `Err(SyncError::RemoteApi)` on other non-2xx responses. |
| **`create`** | `POST {base_url}/api/collections/{collection}/records` | Sends JSON `data`. On `400 Bad Request`, inspects `data.<field>.code == "validation_not_unique"` to return `SyncError::UniqueConstraintViolation`. |
| **`update`** | `PATCH {base_url}/api/collections/{collection}/records/{id}` | Sends JSON `data`. Maps `404` -> `SyncError::NotFound`, `409` -> `SyncError::Conflict`, `400` with `validation_not_unique` -> `SyncError::UniqueConstraintViolation`. |
| **`delete`** | `DELETE {base_url}/api/collections/{collection}/records/{id}` | Treats `404 Not Found` as `Ok(())` (idempotent deletion). |

### 2.4 JSON Mapping (`parse_pb_record`)
When PocketBase returns a record JSON object, `PocketBaseClient::parse_pb_record` transforms it into `RemoteRecord`:
- **`id`**: Extracted from `obj.get("id")?.as_str()?`.
- **`is_deleted`**: Extracted from `obj.get("_is_deleted")`:
  - If JSON boolean: its boolean value.
  - If JSON number: `n.as_i64().unwrap_or(0) != 0`.
  - Otherwise / missing: `false`.
- **`updated_at`**: Extracted from `obj.get("_updated_at")` or fallback `obj.get("updated")` as `Option<String>`.
- **`fields`**: All remaining keys in the JSON object **excluding** the PocketBase system/technical keys:
  - `"id"`
  - `"collectionId"`
  - `"collectionName"`
  - `"created"`
  - `"updated"`
  - `"_is_deleted"`
  - `"_updated_at"`

### 2.5 Custom URL Encoding (`urlencoding_simple`)
Filter strings are percent-encoded byte-by-byte:
- Unescaped: `a-z`, `A-Z`, `0-9`, `-`, `_`, `.`, `~`
- Space (`' '`): `%20`
- All other bytes: `%{byte:02X}`

---

## Invarianti di Sistema

1. **Dual-Collection Authentication Fallback:** PocketBase authentication MUST try the `"users"` collection first and automatically fall back to `"_superusers"` if `"users"` fails, preserving compatibility with both standard multi-user deployments and self-hosted admin setups.
2. **Metadata Stripping on Record Ingress:** `parse_pb_record` MUST strip PocketBase envelope fields (`id`, `collectionId`, `collectionName`, `created`, `updated`, `_is_deleted`, `_updated_at`) from `RemoteRecord.fields` so they are never treated as MMEX SQLite columns during `INSERT`/`UPDATE`.
3. **Flexible `_is_deleted` Deserialization:** `_is_deleted` MUST accept both boolean (`true`/`false`) and numeric (`1`/`0`) representations from the remote JSON payload.
4. **Semantic HTTP Error Mapping:**
   - HTTP `400` containing `data.<field>.code == "validation_not_unique"` MUST be mapped to `SyncError::UniqueConstraintViolation` so the sync engine can trigger automatic uniqueness conflict resolution instead of failing the record.
   - HTTP `404` on `update` MUST be mapped to `SyncError::NotFound` so the sync engine can automatically fall back to `create`.
   - HTTP `404` on `delete` MUST be treated as `Ok(())` (idempotent delete).
   - HTTP `409` on `update` MUST be mapped to `SyncError::Conflict` to trigger Last-Write-Wins resolution.
5. **Reverse Topological Order on Server Wipe:** `clear_remote_server` MUST iterate through `SYNC_ORDER` in reverse order (from Level 4 dependent tables up to Level 1 independent tables) to avoid foreign-key constraint errors on the remote backend.

