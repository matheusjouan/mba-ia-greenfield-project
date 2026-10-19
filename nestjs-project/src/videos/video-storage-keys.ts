// Object storage layout: every artifact of a video lives under its own prefix.

export function videoSourceKey(videoId: string, extension: string): string {
  return `videos/${videoId}/source${extension}`;
}

export function videoThumbnailKey(videoId: string): string {
  return `videos/${videoId}/thumbnail.jpg`;
}
