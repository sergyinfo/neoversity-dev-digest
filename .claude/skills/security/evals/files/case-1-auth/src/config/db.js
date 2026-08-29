const mongoose = require('mongoose');

async function connectDb() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });
  } catch (err) {
    console.error('mongo connection failed');
    process.exit(1);
  }
}

module.exports = { connectDb };
