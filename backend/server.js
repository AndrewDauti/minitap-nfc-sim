const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const { loadConfig } = require('./security/config');
const { createVault } = require('./security/vault');
const { createSessions } = require('./security/session');
const { createAudit } = require('./security/audit');
const { createReplayStore } = require('./security/replayStore');
const { createChip } = require('./security/chip');
const { createIssuer } = require('./security/issuer');
const { createController } = require('./controllers/transactionController');
const { createRouter } = require('./routes/api');
const { sendPublic } = require('./security/redact');

function createApp(overrides = {}) {
  const config = loadConfig(overrides);
  const pins = config.pins;
  const keys = config.keys;
  delete config.pins;
  delete config.keys;
  const vault = createVault({
    pins,
    keys,
    bcryptRounds: config.bcryptRounds,
  });
  const audit = createAudit();
  const sessions = createSessions({
    jwtSecret: config.jwtSecret,
    jwtExpiresIn: config.jwtExpiresIn,
  });
  const replay = createReplayStore();
  const chip = createChip({ vault, replay, macSuite: config.macSuite });
  const issuer = createIssuer({ vault, replay, macSuite: config.macSuite });
  const controller = createController({
    vault,
    sessions,
    chip,
    issuer,
    audit,
    macSuite: config.macSuite,
  });

  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));
  app.use(cors({
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  }));
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', rateLimit({
    windowMs: config.rateLimitWindowMs,
    limit: config.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === 'OPTIONS',
    handler: (req, res) => {
      res.status(429).json({
        error: 'Too many requests. Wait a moment and try again.',
        code: 'RATE_LIMIT',
      });
    },
  }));
  app.use('/api', createRouter(controller));
  app.use('/api', (req, res) => {
    sendPublic(res, 404, { error: 'Not found', code: 'NOT_FOUND' });
  });
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
      return res.status(400).json({ error: 'Invalid JSON', code: 'VALIDATION' });
    }
    return res.status(500).json({ error: 'Internal error' });
  });

  return app;
}

if (require.main === module) {
  if (!process.env.JWT_SECRET) {
    console.warn('JWT_SECRET is not set. Using a random secret that changes on restart. See .env.example.');
  }
  const app = createApp();
  const port = Number(process.env.PORT) || 5000;
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

module.exports = { createApp };
