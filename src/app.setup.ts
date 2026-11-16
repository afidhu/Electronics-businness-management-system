import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import {
  accessLogMiddleware,
  REQUEST_ID_HEADER,
  requestIdMiddleware,
} from './common/request-context/request-id.middleware';
import { createValidationPipe } from './common/validation/validation.pipe';
import { AppConfigService } from './config/app-config.service';

export const API_PREFIX = 'api/v1';
export const SWAGGER_PATH = 'api/docs';

/**
 * Applies the cross-cutting HTTP setup (ADR-013). Used by main.ts AND the
 * e2e tests, so tests exercise exactly the production pipeline.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get(AppConfigService);

  // Behind Nginx/Caddy, trust N proxy hops so req.ip (rate limiting, audit)
  // is the real client IP and not the proxy's (ADR-018).
  (app as NestExpressApplication).set('trust proxy', config.trustProxy);

  // Correlation ID first, so every later log line and error carries it.
  app.use(requestIdMiddleware);
  if (config.nodeEnv !== 'test') app.use(accessLogMiddleware);

  app.use(helmet());
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true, // required later for the HttpOnly refresh-token cookie
    exposedHeaders: [REQUEST_ID_HEADER],
  });

  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  if (config.swaggerEnabled) setupSwagger(app);
}

function setupSwagger(app: INestApplication): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('ElectroCore EBMS API')
      .setDescription(
        'Electronics Business Management System REST API. ' +
          'Success responses: `{ data, meta: { requestId, pagination? } }`. ' +
          'Errors: `{ statusCode, code, message, requestId, details? }`. ' +
          'Money values are decimal strings (TZS); timestamps are ISO-8601 UTC.',
      )
      .setVersion('0.1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    jsonDocumentUrl: `${SWAGGER_PATH}-json`,
  });
}
