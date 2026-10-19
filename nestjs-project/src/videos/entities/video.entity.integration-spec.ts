import { randomUUID } from 'node:crypto';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import {
  cleanAllTables,
  ALL_ENTITIES,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { VideoStatus } from '../videos.constants';
import { Video } from './video.entity';
const TEN_GIB = 10737418240;

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;
  let counter = 0;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  async function createChannel(): Promise<Channel> {
    counter += 1;
    const user = await userRepository.save(
      userRepository.create({
        email: `video_owner_${counter}@example.com`,
        password: 'hashed',
      }),
    );
    return channelRepository.save(
      channelRepository.create({
        name: `owner${counter}`,
        nickname: `owner${counter}`,
        user_id: user.id,
      }),
    );
  }

  function buildVideo(channel: Channel, overrides: Partial<Video> = {}): Video {
    const id = randomUUID();
    return videoRepository.create({
      id,
      slug: `slug${String(counter).padStart(7, '0')}`,
      channel_id: channel.id,
      title: 'My clip',
      original_filename: 'clip.mp4',
      mime_type: 'video/mp4',
      file_size: 1024,
      storage_key: `videos/${id}/source.mp4`,
      upload_id: 'upload-id',
      ...overrides,
    });
  }

  it('persists the id provided by the service', async () => {
    const channel = await createChannel();
    const video = buildVideo(channel);

    await videoRepository.save(video);

    const stored = await videoRepository.findOneByOrFail({ id: video.id });
    expect(stored.storage_key).toBe(`videos/${video.id}/source.mp4`);
  });

  it('defaults status to draft', async () => {
    const channel = await createChannel();

    const saved = await videoRepository.save(buildVideo(channel));

    const stored = await videoRepository.findOneByOrFail({ id: saved.id });
    expect(stored.status).toBe(VideoStatus.Draft);
  });

  it('enforces a unique slug', async () => {
    const channel = await createChannel();
    await videoRepository.save(buildVideo(channel, { slug: 'duplicate01' }));

    await expect(
      videoRepository.save(buildVideo(channel, { slug: 'duplicate01' })),
    ).rejects.toThrow(QueryFailedError);
  });

  it('rejects a status outside the enum', async () => {
    const channel = await createChannel();
    const saved = await videoRepository.save(buildVideo(channel));

    await expect(
      dataSource.query(
        `UPDATE "videos" SET "status" = 'published' WHERE "id" = $1`,
        [saved.id],
      ),
    ).rejects.toThrow(QueryFailedError);
  });

  it('reads a 10 GiB file_size back as a number', async () => {
    const channel = await createChannel();
    const saved = await videoRepository.save(
      buildVideo(channel, { file_size: TEN_GIB }),
    );

    const stored = await videoRepository.findOneByOrFail({ id: saved.id });
    expect(stored.file_size).toBe(TEN_GIB);
    expect(typeof stored.file_size).toBe('number');
  });

  it('deletes the videos of a deleted channel', async () => {
    const channel = await createChannel();
    const saved = await videoRepository.save(buildVideo(channel));

    await channelRepository.delete({ id: channel.id });

    expect(await videoRepository.findOneBy({ id: saved.id })).toBeNull();
  });

  it('loads the owning channel through the relation', async () => {
    const channel = await createChannel();
    const saved = await videoRepository.save(buildVideo(channel));

    const stored = await videoRepository.findOneOrFail({
      where: { id: saved.id },
      relations: { channel: true },
    });
    expect(stored.channel.nickname).toBe(channel.nickname);
  });
});
