import React, { useState, useEffect, ImgHTMLAttributes } from 'react';
import { fetchUrlToBlobAndCache } from '../lib/imageCache';

interface CachedImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  cacheKey?: string;
}

export const CachedImage: React.FC<CachedImageProps> = ({ src, cacheKey, className, ...props }) => {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let urlToRevoke: string | null = null;

    const loadImg = async () => {
      // Don't cache data URLs or blob URLs
      if (src.startsWith('data:') || src.startsWith('blob:')) {
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

  return (
    <img 
      {...props} 
      src={objectUrl || 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='} 
      className={className} 
    />
  );
};
