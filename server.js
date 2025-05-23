require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');

const app = express();
const PORT = parseInt(process.env.PORT);
const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = 'quizdb';

let db = null;
let client = null;
let isDbConnected = false;

async function connectDB() {
  try {
    if (client && isDbConnected) return;
    
    client = new MongoClient(MONGO_URI, {
      connectTimeoutMS: 10000,
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: 10,
      retryWrites: true,
      retryReads: true
    });

    await client.connect();
    db = client.db(DB_NAME);
    isDbConnected = true;
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error);
    setTimeout(connectDB, 5000);
  }
}

function checkDbConnection(req, res, next) {
  if (!isDbConnected) {
    return res.status(503).json({ 
      success: false,
      error: 'Database not connected' 
    });
  }
  next();
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public')); 

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: isDbConnected ? 'healthy' : 'degraded',
    dbConnected: isDbConnected,
    uptime: process.uptime()
  });
});

app.get('/quizes', checkDbConnection, async (req, res) => {
  try {
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);
    
    res.json({
      success: true,
      collections: collectionNames,
      count: collectionNames.length
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch collections' 
    });
  }
});

app.get('/quizes/:collectionName', checkDbConnection, async (req, res) => {
  try {
    const { collectionName } = req.params;
    const searchKeyword = req.query.search;

    const collectionExists = (await db.listCollections({ name: collectionName }).toArray()).length > 0;
    if (!collectionExists) {
      return res.status(404).json({
        success: false,
        error: 'Collection not found'
      });
    }

    const collection = db.collection(collectionName);
    const query = searchKeyword
      ? { question: { $regex: searchKeyword, $options: 'i' } }
      : {};

    const quizzes = await collection.find(query).toArray();
    res.json({
      success: true,
      count: quizzes.length,
      data: quizzes
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

function gracefulShutdown() {
  return new Promise(async (resolve) => {
    try {
      if (client) {
        await client.close();
        console.log('MongoDB connection closed');
      }
      resolve();
    } catch (err) {
      console.error('Shutdown error:', err);
      process.exit(1);
    }
  });
}

process.on('SIGTERM', async () => {
  await gracefulShutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await gracefulShutdown();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  gracefulShutdown().then(() => process.exit(1));
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});

connectDB().then(() => {
  const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });

  server.on('error', (err) => {
    console.error('Server error:', err);
    gracefulShutdown().then(() => process.exit(1));
  });
}).catch(err => {
  console.error('Startup failed:', err);
  process.exit(1);
});