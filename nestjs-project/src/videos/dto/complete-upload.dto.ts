import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class UploadedPartInputDto {
  /** Part number, as used in the presigned URL. */
  @IsInt()
  @Min(1)
  @Max(10000)
  part_number: number;

  /** ETag header returned by the storage for this part's PUT. */
  @IsString()
  @IsNotEmpty()
  etag: string;
}

export class CompleteUploadDto {
  /** Every uploaded part with its ETag. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10000)
  @ValidateNested({ each: true })
  @Type(() => UploadedPartInputDto)
  parts: UploadedPartInputDto[];
}
