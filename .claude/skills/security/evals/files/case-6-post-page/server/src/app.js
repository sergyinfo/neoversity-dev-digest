const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const app = express();

app.set('trust proxy', 1);

const allowedHosts = (process.env.CORS_ORIGINS || 'blogapp.example')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'same-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  })
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }
      if (allowedHosts.some((host) => origin.endsWith(host))) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  })
);

app.use(express.json({ limit: '100kb' }));
app.use(morgan('combined'));
app.use(rateLimit({ windowMs: 60 * 1000, max: 100, standardHeaders: true }));

app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/posts', require('./routes/posts.routes'));

app.use('*', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status <= 599
    ? err.status
    : 500;
  req.log?.error?.({ err });
  const body = { error: 'Internal server error' };
  if (process.env.NODE_ENV === 'development') {
    body.message = err.message;
    body.stack = err.stack;
  }
  res.status(status).json(body);
});

module.exports = app;
