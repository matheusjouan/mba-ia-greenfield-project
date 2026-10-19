import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { VIDEO_PROCESSING_QUEUE } from './queues.constants';
import { VideoProcessingProducer } from './video-processing.producer';

@Module({
  imports: [BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE })],
  providers: [VideoProcessingProducer],
  exports: [BullModule, VideoProcessingProducer],
})
export class QueuesModule {}
