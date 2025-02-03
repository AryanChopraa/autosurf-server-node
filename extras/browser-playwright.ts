import { chromium, type Browser, type Page } from '@playwright/test';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { TOOLS, type Tool, type ToolFunction } from '../real-browsing-agent/tools/Tools';  // Import tools from config
import { highlightLinks } from '../real-browsing-agent/utils/HighlightScript';  // Import highlight script

dotenv.config();

const SYSTEM_PROMPT = `
You are a website crawler. You will receive instructions for browsing websites. 
I can access a web browser and analyze screenshots to identify links (highlighted in red). 
Always follow the information in the screenshot, don't guess link names or instructions.
To navigate through the pages, use the following functions:
* Navigate to a URL: handle_url({"url": "your_url_here", "explanation": "...", "action": "..."})
* Perform a Google search: handle_search({"query": "your_search_query", "explanation": "...", "action": "..."})
* Click a link by its text: handle_click({"text": "your_link_text", "explanation": "...", "action": "..."})
* Scroll the page: handle_scroll({"explanation": "...", "action": "..."}) 
* Type in an input field: handle_typing({"placeholder_value": "placeholder", "text": "your_text", "explanation": "...", "action": "..."})
For each action, provide an explanation of why you're taking that action and a textual summary of the action itself.
Once you've found the answer on a webpage, you can respond with a regular message.
If the question/answer suggests a specific URL, go there directly. Otherwise, perform a Google search for it.
`;

class AIBrowserAgent {
    private browser: Browser | null = null;
    private page: Page | null = null;
    private client: OpenAI;

    constructor() {
        this.client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }

    async initialize() {
        console.log('Starting browser...');
        this.browser = await chromium.launch({
            headless: false
        });
        const context = await this.browser.newContext({
            viewport: { width: 1440, height: 900 }
        });
        this.page = await context.newPage();
        console.log('Browser started successfully');
    }

    private async capturePageState(): Promise<string | null> {
        if (!this.page) return null;
        
        try {
            // Use the imported highlightLinks function
            await this.page.evaluate(highlightLinks);
            const screenshot = await this.page.screenshot({ type: 'jpeg' });
            return screenshot.toString('base64');
        } catch (e) {
            console.error(`Error taking screenshot: ${e}`);
            return null;
        }
    }

    private async executeAction(toolCall: OpenAI.ChatCompletionMessageToolCall): Promise<string | null> {
        if (!this.page) return null;

        const { id, function: { name, arguments: functionArgs } } = toolCall;
        const parsedArgs = JSON.parse(functionArgs);

        console.log(`Executing: ${name}`);
        console.log(`Explanation: ${parsedArgs.explanation}`);
        console.log(`Action: ${parsedArgs.action}`);

        switch (name) {
            case 'handle_url':
                await this.page.goto(parsedArgs.url, { waitUntil: 'networkidle' });
                break;

            case 'handle_search':
                await this.page.goto(`https://www.google.com/search?q=${encodeURIComponent(parsedArgs.query)}`, {
                    waitUntil: 'networkidle'
                });
                break;

            case 'handle_click':
                try {
                    const elements = await this.page.locator('[gpt-link-text]').all();
                    for (const element of elements) {
                        const text = await element.getAttribute('gpt-link-text');
                        if (text && text.toLowerCase() === parsedArgs.text.toLowerCase()) {
                            await element.click();
                            await this.page.waitForTimeout(2000);
                            break;
                        }
                    }
                } catch (e) {
                    console.error(`Failed to click element: ${e}`);
                }
                break;

            case 'handle_scroll':
                const viewportHeight = await this.page.evaluate(() => window.innerHeight);
                await this.page.evaluate((height: number) => window.scrollBy(0, height), viewportHeight);
                await this.page.waitForTimeout(1000);
                break;

            case 'handle_typing':
                const input = this.page.locator(`input[placeholder="${parsedArgs.placeholder_value}"]`);
                if (await input.count() > 0) {
                    await input.type(parsedArgs.text, { delay: 100 });
                    await input.press('Enter');
                    await this.page.waitForTimeout(2000);
                }
                break;
        }

        return this.capturePageState();
    }

    async performTask(task: string) {
        if (!this.page) throw new Error('Browser not initialized');

        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: task }
        ];

        while (true) {
            const chatResponse = await this.client.chat.completions.create({
                model: 'gpt-4o',
                messages,
                max_tokens: 1000,
                tools: TOOLS  // Use imported tools configuration
            });

            const response = chatResponse.choices[0].message;
            console.log(`AI Response: ${response.content}`);

            if (response.tool_calls) {
                const screenshot = await this.executeAction(response.tool_calls[0]);
                if (screenshot) {
                    messages.push({
                        role: 'user',
                        content: [
                            { type: 'text', text: `Here is the screenshot after executing: ${response.tool_calls[0].function.name}` },
                            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${screenshot}` } }
                        ] as OpenAI.Chat.ChatCompletionContentPart[]
                    });
                }
            } else {
                console.log('Task completed:', response.content);
                break;
            }
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            console.log('Browser closed');
        }
    }
}

export { AIBrowserAgent };