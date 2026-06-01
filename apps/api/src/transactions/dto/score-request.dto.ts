import {
  IsUUID, IsString, IsNumber, IsISO8601, IsOptional, IsIP, Length, Min,
} from 'class-validator';
import type { ScoreRequest } from '@fraud/shared';

// implements ScoreRequest => compile error if the wire contract drifts.
export class ScoreRequestDto implements ScoreRequest {
  @IsUUID()
  transactionId!: string;

  @IsString()
  cardToken!: string;

  @IsString()
  customerId!: string;

  @IsNumber()
  @Min(0)
  amount!: number;

  @IsString()
  @Length(3, 3)
  currency!: string;

  @IsOptional()
  @IsIP()
  ip?: string;

  @IsString()
  country!: string;

  @IsOptional()
  @IsString()
  deviceFingerprint?: string;

  @IsISO8601()
  createdAt!: string;
}
