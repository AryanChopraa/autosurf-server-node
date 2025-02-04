import { AIBrowserAgent } from '../real-browsing-agent/open-ai-agent';
import { ScriptRunnerAgent } from '../real-browsing-agent/script-runner-agent';

async function main() {
    // First, use AIBrowserAgent to perform a task and get the commands
    const aiAgent = new AIBrowserAgent();
    let runner: ScriptRunnerAgent | null = null;
    
    try {
        await aiAgent.initialize();

        // Perform a task with AI agent
        await aiAgent.performTask('Go to amazon.com and search for "laptop" and click on the first product and tell me its specs and remem you have the ability to click');
        
        // Get the list of commands executed
        const commands = aiAgent.getExecutedCommands();
        console.log('Commands recorded:', JSON.stringify(commands, null, 2));

        // Now use ScriptRunnerAgent to replay these commands
        console.log('\nReplaying commands with ScriptRunnerAgent...');
        runner = new ScriptRunnerAgent();
        await runner.initialize();
        await runner.executeCommands(commands);
        console.log('Command replay completed');

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await aiAgent.close();
        if (runner) {
            await runner.close();
        }
    }
}

main().catch(console.error); 