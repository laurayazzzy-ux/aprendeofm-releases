const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { generalLimiter } = require('./middleware/rateLimit');
const licenseRoutes = require('./routes/license');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3001;

// Serve admin panel BEFORE helmet (needs inline scripts for SPA)
app.use('/admin', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
}, express.static(path.join(__dirname, '..', 'admin'), {
  dotfiles: 'deny',
  index: 'index.html'
}));

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(cors({
  origin: function(origin, callback) {
    // Allow Electron (file://), localhost, and same-origin requests (no origin)
    if (!origin || origin.startsWith('file://') || origin.startsWith('http://localhost')) {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json({ limit: '1mb' }));
app.use(generalLimiter);

// Security headers for all responses
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// API routes
app.use('/api/license', licenseRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada.' });
});

// Error handler
app.use((err, req, res, next) => {
  // Don't leak error details in production
  const message = process.env.NODE_ENV === 'production'
    ? 'Error interno del servidor.'
    : err.message || 'Error interno del servidor.';
  res.status(500).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`Aura License Server running on http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
});

module.exports = app;
