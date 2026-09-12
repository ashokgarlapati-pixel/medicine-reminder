require('dns').setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const medicineRoutes = require('./routes/medicineRoutes');
const aiRoutes = require('./routes/aiRoutes');
const deviceRoutes = require('./routes/deviceRoutes');
const { startScheduler } = require('./services/scheduler');

const app = express();

const path = require('path');

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, '../frontend')));

// Routes
app.use('/api/medicines', medicineRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/devices', deviceRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Backend is running!' });
});

// Database Connection
const MONGODB_URI = process.env.MONGODB_URI;

if (MONGODB_URI && MONGODB_URI !== 'your_mongodb_connection_string') {
  mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => {
      console.log('Connected to MongoDB Atlas');
      // Start the node-cron scheduler once DB is connected
      startScheduler();
    })
    .catch((err) => console.error('MongoDB connection error:', err));
} else {
  console.warn('MongoDB URI not provided. Running in memory mode without DB...');
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
