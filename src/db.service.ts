import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';

export const GB = 'fde_assignment.group_buys';
export const OD = 'fde_assignment.orders';

const SCHEMA_SQL = `
CREATE SCHEMA IF NOT EXISTS fde_assignment;
CREATE TABLE IF NOT EXISTS ${GB} (
  id             serial PRIMARY KEY,
  title          text NOT NULL,
  category       text NOT NULL CHECK (category IN ('과일','채소','곡물','기타')),
  origin         text NOT NULL,
  price_per_box  integer NOT NULL CHECK (price_per_box > 0),
  total_boxes    integer NOT NULL CHECK (total_boxes >= 1),
  max_per_person integer NOT NULL DEFAULT 3 CHECK (max_per_person >= 1),
  deadline       timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ${OD} (
  id            serial PRIMARY KEY,
  order_code    text NOT NULL UNIQUE,
  group_buy_id  integer NOT NULL REFERENCES ${GB}(id) ON DELETE RESTRICT,
  name          text NOT NULL,
  phone         text NOT NULL,
  boxes         integer NOT NULL CHECK (boxes >= 1),
  status        text NOT NULL DEFAULT '신청' CHECK (status IN ('신청','취소')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  cancelled_at  timestamptz
);
CREATE INDEX IF NOT EXISTS orders_group_buy_idx ON ${OD}(group_buy_id);
CREATE INDEX IF NOT EXISTS orders_phone_idx ON ${OD}(phone);
`;

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('DB');
  readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: true, // 인증서 검증을 켠 채로 접속
    max: 5,
  });

  async onModuleInit() {
    try {
      await this.pool.query(SCHEMA_SQL);
      this.log.log('테이블 준비 완료 (fde_assignment)');
    } catch (e) {
      this.log.error(`DB 준비 실패: ${(e as Error).message}`);
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
