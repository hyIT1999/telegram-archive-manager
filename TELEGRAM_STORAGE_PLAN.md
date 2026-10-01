# TELEGRAM_STORAGE_PLAN: Telegram làm nơi backup thứ ba

> Plan đã được duyệt ngày 27/09/2026. Mục cuối "Điều chỉnh khi triển khai" ghi những gì thay đổi sau vòng soát thiết kế.

## Context

Web hiện đã lưu media của channel/group Telegram vào **Local folder** hoặc **Google Drive**. Bạn muốn thêm nơi lưu thứ ba: **một chat Telegram private của bạn**. Mỗi message trong archive được tạo lại thành **message mới** trong chat backup (không forward), và database lưu mapping `source message id → backup message id`. Khi tin gốc bị xoá, bản backup vẫn còn và vẫn xem/tải được.

Yêu cầu giữ nguyên:
- Không viết lại project. Không phá Local, Drive, database, UI hay các chức năng hiện có.
- Không tải 756 GiB về máy: ổ C: chỉ còn khoảng 4,9 GB.
- Idempotent: đã backup thì không gửi lại.
- Retry, FloodWait, progress, verify.
- Không lộ secret.

**Bạn đã chốt (27/09/2026):**

| Câu hỏi | Chọn |
|---|---|
| Cách tạo bản sao | **Luôn tải về rồi tải lên lại.** File mới hoàn toàn, truyền thẳng Telegram → RAM → Telegram, từng file một, không ghi ổ đĩa |
| Topic | **Hỗ trợ supergroup có Topics.** Nơi backup là supergroup bật Topics thì worker tạo topic cùng tên và gửi tin vào đúng topic. Là channel thường thì tin xếp một dòng theo thời gian |
| Cấu hình | **Dùng tài khoản đang đăng nhập, chọn chat backup trên web.** Không thêm secret vào `.env` |

---

# Phase 1: Audit

## Kiến trúc hiện tại

| Phần | Công nghệ | Vị trí |
|---|---|---|
| Web | Angular 22, signals, Material | `apps/web` |
| API | NestJS 12 (Express), zod DTO | `apps/api` |
| Worker | NestJS + BullMQ 6, **mtcute 0.32.2**. Là tiến trình duy nhất nói chuyện với Telegram | `apps/worker` |
| Database | PostgreSQL 18, Prisma 7.10 | `packages/database` |
| Kiểu dùng chung | zod schema, enum | `packages/shared` |
| Driver nơi lưu | Local, Google Drive | `packages/storage` |
| Adapter Telegram | mtcute | `packages/telegram` |

Redis 7.4 giữ hàng đợi BullMQ, lease "ai giữ kết nối Telegram", heartbeat và RPC từ api sang worker. Session Telegram nằm trong DB riêng `tam_tg` (mtcute Postgres storage), auth key được mã hoá bằng `TELEGRAM_SESSION_KEY`.

## Storage abstraction

- `packages/storage/src/storage-driver.ts`: interface `StorageDriver` gồm `putFile(key, sourcePath)`, `duplicate`, `stat`, `openReadStream(key, range, known)`, `delete`, `localPath`, `stagingDir`, `probe`, `space`.
  - Có hai bản cài đặt: `local/local-storage-driver.ts` và `google/google-drive-driver.ts`.
- `packages/storage/src/locations.ts`: `LocationDriverFactory` dựng driver từ một dòng `storage_locations`.
  - **`locationConfig()` coi mọi kind khác LOCAL là Google Drive.**
  - Cả api (`apps/api/src/storage/storage-drivers.ts`) và worker (`apps/worker/src/media/media-settings.ts`) đều dựng driver.
- **Vì sao Telegram không thành một `StorageDriver` được:**
  - Api gọi `probe`, `space`, `stat` và `openReadStream` của driver (Check, chỗ trống, phát file), nhưng api không có kết nối Telegram.
  - Chỉ worker giữ đúng một kết nối Telegram, qua lease Redis `tam:tg:owner`. Hai kết nối cùng session sẽ bị `AUTH_KEY_DUPLICATED`.
  - `putFile(key, sourcePath)` đòi file trên đĩa. Việc bạn cần là tạo lại *message* (có text, album, topic), không phải cất một *file* theo key.
  - Kết luận: Telegram là một **kind mới của bảng `storage_locations`** (cùng bảng, cùng trang quản lý với Local/Drive), còn việc gửi do worker làm, theo mẫu pipeline tải media.

## File liên quan

| Nhóm | File chính |
|---|---|
| Storage | `packages/storage/src/{storage-driver,locations,paths,classify,errors}.ts`; `apps/api/src/storage/*` (controller, `storage-locations.service.ts`, `google-drive-connect.service.ts`, `storage-location.mapper.ts`, `storage-errors.ts`) |
| Download | `apps/worker/src/media/`: `download-scheduler.ts`, `download-store.ts` (claim SQL), `media-downloader.ts`, `media-download.processor.ts`, `download-reconciler.ts`, `space-guard.ts`, `progress-writer.ts`, `storage-targets.ts`, `thumbnail-fetcher.ts`. Adapter: `packages/telegram/src/mtcute/mtcute-adapter.ts` (`downloadFile`, `currentFile`) |
| Upload | Chỉ có upload lên **Google Drive** (`google-drive-driver.ts` `putFile`, file chờ ở `DOWNLOAD_STAGING_DIR`). **Chưa có bất kỳ code nào gửi hay tải lên Telegram** (không có `sendMedia`/`uploadFile`/`forwardMessages`) |
| Queue | `packages/shared/src/queues.ts` (hàng `telegram-import`, `telegram-sync`, `media-download`); `apps/worker/src/queues/*` |
| Database | `packages/database/prisma/schema.prisma`, `prisma/migrations/*`, `src/media-counters.ts`, `src/change-feed.ts` |
| Progress | Ghi: `apps/worker/src/media/progress-writer.ts`. Báo realtime: trigger `pg_notify('tam_changes', …)` → `apps/api/src/events/live-events.ts` (SSE). Hiển thị: `apps/web/src/app/features/downloads/channel-downloads-panel.*`, `apps/web/src/app/core/live/live-refresh.ts` |
| Settings | `apps/api/src/settings/*` (bảng `app_settings`, key `downloads`, `sync`); web `apps/web/src/app/features/settings/*` |
| Telegram | `packages/telegram/src/{telegram-client,types,file-id}.ts`, `mtcute/{mtcute-adapter,mappers,error-mapping,create-client}.ts`; worker `apps/worker/src/telegram/*` (connection, lifecycle, lease, cooldown, dialogs, rpc server); api `apps/api/src/telegram/*` |

## Database schema (phần liên quan)

- **`storage_locations`**
  - Cột: `kind` (enum **LOCAL \| GOOGLE_DRIVE**), `name`, `display_path`, `target` (unique theo kind), `config` Json, `secret_enc`, `is_default`, `built_in`, `last_error`, `last_checked_at`, `unavailable_until`.
- **`channels`**
  - Cột: `storage_location_id` (nơi tải về), `storage_folder`, `download_media`, `download_note`, `sync_enabled`, `is_forum`, `is_protected`, `migrated_to_channel_id`.
- **`messages`**
  - Cột: `telegram_message_id`, `type`, `text`, `caption`, `entities` (JSON dạng `{kind,offset,length,params}`), `telegram_date`, `media_group_id` (album), `thread_id` (topic).
- **`media`**: tối đa 1 file mỗi message.
  - Cột: `telegram_file_id` (id mờ `chatId:messageId:fileUniqueId`), `telegram_file_unique_id`, `type`, `filename`, `mime_type`, `size`, `width`, `height`, `duration`, `storage_location_id`, `storage_key`, `download_status`, `checksum`, `thumbnail_key`.
- **`download_jobs`**: mỗi file một dòng.
  - Cột: `status` (PENDING, ACTIVE, COMPLETED, FAILED, SKIPPED, CANCELLED), `run_seq` (quyền sở hữu), `attempts`, `not_before`, `requested_at`, `stage`, `reason`, `error`.
  - `channel_id` và `size` do trigger điền.
- **Các bảng khác:** `forum_topics` (topic của nguồn), `telegram_dialogs` (danh sách chat; **chưa có cột quyền admin/đăng bài**), `app_settings`, `telegram_accounts`.
- **Trigger liên quan:**
  - realtime: `tam_notify_import_job`, `tam_notify_channel`, `tam_notify_download_jobs`;
  - giá trị mặc định cho download job: `tam_download_job_defaults`;
  - tìm kiếm: `messages_search_vector_*`.

## Download flow

1. Import/sync ghi `messages`, `media` và một `download_jobs` cho mỗi file (`apps/worker/src/imports/archive-writer.ts`).
2. `DownloadScheduler` (mỗi 3 giây) nhận việc bằng SQL `FOR UPDATE SKIP LOCKED`: file được yêu cầu trước, rồi file nhỏ trước. Việc được đưa vào hàng BullMQ `media-download`.
3. `MediaDownloader`: đọc lại message gốc để có file reference mới (`currentFile`), rồi `downloadAsIterable` vào `.tam-tmp/<id>.part` (resume từng MiB). Sau đó kiểm size và SHA-256, rồi `putFile` (Local: đổi tên; Drive: upload từ file tạm).
4. `ProgressWriter` ghi tiến độ mỗi giây. Trigger báo `downloads:<channel>`, SSE đẩy tới trang.
5. Lỗi:
   - FloodWait, Telegram chưa sẵn sàng, nơi lưu đầy hoặc bị giới hạn: **chờ, không tính lượt thử**. Nơi lưu có vấn đề thì bị tạm ngưng (`unavailable_until`).
   - Lỗi khác: thử tối đa 8 lần, chờ từ 30 giây tăng tới 1 giờ, rồi FAILED. Nút **Retry failed** đưa file trở lại hàng đợi.
   - `DownloadReconciler` (60 giây) trả lại các lượt thử bị bỏ dở.

## Upload flow

Hiện chỉ có đường cho Google Drive: tải về `DOWNLOAD_STAGING_DIR` rồi `GoogleDriveStorageDriver.putFile` upload (resumable), kiểm size và sha256. Telegram chưa có đường upload.

## Queue flow

BullMQ chỉ dùng để chạy: `attempts: 1`, và BullMQ không retry. Trạng thái thật và việc retry nằm trong bảng (`download_jobs`, `import_jobs`). Worker không giữ kết nối Telegram (standby) nhận việc thì chờ, không tốn lượt thử.

## Telegram integration hiện có

- Một kết nối mtcute, chỉ **đọc**: lịch sử, message, file, thumbnail, topic, danh sách chat, update tin mới.
- Có sẵn:
  - `TelegramCooldown` toàn cục, nhận tín hiệu từ flood waiter của mtcute (tự chờ tối đa 10 giây; lâu hơn thì ném `FloodWaitError`);
  - bảng dịch lỗi `error-mapping.ts`;
  - kiểm tra content protection ở ba mức: chat, message, lúc tải.
- Api → worker gọi nhau qua Redis pub/sub (`packages/shared/src/telegram-rpc.ts`). Phản hồi **chưa mang dữ liệu**.
- mtcute 0.32.2 có sẵn mọi thứ cần:
  - `uploadFile` (nhận stream, `fileSize`, `progressCallback`, `abortSignal`; tối đa 2000 MiB với tài khoản thường);
  - `uploadMedia`, `sendMedia` (`threadId`, `randomId`), `sendText`;
  - raw `messages.sendMultiMedia` (album);
  - `downloadAsNodeStream` (`fileSize`, `offset`, `limit`, `stallTimeout`);
  - `createForumTopic`, `deleteMessages`;
  - `Chat.isCreator`/`adminRights`/`permissions`.

## Auth và cấu hình hiện có

- Web: tài khoản web (argon2, session cookie).
- Telegram:
  - `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` trong `.env`, chỉ worker đọc;
  - đăng nhập bằng số điện thoại trên web; session mã hoá trong `tam_tg`.
- Google Drive:
  - OAuth device code;
  - refresh token được niêm phong bằng `STORAGE_SECRET_KEY` trong `storage_locations.secret_enc`, không bao giờ gửi xuống trình duyệt.

## Dữ liệu thật (group forum đã archive)

- **Message:** 3.715 tin trong 127 topic.
  - Video: 3.164 tin (734 GiB, lớn nhất 1.807 MiB, **không file nào quá 2000 MiB**).
  - Document: 268 tin (21,9 GiB).
  - Chữ: 151 tin, 133 tin có định dạng.
  - Service: 131 tin. Sticker: 1 tin. Không có ảnh.
- **Album:** 446 album, tối đa 10 file mỗi album.
- **Tải về:** mới tải 10 file.
- **Nơi lưu:** có 1, là Local.

---

# Phase 2: Thiết kế

## Tổng quan

```text
                     ┌── Local folder     (storage_location_id, như cũ)
Telegram nguồn ──────┼── Google Drive     (storage_location_id, như cũ)
                     └── Telegram backup  (backup_location_id: MỚI, độc lập với hai nơi trên)
```

- **Nơi tải về** (Local hoặc Drive) giữ nguyên: một nơi mỗi channel, công tắc `download_media`.
- **Telegram backup** là cột và công tắc **riêng**. Vì vậy dùng được: Local + Telegram, Drive + Telegram, hoặc chỉ Telegram (tắt tải về, như group 756 GiB).
- Local + Drive cùng lúc vẫn không hỗ trợ, như hiện nay, để không đổi hành vi cũ.

**Luồng cho mỗi message (hoặc mỗi album):**

```text
message_backups PENDING
  → worker đọc lại tin gốc từ Telegram (file reference mới, text + entities chính xác)
  → mỗi file: nguồn = bản đã tải (Local/Drive) nếu có, không thì downloadAsNodeStream từ Telegram
        → uploadFile(stream, fileSize)  [RAM, có backpressure, không ghi đĩa]
        → uploadMedia(peer = chat backup)   (biến file vừa upload thành document bền)
  → gửi MỘT lần: sendMedia / sendText / messages.sendMultiMedia (album), kèm random_id đã lưu trước
  → lưu backup_message_id, completed_at
```

**Không có forward ở đâu cả:**
- Không gọi `forwardMessages` hay `sendCopy`. Mọi file đều được upload lại, nên id file mới khác id file gốc.
- Có test khẳng định fake Telegram không bao giờ nhận lệnh forward.
- Verify kiểm tra message backup không có `forward` header.

## Database (hai migration mới, chỉ thêm, không đổi dữ liệu cũ)

1. **`StorageKind` thêm giá trị `TELEGRAM`** bằng `ALTER TYPE … ADD VALUE`, đặt ở migration riêng vì PostgreSQL không dùng được giá trị enum mới trong cùng transaction.
   - Một dòng `storage_locations` loại TELEGRAM có `target` = chat id (dạng marked).
   - `config` = `{chatId, title, username, type: CHANNEL|SUPERGROUP, isForum}`.
   - Không có `secret_enc`. Không được đặt làm mặc định.
2. **`channels` thêm cột:**
   - `backup_location_id` (FK `storage_locations`, `ON DELETE RESTRICT`, chỉ nhận kind TELEGRAM);
   - `backup_enabled` (mặc định false);
   - `backup_note`.
3. **Bảng mới `message_backups`**, mỗi (tin nguồn × chat backup) một dòng. Tên cột ứng với tên bạn gợi ý:

   | Cột | Ý nghĩa |
   |---|---|
   | `message_id` → messages (CASCADE), `storage_location_id` → storage_locations (RESTRICT), `channel_id` | Tin nguồn, chat backup; `unique(message_id, storage_location_id)` |
   | `status` `BackupStatus` PENDING / ACTIVE / COMPLETED / FAILED / SKIPPED | = `telegram_backup_status` |
   | `stage` `BackupStage` FETCHING / UPLOADING / SENDING | SENDING = sắp gọi lệnh gửi (dùng khi phục hồi sau crash) |
   | `skip_reason` NOT_AVAILABLE / PROTECTED / UNSUPPORTED / TOO_LARGE | |
   | `run_seq`, `attempts`, `not_before`, `requested_at`, `force` | Quyền sở hữu, retry, "Back up now", "Back up again" |
   | `random_id` (bigint) | Tạo và lưu **trước** khi gửi. Gửi lại cùng random_id thì Telegram từ chối tạo bản trùng |
   | `size`, `uploaded_bytes` | Tiến độ |
   | `backup_chat_id`, `backup_message_id`, `backup_thread_id`, `extra_message_ids` | = `telegram_backup_channel_id`, `telegram_backup_message_id`, topic, tin chữ phụ khi caption quá dài |
   | `replaced_message_ids` | Bản backup cũ, được xoá sau khi "Back up again" thành công |
   | `error`, `last_attempt_at`, `completed_at` | = `telegram_backup_error`, lần thử cuối, `telegram_backup_at` |
   | `verified_at`, `verify_error` | Kết quả Verify |

   Index: hàng đợi (`storage_location_id`, `status`, `requested_at`) và (`channel_id`, `status`).
4. **Bảng mới `backup_topics`:** `(storage_location_id, channel_id, source_topic_id)` → `backup_topic_id`, `title`. Đây là mapping topic nguồn → topic backup.
5. **`telegram_dialogs` thêm `can_post`, `can_manage_topics`**, tính từ `isCreator`/`adminRights`/`permissions` khi làm mới danh sách chat.
6. **Trigger `tam_notify_message_backups`** (theo statement) gửi `backups:<channel id>`. `change-feed.ts` thêm kind `backups`; SSE thêm event `backups.changed`.
7. **Metadata gốc không lặp lại:** channel, message id, ngày, caption/text, tên file, cỡ, loại đã có trong `messages`/`media`. `message_backups` chỉ giữ phần của bản backup.

## Worker: module mới `apps/worker/src/backups/`

Theo mẫu pipeline tải media, không dựng kiến trúc mới.

**`backup-scheduler.ts`**
- Vòng lặp trong tiến trình, giống `ThumbnailFetcher`. Chỉ chạy khi:
  - `telegramReady()` đúng;
  - `app_settings.backups.paused = false`;
  - chat backup không bị tạm ngưng.
- **Mỗi lúc chỉ một lô** trên toàn hệ thống, để băng thông dành cho tải xuống và tải lên tuần tự.
- Một lô là một tin, hoặc mọi dòng PENDING của một album (tối đa 10).
- Thứ tự lô: `requested_at` trước, rồi `telegram_date`, rồi `telegram_message_id`.
- Mỗi 60 giây tạo bù dòng cho tin mới vừa sync (xem phần Seeding bên dưới).

**`backup-store.ts`**
- SQL nhận lô (`FOR UPDATE SKIP LOCKED`, `run_seq`).
- Ghi stage và tiến độ, complete, release, fail, skip, tạm ngưng chat backup.

**`backup-sender.ts`**
1. Đọc lại tin gốc bằng `getMessages`.
   - Tin gốc bị content protection thì SKIPPED PROTECTED và tắt backup của channel.
   - Tin gốc đã mất: nếu có bản trong Local/Drive thì tải lên từ bản đó; nếu không thì SKIPPED NOT_AVAILABLE (tin chữ vẫn gửi được từ DB).
2. Mỗi file: mở luồng nguồn (driver `openReadStream` của Local/Drive, hoặc `downloadAsNodeStream` từ Telegram), rồi `uploadFile` với `fileSize`/`fileName`/`mime`.
   - Watchdog: 120 giây không tiến thì huỷ, nhưng không huỷ khi đang có cooldown FloodWait.
   - Sau khi upload: `uploadMedia(peer=chat backup)`. File vừa upload thành document lưu hẳn trên Telegram, nên lệnh gửi cuối chỉ là một lệnh nhanh. Khoảng thời gian có thể crash giữa "đã gửi" và "đã ghi DB" vì vậy rất ngắn.
   - Thuộc tính lấy từ tin gốc: video giữ `duration`, `width`, `height`, `supportsStreaming`; document giữ tên file; audio giữ performer/title.
   - Thumbnail lấy từ `THUMBNAIL_DIR` nếu đã có.
3. Topic: nơi backup là forum thì `ensureTopic` tạo (hoặc dùng lại) topic cùng tên và gửi với `threadId`. Topic bị xoá thì tạo lại.
4. Ghi `stage = SENDING` và `random_id` (commit), rồi mới gửi đúng một lệnh:
   - `sendText`: text + entities gốc;
   - `sendMedia`: caption + entities gốc;
   - raw `messages.sendMultiMedia` với `random_id` từng file cho album. Id của từng tin mới đọc từ `updateMessageID` (random_id → id), nên ghép đúng từng tin nguồn với tin backup.
   - Caption vượt giới hạn (1024 ký tự với tài khoản thường): gửi media, rồi gửi phần chữ đầy đủ thành tin trả lời. Lưu id vào `extra_message_ids`.
5. Ghi COMPLETED với các id. "Back up again": sau khi gửi thành công thì xoá bản backup cũ, **chỉ trong chat backup**.

**`backup-reconciler.ts`**, chạy lúc khởi động và mỗi 60 giây.

Lượt đang chạy "chạm" dòng của nó mỗi 30 giây, kể cả khi đang ngủ chờ FloodWait. Vì vậy một dòng ACTIVE im lặng quá 2 phút chắc chắn thuộc một lượt đã chết.
- Dòng chết còn ở **FETCHING/UPLOADING**: trả về PENDING, không tính lượt thử. Chưa gửi gì nên không thể trùng.
- Dòng chết ở **SENDING** (crash đúng lúc gửi):
  1. **Trước hết đọc lịch sử chat backup** sau `backup_message_id` lớn nhất đã biết. Tìm các tin chưa được ghi nhận khớp với lô: cùng số tin, cùng loại, cùng tên và cỡ file, hoặc cùng chữ. Mỗi lúc chỉ có một lô đang gửi, nên phép so khớp rõ ràng. Tìm thấy thì ghi COMPLETED với id đó.
  2. Không thấy thì lô chưa tới Telegram. Upload và gửi lại với **cùng random_id**; nếu Telegram vẫn báo `RANDOM_ID_DUPLICATE` thì lần trước đã tới nơi, quay lại bước 1.
  3. Vẫn không chắc chắn thì FAILED kèm lỗi rõ ràng ("không xác nhận được lần gửi trước, hãy xem chat backup"). **Không bao giờ gửi mù lần hai.**

**`backup-verifier.ts`** (nút Verify):
- Đọc tin backup theo lô 100.
- Kiểm tra: còn tồn tại, không có forward header, có media, đúng loại, đúng cỡ (trừ ảnh vì Telegram nén lại), đúng tên file, đúng chữ/caption, đúng topic.
- Tải thử 1 MiB đầu của một mẫu nhỏ để chắc file đọc được.
- Kết quả ghi vào `verified_at`/`verify_error`.

**Lỗi và retry**, theo cùng quy tắc với tải media:

| Lỗi | Xử lý |
|---|---|
| FloodWait ngắn (≤ 10 giây) | mtcute tự chờ |
| FloodWait dài | Tạm ngưng chat backup tới hết thời gian + ghi cooldown chung. Không tính lượt thử. Sau đó giãn khoảng cách giữa các lần gửi |
| Tài khoản bị đăng xuất / session hết hạn | Chờ, báo "Telegram sign-in expired…" |
| Không còn quyền đăng, chat mất (`CHAT_WRITE_FORBIDDEN`, `CHAT_ADMIN_REQUIRED`, `CHANNEL_PRIVATE`…) | Tạm ngưng chat backup và ghi lỗi dễ hiểu lên chat backup + channel. Không đánh FAILED từng tin |
| File quá 2000 MiB | SKIPPED TOO_LARGE |
| Lỗi mạng, timeout, lỗi part upload | Thử lại tối đa 8 lần (30 giây → 1 giờ), rồi FAILED. Nút **Retry failed** |

- Lỗi không bao giờ chứa session, hash hay số điện thoại.

**Shutdown:** huỷ lượt đang chạy, trả dòng về PENDING (theo `ShutdownCoordinator` có sẵn).

## Telegram package

- `packages/telegram/src/telegram-client.ts` thêm interface **`TelegramBackupWriter`**, do `MtcuteTelegramAdapter` cài đặt. Worker vẫn không thấy object mtcute. Các hàm:
  - `getChatForBackup(chatId)` → quyền đăng / quản lý topic, forum hay không;
  - `openSourceStream(...)`;
  - `uploadForBackup(stream, meta, target)` → tham chiếu media đã upload;
  - `sendBackup(target, payload, {threadId, randomIds})` → id các tin mới;
  - `createForumTopic`;
  - `getBackupMessages(target, ids)`;
  - `getHistoryAfter(target, minId)`;
  - `readFileHead(target, messageId, bytes)`;
  - `deleteBackupMessages(target, ids)`.
- `mappers.ts`: `Chat` thêm `canPost`, `canManageTopics`.
- `error-mapping.ts` thêm lỗi phía gửi: `ChatWriteForbiddenError`, `TopicDeletedError`, `RandomIdDuplicateError`, `CaptionTooLongError`, `FileTooLargeError`.
- Entities: dùng thẳng entities của tin gốc vừa đọc. Khi tin gốc đã mất thì chuyển JSON `{kind,offset,length,params}` trong DB về TL, bỏ loại không gửi được (custom emoji với tài khoản thường).

## RPC api → worker

`packages/shared/src/telegram-rpc.ts`: phản hồi `ok` có thêm `result` (tuỳ chọn). Api kiểm tra `result` bằng zod theo từng method. Method mới:
- `backup.checkChat {telegramChatId}` → thông tin chat + quyền;
- `backup.verify {channelId}` → bắt đầu verify ở worker rồi trả về ngay.

## API

- **Storage:**
  - `POST /api/storage/telegram` `{name, telegramChatId}`: kiểm tra qua RPC, rồi tạo nơi lưu TELEGRAM. Từ chối nếu:
    - tài khoản không đăng được;
    - forum mà không quản lý được topic;
    - chat đó đang được archive (**chống vòng lặp**).
  - `check`: với TELEGRAM thì kiểm tra qua RPC; chỗ trống hiện "không giới hạn".
  - `remove`: báo `409 LOCATION_IN_USE` nếu còn channel hay `message_backups` dùng.
  - `locationConfig()` có nhánh thứ ba. `LocationDriverFactory` từ chối TELEGRAM. Mapper chỉ trả `displayPath` "Telegram › Tên chat" và `isForum`.
- **Channels:**
  - `PATCH /api/channels/:id` `{backupLocationId, backupEnabled}`, kiểm tra kind, protected, và chống vòng lặp. Bật lần đầu thì tạo dòng cho mọi tin cũ.
  - `ChannelDto` thêm `backupLocation`, `backupEnabled`, `backupNote`.
  - `POST /api/channels` từ chối thêm vào archive một chat đang là nơi backup.
- **Backup mới** (`channel-backup.service.ts`):
  - `GET /api/channels/:id/backup` trả:
    - số tin và số byte theo trạng thái, phần trăm;
    - việc đang chạy (tên file, stage, byte đã gửi);
    - lỗi gần nhất;
    - trạng thái chat backup (tạm ngưng tới, lỗi);
    - kết quả verify.
  - `POST /api/channels/:id/backup/retry` và `POST /api/channels/:id/backup/verify`.
- **Messages:**
  - `GET /api/messages/:id` thêm `backups[]`: trạng thái, link `t.me/c/…`, lỗi.
  - `POST /api/messages/:id/backup {force?}` = "Back up now" / "Back up again". Chạy được cả khi công tắc tắt, miễn channel đã chọn chat backup. Đây là cách chạy test 10–20 tin.
- **Settings:** `app_settings.backups = {paused}`.
- **SSE:** `backups.changed {channelId}`.

**Seeding** (tạo dòng `message_backups`):
- Hàm dùng chung `seedMessageBackups()` trong `packages/database`, tương tự `refreshMediaCounters`.
- **Api** gọi khi bật công tắc hoặc đổi chat backup, trong cùng transaction, nên số tổng hiện ngay.
- **Worker** chạy bù mỗi 60 giây cho tin mới sync về (anti-join trên index unique, vài ms với vài nghìn tin).
- **Không sửa `archive-writer.ts`**, nên đường import/sync hiện có giữ nguyên.
- Bỏ tin SERVICE. POLL/OTHER thành SKIPPED UNSUPPORTED.
- `ON CONFLICT DO NOTHING`, nên chạy lại bao nhiêu lần cũng không tạo trùng.

## Web: thêm vào chỗ có sẵn, không đổi bố cục

**Storage locations**
- Thêm helper kind → icon + nhãn, thay các chỗ đang so sánh hai chiều.
- Nút **Telegram chat** mở hộp thoại chọn trong danh sách chat mà tài khoản đăng được (có nút Refresh).
- Danh sách chọn có input `kinds`: chọn nơi tải về chỉ hiện Local/Drive, chọn nơi backup chỉ hiện Telegram.

**Wizard**
- Bước Storage có thêm mục tuỳ chọn "Also back up to Telegram".
- Bước Start có công tắc **Back up to Telegram automatically**.

**Trang channel: panel mới "Telegram backup"**, dùng lại markup của panel tải media. Gồm:
- chọn hoặc đổi chat backup (channel đã archive từ trước không đi qua wizard);
- công tắc;
- tổng tiến độ: số tin, GiB, tốc độ, thời gian còn lại;
- số Waiting / Uploading / Completed / Failed / Skipped;
- file đang gửi: tên, thanh %, MB/MB;
- lỗi gần nhất và **Retry failed**;
- **Verify backup** và kết quả;
- các thông báo tạm ngưng.

Ví dụ:

```text
Telegram backup                     [on]
Sent to  Telegram › My Backup (forum)
120 of 3,264 messages · 38.2 of 756 GiB · 6.1 MB/s · about 1 day 10 h left
Waiting 3,141 · Uploading 1 · Completed 120 · Failed 3 · Skipped 0
Lesson 120.mp4   Uploading  ██████████░░░░ 62%   23.4 MB of 37.5 MB
[Retry 3 failed]  [Verify backup]
```

**Trang message**: dòng "Telegram backup" gồm trạng thái, link **Open in Telegram**, và nút **Back up now/again**.

**Settings**: mục **Telegram backup** với "Pause all backups".

**Theo dõi realtime**: `liveRefresh` nghe `backups.changed`.

## Env

Không thêm biến.
- `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` đã có.
- Session nằm trong DB và được mã hoá sẵn.
- Chat backup chọn trên web.

`.env.example` chỉ thêm một đoạn chú thích: Telegram backup dùng chính tài khoản này, không cần biến mới. `.env` và session vốn không được commit (`.gitignore` đã có `.env`). Session không phải file `*.session`: nó nằm trong DB `tam_tg`.

## Bộ nhớ, ổ đĩa, thời gian

- **Ổ đĩa:** 0 byte tạm. Không ghi `.part`, luồng đi thẳng từ download sang upload.
- **RAM:** giới hạn bởi backpressure, khoảng vài chục MB.
- **Tốc độ:** mỗi file tải xuống và tải lên cùng lúc, nên tốc độ ≈ min(tải xuống, tải lên) ≈ 5–8 MB/s. 756 GiB mất khoảng **1,5–2,5 ngày** chạy liên tục.
- **File lỗi giữa chừng:** tải lại từ đầu, vì mtcute không resume upload. Tối đa mất khoảng 5 phút với file 1,8 GiB.

## Files

**Tạo mới**
- `packages/database/prisma/migrations/<ts>_telegram_backup_kind/` (ADD VALUE) và `<ts>_telegram_backups/` (bảng, cột, trigger).
- `packages/database/src/message-backups.ts` (seeding).
- `apps/worker/src/backups/`:
  - `backup-scheduler.ts`, `backup-store.ts`, `backup-sender.ts`, `backup-reconciler.ts`, `backup-verifier.ts`, `backup-topics.ts`;
  - `source-stream.ts`, `backup-settings.ts`, `backups.module.ts`.
- `apps/api/src/channels/channel-backup.service.ts`, `apps/api/src/storage/telegram-locations.service.ts`.
- `packages/shared/src/schemas/backups.ts`.
- Web:
  - `apps/web/src/app/features/backups/`: `channel-backup-panel.*`, `backup-api.ts`, `backup-labels.ts`;
  - `features/storage/telegram-chat-dialog.*`, `features/storage/storage-kinds.ts`.
- Test cho từng phần: `apps/worker/test/integration/support/fake-backup-chat.ts` và các spec.

**Sửa**
- `schema.prisma`.
- `packages/storage/src/{storage-driver,locations}.ts`.
- `packages/telegram/src/{telegram-client,types}.ts`, `mtcute/{mtcute-adapter,mappers,error-mapping}.ts`.
- `packages/shared/src/{enums,telegram-rpc}.ts`, `schemas/{storage,channels,media,messages,settings,events,telegram,errors}.ts`.
- Worker: `apps/worker/src/telegram/{telegram.tokens,telegram-rpc.server,telegram-dialogs.service}.ts`, `worker.module.ts`.
- Api: `apps/api/src/storage/*`, `channels/*`, `messages/*`, `settings/*`, `events/*`, `telegram/telegram-rpc.client.ts`. Đường phát file (`media/*`) không đổi, vì TELEGRAM không bao giờ là nơi tải về.
- Web:
  - `features/storage/*`, `features/imports/import-wizard-page.*`;
  - `pages/channel-detail/*`, `pages/message-detail/*`;
  - `features/settings/settings-page.ts`, `features/telegram/*` (thêm `canPost`);
  - `testing/fixtures.ts`.
- `.env.example`, `README.md` (trạng thái, kiến trúc, mục mới "Sao lưu sang Telegram" trong §9, bảng API, §12).

---

# Phase 3: Thứ tự làm (chỉ bắt đầu sau khi bạn duyệt)

Mỗi bước đều có test riêng và phải chạy xanh trước khi sang bước sau.

1. Lưu plan thành `TELEGRAM_STORAGE_PLAN.md`. Tạo nhánh `telegram-backup` từ `main` (5dbd4e2).
2. **Database và kiểu dùng chung:**
   - hai migration;
   - `seedMessageBackups`;
   - enum và schema trong `packages/shared`;
   - `locationConfig` nhánh TELEGRAM;
   - chạy `db:check`.
3. **Telegram package:**
   - `canPost`/`canManageTopics` cho danh sách chat;
   - `TelegramBackupWriter` (luồng nguồn, upload, gửi, topic, lịch sử, đọc thử, xoá);
   - lỗi phía gửi;
   - unit test với mtcute giả.
4. **RPC:** phản hồi có `result`; method `backup.checkChat`, `backup.verify`.
5. **Api:**
   - nơi lưu Telegram;
   - PATCH channel;
   - seeding;
   - summary/retry/verify;
   - backup theo từng tin;
   - Settings;
   - SSE;
   - e2e.
6. **Worker:** module `backups/` (store, scheduler, sender, reconciler, verifier, topics) và integration test với chat giả.
7. **Web:**
   - helper kind;
   - hộp thoại chọn chat Telegram;
   - wizard;
   - panel backup;
   - trang message;
   - Settings;
   - spec.
8. README, `.env.example`, rồi chạy toàn bộ Phase 4.

**Production trên máy này** vẫn chạy bản hiện tại trong suốt Phase 3–4. Test chạy trên DB test riêng, không động tới archive thật và không gửi gì lên Telegram.

**Tới Phase 5:**
- chạy `npm run prod:update` (build, migrate DB thật, restart từng app);
- migration chỉ thêm cột và bảng;
- công tắc backup mặc định **tắt**, nên không có gì chạy cho tới khi bạn chọn chat backup và bấm **Back up now**.

Commit chỉ khi bạn bảo.

# Phase 4: Test (bắt buộc, không làm hỏng test cũ)

- **shared:** schema và enum mới.
- **storage:** `locationConfig` với kind TELEGRAM; factory từ chối kind này.
- **database (integration):**
  - migration;
  - seeding không trùng khi chạy lại;
  - trigger `backups:`;
  - `db:check` sạch.
- **worker (integration, dùng fake Telegram ghi lại mọi lệnh gửi):**
  - chạy lần 1 gửi đủ, đúng thứ tự, album gửi thành một nhóm;
  - chạy lần 2 **không gửi gì**;
  - topic được tạo và dùng lại;
  - FloodWait không tính lượt thử;
  - lỗi giả lập → FAILED → Retry → COMPLETED;
  - **crash ngay sau khi gửi** → phục hồi bằng random_id / lịch sử, **không trùng**;
  - tin gốc mất → gửi từ bản Local, hoặc SKIPPED;
  - tin gốc bị protected → SKIPPED và tắt backup;
  - caption quá dài;
  - "Back up again" xoá bản cũ;
  - **không bao giờ gọi forward**: fake Telegram không có lệnh forward, và một test quét mã nguồn `packages/telegram` + `apps/worker` sẽ fail nếu xuất hiện `forwardMessages` hoặc `sendCopy`;
  - verify phát hiện tin mất, tin có forward header, sai cỡ.
- **api e2e:**
  - tạo, check, xoá nơi lưu Telegram (fake worker trả `result`);
  - PATCH bị từ chối khi sai kind hoặc tạo vòng lặp;
  - summary, retry, verify, `/messages/:id/backup`;
  - secret không bao giờ có trong DTO.
- **web specs:** danh sách nơi lưu 3 loại, hộp thoại Telegram, wizard, panel backup (live), trang message, Settings.
- **Chạy toàn bộ:** typecheck, lint, `test:coverage` (unit + integration), `test:e2e` (Playwright), build, `db:check`, `npm audit`.

# Phase 5: Test thật nhỏ (10–20 tin, không chạy cả 3.164 file)

**Cần bạn làm trong Telegram**
- Tạo một **supergroup private, bật Topics**, làm nơi backup.
- Tuỳ chọn nhưng nên có: một **channel private thử** do bạn đăng, gồm 1 tin chữ có định dạng, 1 ảnh, 1 video nhỏ, 1 document, 1 caption, 1 album 2–3 ảnh.
  - Group thật không có ảnh, và chỉ với channel của bạn mới thử được "xoá tin gốc → bản backup vẫn còn".

**Các bước**
1. Chọn chat backup. Trên group thật, bấm **Back up now** cho khoảng 12 tin: 1 album video, 2 video lẻ, 2 document, 3 tin chữ có định dạng, tin trong 2–3 topic khác nhau. Trên channel thử thì backup toàn bộ.
2. **Chạy lần 2** (Back up now lại, và bật/tắt công tắc): không tạo tin mới.
3. **Restart:** `pm2 stop tam-worker` giữa lúc upload một video, rồi start lại. Lượt đó chạy lại từ đầu và không trùng.
4. **Lỗi và phục hồi:**
   - Trên thật: xoá một topic backup đang dùng. Worker nhận `TOPIC_DELETED`, tạo lại topic rồi gửi tiếp.
   - FAILED → Retry → COMPLETED được kiểm bằng integration test (lỗi giả lập). Bạn là chủ chat backup nên không tự bỏ quyền của mình được. Muốn thấy FAILED thật thì cần một chat mà tài khoản chỉ là admin, và việc này tuỳ bạn.
5. **Xoá tin gốc** trong channel thử → bản backup vẫn mở và tải được. Sau đó chạy **Verify**.

**Báo cáo:** Total, Completed, Failed, Skipped, dung lượng đã upload, tốc độ trung bình, ổ đĩa tạm dùng (đo chỗ trống trước/trong/sau, dự kiến 0), RAM cao nhất của worker.

# Rủi ro

- **Thời gian:** backup toàn bộ 756 GiB mất khoảng 1,5–2,5 ngày. Chỉ bật công tắc cho cả group khi bạn muốn, sau Phase 5.
- **Băng thông chung:** backup và tải media dùng chung đường mạng và cooldown FloodWait. Upload bị FloodWait thì các vòng khác (thumbnail, sync) cũng chờ.
- **Upload không resume:** lỗi giữa chừng thì làm lại file từ đầu.
- **Giới hạn của Telegram:**
  - caption 1024 ký tự: gửi thêm tin chữ;
  - file 2000 MiB: không file nào vượt;
  - custom emoji cần Premium: bỏ entity đó, giữ chữ.
- **Ảnh bị Telegram nén lại khi upload,** nên Verify không so cỡ ảnh.
- **Crash đúng lúc gửi:** có random_id + đọc lịch sử để phục hồi. Trường hợp vẫn không chắc sẽ thành FAILED có ghi chú, không gửi mù.
- **Nhiều channel nguồn cùng dồn vào một forum:** tên topic được thêm tiền tố tên channel, để không trộn topic.

# Không làm

- Forward hay `sendCopy`.
- Tạo chat backup tự động (bạn tự tạo trong Telegram).
- Phát video trên web trực tiếp từ bản backup trên Telegram. Web vẫn phát từ Local/Drive, còn bản Telegram mở bằng link.
- Local + Drive cùng lúc.
- Resume upload dở dang.
- Dùng nhiều tài khoản Telegram.

# Điều chỉnh khi triển khai (từ vòng soát thiết kế)

Những điểm dưới đây thay hoặc bổ sung cho các mục ở trên.

**Nội dung và thứ tự**
1. **Chữ, caption và entities lấy từ database**, tức bản đầu tiên archive đã lưu, không lấy từ tin gốc hiện tại. Cách này khớp quy tắc "giữ bản gốc". Tin gốc chỉ dùng để kiểm tra protected, lấy file và thuộc tính file. Cần thêm hàm đổi entities JSON sang TL.
2. **Thứ tự:** không nhận lô của một channel đang có import chạy, chờ hoặc tạm dừng. Album chỉ gửi khi đã đủ thành viên: id lớn nhất nhỏ hơn head, hoặc thành viên mới nhất đã được lưu hơn 2 phút.

**Truyền file**

3. **Luồng nguồn:**
   - Dùng `downloadAsStream` của mtcute (có backpressure, highWaterMark 16 MiB) thay cho iterable.
   - Một watchdog chung, bỏ qua thời gian đang chờ FloodWait.
   - Đếm byte và tính SHA-256 trong lúc stream. Không khớp `media.size` thì không gửi.
4. **Album:**
   - Mỗi file upload xong thì gọi `uploadMedia` ngay và lưu `{id, accessHash, fileReference}` vào dòng của file đó.
   - Crash giữa album thì không phải upload lại các file đã xong.
   - `FILE_PART_n_MISSING` chỉ làm lại file n.
5. **Bản Local:** bọc stream bằng `Readable.from()`, luôn truyền `fileName`, kiểm tra cỡ (và checksum nếu có).

**Gửi và phục hồi**

6. **Gửi:**
   - Ở stage SENDING chỉ retry khi Telegram từ chối rõ ràng. Timeout, mất kết nối hay mất lease thì để reconciler xác minh.
   - Mỗi tin có `random_id` riêng. Album gọi raw `messages.sendMultiMedia`.
   - `RANDOM_ID_DUPLICATE` nghĩa là đã gửi.
7. **Phục hồi:**
   - Ghi lại những gì đã gửi: `sent_name`, `sent_size`, `sent_sha256`, hash của chữ.
   - Chỉ so khớp tin do chính tài khoản gửi, không có forward header, cùng grouped id và đủ số lượng. Ảnh so theo kích thước.
   - Không nhận lô mới cho một chat backup khi còn dòng ACTIVE.
   - Dòng chết là dòng khác owner và im lặng quá 2 × TTL của lease.
8. **Cooldown:**
   - FloodWait của phần upload/download không chặn việc đọc (sync, tải media, thumbnail).
   - Lệnh gửi phải chờ hơn 10 giây thì chỉ tạm ngưng backup (`unavailable_until`).
9. **Lỗi phía chat backup** được bọc riêng (`BackupTargetError`), để không bị nhầm thành lỗi của channel nguồn. Cách xử lý thêm:

   | Lỗi | Xử lý |
   |---|---|
   | `CHAT_WRITE_FORBIDDEN`, `CHAT_ADMIN_REQUIRED`, `CHAT_SEND_*_FORBIDDEN`, `USER_BANNED_IN_CHANNEL` | Tạm ngưng, cần bạn xem |
   | `PEER_FLOOD` | Tạm ngưng vài giờ |
   | `TOPIC_DELETED`, `TOPIC_CLOSED` | Tạo lại topic |
   | `MEDIA_CAPTION_TOO_LONG` | Tách phần chữ thành tin riêng |
   | `ENTITY_*` | Gửi lại không có entity |
   | `FILE_PART_n_MISSING` | Upload lại file n |
   | `RANDOM_ID_DUPLICATE` | Coi là đã gửi |

10. **Topic:** sau crash, dùng lại topic trùng tên do chính tài khoản tạo mà chưa có mapping, thay vì tạo trùng.

**Api và web**

11. **Api cứng hơn khi đã có nơi lưu TELEGRAM:**
    - Các chỗ phải sửa:
      - mapper không lỗi;
      - `remove()` không đưa TELEGRAM lên làm mặc định;
      - `update()` cấm `isDefault`;
      - `check()` không dựng driver;
      - `storageLocationId` của channel chỉ nhận LOCAL/GOOGLE_DRIVE;
      - `createFromDialog` từ chối chat đang là nơi backup.
    - `@tam/storage` giữ `StorageKind` gồm hai loại tải về, cộng guard `isDriverLocation()`.
    - Web: danh sách chọn nơi tải về bỏ TELEGRAM. Việc tự kiểm tra khi mở trang không gọi Telegram; dùng kết quả lần kiểm trước, còn nút **Check** mới gọi thật.
12. **Pause, tắt công tắc và "Back up again"** từ api chỉ lấy lại dòng đang ở UPLOADING. "Back up again" trên dòng ACTIVE trả 409.
13. **Xoá bản cũ khi "Back up again"** là tuỳ chọn trong hộp xác nhận, mặc định bật.
14. **Verify** chạy nền, như việc làm mới danh sách chat, và báo tiến độ qua `backups.changed`. Kiểm tra thêm: `file_unique_id` của bản backup khác bản gốc.

**Chi tiết nhỏ**

15. Gửi ở chế độ `silent`, không bắn hàng nghìn thông báo.
16. Tắt link preview, trừ tin WEBPAGE.
17. Document gửi dạng document.
18. Thumbnail chỉ dùng khi là JPEG, tối đa 200 KB và 320 px.
19. Khi làm mới danh sách chat thấy nguồn bị protected thì tắt cả backup.
20. Ghi tiến độ mỗi 2–5 giây.

**Rủi ro thêm**
- **Chống spam:** tài khoản thường upload 756 GiB có thể bị Telegram chặn tạm (`PEER_FLOOD`, `FLOOD_PREMIUM_WAIT`), khiến việc chạy kéo dài nhiều tuần hoặc tài khoản bị hạn chế. Sau Phase 5 nên bật dần, không bật cả group một lúc.
- **Thời hạn không có tài liệu:** Telegram không công bố một số thời hạn: phần file đã upload nhưng chưa gửi, file reference của file vừa upload, thời gian còn nhận ra random_id trùng. Đọc lịch sử chat backup là lưới an toàn cuối, nên **đừng tự đăng tin vào chat backup** khi backup đang chạy.
- **Phụ thuộc mtcute:** thiết kế dựa vào chi tiết của mtcute 0.32.2, nên giữ nguyên version và có test phủ.
