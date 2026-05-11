import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 8000;

// Supported Mime Types for static file serving
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.json': 'application/json'
};

const server = http.createServer((req, res) => {
    // 1. Emulate save-config.php Route
    if (req.url === '/save-config.php' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const input = JSON.parse(body);
                const sourceShop = (input.sourceShop || '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
                const sourceToken = (input.sourceToken || '').trim();
                const targetShop = (input.targetShop || '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
                const targetToken = (input.targetToken || '').trim();

                const configContent = `export const CONFIG = {
  // Source Store Configuration
  source: {
    shop: "${sourceShop}",
    accessToken: "${sourceToken}",
    apiVersion: "2024-04"
  },

  // Target Store Configuration
  target: {
    shop: "${targetShop}",
    accessToken: "${targetToken}",
    apiVersion: "2024-04"
  }
};
`;
                // Write config file locally
                fs.writeFileSync(path.join(__dirname, 'config.js'), configContent);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Configuration updated successfully!' }));
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Invalid JSON or write error: ' + err.message }));
            }
        });
        return;
    }

    // 2. Emulate run-migration.php SSE Output Stream Route
    if (req.url === '/run-migration.php') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        });

        // Send initial heartbeat to acknowledge connection
        res.write(`event: status\ndata: ${JSON.stringify({ state: 'running', message: 'Starting migration...' })}\n\n`);

        // Spawn actual migration sub-process
        const child = spawn('node', ['run-all.js'], { cwd: __dirname });

        const relayLog = (data) => {
            const lines = data.toString().split('\n');
            lines.forEach(line => {
                const trimmed = line.trim();
                if (trimmed) {
                    res.write(`event: log\ndata: ${JSON.stringify({ text: trimmed })}\n\n`);
                }
            });
        };

        // Stream standard logs and error warnings
        child.stdout.on('data', relayLog);
        child.stderr.on('data', relayLog);

        child.on('close', (code) => {
            if (code === 0) {
                res.write(`event: status\ndata: ${JSON.stringify({ state: 'completed', message: 'Migration completed successfully!' })}\n\n`);
            } else {
                res.write(`event: status\ndata: ${JSON.stringify({ state: 'failed', message: `Process exited with code ${code}` })}\n\n`);
            }
            res.end();
        });

        // Kill subprocess if user leaves/reloads browser page
        req.on('close', () => {
            child.kill();
        });
        return;
    }

    // 3. Emulate reset-cache.php Route
    if (req.url === '/reset-cache.php' && req.method === 'POST') {
        try {
            const mappingsFile = path.join(__dirname, 'id-mappings.json');
            if (fs.existsSync(mappingsFile)) {
                fs.unlinkSync(mappingsFile);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Migration cache successfully cleared!' }));
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Cache was already clean!' }));
            }
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Failed to delete file: ' + err.message }));
        }
        return;
    }

    // 4. Serve Static Assets (HTML, CSS, JS, images, icons)
    let urlPath = req.url.split('?')[0]; // strip query strings
    let filePath = path.join(__dirname, urlPath === '/' ? 'index.html' : urlPath);
    const extname = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[extname] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end('<h1>404 File Not Found</h1><p>The requested asset does not exist.</p>');
            } else {
                res.writeHead(500);
                res.end(`Internal Server Error: ${err.code}`);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, () => {
    console.log(`===================================================`);
    console.log(`🎉 Success! Local Node server is running.`);
    console.log(`===================================================`);
    console.log(`👉 Local Dashboard: http://localhost:${PORT}`);
    console.log(`💡 NO XAMPP or local PHP installation needed!`);
    console.log(`===================================================`);
    console.log(`Press Ctrl + C to stop the server.`);
});
