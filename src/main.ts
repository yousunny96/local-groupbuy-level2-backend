import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

try {
  process.loadEnvFile('.env');
} catch {
  // .env가 없으면 서버 환경변수를 그대로 쓴다 (Render 등)
}

const app = await NestFactory.create(AppModule);
const origins = (process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim());
app.enableCors({ origin: origins });
await app.listen(process.env.PORT ?? 4000);
