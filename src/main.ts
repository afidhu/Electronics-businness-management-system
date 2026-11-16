import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { API_PREFIX, configureApp, SWAGGER_PATH } from './app.setup';
import { AppConfigService } from './config/app-config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(AppConfigService);
  app.useLogger(config.logLevels);

  configureApp(app);
  await app.listen(config.port);

  const logger = new Logger('Bootstrap');
  logger.log(
    `API listening on port ${config.port} under /${API_PREFIX} (${config.nodeEnv})`,
  );
  if (config.swaggerEnabled) logger.log(`Swagger UI at /${SWAGGER_PATH}`);
}

void bootstrap();
