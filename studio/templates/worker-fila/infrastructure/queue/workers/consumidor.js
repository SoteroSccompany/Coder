const amqplib = require('amqplib');

async function consumir() {
  const url = process.env.RABBITMQ_URL || 'amqp://{{rabbitUser}}:{{rabbitPassword}}@127.0.0.1:{{rabbitPort}}';
  const fila = process.env.QUEUE_NAME || '{{queueName}}';
  const conn = await amqplib.connect(url);
  const ch = await conn.createChannel();
  await ch.assertQueue(fila, { durable: true });
  console.log('Consumindo fila ' + fila);
  ch.consume(fila, (msg) => {
    if (!msg) return;
    console.log(msg.content.toString());
    ch.ack(msg);
  });
}

module.exports = { consumir };
