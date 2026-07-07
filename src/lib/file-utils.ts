export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
};

export const stitchImagesVertically = (imageUrls: string[], maxWidth: number = 1080): Promise<string> => {
  return new Promise((resolve, reject) => {
    if (!imageUrls || imageUrls.length === 0) {
      return reject(new Error('No images to stitch'));
    }

    let loadedCount = 0;
    const images: HTMLImageElement[] = [];
    let totalHeight = 0;

    imageUrls.forEach((url, i) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        // Calculate scaled height based on maxWidth
        let scale = 1;
        if (img.width > maxWidth) {
          scale = maxWidth / img.width;
        } else if (imageUrls.length > 1) { // If stitching, normalize widths
           scale = maxWidth / img.width;
        }
        
        const scaledWidth = img.width * scale;
        const scaledHeight = img.height * scale;
        
        images[i] = img;
        // Store scaled dimensions temporarily
        (img as any)._scaledWidth = scaledWidth;
        (img as any)._scaledHeight = scaledHeight;
        
        loadedCount++;
        if (loadedCount === imageUrls.length) {
          totalHeight = images.reduce((acc, img) => acc + (img as any)._scaledHeight, 0);
          
          const canvas = document.createElement('canvas');
          canvas.width = maxWidth;
          canvas.height = totalHeight;
          const ctx = canvas.getContext('2d');
          
          if (!ctx) {
             return resolve(imageUrls[0]);
          }
          
          let currentY = 0;
          images.forEach((loadedImg) => {
             const h = (loadedImg as any)._scaledHeight;
             const w = (loadedImg as any)._scaledWidth;
             // center align if narrower
             const x = (maxWidth - w) / 2;
             ctx.drawImage(loadedImg, x, currentY, w, h);
             currentY += h;
          });
          
          const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
          canvas.width = 0;
          canvas.height = 0;
          resolve(dataUrl);
        }
      };
      img.onerror = () => {
        // Fallback to next image or fail
        loadedCount++;
        images[i] = new Image();
        if (loadedCount === imageUrls.length) {
          resolve(imageUrls[0]); // fallback to first image if errors in stitching
        }
      };
      
      // If it's a blob url from local state, no proxy needed
      if (url.startsWith('data:') || url.startsWith('blob:')) {
         img.src = url;
      } else {
         // Use proxy for remote URLs to avoid canvas taint
         img.src = `/api/proxy-image?url=${encodeURIComponent(url)}`;
      }
    });
  });
};

export const createThumbnailBase64 = (file: File, maxWidth: number = 300): Promise<string> => {

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        canvas.width = 0;
        canvas.height = 0;
        resolve(dataUrl);
      } else {
        // Fallback
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      }
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for thumbnail'));
    };
    img.src = url;
  });
};

export const blobToThumbnailBase64 = (blob: Blob, maxWidth: number = 400): Promise<string> => {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85); // 0.85 quality is perfect compression (w400)
        canvas.width = 0;
        canvas.height = 0;
        resolve(dataUrl);
      } else {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      }
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    };
    img.src = url;
  });
};
