import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 4000);
  const prefix = config.get<string>('API_PREFIX', 'api/v1');
  const corsOrigins = config.get<string>('CORS_ORIGINS', 'http://localhost:3000');

  // Security
  app.use(helmet());

  // CORS
  app.enableCors({
    origin: corsOrigins.split(',').map((o) => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Global prefix
  app.setGlobalPrefix(prefix);

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Swagger API documentation
  if (config.get('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Oracle API')
      .setDescription('Oracle Sports Betting Intelligence Platform — API Documentation')
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('auth', 'Authentication & user management')
      .addTag('events', 'Sports events and fixtures')
      .addTag('markets', 'Betting markets and probabilities')
      .addTag('picks', 'Oracle Picks — top-ranked predictions')
      .addTag('builder', 'Multi-match Bet Builder')
      .addTag('health', 'Service health checks')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
    logger.log(`Swagger docs available at http://localhost:${port}/docs`);
  }

  await app.listen(port);
  logger.log(`Oracle API running on http://localhost:${port}/${prefix}`);
}

bootstrap();
