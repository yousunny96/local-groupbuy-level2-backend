import { Body, Controller, Get, HttpCode, OnApplicationBootstrap, Param, Post, Query } from '@nestjs/common';
import { ShopService } from './shop.service.js';

@Controller()
export class ShopController implements OnApplicationBootstrap {
  constructor(private readonly shop: ShopService) {}

  // 처음 켰을 때 DB가 비어 있으면 가짜 데이터를 한 번 채워서 빈 화면을 막는다
  async onApplicationBootstrap() {
    try {
      await this.shop.seedIfEmpty();
    } catch {
      // DB가 아직 준비되지 않았으면 /health에서 확인할 수 있다
    }
  }

  @Get('group-buys')
  list(@Query() q: Record<string, string>) {
    return this.shop.listGroupBuys(q);
  }

  @Get('group-buys/options')
  options() {
    return this.shop.groupBuyOptions();
  }

  @Get('group-buys/:id')
  one(@Param('id') id: string) {
    return this.shop.getGroupBuy(Number(id));
  }

  @Post('group-buys')
  create(@Body() body: Record<string, unknown>) {
    return this.shop.createGroupBuy(body ?? {});
  }

  @Post('orders')
  order(@Body() body: Record<string, unknown>) {
    return this.shop.createOrder(body ?? {});
  }

  @Post('orders/cancel')
  @HttpCode(200)
  cancel(@Body() body: Record<string, unknown>) {
    return this.shop.cancelOrder(body ?? {});
  }

  @Get('orders')
  orders(@Query() q: Record<string, string>) {
    return this.shop.listOrders(q);
  }

  @Get('stats')
  stats() {
    return this.shop.stats();
  }

  @Post('seed')
  @HttpCode(200)
  seed() {
    return this.shop.seed();
  }
}
