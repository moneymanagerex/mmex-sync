/**
 * MMEX-Sync Web UI Client Application
 */

// Application State
let state = {
    profiles: [],
    defaultProfile: null
};

// DOM Elements
const wizardView = document.getElementById('wizard-view');
const dashboardView = document.getElementById('dashboard-view');
const profilesGrid = document.getElementById('profiles-grid');
const btnRefresh = document.getElementById('btn-refresh');
const btnCreateTop = document.getElementById('btn-create-top');
const toastContainer = document.getElementById('toast-container');

// Profile Modal Elements
const profileModal = document.getElementById('profile-modal');
const modalTitle = document.getElementById('modal-title');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalCancelBtn = document.getElementById('modal-cancel-btn');
const profileForm = document.getElementById('profile-form');
const formIsEdit = document.getElementById('form-is-edit');
const formOriginalName = document.getElementById('form-original-name');
const profileNameInput = document.getElementById('profile-name');
const profileDbPathInput = document.getElementById('profile-dbPath');
const profileEmbGroup = document.getElementById('profile-emb-group');
const profileFilePasswordInput = document.getElementById('profile-filePassword');
const profileSavePasswordInput = document.getElementById('profile-savePassword');
const embPasswordStatus = document.getElementById('emb-password-status');
const profilePbUrlInput = document.getElementById('profile-pbUrl');
const profilePbUserInput = document.getElementById('profile-pbUser');
const profilePbPassInput = document.getElementById('profile-pbPass');
const pbTokenStatus = document.getElementById('pb-token-status');
const profileDefaultModeSelect = document.getElementById('profile-defaultMode');
const profileMmexExeInput = document.getElementById('profile-mmexExe');
const profileIsDefaultInput = document.getElementById('profile-isDefault');

// Wizard Elements
const wizardForm = document.getElementById('wizard-form');
const wizardDbPathInput = document.getElementById('wizard-dbPath');
const wizardEmbGroup = document.getElementById('wizard-emb-group');

// Rename Modal Elements
const renameModal = document.getElementById('rename-modal');
const renameForm = document.getElementById('rename-form');
const renameTarget = document.getElementById('rename-target');
const renameNewName = document.getElementById('rename-new-name');
const renameCloseBtn = document.getElementById('rename-close-btn');
const renameCancelBtn = document.getElementById('rename-cancel-btn');

// Delete Modal Elements
const deleteModal = document.getElementById('delete-modal');
const deleteProfileNameSpan = document.getElementById('delete-profile-name');
const deleteConfirmBtn = document.getElementById('delete-confirm-btn');
const deleteCloseBtn = document.getElementById('delete-close-btn');
const deleteCancelBtn = document.getElementById('delete-cancel-btn');
let profileToDelete = null;

// Exit / Shutdown Elements
const btnExit = document.getElementById('btn-exit');
const exitModal = document.getElementById('exit-modal');
const exitCloseBtn = document.getElementById('exit-close-btn');
const exitCancelBtn = document.getElementById('exit-cancel-btn');
const exitConfirmBtn = document.getElementById('exit-confirm-btn');
const shutdownScreen = document.getElementById('shutdown-screen');

// ==========================================
// Toast Notification Utility
// ==========================================
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';

    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ==========================================
// Dynamic EMB Password Visibility
// ==========================================
function checkEmbPath(inputEl, groupEl) {
    const val = (inputEl.value || '').trim();
    if (val.toLowerCase().endsWith('.emb')) {
        groupEl.classList.remove('hidden');
    } else {
        groupEl.classList.add('hidden');
    }
}

wizardDbPathInput.addEventListener('input', () => checkEmbPath(wizardDbPathInput, wizardEmbGroup));
profileDbPathInput.addEventListener('input', () => checkEmbPath(profileDbPathInput, profileEmbGroup));

// Global Click Delegation for Dynamic & Static Action Buttons
document.addEventListener('click', async (e) => {
    // 1. Native File Browser buttons
    const browseBtn = e.target.closest('.btn-browse-file');
    if (browseBtn) {
        e.preventDefault();
        e.stopPropagation();
        const targetId = browseBtn.dataset.target;
        const targetInput = document.getElementById(targetId);
        const fileType = browseBtn.dataset.type || 'database';
        
        browseBtn.disabled = true;
        try {
            const title = fileType === 'executable' ? 'Select MMEX Executable' : 'Select Money Manager Ex Database';
            const res = await fetch('/api/system/browse-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: fileType, title })
            });
            const data = await res.json();
            if (data.success && data.path) {
                if (targetInput) {
                    targetInput.value = data.path;
                    targetInput.dispatchEvent(new Event('input', { bubbles: true }));
                    targetInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
                if (targetId === 'wizard-dbPath') {
                    checkEmbPath(wizardDbPathInput, wizardEmbGroup);
                } else if (targetId === 'profile-dbPath') {
                    checkEmbPath(profileDbPathInput, profileEmbGroup);
                }
                showToast(`Selected: ${data.path}`, 'success');
            }
        } catch (err) {
            showToast('Failed to open file browser: ' + err.message, 'error');
        } finally {
            browseBtn.disabled = false;
        }
        return;
    }

    // 2. Auto-detect MMEX Path buttons
    const detectBtn = e.target.closest('.btn-detect-mmex');
    if (detectBtn) {
        e.preventDefault();
        e.stopPropagation();
        const targetId = detectBtn.dataset.target;
        const targetInput = document.getElementById(targetId);
        try {
            const res = await fetch('/api/system/detect-mmex');
            const data = await res.json();
            if (data.success && data.mmexPath) {
                targetInput.value = data.mmexPath;
                showToast(`MMEX detected: ${data.mmexPath}`, 'success');
            } else {
                showToast('MMEX executable not found in standard paths.', 'error');
            }
        } catch (err) {
            showToast('Failed to auto-detect MMEX path.', 'error');
        }
        return;
    }
});

// ==========================================
// API Interaction & Profile Rendering
// ==========================================
async function fetchProfiles() {
    try {
        const res = await fetch('/api/profiles');
        const data = await res.json();
        if (data.success) {
            state.profiles = data.profiles || [];
            state.defaultProfile = data.defaultProfile;
            renderView();
        } else {
            showToast(data.error || 'Error loading profiles', 'error');
        }
    } catch (err) {
        showToast(`Failed to connect to backend: ${err.message}`, 'error');
    }
}

function renderView() {
    if (state.profiles.length === 0) {
        // First Run Wizard Mode
        wizardView.classList.remove('hidden');
        dashboardView.classList.add('hidden');
        btnCreateTop.classList.add('hidden');
    } else {
        // Dashboard Mode
        wizardView.classList.add('hidden');
        dashboardView.classList.remove('hidden');
        btnCreateTop.classList.remove('hidden');
        renderProfilesGrid();
    }
}

function renderProfilesGrid() {
    profilesGrid.innerHTML = '';

    state.profiles.forEach(p => {
        const isDefault = p.isDefault || p.name === state.defaultProfile;
        const isEmb = (p.dbPath || '').toLowerCase().endsWith('.emb');
        const dbFormat = isEmb ? 'EMB' : 'MMB';

        const card = document.createElement('div');
        card.className = `profile-card ${isDefault ? 'is-default' : ''}`;

        card.innerHTML = `
            <div class="profile-card-header">
                <div class="profile-title-area">
                    <span class="profile-name">${escapeHtml(p.name)}</span>
                    ${isDefault ? '<span class="badge badge-default">★ Default</span>' : ''}
                    <span class="badge badge-mode">${escapeHtml((p.defaultMode || 'run').toUpperCase())}</span>
                </div>
            </div>

            <div class="profile-details">
                <div class="detail-row">
                    <span class="detail-label">Database</span>
                    <span class="detail-value highlight">
                        <span class="badge badge-format">${dbFormat}</span>
                        ${escapeHtml(p.dbPath || 'Not configured')}
                    </span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Server</span>
                    <span class="detail-value">${escapeHtml(p.pbUrl || 'Not configured')}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">User</span>
                    <span class="detail-value">${escapeHtml(p.pbUser || 'Not configured')}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Executable</span>
                    <span class="detail-value">${escapeHtml(p.mmexExe || 'Default system')}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Last Sync</span>
                    <span class="detail-value">${p.lastSync ? new Date(p.lastSync).toLocaleString() : 'Never'}</span>
                </div>
            </div>

            <div class="profile-card-actions">
                <div>
                    ${!isDefault ? `
                        <button class="btn btn-secondary btn-icon btn-set-default" data-name="${escapeHtml(p.name)}" title="Set as Default">
                            <span>Set Default</span>
                        </button>
                    ` : '<span class="text-subtle" style="font-size:0.8rem;">Active Default</span>'}
                </div>
                <div class="actions-group">
                    <button class="btn btn-secondary btn-icon btn-edit" data-name="${escapeHtml(p.name)}" title="Edit Profile">
                        <span>Edit</span>
                    </button>
                    <button class="btn btn-secondary btn-icon btn-rename" data-name="${escapeHtml(p.name)}" title="Rename Profile">
                        <span>Rename</span>
                    </button>
                    <button class="btn btn-danger btn-icon btn-delete" data-name="${escapeHtml(p.name)}" title="Delete Profile">
                        <span>Delete</span>
                    </button>
                </div>
            </div>
        `;

        profilesGrid.appendChild(card);
    });

    // Attach event listeners to card action buttons
    document.querySelectorAll('.btn-set-default').forEach(btn => {
        btn.addEventListener('click', () => setDefaultProfile(btn.dataset.name));
    });
    document.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', () => openEditModal(btn.dataset.name));
    });
    document.querySelectorAll('.btn-rename').forEach(btn => {
        btn.addEventListener('click', () => openRenameModal(btn.dataset.name));
    });
    document.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', () => openDeleteModal(btn.dataset.name));
    });
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ==========================================
// Profile Actions (Set Default, Delete, Rename)
// ==========================================
async function setDefaultProfile(name) {
    try {
        const res = await fetch(`/api/profile/${encodeURIComponent(name)}/default`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast(`Profile '${name}' set as default!`, 'success');
            await fetchProfiles();
        } else {
            showToast(data.error || 'Failed to set default profile', 'error');
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function openRenameModal(name) {
    renameTarget.value = name;
    renameNewName.value = name;
    renameModal.classList.remove('hidden');
    renameNewName.focus();
}

function closeRenameModal() {
    renameModal.classList.add('hidden');
}

renameCloseBtn.addEventListener('click', closeRenameModal);
renameCancelBtn.addEventListener('click', closeRenameModal);

renameForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const target = renameTarget.value;
    const newName = renameNewName.value.trim();

    if (!newName) {
        showToast('Please enter a new name', 'error');
        return;
    }

    try {
        const res = await fetch(`/api/profile/${encodeURIComponent(target)}/rename`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newName })
        });
        const data = await res.json();
        if (data.success) {
            showToast(data.message, 'success');
            closeRenameModal();
            await fetchProfiles();
        } else {
            showToast(data.error || 'Failed to rename profile', 'error');
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
});

function openDeleteModal(name) {
    profileToDelete = name;
    deleteProfileNameSpan.textContent = `'${name}'`;
    deleteModal.classList.remove('hidden');
}

function closeDeleteModal() {
    profileToDelete = null;
    deleteModal.classList.add('hidden');
}

deleteCloseBtn.addEventListener('click', closeDeleteModal);
deleteCancelBtn.addEventListener('click', closeDeleteModal);

deleteConfirmBtn.addEventListener('click', async () => {
    if (!profileToDelete) return;
    try {
        const res = await fetch(`/api/profile/${encodeURIComponent(profileToDelete)}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            showToast(data.message, 'success');
            closeDeleteModal();
            await fetchProfiles();
        } else {
            showToast(data.error || 'Failed to delete profile', 'error');
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
});

// ==========================================
// Create & Edit Modal
// ==========================================
function openCreateModal() {
    modalTitle.textContent = 'Create New Profile';
    formIsEdit.value = 'false';
    formOriginalName.value = '';
    profileForm.reset();
    profileNameInput.disabled = false;
    profileIsDefaultInput.checked = state.profiles.length === 0;
    embPasswordStatus.textContent = '';
    pbTokenStatus.textContent = '';
    profileEmbGroup.classList.add('hidden');

    profileModal.classList.remove('hidden');
    profileNameInput.focus();
}

async function openEditModal(name) {
    modalTitle.textContent = `Edit Profile: ${name}`;
    formIsEdit.value = 'true';
    formOriginalName.value = name;
    profileForm.reset();

    try {
        const res = await fetch(`/api/profile/${encodeURIComponent(name)}`);
        const data = await res.json();
        if (!data.success || !data.profile) {
            showToast(data.error || 'Failed to load profile details', 'error');
            return;
        }

        const p = data.profile;
        profileNameInput.value = p.name;
        profileNameInput.disabled = true; // Use rename button to change name
        profileDbPathInput.value = p.dbPath || '';
        profilePbUrlInput.value = p.pbUrl || 'http://127.0.0.1:8090';
        profilePbUserInput.value = p.pbUser || '';
        profileDefaultModeSelect.value = p.defaultMode || 'run';
        profileMmexExeInput.value = p.mmexExe || '';
        profileIsDefaultInput.checked = p.isDefault || p.name === state.defaultProfile;

        // Password & Token info
        pbTokenStatus.textContent = p.hasToken ? '🔑 Saved remote session active' : 'No active session token';
        if (p.hasPassword) {
            embPasswordStatus.textContent = '🔒 Encrypted password saved in profile';
        } else {
            embPasswordStatus.textContent = p.savePassword === 'no' ? '⚠️ Configured to ask every time' : 'No password saved';
        }
        profileSavePasswordInput.checked = p.savePassword !== 'no';

        checkEmbPath(profileDbPathInput, profileEmbGroup);
        profileModal.classList.remove('hidden');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function closeProfileModal() {
    profileModal.classList.add('hidden');
}

modalCloseBtn.addEventListener('click', closeProfileModal);
modalCancelBtn.addEventListener('click', closeProfileModal);
btnCreateTop.addEventListener('click', openCreateModal);

profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const isEdit = formIsEdit.value === 'true';
    const name = profileNameInput.value.trim();
    const dbPath = profileDbPathInput.value.trim();
    const pbUrl = profilePbUrlInput.value.trim();
    const pbUser = profilePbUserInput.value.trim();
    const pbPass = profilePbPassInput.value;
    const filePassword = profileFilePasswordInput.value;
    const savePassword = profileSavePasswordInput.checked ? 'yes' : 'no';
    const defaultMode = profileDefaultModeSelect.value;
    const mmexExe = profileMmexExeInput.value.trim();
    const isDefault = profileIsDefaultInput.checked;

    const payload = {
        name,
        dbPath,
        pbUrl,
        pbUser,
        defaultMode,
        mmexExe,
        isDefault
    };

    if (pbPass) payload.pbPass = pbPass;
    if (filePassword) {
        payload.filePassword = filePassword;
        payload.savePassword = savePassword;
    } else if (isEdit) {
        payload.savePassword = savePassword;
    }

    try {
        const res = await fetch('/api/profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            showToast(isEdit ? `Profile '${name}' updated!` : `Profile '${name}' created!`, 'success');
            closeProfileModal();
            await fetchProfiles();
        } else {
            showToast(data.error || 'Failed to save profile', 'error');
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
});

// ==========================================
// Wizard Form Submit
// ==========================================
wizardForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('wizard-name').value.trim() || 'default';
    const dbPath = wizardDbPathInput.value.trim();
    const pbUrl = document.getElementById('wizard-pbUrl').value.trim();
    const pbUser = document.getElementById('wizard-pbUser').value.trim();
    const pbPass = document.getElementById('wizard-pbPass').value;
    const filePassword = document.getElementById('wizard-filePassword').value;
    const savePassword = document.getElementById('wizard-savePassword').checked ? 'yes' : 'no';
    const defaultMode = document.getElementById('wizard-defaultMode').value;
    const mmexExe = document.getElementById('wizard-mmexExe').value.trim();

    const payload = {
        name,
        dbPath,
        pbUrl,
        pbUser,
        defaultMode,
        mmexExe,
        isDefault: true // Automatically set first profile as default
    };

    if (pbPass) payload.pbPass = pbPass;
    if (filePassword) {
        payload.filePassword = filePassword;
        payload.savePassword = savePassword;
    }

    try {
        const res = await fetch('/api/profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            showToast(`Initial profile '${name}' created and set as default!`, 'success');
            await fetchProfiles();
        } else {
            showToast(data.error || 'Failed to create initial profile', 'error');
        }
    } catch (err) {
        showToast(err.message, 'error');
    }
});

btnRefresh.addEventListener('click', fetchProfiles);

// ==========================================
// Exit & Shutdown Handlers
// ==========================================
function openExitModal() {
    if (exitModal) exitModal.classList.remove('hidden');
}

function closeExitModal() {
    if (exitModal) exitModal.classList.add('hidden');
}

if (btnExit) btnExit.addEventListener('click', openExitModal);
if (exitCloseBtn) exitCloseBtn.addEventListener('click', closeExitModal);
if (exitCancelBtn) exitCancelBtn.addEventListener('click', closeExitModal);

if (exitConfirmBtn) {
    exitConfirmBtn.addEventListener('click', async () => {
        exitConfirmBtn.disabled = true;
        try {
            await fetch('/api/system/shutdown', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
        } catch {
            // Ignored as server shuts down immediately
        }
        closeExitModal();
        if (shutdownScreen) {
            shutdownScreen.classList.remove('hidden');
        } else {
            showToast('MMEX-Sync stopped. You can close this window.', 'info');
        }
    });
}

// Initial Load
fetchProfiles();
