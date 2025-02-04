import { ScriptRunnerAgent } from '../real-browsing-agent/script-runner-agent';
import type { ScriptCommand } from '../types';

async function main() {
    let runner: ScriptRunnerAgent | null = null;
    
    try {
        // Initialize the browser
        runner = new ScriptRunnerAgent();
        await runner.initialize();
        
        // Define commands to execute
        const commands: ScriptCommand[] = [
            {
                type: 'navigation',
                url: 'https://www.amazon.com'
            },
            {
                type: 'search',
                query: 'detergent'
            }
        ];
        
        // Execute the commands
        await runner.executeCommands(commands);
        
        // Keep the browser open for 10 seconds to see the results
        await new Promise(resolve => setTimeout(resolve, 10000));
        
    } catch (error) {
        console.error('Test failed:', error);
    } finally {
        if (runner) {
            await runner.close();
        }
    }
}

// Run the test
if (require.main === module) {
    main().catch(console.error);
} 