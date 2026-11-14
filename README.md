# 雾港来电 · 午夜频率

## 安装

使用 Node.js 22.12 或更新版本。

```sh
npm ci
```

## 本地启动

```sh
npm run dev
```

打开终端显示的本地地址。

## Docker 启动

```sh
docker compose up --build
```

打开 http://localhost:8086 。可通过 PORT 环境变量修改端口。

## 录音版本补丁

当录音或字幕需要修订时，不必覆盖旧声音。打开工作区底部的「版本补丁」，导入一份补丁 JSON 与对应的新音频，先预览迁移结果，再确认启用。

补丁格式（示例见 `public/patches/arrival-recut.json`）：

```json
{
  "id": "arrival-recut-2026-01",
  "name": "来电录音修订",
  "recordings": [
    {
      "id": "arrival-v2",
      "sceneId": "arrival",
      "replaces": "arrival-normal",
      "title": "迟到的来电",
      "version": "修订录音",
      "audio": "/audio/arrival-v2.wav",
      "duration": 26.332,
      "segments": [
        { "from": { "start": 0, "end": 10 }, "to": { "start": 0, "end": 10 } },
        { "from": { "start": 10, "end": 13 } },
        { "from": { "start": 14.39, "end": 19.459 },
          "to": { "start": 11.39, "end": 16.459 }, "changed": true }
      ],
      "cues": [ ... 新字幕，含 sound 声窗 ... ]
    }
  ]
}
```

- `segments` 必须首尾相接、完整覆盖旧录音。保留片段的新旧长度必须一致；
  `changed: true` 表示这段内容被重新录制，片内秒数无法按偏移换算；不提供
  `to` 表示该片段已删除。
- 只有能一一对应的笔记、已听范围与继续播放位置才会迁移。跨越删除/重录/
  插入内容的部分保留旧源并标记「待处理」，不会猜测新秒数。
- 任一映射无效、缺少音频或音频无法加载时，整次启用取消。
- 原版录音不会被覆盖，场景标题处可随时切回原版回听。
- 启用后，已收集正式线索会在新录音中重新核对声窗；找不到时在
  右上角线索栏标记，需重新核对。
- 存档导出时会把补丁音频一并内联，导入后仍保留补丁与迁移依据。
