import { generateVideoSlug } from './video-slug.util';

describe('generateVideoSlug', () => {
  it('should return 11 base64url characters', () => {
    const slug = generateVideoSlug();

    expect(slug).toHaveLength(11);
    expect(slug).toMatch(/^[A-Za-z0-9_-]{11}$/);
  });

  it('should not repeat across 10 000 generations', () => {
    const slugs = new Set(
      Array.from({ length: 10_000 }, () => generateVideoSlug()),
    );

    expect(slugs.size).toBe(10_000);
  });
});
