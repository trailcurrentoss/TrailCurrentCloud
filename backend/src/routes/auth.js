const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const router = express.Router();

const SESSION_DURATION_HOURS = 24;

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

module.exports = (db) => {
    const users = db.collection('users');
    const sessions = db.collection('sessions');

    const initDefaultUser = async () => {
        const existingUser = await users.findOne({ username: 'admin' });
        if (!existingUser) {
            const password = process.env.ADMIN_PASSWORD;
            if (!password) {
                throw new Error("ADMIN_PASSWORD is not set");
            }
            const hash = await bcrypt.hash(password, 10);
            await users.insertOne({
                username: 'admin',
                password_hash: hash,
                display_name: 'Administrator',
                created_at: new Date()
            });
            console.log('Default admin user created');
        }
    };
    initDefaultUser();

    // POST /api/auth/login
    router.post('/login', async (req, res) => {
        try {
            const { username, password } = req.body;

            if (!username || !password) {
                return res.status(400).json({ error: 'Username and password are required' });
            }

            const user = await users.findOne({ username });

            if (!user) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            const validPassword = await bcrypt.compare(password, user.password_hash);

            if (!validPassword) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            // Create session
            const token = generateToken();
            const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000);

            await sessions.insertOne({
                user_id: user._id,
                token,
                expires_at: expiresAt,
                created_at: new Date()
            });

            // Clean up old sessions for this user
            await sessions.deleteMany({
                user_id: user._id,
                expires_at: { $lt: new Date() }
            });

            res.json({
                token,
                user: {
                    id: user._id,
                    username: user.username,
                    display_name: user.display_name
                },
                expires_at: expiresAt.toISOString()
            });
        } catch (error) {
            console.error('Login error:', error);
            res.status(500).json({ error: 'Login failed' });
        }
    });

    // POST /api/auth/logout
    router.post('/logout', async (req, res) => {
        try {
            const token = req.headers.authorization?.replace('Bearer ', '');

            if (token) {
                await sessions.deleteOne({ token });
            }

            res.json({ message: 'Logged out successfully' });
        } catch (error) {
            console.error('Logout error:', error);
            res.status(500).json({ error: 'Logout failed' });
        }
    });

    // GET /api/auth/check
    router.get('/check', async (req, res) => {
        try {
            const token = req.headers.authorization?.replace('Bearer ', '');

            if (!token) {
                return res.status(401).json({ authenticated: false });
            }

            const session = await sessions.findOne({
                token,
                expires_at: { $gt: new Date() }
            });

            if (!session) {
                return res.status(401).json({ authenticated: false });
            }

            const user = await users.findOne({ _id: session.user_id });

            if (!user) {
                return res.status(401).json({ authenticated: false });
            }

            res.json({
                authenticated: true,
                user: {
                    id: user._id,
                    username: user.username,
                    display_name: user.display_name
                },
                expires_at: session.expires_at.toISOString()
            });
        } catch (error) {
            console.error('Auth check error:', error);
            res.status(500).json({ error: 'Auth check failed' });
        }
    });

    // POST /api/auth/change-password
    router.post('/change-password', async (req, res) => {
        try {
            const token = req.headers.authorization?.replace('Bearer ', '');

            if (!token) {
                return res.status(401).json({ error: 'Authentication required' });
            }

            const session = await sessions.findOne({
                token,
                expires_at: { $gt: new Date() }
            });

            if (!session) {
                return res.status(401).json({ error: 'Invalid or expired session' });
            }

            const user = await users.findOne({ _id: session.user_id });

            if (!user) {
                return res.status(401).json({ error: 'User not found' });
            }

            const { current_password, new_password } = req.body;

            if (!current_password || !new_password) {
                return res.status(400).json({ error: 'Current password and new password are required' });
            }

            if (new_password.length < 6) {
                return res.status(400).json({ error: 'New password must be at least 6 characters' });
            }

            const validPassword = await bcrypt.compare(current_password, user.password_hash);

            if (!validPassword) {
                return res.status(401).json({ error: 'Current password is incorrect' });
            }

            const newHash = await bcrypt.hash(new_password, 10);
            await users.updateOne(
                { _id: session.user_id },
                { $set: { password_hash: newHash } }
            );

            res.json({ message: 'Password changed successfully' });
        } catch (error) {
            console.error('Change password error:', error);
            res.status(500).json({ error: 'Failed to change password' });
        }
    });

    return router;
};

// Auth middleware for protecting routes
module.exports.authMiddleware = (db) => {
    const sessions = db.collection('sessions');
    const users = db.collection('users');

    return async (req, res, next) => {
        // Skip auth for auth routes and health check
        if (req.path.startsWith('/api/auth') || req.path === '/api/health') {
            return next();
        }

        const token = req.headers.authorization?.replace('Bearer ', '');

        const isBrowserNavigation = () => {
            const accept = req.headers.accept || '';
            return accept.includes('text/html') && !req.xhr && req.headers['x-requested-with'] !== 'XMLHttpRequest';
        };

        if (!token) {
            if (isBrowserNavigation()) {
                return res.redirect('/#login');
            }
            return res.status(401).json({ error: 'Authentication required' });
        }

        try {
            const session = await sessions.findOne({
                token,
                expires_at: { $gt: new Date() }
            });

            if (!session) {
                if (isBrowserNavigation()) {
                    return res.redirect('/#login');
                }
                return res.status(401).json({ error: 'Invalid or expired session' });
            }

            const user = await users.findOne({ _id: session.user_id });

            if (!user) {
                if (isBrowserNavigation()) {
                    return res.redirect('/#login');
                }
                return res.status(401).json({ error: 'User not found' });
            }

            req.user = {
                id: user._id,
                username: user.username
            };

            next();
        } catch (error) {
            console.error('Auth middleware error:', error);
            res.status(500).json({ error: 'Authentication error' });
        }
    };
};
