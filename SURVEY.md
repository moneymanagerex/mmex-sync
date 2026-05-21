# Money Manager Ex Sync - Professional Cloud Synchronization

Stop worrying about corrupted databases or data loss. I am developing a **record-level synchronization** engine for Money Manager Ex designed to provide a safe, modern, and multi-device experience.

![Money Manager Ex Sync - Record-Level Safe Sync Banner](assets/images/mmex-sync-banner.png)


**Demo Video between Windows & Android**
[Demo Video between Windows & Android🤩](https://drive.google.com/file/d/1pKFcdcNuf47BQDFQAtPBOCC_B_BfgwxF/view)


## 🛡️ Why This is Different
Most users currently sync MMEX by moving the entire `.mmb` file via Dropbox, Google Drive, or Syncthing. **This is dangerous.** If two devices save at the same time, one version is lost forever.

**My solution solves this:**
- **Record-Level Sync:** We don't sync the file; we sync individual transactions. 
- **Conflict Resolution:** If you add an expense on your phone and another on your PC, they are merged intelligently.
- **No More Corrupted Files:** Since we don't overwrite the whole database, the risk of file corruption is virtually eliminated.
- **Offline-First:** Work offline as usual; the sync engine merges your changes as soon as you are back online.

## 📁 What about attachments? (Receipts, PDFs)
Standard file-sync methods simply cannot sync attachments.

- I am investigating a **Cloud Attachment Storage** feature.
- This would allow you to take a photo of a receipt on your phone and have it immediately available on your PC, safely stored in a dedicated cloud space.

## 📊 Help Shape the Future
I am building this to fix the most annoying limitation of MMEX. I need to know how you'd like to use it:

### [👉 Take the 2-minute Survey here](https://docs.google.com/forms/d/e/1FAIpQLSfGGjVGEvB14j_h_dSCHGTs3W5N9RqmwBNYAgLtr6382zrtqQ/viewform?usp=publish-editor)

*Tell me if you prefer to self-host your sync server or if you want a "zero-effort" managed service.*

---

## 🚀 Key Features
- **Seamless Merge:** Windows, Android, and Linux working together on the same data (and probabily also iOS).
- **Transparent Integration:** Use the official MMEX desktop app exactly as you do today.
- **Enhanced Security:** Your data remains yours. The sync engine acts as a secure bridge, not a data harvester.

---

## 🔒 Privacy & Reliability
- **Your Email:** Only used to notify you about Beta access or major releases.
- **Your Data:** Used strictly for synchronization purposes. 
- **No Spam:** I am a developer, not a marketer. Your privacy is a priority.

---

## 🛠 Project Status
This project is currently a **Proof of Concept (POC)**. It proves that we can modernize MMEX sync without risking the stability of the core application. 

- **GitHub Repository:** [wolfsolver/money_manager_ex_sync_poc](https://github.com/wolfsolver/money_manager_ex_sync_poc)

