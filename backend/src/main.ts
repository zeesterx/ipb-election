import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { config } from './config';
import { runMigrations } from './migrate';

async function bootstrap() {
  await runMigrations();
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.enableCors({
    origin: config.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
    credentials: false,
    exposedHeaders: ['content-disposition', 'x-batch-number']
  });
  app.enableShutdownHooks();
  await app.listen(config.PORT, config.HOST);
}

bootstrap();
