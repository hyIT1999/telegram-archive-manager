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
| 2 | Đăng nhập Telegram (mtcute), danh sách channel/group, chọn channel | ✅ Hoàn thành |
| 2b | Chọn nơi lưu cho từng channel: thư mục trên máy hoặc Google Drive | ✅ Hoàn thành |
| 3 | Import lịch sử message, import jobs (pause/resume/cancel), BullMQ, reconciler | ✅ Hoàn thành |
| 4 | Tải media (resume/retry/dedup/checksum) vào nơi lưu đã chọn, thumbnail | ✅ Hoàn thành |
| 5 | Dashboard đầy đủ, Channels (kèm forum topic), Messages, trình xem media | ✅ Hoàn thành |
| 6 | Search, Tags, Favorites, Filters | ✅ Hoàn thành |
| 7 | Tiến trình realtime (SSE), sync message mới | ✅ Hoàn thành |
| 8 | Test bổ sung, bảo mật, hiệu năng, Docker production, pm2 | ✅ Hoàn thành |

Đã dùng được:
- Phase 2: bước 1–4 của wizard **Import Jobs → New import** (kết nối Telegram, danh sách channel/group, thêm chat vào archive, chọn nơi lưu), **Settings → Telegram account**, **Settings → Storage locations**.
- Phase 3: bước 5–7 của wizard (chọn import toàn bộ hoặc từ một ngày, bắt đầu, theo dõi tiến trình), trang **Import Jobs** (`/imports`), chi tiết job `imports/:id` với Pause/Resume/Cancel, mục **Import** trên trang channel.
- Phase 4: mục **Media downloads** trên trang channel (công tắc tải tự động, tiến độ, file đang tải, **Retry failed**), **Settings → Media downloads**, công tắc tải ở bước Start của wizard, số file đã tải trên trang import job, và API xem/tải file `/api/media/*`.
- Phase 5: **All Messages**, **Videos/Images/Documents/Audio** (bộ lọc channel, topic, loại, ngày, file đã tải, thứ tự), trang message với trình phát video/audio, trình xem ảnh, xem trước PDF và nút tải khi cần; trang channel có **Topics** (forum) và **Library**; trang topic đọc như một khóa học; Dashboard có **Continue watching** và **Latest media** (mục "Xem archive" ở §9).
- Phase 6: ô tìm trên header và trang **Search** (text, caption và **tên file**, không dấu), ô tìm trong mọi danh sách; nút ♥ và trang **Favorites**; gắn tag ở trang message, trang **Tags** và trang từng tag; bộ lọc tag và favorite (mục "Tìm kiếm, tag và yêu thích" ở §9).
- Phase 7:
  - **Cập nhật realtime (SSE).** Trang import job, danh sách Import Jobs, các mục Import/Sync/Media downloads trên trang channel và bước Progress của wizard tự cập nhật ngay khi có thay đổi, không cần polling. Trang job hiện message đã đọc, file đã tìm thấy, phần trăm đã tải, số lỗi và **file đang tải**.
  - **Sync message mới** (§10):
    - mục **Sync** trên trang channel (công tắc, **Sync now**, lần sync gần nhất);
    - sync ngay khi Telegram báo có message mới, cộng thêm lượt kiểm tra định kỳ chỉnh được trong **Settings → Sync**;
    - công tắc sync ở bước Start của wizard;
    - bộ lọc All/Imports/Syncs trên trang Import Jobs.
- Phase 8:
  - **Chạy production** trên máy Windows này bằng pm2 (`npm run prod:start`, http://localhost:8080; API phục vụ luôn giao diện web), tự chạy lại khi lỗi và khi máy khởi động; hoặc bằng **Docker Compose** trên máy Linux trong LAN (§11).
  - **Settings → Your account:** đổi mật khẩu, xem các trình duyệt đang đăng nhập và đăng xuất từ xa. Đăng nhập sai 10 lần thì email bị khoá 15 phút. Lệnh `reset-password` đặt lại mật khẩu khi quên (§11).
  - Bảo mật HTTP (Host header, CSP chạy được trên HTTP, `X-Forwarded-For` không giả được sau nginx), font tự host (không tải gì từ Google), media có ETag/304.
  - Hiệu năng đo trên archive giả 150 000 message: hàng đợi tải từ 344 ms xuống 0,5 ms mỗi lượt, trang channel và mục Media downloads nhanh gấp 4–5 lần (§11).
  - Bộ test trình duyệt (Playwright), coverage và CI cho GitHub Actions (§7).

## Kiến trúc tổng quan

```
Angular (apps/web) ──HTTP + SSE, cookie session──► NestJS API (apps/api) ──Prisma──► PostgreSQL 18
                                                     │  RPC/jobs            ▲ LISTEN (trigger NOTIFY)   (metadata; DB tam_tg: session Telegram)
                                                     ▼
                                             Redis 7 ── BullMQ (prefix tam), pub/sub (RPC Telegram), heartbeat, lease
                                                     │
                                  Worker (apps/worker) — process DUY NHẤT giữ kết nối Telegram (và nhận updates)
                                  queues: telegram-import, telegram-sync, media-download
                                  + scheduler tải và sync, reconciler, thumbnail và tên topic từ Telegram
                                                     │
                            Nơi lưu (chọn theo từng channel): thư mục trên máy | Google Drive
```

- **PostgreSQL là nguồn sự thật duy nhất.** BullMQ chỉ vận chuyển job. Mọi chuyển trạng thái đều là compare-and-set; unique constraint bảo đảm không bao giờ có message hoặc media trùng (idempotency).
- **Chỉ worker giữ kết nối Telegram**, vì hai process dùng chung một auth key sẽ gặp `AUTH_KEY_DUPLICATED`. API không có `TELEGRAM_API_ID/HASH`.
  - Nếu lỡ chạy hai worker, chỉ worker giữ Redis lease `tam:tg:owner` mới kết nối Telegram; worker kia ở trạng thái `STANDBY` và tự thay thế khi worker đầu dừng.
  - Thao tác Telegram từ web (các bước đăng nhập, làm mới danh sách chat) đi qua **RPC trên Redis pub/sub**: API publish yêu cầu vào `<BULLMQ_PREFIX>:tg:rpc:request` và chờ trả lời trên `<BULLMQ_PREFIX>:tg:rpc:reply:<id>`, tối đa `TELEGRAM_RPC_TIMEOUT_MS`.
    - Pub/sub không ghi vào AOF, nên mã đăng nhập và mật khẩu 2FA không bao giờ nằm lại trong Redis.
    - Nếu không worker nào nhận yêu cầu, API trả `503` ngay.
    - Kênh pub/sub có prefix vì Redis không tách pub/sub theo số database. Nhờ vậy test chạy song song với dev stack, hay nhiều môi trường dùng chung một Redis, không trả lời nhầm yêu cầu của nhau.
- **Import job:** API ghi job vào bảng `import_jobs` trước, rồi mới đẩy một *run* (`ij-<job id>-<số run>`) vào queue `telegram-import`.
  - Nếu Redis không nhận kịp (quá 3 giây), request vẫn thành công. Reconciler của worker (chạy khi khởi động và mỗi phút) thêm lại run cho mọi job `PENDING`/`RUNNING` bị thiếu trong queue, và ghi nhận `FAILED` cho run mà BullMQ đã bỏ cuộc.
  - Worker đọc lại trạng thái job trước mỗi trang và ghi mỗi trang bằng compare-and-set theo `status` + số run. Nhờ vậy Pause, Cancel hay một run mới hơn luôn thắng một run cũ, kể cả khi hai bên chạy cùng lúc.
- **Tải media:** scheduler trong worker lấy file đang chờ từ `download_jobs` (file được yêu cầu trước, rồi file nhỏ trước) và mỗi lần chỉ đưa vào queue `media-download` số file được phép tải cùng lúc, nên Redis luôn nhỏ dù archive lớn tới đâu. Lượt thử, lỗi và thời điểm thử lại đều nằm trong PostgreSQL; mỗi job BullMQ chỉ là một lượt thử.
- **Binary media không bao giờ nằm trong PostgreSQL.** File nằm ở nơi lưu mà channel đã chọn, theo cấu trúc dễ đọc: `<Tên channel (chat id)>/<YYYY-MM>/<message id> - <tên file gốc>`.
- **Tìm kiếm** dùng full-text search của PostgreSQL trên cột `search_vector` (chữ, caption và tên file; trigger tự cập nhật). Phần này nằm sau lớp `SearchProvider` của API, nên sau này có thể thay bằng OpenSearch mà không phải sửa phần còn lại.
- **Cập nhật realtime** đi từ chính PostgreSQL:
  - Trigger trên `import_jobs`, `channels` và `download_jobs` gọi `pg_notify` với một payload ngắn: `job:<id>`, `channel:<id>` hoặc `downloads:<channel id>`.
  - Vì vậy chỉ thay đổi đã commit mới được báo; một trang bị rollback khi Pause thì không. Mọi nơi ghi (API, worker, SQL thô) đều tự phát, không cần nhớ publish.
  - Mỗi process API giữ một kết nối `LISTEN` riêng, gom thay đổi trong 250 ms, rồi gửi xuống trình duyệt qua `GET /api/events` (server-sent events):
    - job gửi nguyên `ImportJobDto`;
    - channel và download gửi gợi ý để trang tự đọc lại.
  - Mất kết nối `LISTEN` thì API tự nối lại, rồi báo `resync` để các trang đọc lại dữ liệu.
- **Sync** là một import job loại `SYNC`, chỉ đọc message mới hơn message mới nhất đã lưu, chạy trong queue riêng `telegram-sync` để không phải chờ sau một import dài. Chỉ `SyncScheduler` của worker tạo sync tự động (mục §10).
- **Production** (§11) có hai cách:
  - Trên Windows: pm2 chạy `tam-api` và `tam-worker`, và API phục vụ luôn bản build của web (`WEB_DIST_DIR`) trên một cổng.
  - Trên Linux: Docker Compose, với nginx phục vụ web và chuyển `/api/` sang API.

Cấu trúc monorepo (npm workspaces, ESM, TypeScript 6.0.3):

```
apps/web           Angular 22 (standalone, zoneless, signals, Material 3)
apps/api           NestJS 12 REST + SSE (/api/events), phục vụ web ở production; CLI create-user, reset-password
apps/worker        NestJS 12 standalone + BullMQ
apps/e2e           Test trình duyệt (Playwright) trên bản build thật
packages/shared    Contract dùng chung: enums, zod schemas, DTO, tên queue, event
packages/crypto    SecretBox (AES-256-GCM) cho bí mật lưu trong DB: session Telegram, token Google
packages/database  Prisma schema + migrations + generated client
packages/telegram  Interface TelegramClient, adapter mtcute, mapper message/media, session PostgreSQL mã hoá
packages/storage   StorageDriver: thư mục trên máy, Google Drive (OAuth device flow, upload resumable)
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
| pm2 | 7 (đã kiểm thử 7.0.4) | Production không dùng Docker (máy Windows này): `npm install -g pm2` |
| Google Chrome | mới | Chỉ cho test trình duyệt (`npm run test:e2e`); CI dùng Chromium của Playwright |
| Tài khoản Telegram + `api_id`/`api_hash` | — | Cần từ Phase 2 |

Dung lượng đĩa: `node_modules` khoảng 0.6–1 GB. Media tải về có thể rất lớn, nên cho channel lưu vào thư mục ở ổ còn nhiều chỗ (`STORAGE_LOCAL_ROOTS`) hoặc vào Google Drive (mục 9).

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
| `CSRF_TRUSTED_ORIGINS` | api | (rỗng) | Danh sách origin cách nhau bằng dấu phẩy, dạng `scheme://host[:port]`, **không có path**. Tên host của chúng cũng là tên API trả lời (xem dòng dưới) |
| `ALLOWED_HOSTS` | api | (rỗng) | Thêm tên host API trả lời, cách nhau bằng dấu phẩy (vd. `archive.lan,*.example.com`). IP và `localhost` luôn được; Host header khác nhận `421 HOST_NOT_ALLOWED` (chống DNS rebinding) |
| `TRUST_PROXY` | api | `loopback` | Giá trị "trust proxy" của Express: `true`/`false`, số hop, hoặc danh sách `loopback`, `linklocal`, `uniquelocal`, IP/CIDR. Không có proxy (pm2): `false`. Sau nginx trong Docker: `1` |
| `WEB_DIST_DIR` | api | — | Thư mục build của web (`apps/web/dist/web/browser`, đường dẫn tuyệt đối). Có giá trị thì API phục vụ luôn giao diện web (production với pm2, `ecosystem.config.cjs` tự đặt). Để trống khi dev và trong Docker |
| `TELEGRAM_RPC_TIMEOUT_MS` | api | `30000` | Thời gian API chờ worker trả lời một thao tác Telegram (500–120000), quá hạn thì trả `504 TELEGRAM_TIMEOUT` |
| `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` | **chỉ worker** | — | Từ my.telegram.org. Phải đặt cả hai cùng lúc; hash là 32 ký tự hex |
| `TELEGRAM_SESSION_DATABASE_URL` | worker | — | DB riêng cho session Telegram (`…/tam_tg`) |
| `TELEGRAM_SESSION_KEY` | worker | — | 32 byte base64, dùng mã hoá auth key và trạng thái đăng nhập |
| `WORKER_HEARTBEAT_INTERVAL_MS` | worker | `5000` | Chu kỳ heartbeat (1000–60000); key có TTL = 3 × chu kỳ |
| `WORKER_ALIVE_FILE` | worker | — | File được chạm sau mỗi heartbeat, cho healthcheck của container (image Docker tự đặt) |
| `IMPORT_PAGE_DELAY_MS` | worker | `1000` | Nghỉ giữa hai trang lịch sử (100 message) khi import (0–60000), để tránh giới hạn tần suất của Telegram. Channel 10.000 message mất khoảng 2–3 phút |
| `STORAGE_LOCAL_ROOT` | api, worker | — | Thư mục của nơi lưu có sẵn "This computer". **Dùng đường dẫn tuyệt đối**, vì api và worker chạy ở thư mục khác nhau |
| `STORAGE_LOCAL_ROOTS` | api | = `STORAGE_LOCAL_ROOT` | Các thư mục, ngăn cách bằng `;`, mà web được phép thêm làm nơi lưu (và thư mục con bên trong). Web không bao giờ ghi được ra ngoài các thư mục này |
| `STORAGE_SECRET_KEY` | api, worker | — | 32 byte base64, dùng mã hoá token Google Drive lưu trong DB. Cần khi dùng Google Drive; api và worker phải dùng **cùng một key** |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | api, worker | — | OAuth client loại "TVs and Limited Input devices" để kết nối Google Drive (mục 9). Phải đặt cả hai cùng lúc; worker cần để upload |
| `MIN_FREE_DISK_MB` | api, worker | `2048` | Tải vào thư mục trên máy luôn giữ trống ít nhất chừng này; thiếu chỗ thì việc tải chờ (không báo lỗi). Api chỉ hiển thị giá trị này |
| `DOWNLOAD_STAGING_DIR` | worker | `<STORAGE_LOCAL_ROOT>/.tam-tmp` | Nơi file chờ trước khi upload lên Google Drive; cần chỗ cho file lớn nhất (1–4 GB) |
| `THUMBNAIL_DIR` | api, worker | `<STORAGE_LOCAL_ROOT>/.tam-thumbnails` | Ảnh xem trước nhỏ lấy từ Telegram (vài chục KB mỗi file). Api và worker phải cùng một thư mục |
| `S3_*` | — | — | Dự kiến cho storage S3-compatible, chưa dùng |
| `POSTGRES_PASSWORD` | docker compose | — | Mật khẩu của role `tam` (không phải superuser) mà api, worker và migration dùng. Nên dùng chuỗi **hex** (`openssl rand -hex 24`), vì nó nằm trong URL |
| `POSTGRES_SUPERUSER_PASSWORD` | docker compose | — | Mật khẩu superuser `postgres`, chỉ dùng khi tạo volume lần đầu |
| `REDIS_PASSWORD` | docker compose | — | Chuỗi hex như trên |
| `WEB_ORIGINS` | docker compose | `http://localhost:8080` | Các địa chỉ bạn mở archive, cách nhau bằng dấu phẩy (vd. `http://192.168.1.20:8080,http://nas.lan:8080`). Thành `CSRF_TRUSTED_ORIGINS` của api trong Docker |
| `WEB_PORT` | docker compose | `8080` | Cổng host của container web (nginx) |

Khi `NODE_ENV=production`, api và worker **không chịu khởi động** nếu một URL hay secret vẫn còn giá trị mẫu `CHANGE_ME` của `.env.example` (thông báo ghi tên biến, không in giá trị).

Tạo `TELEGRAM_SESSION_KEY` và `STORAGE_SECRET_KEY` (mỗi biến một key riêng, chạy lệnh hai lần):

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## 4. Telegram API credentials

1. Đăng nhập <https://my.telegram.org> bằng số điện thoại của bạn, chọn **API development tools**.
2. Tạo ứng dụng mới. Tên ứng dụng **phải có "Unofficial" đứng trước "Telegram"**, hoặc không chứa chữ "Telegram". Platform chọn *Web* hoặc *Other*.
3. Chép `api_id` và `api_hash` vào `.env` (`TELEGRAM_API_ID`, `TELEGRAM_API_HASH`). **Chỉ worker** nhận hai biến này.
4. Đặt `TELEGRAM_SESSION_KEY` (xem mục 3) và `TELEGRAM_SESSION_DATABASE_URL`, trỏ tới DB `tam_tg`.
5. Khởi động lại worker. Trang **Settings → Telegram account** phải hết báo "Telegram is not set up on the worker" và hiện ô nhập số điện thoại. Sau đó đăng nhập như mục 8.

Lưu ý:
- Thiếu một trong các biến trên thì worker vẫn chạy bình thường nhưng báo trạng thái Telegram `UNCONFIGURED` kèm tên biến còn thiếu. Web hiển thị đúng thông báo đó.
- Không chia sẻ `api_hash`, `.env` hay database `tam_tg`.
- Không dùng session của production trên máy dev. Hai nơi dùng cùng một auth key sẽ làm Telegram huỷ session.
- Đổi `TELEGRAM_SESSION_KEY` thì session cũ không giải mã được nữa: worker coi như chưa đăng nhập và bạn đăng nhập lại.

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

`docker-compose.yml` dành cho **Linux host** trong mạng LAN (HTTP thường). Windows Server 2019 không chạy được Linux containers; máy này chạy production bằng pm2 (§11).

| Service | Vai trò |
|---|---|
| `postgres` | PostgreSQL 18.6 (volume `pgdata`). Superuser `postgres` chỉ dùng lúc tạo volume: script `docker/postgres/init/10-create-databases.sh` tạo role **`tam` (không phải superuser)** làm chủ hai DB `tam` và `tam_tg` |
| `redis` | Redis 7.4.11, có mật khẩu, AOF, `noeviction` (volume `redisdata`), chạy bằng user `redis` |
| `migrate` | One-shot `prisma migrate deploy`, chạy bằng role `tam` (chủ DB đủ quyền tạo bảng, trigger và extension `pg_trgm`/`unaccent`) |
| `api` | NestJS API (cổng nội bộ 3100, healthcheck `/api/health/live`); volume `media` để kiểm tra và phục vụ nơi lưu |
| `worker` | BullMQ worker. **Đúng 1 replica**; `stop_grace_period: 60s`; volume `media`; healthcheck đọc tuổi của file heartbeat (`WORKER_ALIVE_FILE`) |
| `web` | nginx (image `nginx-unprivileged`, cổng 8080 trong container) phục vụ Angular và proxy `/api/`, cổng host `${WEB_PORT:-8080}` |

```bash
cp .env.example .env
# Điền phần "Docker Compose only": POSTGRES_PASSWORD, POSTGRES_SUPERUSER_PASSWORD, REDIS_PASSWORD
# (hex), WEB_ORIGINS (địa chỉ bạn mở archive), cùng TELEGRAM_* (mục 4)
docker compose up -d --build
docker compose ps          # migrate: Exited (0); api, worker, web: healthy
# Tạo tài khoản web đầu tiên (hỏi mật khẩu 2 lần, không hiện ra màn hình):
docker compose exec api node apps/api/dist/cli/create-user.js --email you@example.com
# Mở http://<địa chỉ máy>:8080
```

**Cứng hoá:**
- Mỗi service chỉ nhận đúng các biến nó cần: secret Telegram chỉ vào `worker`, mật khẩu superuser chỉ vào `postgres`, credential DB không vào `web`. Không mật khẩu nào nằm trên dòng lệnh; tài khoản web tạo bằng CLI nên không có mật khẩu admin trong `docker inspect`.
- `api`, `worker`, `web` và `redis`: user không phải root, `cap_drop: ALL`, `no-new-privileges`, filesystem gốc chỉ đọc (ghi được `/tmp` và volume). `postgres` giữ quyền cần để tạo cluster, cùng `no-new-privileges`.
- Log mỗi container tối đa 5 file × 10 MB.
- nginx ghi **đè** `X-Forwarded-For` bằng địa chỉ thật của client và API tin đúng một proxy (`TRUST_PROXY=1`), nên không ai né được giới hạn đăng nhập bằng header giả.
- nginx tìm lại địa chỉ `api` khi container được tạo lại (`resolve`), giữ kết nối keep-alive tới API, và không cần IPv6 trên host.
- API chỉ trả lời IP, `localhost` và các tên có trong `WEB_ORIGINS`/`ALLOWED_HOSTS` (`421` cho tên khác).
- File build có hash trong tên được cache một năm (`immutable`); `index.html` và file không hash luôn được kiểm tra lại, nên bản mới hiện ngay sau khi deploy.
- SPA có CSP `script-src 'self'` và chỉ tải từ chính nó (font nằm trong bản build): script khởi tạo theme là file riêng (`theme-init.js`) và build đã tắt inline critical CSS. Không có `upgrade-insecure-requests` vì setup LAN là HTTP.

**Smoke test toàn stack** (build → chạy với secret tạm → tạo user bằng CLI → health, header, cache, Host lạ, `X-Forwarded-For` giả, SSE, restart api, healthcheck worker, không service nào chạy bằng root, role `tam` không phải superuser → gỡ sạch, kể cả volume):

```bash
bash scripts/compose-smoke.sh              # cổng 18080; đổi bằng SMOKE_WEB_PORT=9090
```

CI (`.github/workflows/ci.yml`) chạy smoke test này mỗi lần push, vì máy dev không chạy được Docker.

- Nơi lưu "This computer" trong Docker là volume `media` (`/data/storage`). Muốn cho phép thêm thư mục khác (ổ NAS, ổ phụ), mount thư mục đó vào **cả** `api` và `worker` (ví dụ `/mnt/nas:/data/nas`), rồi đặt `STORAGE_LOCAL_ROOTS: /data/storage;/data/nas` cho `api` trong `docker-compose.yml`.
- `nginx` gửi `Host $http_host` (giữ cả port), vì API kiểm tra tên host và CSRF fallback so sánh `Origin` với `Host`.
- Cài đặt, cập nhật, HTTPS phía trước và sao lưu: xem §11.

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
node apps/api/dist/cli/create-user.js --email admin@example.com   # hỏi mật khẩu 2 lần, không hiện ra
npm run dev                          # build packages → tsc watch + api :3100 + worker + web :4300
```

- Mở <http://localhost:4300>. Angular dev server proxy `/api/` sang `http://127.0.0.1:3100`, nên cookie phiên là same-origin.
- **Không chạy dev khi production đang chạy trên cùng máy** (§11): hai worker không bao giờ được chạy cùng lúc. Dừng production trước (`npm run prod:stop`, và `npm run prod:disable` để watchdog không bật lại khi máy khởi động lại), chạy lại sau bằng `npm run prod:start` / `prod:enable`.
- CLI tạo user (`create-user`) và đặt lại mật khẩu (`reset-password`, §11):
  - mật khẩu **không bao giờ nằm trên dòng lệnh**: lệnh hỏi 2 lần trong terminal mà không hiện chữ (Ctrl+C để huỷ), hoặc đọc từ stdin với `--password-stdin` (script, Docker);
  - email phải có tên miền đầy đủ (ví dụ `admin@example.com`; `admin@local` bị từ chối); mật khẩu tối thiểu 12 ký tự;
  - `create-user --if-missing` bỏ qua nếu email đã tồn tại;
  - exit code: 0 thành công, 1 lỗi (ví dụ email đã có, huỷ bằng Ctrl+C), 2 sai cú pháp.
  - Với `--password-stdin` trong **PowerShell**, pipe thẳng vào `node apps/api/dist/cli/create-user.js`: khi pipe vào `npm`, dấu `--` bị nuốt. PowerShell 5.1 có thể làm hỏng ký tự không phải ASCII khi pipe, nên khi đó dùng mật khẩu ASCII.
- Health: `curl http://127.0.0.1:3100/api/health/ready` trả trạng thái database, redis và worker (`alive`/`missing`).

### Kiểm tra chất lượng

| Lệnh | Nội dung |
|---|---|
| `npm run typecheck` | Build packages rồi typecheck mọi workspace (web dùng `ngc`, kiểm tra cả template) |
| `npm run lint` | ESLint 10 cho toàn repo (web dùng `apps/web/eslint.config.js`) |
| `npm test` | Unit test (Vitest) của mọi workspace, gồm component/service/routing test của Angular |
| `npm run test:integration` | Integration/e2e với PostgreSQL và Redis thật |
| `npm run test:e2e` | Test trình duyệt (Playwright, Chrome đã cài trên máy) trên **bản build**: cần `npm run build` trước, hoặc dùng `npm run test:e2e:full` |
| `npm run test:coverage` | Unit + integration của mọi workspace kèm line coverage, in một bảng; dưới mức tối thiểu của workspace thì lỗi. Cần PostgreSQL và Redis |
| `npm run build` | Build production toàn bộ |
| `npm run db:check` | Không có drift giữa migrations và schema |
| `npm audit --omit=dev` | Lỗ hổng trong dependency chạy thật (hiện 0) |

- Integration test **không bao giờ đụng dữ liệu dev**. Chúng tự xoá và tạo lại các DB tạm `tam_test_db`, `tam_test_api`, `tam_test_worker`, và dùng Redis db 14/15 với prefix riêng. Chạy riêng một workspace: `npm run test -w @tam/api`, `npm run test:integration -w @tam/worker`, …
- **Test trình duyệt** (`apps/e2e`): tạo lại DB `tam_test_e2e` với một archive nhỏ (forum 2 topic, ảnh PNG và PDF thật trong thư mục tạm, tag, favorite, một import đang chạy), rồi chạy API đã build trên cổng 3190, phục vụ luôn web đã build như production. Không có worker, không gì đi tới Telegram. Các test: đăng nhập sai rồi đúng và đăng xuất; duyệt channel → topic → ảnh (kể cả tải lại trang); PDF trong trang; tìm theo tên file (có tô sáng) và không dấu; favorite và tag; trang job cập nhật live khi DB đổi mà không polling; đổi mật khẩu thì trình duyệt kia bị đưa về trang đăng nhập; header bảo mật, font tự host, không request nào ra khỏi archive; Host lạ bị `421`. `PW_CHANNEL=bundled` dùng Chromium của Playwright thay cho Chrome.
- **Coverage (dòng code)** lúc kết thúc Phase 8, unit và integration gộp lại:

  | Workspace | Hiện tại | Tối thiểu |
  |---|---:|---:|
  | `apps/api` | 90,4 % | 87 % |
  | `apps/worker` | 87,0 % | 84 % |
  | `apps/web` | 92,1 % | 89 % |
  | `packages/shared` / `crypto` | 98,8 % / 100 % | 95 % / 97 % |
  | `packages/storage` / `telegram` | 88,7 % / 84,9 % | 85 % / 81 % |
  | `packages/database` | 55,3 % | 52 % |

  `packages/database` thấp vì phần lớn là công cụ cho dev và test (`db:recreate`, tạo DB test); schema, trigger và change feed đều có integration test.
- **CI** (`.github/workflows/ci.yml`, chạy khi repo được push lên GitHub): typecheck, lint, unit test; integration + coverage với PostgreSQL 18 và Redis 7.4; test trình duyệt; smoke test Docker Compose. Không cần secret nào.
- **Đo hiệu năng** (§11): `node scripts/perf/seed.mjs` tạo DB `tam_perf` (150 000 message, khoảng 200 MB), `node scripts/perf/measure.mjs` in bảng thời gian (API cần build trước), `node scripts/perf/seed.mjs --drop` xoá DB.

## 8. Telegram authentication

Cần làm xong mục 4 và worker đang chạy. Đăng nhập ở **Import Jobs → New import** (bước 1) hoặc **Settings → Telegram account**:

1. Nhập số điện thoại của tài khoản Telegram theo định dạng quốc tế (`+84 912 345 678`) rồi bấm **Send code**.
2. Telegram gửi mã, thường là vào app Telegram trên thiết bị đang đăng nhập (tin nhắn từ "Telegram"), đôi khi qua SMS hoặc cuộc gọi. Trang cho biết mã được gửi bằng cách nào.
   - Nút gửi lại (ví dụ **Send the code by SMS**) chỉ bấm được sau thời gian chờ Telegram yêu cầu, và chỉ hiện khi Telegram còn cách gửi khác.
   - **Use another number** huỷ lần đăng nhập đang dở.
3. Nhập mã và bấm **Sign in**. Nếu tài khoản bật xác minh 2 bước, nhập tiếp mật khẩu 2FA.
4. Khi thành công, trang hiện tài khoản đã kết nối. Worker tự đọc danh sách channel/group ngay sau đó (bước 2 của wizard).

Trạng thái đăng nhập:
- Trạng thái `LOGGED_OUT → CODE_SENT → PASSWORD_REQUIRED → READY` nằm trong bảng `telegram_accounts`. Số điện thoại và `phone_code_hash` được mã hoá bằng `TELEGRAM_SESSION_KEY`, và API chỉ trả về số đã che (`+84•••••••78`). Vì vậy restart worker không làm mất trạng thái.
- Lần đăng nhập đang dở tự hết hạn sau 15 phút.
- Auth key của Telegram nằm trong DB `tam_tg`, cũng được mã hoá AES-256-GCM.
- Mã đăng nhập và mật khẩu 2FA đi từ API tới worker qua Redis pub/sub và không được lưu ở đâu.
- **Log out of Telegram** (có hỏi xác nhận) huỷ session ở phía Telegram và xoá danh sách chat đã cache. Nếu phiên bị thu hồi từ điện thoại (Settings → Devices), worker phát hiện khi khởi động hoặc ở lần đọc danh sách chat kế tiếp, đưa trạng thái về `LOGGED_OUT` và web ghi rõ lý do.

API (đều cần đăng nhập web):

| Endpoint | Ý nghĩa |
|---|---|
| `GET /api/telegram/status` | Worker `online`/`offline`, kết nối Telegram (`UNCONFIGURED`, `STANDBY`, `CONNECTING`, `CONNECTED`, `ERROR`), trạng thái đăng nhập, tài khoản |
| `POST /api/telegram/authenticate` | Một bước: `{step:'phone',phoneNumber}`, `{step:'code',code}`, `{step:'password',password}`, `{step:'resend'}`. Giới hạn 10 lần/phút mỗi IP |
| `POST /api/telegram/logout` | Đăng xuất, hoặc huỷ lần đăng nhập đang dở |
| `GET /api/telegram/chats` | Danh sách channel/group đã cache, kèm `refreshing` và `refreshedAt` |
| `POST /api/telegram/chats/refresh` | Yêu cầu worker đọc lại danh sách từ Telegram (`202`, chạy nền) |

Lỗi có mã ổn định trong `code`:
- `409` khi trạng thái không cho phép: `INVALID_LOGIN_STATE`, `TELEGRAM_NOT_READY`, `SESSION_REVOKED`.
- `422` khi Telegram từ chối: `PHONE_NUMBER_INVALID`, `PHONE_CODE_INVALID`, `PHONE_CODE_EXPIRED`, `PASSWORD_INVALID`, `SIGN_UP_REQUIRED`, …
- `429 FLOOD_WAIT`, kèm `details.retryAfterSeconds`.
- `503 WORKER_UNAVAILABLE` / `TELEGRAM_UNAVAILABLE`; `504 TELEGRAM_TIMEOUT`.

## 9. Import channel

Wizard **Import Jobs → New import** gồm 7 bước:
1. **Connect Telegram** (mục 8). Nếu đã đăng nhập, wizard tự chuyển sang bước 2.
2. **Channels & groups:** danh sách channel, supergroup và group mà tài khoản đã tham gia, có ô tìm kiếm (không phân biệt dấu: "hoc" tìm ra "Học") và bộ lọc loại chat.
   - Danh sách được worker cache trong bảng `telegram_dialogs`: tự đọc sau khi đăng nhập, khi worker khởi động nếu cache cũ hơn 6 giờ, và khi bấm **Refresh**. Trong lúc worker đọc, trang tự cập nhật.
   - Chat có content protection hiện nhãn **Protected** và không chọn được. Chat đã có trong archive hiện nhãn **In archive**.
3. **Select channel:** bấm **Add to archive** để tạo channel trong archive (`POST /api/channels` với `{telegramChatId}`).
   - Server chỉ nhận chat có trong danh sách cache và lấy mọi thông tin (tên, access hash, cờ protected) từ đó, không tin dữ liệu từ trình duyệt.
   - Chat không còn trong danh sách trả `404 DIALOG_NOT_FOUND`; chat protected trả `422 CHAT_PROTECTED`.
   - Thao tác idempotent: `201` khi tạo mới, `200` khi chat đã có. Gửi trùng hay gửi đồng thời cũng chỉ tạo đúng một channel.
4. **Storage location:** chọn nơi lưu media của channel (xem "Nơi lưu" bên dưới), rồi bấm **Save location** (`PATCH /api/channels/:id` với `{storageLocationId}`).
   - Nơi lưu mặc định được chọn sẵn.
   - Thêm nơi lưu mới ngay tại đây: **Folder on this computer** hoặc **Google Drive**.
5. **Import mode:**
   - **The whole history:** mọi message, về tới message đầu tiên.
   - **Since a date:** chỉ message gửi từ ngày được chọn trở đi (tính theo múi giờ của trình duyệt). Phần cũ hơn có thể import sau.
6. **Start:** xem lại channel, chế độ và nơi lưu, rồi bấm **Start import** (`POST /api/channels/:id/import`). Trước đó có thể bật/tắt:
   - **Download media automatically** (mục "Tải media" bên dưới);
   - **Keep it up to date** (sync, §10). Cả hai đều bật sẵn.
7. **Progress** cập nhật realtime (server-sent events) và hiện:
   - trạng thái, thanh tiến trình, message đã đọc trên tổng dự kiến;
   - media tìm thấy, **phần trăm đã tải** (không tính file bị bỏ qua), số lỗi, và **file đang tải** cùng tiến độ của nó;
   - lý do đang chờ (nếu có);
   - các nút **Pause**, **Resume**, **Cancel import**.

Có thể import lại bất cứ lúc nào từ mục **Import** trên trang channel. Lần import sau chỉ đọc message mới đăng và phần lịch sử cũ còn thiếu.

### Import hoạt động thế nào

- **Khoảng đã import:** mỗi channel giữ một khoảng liên tục `[backfill_cursor_id … head_message_id]`. Mọi message trong khoảng này đã được đọc (và lưu, trừ loại không bao giờ lưu). Mỗi lần chạy có hai bước:
  1. **Forward:** đọc message mới hơn `head` từ cũ đến mới, và nâng `head` lên sau mỗi trang.
  2. **Backfill:** đọc lịch sử cũ hơn `cursor` từ mới đến cũ. Chế độ *all* dừng khi hết lịch sử (`backfill_complete`). Chế độ *since a date* dừng ở message đầu tiên cũ hơn ngày đã chọn và để lịch sử "chưa đủ", nên lần import toàn bộ sau sẽ đi tiếp từ đó.
- **Mỗi trang (tối đa 100 message) là một transaction** gồm: tiến độ job, khoảng của channel, message, media, và một download job cho mỗi file.
  - Trang đầu tiên kiểm tra rằng run vẫn đang giữ job và khoảng của channel không đổi. Pause, cancel, hay một run khác chen vào đều làm cả trang rollback.
  - Nhờ vậy crash, restart hay mất mạng giữa chừng đều tiếp tục đúng chỗ. Unique key `(channel, message id)` và `(message, file)` bảo đảm **không bao giờ có bản trùng**.
  - Đã kiểm chứng bằng cách tắt cứng worker giữa lúc import 3.715 message: sau khi khởi động lại, job chạy tiếp và kết thúc với đúng 3.715 message, không trùng dòng nào.
- **Không bao giờ lưu:** message có content protection, message có hẹn giờ tự xoá, và media tự huỷ (view-once/TTL).
  - Message loại này vẫn được tính là "đã đọc", để tiến trình đạt 100%.
  - Nếu chat bật content protection sau khi đã thêm vào archive, job dừng với trạng thái `FAILED` và sync của chat bị tắt, kèm lý do trên trang channel.
- **Giữ nguyên bản gốc:** message đã lưu không bao giờ bị ghi đè. Đọc lại một message đã có (import lại, sync) không áp dụng nội dung đã sửa trên Telegram; message bị xoá trên Telegram vẫn nằm trong archive.
- **Supergroup nâng cấp từ group thường:** lịch sử trước khi nâng cấp nằm trong group cũ, với dãy id riêng. Import của supergroup đọc luôn group cũ vào một channel riêng, có `migratedToChannelId` trỏ về supergroup. Group cũ mà tài khoản chưa từng tham gia, hoặc có content protection, thì bỏ qua.
- **Tổng dự kiến:**
  - Chế độ *all* dùng số message Telegram báo, trừ đi phần archive đã có.
  - Chế độ *since a date* ước tính theo khoảng cách id message. Ước tính này hơi cao, vì message đã xoá vẫn chiếm id.
  - Khi job hoàn tất, tổng được thay bằng con số chính xác.
- **Chờ mà không tốn lượt thử:** khi Telegram yêu cầu chờ (`FLOOD_WAIT`), worker chưa kết nối được Telegram, hoặc tài khoản Telegram bị đăng xuất, job được hẹn chạy lại. Lý do chờ hiện trên trang job. Lỗi khác được thử lại 5 lần (30 giây, 1, 2, 4 phút); sau lần cuối, job chuyển `FAILED` kèm lý do.
- **Chỉ một job chưa kết thúc cho mỗi channel** (partial unique index):
  - Gửi lại đúng yêu cầu import trả về chính job đó (`200`).
  - Yêu cầu khác trả `409 IMPORT_ACTIVE`, kèm `details.jobId`.
- **Trạng thái:**
  - `PENDING` (Queued) → `RUNNING` (Importing) → `COMPLETED`, hoặc `FAILED`.
  - **Pause:** `PENDING`/`RUNNING` → `PAUSED`. Worker dừng ở trang kế tiếp, mọi thứ đã đọc được giữ lại.
  - **Resume:** `PAUSED` → `PENDING`, với số run mới.
  - **Cancel:** mọi trạng thái chưa kết thúc → `CANCELLED`. Không resume được nữa; muốn tiếp tục thì tạo import mới, và nó đi tiếp từ chỗ archive đã có.
- **Media:** file được ghi nhận cùng message (loại, tên, kích thước, kích thước ảnh/video, thời lượng), mỗi file một download job. File nằm ngoài cài đặt tải tự động được ghi nhận là *Skipped (settings)*. Việc tải chạy riêng, sau import (mục "Tải media" bên dưới), nên import kết thúc ngay khi đọc xong lịch sử và có thể import lại trong lúc file vẫn đang tải.

### Tải media

Media của mỗi channel được tải về nơi lưu của channel đó, độc lập với import: import kết thúc khi đọc xong lịch sử, còn file tải dần sau đó.

- **Ba lớp điều khiển:**
  - **Công tắc của channel:** **Download media automatically** trong mục **Media downloads** trên trang channel, hoặc ở bước Start của wizard. Channel mới được bật sẵn. **Các channel có từ trước Phase 4 bắt đầu ở trạng thái tắt**, để việc nâng cấp không tự tải cả archive.
  - **Settings → Media downloads:**
    - **Pause all downloads** dừng mọi việc tải ngay lập tức. File đang tải dở được giữ lại, bỏ pause là tải tiếp.
    - Chọn loại media tự tải, cỡ file lớn nhất được tự tải (để trống là không giới hạn), và số file tải cùng lúc (1–4, mặc định 2).
    - Đổi loại hoặc cỡ có hiệu lực ngay với file đang chờ: file không còn khớp chuyển sang *Skipped (settings)*, file khớp lại thì trở về hàng đợi.
  - **Tải theo yêu cầu:** `POST /api/media/:id/download` tải một file ngay, bất kể công tắc và Settings. File được yêu cầu luôn đi trước.
- **Thứ tự:** file được yêu cầu trước, sau đó **file nhỏ trước**. Với channel nhiều video, tài liệu và video ngắn xong trước, video dài xong sau.
- **Resume:** file tải vào `<nơi lưu>/.tam-tmp/<media id>.part`. Đây là thư mục ẩn trên cùng ổ, nên lưu xong chỉ là đổi tên, không tốn thêm chỗ.
  - Worker dừng hay crash giữa chừng thì lần sau tải tiếp từ MiB cuối cùng đã có.
  - Tải xong, file được kiểm tra kích thước và tính SHA-256 rồi mới lưu vào đường dẫn dễ đọc.
  - Đã kiểm chứng với group thật: tắt cứng worker khi video 91 MiB tải được 49%; sau khi khởi động lại, file tải tiếp từ 51 MiB và SHA-256 trong DB khớp với file trên đĩa. Pause giữa chừng rồi bỏ pause cũng tải tiếp từ phần đã có. Tốc độ đo được khoảng 8–10 MB/s.
- **Chờ mà không tốn lượt thử:** khi Telegram yêu cầu chờ (`FLOOD_WAIT`), khi worker mất kết nối Telegram hoặc tài khoản bị đăng xuất, và khi nơi lưu hết chỗ hoặc bị giới hạn. Lỗi khác được thử lại tối đa 8 lần, thời gian chờ tăng dần từ 30 giây tới 1 giờ. Sau lần cuối file chuyển *Failed*, và trang channel có nút **Retry failed**.
- **Chỗ trống:**
  - Thư mục trên máy luôn giữ trống ít nhất `MIN_FREE_DISK_MB`. Không đủ chỗ cho file tiếp theo thì nơi lưu tạm ngưng 10 phút rồi thử lại; lý do hiện trên trang channel và ở Settings, và không file nào bị đánh dấu lỗi. Trang channel cũng báo trước khi nơi lưu không đủ chỗ cho phần còn lại.
  - Với Google Drive, quota được kiểm tra trước mỗi file. File chờ trong `DOWNLOAD_STAGING_DIR` trước khi upload, nên thư mục này cần chỗ cho file lớn nhất.
  - Google Drive chỉ cho upload khoảng **750 GB mỗi ngày**. Khi bị giới hạn, nơi lưu tạm ngưng 15 phút, rồi 1 giờ, 3 giờ, 6 giờ, và tải tiếp khi Google cho phép.
- **File trùng:** cùng một file Telegram ở hai message chỉ tải một lần; lần sau được sao chép (hardlink trên ổ đĩa, bản sao trên Drive).
- **Bị xoá hoặc bị khoá:** message bị xoá hoặc bị đổi file trên Telegram thì file chuyển *Skipped*. Chat bật content protection thì mọi file còn chờ của chat bị bỏ qua và công tắc tắt.
- **Thumbnail:** worker lấy ảnh xem trước nhỏ (320 px) của mọi file từ Telegram, kể cả file chưa tải, và lưu trong `THUMBNAIL_DIR`. Nhờ vậy duyệt được cả channel trước khi tải hàng trăm GB.
- **Ước tính thời gian:** dung lượng còn lại ÷ tốc độ tải. Tài khoản Telegram không Premium bị Telegram giới hạn tốc độ tải, và các file tải cùng lúc dùng chung giới hạn đó. Khi đang tải, trang channel hiện tốc độ và thời gian còn lại. Ví dụ: 756 GiB ở 5 MB/s mất khoảng 2 ngày.

API tải media (đều cần đăng nhập web):

| Endpoint | Ý nghĩa |
|---|---|
| `GET /api/settings`, `PATCH /api/settings` | Cài đặt tải `{downloads: {paused, mediaTypes, maxFileSizeMb, concurrency}}` và sync `{sync: {intervalMinutes}}` (§10). PATCH chỉ đổi các trường gửi lên; cài đặt tải áp dụng ngay cho file đang chờ |
| `GET /api/channels/:id/downloads` | Số file và byte theo trạng thái, file đang tải, nơi lưu (chỗ trống, tạm ngưng tới khi nào), `fits` |
| `PATCH /api/channels/:id` | `{downloadMedia}` bật/tắt tải tự động (áp dụng cả group cũ của supergroup); `{storageLocationId}` đổi nơi lưu; `{syncEnabled}` bật/tắt sync (§10) |
| `POST /api/channels/:id/downloads/retry` | Đưa mọi file lỗi của channel trở lại hàng đợi |
| `GET /api/media/:id` | Thông tin một file (không có đường dẫn trên server) |
| `GET /api/media/:id/content` | Nội dung file đã tải, hỗ trợ `Range` (`206`/`416`) và `If-Range`. `ETag` là SHA-256 của file: trình duyệt hỏi lại mỗi lần (vẫn kiểm tra phiên) và nhận `304` không kèm nội dung; `HEAD` không đọc file. Chỉ ảnh, video/audio trình duyệt phát được và PDF được mở ngay; loại khác (kể cả mọi loại XML) luôn tải xuống, tên file bỏ ký tự đảo chiều chữ. `?download=1` để tải xuống. `409 MEDIA_NOT_DOWNLOADED` nếu chưa tải |
| `GET /api/media/:id/thumbnail` | Ảnh xem trước (`404` nếu không có), có `ETag`/`304` |
| `POST /api/media/:id/download` | Tải ngay: `202` khi vào hàng đợi, `200` nếu đã tải hoặc đang tải, `422 CHAT_PROTECTED` |
| `POST /api/media/:id/cancel` | Huỷ file đang chờ hoặc đang tải (`409 INVALID_DOWNLOAD_STATE`) |

API import (đều cần đăng nhập web):

| Endpoint | Ý nghĩa |
|---|---|
| `POST /api/channels/:id/import` | `{mode:'ALL'}` hoặc `{mode:'FROM_DATE', fromDate}` (ngày hoặc ISO date-time có offset, không ở tương lai). `202` kèm job mới; `200` nếu cùng import đang chạy. Lỗi: `409 IMPORT_ACTIVE`, `409 TELEGRAM_NOT_READY`, `422 CHAT_PROTECTED`, `422 CHANNEL_MIGRATED` (group cũ: import supergroup) |
| `POST /api/channels/:id/sync` | Đọc message mới hơn message mới nhất đã lưu (§10). `202` kèm sync mới; `200` nếu một sync đang chạy |
| `GET /api/import-jobs` | Mới nhất trước; lọc `channelId`, `status` (ví dụ `RUNNING,PAUSED`), `type` (`IMPORT` hoặc `SYNC`); phân trang `cursor`/`limit` |
| `GET /api/import-jobs/:id` | Một job, kèm channel, các bộ đếm, `origin` (vì sao job chạy) và `activeFiles` (file của job đang tải) |
| `POST /api/import-jobs/:id/pause` / `resume` / `cancel` | Đổi trạng thái; `409 INVALID_JOB_STATE` nếu trạng thái hiện tại không cho phép (`details.status`). Sync không pause được |
| `GET /api/events` | Cập nhật realtime (server-sent events). Mở đầu bằng `ready`, sau đó là `import.job` (nguyên job), `channel.changed`, `downloads.changed`, `resync` (đọc lại mọi thứ), `session.ended`, và `ping` mỗi 25 giây. Không nhận được gì trong 60 giây thì trang tự mở lại kết nối, vì proxy có thể giữ một kết nối đã chết |

### Xem archive

- **Danh sách:** **All Messages** và **Videos / Images / Documents / Audio** ở sidebar dùng chung một kiểu danh sách:
  - Video và ảnh hiện dạng lưới ảnh xem trước; tài liệu và audio hiện dạng dòng, có nút tải; mọi message khác hiện dạng thẻ.
  - Các message gửi chung một **album** được gộp vào một thẻ.
  - Message hệ thống (tạo topic, ghim…) không hiện trong danh sách.
- **Bộ lọc:** loại, channel, **topic** (khi channel là forum), khoảng ngày (theo giờ trình duyệt), *Downloaded / Not downloaded*, thứ tự mới/cũ.
  - Bộ lọc nằm trên URL, nên link và nút Back giữ nguyên bộ lọc.
  - Cuộn tới cuối là trang sau tự tải thêm.
  - Mở một message rồi bấm Back sẽ quay về đúng danh sách và vị trí đang xem, không tải lại.
- **Forum topic:** channel dạng forum (supergroup có topic) hiện mục **Topics** trên trang channel. Mỗi topic ghi số video/tài liệu/message và khoảng ngày; có ô tìm không phân biệt dấu.
  - Trang topic (`/channels/:id/topics/:topicId`) liệt kê message **cũ → mới** như một khóa học, kèm nút topic trước và sau.
  - Tên topic do worker đọc từ Telegram: tự đọc cho forum chưa có tên (trong vòng khoảng một phút), đọc lại mỗi ngày, và khi bấm **Refresh topics**.
  - Message không thuộc topic nào nằm trong topic **General**.
- **Trang message:** file hiện theo loại MIME, nên ảnh gửi dạng tài liệu vẫn mở trong trình xem ảnh.
  - **Video/audio:** trình phát riêng, stream bằng `Range` (không tải cả file vào bộ nhớ). Có play/pause, tua, âm lượng, tốc độ 0.5–2×, toàn màn hình và picture-in-picture.
    - Phím tắt khi player đang được chọn: Space/K phát hoặc dừng · ←/→ 5 giây · J/L 10 giây · ↑/↓ âm lượng · M tắt tiếng · F toàn màn hình · `<`/`>` tốc độ.
    - Player nhớ âm lượng, tốc độ và **vị trí đang xem** (trong trình duyệt này). Mở lại là xem tiếp; Dashboard có mục **Continue watching**.
  - **Ảnh:** bấm để mở toàn màn hình. Zoom bằng nút, phím `+ − 0`, con lăn, double-click hoặc hai ngón; kéo khi đang zoom; ←/→ hoặc vuốt để chuyển giữa các ảnh cùng album.
  - **PDF:** xem ngay trong trang, kèm nút mở ở tab mới và **Save file**.
  - **File chưa tải:** hiện ảnh xem trước của Telegram và nút **Download** (tải ngay, bất kể công tắc và Settings), kèm tiến độ. Tải xong thì player hoặc ảnh hiện ngay. Nếu file phải chờ, trang nói lý do (Settings đang Pause, nơi lưu hết chỗ…).
  - **Chữ:** hiện đúng định dạng của Telegram (đậm, nghiêng, link, code, trích dẫn, spoiler). Kèm thông tin gốc: id message, ngày, sửa lúc, lượt xem, forward từ đâu, reply, topic, nút **Open in Telegram**; và thông tin file: tên, MIME, cỡ, SHA-256, nơi lưu.
  - Nút **Previous / Next** đi tới message cũ hơn/mới hơn cùng channel, cùng topic và cùng loại (bài trước/bài sau).
- **Trình duyệt phát được gì:** mp4 (H.264/AAC), webm, mp3/m4a/ogg phát trực tiếp. mkv, wmv, avi… tuỳ trình duyệt; nếu không phát được, trang hiện link **Save file** để mở bằng player trên máy.

API xem archive (đều cần đăng nhập web):

| Endpoint | Ý nghĩa |
|---|---|
| `GET /api/messages` | Mới nhất trước. Lọc: `channelId` (gồm cả group cũ của supergroup), `topicId` (cần `channelId`; `1` = General), `types` (vd. `VIDEO,ANIMATION`; mặc định mọi loại trừ `SERVICE`), `from`/`to` (ngày theo UTC hoặc ISO date-time có offset), `downloaded=true/false`, `sort=newest/oldest`. Phân trang `cursor`/`limit` (≤ 100); `total` chỉ có ở trang đầu và đếm tối đa 10 000 (`totalCapped: true` khi nhiều hơn, web ghi "10,000+"), nên trang đầu nhanh như nhau với archive cỡ nào |
| `GET /api/messages/:id` | Message kèm file, album, reply thật (message trong topic không tính là reply), topic, `previousId`/`nextId` cùng topic và loại, `telegramUrl` |
| `GET /api/channels/:id/topics` | Topic của forum theo thứ tự tạo, với số message theo loại và khoảng ngày; `forum:false` nếu không phải forum |
| `POST /api/channels/:id/topics/refresh` | Đọc lại tên topic từ Telegram qua worker. `422 NOT_A_FORUM`; `503`/`504`/`429` như các lệnh Telegram khác |

### Tìm kiếm, tag và yêu thích

- **Tìm kiếm:** gõ vào ô trên header (phím `/`) rồi Enter để tìm trong cả archive (trang `/search`), hoặc gõ vào ô **Search this list** của một danh sách (Videos, trang channel, topic, Favorites, trang tag…) để tìm trong đúng danh sách đó.
  - Tìm trong **chữ, caption và tên file**. Trong archive này tên file quan trọng nhất: phần lớn video không có chữ.
  - Mỗi từ gõ vào khớp với **đầu một từ**, không phân biệt dấu và hoa thường: `phuong phap` tìm ra "Phương_Pháp_Học_Tập…", `quang` tìm ra "Quang học".
  - Tên file được tách từ ở dấu `.` và `_`, nên `zone` tìm ra "…_Time_Zone.mp4".
  - Mặc định xếp theo **Best match**: đủ các từ đứng liền nhau theo thứ tự gõ, rồi khớp nguyên từ, và tên ngắn đứng trước. Ví dụ `buoi 10` cho "Buổi 10.mp4" trước "Buổi 100". Có thể đổi sang mới nhất/cũ nhất.
  - Kết quả tô sáng từ tìm thấy. Mỗi kết quả là một thẻ riêng (không gộp album). Dùng được cùng mọi bộ lọc.
- **Yêu thích (♥):** bấm ♥ trên ô video, dòng tài liệu, thẻ message hoặc ở trang message.
  - Trang **Favorites** liệt kê theo thứ tự thích gần nhất. Mọi danh sách có chip **Favorites** để chỉ hiện message đã thích.
  - Favorites và tag thuộc về **archive**, không thuộc từng tài khoản: ai đăng nhập web cũng thấy chung.
- **Tag:** gõ tên vào ô **Tags** ở trang message.
  - Enter chọn tag gợi ý, hoặc **tạo tag mới** nếu chưa có tên đó. Gợi ý khớp đầu từ, không dấu.
  - Tag hiện dưới thẻ và dòng trong danh sách; bấm vào tag để mở trang của tag (`/tags/:id`).
  - Trang **Tags**: số message của từng tag, tạo tag, đổi tên, đổi màu, xoá. Xoá tag chỉ gỡ tag khỏi message; message vẫn còn.
  - Tên tag dài 1–40 ký tự và không được trùng (không phân biệt hoa thường). Archive có tối đa 500 tag.
  - Bộ lọc **Tags** trong danh sách: chọn nhiều tag thì chỉ giữ message có **đủ mọi tag** đã chọn.
- **Cách hoạt động:** cột `messages.search_vector` gồm chữ, caption và tên các file của message. Trigger PostgreSQL tự cập nhật cột này khi import, sửa message hoặc đổi tên file; migration `phase6_search_file_names` đã điền cho message có sẵn.
  - API tìm qua lớp `SearchProvider` (`apps/api/src/search`). Bản hiện tại là `PostgresSearchProvider` (full-text search với cấu hình `tam_simple`).
  - Muốn dùng Elasticsearch/OpenSearch: viết class kế thừa `SearchProvider` (trả về id message theo thứ tự, tổng số và vị trí trang), giữ index cập nhật khi message, file hoặc tag thay đổi, rồi đổi `useClass` trong `search.module.ts`. Phần tô sáng và DTO không phải sửa.

API tìm kiếm, tag và yêu thích (đều cần đăng nhập web):

| Endpoint | Ý nghĩa |
|---|---|
| `GET /api/search` | `q` (bắt buộc, ≤ 200 ký tự, có chữ hoặc số; tối đa 8 từ) cùng mọi bộ lọc của `GET /api/messages`. `sort=relevance` (mặc định) / `newest` / `oldest`. Mỗi item có `matches.fileName` và `matches.excerpt`: các cặp `[offset, length]` để tô sáng; `excerpt` là đoạn quanh chỗ khớp đầu tiên |
| `GET /api/messages` (thêm) | `tagIds=a,b` (có đủ mọi tag, tối đa 10), `favorite=true/false`, `sort=favorited` (mới thích trước; cần `favorite=true`). Item có `isFavorite` và `tags` |
| `POST` / `DELETE /api/messages/:id/favorite` | Thích / bỏ thích; gọi lại không đổi gì. Trả `{isFavorite, favoritedAt}` |
| `GET /api/tags` | Mọi tag theo tên, kèm `messageCount` |
| `POST /api/tags` | `{name, color?}` (`#rrggbb`). `409 TAG_NAME_TAKEN`, `422 TAG_LIMIT_REACHED` |
| `PATCH /api/tags/:id` / `DELETE /api/tags/:id` | Đổi tên hoặc màu (`409` nếu trùng tên); xoá (`204`) |
| `POST /api/messages/:id/tags` | `{tagId}` hoặc `{name, color?}` (tên mới thì tạo tag). Trả các tag của message |
| `DELETE /api/messages/:id/tags/:tagId` | Gỡ tag khỏi message. Trả các tag còn lại |

### Nơi lưu (storage locations)

Mỗi channel lưu media vào một nơi lưu. Quản lý ở **Settings → Storage locations**, hoặc ngay tại bước 4 của wizard.

| Loại | Chi tiết |
|---|---|
| **This computer** (có sẵn) | Thư mục `STORAGE_LOCAL_ROOT`. Là nơi lưu mặc định lúc đầu, và không xoá được |
| **Folder on this computer** | Thư mục trên máy chạy archive (máy chạy api/worker, không phải máy đang mở trình duyệt), chọn bằng trình duyệt thư mục. Chỉ được chọn bên trong `STORAGE_LOCAL_ROOTS`, nên web không thể ghi vào chỗ nhạy cảm, kể cả qua symlink/junction. Có thể tạo thư mục con mới khi thêm |
| **Google Drive** | Một thư mục trong My Drive, do ứng dụng tạo (mặc định "Unofficial Telegram Archive"). Ứng dụng chỉ có quyền `drive.file`: chỉ thấy các file và thư mục nó tạo ra, không đọc được file khác của bạn |

- **Cấu trúc file** trong mọi loại nơi lưu, dễ xem như một bản sao của channel: `<Tên channel (chat id)>/<YYYY-MM>/<message id> - <tên file gốc>`, ví dụ `Học tập Vật Lý (-1001234567890)/2026-09/1523 - Bài giảng 5.pdf`.
  - Tên được làm sạch để hợp lệ trên Windows, Linux và Google Drive: bỏ ký tự cấm, giữ tiếng Việt.
  - Tên thư mục channel được giữ cố định từ lần chọn đầu, nên đổi tên channel trên Telegram không làm tách file ra hai thư mục.
- **Kiểm tra (Check):** ghi, đọc lại rồi xoá một file nhỏ, sau đó báo dung lượng trống (với Google Drive là quota của tài khoản). Web tự kiểm tra mỗi nơi lưu khi mở danh sách, nên nơi lưu hỏng (thư mục bị xoá, quyền Google bị thu hồi) hiện lỗi ngay.
- **Đổi nơi lưu** của một channel chỉ áp dụng cho file tải sau đó. File đã lưu vẫn ở chỗ cũ, vì mỗi file ghi nhớ nơi lưu của nó.
- **Xoá nơi lưu** chỉ được khi không còn channel hay file nào dùng. Các file đã lưu trong thư mục hoặc Drive vẫn còn nguyên. Với Google Drive, ứng dụng thu hồi luôn quyền truy cập.

API (đều cần đăng nhập web):

| Endpoint | Ý nghĩa |
|---|---|
| `GET /api/storage/locations` | Danh sách nơi lưu, kèm những gì server cho phép thêm (`localRoots`, Google Drive có dùng được không) |
| `GET /api/storage/local/folders?path=` | Thư mục con của `path` (trong các thư mục được phép); không có `path` thì trả các thư mục gốc |
| `POST /api/storage/locations` | Thêm thư mục trên máy: `{name, path, subfolder?}`. Chỉ tạo khi ghi thử thành công |
| `PATCH /api/storage/locations/:id` | Đổi tên, hoặc đặt làm mặc định (`{isDefault: true}`) |
| `POST /api/storage/locations/:id/check` | Ghi, đọc, xoá thử một file nhỏ, rồi báo dung lượng |
| `DELETE /api/storage/locations/:id` | Xoá nơi lưu không còn dùng (`409 LOCATION_IN_USE` / `LOCATION_BUILT_IN`) |
| `POST /api/storage/google/connect` | Bắt đầu đăng nhập Google bằng mã thiết bị: `{name, folderName?, locationId?}` |
| `POST /api/storage/google/connect/:flowId/poll` | Hỏi Google đã được đồng ý chưa: `pending` / `authorized` / `denied` / `expired` |

### Kết nối Google Drive

Làm một lần, giống việc tạo `api_id` cho Telegram. Tài khoản Google dùng để tạo client không cần là tài khoản sẽ lưu file.

1. Vào <https://console.cloud.google.com>, tạo một project (ví dụ "Telegram Archive").
2. **APIs & Services → Library**: bật **Google Drive API**.
3. **Google Auth Platform** (hoặc **OAuth consent screen**):
   - Chọn User type **External**, điền tên ứng dụng và email.
   - Tên ứng dụng không được chứa "Google". Nếu có chữ "Telegram", phải có "Unofficial" đứng trước.
   - Scope chỉ cần `.../auth/drive.file`, `openid` và `email`.
4. **Publish app** (chuyển sang *In production*). **Bắt buộc**: ở trạng thái *Testing*, Google cho refresh token hết hạn sau 7 ngày và bạn phải kết nối lại mỗi tuần. Vì chỉ dùng scope *non-sensitive*, Google không cần duyệt ứng dụng.
5. **Credentials → Create credentials → OAuth client ID**, chọn loại **TVs and Limited Input devices**.
6. Chép Client ID và Client secret vào `.env`:
   ```env
   GOOGLE_OAUTH_CLIENT_ID=1234567890-xxxx.apps.googleusercontent.com
   GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-...
   STORAGE_SECRET_KEY=<32 byte base64, xem mục 3>
   ```
   Sau đó khởi động lại api.
7. Trên web: **Settings → Storage locations → Google Drive** (hoặc bước 4 của wizard) → **Get a code**. Mở <https://www.google.com/device> trên bất kỳ thiết bị nào, nhập mã hiển thị, chọn tài khoản rồi cho phép. Giữ nguyên dấu tích quyền Google Drive.

Vì sao dùng mã thiết bị: cách này không cần redirect URI, nên dùng được dù bạn mở archive bằng `localhost`, IP LAN hay domain. Refresh token được mã hoá bằng `STORAGE_SECRET_KEY` và không bao giờ gửi xuống trình duyệt.

## 10. Start sync

Sau khi import, **sync** giữ channel luôn đủ message mới:
- Chỉ đọc message mới hơn message mới nhất đã lưu (`head_message_id`), không bao giờ đọc lại lịch sử cũ.
- Chạy bao nhiêu lần cũng không tạo bản trùng: dùng chung cách ghi từng trang với import.

**Bật và tắt**
- Mục **Sync** trên trang channel có công tắc **Keep this channel up to date**. Ở bước Start của wizard là công tắc **Keep it up to date**.
- Sync **bật sẵn**, cho channel mới lẫn channel đã có trong archive từ trước Phase 7.
- Không bao giờ sync:
  - chat có content protection;
  - group cũ đã nâng cấp thành supergroup (message mới vào supergroup).
- Sync tự tắt khi chat bật content protection, hoặc khi tài khoản không còn đọc được chat. Lý do hiện ngay dưới công tắc. Bật lại thì lý do biến mất.

**Khi nào sync chạy**
1. **Ngay khi Telegram báo có message mới.**
   - Worker nhận updates của tài khoản và chỉ giữ lại message mới của channel đang sync.
   - Mỗi 15 giây, `SyncScheduler` tạo một sync cho channel có message mới chưa lưu. Mỗi channel tối đa một sync mỗi phút.
   - Thường mất khoảng 20 giây từ lúc message được đăng tới lúc nằm trong archive.
2. **Kiểm tra định kỳ**, chu kỳ chọn trong **Settings → Sync**: 15 phút (mặc định), 30 phút, 1, 3, 6, 12 giờ hoặc mỗi ngày.
   - Mỗi channel đến hạn chỉ tốn một request nhỏ (message mới nhất). Không có gì mới thì chỉ ghi lại *Last synced*, không tạo job. Có message mới thì tạo một sync.
   - Lượt này lấy lại message đăng lúc worker tắt, và message của channel rất lớn mà Telegram không đẩy update.
3. **Sync now** trên trang channel (`POST /api/channels/:id/sync`):
   - Channel chưa import trả `409 SYNC_NEEDS_IMPORT`.
   - Channel đang có import dở trả `409 IMPORT_ACTIVE`: sync sau khi import xong.

**Sync job**
- Mỗi sync là một job loại `SYNC` trong **Import Jobs**, có bộ lọc All / Imports / Syncs. `origin` cho biết vì sao job chạy: *Asked for*, *Scheduled check* hay *New messages on Telegram*.
- Sync chạy trong queue riêng `telegram-sync`, song song với tối đa một import, nên không phải chờ sau một import dài.
- Sync không pause được, chỉ cancel được, vì một job pause sẽ giữ chỗ duy nhất của channel. Bắt đầu một import khi sync đang chờ hoặc đang chạy thì sync được huỷ để nhường chỗ, vì phần forward của import cũng đọc message mới.
- Sync tự động đã kết thúc quá 30 ngày được xoá khỏi danh sách. Sync bạn tự bấm thì giữ lại.
- Nếu một sync tự động thất bại, channel được sync tự động lại sau 6 giờ. **Sync now** thì chạy được ngay.

**Giữ nguyên bản gốc:** sync chỉ thêm message mới. Message đã lưu không bị sửa theo Telegram, và message bị xoá trên Telegram vẫn còn trong archive.

**Forum:** nếu message mới nằm trong topic chưa biết tên, worker đọc lại danh sách topic trong vòng một phút.

## 11. Production deployment

Hai cách chạy, cùng một mã nguồn:

| | Máy Windows này (pm2) | Máy Linux trong LAN (Docker Compose) |
|---|---|---|
| Mở web | <http://localhost:8080> trong trình duyệt của phiên RDP | `http://<IP hoặc tên máy>:8080` từ mọi máy trong LAN |
| Phục vụ web | API phục vụ luôn bản build (`WEB_DIST_DIR`) | nginx, proxy `/api/` sang API |
| PostgreSQL, Redis | Service Windows có sẵn (§7) | Container, volume riêng |
| Tự chạy lại | pm2 khi app lỗi; scheduled task khi máy khởi động | `restart: unless-stopped` |
| Kiểm chứng | Đang chạy trên máy này | `scripts/compose-smoke.sh` (CI) |

### Trên máy Windows này (pm2)

Máy này chỉ có IP public, nên API chỉ nghe `127.0.0.1:8080` và **không mở cổng nào trên firewall**. Dùng web qua RDP. Muốn mở từ máy khác thì dùng SSH tunnel hoặc VPN, hoặc đặt HTTPS phía trước (bên dưới).

Lần đầu (PowerShell, Administrator):

```powershell
Get-Service postgresql-x64-18, Redis74      # cả hai phải Running
npm install -g pm2                          # nếu chưa có
npm install
npm run build
npm run db:deploy
npm run prod:start                          # kiểm tra, rồi chạy tam-api và tam-worker
powershell -ExecutionPolicy Bypass -File scripts\prod\install-startup-task.ps1
icacls .env /inheritance:r /grant:r "Administrators:F" "SYSTEM:F"   # chỉ admin đọc được .env
```

- `.env` ở gốc repo dùng chung với dev: cùng DB, Redis, session Telegram và nơi lưu. `ecosystem.config.cjs` chỉ đặt thêm `NODE_ENV=production`, `API_HOST=127.0.0.1`, `API_PORT=8080`, `TRUST_PROXY=false`, `CSRF_TRUSTED_ORIGINS` và `WEB_DIST_DIR`.
- `prod:start` từ chối chạy khi chưa build, khi DB chưa migrate, hoặc khi API dev đang chạy ở cổng 3100: **hai worker không bao giờ được chạy cùng lúc**.

| Lệnh | Tác dụng |
|---|---|
| `npm run prod:status` | Trạng thái, PID, thời gian chạy, số lần restart, RAM của hai app |
| `npm run prod:logs` | Log của hai app (JSON) |
| `npm run prod:restart` | Khởi động lại (đọc lại `ecosystem.config.cjs`) |
| `npm run prod:stop` | Dừng. Watchdog không bật lại app đã dừng bằng tay |
| `npm run prod:update` | Build, `db:deploy`, rồi khởi động lại |
| `npm run prod:disable` / `prod:enable` | Tắt / bật scheduled task (vd. trước khi chạy `npm run dev`) |

- **Tự chạy lại:**
  - pm2 khởi động lại app bị crash, chờ tăng dần từ 1 tới 15 giây.
  - Scheduled task **TAM Archive Manager** chạy `scripts/prod/ensure-running.mjs` một phút sau khi máy khởi động và mỗi 5 phút sau đó. Script start app nào pm2 không có (daemon mới sau reboot) hoặc đã bỏ cuộc (`errored`), và xoay log vượt 20 MB (giữ 5 bản). Nhật ký của nó: `%USERPROFILE%\.pm2\logs\tam-watchdog.log`.
  - Task chạy bằng tài khoản Administrator kiểu S4U (không lưu mật khẩu), nên chạy cả khi không ai đăng nhập RDP.
  - Việc task tạo daemon pm2 lúc máy khởi động chỉ kiểm chứng được ở lần reboot kế tiếp: sau khi máy khởi động lại, `npm run prod:status` phải thấy hai app online. Nếu không, xem nhật ký watchdog.
- **pm2 dùng chung với dự án khác:** trên Windows, mỗi máy chỉ có một daemon pm2, và daemon này đang chạy cả app `xau-confl` của dự án khác.
  - Chỉ dùng các lệnh `npm run prod:*`, hoặc gọi pm2 với `tam-api`, `tam-worker` hay `ecosystem.config.cjs`.
  - **Không bao giờ** `pm2 kill`, `pm2 update`, `pm2 restart all`, `pm2 delete all` hay `pm2 save`.

### Trên Linux bằng Docker Compose

Cài đặt ở §6. Cập nhật lên bản mới:

```bash
git pull
docker compose up -d --build        # migrate chạy xong rồi mới tới api và worker
```

- `WEB_ORIGINS` phải có mọi địa chỉ dùng để mở web. Địa chỉ IP luôn được, tên máy thì phải có trong danh sách.
- Worker có 60 giây để trả job đang chạy về hàng đợi khi bị dừng (`stop_grace_period`).
- Đúng một worker: không scale `worker`.

### HTTPS phía trước (tuỳ chọn)

Cần khi mở archive qua Internet. Đặt một reverse proxy có TLS (Caddy, Traefik, nginx) trước cổng 8080 (container `web`, hoặc pm2 trên máy này), rồi:
- Đặt `COOKIE_SECURE=true`. Cookie phiên có cờ `Secure`, và API tự gửi thêm HSTS và `upgrade-insecure-requests`.
- `WEB_ORIGINS` (Docker) hoặc `CSRF_TRUSTED_ORIGINS` (pm2) là `https://<domain>`.
- Proxy phải chuyển thẳng `/api/events` (server-sent events), không buffer, timeout ít nhất 1 giờ. Nên bật HTTP/2 ở proxy để tránh giới hạn 6 kết nối mỗi host của HTTP/1.1.
- Giới hạn đăng nhập tính theo IP của client:
  - Với pm2, đặt `TRUST_PROXY` là địa chỉ của proxy.
  - Với Docker, nginx của container `web` chỉ thấy IP của proxy TLS. Thêm `set_real_ip_from <IP proxy>;` và `real_ip_header X-Forwarded-For;` vào `docker/nginx/default.conf`.

### Tài khoản web

- **Settings → Your account** (hoặc menu tài khoản → **Account settings**):
  - **Change password:** cần mật khẩu hiện tại; mật khẩu mới tối thiểu 12 ký tự. Mọi trình duyệt khác bị đăng xuất, trình duyệt này vẫn đăng nhập.
  - **Signed-in browsers:** trình duyệt và hệ điều hành, IP, lần dùng gần nhất và ngày đăng nhập. **Sign out** một trình duyệt, hoặc **Sign out all other browsers**. Trình duyệt bị đăng xuất về trang đăng nhập ở request kế tiếp; trang đang mở thì trong vòng một phút.
- **Khoá tạm:**
  - Sai 10 lần trong 15 phút (đăng nhập, hoặc mật khẩu hiện tại khi đổi mật khẩu) thì email bị khoá tới hết 15 phút đó: `429 LOGIN_LOCKED` kèm `Retry-After`, và trang đăng nhập nói phải chờ bao lâu.
  - Email không có tài khoản bị đếm y hệt, nên không ai đoán được email nào tồn tại.
  - Ngoài ra, mỗi IP chỉ được 5 lần đăng nhập mỗi phút.
- **Quên mật khẩu, hoặc bị khoá:**
  - Trên máy này: `node apps/api/dist/cli/reset-password.js --email you@example.com`.
  - Docker: `docker compose exec api node apps/api/dist/cli/reset-password.js --email you@example.com`.
  - Lệnh hỏi mật khẩu mới 2 lần (không hiện ra màn hình), đăng xuất mọi trình duyệt và gỡ khoá.

| Endpoint (cần đăng nhập) | Ý nghĩa |
|---|---|
| `POST /api/auth/password` | `{currentPassword, newPassword}` → `204`. `422 CURRENT_PASSWORD_WRONG` / `PASSWORD_UNCHANGED`, `429 LOGIN_LOCKED`; giới hạn như đăng nhập |
| `GET /api/auth/sessions` | Các phiên còn hạn của bạn: `current`, `createdAt`, `lastSeenAt`, `expiresAt`, `ip`, `userAgent` (không bao giờ có token) |
| `DELETE /api/auth/sessions/:id` | Đăng xuất một phiên (`204`; `404` nếu không phải của bạn). Phiên hiện tại thì như Log out |
| `POST /api/auth/sessions/revoke-others` | Đăng xuất mọi phiên khác → `{revoked}` |

### Bảo mật

- **Telegram:** chỉ nội dung tài khoản được phép xem. Không bypass private channel, content protection, DRM, và không lưu media tự huỷ (đầu README). Chỉ worker giữ `api_id`/`api_hash` và session, session được mã hoá AES-256-GCM.
- **Secret:**
  - Không có secret trong repo; `.env` nằm trong `.gitignore`.
  - Credential của nơi lưu (token Google) không bao giờ xuống trình duyệt.
  - Production không chạy khi còn giá trị mẫu `CHANGE_ME`.
  - Docker: mỗi container chỉ nhận biến của nó, không có mật khẩu admin trong `docker inspect`.
- **Đăng nhập web:**
  - Mật khẩu hash bằng argon2id (64 MiB).
  - Cookie `HttpOnly`, `SameSite=Strict`, chỉ gửi cho `/api` (thêm `Secure` khi có HTTPS). Phiên trượt 7 ngày, tối đa 30 ngày.
  - Khoá tạm theo email, giới hạn theo IP, đổi mật khẩu và đăng xuất từ xa.
- **HTTP:**
  - Chống CSRF (`Sec-Fetch-Site`, dự phòng so `Origin` với `Host`).
  - Chỉ trả lời tên host được phép (chống DNS rebinding).
  - CSP chỉ cho tải từ chính archive, `frame-ancestors 'self'`, `nosniff`, `Referrer-Policy: no-referrer`, COOP/CORP.
  - Response API không được cache; `X-Forwarded-For` chỉ được tin từ proxy đã khai báo.
- **File:**
  - Chỉ ảnh, video/audio và PDF được mở trong trình duyệt, với CSP `sandbox` khi mở riêng. XML, HTML, SVG và mọi loại khác luôn tải xuống.
  - Tên file tải về không giữ ký tự điều khiển hay ký tự đảo chiều chữ.
  - Không bao giờ đi theo symlink/junction ra khỏi nơi lưu; API không trả đường dẫn trên server.
- **Dịch vụ:**
  - PostgreSQL và Redis chỉ nghe localhost (máy này) hoặc mạng nội bộ của Docker, đều có mật khẩu.
  - Trong Docker, role của ứng dụng không phải superuser và container không chạy bằng root.
- **Dependency:** `npm audit --omit=dev` báo 0 lỗ hổng. Hai lỗi của Prisma CLI (`deepmerge-ts`, `mysql2`) được vá bằng `overrides` trong `package.json`.
- **Giới hạn đã biết:**
  - Setup LAN là HTTP thường: mật khẩu và cookie đi không mã hoá trong mạng đó.
  - Favorites và tag dùng chung cho mọi tài khoản web.
  - Vị trí đang xem video nằm trong trình duyệt (localStorage) và còn lại sau khi đăng xuất.

### Sao lưu và khôi phục

Cần sao lưu:
- DB `tam`: message, file, tag, tài khoản web, job.
- DB `tam_tg`: session Telegram (đã mã hoá).
- Thư mục của các nơi lưu (media); thumbnail thì có thể tải lại.
- **`.env`**: thiếu `TELEGRAM_SESSION_KEY` và `STORAGE_SECRET_KEY` thì session Telegram và token Google trong bản sao lưu không giải mã được. Giữ `.env` ở nơi an toàn, tách khỏi bản sao lưu DB.

```powershell
# Máy này (pg_dump đọc mật khẩu từ biến PGPASSWORD hoặc file pgpass)
C:\MYDATA\tools\pgsql\bin\pg_dump.exe -h localhost -U tam -Fc -f <thư mục>\tam.dump tam
C:\MYDATA\tools\pgsql\bin\pg_dump.exe -h localhost -U tam -Fc -f <thư mục>\tam_tg.dump tam_tg
```

```bash
# Docker
docker compose exec -T postgres pg_dump -U tam -Fc tam > tam.dump
docker compose exec -T postgres pg_dump -U tam -Fc tam_tg > tam_tg.dump
docker run --rm -v tam_media:/data:ro -v "$PWD":/backup alpine tar czf /backup/media.tgz -C /data .
```

Khôi phục:
1. Dừng api và worker (`npm run prod:stop`, hoặc `docker compose stop api worker`).
2. `pg_restore --clean --if-exists -h localhost -U tam -d tam tam.dump`, và tương tự cho `tam_tg`.
3. Chép lại thư mục media.
4. Chạy lại api và worker.

### Hiệu năng

Đo bằng `scripts/perf` trên archive giả 150 000 message, 120 000 file và 2 000 sync job, gấp khoảng 40 lần archive thật hiện nay. Trung vị 15 lần gọi qua HTTP trên máy dev:

| Trang / việc | Trước Phase 8 | Sau |
|---|---:|---:|
| Danh sách channel | 241 ms | 49 ms |
| Trang channel (forum 100 000 message) | 127 ms | 33 ms |
| Mục Media downloads của channel | 201 ms | 36 ms |
| All Messages, trang đầu | 56 ms | 17 ms |
| Lọc file đã tải | 114 ms | 33 ms |
| All Messages, trang thứ 1 500 | 61 ms | 60 ms |
| Tìm kiếm | 52 ms | 38 ms |
| Worker: chọn file để tải (mỗi vài giây) | 344 ms | 0,6 ms |
| Worker: một file của job 100 000 file tải xong | 152 ms | 0,1 ms |

- **Đã làm:**
  - `download_jobs` mang sẵn channel và kích thước file (trigger điền), nên hàng đợi tải và các bộ đếm theo channel đọc một bảng qua index, không nối media với message.
  - File tải xong cộng dồn vào bộ đếm của job, thay vì đếm lại cả job.
  - Tổng ở trang đầu chỉ đếm tới 10 000.
  - Media có `ETag`/`304`; asset có hash được cache một năm; font nằm trong bản build.
- **Còn trên 100 ms ở quy mô này:**
  - Danh sách Topics của một forum 100 000 message (~110 ms): phải đếm message theo từng topic.
  - Việc đếm lại của mỗi trang import trong job 100 000 file (~150 ms mỗi trang), trong khi giữa hai trang đã nghỉ 1 giây.
  - Cả hai tăng tuyến tính và còn nhỏ so với archive hiện nay.
- **Không dùng:**
  - HTTP/2: trình duyệt chỉ dùng HTTP/2 qua TLS; bật ở reverse proxy khi có HTTPS.
  - X-Accel-Redirect: máy này không có nginx, và Node stream file đủ nhanh cho một người xem.
  - Nén gzip ở chế độ pm2: web mở qua localhost.

## 12. Troubleshooting

| Triệu chứng | Nguyên nhân / cách xử lý |
|---|---|
| Service `postgresql-x64-18` không start | Thư mục data thiếu quyền cho NetworkService: `icacls C:\MYDATA\tools\pgdata /grant "NT AUTHORITY\NetworkService:(OI)(CI)M" /T`. Xem log trong `pgdata\log` |
| `ECONNREFUSED 127.0.0.1:6380` / `NOAUTH` | Service `Redis74` đang dừng, hoặc `REDIS_URL` thiếu mật khẩu (`redis://:<pw>@127.0.0.1:6380/0`) |
| Lỡ kết nối vào Redis 6379 | Đó là Redis 5 của dự án khác. BullMQ 6 sẽ cảnh báo phiên bản và job có thể mất khi restart. Hãy dùng 6380 |
| `EADDRINUSE :3000` / `:4200` | Cổng của dự án khác. Dự án này dùng 3100 (API) và 4300 (web) |
| `/api/health/ready` báo `worker: missing` | Worker chưa chạy, hoặc không ghi được heartbeat vào Redis. Chạy `npm run dev:run -w @tam/worker` sau khi build |
| API/worker thoát ngay với `Invalid api environment` / `Invalid worker environment` | Biến trong `.env` sai định dạng; thông báo liệt kê đúng tên biến (không in giá trị). Biến để trống (`KEY=`) được coi như chưa đặt |
| `prisma migrate reset` bị từ chối | Prisma chặn lệnh này khi chạy từ AI agent. Dùng `npm run db:recreate -- --yes` (chỉ cho dev) |
| `npm warn Unknown cli config "--email"` khi tạo user | PowerShell nuốt dấu `--` khi pipe vào `npm`. Gọi thẳng `node apps/api/dist/cli/create-user.js --email … --password-stdin` |
| `db:check` báo khác biệt | Có index/constraint chỉ tồn tại trong SQL tay. Hãy khai báo trong `schema.prisma` |
| npm cảnh báo `install-scripts … not yet covered` | Xem `npm install-scripts ls`, duyệt package tin cậy bằng `npm install-scripts approve <pkg>` |
| Ai đó nâng TypeScript lên 7.x | Build Angular/ESLint hỏng. Giữ `typescript ~6.0.3` (đã ghim bằng `overrides`) |
| Ổ đĩa đầy | Giảm `MIN_FREE_DISK_MB` là không đủ. Hãy thêm ổ khác vào `STORAGE_LOCAL_ROOTS` rồi chọn thư mục ở đó, hoặc chuyển channel sang Google Drive (mục 9). Có thể dọn cache: `npm cache clean --force` |
| Nhiều tab mở cùng lúc, request bị treo (HTTP/1.1) | Trình duyệt giới hạn 6 kết nối mỗi host cho mọi tab, và mỗi tab giữ một kết nối live updates. Tab ẩn quá 30 giây tự đóng kết nối đó. Đóng bớt tab. Khi có HTTPS phía trước (§11): bật HTTP/2 ở reverse proxy |
| Header có biểu tượng đám mây gạch chéo: "Live updates are reconnecting" | Trang không nhận được `/api/events` quá 10 giây: api đang khởi động lại, hoặc proxy giữ lại (buffer) stream. Nếu proxy giữ một kết nối đã chết, trang nhận ra sau 60 giây không có `ping`. Trong lúc đó trang vẫn tự cập nhật bằng polling. Với nginx, dùng `location = /api/events` của `docker/nginx/default.conf` (`proxy_buffering off`). `DATABASE_URL` của api phải kết nối thẳng tới PostgreSQL: `LISTEN` không chạy qua pooler kiểu transaction (PgBouncer) |
| Message mới không vào archive ngay | Sync của channel đang tắt (xem lý do dưới công tắc), hoặc Telegram không đẩy update cho channel đó (thường gặp với channel rất lớn). Lượt kiểm tra định kỳ (**Settings → Sync**) vẫn lấy về; muốn ngay thì bấm **Sync now** |
| Log worker không có "Receiving updates from Telegram" | Tài khoản Telegram chưa đăng nhập. Sync theo update chỉ chạy khi tài khoản ở trạng thái READY; mỗi lượt của scheduler tự thử bật lại |
| Giao diện web mất style sau nginx | Kiểm tra CSP: build phải tắt `inlineCritical` và không có inline script (`theme-init.js` là file riêng) |
| Web báo "The background worker is not running" / API trả `503 WORKER_UNAVAILABLE` | Không có heartbeat của worker trong Redis. Chạy worker (`npm run dev` chạy tất cả); trang tự nhận khi worker lên |
| "Telegram is not set up on the worker" / `503 TELEGRAM_UNAVAILABLE` | Worker thiếu `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`, `TELEGRAM_SESSION_DATABASE_URL` hoặc `TELEGRAM_SESSION_KEY` (thông báo ghi đúng biến thiếu). Điền `.env` theo mục 4 rồi restart worker |
| "Waiting for the Telegram connection": *Another worker process owns the Telegram connection* | Đang có worker khác (ví dụ một terminal cũ) giữ lease `tam:tg:owner`. Dừng worker thừa; worker còn lại tiếp quản trong vòng một phút |
| "The worker cannot reach Telegram" (`ERROR`) | Lỗi mạng hoặc Telegram từ chối kết nối; chi tiết nằm trong thông báo và log worker. Worker tự thử lại sau 30 giây |
| `429 FLOOD_WAIT`: "Telegram asks to wait …" | Telegram giới hạn tần suất (thường do yêu cầu mã quá nhiều lần). Chờ đúng thời gian được báo; thử lại sớm hơn sẽ khiến thời gian chờ dài thêm |
| `429 RATE_LIMITED` khi đăng nhập Telegram | Giới hạn của chính API: 10 bước đăng nhập mỗi phút mỗi IP. Chờ một phút |
| `504 TELEGRAM_TIMEOUT` | Worker không trả lời trong `TELEGRAM_RPC_TIMEOUT_MS` (mặc định 30 giây), thường do mạng tới Telegram chậm. Thử lại |
| "The code has expired" / `409 INVALID_LOGIN_STATE` | Mã hết hạn, hoặc lần đăng nhập đang dở đã quá 15 phút. Trang tự quay về bước nhập số điện thoại; gửi lại số để nhận mã mới |
| `422 SIGN_UP_REQUIRED` / `PAYMENT_REQUIRED` | Số điện thoại chưa có tài khoản Telegram, hoặc Telegram yêu cầu đăng nhập bằng app chính thức trước. Ứng dụng này không tạo tài khoản mới |
| Danh sách chat trống sau khi đăng nhập | Worker đang đọc danh sách (trang hiện "Reading your chats from Telegram…"). Nếu vẫn trống, bấm **Refresh**; chỉ channel, supergroup và group đã tham gia mới được liệt kê (không có chat riêng/bot) |
| Nút **Folder on this computer** bị mờ | Server chưa có thư mục nào được phép. Đặt `STORAGE_LOCAL_ROOT` (và/hoặc `STORAGE_LOCAL_ROOTS`) rồi khởi động lại api |
| `422 PATH_NOT_ALLOWED`: "Choose a folder inside …" | Thư mục nằm ngoài `STORAGE_LOCAL_ROOTS`, hoặc là symlink/junction trỏ ra ngoài. Thêm ổ/thư mục đó vào `STORAGE_LOCAL_ROOTS` (ngăn cách bằng `;`) |
| `422 STORAGE_NOT_WRITABLE`: "No permission to write…" | Tài khoản chạy api/worker không ghi được vào thư mục. Cấp quyền ghi, hoặc chọn thư mục khác |
| Google Drive: "Google Drive is not set up on the server" | Thiếu `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` hoặc `STORAGE_SECRET_KEY` (thông báo ghi rõ thiếu gì). Làm theo "Kết nối Google Drive" ở mục 9, rồi khởi động lại api |
| "Google rejected the OAuth client" | Client ID/secret sai, hoặc client không phải loại **TVs and Limited Input devices** |
| Nơi lưu Google báo "access was revoked or has expired", **cứ mỗi tuần một lần** | Ứng dụng OAuth còn ở trạng thái *Testing* (refresh token chỉ sống 7 ngày). **Publish app** trên Google Cloud Console, rồi chọn **Reconnect Google account** trên nơi lưu đó |
| "Google Drive access was not allowed" | Khi đồng ý trên trang Google, quyền Google Drive đã bị bỏ tích. Kết nối lại và giữ dấu tích |
| "This Google account cannot open the folder …" | Khi kết nối lại, bạn đã chọn một tài khoản Google khác. Hãy đăng nhập đúng tài khoản ghi trên nơi lưu, hoặc thêm một nơi lưu Google Drive mới |
| "Google Drive is full." | Hết dung lượng Google. Giải phóng dung lượng, hoặc chuyển channel sang nơi lưu khác |
| Đổi `STORAGE_SECRET_KEY` xong, nơi lưu Google báo lỗi giải mã | Token cũ được mã hoá bằng key cũ. Chọn **Reconnect Google account** cho từng nơi lưu Google Drive |
| Import đứng ở **Queued** | Worker chưa chạy, hoặc đang bận một import khác (import chạy lần lượt từng job; sync có queue riêng). Nếu Redis từng mất kết nối lúc bấm Start, reconciler của worker sẽ đưa job vào queue trong vòng một phút |
| "Waiting for the worker to connect to Telegram" | Worker chưa giữ kết nối Telegram (đang khởi động, `STANDBY`, hoặc lỗi mạng). Job tự chạy tiếp khi kết nối xong, không mất lượt thử |
| "Waiting for Telegram: log in again under Settings → Telegram" | Session Telegram bị đăng xuất hoặc thu hồi. Đăng nhập lại; job tự chạy tiếp |
| "Telegram asked to wait N s before reading more" | `FLOOD_WAIT` của Telegram. Job tự chờ đúng thời gian đó. Nếu gặp thường xuyên, tăng `IMPORT_PAGE_DELAY_MS` |
| Job `FAILED`: "Content protection was turned on for this chat…" | Chat vừa bật content protection nên không được archive nữa. Các message đã lưu trước đó vẫn còn |
| Job `FAILED`: "This Telegram account can no longer read the chat" | Tài khoản đã rời chat, bị ban, hoặc chat bị xoá. Kiểm tra trong app Telegram |
| `409 IMPORT_ACTIVE` khi bấm Start | Channel đã có import chưa kết thúc với chế độ khác. Mở job đó (link trong thông báo), đợi nó xong hoặc Cancel rồi import lại |
| Nâng cấp lên Phase 4 xong mà không file nào được tải | Channel có từ trước bắt đầu với công tắc tải **tắt**. Bật **Download media automatically** trên trang channel khi nơi lưu đủ chỗ |
| Tải chờ: *Not enough free space in …* | Nơi lưu (hoặc thư mục tạm cho Google Drive) không đủ chỗ cho file tiếp theo mà vẫn giữ `MIN_FREE_DISK_MB`. Giải phóng chỗ, hoặc chọn nơi lưu lớn hơn cho channel. Worker tự thử lại sau 10 phút; bấm **Check** trên nơi lưu để thử ngay |
| *Google Drive is limiting uploads (it may be its 750 GB-a-day upload cap)* | Google giới hạn upload (khoảng 750 GB mỗi ngày cho một tài khoản). Nơi lưu tạm ngưng rồi tự tải tiếp, không cần làm gì |
| *The worker is not set up for Google Drive* | Worker cũng cần `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` và `STORAGE_SECRET_KEY` (giống api). Điền vào `.env` rồi restart worker, sau đó bấm **Check** trên nơi lưu |
| File *Failed* sau 8 lần thử | Lý do ghi trên file. Bấm **Retry failed** trên trang channel để thử lại từ đầu |
| Tải chậm | Tài khoản không Premium bị Telegram giới hạn tốc độ tải. Tăng *Files at a time* ít tác dụng, vì các file dùng chung giới hạn đó |
| Không có thumbnail | Worker thiếu `THUMBNAIL_DIR` hoặc `STORAGE_LOCAL_ROOT` (log worker có cảnh báo). Api và worker phải dùng cùng thư mục |
| Video hiện "This browser cannot play the file" | Định dạng hoặc codec trình duyệt không hỗ trợ (thường gặp với mkv, wmv, avi). Bấm **Save file** rồi mở bằng player trên máy (VLC…) |
| PDF không hiện trong trang (nhất là trên iPhone/iPad) | Trình duyệt di động chỉ hiện trang đầu hoặc không nhúng PDF. Dùng **Open in a new tab** |
| Topic chỉ hiện "Topic #123" | Worker chưa đọc tên topic từ Telegram (worker chưa chạy, chưa kết nối, hoặc tài khoản bị đăng xuất). Tên tự có trong vòng một phút sau khi worker kết nối; hoặc bấm **Refresh topics** trên trang channel |
| "Continue watching" trống trên máy khác | Vị trí xem được nhớ riêng trong từng trình duyệt (localStorage), không lưu trên server |
| Tìm không ra một phần ở giữa từ (vd. `0101` trong "20240101", `tics` trong "Optics") | Search chỉ khớp **đầu từ**. Hãy gõ từ đầu của từ: `2024`, `opt` |
| Tìm ra quá nhiều kết quả với từ rất ngắn (`2`, `a`) | Mỗi từ khớp mọi từ bắt đầu bằng nó. Gõ thêm từ hoặc để **Best match**: kết quả khớp đúng từ và tên ngắn đứng đầu |
| Không tạo được tag "toán" khi đã có "Toán" | Tên tag không phân biệt hoa thường. Dùng tag có sẵn, hoặc đổi tên tag cũ ở trang **Tags** |
| Tag hoặc ♥ ở tài khoản này cũng hiện ở tài khoản khác | Đúng thiết kế: favorites và tag thuộc về archive, dùng chung cho mọi tài khoản web |
| Dev: sau `npm run db:migrate`, API/worker báo `Unknown argument …` | `tsc -b -w` trong `npm run dev` không build lại Prisma client vừa generate. Dừng `npm run dev`, chạy `npm run build:packages`, rồi chạy lại `npm run dev` |
| `421 HOST_NOT_ALLOWED`: "This server does not answer for that host name" | Web được mở bằng một tên máy mà API không biết. Thêm địa chỉ đó vào `WEB_ORIGINS` (Docker), `CSRF_TRUSTED_ORIGINS` hoặc `ALLOWED_HOSTS`, rồi restart api. Mở bằng IP hoặc `localhost` thì luôn được |
| "Too many failed sign-ins for this email" (`429 LOGIN_LOCKED`) | Sai mật khẩu 10 lần trong 15 phút. Chờ hết thời gian trang ghi, hoặc đặt lại bằng `reset-password` (§11), lệnh này gỡ khoá luôn |
| "Too many sign-in attempts. Wait a minute" | Giới hạn 5 lần mỗi phút cho mỗi IP. Chờ một phút |
| `422 CURRENT_PASSWORD_WRONG` khi đổi mật khẩu | Mật khẩu hiện tại gõ sai. Lần sai này cũng tính vào khoá tạm |
| Web ở máy khác bị đưa về trang đăng nhập | Mật khẩu vừa được đổi, hoặc trình duyệt đó bị đăng xuất ở **Signed-in browsers**. Đăng nhập lại |
| Api/worker production thoát ngay: "still holds the CHANGE_ME placeholder" | Một URL hoặc secret trong `.env` vẫn là giá trị mẫu. Điền giá trị thật |
| `npm run prod:start`: "The development api answers on port 3100" | `npm run dev` đang chạy. Dừng nó trước: hai worker không được chạy cùng lúc |
| `npm run prod:start`: "The database is not up to date" / "…is missing: build first" | Chạy `npm run db:deploy` / `npm run build`, hoặc dùng `npm run prod:update` |
| `npm run prod:status` báo `errored` | App crash liên tục. Xem `npm run prod:logs` (thường là DB/Redis đang dừng, hoặc `.env` sai). Sửa xong thì `npm run prod:restart`; watchdog cũng tự thử lại mỗi 5 phút |
| Sau khi máy khởi động lại, web ở 8080 không mở | Xem `%USERPROFILE%\.pm2\logs\tam-watchdog.log` và `Get-ScheduledTask -TaskName 'TAM Archive Manager'`. Task đã tắt thì bật bằng `npm run prod:enable`; chưa có thì cài lại (§11). Chạy tay: `Start-ScheduledTask -TaskName 'TAM Archive Manager'` |
| `EADDRINUSE :8080` | Có chương trình khác dùng cổng 8080. Đổi `PORT` trong `ecosystem.config.cjs` rồi `npm run prod:restart` |
| Lỡ gõ `pm2 restart all` / `pm2 kill` | Lệnh đó tác động cả app `xau-confl` của dự án khác. Báo cho người quản lý app đó; với archive, chạy `npm run prod:start` |
| Danh sách ghi "10,000+" thay vì số chính xác | Đúng thiết kế: trang đầu chỉ đếm tới 10 000 message để luôn nhanh |
| Docker: `docker compose ps` báo worker `unhealthy` | Worker không ghi được heartbeat vào Redis trong 60 giây. Xem `docker compose logs worker` |
| Docker: web báo `502`/`504` ngay sau khi api khởi động lại | nginx đang tìm lại địa chỉ của api (tối đa 10 giây). Tải lại trang |
