import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import stream from 'stream';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const archiver = require('archiver');

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.post('/api/download-zip', async (req, res) => {
  try {
    let files = req.body.files;
    if (req.body.payload) {
        files = JSON.parse(req.body.payload).files;
    }
    
    if (!files || !Array.isArray(files)) {
      return res.status(400).send('Array of files [{url, filename}] is required');
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="batch_results.zip"');

    const archive = archiver('zip', {
      zlib: { level: 0 } // no compression for speed, images are already compressed
    });

    archive.on('error', (err) => {
      console.error('Archiver error:', err);
    });

    archive.pipe(res);

    for (const file of files) {
      if (!file.url || !file.filename) continue;
      
      try {
        if (file.url.startsWith('data:')) {
           const base64Data = file.url.split(',')[1];
           const buffer = Buffer.from(base64Data, 'base64');
           archive.append(buffer, { name: file.filename });
        } else {
           const response = await fetch(file.url);
           if (response.ok) {
             const arrayBuffer = await response.arrayBuffer();
             archive.append(Buffer.from(arrayBuffer), { name: file.filename });
           } else {
               console.warn(`Failed to fetch ${file.url} for zip`);
           }
        }
      } catch (err) {
        console.warn(`Error appending file ${file.filename}:`, err);
      }
    }

    await archive.finalize();
  } catch (error) {
    console.error('Download ZIP Error:', error);
    if (!res.headersSent) {
      res.status(500).send(String(error));
    }
  }
});

function signLovartRequest(method: string, apiPath: string, accessKey: string, secretKey: string) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const payload = `${method.toUpperCase()}\n${apiPath}\n${ts}`;
  const sig = crypto.createHmac('sha256', secretKey).update(payload).digest('hex');
  return {
    'X-Access-Key': accessKey,
    'X-Timestamp': ts,
    'X-Signature': sig,
    'X-Signed-Method': method.toUpperCase(),
    'X-Signed-Path': apiPath,
  };
}

app.post('/api/lovart/upload', async (req, res) => {
  try {
    const { accessKey, secretKey, base64Image, filename } = req.body;
    const apiHost = 'https://lgw.lovart.ai';
    const path = '/v1/openapi/file/upload';
    
    const sigHeaders = signLovartRequest('POST', path, accessKey, secretKey);
    
    const buffer = Buffer.from(base64Image.split('base64,')[1] || base64Image, 'base64');
    
    const formData = new FormData();
    const blob = new Blob([buffer], { type: 'image/png' });
    formData.append('file', blob, filename || 'image.png');

    const response = await fetch(apiHost + path, {
      method: 'POST',
      headers: {
        ...sigHeaders,
        'User-Agent': 'LovartAgentWrapper/1.0'
      },
      body: formData as any,
    });

    const data = await response.json();
    if (data.code !== 0) throw new Error(`Upload API error (Code: ${data.code}): ${data.message || JSON.stringify(data)}`);
    
    res.json({ url: data.data.url });
  } catch (error: any) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/lovart/project', async (req, res) => {
  try {
    const { accessKey, secretKey, projectName } = req.body;
    const apiHost = 'https://lgw.lovart.ai';
    const path = '/v1/openapi/project/save';
    const sigHeaders = signLovartRequest('POST', path, accessKey, secretKey);
    
    const response = await fetch(apiHost + path, {
      method: 'POST',
      headers: {
        ...sigHeaders,
        'Content-Type': 'application/json',
        'User-Agent': 'LovartAgentWrapper/1.0'
      },
      body: JSON.stringify({
        project_id: "",
        canvas: "",
        project_cover_list: [],
        pic_count: 0,
        project_type: 3,
        project_name: projectName || "Batch Images"
      }),
    });

    const data = await response.json();
    if (data.code !== 0) throw new Error(`Project API error (Code: ${data.code}): ${data.message || JSON.stringify(data)}`);
    res.json({ projectId: data.data.project_id });
  } catch (error: any) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/lovart/chat', async (req, res) => {
  try {
    const { accessKey, secretKey, projectId, prompt, attachments, mode, tool_config } = req.body;
    const apiHost = 'https://lgw.lovart.ai';
    const path = '/v1/openapi/chat';
    const sigHeaders = signLovartRequest('POST', path, accessKey, secretKey);
    
    const payload: any = { prompt, project_id: projectId };
    if (attachments && attachments.length > 0) {
      payload.attachments = attachments;
    }
    if (mode) {
      payload.mode = mode;
    }
    if (tool_config) {
      payload.tool_config = tool_config;
    }

    const response = await fetch(apiHost + path, {
      method: 'POST',
      headers: {
        ...sigHeaders,
        'Content-Type': 'application/json',
        'User-Agent': 'LovartAgentWrapper/1.0'
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 429) {
       const retryAfter = response.headers.get('Retry-After');
       if (retryAfter) res.set('Retry-After', retryAfter);
       return res.status(429).json({ error: 'Too Many Requests' });
    } else if (response.status === 409) {
       return res.status(409).json({ error: 'Conflict' });
    }

    const data = await response.json();
    if (data.code === 2012) {
       return res.status(409).json({ error: 'Concurrent task limit reached (Code: 2012)' });
    }
    if (data.code !== 0) throw new Error(`Chat API error (Code: ${data.code}): ${data.message || JSON.stringify(data)}`);
    res.json({ threadId: data.data.thread_id });
  } catch (error: any) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/lovart/result', async (req, res) => {
  try {
    const { accessKey, secretKey, threadId } = req.body;
    const apiHost = 'https://lgw.lovart.ai';
    const path = '/v1/openapi/chat/result';
    const queryStr = `?thread_id=${encodeURIComponent(threadId)}`;
    const sigHeaders = signLovartRequest('GET', path, accessKey, secretKey);
    
    const response = await fetch(apiHost + path + queryStr, {
      method: 'GET',
      headers: {
        ...sigHeaders,
        'Content-Type': 'application/json',
        'User-Agent': 'LovartAgentWrapper/1.0'
      }
    });

    if (response.status === 429) {
       return res.status(429).json({ error: 'Too Many Requests' });
    }

    const data = await response.json();
    if (data.code !== 0) {
      throw new Error(`Result API error (Code: ${data.code}): ${data.message || JSON.stringify(data)}`);
    }
    res.json({ data: data.data });
  } catch (error: any) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/lovart/status', async (req, res) => {
  try {
    const { accessKey, secretKey, threadId } = req.body;
    const apiHost = 'https://lgw.lovart.ai';
    const path = '/v1/openapi/chat/status';
    const queryStr = `?thread_id=${encodeURIComponent(threadId)}`;
    const sigHeaders = signLovartRequest('GET', path, accessKey, secretKey);
    
    const response = await fetch(apiHost + path + queryStr, {
      method: 'GET',
      headers: {
        ...sigHeaders,
        'Content-Type': 'application/json',
        'User-Agent': 'LovartAgentWrapper/1.0'
      }
    });

    if (response.status === 429) {
       return res.status(429).json({ error: 'Too Many Requests' });
    }

    const data = await response.json();
    if (data.code !== 0) {
      throw new Error(`Status API error (Code: ${data.code}): ${data.message || JSON.stringify(data)}`);
    }
    res.json({ status: data.data.status });
  } catch (error: any) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/lovart/set-mode', async (req, res) => {
  try {
    const { accessKey, secretKey, unlimited } = req.body;
    const apiHost = 'https://lgw.lovart.ai';
    const path = '/v1/openapi/mode/set';
    const sigHeaders = signLovartRequest('POST', path, accessKey, secretKey);
    
    const response = await fetch(apiHost + path, {
      method: 'POST',
      headers: {
        ...sigHeaders,
        'Content-Type': 'application/json',
        'User-Agent': 'LovartAgentWrapper/1.0'
      },
      body: JSON.stringify({ unlimited }),
    });

    const data = await response.json();
    if (data.code !== 0) throw new Error(data.message || 'Set mode failed');
    res.json({ success: true, data: data.data });
  } catch (error: any) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/proxy-download', async (req, res) => {
  try {
    const { url } = req.body;
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch image' });
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    
    res.json({ base64: buffer.toString('base64'), contentType });
  } catch (error) {
    console.error('Download Proxy Error:', error);
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/download-file', async (req, res) => {
  try {
    const { url, filename } = req.query;
    if (!url || typeof url !== 'string') {
      return res.status(400).send('URL is required');
    }
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(response.status).send('Failed to fetch image');
    }
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const safeFilename = typeof filename === 'string' ? filename : 'downloaded_image.png';
    const encodedFilename = encodeURIComponent(safeFilename)
      .replace(/'/g, '%27')
      .replace(/\(/g, '%28')
      .replace(/\)/g, '%29')
      .replace(/\*/g, '%2A');

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', buffer.length.toString());
    
    // Provide general ASCII fallback filename for clients/proxies that don't support UTF-8 filename*
    const asciiFallback = safeFilename.replace(/[^\x20-\x7E]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`);
    
    res.send(buffer);
  } catch (error) {
    console.error('Download File Proxy Error:', error);
    res.status(500).send(String(error));
  }
});

app.get('/api/proxy-image', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url || typeof url !== 'string') {
      return res.status(400).send('URL is required');
    }
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(response.status).send('Failed to fetch image');
    }
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    const arrayBuffer = await response.arrayBuffer();
    res.end(Buffer.from(arrayBuffer));
  } catch (error) {
    console.error('Image Proxy Error:', error);
    res.status(500).send(String(error));
  }
});

// ==== CONSISTENCY AUDIT FEATURE ====

const TASKS_FILE_PATH = path.join(process.cwd(), 'tasks_store.json');
const auditStatusStore = new Map<string, {
  status: 'pending' | 'running' | 'success' | 'error';
  result?: any;
  error?: string;
  timestamp: number;
}>();

async function getBase64Image(url: string | undefined): Promise<string> {
  if (!url) return '';
  if (url.startsWith('data:')) {
    return url;
  }
  try {
    let absoluteUrl = url;
    if (url.startsWith('/')) {
      absoluteUrl = `http://127.0.0.1:3000${url}`;
    }
    const res = await fetch(absoluteUrl);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const contentType = res.headers.get('content-type') || 'image/png';
    const buffer = await res.arrayBuffer();
    return `data:${contentType};base64,${Buffer.from(buffer).toString('base64')}`;
  } catch (err: any) {
    console.error(`Error in getBase64Image for ${url}:`, err.message);
    return url;
  }
}

async function runAuditBackground(
  taskId: string, 
  referenceImage: string, 
  resultUrl: string, 
  category: string,
  userApiKey?: string,
  userBaseUrl?: string,
  userModel?: string,
  options?: {
    passThreshold?: number;
    rejectOnText?: boolean;
    rejectOnStructure?: boolean;
    rejectOnPattern?: boolean;
  }
) {
  try {
    console.log(`Starting background audit for task ${taskId} (Category: ${category})`);
    
    // Convert both images to base64
    const base64Ref = await getBase64Image(referenceImage);
    const base64Res = await getBase64Image(resultUrl);

    if (!base64Ref || !base64Res) {
      throw new Error('Reference image or generated image is empty or invalid');
    }

    let apiKey = (userApiKey || process.env.OPENROUTER_API_KEY || '').trim();
    if (apiKey.startsWith('"') && apiKey.endsWith('"')) {
      apiKey = apiKey.slice(1, -1).trim();
    }
    if (apiKey.startsWith("'") && apiKey.endsWith("'")) {
      apiKey = apiKey.slice(1, -1).trim();
    }
    if (!apiKey) {
      // User must provide key
    }

    let model = (userModel || process.env.OPENROUTER_MODEL || '').trim();
    if (model.startsWith('"') && model.endsWith('"')) {
      model = model.slice(1, -1).trim();
    }
    if (model.startsWith("'") && model.endsWith("'")) {
      model = model.slice(1, -1).trim();
    }
    if (!model) {
      model = 'xiaomi/mimo-v2.5';
    }

    let openRouterUrl = (userBaseUrl || process.env.OPENROUTER_BASE_URL || '').trim();
    if (openRouterUrl.startsWith('"') && openRouterUrl.endsWith('"')) {
      openRouterUrl = openRouterUrl.slice(1, -1).trim();
    }
    if (openRouterUrl.startsWith("'") && openRouterUrl.endsWith("'")) {
      openRouterUrl = openRouterUrl.slice(1, -1).trim();
    }
    if (!openRouterUrl) {
      openRouterUrl = 'https://openrouter.ai/api/v1/chat/completions';
    }

    // Standardize URL:
    if (openRouterUrl.endsWith('/')) {
      openRouterUrl = openRouterUrl.slice(0, -1);
    }
    if (!openRouterUrl.endsWith('/chat/completions')) {
      if (openRouterUrl.endsWith('/v1')) {
        openRouterUrl = openRouterUrl + '/chat/completions';
      } else {
        openRouterUrl = openRouterUrl + '/v1/chat/completions';
      }
    }

    // Auto-correction of MIMO models for OpenRouter:
    if (openRouterUrl.includes('openrouter.ai')) {
      const normalizedModel = model.toLowerCase();
      if (normalizedModel.includes('mimo-v2.5-pro') || normalizedModel.includes('mimo-v2.5') || normalizedModel.includes('mimo-v2-flash') || normalizedModel.includes('mimo-2.5')) {
        console.log(`[AutoCorrect] Model ${model} mapped to xiaomi/mimo-v2.5 on OpenRouter for vision audit capability.`);
        model = 'xiaomi/mimo-v2.5';
      } else if (!model.includes('/')) {
        model = 'xiaomi/' + model;
      }
    }

    const isMimoOfficial = openRouterUrl.includes('xiaomimimo.com') || (model === 'mimo-v2.5' && !openRouterUrl.includes('openrouter.ai'));

    if (!apiKey) {
      throw new Error("MIMO API Key is not configured. Please enter your valid API key in Settings.");
    }

    if (isMimoOfficial) {
      if (openRouterUrl.includes('openrouter.ai')) {
        console.log(`[AutoDetect] Re-routing to official Xiaomi MIMO endpoint for model ${model}`);
        openRouterUrl = 'https://api.xiaomimimo.com/v1/chat/completions';
      }
    } else if (apiKey.startsWith('sk-') && !apiKey.startsWith('sk-or-') && openRouterUrl.includes('openrouter.ai') && !userBaseUrl) {
      console.log(`[AutoDetect] Re-routing SiliconFlow key to api.siliconflow.cn`);
      openRouterUrl = 'https://api.siliconflow.cn/v1/chat/completions';
      if (model === 'xiaomi/mimo-v2.5' || model === 'xiaomi/mimo-v2.5-pro' || model === 'vendor/xiaomi/mimo-preview') {
        model = 'vendor/xiaomi/mimo-preview';
      }
    }

    const passThreshold = options?.passThreshold ?? 85;
    const rejectOnText = options?.rejectOnText !== false;
    const rejectOnStructure = options?.rejectOnStructure !== false;
    const rejectOnPattern = options?.rejectOnPattern !== false;

    const categoryPrompts: Record<string, string> = {
      shoes: `
结构得分（Structure Score，总权40分）：
评估鞋型轮廓（如高帮/低帮等鞋款高度形态）、鞋底结构、面料与材质拼接线条等细节的一致性。
${rejectOnStructure ? '任何严重的物理款式差异、版型拼缝不对，触发一票否决(Reject)。' : '若仅仅是由于透视相机视角、海报特写创意导致Swoosh、品牌Logo、鞋底线条在平面坐标存在轻微偏倚、变少或移动，但在物理上鞋款、鞋底和版型一致时，请不要直接判定一票否决，作正常缺陷扣减1-3分即可。'}

颜色得分（Color Score，总权25分）：
比对“标准图（图一）”与“生成图（图二）”的主色、辅色及局部色块分布。
允许因光照和立体效果带来的 ±10%~15% 色相/亮度偏差。

图案得分（Pattern Score，总权25分）：
评估鞋面、侧身等处的花纹、条纹、特殊印花位置与形状（是否变形、突兀、存在多余修饰等）。
${rejectOnPattern ? '任何品牌核心图案、大块刺绣、印花缺失，将直接判定 Reject。' : '装饰图案、侧条纹在海报构图中若有少许美化偏倚但无大异，作扣分项（每次扣减1-2分），不要直接一票否决。'}

文字/标识得分（Text Score，总权5分，极低权重）：
检测鞋身及包装上的英文、中文字符及标识。
检查其拼写是否正确、字体形态是否因 AI 生成而产生乱码、畸变或严重残缺。
${rejectOnText ? '任何明显拼写错误或乱码字母、以及文字残畸 >= 2 处，直接判定 Reject。' : 'AI生成极小的说明贴纸、鞋舌英文字标等在海报图上自然产生少许AI残缺、不清晰或软畸变属于业内生图正常物理现象（非伪冒错误），请务必放宽该项一票否决，不作为 Reject 判定，作为轻微缺陷在10分内扣除1-2分即可。'}

光影干扰（Lighting/Noise Score，总权5分，权重降低）：
分析强光影、高光、深色硬投影、烟雾等特效对鞋子关键结构形态和文字的遮挡及干扰。
不直接判为物理错误，仅会影响置信度与环境融合美感。
      `,
      apparel: `
结构得分（Structure Score，总权40分）：
评估服装款式轮廓（如圆领/V领/卫衣/夹克等剪裁轮廓）、领口、袖口、拉链缝合处、面料纹理及版型的一致性。
${rejectOnStructure ? '版型、款式拼缝大异、袖长严重不合等，触发“直接一票否决(Reject)”判定。' : '如若领口、拉链细排线位置由于模特穿着起伏有轻微偏离或由于风摆造成袖口视觉偏差，款式物理并无大异，请宽大处理，不作为结构一票否决，作为扣分项。'}

颜色得分（Color Score，总权25分）：
比对“标准图（图一）”与“生成图（图二）”的主色调与局部拼接布料块色泽分布。
允许由于面料起伏褶理及高动态光照影响的 10%-15% 的漫反射色相/包围光亮度变化。

图案得分（Pattern Score，总权25分）：
比提示服装印花、刺绣图形的位置、尺寸、图案完整度（如胸前、袖部或背后的大底大片印花图形）。
${rejectOnPattern ? '任何核心图案缺失或不连续性碎裂变形，直接判定 Reject。' : '若是大底花纹由于透视或折叠略微轻偏，不要作为一票否决，列入扣分评估。'}

文字/标识得分（Text Score，总权5分，极低权重）：
检测衣服印花文字或品牌标签上的字符、英文字母及符号拼写。
${rejectOnText ? '任何标识文字拼写错误、或者文字图形畸变 >= 2 处，直接判定 Reject。' : '衣服边缘极小织标或水洗标微小字符，如果因AI生成有些许笔画微畸、不辨拼音，属于海报常态（并非抄袭伪造），绝对不直接判定 Reject，作细节瑕疵扣减1-2分即可。'}

光影干扰（Lighting/Noise Score，总权5分，权重降低）：
评估由于衣物褶皱、风吹摆动、烟雾和背景逆光造成的局部图案变形或关键细节遮蔽干扰。
不作为直接物理不合的依据，但会降低视觉读取可信度和整体融洽评分。
      `,
      accessories: `
结构得分（Structure Score，总权40分）：
评估配饰（如包包形状、帽子款式、眼镜框体、表盘、腰带等）的整体几何外廓和五金扣件、卡扣、提手提带、缝线等做工拼接结构。
${rejectOnStructure ? '关键结构缺漏或形体严重畸变歪斜，触发“直接一票否决(Reject)”判定。' : '五金卡扣或缝合边缘、皮带孔如果有几毫米工艺偏倚，主体款式一致，不要直接判定一票否决，作扣分处理。'}

颜色得分（Color Score，总权25分）：
比对整体材质表面色彩, 包含高亮或磨砂皮革色泽，同时比对金属五金配件颜色（如金色/银色的一致性）。
允许少许由于反光或滤镜导致的色差。

图案得分（Pattern Score，总权25分）：
评估配饰表面的雕花、走针排线、Monogram品牌压花、编织纹路对齐度和连续完好形态。
${rejectOnPattern ? '核心花纹大块断档、破损缺失，直接判定 Reject。' : '压纹拼接位置微偏差不要直接一票否决。'}

文字/标识得分（Text Score，总权5分，极低权重）：
检测五金表面微雕品牌刻字、纸边吊牌、内衬织标或表壳外圈字符等精细文字。
${rejectOnText ? '拼写差错、无意义的乱码拼音、变形字母累计达到 >= 2 处，直接判定 Reject。' : '工艺微雕文字或织标英方等AI微畸，属于生图正常瑕疵，不作为直接 Reject 判定，列为扣分项扣1分。'}

光影干扰（Lighting/Noise Score，总权5分，权重降低）：
评估金属配件在广告海报背景下过度的高反光、拉丝折射，或由于阴影死角导致的结构边缘模糊等。
影响辨识遮挡置信度。
      `,
      apparel_and_accessories: `
结构得分（Structure Score，总权40分）：
评估服装或配件款式轮廓（如领口、袖口、包包形状、五金件等）及缝合细节的一致性。
${rejectOnStructure ? '结构、版型缺失或严重畸变，触发“直接一票否决(Reject)”判定。' : '由于透视角度或由于穿着导致的局部轻微偏离，物理结构无大异时，作扣分项，不直接一票否决。'}

颜色得分（Color Score，总权25分）：
比对图一与图二的主色调与局部细节色泽（包含面料与五金颜色）的一致性。允许因光照带来的轻微色差。

图案得分（Pattern Score，总权25分）：
比对印花、刺绣、老花图案的位置、连续性和完整度。
${rejectOnPattern ? '核心图案缺失或断档变形，直接判定 Reject。' : '局部细微折叠花纹形变，作为扣分项。'}

文字/标识得分（Text Score，总权5分，极低权重）：
检测标签、织标、五金微雕上的文字拼写。
${rejectOnText ? '拼写明显错误或乱码 >= 2 处，直接判定 Reject。' : '由于AI产生的微小字符软畸变，不判定直接 Reject，扣减1-2分即可。'}

光影干扰（Lighting/Noise Score，总权5分，权重降低）：
评估由于光照、阴影、遮挡带来的识别困难，不作为直接不合格依据，影响视觉评分。
      `,
      sets: `
结构得分（Structure Score，总权40分）：
评估套装整体的上下装、内外搭组合款式，以及各配件相互比例和版型的一致性。
${rejectOnStructure ? '套装部件缺失、严重错版，触发“直接一票否决(Reject)”判定。' : '由于模特姿势导致的局部折叠或视觉重叠，未导致物理版型错误时，不判定直接 Reject。'}

颜色得分（Color Score，总权25分）：
评估套装上下身或各部件的主辅色对应关系，以及整体统调一致性。允许环境光和阴影带来的轻微色偏。

图案得分（Pattern Score，总权25分）：
检测套装上各处的花纹图案、拼接走向及连续性。
${rejectOnPattern ? '核心花纹或图案关键部分丢失/大面积变形，直接判定 Reject。' : '非核心花边、走线纹理略偏，作扣分处理。'}

文字/标识得分（Text Score，总权5分，极低权重）：
检测衣服品牌标签或标识上的字符、英文字母及符号拼写。
${rejectOnText ? '任何明显拼写错误或乱码、残畸 >= 2 处，直接判定 Reject。' : '极小织标字符不辨拼音，属于海报常态，不直接判定 Reject。'}

光影干扰（Lighting/Noise Score，总权5分，权重降低）：
评估套装之间的内部阴影遮挡对结构展示的影响，不作为直接 Reject 依据。
      `
    };

    const categoryTitle: Record<string, string> = {
      shoes: '鞋款',
      apparel: '服装',
      accessories: '配饰',
      apparel_and_accessories: '服装和配件',
      sets: '套装'
    };
    const title = categoryTitle[category] || '鞋服配通配';

    let criticalRejectPrompts = '';
    if (rejectOnStructure) {
      criticalRejectPrompts += '1. 结构不一致：若产品的物理版型主要外轮廓与标准参考物具有硬性款式大错、结构缺失，则必须判定一票否决（"pass": false）。\n';
    } else {
      criticalRejectPrompts += '1. 结构不一致宽大判定：由于透视镜头、创意海报或者不同硬投影引起的 Logo/Swoosh 局部少量错位偏离，在主体款式和鞋服物理框架无变时，切不可大惊小怪，不要进行一票否决直接 Reject 打回，请在瑕疵检测扣分后（只扣1-3分），允许高分 PASS。\n';
    }
    
    if (rejectOnText) {
      criticalRejectPrompts += '2. 文字拼写错误、出现明显的乱码和杂乱 AI 字母拼读 >= 2 处，则判定一票否决（"pass": false）。\n';
    } else {
      criticalRejectPrompts += '2. 细节和鞋舌文字畸变宽大判定：AI在细小字母（如鞋舌微字、衣服尾巴织标、刺绣标签等非主体超大标题字）常有轻微模糊或者AI无义重合，这属于海报生成行业可接受的正常效果。请高抬贵手，不得判定一票否决直接 Reject 打回。对此仅列为问题，并扣除1-2分即可，要允许该等情况下能 PASS。\n';
    }

    if (rejectOnPattern) {
      criticalRejectPrompts += '3. 核心装饰图案/品牌核心印花基本块丢失（标准款极具特性的核心花样完全没生出来），则判定一票否决（"pass": false）。\n';
    } else {
      criticalRejectPrompts += '3. 装饰花纹偏差不作为一票否决。\n';
    }
    
    criticalRejectPrompts += '4. 🌟【特赦免责条款】：对于“标记错位问题”，“文字遮挡问题”，以及类似“文字变形问题”和“轻微的swoosh/图案差异”，这是当前AI模型物理上不可能 100% 完美还原的内容，请【必定放宽要求，坚决不能打回】(do NOT reject)，当作正常通过，仅在分数上极其轻微地扣除1-2分即可。\n';

    const promptText = `
你是一位极其严苛的时尚与鞋服配专业一致性检测AI专家。请对以下两张图片进行极严审核，确保“生成海报图”中的产品细节与“标准参考图/图一”高度保持一致：
- 第一张图片（标准图 / reference_image）：产品的标准款式设计素材图。
- 第二张图片（生成图 / result_image）：经过AI融合后，应用于创意海报或生成场景的产品渲染效果图。

请根据用户划定的产品类别 【${title}】标准模板进行比对和打分：

${categoryPrompts[category] || categoryPrompts.shoes}

请务必严格使用以下判定逻辑核心规则（Critical Decision Rules）：
${criticalRejectPrompts}
5. 一致性总评分 = 结构评分 + 颜色评分 + 图案评分 + 文字评分 + 光影评分。
   - 当一致性总评分 >= ${passThreshold} 且根据上述判定未触发任何 Critical 一票否决规则（或已经选择宽放规则）时，"pass" 应该为 true (Pass)。
   - 当一致性总评分 < 70，或者确实由于物理款式大错大缺而触发了未放宽的一票否决规则时，"pass" 必须为 false (Reject)。
   - 介于 70 到 ${passThreshold} 之间时，若不存在严重物理拼缝断节问题，可判定为通过或根据严重瑕疵评定（对于已指示豁免宽放的部分，如Swoosh轻偏或微型文字畸变，决不可作为打回的严重错误对待）。

请必须在第二张图片（生成的渲染效果图，即图二）中，自动定位出所有“不一致/错误/可疑区域”，并给出其归一化图像框坐标 bbox。
bbox 格式为：双数数组 [ymin, xmin, ymax, xmax]，对应图二中瑕疵区域的归一化投影平面坐标。
其中 ymin, xmin, ymax, xmax 均是 0 到 1000 之间的归一化整数位置（0 代表最上方/最左方，1000 代表最下方/最右方）。
特别注意顺序：依次为 [最上方纵向坐标 ymin, 最左方横向坐标 xmin, 最下方纵向坐标 ymax, 最右方横向坐标 xmax]，必须严格遵循此标准的 ymin, xmin, ymax, xmax 顺序！
例如：[250, 550, 400, 650] 表示纵向范围 y 轴是 250 到 400 (25.0% - 40.0%)，横向范围 x 轴是 550 到 650 (55.0% - 65.0%) 的矩形框。⚠️请确保归一化框选精准对齐图二中的瑕疵边缘，严格紧贴有问题的区域，不要框选过大或错位偏离。

🚨【特别强制标注要求】：鞋服配产品上的商标字母、型号英文字符（如图片一中的 "NIKE reactX" 等）、印花图案文字，极其重要，不能被视作普通的文本OCR！它们应该被判定作产品核心图案或标志特征。如果图二中的这些“图案文字特征”相比图一有任何扭曲、重影、变形或拼写识别错误，【必须】使用 bbox 将此处明确标识出来，定性为 "pattern_error" （或 "text_error"）放入 issues，不管它是否被豁免宽放，必须要标记出来，绝不能遗漏！

使用 "desc" (问题描述) 时的要求：
- 注意！若是 "structure_mismatch" (结构不一致)，必须使用通俗易懂的“形状差异对比”来描述（公式：原来是 [什么形状]，现在变成了 [什么形状]）。例如：“原来是平滑的矩形，现在变成了三角缺口”、“原本笔直的边缘，现在变弯曲了”、“原本圆润的鞋头，现在多出了尖角”等。坚决避免使用“支撑结构”、“分割感”、“饱满圆润”等抽象生涩的设计名词，让普通人一眼就能看懂形状差别。

对每一个标注，均需指定以下四个类型之一：
- "structure_mismatch" (结构不一致)
- "color_mismatch" (颜色不一致/偏差大)
- "pattern_error" (印花图案缺失变形)
- "text_error" (文字拼写错误或畸变)

请严格输出为 JSON 格式。除了该 JSON 格式外，严禁包含任何其他markdown包裹字符（如 \`\`\`json 以及随后的 \`\`\` 标记 ），直接返回合法的 JSON 对象：
{
  "scores": {
    "structure": 36,  // 0 - 40 评分 
    "color": 22,      // 0 - 25 评分
    "pattern": 21,    // 0 - 25 评分
    "text": 3,        // 0 - 5 评分
    "lighting": 4     // 0 - 5 评分
  },
  "pass": boolean,     // 是否通过，对应判定逻辑结果
  "issues": [
    {
      "type": "text_error" | "structure_mismatch" | "color_mismatch" | "pattern_error",
      "desc": "问题描述内容",
      "bbox": [ymin, xmin, ymax, xmax] // 0-1000 的整数百分比坐标, 顺序: ymin, xmin, ymax, xmax
    }
  ]
}
`;

    const response = await fetch(openRouterUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://ai.studio/build',
        'X-Title': 'Remix Consistency Review Tool'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: promptText
              },
              {
                type: 'image_url',
                image_url: {
                  url: base64Ref
                }
              },
              {
                type: 'image_url',
                image_url: {
                  url: base64Res
                }
              }
            ]
          }
        ],
        temperature: 0.1
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      let extraHelp = '';
      if (response.status === 401) {
        extraHelp = ` (秘钥校验失败：请检查您的 MIMO/OpenRouter API Key "${apiKey.substring(0, 6)}...${apiKey.slice(-4)}" 是否正确且处于有效、充值状态。)`;
      } else if (response.status === 404) {
        const lowerError = errorText.toLowerCase();
        if (lowerError.includes('image input') || lowerError.includes('support image') || lowerError.includes('no endpoint')) {
          extraHelp = ` (诊断建议：此错误一般由于在 OpenRouter 或中转渠道中使用了不支持图像输入的【文本版模型】。在 OpenRouter 渠道，只有 flagship【xiaomi/mimo-v2.5】支持图像/视觉分析。)`;
        }
      }
      throw new Error(`一致性审计请求失败 (MIMO API Status ${response.status}): ${errorText}${extraHelp}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('Received empty response from Mimo model');
    }

    let parsedResult;
    try {
      let cleanedJson = content;
      if (cleanedJson.includes('```')) {
        const matches = cleanedJson.match(/```(?:json)?([\s\S]*?)```/);
        if (matches && matches[1]) {
          cleanedJson = matches[1].trim();
        }
      }
      parsedResult = JSON.parse(cleanedJson);
    } catch (parseErr) {
      console.error('Failed to parse JSON content from Mimo model:', content);
      throw new Error(`Mimo model returned invalid JSON structure: ${content.slice(0, 150)}`);
    }

    // Programmatic adjustment of "pass" on the server side to guarantee strict consistency with settings
    if (parsedResult && parsedResult.scores) {
      const calculatedScore = (parsedResult.scores.structure || 0) +
                              (parsedResult.scores.color || 0) +
                              (parsedResult.scores.pattern || 0) +
                              (parsedResult.scores.text || 0) +
                              (parsedResult.scores.lighting || 0);
      
      let passDecision = parsedResult.pass;
      
      if (calculatedScore >= passThreshold) {
        let hasCriticalViolation = false;
        if (parsedResult.issues && Array.isArray(parsedResult.issues)) {
          for (const issue of parsedResult.issues) {
            if (issue.type === 'structure_mismatch' && rejectOnStructure) {
              hasCriticalViolation = true;
            }
            if (issue.type === 'text_error' && rejectOnText) {
              hasCriticalViolation = true;
            }
            if (issue.type === 'pattern_error' && rejectOnPattern) {
              hasCriticalViolation = true;
            }
          }
        }
        if (!hasCriticalViolation) {
          passDecision = true;
        }
      } else {
        if (calculatedScore < 70) {
          passDecision = false;
        }
      }
      parsedResult.pass = passDecision;
    }

    auditStatusStore.set(taskId, {
      status: 'success',
      result: parsedResult,
      timestamp: Date.now()
    });
    console.log(`Audit successfully completed for ${taskId}`);
    return parsedResult;

  } catch (err: any) {
    console.error(`Audit failed for ${taskId}:`, err.message);
    auditStatusStore.set(taskId, {
      status: 'error',
      error: err.message || 'Unknown auditing error',
      timestamp: Date.now()
    });
    throw err;
  }
}

app.post('/api/tasks/save', (req, res) => {
  try {
    const { tasks } = req.body;
    fs.writeFileSync(TASKS_FILE_PATH, JSON.stringify(tasks, null, 2), 'utf-8');
    res.json({ success: true });
  } catch (err: any) {
    console.error('Error saving tasks:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tasks/load', (req, res) => {
  try {
    if (fs.existsSync(TASKS_FILE_PATH)) {
      const data = fs.readFileSync(TASKS_FILE_PATH, 'utf-8');
      res.json({ success: true, tasks: JSON.parse(data) });
    } else {
      res.json({ success: true, tasks: [] });
    }
  } catch (err: any) {
    console.error('Error loading tasks:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/audit-image', async (req, res) => {
  try {
    const { 
      taskId, 
      referenceImage, 
      resultUrl, 
      category, 
      auditApiKey, 
      auditBaseUrl, 
      auditModel,
      passThreshold,
      rejectOnText,
      rejectOnStructure,
      rejectOnPattern
    } = req.body;
    
    if (!taskId || !referenceImage || !resultUrl) {
      return res.status(400).json({ error: 'Missing required parameters: taskId, referenceImage, resultUrl' });
    }

    const existing = auditStatusStore.get(taskId);
    if (existing && (existing.status === 'running' || existing.status === 'success')) {
      return res.json({ status: existing.status, result: existing.result, error: existing.error });
    }

    const categoryStr = category || 'shoes';

    auditStatusStore.set(taskId, {
      status: 'running',
      timestamp: Date.now()
    });

    try {
      const result = await runAuditBackground(
        taskId, 
        referenceImage, 
        resultUrl, 
        categoryStr, 
        auditApiKey, 
        auditBaseUrl, 
        auditModel,
        {
          passThreshold,
          rejectOnText,
          rejectOnStructure,
          rejectOnPattern
        }
      );
      res.json({ status: 'success', result });
    } catch (err: any) {
      console.error(`Background audit thread error for ${taskId}:`, err);
      res.status(500).json({ error: err.message || 'Audit failed' });
    }

  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/audit-status', (req, res) => {
  try {
    const { taskId } = req.query;
    if (!taskId || typeof taskId !== 'string') {
      return res.status(400).json({ error: 'taskId parameter is required' });
    }
    const status = auditStatusStore.get(taskId);
    if (!status) {
      return res.json({ status: 'none' });
    }
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default app;
