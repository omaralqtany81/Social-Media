FROM node:18-slim

# تثبيت FFmpeg
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# إنشاء مجلد التطبيق
WORKDIR /app

# نسخ ملفات المشروع
COPY package*.json ./
RUN npm install

COPY . .

# تشغيل السيرفر
EXPOSE 3000
CMD ["npm", "start"]
