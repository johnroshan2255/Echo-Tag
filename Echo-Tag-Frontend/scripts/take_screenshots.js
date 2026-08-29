import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  const mapsDir = path.resolve('public/maps');
  if (!fs.existsSync(mapsDir)) {
    fs.mkdirSync(mapsDir, { recursive: true });
  }
  
  for (let i = 0; i < 4; i++) {
    await page.goto('http://localhost:5173/');
    await page.waitForTimeout(500);
    
    for (let k = 0; k < i; k++) {
      await page.click('#bmap-next');
    }
    await page.click('#play');
    
    // wait for game to load
    await page.waitForTimeout(2000);
    
    // take screenshot of center of canvas
    const stage = await page.$('#stage');
    if (stage) {
      const box = await stage.boundingBox();
      if (box) {
         const width = 480;
         const height = 280;
         const x = box.x + box.width / 2 - width / 2;
         const y = box.y + box.height / 2 - height / 2;
         await page.screenshot({ 
           path: path.join(mapsDir, `map_${i}.jpg`), 
           quality: 85,
           type: 'jpeg',
           clip: { x, y, width, height } 
         });
         console.log(`Saved map_${i}.jpg`);
      }
    }
  }
  
  await browser.close();
})();
