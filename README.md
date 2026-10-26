# 동네장터 공동구매 · 백엔드 (NestJS)

동네 로컬푸드 마켓의 **농산물 공동구매 신청·취소 서버**입니다. 수량·1인 한도·마감 같은 규칙을 서버가 직접 지킵니다.
고객 요청과 설계 내용은 [기획서.md](기획서.md)에 있습니다. (Level 2 과제)

- 프론트엔드 저장소: `local-groupbuy-level2-frontend`
- 기술: NestJS · PostgreSQL (Render)
- 모든 이름·연락처는 가상 데이터입니다.

> ⏳ **첫 접속이 느릴 수 있어요.** 무료 Render 서버는 한동안 쓰지 않으면 잠들어서, 첫 요청에 **30초~1분** 정도 걸립니다. 한 번 깨어나면 빨라집니다. 화면이 "불러오는 중"이면 잠시만 기다려 주세요. `/health`를 먼저 열어 서버를 깨울 수 있어요.

## 서버가 지키는 규칙
| # | 규칙 |
|---|---|
| R1 | 남은 수량보다 많이 신청할 수 없다 |
| R2 | 1인 한도를 넘길 수 없다 (같은 연락처의 기존 신청과 합산) |
| R3 | 마감 후에는 신청도 취소도 할 수 없다 |
| R4 | 신청번호와 연락처가 모두 맞아야 취소할 수 있다 |
| R5 | 동시에 신청이 몰려도 수량이 어긋나지 않는다 |

## API
| 방식 | 주소 | 설명 |
|---|---|---|
| GET | `/health` | 서버와 DB 연결 확인 |
| GET | `/group-buys` | 목록. `q`(상품명), `category`, `origin`, `status`(진행중/마감) 필터 |
| GET | `/group-buys/options` | 필터에 쓸 종류·산지 목록 |
| GET | `/group-buys/:id` | 상세 |
| POST | `/group-buys` | 공동구매 등록 |
| POST | `/orders` | 신청 |
| POST | `/orders/cancel` | 취소 (신청번호 + 연락처) |
| GET | `/orders` | 신청 목록. `q`(이름·연락처·신청번호), `groupBuyId`, `status` |
| GET | `/stats` | 현황 숫자 3개 |
| POST | `/seed` | 가상 데이터로 전부 다시 채우기 (기존 데이터 삭제) |

## 내 컴퓨터에서 실행
```bash
npm install
cp .env.example .env     # DATABASE_URL을 채운다
npm run start            # http://localhost:4000
```
처음 켜면 `fde_assignment` 스키마에 테이블을 만들고, 데이터가 없으면 가상 데이터를 채웁니다.

## 설정값 (환경변수)
| 이름 | 뜻 | 예시 |
|---|---|---|
| `DATABASE_URL` | PostgreSQL 접속 주소. 비밀번호가 들어 있어 **절대 GitHub에 올리지 않습니다** | Render의 External Database URL |
| `FRONTEND_ORIGIN` | 접속을 허용할 프론트 주소(CORS). 여러 개는 쉼표로. 끝에 `/`를 붙이지 않습니다 | `https://내-프론트.vercel.app` |
| `PORT` | 서버 포트. Render가 자동으로 넣어 줍니다 | (넣지 않아도 됨) |

## Render에 올리기
1. Render 대시보드 → **New → Web Service** → 이 저장소를 연결합니다.
2. 아래처럼 입력합니다.

| 항목 | 값 |
|---|---|
| Language / Runtime | Node |
| Region | DB와 같은 지역 (Ohio, US East) |
| Branch | `main` |
| Root Directory | (비워 둠) |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm run start:prod` |
| Instance Type | Free |

3. **Environment** 에 `DATABASE_URL`, `FRONTEND_ORIGIN`을 넣습니다. (`NODE_VERSION=24`를 넣어도 되고, 저장소의 `.node-version` 파일이 같은 역할을 합니다.)
4. 배포가 끝나면 `https://서비스이름.onrender.com/health`가 `{"status":"ok","db":"connected"}`를 돌려주는지 확인합니다.
5. Vercel에 프론트를 올린 뒤, 그 주소를 `FRONTEND_ORIGIN`에 넣고 다시 배포합니다.

> `DATABASE_URL`에는 Render Postgres의 **External Database URL**을 넣으세요. 이 서버는 인증서를 검증하며 접속합니다.
