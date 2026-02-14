// Settings page
import { API } from '../api.js';

let settings = null;
let availableTimezones = [];

export const settingsPage = {
    render() {
        return `
            <section class="page-settings">
                <h1 class="section-title">Settings</h1>
                <div class="settings-container" id="settings-container">
                    <!-- Settings will be rendered here -->
                </div>
            </section>
        `;
    },

    renderSettings() {
        if (!settings) return '';

        const user = API.getUser();

        return `
            <!-- Theme Toggle -->
            <div class="card settings-item">
                <div>
                    <span class="settings-label">Dark Mode</span>
                    <p class="settings-description">Toggle between dark and light themes</p>
                </div>
                <button class="toggle-switch ${settings.theme === 'dark' ? 'active' : ''}"
                        id="theme-toggle"
                        aria-pressed="${settings.theme === 'dark'}">
                </button>
            </div>

            <!-- Timezone -->
            <div class="card settings-item">
                <div>
                    <span class="settings-label">Timezone</span>
                    <p class="settings-description">Set your local timezone</p>
                </div>
                <select class="settings-select" id="timezone-select">
                    ${availableTimezones.map(tz => `
                        <option value="${tz}" ${settings.timezone === tz ? 'selected' : ''}>${tz}</option>
                    `).join('')}
                </select>
            </div>

            <!-- Clock Format -->
            <div class="card settings-item">
                <div>
                    <span class="settings-label">24-Hour Clock</span>
                    <p class="settings-description">Use 24-hour time format</p>
                </div>
                <button class="toggle-switch ${settings.clock_format === '24h' ? 'active' : ''}"
                        id="clock-format-toggle"
                        aria-pressed="${settings.clock_format === '24h'}">
                </button>
            </div>

            <!-- Change Password -->
            <div class="card settings-item-vertical">
                <div class="settings-item-header">
                    <span class="settings-label">Change Password</span>
                    <p class="settings-description">Update your account password (${user?.username || 'user'})</p>
                </div>
                <form id="change-password-form" class="password-form">
                    <div class="password-form-group">
                        <label for="current-password" class="password-label">Current Password</label>
                        <input type="password" id="current-password" class="password-input"
                               placeholder="Enter current password" autocomplete="current-password" required>
                    </div>
                    <div class="password-form-group">
                        <label for="new-password" class="password-label">New Password</label>
                        <input type="password" id="new-password" class="password-input"
                               placeholder="Enter new password (min 6 chars)" autocomplete="new-password" required minlength="6">
                    </div>
                    <div class="password-form-group">
                        <label for="confirm-password" class="password-label">Confirm New Password</label>
                        <input type="password" id="confirm-password" class="password-input"
                               placeholder="Confirm new password" autocomplete="new-password" required>
                    </div>
                    <div id="password-message" class="password-message hidden"></div>
                    <button type="submit" class="password-submit-btn" id="password-submit-btn">
                        Change Password
                    </button>
                </form>
            </div>

            <!-- Refresh App -->
            <div class="card settings-item">
                <div>
                    <span class="settings-label">Refresh App</span>
                    <p class="settings-description">Clear cache and reload to get the latest version</p>
                </div>
                <button class="settings-action-btn" id="refresh-app-btn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
                        <path d="M23 4v6h-6"></path>
                        <path d="M1 20v-6h6"></path>
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                    </svg>
                    Refresh
                </button>
            </div>

            <!-- App Info -->
            <div class="card settings-item" style="flex-direction: column; align-items: flex-start; gap: 10px;">
                <span class="settings-label">About</span>
                <p class="settings-description">TrailCurrent System __GIT_SHA__</p>
                <p class="settings-description">A Progressive Web App for TrailCurrent</p>
            </div>
        `;
    },

    async init() {
        try {
            const data = await API.getSettings();
            settings = data;
            availableTimezones = data.available_timezones || [];

            document.getElementById('settings-container').innerHTML = this.renderSettings();
            this.setupListeners();
        } catch (error) {
            console.error('Failed to fetch settings:', error);
            document.getElementById('settings-container').innerHTML = '<p style="color: var(--danger);">Failed to load settings</p>';
        }
    },

    setupListeners() {
        // Theme toggle
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', async () => {
                const newTheme = settings.theme === 'dark' ? 'light' : 'dark';
                try {
                    settings = await API.setSettings({ theme: newTheme });
                    themeToggle.classList.toggle('active', settings.theme === 'dark');
                    themeToggle.setAttribute('aria-pressed', settings.theme === 'dark');
                    document.documentElement.setAttribute('data-theme', settings.theme);
                } catch (error) {
                    console.error('Failed to update theme:', error);
                }
            });
        }

        // Timezone select
        const timezoneSelect = document.getElementById('timezone-select');
        if (timezoneSelect) {
            timezoneSelect.addEventListener('change', async (e) => {
                try {
                    settings = await API.setSettings({ timezone: e.target.value });
                    // Trigger clock update
                    window.dispatchEvent(new CustomEvent('timezoneChanged', { detail: { timezone: settings.timezone } }));
                } catch (error) {
                    console.error('Failed to update timezone:', error);
                }
            });
        }

        // Clock format toggle
        const clockFormatToggle = document.getElementById('clock-format-toggle');
        if (clockFormatToggle) {
            clockFormatToggle.addEventListener('click', async () => {
                const newFormat = settings.clock_format === '12h' ? '24h' : '12h';
                try {
                    settings = await API.setSettings({ clock_format: newFormat });
                    clockFormatToggle.classList.toggle('active', settings.clock_format === '24h');
                    clockFormatToggle.setAttribute('aria-pressed', settings.clock_format === '24h');
                    // Trigger clock update
                    window.dispatchEvent(new CustomEvent('clockFormatChanged', { detail: { format: settings.clock_format } }));
                } catch (error) {
                    console.error('Failed to update clock format:', error);
                }
            });
        }

        // Change password form
        const passwordForm = document.getElementById('change-password-form');
        if (passwordForm) {
            passwordForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.handleChangePassword();
            });
        }

        // Refresh app button
        const refreshBtn = document.getElementById('refresh-app-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                refreshBtn.disabled = true;
                refreshBtn.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20" class="spinning">
                        <path d="M23 4v6h-6"></path>
                        <path d="M1 20v-6h6"></path>
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                    </svg>
                    Refreshing...
                `;

                try {
                    // Unregister service workers
                    if ('serviceWorker' in navigator) {
                        const registrations = await navigator.serviceWorker.getRegistrations();
                        for (const registration of registrations) {
                            await registration.unregister();
                        }
                    }

                    // Clear caches
                    if ('caches' in window) {
                        const cacheNames = await caches.keys();
                        for (const cacheName of cacheNames) {
                            await caches.delete(cacheName);
                        }
                    }

                    // Force reload from server
                    window.location.reload(true);
                } catch (error) {
                    console.error('Failed to refresh app:', error);
                    refreshBtn.disabled = false;
                    refreshBtn.innerHTML = `
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
                            <path d="M23 4v6h-6"></path>
                            <path d="M1 20v-6h6"></path>
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                        </svg>
                        Refresh
                    `;
                }
            });
        }
    },

    async handleChangePassword() {
        const currentPassword = document.getElementById('current-password').value;
        const newPassword = document.getElementById('new-password').value;
        const confirmPassword = document.getElementById('confirm-password').value;
        const messageEl = document.getElementById('password-message');
        const submitBtn = document.getElementById('password-submit-btn');

        // Reset message
        messageEl.classList.add('hidden');
        messageEl.classList.remove('success', 'error');

        // Validate
        if (newPassword !== confirmPassword) {
            this.showPasswordMessage('New passwords do not match', 'error');
            return;
        }

        if (newPassword.length < 6) {
            this.showPasswordMessage('New password must be at least 6 characters', 'error');
            return;
        }

        // Disable button during request
        submitBtn.disabled = true;
        submitBtn.textContent = 'Changing...';

        try {
            await API.changePassword(currentPassword, newPassword);
            this.showPasswordMessage('Password changed successfully', 'success');

            // Clear form
            document.getElementById('current-password').value = '';
            document.getElementById('new-password').value = '';
            document.getElementById('confirm-password').value = '';
        } catch (error) {
            this.showPasswordMessage(error.message || 'Failed to change password', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Change Password';
        }
    },

    showPasswordMessage(message, type) {
        const messageEl = document.getElementById('password-message');
        if (messageEl) {
            messageEl.textContent = message;
            messageEl.classList.remove('hidden', 'success', 'error');
            messageEl.classList.add(type);
        }
    },

    cleanup() {
        settings = null;
    }
};
