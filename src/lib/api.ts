import * as CryptoJS from 'crypto-js';

// --- Lovart OpenAPI Helpers ---

export const signLovartRequest = (method: string, apiPath: string, accessKey: string, secretKey: string) => {
  const ts = Math.floor(Date.now() / 1000).toString();
  const payload = `${method.toUpperCase()}\n${apiPath}\n${ts}`;
  const sig = CryptoJS.HmacSHA256(payload, secretKey).toString(CryptoJS.enc.Hex);
  return {
    'X-Access-Key': accessKey,
    'X-Timestamp': ts,
    'X-Signature': sig,
    'X-Signed-Method': method.toUpperCase(),
    'X-Signed-Path': apiPath,
  };
};

export const setLovartMode = async (accessKey: string, secretKey: string, unlimited: boolean) => {
  const modePath = '/v1/openapi/mode/set';
  const modeRes = await fetch('https://lgw.lovart.ai' + modePath, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      ...signLovartRequest('POST', modePath, accessKey, secretKey)
    },
    body: JSON.stringify({ unlimited })
  });
  return modeRes;
};

export const saveLovartProject = async (accessKey: string, secretKey: string, projectName: string) => {
  const projPath = '/v1/openapi/project/save';
  const projRes = await fetch('https://lgw.lovart.ai' + projPath, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      ...signLovartRequest('POST', projPath, accessKey, secretKey)
    },
    body: JSON.stringify({
      project_id: "",
      canvas: "",
      project_cover_list: [],
      pic_count: 0,
      project_type: 3,
      project_name: projectName
    })
  });
  return await projRes.json();
};

export const uploadFileToLovart = async (blob: Blob, name: string, accessKey: string, secretKey: string) => {
  const formData = new FormData();
  formData.append('file', blob, name);
  const upPath = '/v1/openapi/file/upload';
  const upRes = await fetch('https://lgw.lovart.ai' + upPath, {
    method: 'POST',
    headers: signLovartRequest('POST', upPath, accessKey, secretKey),
    body: formData as any,
  });
  return await upRes.json();
};

export const submitLovartChat = async (payload: any, accessKey: string, secretKey: string) => {
  const chatPath = '/v1/openapi/chat';
  const chatRes = await fetch('https://lgw.lovart.ai' + chatPath, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      ...signLovartRequest('POST', chatPath, accessKey, secretKey)
    },
    body: JSON.stringify(payload)
  });
  return chatRes;
};

export const getLovartChatStatus = async (threadId: string, accessKey: string, secretKey: string) => {
  const statPath = '/v1/openapi/chat/status';
  const queryStr = `?thread_id=${encodeURIComponent(threadId)}`;
  const statRes = await fetch('https://lgw.lovart.ai' + statPath + queryStr, {
    method: 'GET',
    headers: signLovartRequest('GET', statPath, accessKey, secretKey)
  });
  return statRes;
};

export const getLovartChatResult = async (threadId: string, accessKey: string, secretKey: string) => {
  const resPath = '/v1/openapi/chat/result';
  const resQuery = `?thread_id=${encodeURIComponent(threadId)}`;
  const resRes = await fetch('https://lgw.lovart.ai' + resPath + resQuery, {
    method: 'GET',
    headers: signLovartRequest('GET', resPath, accessKey, secretKey)
  });
  return resRes;
};

// --- Proxy & Utilities (Download / Fetch Image) ---

export const fetchProxyDownload = async (url: string) => {
    const res = await fetch('/api/proxy-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
    });
    if (!res.ok) throw new Error('Proxy downloading failed');
    return await res.blob();
};

export const fetchImageBlob = async (url: string, bypassProxy: boolean) => {
    // try direct fetch
    if (!bypassProxy) {
        try {
            const proxyResponse = await fetch(`/api/proxy-image?url=${encodeURIComponent(url)}`);
            if (proxyResponse.ok) {
                return await proxyResponse.blob();
            }
        } catch (e) {
            console.warn('Proxy fetch failed, falling back to direct fetch');
        }
    }
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error('Direct fetch failed');
    }
    return await response.blob();
};

// --- Tasks Server State Persistence ---

export const saveTasksToServerState = async (tasks: any[]) => {
    try {
        const res = await fetch('/api/tasks/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tasks })
        });
        return await res.json();
    } catch(err) {
        console.error('Error saving tasks to server:', err);
    }
};

export const loadTasksFromServerState = async () => {
    try {
        const res = await fetch('/api/tasks/load');
        return await res.json();
    } catch(err) {
        console.error('Error loading tasks:', err);
        return { success: false, tasks: [] };
    }
};

export const fetchAuditStatus = async (taskId: string) => {
  const res = await fetch(`/api/audit-status?taskId=${encodeURIComponent(taskId)}`);
  if (!res.ok) throw new Error(`Status ${res.status}`);
  return await res.json();
};

