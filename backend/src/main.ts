import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { config } from './config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.enableCors({
    origin: config.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
    credentials: false,
    exposedHeaders: ['content-disposition', 'x-batch-number']
  });
  app.enableShutdownHooks();
  await app.listen(config.PORT, '0.0.0.0');
}

bootstrap();
