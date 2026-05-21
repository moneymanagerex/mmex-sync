# PocketBase Configuration for MMEX Sync POC

To test the POC, you need a PocketBase instance configured with the correct collection and permissions.

## 0. setup

1. Download PocketBase from [PocketBase website](https://pocketbase.io/) (chose your distribution)
2. Run pocketbase serve
3. Open your PocketBase Admin UI (usually `http://127.0.0.1:8090/_/`).
4. Create first adminuser

## 1. Fast Setup (Import Schema)
1. Open your PocketBase Admin UI (usually `http://127.0.0.1:8090/_/`).
2. Go to **Settings** > **Import collections**.
3. Paste the contents of `pb_schema_selfhost.json` (found in this folder) into the JSON field.
4. Click **Review** and then **Import**.


## 3. API Rules (Security)
Do not use selfhosted with user collection. uses only with superadmin user. In other words Selfhosted **DOES NOT** support multiuser. 

## 4. Run selfhosted
Run pocketbase from the root of the folder where the 'pb_data' folder is located:

```bash
./pocketbase serve
```
