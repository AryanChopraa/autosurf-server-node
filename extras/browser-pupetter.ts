import * as puppeteer from 'puppeteer';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { TOOLS, type Tool, type ToolFunction } from '../real-browsing-agent/tools/Tools';  // Import tools from config
import { highlightLinks } from '../real-browsing-agent/utils/HighlightScript';  // Import highlight script
import { SYSTEM_PROMPT } from '../real-browsing-agent/utils/Prompts';  // Import system prompt

dotenv.config();

class AIBrowserAgent {
    private browser: puppeteer.Browser | null = null;
    private page: puppeteer.Page | null = null;
    private client: OpenAI;

    constructor() {
        this.client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }

    async initialize() {
        console.log('Starting browser...');
        this.browser = await puppeteer.launch({
            headless: false,  // Set to true for headless mode
            args: ['--window-size=1440,900']
        });
        this.page = await this.browser.newPage();
        await this.page.setViewport({ width: 1440, height: 900 });
        console.log('Browser started successfully');
    }

    private async capturePageState(): Promise<string | null> {
        if (!this.page) return null;

        try {
            // Highlight interactive elements and capture screenshot
            await this.page.evaluate(highlightLinks);
            return await this.page.screenshot({ encoding: 'base64' });
        } catch (e) {
            console.error(`Error taking screenshot: ${e}`);
            return null;
        }
    }

    private async executeActionWithRetry(toolCall: OpenAI.ChatCompletionMessageToolCall, retries = 3): Promise<string | null> {
        for (let i = 0; i < retries; i++) {
            try {
                return await this.executeAction(toolCall);
            } catch (e) {
                console.error(`Attempt ${i + 1} failed: ${e}`);
                if (i === retries - 1) throw e; // Throw error if all retries fail
            }
        }
        return null;
    }

    private async executeAction(toolCall: OpenAI.ChatCompletionMessageToolCall): Promise<string | null> {
        if (!this.page) return null;

        const { id, function: { name, arguments: functionArgs } } = toolCall;
        const parsedArgs = JSON.parse(functionArgs);

        console.log(`Executing: ${name}`);
        console.log(`Explanation: ${parsedArgs.explanation}`);
        console.log(`Action: ${parsedArgs.action}`);

        try {
            switch (name) {
                case 'handle_url':
                    await this.page.goto(parsedArgs.url, { waitUntil: 'networkidle2' });
                    break;

                case 'handle_search':
                    await this.page.goto(`https://www.google.com/search?q=${encodeURIComponent(parsedArgs.query)}`, {
                        waitUntil: 'networkidle2'
                    });
                    break;

                case 'handle_click':
                    // Wait for dynamic content to load
                    await this.page.waitForSelector('[gpt-link-text], [gpt-alt-text]', { timeout: 5000 });

                    // Find elements with gpt-link-text or gpt-alt-text
                    const elements = await this.page.$$('[gpt-link-text], [gpt-alt-text]');
                    let elementToClick: puppeteer.ElementHandle<Element> | null = null;

                    for (const element of elements) {
                        const text = await element.evaluate(el => el.getAttribute('gpt-link-text') || el.getAttribute('gpt-alt-text'));
                        if (text && text.toLowerCase() === parsedArgs.text.toLowerCase()) {
                            elementToClick = element;
                            break;
                        }
                    }

                    if (elementToClick) {
                        // Simulate human-like click (hover first, then click)
                        await elementToClick.hover();
                        await new Promise(resolve => setTimeout(resolve, 500)); // Simulate delay
                        await elementToClick.click();
                        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for page to load
                    } else {
                        throw new Error(`No element found with text: ${parsedArgs.text}`);
                    }
                    break;

                case 'handle_scroll':
                    const viewportHeight = await this.page.evaluate(() => window.innerHeight);
                    await this.page.evaluate((height) => window.scrollBy(0, height), viewportHeight);
                    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate delay
                    break;

                case 'handle_typing':
                    const input = await this.page.$(`input[placeholder="${parsedArgs.placeholder_value}"]`);
                    if (input) {
                        await input.type(parsedArgs.text, { delay: 100 }); // Simulate typing
                        await input.press('Enter');
                        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for action to complete
                    }
                    break;

                default:
                    throw new Error(`Unknown tool: ${name}`);
            }
        } catch (e) {
            console.error(`Action failed: ${e}`);
            throw e; // Rethrow to trigger retry logic
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
                const screenshot = await this.executeActionWithRetry(response.tool_calls[0]);
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