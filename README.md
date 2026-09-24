# Unofficial Telegram Archive Manager

Hệ thống tự host để **lưu trữ và quản lý nội dung** từ các Telegram channel/group mà tài khoản của bạn có quyền truy cập. Hệ thống có các chức năng sau:
- import lịch sử message;
- tải media (video/ảnh/tài liệu/audio) về storage riêng;
- tìm kiếm, lọc, gắn tag, đánh dấu favorite;
- xem media ngay trên web;
- đồng bộ message mới.

> **Unofficial** — đây không phải sản phẩm của Telegram. Theo Telegram API Terms, tên ứng dụng dùng API chỉ được chứa chữ "Telegram" khi có "Unofficial" đứng trước.
> Hệ thống chỉ xử lý nội dung tài khoản được phép truy cập. Nó **không** bypass private channel, access control, DRM hay content protection:
> - chat có content protection (`noforwards`) bị bỏ qua hoàn toàn;
> - media tự huỷ (TTL/view-once) và message có hẹn giờ tự xoá không bao giờ được lưu.

---

## Trạng thái dự án

| Phase | Nội dung | Trạng thái |
|---|---|---|
| 1 | Kiến trúc, monorepo, PostgreSQL, Redis, Prisma, NestJS API nền, worker khung, Angular shell, Docker | ✅ Hoàn thành |
| 2 | Đăng nhập Telegram (mtcute), danh sách channel/group, chọn channel | ⏳ Tiếp theo |
| 3 | Import lịch sử message, import jobs, BullMQ | Kế hoạch |
| 4 | Tải media (resume/retry/dedup/checksum), storage local/S3, thumbnail | Kế hoạch |
| 5 | Dashboard đầy đủ, Channels, Messages, trình xem media | Kế hoạch |
| 6 | Search, Tags, Favorites, Filters | Kế hoạch |
| 7 | Tiến trình realtime (SSE), sync message mới | Kế hoạch |
| 8 | Test bổ sung, bảo mật, hiệu năng, Docker production | Kế hoạch |

Các trang web đang hiển thị trạng thái "Arrives in Phase N" sẽ được thay bằng dữ liệu thật ở phase tương ứng:

| Trang | Phase |
|---|---|
| Import Jobs (danh sách, wizard `imports/new`, chi tiết `imports/:id`) | 2–3 (realtime ở 7) |
| All Messages, Message detail, Videos/Images/Documents/Audio | 5 |
| Settings → Archive settings | 5 (phần Appearance đã dùng được) |
| Search, Tags, Favorites | 6 |

## Kiến trúc tổng quan

```
Angular (apps/web) ──HTTP + SSE, cookie session──► NestJS API (apps/api) ──Prisma──► PostgreSQL 18
                                                     │  RPC/jobs        ▲ events            (metadata; DB tam_tg: session Telegram)
                                                     ▼                  │
                                             Redis 7 ── BullMQ (prefix tam), pub/sub, heartbeat
                                                     │
                                  Worker (apps/worker) — process DUY NHẤT giữ kết nối Telegram
                                  queues: telegram-control, telegram-import, media-download,
                                          thumbnail-generation, metadata-processing
                                                     │
                                          Storage: local FS (dev) | S3-compatible (prod)
```

- **PostgreSQL là nguồn sự thật duy nhất.** BullMQ chỉ vận chuyển job. Mọi chuyển trạng thái đều là compare-and-set; unique constraint bảo đảm không bao giờ có message hoặc media trùng (idempotency).
- **Chỉ worker giữ kết nối Telegram**, vì hai process dùng chung một auth key sẽ gặp `AUTH_KEY_DUPLICATED`. API không có `TELEGRAM_API_ID/HASH`.
- **Binary media không bao giờ nằm trong PostgreSQL.** Storage key có dạng `channels/{channelId}/messages/{messageId}/media/{mediaId}/original`.

Cấu trúc monorepo (npm workspaces, ESM, TypeScript 6.0.3):

```
apps/web           Angular 22 (standalone, zoneless, signals, Material 3)
apps/api           NestJS 12 REST (+ SSE từ Phase 7), CLI create-user
apps/worker        NestJS 12 standalone + BullMQ
packages/shared    Contract dùng chung: enums, zod schemas, DTO, tên queue, event
packages/database  Prisma schema + migrations + generated client
packages/telegram  Interface TelegramClient (+ adapter mtcute từ Phase 2)
packages/storage   Interface StorageDriver (+ Local/S3 từ Phase 4)
```

---

## 1. Requirements

| Thành phần | Phiên bản | Ghi chú |
|---|---|---|
| Node.js | 24.15+ (đã kiểm thử 24.21) | `.nvmrc` = 24.21.0; `engines`: `^24.15.0 \|\| >=26` |
| npm | 11+ | Đã kiểm thử 11.19; `allowScripts` là tính năng của npm 11 |
| PostgreSQL | **18** | Cần hàm `uuidv7()` và extension `pg_trgm`, `unaccent` (có sẵn trong contrib) |
| Redis | 7.4 (tối thiểu 6.2) | BullMQ 6; bắt buộc `maxmemory-policy noeviction`; nên bật AOF |
| Docker Engine + Compose v2 | mới | Chỉ cho production trên **Linux** |
| Tài khoản Telegram + `api_id`/`api_hash` | — | Cần từ Phase 2 |

Dung lượng đĩa: `node_modules` khoảng 0.6–1 GB. Media tải về có thể rất lớn, nên đặt `STORAGE_LOCAL_ROOT` ở ổ còn nhiều chỗ, hoặc dùng S3 (Phase 4).

## 2. Install

```powershell
git clone <repo> web-bk-telegram
cd web-bk-telegram
npm install          # chỉ chạy ở thư mục gốc; npm workspaces cài cho mọi app/package
```

- **Install scripts (npm 11):** các package cần chạy script lúc cài (Prisma engines, argon2, esbuild, swc, …) đã được duyệt sẵn trong `allowScripts` ở `package.json` gốc. Nếu npm báo `install-scripts … not yet covered`, hãy xem bằng `npm install-scripts ls` rồi duyệt bằng `npm install-scripts approve <pkg>`.
- **Phiên bản bị ghim có chủ đích:**
  - `typescript ~6.0.3`: TypeScript 7 chưa có compiler API cho Angular và typescript-eslint.
  - `vitest ~4.1`: `@angular/build` 22.1 chưa hỗ trợ Vitest 5.
  - `prisma`/`@prisma/client`/`@prisma/adapter-pg` **đúng 7.10.0**: tag `latest` của prisma đang là bản 8 RC.
  - **Không** chạy `npm i prisma` mà không ghi version.

## 3. Environment variables

Mọi biến nằm trong **một file `.env` ở thư mục gốc**; mẫu là `.env.example`. File `.env` đã nằm trong `.gitignore`, **không bao giờ commit**. Biến môi trường thật luôn được ưu tiên hơn giá trị trong `.env`. API chỉ đọc các biến của API, nên secret Telegram không lọt vào process API.

| Biến | Process | Mặc định | Ý nghĩa |
|---|---|---|---|
| `NODE_ENV` | api, worker | `development` | `development` \| `test` \| `production` (production: log JSON) |
| `LOG_LEVEL` | api, worker | `info` | `debug` \| `info` \| `warn` \| `error` |
| `DATABASE_URL` | api, worker, prisma | — (bắt buộc) | `postgresql://tam:<pw>@localhost:5432/tam` |
| `SHADOW_DATABASE_URL` | prisma (dev) | — | DB trống cho `migrate dev`/`db:check`, ví dụ `…/tam_shadow` |
| `REDIS_URL` | api, worker | — (bắt buộc) | `redis://:<pw>@127.0.0.1:6380/0` |
| `BULLMQ_PREFIX` | api, worker | `tam` | Prefix key BullMQ trong Redis |
| `API_HOST` / `API_PORT` | api | `127.0.0.1` / `3100` | Địa chỉ lắng nghe (trong Docker: `0.0.0.0`) |
| `COOKIE_SECURE` | api | `false` | `true` khi chạy sau HTTPS. `false` chỉ dùng cho HTTP local/LAN, vì trình duyệt bỏ cookie `Secure` trên http |
| `SESSION_TTL_HOURS` | api | `168` | Hạn phiên kiểu trượt (gia hạn khi còn dùng) |
| `SESSION_ABSOLUTE_TTL_DAYS` | api | `30` | Hạn tối đa tính từ lúc đăng nhập |
| `CSRF_TRUSTED_ORIGINS` | api | (rỗng) | Danh sách origin cách nhau bằng dấu phẩy, dạng `scheme://host[:port]`, **không có path** |
| `TRUST_PROXY` | api | `loopback` | Giá trị "trust proxy" của Express: `true`/`false`, số hop, hoặc danh sách `loopback`, `linklocal`, `uniquelocal`, IP/CIDR. Sau nginx trong Docker: `loopback, uniquelocal` |
| `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` | **chỉ worker** | — | Từ my.telegram.org. Phải đặt cả hai cùng lúc; hash là 32 ký tự hex |
| `TELEGRAM_SESSION_DATABASE_URL` | worker | — | DB riêng cho session Telegram (`…/tam_tg`) |
| `TELEGRAM_SESSION_KEY` | worker | — | 32 byte base64, dùng mã hoá auth key và trạng thái đăng nhập |
| `WORKER_HEARTBEAT_INTERVAL_MS` | worker | `5000` | Chu kỳ heartbeat (1000–60000); key có TTL = 3 × chu kỳ |
| `STORAGE_DRIVER` | worker (api từ Phase 4) | `local` | `local` \| `s3` |
| `STORAGE_LOCAL_ROOT` | worker (api từ Phase 4) | `./data/storage` | **Dùng đường dẫn tuyệt đối**, vì api và worker chạy ở thư mục khác nhau |
| `MIN_FREE_DISK_MB` | worker | `2048` | Dừng tải khi dung lượng trống thấp hơn ngưỡng này (Phase 4) |
| `S3_*` | worker/api (Phase 4) | — | Endpoint/bucket/key cho storage S3-compatible; chỉ nằm ở server |
| `POSTGRES_PASSWORD`, `REDIS_PASSWORD` | docker compose | — | Nên dùng chuỗi **hex** (`openssl rand -hex 24`), vì chúng nằm trong URL |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | docker compose (`bootstrap`) | — | Admin web đầu tiên; mật khẩu tối thiểu 12 ký tự |
| `WEB_PORT` | docker compose | `8080` | Cổng host của container web (nginx) |

Tạo key session Telegram:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## 4. Telegram API credentials

1. Đăng nhập <https://my.telegram.org> bằng số điện thoại của bạn, chọn **API development tools**.
2. Tạo ứng dụng mới. Tên ứng dụng **phải có "Unofficial" đứng trước "Telegram"**, hoặc không chứa chữ "Telegram". Platform chọn *Web* hoặc *Other*.
3. Chép `api_id` và `api_hash` vào `.env` (`TELEGRAM_API_ID`, `TELEGRAM_API_HASH`). **Chỉ worker** nhận hai biến này.
4. Đặt `TELEGRAM_SESSION_KEY` (xem mục 3) và `TELEGRAM_SESSION_DATABASE_URL`, trỏ tới DB `tam_tg`.

Lưu ý:
- Không chia sẻ `api_hash`, `.env` hay database `tam_tg`.
- Không dùng session của production trên máy dev. Hai nơi dùng cùng một auth key sẽ làm Telegram huỷ session.
- Luồng đăng nhập trên web được triển khai ở Phase 2 (mục 8).

## 5. Database migration

Schema nằm ở `packages/database/prisma/schema.prisma`, migrations ở `packages/database/prisma/migrations`.

| Lệnh | Khi nào dùng |
|---|---|
| `npm run db:deploy` | Áp dụng mọi migration chưa chạy (dev, CI, production) |
| `npm run db:migrate -- --name <tên>` | Dev, **có tương tác**: tạo migration từ thay đổi schema rồi áp dụng |
| `npm run migrate:create -w @tam/database -- --name <tên>` | Chỉ tạo file migration (không tương tác), sửa SQL nếu cần, rồi chạy `db:deploy` |
| `npm run db:check` | Kiểm tra drift: migrations và schema phải khớp (exit 0). Cần `SHADOW_DATABASE_URL` |
| `npm run db:recreate -- --yes` | **Chỉ dùng cho dev**: xoá và tạo lại DB trong `DATABASE_URL`, rồi áp dụng migrations. Dùng lệnh này thay cho `prisma migrate reset`, vì Prisma chặn `migrate reset` khi được gọi từ AI agent |
| `npm run db:generate` | Sinh lại Prisma client (các lệnh build/test đã tự gọi) |

Quy ước:
- **Mọi index**, kể cả GIN, trigram và partial index, **phải khai báo trong `schema.prisma`**. Index chỉ tạo bằng SQL tay sẽ bị `migrate dev` xoá.
- SQL viết tay trong migration chỉ dùng cho những thứ Prisma không mô tả được: extension `pg_trgm`/`unaccent`, text search config `tam_simple` (tìm tiếng Việt không dấu: "hoc" khớp "học") và trigger cập nhật `messages.search_vector`.
- Partial unique `import_jobs_one_active_per_channel` được viết ở dạng chuẩn hoá của PostgreSQL, để `db:check` luôn sạch.

## 6. Docker

`docker-compose.yml` dành cho **Linux host**. Windows Server 2019 không chạy được Linux containers.

| Service | Vai trò |
|---|---|
| `postgres` | PostgreSQL 18.6 (volume `pgdata`); script init tạo thêm DB `tam_tg` |
| `redis` | Redis 7.4.11, có mật khẩu, AOF, `noeviction` (volume `redisdata`) |
| `migrate` | One-shot `prisma migrate deploy` |
| `bootstrap` | One-shot tạo admin từ `ADMIN_EMAIL`/`ADMIN_PASSWORD` nếu chưa có. Mật khẩu truyền qua stdin |
| `api` | NestJS API (cổng nội bộ 3100, healthcheck `/api/health/live`) |
| `worker` | BullMQ worker. **Đúng 1 replica**; `stop_grace_period: 60s`; volume `media` |
| `web` | nginx phục vụ Angular và proxy `/api/`, cổng `${WEB_PORT:-8080}` |

```bash
cp .env.example .env
# Điền: POSTGRES_PASSWORD, REDIS_PASSWORD (hex), ADMIN_EMAIL, ADMIN_PASSWORD, TELEGRAM_*,
#       COOKIE_SECURE=true nếu có HTTPS phía trước, CSRF_TRUSTED_ORIGINS=https://<domain>
docker compose up -d --build
docker compose ps          # migrate/bootstrap: Exited (0); api/web: healthy
# Mở http://localhost:8080 và đăng nhập bằng ADMIN_EMAIL / ADMIN_PASSWORD
```

Smoke test toàn stack (build → chạy với secret tạm → health → đăng nhập → kiểm tra CSRF → gỡ sạch, kể cả volume):

```bash
bash scripts/compose-smoke.sh              # cổng 18080; đổi bằng SMOKE_WEB_PORT=9090
```

- Mỗi service chỉ nhận đúng các biến nó cần: secret Telegram chỉ vào `worker`, credential DB không vào `web`.
- `nginx` gửi `Host $http_host` (giữ cả port), vì CSRF fallback của API so sánh `Origin` với `Host`.
- SPA có CSP `script-src 'self'`: script khởi tạo theme nằm ở file riêng (`theme-init.js`) và build đã tắt inline critical CSS.

## 7. Run development

### Máy dev Windows hiện tại

| Dịch vụ | Chi tiết |
|---|---|
| PostgreSQL 18.6 | Windows service `postgresql-x64-18` (chạy bằng NetworkService). Binaries: `C:\MYDATA\tools\pgsql`; data: `C:\MYDATA\tools\pgdata`; `localhost:5432`. Role `tam` sở hữu các DB `tam`, `tam_tg`, `tam_shadow` |
| Redis 7.4.11 | Windows service `Redis74`, `127.0.0.1:6380`, có mật khẩu; config `C:\MYDATA\tools\redis74\tam-redis.conf` |
| Secret dev | `C:\MYDATA\tools\tam-dev-secrets.txt` (chỉ Administrators đọc được): mật khẩu PostgreSQL/Redis và tài khoản web `WEB_ADMIN_EMAIL` / `WEB_ADMIN_PASSWORD` (admin đầu tiên: `admin@tam.local`) |

> Service `Redis` trên cổng 6379 và các cổng 3000/4200 thuộc **dự án khác** trên máy này, không dùng chung. Dự án này dùng API :3100, web :4300, Redis :6380.

```powershell
Get-Service postgresql-x64-18, Redis74        # cả hai phải Running
Start-Service postgresql-x64-18, Redis74      # nếu đang dừng
```

<details>
<summary>Dựng lại môi trường trên một máy Windows khác (không có Docker)</summary>

1. **PostgreSQL 18:**
   - Tải bản *zip binaries* Windows x64 của EDB, chỉ giải nén `pgsql/bin`, `pgsql/lib`, `pgsql/share`.
   - Chạy `initdb -D <data> -U postgres -E UTF8 --locale-provider=builtin --builtin-locale=C.UTF-8 --locale=en-US --auth-local=scram-sha-256 --auth-host=scram-sha-256 --pwfile=<file>`.
   - Trong `postgresql.conf` đặt `listen_addresses='localhost'`.
   - Cấp quyền: `icacls <data> /grant "NT AUTHORITY\NetworkService:(OI)(CI)M" /T` (thiếu bước này thì service không start được).
   - Đăng ký service: `pg_ctl register -N postgresql-x64-18 -U "NT AUTHORITY\NetworkService" -D <data> -S auto`.
   - Tạo role và DB: `CREATE ROLE tam LOGIN CREATEDB PASSWORD '…'`, rồi `CREATE DATABASE tam OWNER tam` (tương tự cho `tam_tg`, `tam_shadow`).
   - **Không** dùng `lc_ctype=C`, vì khi đó pg_trgm không coi chữ có dấu là chữ cái.
2. **Redis 7.4:** dùng bản build `redis-windows` (*msys2-with-Service*): `RedisService.exe install -c <conf> --dir <data> --port 6380 --service-name Redis74 --start-mode auto`. Trong conf cần có `requirepass`, `appendonly yes`, `maxmemory-policy noeviction`.
</details>

### Chạy dự án

```powershell
copy .env.example .env               # rồi điền DATABASE_URL, SHADOW_DATABASE_URL, REDIS_URL, …
npm install
npm run db:deploy                    # tạo bảng
npm run build                        # lần đầu: tạo apps/api/dist (cần cho CLI tạo user)
'<mật-khẩu-≥12-ký-tự>' | node apps/api/dist/cli/create-user.js --email admin@example.com --password-stdin
npm run dev                          # build packages → tsc watch + api :3100 + worker + web :4300
```

- Mở <http://localhost:4300>. Angular dev server proxy `/api/` sang `http://127.0.0.1:3100`, nên cookie phiên là same-origin.
- CLI tạo user (`create-user`):
  - mật khẩu **chỉ nhận qua stdin**, không truyền trên dòng lệnh;
  - email phải có tên miền đầy đủ (ví dụ `admin@example.com`; `admin@local` bị từ chối);
  - `--if-missing` bỏ qua nếu email đã tồn tại;
  - exit code: 0 thành công, 1 lỗi (ví dụ email đã có), 2 sai cú pháp.
  - Trong bash/cmd có thể dùng `echo '<pw>' | npm run user:create -- --email … --password-stdin`. Trong **PowerShell**, khi pipe vào `npm`, dấu `--` bị nuốt, nên hãy gọi thẳng `node apps/api/dist/cli/create-user.js` như ví dụ trên.
  - PowerShell 5.1 có thể làm hỏng ký tự không phải ASCII khi pipe, nên dùng mật khẩu ASCII.
- Health: `curl http://127.0.0.1:3100/api/health/ready` trả trạng thái database, redis và worker (`alive`/`missing`).

### Kiểm tra chất lượng

| Lệnh | Nội dung |
|---|---|
| `npm run typecheck` | Build packages rồi typecheck mọi workspace (web dùng `ngc`, kiểm tra cả template) |
| `npm run lint` | ESLint 10 cho toàn repo (web dùng `apps/web/eslint.config.js`) |
| `npm test` | Unit test (Vitest) của mọi workspace, gồm component/service/routing test của Angular |
| `npm run test:integration` | Integration/e2e với PostgreSQL và Redis thật |
| `npm run build` | Build production toàn bộ |
| `npm run db:check` | Không có drift giữa migrations và schema |

Integration test **không bao giờ đụng dữ liệu dev**. Chúng tự xoá và tạo lại các DB tạm `tam_test_db`, `tam_test_api`, `tam_test_worker`, và dùng Redis db 14/15 với prefix riêng. Chạy riêng một workspace: `npm run test -w @tam/api`, `npm run test:integration -w @tam/worker`, …

## 8. Telegram authentication

*(Triển khai ở Phase 2.)* Luồng dự kiến trên trang **Import Jobs → New import**:
1. **Connect Telegram:** nhập số điện thoại. Worker gửi yêu cầu mã; mã thường đến qua app Telegram, có thể yêu cầu gửi lại.
2. Nhập mã. Nếu tài khoản bật mật khẩu 2 bước (2FA), nhập tiếp mật khẩu.
3. Trạng thái (`LOGGED_OUT → CODE_SENT → PASSWORD_REQUIRED → READY`) được lưu (có mã hoá) trong DB, nên worker restart không làm mất.

Mọi bước đều đi qua API tới worker. Nếu worker không chạy, API trả `503 WORKER_UNAVAILABLE`. Khi phiên bị thu hồi từ điện thoại, trạng thái quay về `LOGGED_OUT`.

## 9. Import channel

*(Triển khai ở Phase 3–4.)* Luồng dự kiến:
1. Chọn channel/group trong danh sách truy cập được. Chat protected hiển thị nhãn "Protected" và không import được.
2. Chọn **Import all history** hoặc **Import from date**, rồi bấm Start.
3. Lịch sử được đọc theo trang 100 message. Mỗi trang được ghi trong một transaction, cùng với cursor, nên crash hay restart đều tiếp tục đúng chỗ và **không tạo bản trùng**.
4. Media được tải qua queue `media-download`: resume từ file `.part`, retry với exponential backoff, kiểm tra SHA-256, không tải lại file trùng. Có thể Pause/Resume/Cancel.

## 10. Start sync

*(Triển khai ở Phase 7.)* Sau khi import xong, dùng **Sync** để chỉ lấy message mới (idempotent, chạy nhiều lần không tạo bản trùng). Có thể bật sync định kỳ cho từng channel (`syncEnabled`). Phần realtime dùng Telegram updates, cộng với job định kỳ làm lưới an toàn.

## 11. Production deployment

Hướng dẫn hiện tại (bản đầy đủ ở Phase 8):
- Chạy trên **Linux** bằng Docker Compose (mục 6) và kiểm tra trước bằng `scripts/compose-smoke.sh`.
- **Đặt HTTPS phía trước** (reverse proxy/TLS terminator, bật HTTP/2 vì SSE giữ kết nối lâu), rồi đặt `COOKIE_SECURE=true` và `CSRF_TRUSTED_ORIGINS=https://<domain>`.
- **Đúng một worker**: không scale `worker`, và luôn dừng worker cũ trước khi chạy bản mới.
- Backup định kỳ các volume `pgdata` (bao gồm `tam_tg`) và `media`. Giữ `.env` ở nơi an toàn.
- Mật khẩu PostgreSQL/Redis dùng chuỗi hex dài. Không public cổng PostgreSQL/Redis ra ngoài.
- Nếu chạy trực tiếp trên host bằng pm2 thay vì Docker: worker dùng `exec_mode: fork` với `instances: 1`, `shutdown_with_message: true` và `kill_timeout` ≥ 60000 (Phase 8 sẽ thêm `ecosystem.config.cjs`).

## 12. Troubleshooting

| Triệu chứng | Nguyên nhân / cách xử lý |
|---|---|
| Service `postgresql-x64-18` không start | Thư mục data thiếu quyền cho NetworkService: `icacls C:\MYDATA\tools\pgdata /grant "NT AUTHORITY\NetworkService:(OI)(CI)M" /T`. Xem log trong `pgdata\log` |
| `ECONNREFUSED 127.0.0.1:6380` / `NOAUTH` | Service `Redis74` đang dừng, hoặc `REDIS_URL` thiếu mật khẩu (`redis://:<pw>@127.0.0.1:6380/0`) |
| Lỡ kết nối vào Redis 6379 | Đó là Redis 5 của dự án khác. BullMQ 6 sẽ cảnh báo phiên bản và job có thể mất khi restart. Hãy dùng 6380 |
| `EADDRINUSE :3000` / `:4200` | Cổng của dự án khác. Dự án này dùng 3100 (API) và 4300 (web) |
| `/api/health/ready` báo `worker: missing` | Worker chưa chạy, hoặc không ghi được heartbeat vào Redis. Chạy `npm run dev:run -w @tam/worker` sau khi build |
| API/worker thoát ngay với `Config validation error` / `Invalid environment` | Biến trong `.env` sai định dạng; thông báo liệt kê đúng tên biến (không in giá trị) |
| `prisma migrate reset` bị từ chối | Prisma chặn lệnh này khi chạy từ AI agent. Dùng `npm run db:recreate -- --yes` (chỉ cho dev) |
| `npm warn Unknown cli config "--email"` khi tạo user | PowerShell nuốt dấu `--` khi pipe vào `npm`. Gọi thẳng `node apps/api/dist/cli/create-user.js --email … --password-stdin` |
| `db:check` báo khác biệt | Có index/constraint chỉ tồn tại trong SQL tay. Hãy khai báo trong `schema.prisma` |
| npm cảnh báo `install-scripts … not yet covered` | Xem `npm install-scripts ls`, duyệt package tin cậy bằng `npm install-scripts approve <pkg>` |
| Ai đó nâng TypeScript lên 7.x | Build Angular/ESLint hỏng. Giữ `typescript ~6.0.3` (đã ghim bằng `overrides`) |
| Ổ đĩa đầy | Giảm `MIN_FREE_DISK_MB` là không đủ; chuyển `STORAGE_LOCAL_ROOT` sang ổ khác hoặc dùng S3 (Phase 4). Có thể dọn cache: `npm cache clean --force` |
| Nhiều tab mở cùng lúc, request bị treo (HTTP/1.1) | Trình duyệt giới hạn 6 kết nối mỗi host cho mọi tab. Dev: đóng bớt tab. Production: bật HTTP/2 ở reverse proxy |
| Giao diện web mất style sau nginx | Kiểm tra CSP: build phải tắt `inlineCritical` và không có inline script (`theme-init.js` là file riêng) |
