import { Module } from '@nestjs/common';
import { QueuesModule } from '../queues/queues.module';
import { StorageModule } from '../storage/storage.module';
import { VideosModule } from '../videos/videos.module';
import { MediaProbeService } from './media-probe.service';
import { VideoProcessingProcessor } from './video-processing.processor';
import { VideoProcessingService } from './video-processing.service';

/** Consumer side of the video-processing queue. Imported only by the worker. */
@Module({
  imports: [QueuesModule, VideosModule, StorageModule],
  providers: [
    MediaProbeService,
    VideoProcessingService,
    VideoProcessingProcessor,
  ],
})
export class VideoWorkerModule {}
