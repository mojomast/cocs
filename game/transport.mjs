export const OPEN = 1;

export class WebSocketTransport {
 open(url) {
  return new WebSocket(url);
 }
}

export const defaultTransport = new WebSocketTransport();
export default defaultTransport;
