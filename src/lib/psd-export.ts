import { writePsd } from 'ag-psd';
import { saveAs } from 'file-saver';

const loadImage = (src: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image: ' + src));
    img.src = src;
  });
};

export async function exportToPsd(
  imageUrl: string,
  issues: any[],
  referenceImages: string[] = [],
  filename: string = 'audit_result.psd'
) {
  const canvasesToCleanup: HTMLCanvasElement[] = [];
  try {
    const genImg = await loadImage(imageUrl);
    const width = genImg.width;
    const height = genImg.height;

    const allCoords = issues.flatMap(iss => iss.bbox || []);
    const taskMaxVal = allCoords.length > 0 ? Math.max(...allCoords) : 0;
    const scaleFactor = taskMaxVal > 150 ? 10 : 1;

    // Helper to wrap Chinese & English characters cleanly in Canvas
    const wrapText = (
      ctx: CanvasRenderingContext2D,
      text: string,
      maxWidth: number
    ): string[] => {
      const words = text.split('');
      const lines: string[] = [];
      let currentLine = '';
      
      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const testLine = currentLine + word;
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && i > 0) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      lines.push(currentLine);
      return lines;
    };

    // Precalculate footerHeight dynamically based on wrapped line count
    let footerHeight = 0;
    if (issues && issues.length > 0) {
      const paddingX = Math.max(40, width * 0.04);
      const titleSize = Math.max(20, width * 0.016);
      const textFontSize = Math.max(14, width * 0.011);
      const circleRadius = Math.max(12, width * 0.01);
      
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
      if (tempCtx) {
        tempCtx.font = `medium ${textFontSize}px sans-serif`;
        let computedY = titleSize * 1.8 + Math.max(30, height * 0.025);
        
        issues.forEach((issue) => {
          const badgeLabel = issue.type === 'text_error' ? '【文字畸变】' : 
                             issue.type === 'structure_mismatch' ? '【结构不一致】' : 
                             issue.type === 'color_mismatch' ? '【颜色偏差】' : '【图案瑕疵】';
          
          tempCtx.font = `bold ${textFontSize}px sans-serif`;
          const badgeWidth = tempCtx.measureText(badgeLabel).width;
          const circleX = paddingX + circleRadius * 2;
          const badgeX = circleX + 15;
          const descX = badgeX + badgeWidth + 10;
          
          tempCtx.font = `medium ${textFontSize}px sans-serif`;
          const maxDescWidth = width - descX - paddingX;
          const wrappedDesc = wrapText(tempCtx, issue.desc || '', maxDescWidth);
          
          computedY += Math.max(wrappedDesc.length * (textFontSize * 1.4) + 20, circleRadius * 2 + 25);
        });
        
        footerHeight = computedY + Math.max(40, height * 0.04);
      } else {
        footerHeight = 150 + issues.length * 70;
      }
    }

    // 1. Generated Image Canvas (expanded height to prevent stretching of original layer)
    const imgCanvas = document.createElement('canvas');
    imgCanvas.width = width;
    imgCanvas.height = height + footerHeight;
    canvasesToCleanup.push(imgCanvas);
    const ctxImg = imgCanvas.getContext('2d');
    if (!ctxImg) throw new Error('No canvas context');
    ctxImg.drawImage(genImg, 0, 0);

    // 2. Annotation Canvas (covers full expanded height)
    const boxCanvas = document.createElement('canvas');
    boxCanvas.width = width;
    boxCanvas.height = height + footerHeight;
    canvasesToCleanup.push(boxCanvas);
    const ctxBox = boxCanvas.getContext('2d');
    if (!ctxBox) throw new Error('No canvas context');
    ctxBox.clearRect(0, 0, width, height + footerHeight);

    // Anchor pixels at corners to prevent ag-psd from auto-trimming and shifting the layer
    ctxBox.fillStyle = 'rgba(0,0,0,0.01)';
    ctxBox.fillRect(0, 0, 1, 1);
    ctxBox.fillRect(width - 1, height + footerHeight - 1, 1, 1);

    // Draw solid rectangles and indicators over the image area
    issues.forEach((issue, idx) => {
      // Fix bbox coordinate swapping: original issue.bbox is [ymin, xmin, ymax, xmax]
      const [rawY1, rawX1, rawY2, rawX2] = issue.bbox;
      const x1 = rawX1 / scaleFactor;
      const y1 = rawY1 / scaleFactor;
      const x2 = rawX2 / scaleFactor;
      const y2 = rawY2 / scaleFactor;

      const absX1 = (x1 / 100) * width;
      const absY1 = (y1 / 100) * height;
      const absW = ((x2 - x1) / 100) * width;
      const absH = ((y2 - y1) / 100) * height;

      let color = '#ef4444'; // default red
      if (issue.type === 'color_mismatch') {
        color = '#eab308'; // yellow
      } else if (issue.type === 'pattern_error') {
        color = '#f97316'; // orange
      }

      // Draw thin solid border for precision
      ctxBox.strokeStyle = color;
      ctxBox.lineWidth = Math.max(3, width * 0.004);
      ctxBox.setLineDash([]);
      ctxBox.strokeRect(absX1, absY1, absW, absH);

      // Fill with transparent background showing original image underneath (8% opacity is perfect)
      ctxBox.fillStyle = color === '#ef4444' ? 'rgba(239, 68, 68, 0.08)' :
                         color === '#eab308' ? 'rgba(234, 179, 8, 0.08)' :
                         color === '#f97316' ? 'rgba(249, 115, 22, 0.08)' : 'rgba(239, 68, 68, 0.08)';
      ctxBox.fillRect(absX1, absY1, absW, absH);

      // Draw custom numbered circle badge on top-left of standard box to label the order
      const badgeRadius = Math.max(14, width * 0.011);
      const bx = absX1;
      const by = absY1;

      ctxBox.beginPath();
      ctxBox.arc(bx, by, badgeRadius, 0, 2 * Math.PI);
      ctxBox.fillStyle = color;
      ctxBox.fill();

      ctxBox.strokeStyle = '#ffffff';
      ctxBox.lineWidth = Math.max(2, width * 0.0025);
      ctxBox.stroke();

      ctxBox.fillStyle = '#ffffff';
      const numFontSize = Math.max(12, width * 0.009);
      ctxBox.font = `bold ${numFontSize}px sans-serif`;
      ctxBox.textAlign = 'center';
      ctxBox.textBaseline = 'middle';
      ctxBox.fillText(String(idx + 1), bx, by + 0.5);

      // Restore defaults
      ctxBox.textAlign = 'left';
      ctxBox.textBaseline = 'alphabetic';
    });

    // Draw Legend/Report Section in the footer of boxCanvas (transparent or white background)
    if (footerHeight > 0) {
      // Background for footer panel
      ctxBox.fillStyle = '#ffffff';
      ctxBox.fillRect(0, height, width, footerHeight);

      // Drawing horizontal hairline separator line
      ctxBox.strokeStyle = '#e5e7eb';
      ctxBox.lineWidth = Math.max(2, width * 0.002);
      ctxBox.beginPath();
      ctxBox.moveTo(0, height);
      ctxBox.lineTo(width, height);
      ctxBox.stroke();

      const startY = height + Math.max(30, height * 0.025);
      const paddingX = Math.max(40, width * 0.04);
      
      // Title
      const titleSize = Math.max(20, width * 0.016);
      ctxBox.font = `bold ${titleSize}px sans-serif`;
      ctxBox.fillStyle = '#111827';
      ctxBox.fillText('🔍 图像一致性审计报告与缺陷清单', paddingX, startY);
      
      let currentY = startY + titleSize * 1.8;
      const textFontSize = Math.max(14, width * 0.011);
      const circleRadius = Math.max(12, width * 0.01);

      issues.forEach((issue, idx) => {
        const itemNumber = idx + 1;
        const color = issue.type === 'structure_mismatch' ? '#ef4444' : 
                      issue.type === 'color_mismatch' ? '#eab308' : 
                      issue.type === 'pattern_error' ? '#f97316' : '#ef4444'; 
        
        const circleX = paddingX + circleRadius;
        const circleY = currentY - circleRadius * 0.3; // matching offset with text height
        
        ctxBox.beginPath();
        ctxBox.arc(circleX, circleY, circleRadius, 0, 2 * Math.PI);
        ctxBox.fillStyle = color;
        ctxBox.fill();
        
        ctxBox.fillStyle = '#ffffff';
        const insideFontSize = Math.max(11, width * 0.009);
        ctxBox.font = `bold ${insideFontSize}px sans-serif`;
        ctxBox.textAlign = 'center';
        ctxBox.textBaseline = 'middle';
        ctxBox.fillText(String(itemNumber), circleX, circleY + 0.5);
        ctxBox.textAlign = 'left';
        ctxBox.textBaseline = 'alphabetic'; 
        
        const badgeLabel = issue.type === 'text_error' ? '【文字畸变】' : 
                           issue.type === 'structure_mismatch' ? '【结构不一致】' : 
                           issue.type === 'color_mismatch' ? '【颜色偏差】' : '【图案瑕疵】';
                           
        ctxBox.font = `bold ${textFontSize}px sans-serif`;
        ctxBox.fillStyle = color;
        
        const badgeX = circleX + circleRadius + 15;
        ctxBox.fillText(badgeLabel, badgeX, currentY);
        
        const badgeWidth = ctxBox.measureText(badgeLabel).width;
        const descX = badgeX + badgeWidth + 10;
        
        ctxBox.font = `medium ${textFontSize}px sans-serif`;
        ctxBox.fillStyle = '#374151';
        
        const maxDescWidth = width - descX - paddingX;
        const wrappedDesc = wrapText(ctxBox, issue.desc || '', maxDescWidth);
        
        wrappedDesc.forEach((line, lineIdx) => {
          const lineY = currentY + lineIdx * (textFontSize * 1.4);
          ctxBox.fillText(line, descX, lineY);
        });
        
        currentY += Math.max(wrappedDesc.length * (textFontSize * 1.4) + 20, circleRadius * 2 + 25);
      });
    }

    // 3. Reference Images (remains scale-independent)
    const refCanvases = await Promise.all(
      referenceImages.map(async (refUrl, index) => {
        try {
          const refImg = await loadImage(refUrl);
          const c = document.createElement('canvas');
          c.width = refImg.width;
          c.height = refImg.height;
          canvasesToCleanup.push(c);
          const ctx = c.getContext('2d');
          if (ctx) {
            ctx.drawImage(refImg, 0, 0);
            ctx.fillStyle = 'rgba(0,0,0,0.01)';
            ctx.fillRect(0, 0, 1, 1);
            ctx.fillRect(refImg.width - 1, refImg.height - 1, 1, 1);
          }
          const leftOffset = Math.round((width - refImg.width) / 2);
          const topOffset = Math.round((height - refImg.height) / 2);
          return {
            name: `参考图 ${index + 1}`,
            canvas: c,
            left: leftOffset,
            top: topOffset,
            right: leftOffset + refImg.width,
            bottom: topOffset + refImg.height
          };
        } catch (e) {
          console.warn('Failed to load ref image for PSD:', refUrl);
          return null;
        }
      })
    );

    const validRefs = refCanvases.filter(Boolean) as {name: string, canvas: HTMLCanvasElement, left: number, top: number, right: number, bottom: number}[];

    // 4. Composite Previews for PSD Document Thumbnail/Flattened representation
    const compositeCanvas = document.createElement('canvas');
    compositeCanvas.width = width;
    compositeCanvas.height = height + footerHeight;
    canvasesToCleanup.push(compositeCanvas);
    const ctxComp = compositeCanvas.getContext('2d');
    if (ctxComp) {
      ctxComp.fillStyle = '#ffffff';
      ctxComp.fillRect(0, 0, width, height + footerHeight);
      ctxComp.drawImage(imgCanvas, 0, 0);
      ctxComp.drawImage(boxCanvas, 0, 0);
    }

    const children = [
      ...validRefs,
      {
        name: '生成图片',
        canvas: imgCanvas,
        left: 0,
        top: 0,
        right: width,
        bottom: height + footerHeight
      },
      {
        name: '标注图层',
        canvas: boxCanvas,
        left: 0,
        top: 0,
        right: width,
        bottom: height + footerHeight
      }
    ];

    const psdData: any = {
      width: width,
      height: height + footerHeight,
      canvas: compositeCanvas,
      children: children
    };

    const buffer = writePsd(psdData);
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    saveAs(blob, filename);
  } catch (err) {
    console.error('Export PSD Failed:', err);
    throw err;
  } finally {
    canvasesToCleanup.forEach(canvas => {
      canvas.width = 0;
      canvas.height = 0;
    });
  }
}
