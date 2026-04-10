const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// مجلد مؤقت للفيديوهات
const TEMP_DIR = '/tmp/videos';
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// ⚠️ إعدادات المحتوى الآمن
const CONTENT_SETTINGS = {
  noAudio: true,           // بدون أي صوت أو موسيقى
  safeSearch: true,        // بحث آمن فقط
  allowedCategories: [     // الفئات المسموحة للفيديوهات
    'technology', 'coding', 'programming', 'computer',
    'office', 'business', 'nature', 'abstract',
    'architecture', 'city', 'minimal'
  ],
  blockedKeywords: [       // كلمات محظورة في البحث
    'woman', 'women', 'girl', 'female', 'model', 'fashion',
    'dance', 'party', 'club', 'beach', 'swimsuit', 'bikini'
  ]
};

// فلترة كلمات البحث
function filterSearchQuery(query) {
  let safeQuery = query.toLowerCase();
  CONTENT_SETTINGS.blockedKeywords.forEach(word => {
    safeQuery = safeQuery.replace(new RegExp(word, 'gi'), '');
  });
  // إضافة كلمات آمنة
  return `${safeQuery} technology coding minimal`.trim();
}

// تخزين حالة الـ renders
const renders = {};

// الصفحة الرئيسية
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    message: '🎬 FFmpeg Video API - جاهز للعمل!',
    endpoints: {
      'POST /render': 'إنشاء فيديو جديد',
      'GET /status/:id': 'حالة الفيديو',
      'GET /video/:id': 'تحميل الفيديو'
    }
  });
});

// إنشاء فيديو جديد
app.post('/render', async (req, res) => {
  const { scenes, title, width = 1080, height = 1920, fps = 30 } = req.body;

  if (!scenes || !Array.isArray(scenes) || scenes.length === 0) {
    return res.status(400).json({ error: 'يجب إرسال مصفوفة scenes' });
  }

  const renderId = uuidv4();
  const outputPath = path.join(TEMP_DIR, `${renderId}.mp4`);

  renders[renderId] = {
    id: renderId,
    status: 'processing',
    progress: 0,
    url: null,
    error: null,
    createdAt: new Date().toISOString()
  };

  res.json({
    id: renderId,
    status: 'processing',
    message: 'بدأ إنشاء الفيديو...'
  });

  // إنشاء الفيديو في الخلفية
  processVideo(renderId, scenes, outputPath, { width, height, fps, title });
});

// معالجة الفيديو
async function processVideo(renderId, scenes, outputPath, options) {
  try {
    const { width, height, fps } = options;
    const sceneDuration = 6; // 6 ثواني لكل مشهد
    const inputFiles = [];

    // تحميل وتجهيز كل مشهد
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      renders[renderId].progress = Math.floor((i / scenes.length) * 50);

      // تحميل الفيديو/الصورة الخلفية
      let inputPath;
      if (scene.background) {
        inputPath = await downloadFile(scene.background, renderId, i);
      } else {
        // إنشاء خلفية سوداء إذا ما فيه صورة
        inputPath = await createBlackBackground(renderId, i, width, height, sceneDuration);
      }
      
      // إضافة النص على الفيديو
      const sceneOutput = path.join(TEMP_DIR, `${renderId}_scene_${i}.mp4`);
      await addTextOverlay(inputPath, sceneOutput, scene.text, {
        width, height, duration: sceneDuration
      });
      
      inputFiles.push(sceneOutput);
    }

    renders[renderId].progress = 70;

    // دمج كل المشاهد
    await concatenateVideos(inputFiles, outputPath);

    renders[renderId].progress = 100;
    renders[renderId].status = 'completed';
    renders[renderId].url = `/video/${renderId}`;

    // تنظيف الملفات المؤقتة
    inputFiles.forEach(f => fs.existsSync(f) && fs.unlinkSync(f));

  } catch (error) {
    console.error('Error processing video:', error);
    renders[renderId].status = 'failed';
    renders[renderId].error = error.message;
  }
}

// تحميل ملف من URL
async function downloadFile(url, renderId, index) {
  const ext = url.includes('.mp4') ? '.mp4' : '.jpg';
  const filePath = path.join(TEMP_DIR, `${renderId}_input_${index}${ext}`);
  
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream'
  });

  const writer = fs.createWriteStream(filePath);
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(filePath));
    writer.on('error', reject);
  });
}

// إنشاء خلفية سوداء
function createBlackBackground(renderId, index, width, height, duration) {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(TEMP_DIR, `${renderId}_black_${index}.mp4`);
    
    ffmpeg()
      .input(`color=c=black:s=${width}x${height}:d=${duration}`)
      .inputFormat('lavfi')
      .outputOptions(['-c:v libx264', '-pix_fmt yuv420p'])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run();
  });
}

// إضافة نص على الفيديو - بدون أي صوت
function addTextOverlay(inputPath, outputPath, text, options) {
  return new Promise((resolve, reject) => {
    const { width, height, duration } = options;
    const isImage = inputPath.endsWith('.jpg') || inputPath.endsWith('.png');
    
    // تنسيق النص العربي
    const escapedText = text.replace(/'/g, "\\'").replace(/:/g, "\\:");
    
    let command = ffmpeg(inputPath);
    
    if (isImage) {
      command = command.loop(duration).inputOptions(['-t', duration]);
    }
    
    command
      .videoFilters([
        `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
        `drawtext=text='${escapedText}':fontsize=60:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:borderw=3:bordercolor=black`
      ])
      .outputOptions([
        '-c:v libx264',
        '-pix_fmt yuv420p',
        '-t', duration,
        '-an' // ⚠️ بدون صوت نهائياً - مهم جداً
      ])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run();
  });
}

// دمج الفيديوهات
function concatenateVideos(inputFiles, outputPath) {
  return new Promise((resolve, reject) => {
    const listPath = path.join(TEMP_DIR, `concat_${Date.now()}.txt`);
    const listContent = inputFiles.map(f => `file '${f}'`).join('\n');
    fs.writeFileSync(listPath, listContent);

    ffmpeg()
      .input(listPath)
      .inputOptions(['-f concat', '-safe 0'])
      .outputOptions(['-c copy'])
      .output(outputPath)
      .on('end', () => {
        fs.unlinkSync(listPath);
        resolve(outputPath);
      })
      .on('error', reject)
      .run();
  });
}

// حالة الفيديو
app.get('/status/:id', (req, res) => {
  const render = renders[req.params.id];
  if (!render) {
    return res.status(404).json({ error: 'الفيديو غير موجود' });
  }
  res.json(render);
});

// تحميل الفيديو
app.get('/video/:id', (req, res) => {
  const videoPath = path.join(TEMP_DIR, `${req.params.id}.mp4`);
  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'الفيديو غير موجود' });
  }
  res.sendFile(videoPath);
});

// تشغيل السيرفر
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🎬 FFmpeg Video API running on port ${PORT}`);
});
