/**
 * BDSC // GRIDFALL — optional self-hosted relay
 * ---------------------------------------------
 * The game ships configured to use PUBLIC MQTT-over-WebSocket brokers, so co-op
 * works with zero setup over the internet. If you want your own relay (LAN,
 * offline, lower latency, or when public brokers are blocked) run:
 *
 *     npm run relay
 *
 * then point the client at it with the URL query parameter:
 *
 *     http://<your-ip>:5173/?broker=ws://<your-ip>:8888
 *
 * This starts an Aedes MQTT broker bridged onto a plain WebSocket, which is
 * exactly what the browser client speaks. No TLS here (LAN use); put it behind
 * a reverse proxy with wss:// for public deployment.
 */
import { createServer } from 'node:http';
import { Aedes } from 'aedes';
import { WebSocketServer, createWebSocketStream } from 'ws';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8888;

const aedes = await Aedes.createBroker({ id: 'bdsc-relay' });
const httpServer = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('BDSC relay online. Connect via ws://<host>:' + PORT + '\n');
});

const wss = new WebSocketServer({ server: httpServer, path: '/mqtt' });
// Also accept connections on any path (mqtt.js appends '/').
const wssAny = new WebSocketServer({ server: httpServer });

function handle(ws) {
  const stream = createWebSocketStream(ws);
  aedes.handle(stream);
}

wss.on('connection', handle);
wssAny.on('connection', handle);

aedes.on('client', (c) => console.log('[relay] + client', c.id));
aedes.on('clientDisconnect', (c) => console.log('[relay] - client', c.id));

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`BDSC relay listening on ws://0.0.0.0:${PORT}/mqtt (and ws://0.0.0.0:${PORT}/)`);
});
