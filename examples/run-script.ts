import { ScriptRunnerAgent } from '../real-browsing-agent/script-runner-agent';

async function main() {
    // Example script to run
    const scriptToRun = `
    const browser = await puppeteer.launch({
        headless: false,
        args: ['--window-size=1440,900']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    await page.goto('https://www.amazon.com');
    await page.waitForTimeout(1000);
    await page.type('[placeholder="Search Amazon"]', 'detergent');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);
    `;

    const runner = new ScriptRunnerAgent();
    
    try {
        await runner.initialize();
        await runner.executeScript(scriptToRun);
        console.log('Script execution completed');
    } catch (error) {
        console.error('Error running script:', error);
    } finally {
        await runner.close();
    }
}

main().catch(console.error); 