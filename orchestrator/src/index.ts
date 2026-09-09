import 'dotenv/config';
import http from 'node:http';
import { logger } from '@solo/shared';
import { startScheduler } from './scheduler.js';
import { generateReport } from './intelligence.js';

logger.info('===========================================');
logger.info('SoloSolutionsAI Agent Workforce — Starting');
logger.info('===========================================');

// Start the cron scheduler (Riley, Avery, Quinn, Sloan, etc.)
startScheduler();

// Start a lightweight HTTP server for webhook triggers
const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }

  // Intelligence report trigger
  if (req.method === 'POST' && req.url === '/intelligence/generate') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { professionalId, secret } = JSON.parse(body);

        // Simple auth — must include the ops service key as secret
        if (secret !== process.env.SUPABASE_OPS_SERVICE_KEY?.slice(-16)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }

        if (!professionalId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing professionalId' }));
          return;
        }

        // Run in background — respond immediately
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'accepted', message: 'Report generation started' }));

        // Generate report asynchronously
        try {
          await generateReport(professionalId);
          logger.info({ professionalId }, 'Intelligence report generated successfully');
        } catch (err) {
          logger.error({ err, professionalId }, 'Intelligence report generation failed');
        }

      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request' }));
      }
    });
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  logger.info(`HTTP server listening on port ${PORT}`);
});
