const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const app = express();

app.set('trust proxy', 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(express.json({ limit: '100kb' }));
app.use(morgan('combined'));

app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/posts', require('./routes/posts.routes'));

app.use('*', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  const body = { error: 'Internal server error' };
  if (process.env.NODE_ENV === 'development') {
    body.message = err.message;
    body.stack = err.stack;
  }
  res.status(err.status || 500).json(body);
});

module.exports = app;
