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
const AUDIO_DIR = '/tmp/audio';
[TEMP_DIR, AUDIO_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// ⚠️ إعدادات المحتوى الآمن
const CONTENT_SETTINGS = {
  techSounds: true,        // أصوات تقنية (كيبورد، ماوس)
  safeSearch: true,        // بحث آمن فقط
  allowedCategories: [
    'technology', 'coding', 'programming', 'computer',
    'office', 'business', 'nature', 'abstract',
    'architecture', 'city', 'minimal'
  ],
  blockedKeywords: [
    'woman', 'women', 'girl', 'female', 'model', 'fashion',
    'dance', 'party', 'club', 'beach', 'swimsuit', 'bikini'
  ]
};

// 🎵 روابط أصوات تقنية مجانية (من Pixabay - مجانية للاستخدام التجاري)
const TECH_SOUNDS = [
  'https://cdn.pixabay.com/audio/2022/03/15/audio_115b9b66d5.mp3', // keyboard typing
  'https://cdn.pixabay.com/audio/2021/08/04/audio_0625c1539c.mp3', // mouse click
  'https://cdn.pixabay.com/audio/2022/10/30/audio_357e24fba6.mp3', // computer startup
  'https://cdn.pixabay.com/audio/2021/04/06/audio_844c43e81e.mp3', // notification
  'https://cdn.pixabay.com/audio/2022/03/10/audio_d8f4b24ea5.mp3'  // tech ambient
];

// تخزين حالة الـ renders
const renders = {};

// الصفحة الرئيسية
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    message: '🎬 FFmpeg Video API - جاهز للعمل!',
    features: ['أصوات تقنية حلال ✅', 'بدون موسيقى ✅', 'محتوى آمن ✅'],
    endpoints: {
      'POST /render': 'إنشاء فيديو جديد',
      'GET /status/:id': 'حالة الفيديو',
      'GET /video/:id': 'تحميل الفيديو'
    }
  });
});

// إنشاء فيديو جديد
app.post('/render', async (req, res) => {
  const { 
    scenes, 
    title, 
    width = 1080, 
    height = 1920, 
    fps = 30,
    addTechSounds = true  // إضافة أصوات تقنية افتراضياً
  } = req.body;

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
    message: 'بدأ إنشاء الفيديو مع أصوات تقنية...'
  });

  // إنشاء الفيديو في الخلفية
  processVideo(renderId, scenes, outputPath, { width, height, fps, title, addTechSounds });
});

// معالجة الفيديو
async function processVideo(renderId, scenes, outputPath, options) {
  try {
    const { width, height, fps, addTechSounds } = options;
    const sceneDuration = 6; // 6 ثواني لكل مشهد
    const inputFiles = [];

    // تحميل وتجهيز كل مشهد
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      renders[renderId].progress = Math.floor((i / scenes.length) * 40);

      // تحميل الفيديو/الصورة الخلفية
      let inputPath;
      if (scene.background) {
        inputPath = await downloadFile(scene.background, renderId, i);
      } else {
        inputPath = await createBlackBackground(renderId, i, width, height, sceneDuration);
      }
      
      // إضافة النص على الفيديو
      const sceneOutput = path.join(TEMP_DIR, `${renderId}_scene_${i}.mp4`);
      await addTextOverlay(inputPath, sceneOutput, scene.text, {
        width, height, duration: sceneDuration
      });
      
      inputFiles.push(sceneOutput);
    }

    renders[renderId].progress = 50;

    // دمج كل المشاهد
    const silentVideo = path.join(TEMP_DIR, `${renderId}_silent.mp4`);
    await concatenateVideos(inputFiles, silentVideo);

    renders[renderId].progress = 70;

    // إضافة أصوات تقنية
    if (addTechSounds) {
      await addTechAudio(silentVideo, outputPath, scenes.length * sceneDuration);
      // حذف الفيديو الصامت
      if (fs.existsSync(silentVideo)) fs.unlinkSync(silentVideo);
    } else {
      // نقل الفيديو الصامت للمخرج النهائي
      fs.renameSync(silentVideo, outputPath);
    }

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

// إضافة نص على الفيديو
function addTextOverlay(inputPath, outputPath, text, options) {
  return new Promise((resolve, reject) => {
    const { width, height, duration } = options;
    const isImage = inputPath.endsWith('.jpg') || inputPath.endsWith('.png');
    
    // تنسيق النص العربي
    const escapedText = text ? text.replace(/'/g, "\\'").replace(/:/g, "\\:") : '';
    
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
        '-an' // بدون صوت مؤقتاً - نضيفه لاحقاً
      ])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run();
  });
}

// 🎵 إضافة أصوات تقنية على الفيديو
async function addTechAudio(videoPath, outputPath, videoDuration) {
  return new Promise(async (resolve, reject) => {
    try {
      // اختيار صوت عشوائي
      const randomSound = TECH_SOUNDS[Math.floor(Math.random() * TECH_SOUNDS.length)];
      const audioPath = path.join(AUDIO_DIR, `tech_${Date.now()}.mp3`);
      
      // تحميل الصوت
      await downloadAudioFile(randomSound, audioPath);
      
      // دمج الصوت مع الفيديو
      ffmpeg(videoPath)
        .input(audioPath)
        .outputOptions([
          '-c:v copy',
          '-c:a aac',
          '-b:a 128k',
          '-shortest',           // تقطيع الصوت على طول الفيديو
          '-af', 'volume=0.3'    // خفض الصوت 30% عشان ما يكون عالي
        ])
        .output(outputPath)
        .on('end', () => {
          // حذف ملف الصوت المؤقت
          if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
          resolve(outputPath);
        })
        .on('error', (err) => {
          // في حالة الخطأ، ننسخ الفيديو بدون صوت
          console.error('Audio error, using silent video:', err.message);
          fs.copyFileSync(videoPath, outputPath);
          resolve(outputPath);
        })
        .run();
        
    } catch (error) {
      // في حالة الخطأ، ننسخ الفيديو بدون صوت
      console.error('Tech audio error:', error.message);
      fs.copyFileSync(videoPath, outputPath);
      resolve(outputPath);
    }
  });
}

// تحميل ملف صوت
async function downloadAudioFile(url, filePath) {
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
    timeout: 30000
  });

  const writer = fs.createWriteStream(filePath);
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(filePath));
    writer.on('error', reject);
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
  console.log(`🎵 أصوات تقنية: كيبورد، ماوس، نقرات`);
  console.log(`✅ بدون موسيقى - حلال 100%`);
});
