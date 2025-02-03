import { AIBrowserAgent } from './real-browsing-agent/open-ai-agent';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
    try {
        // Create and initialize the browser agent
        const agent = new AIBrowserAgent();
        await agent.initialize();

        console.log('Browser agent initialized successfully');

        // Define the task
        const task = "Go to finance.yahoo.com, search for Apple stock (AAPL), and tell me the current stock price and any key statistics you find.";

        console.log('Starting task:', task);

        // Execute the task
        await agent.performTask(task);

        // Clean up
        await agent.close();
        console.log('Task completed and browser closed');
    } catch (error) {
        console.error('Error occurred:', error);
        // Ensure browser is closed even if an error occurs
        try {
            const agent = new AIBrowserAgent();
            await agent.close();
        } catch (closeError) {
            console.error('Error while closing browser:', closeError);
        }
    }
}

// Run the main function
if (require.main === module) {
    main().catch(console.error);
}
