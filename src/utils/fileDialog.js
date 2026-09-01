import { exec } from 'child_process';
import os from 'os';

/**
 * Opens a native OS file dialog and resolves with the chosen absolute file path.
 * @param {object} options
 * @param {'database' | 'executable' | 'all'} [options.type='database']
 * @param {string} [options.title='Select File']
 * @returns {Promise<string|null>} Selected absolute path, or null if cancelled.
 */
export function openNativeFileDialog({ type = 'database', title = 'Select File' } = {}) {
    return new Promise((resolve) => {
        const platform = os.platform();

        if (platform === 'win32') {
            let filter = 'MMEX Database (*.mmb;*.emb)|*.mmb;*.emb|MMEX File (*.mmb)|*.mmb|Encrypted File (*.emb)|*.emb|Database (*.db;*.sqlite)|*.db;*.sqlite|All Files (*.*)|*.*';
            if (type === 'executable') {
                filter = 'Executables (*.exe)|*.exe|All Files (*.*)|*.*';
            }

            const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Filter = '${filter}'
$dialog.Title = '${title}'
$dialog.CheckFileExists = $true
$dialog.CheckPathExists = $true
$dialog.RestoreDirectory = $true
$dialog.SupportMultiDottedExtensions = $true

$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.Opacity = 0
$owner.ShowInTaskbar = $false
$owner.Show()
$owner.Activate()
$owner.BringToFront()

$result = $dialog.ShowDialog($owner)
$owner.Dispose()

if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [Console]::WriteLine($dialog.FileName)
}
`;
            const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
            exec(
                `powershell.exe -STA -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
                { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
                (err, stdout, stderr) => {
                    if (err) {
                        console.error('[FileDialog Error]', err.message, stderr);
                        return resolve(null);
                    }
                    const selected = stdout.trim();
                    console.log('[FileDialog Selected]', selected);
                    resolve(selected || null);
                }
            );
        } else if (platform === 'darwin') {
            let applescript = '';
            if (type === 'database') {
                applescript = `osascript -e 'POSIX path of (choose file of type {"mmb", "emb"} with prompt "${title}")'`;
            } else {
                applescript = `osascript -e 'POSIX path of (choose file with prompt "${title}")'`;
            }
            exec(applescript, { encoding: 'utf8' }, (err, stdout) => {
                if (err) return resolve(null);
                const selected = stdout.trim();
                resolve(selected || null);
            });
        } else {
            // Linux: Try zenity then kdialog
            let zenityCmd = `zenity --file-selection --title="${title}"`;
            if (type === 'database') {
                zenityCmd += ` --file-filter="MMEX Database (*.mmb *.emb) | *.mmb *.emb" --file-filter="All Files | *"`;
            }
            exec(zenityCmd, { encoding: 'utf8' }, (err, stdout) => {
                if (!err && stdout.trim()) {
                    return resolve(stdout.trim());
                }
                let kdialogCmd = `kdialog --getopenfilename . "*.mmb *.emb" --title "${title}"`;
                exec(kdialogCmd, { encoding: 'utf8' }, (err2, stdout2) => {
                    if (!err2 && stdout2.trim()) {
                        return resolve(stdout2.trim());
                    }
                    resolve(null);
                });
            });
        }
    });
}
