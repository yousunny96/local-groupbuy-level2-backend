import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DbService, GB, OD } from './db.service.js';
import { SEED_GROUP_BUYS, SEED_NAMES, fakePhone, makeRandom } from './seed.js';

const CATEGORIES = ['과일', '채소', '곡물', '기타'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

type Body = Record<string, unknown>;
type Errors = Record<string, string>;

function fail(message: string, errors?: Errors): never {
  throw new BadRequestException({ message, errors });
}

function text(v: unknown) {
  return typeof v === 'string' ? v.trim() : '';
}

function toInt(v: unknown) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : NaN;
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim());
  return NaN;
}

function normalizePhone(v: unknown) {
  return text(v).replace(/[\s-]/g, '');
}

function makeCode() {
  let c = '';
  for (let i = 0; i < 6; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return `GB-${c}`;
}

// 공동구매 + 신청 합계. 남은 박스는 저장하지 않고 항상 계산한다.
const GB_SELECT = `
  SELECT g.id, g.title, g.category, g.origin, g.price_per_box AS "pricePerBox",
         g.total_boxes AS "totalBoxes", g.max_per_person AS "maxPerPerson",
         g.deadline, g.created_at AS "createdAt",
         COALESCE(SUM(o.boxes) FILTER (WHERE o.status = '신청'), 0)::int AS "orderedBoxes",
         COUNT(DISTINCT o.phone) FILTER (WHERE o.status = '신청')::int AS "applicants",
         (g.deadline > now()) AS "isOpen"
  FROM ${GB} g LEFT JOIN ${OD} o ON o.group_buy_id = g.id`;

function shapeGroupBuy(r: Record<string, any>) {
  const remainingBoxes = r.totalBoxes - r.orderedBoxes;
  return {
    ...r,
    isOpen: undefined,
    remainingBoxes,
    status: r.isOpen ? '진행중' : '마감',
    soldOut: remainingBoxes <= 0,
  };
}

@Injectable()
export class ShopService {
  constructor(private readonly db: DbService) {}

  // ---------- 공동구매 ----------
  async listGroupBuys(q: Record<string, string | undefined>) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.category) {
      params.push(q.category);
      where.push(`g.category = $${params.length}`);
    }
    if (q.origin) {
      params.push(q.origin);
      where.push(`g.origin = $${params.length}`);
    }
    if (q.status === '진행중') where.push('g.deadline > now()');
    if (q.status === '마감') where.push('g.deadline <= now()');
    if (q.q?.trim()) {
      params.push(`%${q.q.trim()}%`);
      where.push(`g.title ILIKE $${params.length}`);
    }
    const sql = `${GB_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      GROUP BY g.id ORDER BY (g.deadline > now()) DESC,
        CASE WHEN g.deadline > now() THEN g.deadline END ASC, g.deadline DESC`;
    const { rows } = await this.db.pool.query(sql, params);
    return rows.map(shapeGroupBuy);
  }

  async groupBuyOptions() {
    const { rows } = await this.db.pool.query(`SELECT DISTINCT origin FROM ${GB} ORDER BY origin`);
    return { categories: CATEGORIES, origins: rows.map((r) => r.origin as string) };
  }

  async getGroupBuy(id: number) {
    if (!Number.isInteger(id)) throw new NotFoundException({ message: '공동구매를 찾을 수 없어요.' });
    const { rows } = await this.db.pool.query(`${GB_SELECT} WHERE g.id = $1 GROUP BY g.id`, [id]);
    if (!rows[0]) throw new NotFoundException({ message: '공동구매를 찾을 수 없어요.' });
    return shapeGroupBuy(rows[0]);
  }

  async createGroupBuy(body: Body) {
    const errors: Errors = {};
    const title = text(body.title);
    const origin = text(body.origin);
    const category = text(body.category);
    const price = toInt(body.pricePerBox);
    const total = toInt(body.totalBoxes);
    const max = body.maxPerPerson === undefined || body.maxPerPerson === '' ? 3 : toInt(body.maxPerPerson);
    const deadline = new Date(text(body.deadline));

    if (!title) errors.title = '상품명을 입력해 주세요.';
    else if (title.length > 50) errors.title = '상품명은 50자 이내로 적어 주세요.';
    if (!CATEGORIES.includes(category)) errors.category = '종류를 골라 주세요.';
    if (!origin) errors.origin = '산지를 입력해 주세요.';
    if (!(price > 0)) errors.pricePerBox = '박스당 가격은 1원 이상의 숫자로 적어 주세요.';
    if (!(total >= 1)) errors.totalBoxes = '총 박스 수는 1 이상의 숫자로 적어 주세요.';
    else if (total > 10000) errors.totalBoxes = '총 박스 수는 10,000 이하로 적어 주세요.';
    if (!(max >= 1)) errors.maxPerPerson = '1인 최대 박스 수는 1 이상의 숫자로 적어 주세요.';
    else if (total >= 1 && max > total) errors.maxPerPerson = '1인 최대 박스 수는 총 박스 수보다 클 수 없어요.';
    if (Number.isNaN(deadline.getTime())) errors.deadline = '마감 시간을 골라 주세요.';
    else if (deadline.getTime() <= Date.now()) errors.deadline = '마감 시간은 지금보다 이후여야 해요.';
    if (Object.keys(errors).length) fail('입력한 내용을 다시 확인해 주세요.', errors);

    const { rows } = await this.db.pool.query(
      `INSERT INTO ${GB} (title, category, origin, price_per_box, total_boxes, max_per_person, deadline)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [title, category, origin, price, total, max, deadline.toISOString()],
    );
    return this.getGroupBuy(rows[0].id);
  }

  // ---------- 신청 ----------
  async createOrder(body: Body) {
    const errors: Errors = {};
    const groupBuyId = toInt(body.groupBuyId);
    const name = text(body.name);
    const phone = normalizePhone(body.phone);
    const boxes = toInt(body.boxes);

    if (!Number.isInteger(groupBuyId)) errors.groupBuyId = '공동구매를 골라 주세요.';
    if (!name) errors.name = '이름을 입력해 주세요.';
    else if (name.length > 20) errors.name = '이름은 20자 이내로 적어 주세요.';
    if (!/^01\d{8,9}$/.test(phone)) errors.phone = '연락처를 숫자로 정확히 적어 주세요. (예: 010-1234-5678)';
    if (!(boxes >= 1)) errors.boxes = '박스 수는 1 이상의 숫자로 적어 주세요.';
    else if (boxes > 10000) errors.boxes = '박스 수가 너무 커요.';
    if (Object.keys(errors).length) fail('입력한 내용을 다시 확인해 주세요.', errors);

    return this.tx(async (c) => {
      // R5: 이 공동구매를 한 번에 한 명씩만 처리해서, 동시에 눌러도 수량이 어긋나지 않게 한다
      const g = (await c.query(`SELECT * FROM ${GB} WHERE id = $1 FOR UPDATE`, [groupBuyId])).rows[0];
      if (!g) throw new NotFoundException({ message: '공동구매를 찾을 수 없어요.' });

      // R3: 마감 후 신청 불가
      if (new Date(g.deadline).getTime() <= Date.now()) fail('마감된 공동구매예요.');

      const sums = (
        await c.query(
          `SELECT COALESCE(SUM(boxes),0)::int AS ordered,
                  COALESCE(SUM(boxes) FILTER (WHERE phone = $2),0)::int AS mine
           FROM ${OD} WHERE group_buy_id = $1 AND status = '신청'`,
          [groupBuyId, phone],
        )
      ).rows[0];

      // R1: 남은 수량 초과 불가
      const remaining = g.total_boxes - sums.ordered;
      if (boxes > remaining) {
        fail(
          remaining <= 0
            ? '아쉽지만 모두 신청되어 남은 수량이 없어요.'
            : `남은 수량이 ${remaining}박스예요. ${remaining}박스 이하로 신청해 주세요.`,
          { boxes: `최대 ${Math.max(remaining, 0)}박스까지 신청할 수 있어요.` },
        );
      }

      // R2: 1인 한도 (같은 연락처의 기존 신청과 합산)
      if (sums.mine + boxes > g.max_per_person) {
        const canMore = Math.max(g.max_per_person - sums.mine, 0);
        fail(
          sums.mine > 0
            ? `한 분당 최대 ${g.max_per_person}박스까지예요. 이미 ${sums.mine}박스를 신청하셨어요.`
            : `한 분당 최대 ${g.max_per_person}박스까지 신청할 수 있어요.`,
          { boxes: canMore > 0 ? `${canMore}박스까지 더 신청할 수 있어요.` : '더 신청할 수 없어요.' },
        );
      }

      let code = makeCode();
      while ((await c.query(`SELECT 1 FROM ${OD} WHERE order_code = $1`, [code])).rowCount) code = makeCode();

      const { rows } = await c.query(
        `INSERT INTO ${OD} (order_code, group_buy_id, name, phone, boxes) VALUES ($1,$2,$3,$4,$5)
         RETURNING id, order_code AS "orderCode", name, phone, boxes, status, created_at AS "createdAt"`,
        [code, groupBuyId, name, phone, boxes],
      );
      return { ...rows[0], groupBuyId, groupBuyTitle: g.title, totalPrice: boxes * g.price_per_box };
    });
  }

  async cancelOrder(body: Body) {
    const code = text(body.orderCode).toUpperCase();
    const phone = normalizePhone(body.phone);
    const errors: Errors = {};
    if (!code) errors.orderCode = '신청번호를 입력해 주세요.';
    if (!phone) errors.phone = '연락처를 입력해 주세요.';
    if (Object.keys(errors).length) fail('입력한 내용을 다시 확인해 주세요.', errors);

    return this.tx(async (c) => {
      const o = (
        await c.query(
          `SELECT o.*, g.deadline, g.title FROM ${OD} o JOIN ${GB} g ON g.id = o.group_buy_id
           WHERE o.order_code = $1 FOR UPDATE OF o`,
          [code],
        )
      ).rows[0];
      // R4: 신청번호와 연락처가 모두 맞아야 한다 (어느 쪽이 틀렸는지는 알려 주지 않는다)
      if (!o || o.phone !== phone) fail('신청번호나 연락처가 맞지 않아요.');
      if (o.status === '취소') fail('이미 취소된 신청이에요.');
      // R3: 마감 후 취소 불가
      if (new Date(o.deadline).getTime() <= Date.now()) fail('마감된 공동구매는 취소할 수 없어요.');

      await c.query(`UPDATE ${OD} SET status = '취소', cancelled_at = now() WHERE id = $1`, [o.id]);
      return { orderCode: o.order_code, groupBuyTitle: o.title, boxes: o.boxes, status: '취소' };
    });
  }

  async listOrders(q: Record<string, string | undefined>) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.q?.trim()) {
      const like = `%${q.q.trim()}%`;
      params.push(like, `%${q.q.replace(/[\s-]/g, '')}%`);
      where.push(`(o.name ILIKE $1 OR o.phone LIKE $2 OR o.order_code ILIKE $1)`);
    }
    if (q.groupBuyId && Number.isInteger(Number(q.groupBuyId))) {
      params.push(Number(q.groupBuyId));
      where.push(`o.group_buy_id = $${params.length}`);
    }
    if (q.status === '신청' || q.status === '취소') {
      params.push(q.status);
      where.push(`o.status = $${params.length}`);
    }
    const { rows } = await this.db.pool.query(
      `SELECT o.id, o.order_code AS "orderCode", o.group_buy_id AS "groupBuyId", g.title AS "groupBuyTitle",
              o.name, o.phone, o.boxes, o.status, o.created_at AS "createdAt", o.cancelled_at AS "cancelledAt"
       FROM ${OD} o JOIN ${GB} g ON g.id = o.group_buy_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY o.created_at DESC, o.id DESC LIMIT 500`,
      params,
    );
    return rows;
  }

  // ---------- 현황 ----------
  async stats() {
    const { rows } = await this.db.pool.query(`
      SELECT
        (SELECT COUNT(*) FROM ${GB} WHERE deadline > now())::int AS "openGroupBuys",
        (SELECT COALESCE(SUM(boxes),0) FROM ${OD} WHERE status = '신청')::int AS "orderedBoxes",
        (SELECT COUNT(DISTINCT phone) FROM ${OD} WHERE status = '신청')::int AS "applicants"`);
    return rows[0];
  }

  // ---------- 가짜 데이터 ----------
  async seed() {
    return this.tx(async (c) => {
      await c.query(`TRUNCATE ${OD}, ${GB} RESTART IDENTITY`);
      const now = Date.now();
      // 공동구매를 한 번에 넣는다 (id는 1부터 순서대로 부여됨)
      await c.query(
        `INSERT INTO ${GB} (title, category, origin, price_per_box, total_boxes, max_per_person, deadline)
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::int[], $5::int[], $6::int[], $7::timestamptz[])`,
        [
          SEED_GROUP_BUYS.map((s) => s.title),
          SEED_GROUP_BUYS.map((s) => s.category),
          SEED_GROUP_BUYS.map((s) => s.origin),
          SEED_GROUP_BUYS.map((s) => s.price),
          SEED_GROUP_BUYS.map((s) => s.total),
          SEED_GROUP_BUYS.map((s) => s.max),
          SEED_GROUP_BUYS.map((s) => new Date(now + s.hoursLeft * 3600_000).toISOString()),
        ],
      );
      const ids = (await c.query(`SELECT id FROM ${GB} ORDER BY id`)).rows.map((r) => r.id as number);

      const rand = makeRandom(7);
      const rows: { gid: number; who: number; boxes: number; status: string; hoursAgo: number }[] = [];
      SEED_GROUP_BUYS.forEach((s, i) => {
        let left = Math.round(s.total * s.fill);
        const per = new Map<number, number>();
        let guard = 0;
        while (left > 0 && guard++ < 200) {
          const who = Math.floor(rand() * SEED_NAMES.length);
          const have = per.get(who) ?? 0;
          const room = Math.min(s.max - have, left);
          if (room <= 0) continue;
          const boxes = 1 + Math.floor(rand() * room);
          per.set(who, have + boxes);
          left -= boxes;
          rows.push({ gid: ids[i], who, boxes, status: '신청', hoursAgo: 1 + Math.floor(rand() * 120) });
        }
        // 취소된 신청 1~2건 (남은 수량 계산에는 들어가지 않는다)
        const extra = s.fill > 0 ? 1 + Math.floor(rand() * 2) : 0;
        for (let k = 0; k < extra; k++) {
          rows.push({
            gid: ids[i],
            who: Math.floor(rand() * SEED_NAMES.length),
            boxes: 1 + Math.floor(rand() * s.max),
            status: '취소',
            hoursAgo: 60,
          });
        }
      });

      const codes = new Set<string>();
      while (codes.size < rows.length) codes.add(makeCode());
      const codeList = [...codes];
      await c.query(
        `INSERT INTO ${OD} (order_code, group_buy_id, name, phone, boxes, status, created_at, cancelled_at)
         SELECT code, gid, name, phone, boxes, status,
                now() - (h || ' hours')::interval,
                CASE WHEN status = '취소' THEN now() - interval '20 hours' END
         FROM unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::int[], $6::text[], $7::text[])
              AS t(code, gid, name, phone, boxes, status, h)`,
        [
          codeList,
          rows.map((r) => r.gid),
          rows.map((r) => SEED_NAMES[r.who]),
          rows.map((r) => fakePhone(r.who)),
          rows.map((r) => r.boxes),
          rows.map((r) => r.status),
          rows.map((r) => String(r.hoursAgo)),
        ],
      );
      const cancelled = rows.filter((r) => r.status === '취소').length;
      return { groupBuys: SEED_GROUP_BUYS.length, orders: rows.length - cancelled, cancelledOrders: cancelled };
    });
  }

  async seedIfEmpty() {
    const { rows } = await this.db.pool.query(`SELECT COUNT(*)::int AS n FROM ${GB}`);
    if (rows[0].n === 0) await this.seed();
  }

  private async tx<T>(fn: (c: PoolClient) => Promise<T>) {
    const c = await this.db.pool.connect();
    try {
      await c.query('BEGIN');
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
}
