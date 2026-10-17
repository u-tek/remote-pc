import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { Duplex } from 'node:stream';

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;
type Upgrade = (req: http.IncomingMessage, socket: Duplex, head: Buffer) => void;

/**
 * One port that speaks both HTTP and HTTPS: the first byte of a connection tells them apart
 * (a TLS handshake starts with 0x16). Phones paired before HTTPS was available keep working,
 * and HTTPS can be switched on or its certificate renewed without restarting.
 */
export class AgentListener {
  readonly server: net.Server;
  private readonly plain: http.Server;
  private secure?: https.Server;

  constructor(
    private readonly handler: Handler,
    private readonly upgrade: Upgrade,
  ) {
    this.plain = this.configure(http.createServer(handler));
    this.server = net.createServer((socket) => {
      socket.on('error', () => socket.destroy());
      socket.once('data', (head: Buffer) => {
        socket.pause();
        socket.unshift(head);
        const target = head[0] === 0x16 && this.secure ? this.secure : this.plain;
        target.emit('connection', socket);
        process.nextTick(() => socket.resume());
      });
    });
  }

  private configure<T extends http.Server>(server: T): T {
    server.on('upgrade', this.upgrade);
    // Long agent turns and big file transfers: no request timeout.
    server.requestTimeout = 0;
    return server;
  }

  get tls(): boolean {
    return !!this.secure;
  }

  setTls(creds: { cert: Buffer; key: Buffer } | undefined): void {
    if (!creds) {
      this.secure = undefined;
    } else if (this.secure) {
      this.secure.setSecureContext(creds);
    } else {
      this.secure = this.configure(https.createServer({ ...creds, minVersion: 'TLSv1.2' }, this.handler));
    }
  }

  close(): void {
    this.server.close();
    this.plain.close();
    this.secure?.close();
  }
}
