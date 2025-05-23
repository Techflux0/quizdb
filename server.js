// Load environment variables first
require('dotenv').config();

const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');

// Use either environment variable or hardcoded value as fallback
const MONGO_URI = process.env.MONGO_URI;
const PORT = process.env.PORT || 7000;
const DB_NAME = 'quizdb';

console.log('Using MongoDB URI:', MONGO_URI); // Debug log
console.log('Using port:', PORT); // Debug log

const app = express();
let db;
let client; // Store the client for proper cleanup

// Connect to MongoDB
async function connectDB() {
  try {
    console.log('Attempting to connect to MongoDB...');
    client = new MongoClient(MONGO_URI, {
      connectTimeoutMS: 5000,
      serverSelectionTimeoutMS: 5000,
    });

    await client.connect();
    db = client.db(DB_NAME);
    console.log('✅ Connected to MongoDB');
    
    // Verify connection by listing collections
    const collections = await db.listCollections().toArray();
    console.log('Available collections:', collections.map(c => c.name));
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error);
    process.exit(1);
  }
}

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.get('/', (req, res) => {
  res.send('✅ Quiz API is running');
});

app.get('/quizzes/:collectionName', async (req, res) => {
  const { collectionName } = req.params;
  const searchKeyword = req.query.search;

  console.log(`Fetching from ${collectionName}`, searchKeyword ? `with search: ${searchKeyword}` : '');

  try {
    const collection = db.collection(collectionName);
    const query = searchKeyword
      ? { question: { $regex: searchKeyword, $options: 'i' } }
      : {};

    const quizzes = await collection.find(query).toArray();
    res.json(quizzes);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  if (client) {
    await client.close();
    console.log('MongoDB connection closed');
  }
  process.exit(0);
});

// Start server
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to start server:', err);
});