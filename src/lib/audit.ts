import { fetchUrlToBlobAndCache } from './imageCache';

export async function urlToBase64Client(url: string | undefined, cacheKey?: string): Promise<string> {
  if (!url) return '';
  if (url.startsWith('data:')) {
    return url;
  }
  
  try {
    // 1. Get the image as a Blob from the local IndexedDB cache (stored via localforage),
    // or fetch it (which tries direct fetch first, and falls back to proxy only if bypassProxy is false).
    const blob = await fetchUrlToBlobAndCache(url, cacheKey || url);
    if (!blob) {
      throw new Error(`Failed to acquire image blob from cache or network for URL: ${url}`);
    }
    
    // 2. Convert Blob to Base64 in browser using FileReader (entirely client-side, zero server/network bandwidth)
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new Error('FileReader result is not a string'));
        }
      };
      reader.onerror = () => reject(reader.error || new Error('FileReader error'));
      reader.readAsDataURL(blob);
    });
  } catch (err: any) {
    console.error(`Error in urlToBase64Client for ${url}:`, err.message);
    
    // Fallback if everything fails
    return url;
  }
}

export async function runAuditOnClient(
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
    console.log(`Starting client-side audit for task ${taskId} (Category: ${category})`);
    
    // Prepare image payload (always convert to base64 to ensure the China-based API server can read it without hitting GFW blocks on Cloud Run domain)
    const base64Ref = referenceImage.startsWith('data:') ? referenceImage : await urlToBase64Client(referenceImage);
    const base64Res = resultUrl.startsWith('data:') ? resultUrl : await urlToBase64Client(resultUrl, taskId);

    if (!base64Ref || !base64Res) {
      throw new Error('Reference image or generated image is empty or invalid');
    }

    let apiKey = (userApiKey || '').trim();
    if (apiKey.startsWith('"') && apiKey.endsWith('"')) {
      apiKey = apiKey.slice(1, -1).trim();
    }
    if (apiKey.startsWith("'") && apiKey.endsWith("'")) {
      apiKey = apiKey.slice(1, -1).trim();
    }
    if (!apiKey) {
      // User must provide key
    }

    let model = (userModel || '').trim();
    if (model.startsWith('"') && model.endsWith('"')) {
      model = model.slice(1, -1).trim();
    }
    if (model.startsWith("'") && model.endsWith("'")) {
      model = model.slice(1, -1).trim();
    }
    if (!model) {
      model = 'xiaomi/mimo-v2.5';
    }

    let openRouterUrl = (userBaseUrl || '').trim();
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
        openRouterUrl = 'https://api.xiaomimimo.com/v1/chat/completions';
      }
    } else if (apiKey.startsWith('sk-') && !apiKey.startsWith('sk-or-') && openRouterUrl.includes('openrouter.ai') && !userBaseUrl) {
      openRouterUrl = 'https://api.siliconflow.cn/v1/chat/completions';
      if (model === 'xiaomi/mimo-v2.5' || model === 'xiaomi/mimo-v2.5-pro' || model === 'vendor/xiaomi/mimo-preview') {
        model = 'vendor/xiaomi/mimo-preview';
      }
    }

    const passThreshold = options?.passThreshold ?? 85;
    const rejectOnText = options?.rejectOnText !== false;
    const rejectOnStructure = options?.rejectOnStructure !== false;
    const rejectOnPattern = options?.rejectOnPattern !== false;

    const genericPrompt = `
结构得分（Structure Score，总权40分）：
评估产品整体轮廓、物理形态、体积感、结构部件（如鞋的底形、衣服的版型袖型领口、配饰的五金/包型、套装的比例等）以及材质拼接线条的一致性。
${rejectOnStructure ? '任何严重的物理款式差异、版型拼缝不对、部件丢失/多余，触发一票否决(Reject)。' : '若仅仅是由于透视相机视角、海报特写创意导致局部细微偏倚、变少或移动，但在物理上整体版型款式一致时，请不要直接判定一票否决，作正常缺陷扣减1-3分即可。'}

颜色得分（Color Score，总权25分）：
比对“标准图（图一）”与“生成图（图二）”的主色、辅色及局部色块分布（包含面料与五金颜色等）。
允许因光照起伏和立体效果带来的 ±10%~15% 色相/亮度偏差。

图案得分（Pattern Score，总权25分）：
评估产品表面的花纹、条纹、老花图案、刺绣、走针纹理性等的位置与形状形状连续性。
${rejectOnPattern ? '任何核心图案、大块印花/刺绣图形缺失严重或完全断档变形，将直接判定 Reject。' : '装饰图案、侧线纹理在海报构图中若有少许美化偏倚或折叠轻微变形，作扣分项（每次扣减1-2分），不要直接一票否决。'}

文字/标识得分（Text Score，总权5分，极低权重）：
检测包装、产品上的英文、中文字符、Logo及标识标签。
检查其拼写是否正确、字体形态是否因 AI 生成而产生乱码、畸变或严重残缺。
${rejectOnText ? '任何明显拼写错误或乱码字母、以及文字残畸 >= 2 处，直接判定 Reject。' : 'AI生成极小的说明贴纸/水洗标微雕微畸，属于生图正常物理现象（非伪冒错误），请务必放宽该项一票否决，不作为 Reject 判定，作为轻微缺陷在10分内扣除1-2分即可。'}

光影干扰（Lighting/Noise Score，总权5分，权重降低）：
分析强光影、高光折射、深色硬投影、烟雾等特效对关键结构形态的遮挡及干扰。
不直接判为物理错误，影响置信度与环境融合美感评分。`;

    let criticalRejectPrompts = '';
    if (rejectOnStructure) {
      criticalRejectPrompts += '1. 结构不一致：若产品的物理版型主要外轮廓与标准参考物具有硬性款式大错、结构缺失，则必须判定一票否决（"pass": false）。\\n';
    } else {
      criticalRejectPrompts += '1. 结构不一致宽大判定：由于透视镜头、创意海报或者不同硬投影引起的 Logo/Swoosh 局部少量错位偏离，在主体款式和鞋服物理框架无变时，切不可大惊小怪，不要进行一票否决直接 Reject 打回，请在瑕疵检测扣分后（只扣1-3分），允许高分 PASS。\\n';
    }
    
    if (rejectOnText) {
      criticalRejectPrompts += '2. 文字拼写错误、出现明显的乱码和杂乱 AI 字母拼读 >= 2 处，则判定一票否决（"pass": false）。\\n';
    } else {
      criticalRejectPrompts += '2. 细节和鞋舌文字畸变宽大判定：AI在细小字母（如鞋舌微字、衣服尾巴织标、刺绣标签等非主体超大标题字）常有轻微模糊或者AI无义重合，这属于海报生成行业可接受的正常效果。请高抬贵手，不得判定一票否决直接 Reject 打回。对此仅列为问题，并扣除1-2分即可，要允许该等情况下能 PASS。\\n';
    }

    if (rejectOnPattern) {
      criticalRejectPrompts += '3. 核心装饰图案/品牌核心印花基本块丢失（标准款极具特性的核心花样完全没生出来），则判定一票否决（"pass": false）。\\n';
    } else {
      criticalRejectPrompts += '3. 装饰花纹偏差不作为一票否决。\\n';
    }
    
    criticalRejectPrompts += '4. 🌟【特赦免责条款】：对于“标记错位问题”，“文字遮挡问题”，以及类似“文字变形问题”和“轻微的swoosh/图案差异”，这是当前AI模型物理上不可能 100% 完美还原的内容，请【必定放宽要求，坚决不能打回】(do NOT reject)，当作正常通过，仅在分数上极其轻微地扣除1-2分即可。\\n';

    const promptText = `
你是一位极其严苛的商务产品一致性检测AI专家。请对以下两张图片进行极严审核，确保“生成海报图”中的产品细节与“标准参考图/图一”高度保持一致：
- 第一张图片（标准图 / reference_image）：产品的标准款式设计素材图。
- 第二张图片（生成图 / result_image）：经过AI融合后，应用于创意海报或生成场景的产品渲染效果图。

请根据以下通用产品标准模板进行比对和打分：

${genericPrompt}

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
        extraHelp = ` (秘钥校验失败：请检查您的 API Key "${apiKey.substring(0, 6)}...${apiKey.slice(-4)}" 是否正确且有效。)`;
      } else if (response.status === 404) {
        const lowerError = errorText.toLowerCase();
        if (lowerError.includes('image input') || lowerError.includes('support image') || lowerError.includes('no endpoint')) {
          extraHelp = ` (诊断建议：使用了不支持图像输入的文本模型。请使用含 vision 能力的模型。)`;
        }
      }
      throw new Error(`一致性审计请求失败 (API Status ${response.status}): ${errorText}${extraHelp}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('Received empty response from AI model');
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
      throw new Error(`AI model returned invalid JSON structure: ${content.slice(0, 150)}`);
    }

    // Programmatic adjustment
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

    return parsedResult;

  } catch (err: any) {
    console.error(`Client-side audit failed for ${taskId}:`, err.message);
    throw err;
  }
}
