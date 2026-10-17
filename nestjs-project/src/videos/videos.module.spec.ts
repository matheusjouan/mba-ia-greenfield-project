import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Video } from './entities/video.entity';
import { VideosModule } from './videos.module';

describe('VideosModule', () => {
  it('should compile with the Video repository registered', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [VideosModule],
    })
      .overrideProvider(getRepositoryToken(Video))
      .useValue({})
      .compile();

    expect(moduleRef.get(getRepositoryToken(Video))).toBeDefined();
  });
});
