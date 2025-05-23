require('dotenv').config();

const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');

const app = express();

const MONGO_URI = process.env.MONGO_URI;
const PORT = process.env.PORT || 7000;
const DB_NAME = process.env.DB_NAME || 'quizdb';

let db;
let client;

async function connectDB() {
  try {
    console.log('Connecting to MongoDB...');
    client = new MongoClient(MONGO_URI, {
      connectTimeoutMS: 5000,
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 50 
    });

    await client.connect();
    db = client.db(DB_NAME);
    console.log('✅ MongoDB Connected');
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error);
    process.exit(1);
  }
}


app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST']
}));

app.use(express.json());


app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

app.get('/quizes/:collectionName', async (req, res) => {
  try {
    const collection = db.collection(req.params.collectionName);
    const quizzes = await collection.find(req.query.search ? {
      question: { $regex: req.query.search, $options: 'i' }
    } : {}).toArray();
    res.json(quizzes);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

connectDB().then(() => {
  const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    server.close(() => {
      client?.close();
      console.log('Server closed');
      process.exit(0);
    });
  });
});
// Handle uncaught exceptions