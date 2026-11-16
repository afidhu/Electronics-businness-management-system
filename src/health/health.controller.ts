import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../auth/decorators';
import { ErrorResponseDto } from '../common/errors/error-response.dto';
import { HealthService, HealthStatus } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  // Public by design: probed by Docker/reverse proxy. Reveals no internals.
  @Get()
  @Public()
  @ApiOperation({ summary: 'Readiness check (API + database)' })
  @ApiOkResponse({
    description:
      'Envelope `{ data: { status: "ok", checks: { database: "up" }, uptimeSeconds, timestamp }, meta: { requestId } }`',
  })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto })
  check(): Promise<HealthStatus> {
    return this.health.check();
  }
}
