import 'dotenv/config';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { exec } from 'child_process';
import apiApp from './api/index.js';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Mount Vercel compatible API routes
  app.use(apiApp);

  app.get('/api/download-html', async (req, res) => {
    try {
      exec('npx vite build --emptyOutDir', (err: any, stdout: string, stderr: string) => {
        if (err) {
          console.error(stderr);
          return res.status(500).send('Build failed: ' + stderr);
        }
        res.download(path.join(process.cwd(), 'dist', 'index.html'), 'lovart-batch-tool.html');
      });
    } catch (e: any) { 
      res.status(500).send(e.message); 
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
