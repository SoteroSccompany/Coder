require('dotenv/config');
const Redis = require('ioredis');


const redis = new Redis({
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    password: process.env.REDIS_PASS,
    db: 0
});

module.exports = redis;
