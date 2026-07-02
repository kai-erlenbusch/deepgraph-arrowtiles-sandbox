const puppeteer = require('puppeteer');

(async () => {
    try {
        const browser = await puppeteer.launch();
        const page = await browser.newPage();
        
        let warnings = [];
        
        page.on('console', msg => {
            if (msg.type() === 'warning' && msg.text().includes('not found in archive')) {
                warnings.push(msg.text());
            }
        });
        
        console.log("Navigating to http://localhost:5173/...");
        await page.goto('http://localhost:5173/');
        
        // Wait a few seconds for tiles to load and warnings to trigger
        console.log("Waiting 5 seconds for tiles to load...");
        await new Promise(r => setTimeout(r, 5000));
        
        console.log(`\nFound ${warnings.length} missing tile warnings.`);
        if (warnings.length > 0) {
            console.log("Sample of missing tiles:");
            for (let i = 0; i < Math.min(10, warnings.length); i++) {
                console.log(" - " + warnings[i]);
            }
        }
        
        await browser.close();
    } catch (e) {
        console.error("Error running puppeteer:", e);
        process.exit(1);
    }
})();
