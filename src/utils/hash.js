import { createHash } from 'node:crypto';

export function sha1Hex(buffer) {
  return createHash('sha1').update(buffer).digest('hex');
}
