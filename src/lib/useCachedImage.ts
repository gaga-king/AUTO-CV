import { useState, useEffect, useCallback } from 'react';
import { fetchUrlToBlobAndCache } from './imageCache';

export const useCachedImage = (src?: string, cacheKey?: string) => {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let urlToRevoke: string | null = null;

    const loadImg = async () => {
      if (!src) {
        setObjectUrl(null);
        return;
      }

      if (src.startsWith('data:') || src.startsWith('blob:') || src.startsWith('/api/')) {
        setObjectUrl(src);
        return;
      }
      
      const blob = await fetchUrlToBlobAndCache(src, cacheKey || src);
      if (active && blob) {
        urlToRevoke = URL.createObjectURL(blob);
        setObjectUrl(urlToRevoke);
      }
    };

    loadImg();

    return () => {
      active = false;
      if (urlToRevoke) {
        URL.revokeObjectURL(urlToRevoke);
      }
    };
  }, [src, cacheKey]);

  // Provide a release function that components can call on image onLoad
  const releaseBlob = useCallback(() => {
      // Do nothing on load to prevent broken images on re-render.
      // Cleanup is handled in useEffect return.
  }, []);

  return { url: objectUrl || src || '', releaseBlob };
};

export const fetchLocalBlobUrl = async (src: string, cacheKey?: string): Promise<string | null> => {
    if (!src) return null;
    if (src.startsWith('data:') || src.startsWith('blob:')) return src;
    const blob = await fetchUrlToBlobAndCache(src, cacheKey || src);
    if (blob) {
        return URL.createObjectURL(blob);
    }
    return null;
}
