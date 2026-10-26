import { Module } from '@nestjs/common';
import { DbService } from './db.service.js';
import { HealthController } from './health.controller.js';
import { ShopController } from './shop.controller.js';
import { ShopService } from './shop.service.js';

@Module({
  controllers: [HealthController, ShopController],
  providers: [DbService, ShopService],
})
export class AppModule {}
