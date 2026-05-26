---
layout: default
title: Sync Setup Guide
nav_order: 2
---

# Synchronization Setup Guide with MMEX Sync

This guide explains the correct procedure to set up the new synchronization system based on **PocketBase**. 

> ⚠️ **Important Note:** Currently, the initialization and database conversion procedure **must be started from a Windows or Linux environment**. It is not possible to perform the initial setup directly from an Android device. See below of you use only Android.

---

## 1. Prerequisites: Account Registration

Before you begin, you need to set up your authentication credentials. You can choose one of the following methods:
* **Online Service:** Register on the unofficial website by filling out the signup form to get your username and password. Please fill out suvery form at [mmex-sync-prudenzano.org](https://mmex-sync-prudenzano.org).
* **Local Docker Instance:** If you prefer to have full control over your data, you can set up and run your own self-hosted PocketBase Docker instance.

---

## 2. Standard Procedure (From Windows to Android or second windows instance)

If you regularly use MoneyManagerEx on Windows, follow these steps:

1. **Prepare your database:** Locate the database file you normally use.
2. **Launch MMEX Sync:** Instead of opening the standard MMEX application, run the modified executable `MMEX Sync`, which acts as a *Sidecar*. 
3. **Configuration & Conversion:** The executable will prompt you for your login credentials (obtained in Step 1). The program will then automatically convert your standard database into a PocketBase-synchronized database.
4. **Windows Setup Complete:** From this point forward, your Windows instance will communicate with PocketBase automatically and seamlessly.
   > ⚠️ **Important:** From this point onward, **do not launch the standard MMEX Windows application directly**, especially if you use scheduled transactions. If you open the standard MMEX without `MMEX Sync` and have "autopost" enabled, you will likely end up with duplicated scheduled transactions (as one will post on Windows and another from Android). Always use the `MMEX Sync` executable.
5. **Android Setup:** * Open the app on your Android device.
   * Initialize the application by choosing the option to download the remote database from PocketBase.
   * Enter your credentials. The device will download the data and will be ready for **offline** use, staying fully synced with Windows through the PocketBase server.

---

---

## 3. Fallback Procedure for Android-Only Users

If you use the application **exclusively on Android** and do not have an active Windows setup, you cannot connect directly to PocketBase from your phone for the initial setup. To activate synchronization, you must perform a one-time manual workaround:

> 💡 **Key Clarifications for Android Users:**
> * **No MMEX installation required on PC:** You do not need to have the standard MoneyManagerEx application installed on the Windows computer. `MMEX Sync` is fully standalone; it works independently to convert your database file and upload it to PocketBase.
> * **Multi-device sync:** This same procedure is valid if you want to sync and connect **multiple Android devices** to the same database. Once the database is on PocketBase, any number of Android devices can connect and sync with it.

1. **Export the database:** Get the current database file from your Android device (if you are using an old cloud sync like Google Drive, download the latest file).
2. **Transfer to Windows:** Manually transfer the database file to a Windows computer (you can use any temporary PC, as the executable is only needed for this initial activation).
3. **Initialization:** On the Windows PC, launch `MMEX Sync` (no MMEX installation needed), enter your credentials, and let the program convert and upload the database to PocketBase.
4. **Back to Android:** Once the upload is complete, open the app on your Android device (or devices), select the remote initialization option, enter your credentials, and download the synced database. From now on, you can continue using Android without needing the Windows PC anymore.

---

## 4. How to Roll Back (Reverting to DB to original)

If you ever wish to disable this synchronization system and return to your previous setup, you can completely revert the process. To do so, close the application and run the following command from the command line where `MMEX Sync` is located:

```bash
mmex-sync --clearServer --clearDB

```

### What this command does:

* **`--clearServer`**: Completely deletes all your synchronized data from the PocketBase server.
* **`--clearDB`**: Restores your local database file by removing all the technical tables and metadata that were required for the synchronization process.

After running this command, your database will return to its standard, standalone format.

* **Account Removal**: If you also want your account to be completely deleted from the online service, simply send an email request to the support team, and we will take care of it.

```
