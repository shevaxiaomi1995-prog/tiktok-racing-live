# Мост TikTok LIVE — контракт событий

Игра отделена от источника событий TikTok. Браузерный клиент получает нормализованные JSON-события через WebSocket от `server/index.js`.

## HTTP endpoint

`POST http://АДРЕС_СЕРВЕРА:8787/api/events`

Заголовок: `Authorization: Bearer YOUR_EVENT_INGEST_TOKEN`

`Content-Type: application/json`

Поддерживаемые события:

```json
{"type":"chat","username":"viewer_name","message":"Старт"}
{"type":"like","username":"viewer_name","count":100}
{"type":"gift","username":"viewer_name","giftName":"Rose","targetUsername":"other_viewer"}
{"type":"live_start"}
{"type":"live_end"}
```

- `chat`: сообщение `Старт`, `start` или `!join` добавляет зрителя в текущую гонку.
- `like`: `count` — количество новых лайков от этого зрителя. Игра копит лайки отдельно для каждого участника и выдаёт бустер каждый раз, когда достигается настроенный порог.
- `gift`: `giftName` должен совпадать с названием подарка в панели ведущего. Для атак можно передать `targetUsername`; если цель не указана, эффект применяется к текущему лидеру.
- `live_start`: один раз при начале новой LIVE-сессии очищает таблицу побед.
- `live_end`: помечает текущую LIVE-сессию завершённой.

## Важно

В репозитории пока **нет готовой авторизации TikTok и получения реальных LIVE-событий**. Здесь есть только сервер-приёмник и формат обмена. Коннектор TikTok LIVE нужно добавить отдельно и проверить с учётом действующих правил TikTok и ограничений выбранной библиотеки. Не помещай `EVENT_INGEST_TOKEN` в код браузера.
