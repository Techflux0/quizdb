require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const speakeasy = require('speakeasy');

const app = express();
const PORT = parseInt(process.env.PORT);
const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = 'quizdb';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const SALT_ROUNDS = 10;

let db = null;
let client = null;
let isDbConnected = false;

// Email transporter configuration
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

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
    
    // Create unique indexes for username and email
    await db.collection('quiz_users').createIndex({ username: 1 }, { unique: true });
    await db.collection('quiz_users').createIndex({ email: 1 }, { unique: true });
    
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

function authenticateToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Auth Routes
app.post('/api/register', checkDbConnection, async (req, res) => {
  try {
    const { username, email, password, confirmPassword } = req.body;
    
    if (!username || !email || !password || !confirmPassword) {
      return res.status(400).json({ 
        success: false, 
        error: 'All fields are required' 
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ 
        success: false, 
        error: 'Passwords do not match' 
      });
    }

    if (password.length < 8) {
      return res.status(400).json({ 
        success: false, 
        error: 'Password must be at least 8 characters long' 
      });
    }

    // Check if user already exists
    const existingUser = await db.collection('quiz_users').findOne({
      $or: [
        { username },
        { email }
      ]
    });

    if (existingUser) {
      const field = existingUser.username === username ? 'username' : 'email';
      return res.status(400).json({ 
        success: false, 
        error: `${field} already exists` 
      });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    
    // Generate OTP
    const otpSecret = speakeasy.generateSecret({ length: 20 });
    const otp = speakeasy.totp({
      secret: otpSecret.base32,
      encoding: 'base32'
    });

    // Send OTP via email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Your Quiz App Verification Code',
      text: `Your OTP is: ${otp}`
    };

    await transporter.sendMail(mailOptions);

    // Store user with hashed password and OTP secret
    const result = await db.collection('quiz_users').insertOne({
      username,
      email,
      password: hashedPassword,
      otpSecret: otpSecret.base32,
      isVerified: false,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    res.status(201).json({ 
      success: true, 
      message: 'User registered. Please verify your email with the OTP sent.',
      userId: result.insertedId
    });
  } catch (error) {
    if (error.code === 11000) {
      const field = error.message.includes('username') ? 'username' : 'email';
      return res.status(400).json({ 
        success: false, 
        error: `${field} already exists` 
      });
    }
    console.error('Registration error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Registration failed' 
    });
  }
});

app.post('/api/verify-otp', checkDbConnection, async (req, res) => {
  try {
    const { email, otp } = req.body;
    
    const user = await db.collection('quiz_users').findOne({ email });
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        error: 'User not found' 
      });
    }

    const verified = speakeasy.totp.verify({
      secret: user.otpSecret,
      encoding: 'base32',
      token: otp,
      window: 2
    });

    if (!verified) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid OTP' 
      });
    }

    await db.collection('quiz_users').updateOne(
      { _id: user._id },
      { $set: { isVerified: true, updatedAt: new Date() } }
    );

    res.json({ 
      success: true, 
      message: 'Email verified successfully' 
    });
  } catch (error) {
    console.error('OTP verification error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'OTP verification failed' 
    });
  }
});

app.post('/api/login', checkDbConnection, async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const user = await db.collection('quiz_users').findOne({ username });
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid credentials' 
      });
    }

    if (!user.isVerified) {
      return res.status(403).json({ 
        success: false, 
        error: 'Please verify your email first' 
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid credentials' 
      });
    }

    const token = jwt.sign(
      { userId: user._id, username: user.username },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Send redirect URL in response for client-side redirect
    res.json({ 
      success: true, 
      token,
      user: {
        id: user._id.toString(),
        username: user.username,
        email: user.email
      },
      redirect: '/public/main.html'
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Login failed' 
    });
  }
});

app.post('/api/resend-otp', checkDbConnection, async (req, res) => {
  try {
    const { email } = req.body;
    
    const user = await db.collection('quiz_users').findOne({ email });
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        error: 'User not found' 
      });
    }

    if (user.isVerified) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email already verified' 
      });
    }

    // Generate new OTP
    const otp = speakeasy.totp({
      secret: user.otpSecret,
      encoding: 'base32'
    });

    // Send OTP via email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Your New Quiz App Verification Code',
      text: `Your new OTP is: ${otp}`
    };

    await transporter.sendMail(mailOptions);

    res.json({ 
      success: true, 
      message: 'New OTP sent successfully' 
    });
  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to resend OTP' 
    });
  }
});

app.get('/api/check-auth', authenticateToken, (req, res) => {
  res.json({ 
    success: true, 
    user: req.user 
  });
});

// Protected routes
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.get('/quizes', authenticateToken, checkDbConnection, async (req, res) => {
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

app.get('/quizes/:collectionName', authenticateToken, checkDbConnection, async (req, res) => {
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

app.get('/health', (req, res) => {
  res.status(200).json({
    status: isDbConnected ? 'healthy' : 'degraded',
    dbConnected: isDbConnected,
    uptime: process.uptime()
  });
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