import { randomBytes } from 'node:crypto';
import { VIDEO_SLUG_LENGTH } from './videos.constants';

/**
 * Short, URL-safe and unguessable video identifier (11 base64url chars,
 * 66 bits of entropy). Uniqueness is enforced by the database index.
 */
export function generateVideoSlug(): string {
  return randomBytes(9).toString('base64url').slice(0, VIDEO_SLUG_LENGTH);
}
