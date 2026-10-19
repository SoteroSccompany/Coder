const { consumir } = require('./infrastructure/queue/workers/consumidor');

if (require.main === module) {
  consumir().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { consumir };
