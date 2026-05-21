# MMEX Sync POC - Privacy Policy & Disclaimer

### 1. Purpose of the POC
This service is a **Proof of Concept (POC)** designed strictly for technical testing of the record-level synchronization engine for Money Manager Ex. It is not a commercial product.

### 2. Assumption of Risk & Liability (Disclaimer)
* **Production Database Risk**: While the system is designed to be safe, using this POC with a **production or real financial database** is done at the user's own risk. By using this service, the user explicitly accepts all risks of potential data loss, corruption, or inconsistency within their local SQLite (`.mmb`) file.
* **No Liability**: The developer shall not be held responsible for any financial discrepancies, loss of information, or damages arising from the use of this experimental synchronization tool.
* **No Guarantees**: The service is provided "AS-IS" without any warranties regarding uptime, data integrity, or synchronization accuracy.

### 3. Data Privacy & Handling
* **No Data Inspection**: The developer **does not read, process, or use the synchronized data** for debugging, validation, or any other purposes. Data remains private and isolated to the user's account.
* **Support & Debugging**: If an user encounters an issue, they are encouraged to report it via **GitHub Issues**. Debugging will be handled through logs or samples provided voluntarily by the user, never by inspecting the cloud database.
* **Data Ownership & Persistence**: 
    * All financial data remains stored on the **user's local device**. 
    * The cloud synchronization serves only as a bridge to simplify data distribution between devices.
    * **Cloud deletion does not imply local deletion**: Deleting records or account data from the cloud service will not result in the deletion of the local database on the user's PC.

### 4. Security & Multi-tenancy
* **Isolation**: Each user's data is strictly isolated via a multi-tenant architecture. Access is restricted to the authenticated owner through server-side hooks.
* **Encryption**: Data transmission between the Sidecar/Android app and the cloud is encrypted via HTTPS.

### 5. User Agreement
By creating an account and using the MMEX Sync POC, you acknowledge that you have read, understood, and agreed to these terms. You are strongly advised to **backup your local database** before performing any synchronization tasks.
