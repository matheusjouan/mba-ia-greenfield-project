// Runs before `dotenv/config` (which never overrides variables already set):
// test jobs live under their own BullMQ prefix so the `video-worker` service
// from Docker Compose (prefix `bull`) never consumes them.
process.env.QUEUE_PREFIX ??= 'streamtube-test';
