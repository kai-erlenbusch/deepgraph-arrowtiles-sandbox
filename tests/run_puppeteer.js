const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    
    // Capture console messages
    page.on('console', msg => console.log(`[BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`));
    page.on('pageerror', error => console.log(`[BROWSER ERROR] ${error.message}`));
    page.on('requestfailed', request => console.log(`[BROWSER REQUEST FAILED] ${request.url()} - ${request.failure()?.errorText}`));

    console.log('Navigating to localhost:5173...');
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle2' }).catch(e => console.log('Goto error:', e));
    
    console.log('Waiting 3 seconds...');
    await new Promise(r => setTimeout(r, 3000));
    
    await page.screenshot({ path: 'C:/Users/erlen/.gemini/antigravity/brain/b1897c51-0780-4d60-8714-9bd670ce61ec/artifacts/headless_debug.png' }).catch(e => {});
    
    // Check if WebGPU is supported in headless Chrome
    const webgpuSupported = await page.evaluate(() => !!navigator.gpu);
    console.log(`WebGPU Supported in Puppeteer: ${webgpuSupported}`);
    
    await browser.close();
})();
