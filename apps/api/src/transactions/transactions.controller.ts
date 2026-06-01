import {
  Body, Controller, Get, HttpCode, Post, Query, ServiceUnavailableException, ConflictException,
} from '@nestjs/common';
import { ScoreRequestDto } from './dto/score-request.dto';
import { ScoreResponseDto } from './dto/score-response.dto';
import { ListQueryDto } from './dto/list-query.dto';
import { ScoreService, RedisUnavailableError, InFlightError } from './scoring/score.service';
import { TransactionsRepository } from './transactions.repository';

@Controller()
export class TransactionsController {
  constructor(
    private readonly scoreService: ScoreService,
    private readonly repo: TransactionsRepository,
  ) {}

  @Post('score')
  @HttpCode(200)
  async score(@Body() body: ScoreRequestDto): Promise<ScoreResponseDto> {
    try {
      return await this.scoreService.handle(body);
    } catch (e) {
      if (e instanceof RedisUnavailableError) {
        throw new ServiceUnavailableException('scoring temporarily unavailable');
      }
      if (e instanceof InFlightError) {
        throw new ConflictException('transaction is being processed');
      }
      throw e;
    }
  }

  @Get('transactions')
  async list(@Query() query: ListQueryDto) {
    return this.repo.list(query.limit, query.cursor);
  }
}
