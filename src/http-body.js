import { ActionError } from './errors.js';

// Past its limit, a body is read and dropped up to this much more, so the 413 reaches the client;
// beyond that the connection is cut, so no sender can keep the server reading forever.
export const DRAIN_LIMIT_BYTES = 4 * 1024 * 1024;

/**
 * A request's JSON body ({} when empty), up to `maxBytes`. A bigger one is
 * refused (413) once read to its end and dropped, or, far bigger, by
 * cutting the connection; bad JSON is a 400.
 */
export function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size <= maxBytes) {
        chunks.push(chunk);
      } else if (size > maxBytes + DRAIN_LIMIT_BYTES) {
        reject(new ActionError(413, 'Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (size > maxBytes) {
        reject(new ActionError(413, 'Request body too large'));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new ActionError(400, 'Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}
