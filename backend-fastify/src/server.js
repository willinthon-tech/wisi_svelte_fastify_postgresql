process.env.TZ = 'America/Caracas';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';

import itemRoutes from './routes/item.routes.js';
import healthRoutes from './routes/health.routes.js';
import authRoutes from './routes/auth.routes.js';
import masterRoutes from './routes/master.routes.js';
import { reportsRoutes } from './routes/reports.routes.js';
import { syncAttlogs, handleZkIclockCdata } from './controllers/master.controller.js';
import { initDb } from './config/db.js';

import { initWebsockets } from './config/websocket.js';


//SERVIR SERVIDOR WILLINTHON
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
//SERVIR SERVIDOR WILLINTHON

dotenv.config();

// Disable verbose per-request JSON logging in terminal and support large payloads for attendance snapshots
const fastify = Fastify({
  logger: false,
  bodyLimit: 100 * 1024 * 1024 // 100 MB
});

const PORT = process.env.PORT || 3030;
const HOST = process.env.HOST || '0.0.0.0';

// Register Content Type Parsers for Biometric Push Events (multipart, form-urlencoded, xml, raw)
fastify.addContentTypeParser(['multipart/form-data', 'application/x-www-form-urlencoded', 'text/xml', 'application/xml', 'text/plain'], { parseAs: 'buffer' }, (req, body, done) => {
  done(null, body);
});

fastify.addContentTypeParser(/^image\/.*/, { parseAs: 'buffer' }, (req, body, done) => {
  done(null, body);
});

// Fallback catch-all content type parser for any custom headers sent by biometric hardware
fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (req, body, done) => {
  done(null, body);
});

async function startServer() {
  try {
    // Enable CORS for frontend cross-origin requests
    await fastify.register(cors, {
      origin: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
    });

    // Initialize Real-time WebSockets
    await initWebsockets(fastify);


    // Universal preHandler hook to automatically attach user's assigned salas to any query
    fastify.addHook('preHandler', async (req, reply) => {
      try {
        if (req.url && req.url.startsWith('/api/')) {
          const userSalasHeader = req.headers['x-user-salas'];
          if (userSalasHeader) {
            const currentQuery = req.query || {};
            if (!currentQuery.sala_ids) {
              req.query = { ...currentQuery, sala_ids: userSalasHeader };
            }
          }
        }
      } catch (e) {
        // silent safe catch for query mutation
      }
    });

    // Initialize PostgreSQL Database & Run Schema Migrations
    await initDb();

    // Register API Routes
    await fastify.register(itemRoutes, { prefix: '/api' });
    await fastify.register(healthRoutes, { prefix: '/api' });
    await fastify.register(authRoutes, { prefix: '/api' });
    await fastify.register(masterRoutes, { prefix: '/api' });
    await fastify.register(reportsRoutes);
    // Register Biometric Push Endpoints at Root Level (ZKTeco ADMS, Hikvision, Dahua, Agente WISI Sync)
    await fastify.register(async (app) => {
      app.get('/iclock/cdata', handleZkIclockCdata);
      app.post('/iclock/cdata', handleZkIclockCdata);
      app.get('/iclock/getrequest', handleZkIclockCdata);
      app.post('/iclock/devicecmd', handleZkIclockCdata);
      app.get('/cdata', handleZkIclockCdata);
      app.post('/cdata', handleZkIclockCdata);

      app.post('/attlogs/sync', syncAttlogs);
      app.post('/hikvision/alarm', syncAttlogs);
      app.post('/event', syncAttlogs);
      app.post('/ISAPI/Event/notification/alertStream', syncAttlogs);
    });


    // Default SVG avatar fallback (streamed with 200 OK if no image file exists anywhere!)
    const DEFAULT_AVATAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
      <rect width="128" height="128" fill="#e2e8f0"/>
      <circle cx="64" cy="48" r="24" fill="#94a3b8"/>
      <path d="M 24 108 C 24 84, 40 76, 64 76 C 88 76, 104 84, 104 108 Z" fill="#94a3b8"/>
    </svg>`;

    const servePhotoWithFallback = async (req, reply) => {
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
      reply.header('Access-Control-Allow-Headers', '*');

      const fs = await import('fs');
      const path = await import('path');
      const { sql, isPgConnected } = await import('./config/db.js');

      let filename = req.params.filename || req.params.id || '';
      if (!filename.endsWith('.jpg') && !filename.endsWith('.png') && !filename.endsWith('.jpeg')) {
        filename += '.jpg';
      }

      // Directories to search for exact filename
      const isAttlogReq = req.url.includes('/attlogs');
      const isEmpleadoReq = req.url.includes('/empleados');
      const searchDirs = isAttlogReq
        ? [path.join(process.cwd(), 'attlogs'), path.join(process.cwd(), 'photos')]
        : isEmpleadoReq
          ? [path.join(process.cwd(), 'empleados')]
          : [
              path.join(process.cwd(), 'attlogs'),
              path.join(process.cwd(), 'empleados'),
              path.join(process.cwd(), 'salas'),
              path.join(process.cwd(), 'photos')
            ];

      // 1. Direct file match on disk
      for (const dir of searchDirs) {
        const fullPath = path.join(dir, filename);
        if (fs.existsSync(fullPath)) {
          const stat = fs.statSync(fullPath);
          reply.header('Access-Control-Allow-Origin', '*');
          reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
          reply.header('Access-Control-Allow-Headers', '*');
          reply.header('Cache-Control', 'public, max-age=31536000, immutable');
          reply.header('Content-Length', stat.size);
          reply.header('Last-Modified', stat.mtime.toUTCString());
          reply.header('ETag', `"${stat.size}-${Math.floor(stat.mtimeMs)}"`);
          if (filename.endsWith('.png')) reply.type('image/png');
          else if (filename.endsWith('.svg')) reply.type('image/svg+xml');
          else reply.type('image/jpeg');
          return fs.createReadStream(fullPath);
        }
      }

      const cleanTerm = filename.replace(/\.[^/.]+$/, "").replace(/^#/, "").trim();

      // 2. If requested via attlogs (e.g. 404208.jpg), lookup attlog by ID to find employee_no / cedula!
      if (cleanTerm && isPgConnected && sql) {
        try {
          const attlogId = Number(cleanTerm);
          let empNo = null;

          if (!isNaN(attlogId)) {
            const attRows = await sql`
              SELECT employee_no, nombre FROM attlogs WHERE id = ${attlogId} LIMIT 1
            `;
            if (attRows.length > 0) {
              empNo = String(attRows[0].employee_no || '').replace(/^#/, '').trim();
            }
          }

          const targetTerm = empNo || cleanTerm;

          // 3. Lookup employee profile photo by cedula or ID
          const empRows = await sql`
            SELECT id, foto, cedula FROM empleados 
            WHERE cedula = ${targetTerm} 
               OR cedula = 'V' || ${targetTerm} 
               OR cedula = REPLACE(${targetTerm}, 'V', '')
               OR CAST(id AS TEXT) = ${targetTerm}
            LIMIT 1
          `;

          if (empRows.length > 0) {
            const emp = empRows[0];
            const candidateFiles = [
              `${emp.id}.jpg`,
              `${emp.cedula}.jpg`,
              emp.foto ? path.basename(emp.foto) : null
            ].filter(Boolean);

            for (const cand of candidateFiles) {
              for (const dir of searchDirs) {
                const altPath = path.join(dir, cand);
                if (fs.existsSync(altPath)) {
                  const stat = fs.statSync(altPath);
                  reply.header('Access-Control-Allow-Origin', '*');
                  reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
                  reply.header('Access-Control-Allow-Headers', '*');
                  reply.header('Cache-Control', 'public, max-age=31536000, immutable');
                  reply.header('Content-Length', stat.size);
                  reply.header('Last-Modified', stat.mtime.toUTCString());
                  reply.header('ETag', `"${stat.size}-${Math.floor(stat.mtimeMs)}"`);
                  reply.type('image/jpeg');
                  return fs.createReadStream(altPath);
                }
              }
            }
          }
        } catch (e) {
          console.warn('Error in photo fallback lookup:', e);
        }
      }

      // 4. Ultimate Fallback: Stream SVG avatar placeholder with 200 OK so browser console NEVER logs 404!
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
      reply.header('Cache-Control', 'public, max-age=86400');
      reply.type('image/svg+xml').status(200);
      return reply.send(DEFAULT_AVATAR_SVG);
    };

    const getSalaLogoSvg = (name = "CASINO") => `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100" viewBox="0 0 300 100">
      <rect width="300" height="100" fill="transparent"/>
      <text x="150" y="44" font-family="'Inter', sans-serif" font-weight="900" font-size="22" fill="#ffffff" text-anchor="middle" letter-spacing="2">
        ${String(name).toUpperCase()}
      </text>
      <text x="150" y="66" font-family="sans-serif" font-size="14" fill="#fbbf24" text-anchor="middle" letter-spacing="4">
        ★★★★★
      </text>
      <text x="150" y="84" font-family="'Inter', sans-serif" font-weight="800" font-size="11" fill="#cbd5e1" text-anchor="middle" letter-spacing="3">
        CASINO &amp; RESORT
      </text>
    </svg>`;

    const serveSalaLogoWithFallback = async (req, reply) => {
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
      reply.header('Access-Control-Allow-Headers', '*');

      const fs = await import('fs');
      const path = await import('path');
      const { sql, isPgConnected } = await import('./config/db.js');

      let filename = req.params.filename || '';
      const salasDir = path.join(process.cwd(), 'salas');

      const candidates = [
        filename,
        `${filename}.svg`,
        `${filename}.png`,
        `${filename}.jpg`,
        `${filename}.jpeg`
      ];

      for (const cand of candidates) {
        const fullPath = path.join(salasDir, cand);
        if (fs.existsSync(fullPath)) {
          reply.header('Cache-Control', 'public, max-age=2592000, immutable');
          if (cand.endsWith('.svg')) reply.type('image/svg+xml');
          else if (cand.endsWith('.png')) reply.type('image/png');
          else reply.type('image/jpeg');
          return fs.createReadStream(fullPath);
        }
      }

      return reply.status(404).send({ error: 'Logo no disponible para esta sala' });
    };

    fastify.get('/empleados/:filename', servePhotoWithFallback);
    fastify.get('/api/empleados/:filename', servePhotoWithFallback);
    fastify.get('/attlogs/:filename', servePhotoWithFallback);
    fastify.get('/api/attlogs/:filename', servePhotoWithFallback);
    fastify.get('/salas/:filename', serveSalaLogoWithFallback);
    fastify.get('/api/salas/:filename', serveSalaLogoWithFallback);

    const serveDownloadFile = async (req, reply) => {
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
      reply.header('Access-Control-Allow-Headers', '*');

      const fs = await import('fs');
      const path = await import('path');
      const filename = path.basename(req.params.filename || '');
      const downloadsDir = path.join(process.cwd(), 'downloads');
      const filePath = path.join(downloadsDir, filename);

      if (!filename || !fs.existsSync(filePath)) {
        return reply.status(404).send({ error: 'Instalador no encontrado' });
      }

      const stat = fs.statSync(filePath);
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.header('Content-Length', stat.size);
      reply.header('Cache-Control', 'public, max-age=86400');

      if (filename.endsWith('.apk')) {
        reply.type('application/vnd.android.package-archive');
      } else if (filename.endsWith('.exe')) {
        reply.type('application/vnd.microsoft.portable-executable');
      } else if (filename.endsWith('.msi')) {
        reply.type('application/x-msi');
      } else {
        reply.type('application/octet-stream');
      }

      return fs.createReadStream(filePath);
    };

    fastify.get('/downloads/:filename', serveDownloadFile);
    fastify.get('/api/downloads/:filename', serveDownloadFile);

    const handleStaticOptions = async (req, reply) => {
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
      reply.header('Access-Control-Allow-Headers', '*');
      return reply.status(204).send();
    };

    fastify.options('/empleados/:filename', handleStaticOptions);
    fastify.options('/api/empleados/:filename', handleStaticOptions);
    fastify.options('/attlogs/:filename', handleStaticOptions);
    fastify.options('/api/attlogs/:filename', handleStaticOptions);
    fastify.options('/salas/:filename', handleStaticOptions);
    fastify.options('/api/salas/:filename', handleStaticOptions);
    fastify.options('/downloads/:filename', handleStaticOptions);
    fastify.options('/api/downloads/:filename', handleStaticOptions);

    // Root endpoint fallback
    /* fastify.get('/', async () => {
      return {
        app: 'WISI Fastify Server (MVC Architecture)',
        status: 'running',
        endpoints: {
          health: '/api/health',
          items: '/api/items',
          auth: '/api/auth/login'
        }
      };
    }); */


    //SERVIR SERVIDOR WILLINTHON
    await fastify.register(fastifyStatic, {
      root: join(__dirname, '../../frontend-svelte/dist'),
      prefix: '/'
    });
    // SPA fallback
    fastify.setNotFoundHandler((req, reply) => {
      if (!req.url.startsWith('/api') && !req.url.startsWith('/ws')) {
        return reply.sendFile('index.html');
      }
      reply.status(404).send({ error: 'Not found' });
    });
    //SERVIR SERVIDOR WILLINTHON

    await fastify.listen({ port: PORT, host: HOST });
    console.log(`\x1b[32m🟢 [CONECTADO]\x1b[0m Servidor Nube: Fastify | Host: ${HOST} | Puerto: ${PORT}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

startServer();
