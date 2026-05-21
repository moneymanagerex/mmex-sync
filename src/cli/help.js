// src/cli/help.js

export function showHelp() {
  console.log(`
===========================================================
🚀 MMEX-PocketBase Sync Tool | User Manual
===========================================================

Usage: mmex-sync [PARAMETERS] [MODE]

-----------------------------------------------------------
📂 PROFILE AND CONFIGURATION MANAGEMENT
-----------------------------------------------------------
  --profile=name      Selects the profile (e.g., 'home', 'work'). 
                      Default: 'default'
  --ignoreProfile     Ignore profile configuration and use default values
  --listProfile       Shows the list of available profiles
  --showProfile[=name] Shows profile information (content of profile)
  --db=path           Path to the MoneyManagerEx .mmb file
  --url=address       URL of the PocketBase instance
  --user=email        PocketBase login email
  --pass=password     Password (not saved, generates a token)
  --setDefaultMode=X  Sets the default mode for the profile
                      Values: sync (default), run, watch
  --exe=path          Path to the MMEX.exe executable
                      Default: C:\\Program Files\\MoneyManagerEx\\bin\\mmex.exe					  
  --create            Delete and Recreates a new empty database
  --verbose           Shows detailed logs of each operation.

-----------------------------------------------------------
🕹️ SYNCHRONIZATION MODES
-----------------------------------------------------------
  --sync              Executes the complete cycle (Init + Push + Pull).
  --sync=op1,op2      Executes only specified operations.
                      Available operations: init, push, pull
  --force             Ignore flag and timestamp and process all records

  Examples:
    node index.js --sync=pull           (Download remote data only)
    node index.js --sync=init           (Initialize without transmitting anything)
    node index.js --sync --force        (Full cycle with total send and receive)

-----------------------------------------------------------
🕹️ OPERATING MODES
-----------------------------------------------------------
  --run               1. Initial Sync 
                      2. Opens MMEX and waits for closure
                      3. Final Sync
  --watch             1. Initial Sync
                      2. Opens MMEX (detached)
                      3. Monitors local/remote changes in real-time

-----------------------------------------------------------
⚡ FORCING AND MAINTENANCE COMMANDS
-----------------------------------------------------------

-----------------------------------------------------------
🧹 CLEANUP (Warning!)
   These commands are executed alone. 
   Other parameters are ignored.
-----------------------------------------------------------
  --clearDb           Removes technical columns and triggers from the local DB.
  --clearServer       Removes all data from the collections on the server.

Example:
  node index.js --profile=casa --watch --verbose
===========================================================
    `);
}