const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');

const config = require('./config/env');
const { testConnection } = require('./config/db');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { verifyMailer } = require('./utils/mailer');

const authRoutes = require('./routes/authRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const serviceRoutes = require('./routes/serviceRoutes');
const orderRoutes = require('./routes/orderRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();

// ------------------------------------------------------------------
// Core middleware
// ------------------------------------------------------------------
app.use(helmet());
app.use(
  cors({
    origin: config.clientUrl,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.options('*', cors({
  origin: config.clientUrl,
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ------------------------------------------------------------------
// API routes
// ------------------------------------------------------------------
app.get('/api/health', (req, res) => res.json({ success: true, message: 'API is running' }));

app.use('/api/auth', authRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);

app.use('/api', notFound);

// Error handler must be registered last.
app.use(errorHandler);

// ------------------------------------------------------------------
// Boot
// ------------------------------------------------------------------
app.listen(config.port, () => {
  console.log(`[server] Pathans Apple Services API running on port ${config.port} (${config.nodeEnv})`);
  testConnection();
  verifyMailer();
});
