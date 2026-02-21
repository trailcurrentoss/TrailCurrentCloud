const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { ObjectId } = require('mongodb');

const DEPLOYMENT_DIR = process.env.DEPLOYMENT_STORAGE_PATH || '/data/deployments';

module.exports = (db) => {
    const deployments = db.collection('deployments');

    // GET /api/deployment-download/latest/info
    // Must be defined before /:id to avoid matching "latest" as an ID
    router.get('/latest/info', async (req, res) => {
        try {
            const latest = await deployments.findOne(
                {},
                { sort: { uploadedAt: -1 } }
            );
            if (!latest) {
                return res.status(404).json({ error: 'No deployments available' });
            }
            res.json({
                id: latest._id,
                version: latest.version,
                filename: latest.originalName,
                size: latest.size,
                sha256: latest.sha256,
                downloadUrl: `/api/deployment-download/${latest._id.toString()}`,
                uploadedAt: latest.uploadedAt
            });
        } catch (error) {
            console.error('Error fetching latest deployment:', error);
            res.status(500).json({ error: 'Failed to fetch latest deployment' });
        }
    });

    // GET /api/deployment-download/:id
    router.get('/:id', async (req, res) => {
        try {
            let id;
            try {
                id = new ObjectId(req.params.id);
            } catch (e) {
                return res.status(400).json({ error: 'Invalid deployment ID' });
            }

            const doc = await deployments.findOne({ _id: id });
            if (!doc) {
                return res.status(404).json({ error: 'Deployment not found' });
            }

            const filePath = path.join(DEPLOYMENT_DIR, doc.filename);

            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ error: 'File not found on disk' });
            }

            const stat = fs.statSync(filePath);
            const fileSize = stat.size;

            // Support Range requests for resumable downloads
            const range = req.headers.range;
            if (range) {
                const parts = range.replace(/bytes=/, '').split('-');
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

                if (start >= fileSize) {
                    res.status(416)
                       .set('Content-Range', `bytes */${fileSize}`)
                       .end();
                    return;
                }

                const chunkSize = end - start + 1;
                const stream = fs.createReadStream(filePath, { start, end });

                res.status(206);
                res.set({
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': chunkSize,
                    'Content-Type': 'application/zip',
                    'Content-Disposition': `attachment; filename="${doc.originalName}"`,
                    'ETag': `"${doc.sha256}"`,
                    'X-Checksum-SHA256': doc.sha256
                });
                stream.pipe(res);
            } else {
                res.set({
                    'Accept-Ranges': 'bytes',
                    'Content-Length': fileSize,
                    'Content-Type': 'application/zip',
                    'Content-Disposition': `attachment; filename="${doc.originalName}"`,
                    'ETag': `"${doc.sha256}"`,
                    'X-Checksum-SHA256': doc.sha256
                });
                fs.createReadStream(filePath).pipe(res);
            }
        } catch (error) {
            console.error('Error serving deployment download:', error);
            res.status(500).json({ error: 'Download failed' });
        }
    });

    return router;
};
