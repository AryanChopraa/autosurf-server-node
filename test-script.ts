import { ScriptRunnerAgent } from './real-browsing-agent/script-runner-agent';

async function runTest() {
    const agent = new ScriptRunnerAgent();
    
    try {
        // Initialize the browser
        await agent.initialize();
        
        // Your test script
        const script = `
            await page.goto('https://www.amazon.com');
            await page.waitForTimeout(1000);
            await page.waitForTimeout(1000);
            await page.type('input[placeholder="Search Amazon"]', 'detergent');
            await page.keyboard.press('Enter');
            await page.waitForTimeout(1000);
        `;
        
        // Execute the script
        await agent.executeScript(script);
        
        // Keep the browser open for 10 seconds to see the results
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        // Close the browser
        await agent.close();
        
    } catch (error) {
        console.error('Test failed:', error);
        await agent.close();
    }
}

// Run the test
runTest().catch(console.error); 