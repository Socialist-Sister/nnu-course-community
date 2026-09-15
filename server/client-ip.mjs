import {isIP} from 'node:net';

// Only the local reverse proxy may supply the client address. Nginx must
// overwrite X-Real-IP, and the application must listen on loopback only.
export function clientIp(req, env=process.env) {
  const peer=req.socket.remoteAddress || 'local';
  const local=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer);
  const forwarded=req.headers?.['x-real-ip'];
  return env.TRUST_LOCAL_PROXY==='1' && local && typeof forwarded==='string' && isIP(forwarded)
    ? forwarded : peer;
}
