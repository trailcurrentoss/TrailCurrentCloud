// Main application entry point
import { router } from './router.js';
import { API, wsClient } from './api.js';
import { NavBar } from './components/nav-bar.js';
import { homePage } from './pages/home.js';
import { trailerPage } from './pages/trailer.js';
import { energyPage } from './pages/energy.js';
import { waterPage } from './pages/water.js';
import { airqualityPage } from './pages/airquality.js';
import { settingsPage } from './pages/settings.js';
import { loginPage } from './pages/login.js';
import { mapPage } from './pages/map.js';
import { deploymentsPage } from './pages/deployments.js';

class App {
    constructor() {
        this.clockInterval = null;
        this.clockFormat = '12h';
        this.timezone = 'America/New_York';
        this.isAuthenticated = false;
    }

    async init() {
        try {
            // Register service worker
            this.registerServiceWorker();

            // Set default theme
            document.documentElement.setAttribute('data-theme', 'dark');

            // Check authentication status
            let authStatus = { authenticated: false };
            try {
                authStatus = await API.checkAuth();
            } catch (error) {
                console.error('Auth check failed:', error);
            }

            this.isAuthenticated = authStatus.authenticated;

            if (this.isAuthenticated) {
                await this.initAuthenticatedApp();
            } else {
                this.showLogin();
            }

            // Listen for auth events
            window.addEventListener('authRequired', () => {
                this.handleLogout();
            });

            window.addEventListener('authSuccess', () => {
                this.handleLoginSuccess();
            });
        } catch (error) {
            console.error('App init error:', error);
            // Show login on any error
            this.showLogin();
        } finally {
            // Always hide loading overlay
            this.hideLoading();
        }
    }

    async initAuthenticatedApp() {
        // Show app UI
        this.showAppUI();

        // Load settings
        await this.loadSettings();

        // Initialize router
        router
            .init(document.getElementById('main-content'))
            .register('home', homePage)
            .register('trailer', trailerPage)
            .register('energy', energyPage)
            .register('water', waterPage)
            .register('airquality', airqualityPage)
            .register('map', mapPage)
            .register('deployments', deploymentsPage)
            .register('settings', settingsPage);

        // Initialize navigation
        const navBar = new NavBar();
        navBar.init();

        // Setup logout button
        this.setupLogoutButton();

        // Start clock
        this.startClock();

        // Connect WebSocket
        wsClient.connect();
        this.setupConnectionStatus();

        // Navigate to initial page
        const initialPage = router.getPageFromHash();
        await router.navigate(initialPage);

        // Handle hash changes
        window.addEventListener('hashchange', () => {
            if (this.isAuthenticated) {
                const page = router.getPageFromHash();
                router.navigate(page);
            }
        });

        // Listen for clock format changes
        window.addEventListener('clockFormatChanged', (e) => {
            this.clockFormat = e.detail.format;
        });

        // Listen for timezone changes
        window.addEventListener('timezoneChanged', (e) => {
            this.timezone = e.detail.timezone;
        });
    }

    showLogin() {
        const appEl = document.getElementById('app');
        appEl.innerHTML = loginPage.render();
        loginPage.init();
    }

    showAppUI() {
        const appEl = document.getElementById('app');
        const user = API.getUser();
        const displayName = user?.display_name || user?.username || 'User';

        appEl.innerHTML = `
            <!-- Header with clock -->
            <header class="app-header">
                <div class="header-left">
                    <img src="/icons/logo-white.svg" alt="TrailCurrent" class="app-logo app-logo-dark">
                    <img src="/icons/logo-color.svg" alt="TrailCurrent" class="app-logo app-logo-light">
                </div>
                <div class="header-right">
                    <span id="clock" class="clock"></span>
                    <button class="logout-btn" id="logout-btn" title="Sign out (${displayName})">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                            <polyline points="16 17 21 12 16 7"/>
                            <line x1="21" y1="12" x2="9" y2="12"/>
                        </svg>
                    </button>
                </div>
            </header>

            <!-- Main content area -->
            <main id="main-content" class="main-content">
                <!-- Page content will be injected here -->
            </main>

            <!-- Bottom navigation -->
            <nav class="bottom-nav" id="bottom-nav">
                <button class="nav-btn active" data-page="home">
                    <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                        <polyline points="9 22 9 12 15 12 15 22"></polyline>
                    </svg>
                    <span>Home</span>
                </button>
                <button class="nav-btn" data-page="trailer">
                    <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="1" y="6" width="22" height="12" rx="2"></rect>
                        <circle cx="6" cy="18" r="2"></circle>
                        <circle cx="18" cy="18" r="2"></circle>
                        <line x1="6" y1="12" x2="18" y2="12"></line>
                    </svg>
                    <span>Trailer</span>
                </button>
                <button class="nav-btn" data-page="energy">
                    <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                    </svg>
                    <span>Energy</span>
                </button>
                <button class="nav-btn nav-overflow-item" data-page="water">
                    <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path>
                    </svg>
                    <span>Water</span>
                </button>
                <button class="nav-btn nav-overflow-item" data-page="airquality">
                    <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"></path>
                    </svg>
                    <span>Air</span>
                </button>
                <button class="nav-btn nav-overflow-item" data-page="map">
                    <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                        <circle cx="12" cy="10" r="3"></circle>
                    </svg>
                    <span>Map</span>
                </button>
                <button class="nav-btn nav-overflow-item" data-page="deployments">
                    <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="17 8 12 3 7 8"/>
                        <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    <span>Deploy</span>
                </button>
                <button class="nav-btn nav-overflow-item" data-page="settings">
                    <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="3"></circle>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                    </svg>
                    <span>Settings</span>
                </button>
                <!-- More button for overflow items on small screens -->
                <div class="nav-more-container">
                    <button class="nav-btn nav-more-btn" id="nav-more-btn">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="1"></circle>
                            <circle cx="19" cy="12" r="1"></circle>
                            <circle cx="5" cy="12" r="1"></circle>
                        </svg>
                        <span>More</span>
                    </button>
                    <div class="nav-overflow-menu" id="nav-overflow-menu">
                        <button class="nav-overflow-btn" data-page="water">
                            <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path>
                            </svg>
                            <span>Water</span>
                        </button>
                        <button class="nav-overflow-btn" data-page="airquality">
                            <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"></path>
                            </svg>
                            <span>Air</span>
                        </button>
                        <button class="nav-overflow-btn" data-page="map">
                            <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                                <circle cx="12" cy="10" r="3"></circle>
                            </svg>
                            <span>Map</span>
                        </button>
                        <button class="nav-overflow-btn" data-page="deployments">
                            <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="17 8 12 3 7 8"/>
                                <line x1="12" y1="3" x2="12" y2="15"/>
                            </svg>
                            <span>Deploy</span>
                        </button>
                        <button class="nav-overflow-btn" data-page="settings">
                            <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="3"></circle>
                                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                            </svg>
                            <span>Settings</span>
                        </button>
                    </div>
                </div>
            </nav>
        `;
    }

    setupLogoutButton() {
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.handleLogout());
        }
    }

    async handleLoginSuccess() {
        this.isAuthenticated = true;
        await this.initAuthenticatedApp();
    }

    async handleLogout() {
        try {
            await API.logout();
        } catch (error) {
            console.error('Logout error:', error);
        }

        // Stop clock
        if (this.clockInterval) {
            clearInterval(this.clockInterval);
            this.clockInterval = null;
        }

        // Disconnect WebSocket
        wsClient.disconnect();

        // Reset router
        router.reset();

        // Reset state
        this.isAuthenticated = false;

        // Show login
        this.showLogin();

        // Clear hash
        window.location.hash = '';
    }

    async loadSettings() {
        try {
            const settings = await API.getSettings();
            this.clockFormat = settings.clock_format || '12h';
            this.timezone = settings.timezone || 'America/New_York';
            document.documentElement.setAttribute('data-theme', settings.theme || 'dark');
        } catch (error) {
            console.error('Failed to load settings, using defaults:', error);
            document.documentElement.setAttribute('data-theme', 'dark');
        }
    }

    registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', async () => {
                try {
                    const registration = await navigator.serviceWorker.register('/service-worker.js');
                    console.log('Service Worker registered:', registration.scope);

                    // Check for updates
                    registration.addEventListener('updatefound', () => {
                        const newWorker = registration.installing;
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                // New content available, show update notification
                                console.log('New content available, please refresh.');
                            }
                        });
                    });
                } catch (error) {
                    console.error('Service Worker registration failed:', error);
                }
            });
        }
    }

    startClock() {
        const updateClock = () => {
            const clockEl = document.getElementById('clock');
            if (!clockEl) return;

            try {
                const now = new Date();
                const options = {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: this.clockFormat === '12h',
                    timeZone: this.timezone
                };
                clockEl.textContent = now.toLocaleTimeString('en-US', options);
            } catch (error) {
                // Fallback for invalid timezone
                const now = new Date();
                const options = {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: this.clockFormat === '12h'
                };
                clockEl.textContent = now.toLocaleTimeString('en-US', options);
            }
        };

        updateClock();
        this.clockInterval = setInterval(updateClock, 1000);
    }

    setupConnectionStatus() {
        // Remove existing status element if any
        const existing = document.querySelector('.connection-status');
        if (existing) existing.remove();

        // Create connection status element
        const statusEl = document.createElement('div');
        statusEl.className = 'connection-status';
        statusEl.textContent = 'Connecting...';
        document.body.appendChild(statusEl);

        wsClient.on('connection', ({ status }) => {
            if (status === 'connected') {
                statusEl.textContent = 'Connected';
                statusEl.classList.add('connected', 'visible');
                setTimeout(() => {
                    statusEl.classList.remove('visible');
                }, 2000);
            } else if (status === 'disconnected') {
                statusEl.textContent = 'Reconnecting...';
                statusEl.classList.remove('connected');
                statusEl.classList.add('visible');
            } else if (status === 'error') {
                statusEl.textContent = 'Connection Error';
                statusEl.classList.remove('connected');
                statusEl.classList.add('visible');
            }
        });
    }

    hideLoading() {
        const loadingEl = document.getElementById('loading-overlay');
        if (loadingEl) {
            loadingEl.classList.add('hidden');
            setTimeout(() => {
                loadingEl.remove();
            }, 300);
        }
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init().catch(error => {
        console.error('App initialization failed:', error);
    });
});
