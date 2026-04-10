# 🎬 FFmpeg Video API

API بسيط لإنشاء فيديوهات بـ FFmpeg - للربط مع n8n

## الـ Endpoints

### `POST /render`
إنشاء فيديو جديد

**Body:**
```json
{
  "title": "عنوان الفيديو",
  "scenes": [
    {
      "text": "النص اللي يظهر على الشاشة",
      "background": "https://example.com/video.mp4"
    }
  ],
  "width": 1080,
  "height": 1920,
  "fps": 30
}
```

**Response:**
```json
{
  "id": "uuid-here",
  "status": "processing"
}
```

### `GET /status/:id`
التحقق من حالة الفيديو

### `GET /video/:id`
تحميل الفيديو النهائي

## Deploy على Railway

1. Fork هذا الـ Repo
2. في Railway: New Project → Deploy from GitHub
3. اختر الـ Repo
4. انتظر الـ Deploy
5. انسخ الـ URL واستخدمه في n8n

## الاستخدام مع n8n

في HTTP Request Node:
- **Method:** POST
- **URL:** `https://your-railway-url.railway.app/render`
- **Body:** JSON مع scenes array
