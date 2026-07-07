import localforage from 'localforage';

// Configure a specific instance for image caching
export const imageCache = localforage.createInstance({
  name: 'ais-image-cache',
  storeName: 'generated_images',
  description: 'Cache for generated and uploaded images'
});

const MAX_MEM_CACHE = 150;
const memoryCache = new Map<string, Blob>();

export const saveImageToCache = async (key: string, blob: Blob) => {
  try {
    memoryCache.set(key, blob);
    if (memoryCache.size > MAX_MEM_CACHE) {
        const firstKey = memoryCache.keys().next().value;
        if (firstKey) memoryCache.delete(firstKey);
    }
    await imageCache.setItem(key, blob);
  } catch (error) {
    console.error('Failed to save image to cache:', error);
  }
};

export const getImageFromCache = async (key: string): Promise<Blob | null> => {
  if (memoryCache.has(key)) {
    return memoryCache.get(key) || null;
  }
  try {
    const blob = await imageCache.getItem<Blob>(key);
    if (blob) {
      memoryCache.set(key, blob);
      if (memoryCache.size > MAX_MEM_CACHE) {
          const firstKey = memoryCache.keys().next().value;
          if (firstKey) memoryCache.delete(firstKey);
      }
    }
    return blob;
  } catch (error) {
    console.error('Failed to get image from cache:', error);
    return null;
  }
};

export const removeImageFromCache = async (key: string) => {
  try {
    memoryCache.delete(key);
    await imageCache.removeItem(key);
  } catch (error) {
    console.error('Failed to remove image from cache:', error);
  }
};

export const clearImageCache = async () => {
  try {
    memoryCache.clear();
    await imageCache.clear();
  } catch (error) {
    console.error('Failed to clear image cache:', error);
  }
};

export const fetchUrlToBlobAndCache = async (url: string, cacheKey?: string): Promise<Blob | null> => {
    const key = cacheKey || url;
    const existing = await getImageFromCache(key);
    if (existing) {
        return existing;
    }

    try {
        let response: Response;
        // Default bypass_proxy to true if not explicitly set to 'false'
        const bypassProxy = typeof window !== 'undefined' && localStorage.getItem('bypass_proxy') !== 'false';

        if (url.startsWith('http')) {
            let directSuccess = false;
            try {
                // Try direct client-side fetch first to save Vercel bandwidth
                response = await fetch(url);
                if (response.ok) {
                    directSuccess = true;
                } else {
                    throw new Error(`Direct fetch status: ${response.status}`);
                }
            } catch (err) {
                console.warn('Direct image fetch failed:', url, err);
                if (bypassProxy) {
                    // If bypassing Vercel proxy is requested, do not fall back to proxy
                    throw new Error(`Direct fetch failed and Vercel proxy is disabled (Bypass Proxy enabled)`);
                } else {
                    // Fallback to Vercel proxy
                    const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`;
                    response = await fetch(proxyUrl);
                }
            }
        } else {
            response = await fetch(url);
        }

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const blob = await response.blob();
        await saveImageToCache(key, blob);
        return blob;
    } catch (e) {
        console.error('Failed to fetch and cache image:', url, e);
        return null;
    }
}
