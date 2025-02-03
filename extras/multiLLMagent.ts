import * as puppeteer from 'puppeteer';
import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import dotenv from 'dotenv';
import { highlightLinks } from '../real-browsing-agent/utils/HighlightScript';

dotenv.config();

const SYSTEM_PROMPT = `You are a highly capable website crawler designed to interact with webpages like a human user. 
You will receive instructions for browsing websites and must perform actions reliably and accurately.

### Response Format Rules:
1. ALWAYS respond with a tool call (handle_*) UNTIL you have the FINAL result
2. ONLY respond with normal text when you have COMPLETED the task and have the EXACT information requested
3. NEVER explain what you're going to do - just do it with tool calls
4. When you have the final result, format it clearly with proper markdown

### Key Guidelines:
1. **Identify All Elements**: Look for buttons, links, inputs, and other interactive elements, even if they are images or icons
2. **Follow Visual Cues**: Always rely on the screenshot and highlighted elements to determine the next action
3. **Simulate Human Behavior**: Add small delays between actions (e.g., hovering before clicking, waiting after typing)
4. **Handle Errors Gracefully**: If an action fails, retry or look for alternative ways to achieve the goal

### Task Completion Rules:
1. For tasks requiring specific information (like stock prices or comments):
   - Continue making tool calls until you have the EXACT information
   - Only then respond with the formatted result
2. Your final response must include:
   - The specific information requested
   - Source of the information
   - Timestamp or recency indicator

### Available Tools:
* Navigate to a URL: handle_url({"url": "your_url_here", "explanation": "...", "action": "..."})
* Perform a Google search: handle_search({"query": "your_search_query", "explanation": "...", "action": "..."})
* Click a link or button: handle_click({"text": "your_link_text", "explanation": "...", "action": "..."})
* Scroll the page: handle_scroll({"explanation": "...", "action": "..."}) 
* Type in an input field: handle_typing({"placeholder_value": "placeholder", "text": "your_text", "explanation": "...", "action": "..."})

Remember: ONLY return normal text when you have the FINAL result. Otherwise, ALWAYS use tool calls.`;

interface ToolArgs {
    url?: string;
    query?: string;
    text?: string;
    direction?: 'up' | 'down';
    placeholder_value?: string;
    explanation: string;
    action: string;
}

class AIBrowserAgent {
    private browser: puppeteer.Browser | null = null;
    private page: puppeteer.Page | null = null;
    private model: ChatOpenAI;
    private tools: DynamicStructuredTool<any>[];

    constructor() {
        this.model = new ChatOpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            modelName: 'gpt-4o',
            maxTokens: 1000
        });

        this.tools = this.createTools();
    }

    private async handleCaptcha(): Promise<boolean> {
        if (!this.page) return false;
        
        try {
            // Common CAPTCHA identifiers
            const captchaSelectors = [
                'iframe[src*="recaptcha"]',
                'iframe[src*="hcaptcha"]',
                'iframe[src*="captcha"]',
                '#captcha',
                '.captcha',
                '[class*="captcha"]',
                '[id*="captcha"]',
                'iframe[title*="reCAPTCHA"]',
                '[aria-label*="captcha"]',
                'form[action*="captcha"]'
            ];

            // Check for presence of any CAPTCHA
            const hasCaptcha = await this.page.evaluate((selectors) => {
                return selectors.some(selector => {
                    const elements = document.querySelectorAll(selector);
                    return elements.length > 0;
                });
            }, captchaSelectors);

            if (hasCaptcha) {
                console.log('⚠️ CAPTCHA detected, attempting to handle...');
                
                // Try to switch to CAPTCHA iframe if it exists
                const iframeHandle = await this.page.$('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[title*="reCAPTCHA"]');
                if (iframeHandle) {
                    const frame = await iframeHandle.contentFrame();
                    if (frame) {
                        // Try to find and click the checkbox
                        await frame.waitForSelector('.recaptcha-checkbox-border, .checkbox', { timeout: 5000 });
                        await frame.click('.recaptcha-checkbox-border, .checkbox');
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }

                // Check if CAPTCHA is still present
                const stillHasCaptcha = await this.page.evaluate((selectors) => {
                    return selectors.some(selector => {
                        const elements = document.querySelectorAll(selector);
                        return elements.length > 0;
                    });
                }, captchaSelectors);

                if (stillHasCaptcha) {
                    console.log('❌ Unable to automatically solve CAPTCHA');
                    return false;
                }
            }
            return true;
        } catch (error) {
            console.error('Error handling CAPTCHA:', error);
            return false;
        }
    }

    private async waitForPageLoad(options: { timeout?: number } = {}): Promise<void> {
        if (!this.page) throw new Error("Browser not initialized");
        
        const timeout = options.timeout || 30000;
        try {
            // Wait for network to be idle
            await this.page.waitForNavigation({ 
                waitUntil: 'networkidle2',
                timeout 
            });

            // Add random delay to simulate human behavior
            const randomDelay = Math.floor(Math.random() * 2000) + 1000;
            await new Promise(resolve => setTimeout(resolve, randomDelay));

            // Check for CAPTCHA
            const captchaHandled = await this.handleCaptcha();
            if (!captchaHandled) {
                throw new Error("CAPTCHA detected and could not be handled automatically");
            }
        } catch (error) {
            console.error('Error during page load:', error);
            throw error;
        }
    }

    private createTools(): DynamicStructuredTool<any>[] {
        const self = this;
        return [
            new DynamicStructuredTool({
                name: 'handle_url',
                description: 'Navigates to a specific URL',
                schema: z.object({
                    url: z.string().describe("URL to navigate to"),
                    explanation: z.string().describe("Reason for navigation"),
                    action: z.string().describe("Action description")
                }),
                func: async ({ url }: ToolArgs) => {
                    if (!self.page) throw new Error("Browser not initialized");
                    await self.page.goto(url!, { 
                        waitUntil: 'networkidle2',
                        timeout: 30000 
                    });
                    await self.waitForPageLoad();
                    return "Navigation successful";
                }
            }),
            new DynamicStructuredTool({
                name: 'handle_search',
                description: 'Performs a web search',
                schema: z.object({
                    query: z.string().describe("Search query"),
                    explanation: z.string().describe("Reason for search"),
                    action: z.string().describe("Action description")
                }),
                func: async ({ query }: ToolArgs) => {
                    if (!self.page) throw new Error("Browser not initialized");
                    if (!query) throw new Error("Query is required");
                    
                    // Use DuckDuckGo instead of Google to avoid CAPTCHAs
                    await self.page.goto(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`, {
                        waitUntil: 'networkidle2',
                        timeout: 30000
                    });
                    await self.waitForPageLoad();
                    return "Search executed";
                }
            }),
            new DynamicStructuredTool({
                name: 'handle_click',
                description: 'Clicks on a specific element',
                schema: z.object({
                    text: z.string().describe("Text of element to click"),
                    explanation: z.string().describe("Reason for clicking"),
                    action: z.string().describe("Action description")
                }),
                func: async ({ text }: ToolArgs) => {
                    if (!self.page) throw new Error("Browser not initialized");
                    await self.page.waitForSelector('[gpt-link-text], [gpt-alt-text]', { timeout: 5000 });
                    const elements = await self.page.$$('[gpt-link-text], [gpt-alt-text]');
                    
                    for (const element of elements) {
                        const elementText = await element.evaluate(el => 
                            el.getAttribute('gpt-link-text') || el.getAttribute('gpt-alt-text')
                        );
                        if (elementText?.toLowerCase() === text!.toLowerCase()) {
                            await element.hover();
                            await new Promise(resolve => setTimeout(resolve, 500));
                            await element.click();
                            await new Promise(resolve => setTimeout(resolve, 2000));
                            return "Click successful";
                        }
                    }
                    throw new Error("Element not found");
                }
            }),
            new DynamicStructuredTool({
                name: 'handle_scroll',
                description: 'Scrolls the page',
                schema: z.object({
                    direction: z.enum(['up', 'down']).describe("Scroll direction"),
                    explanation: z.string().describe("Reason for scrolling"),
                    action: z.string().describe("Action description")
                }),
                func: async () => {
                    if (!self.page) throw new Error("Browser not initialized");
                    const viewportHeight = await self.page.evaluate(() => window.innerHeight);
                    await self.page.evaluate((height) => window.scrollBy(0, height), viewportHeight);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    return "Scroll completed";
                }
            }),
            new DynamicStructuredTool({
                name: 'handle_typing',
                description: 'Types text into an input field',
                schema: z.object({
                    text: z.string().describe("Text to type"),
                    placeholder_value: z.string().describe("Placeholder text of the input"),
                    explanation: z.string().describe("Reason for typing"),
                    action: z.string().describe("Action description")
                }),
                func: async ({ text, placeholder_value }: ToolArgs) => {
                    if (!self.page) throw new Error("Browser not initialized");
                    const input = await self.page.$(`input[placeholder="${placeholder_value}"]`);
                    if (!input) throw new Error("Input not found");
                    
                    await input.hover(); // Hover before typing
                    await self.simulateHumanDelay();
                    await self.simulateHumanTyping(text!);
                    await self.simulateHumanDelay();
                    await input.press('Enter');
                    await self.simulateHumanDelay();
                    return "Typing completed";
                }
            })
        ];
    }

    async initialize() {
        this.browser = await puppeteer.launch({
            headless: false,
            args: [
                '--window-size=1440,900',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--no-sandbox',
                '--disable-setuid-sandbox'
            ]
        });
        this.page = await this.browser.newPage();
        await this.page.setViewport({ width: 1440, height: 900 });
        
        // Set a more realistic user agent
        await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        
        // Enable JavaScript and cookies
        await this.page.setJavaScriptEnabled(true);
        
        // Add human-like behavior settings
        await this.page.setDefaultNavigationTimeout(30000);
        
        // Add random mouse movements
        if (this.page) {
            await this.page.evaluate(() => {
                let lastX = 0;
                let lastY = 0;
                document.addEventListener('mousemove', (e) => {
                    const deltaX = e.clientX - lastX;
                    const deltaY = e.clientY - lastY;
                    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
                    if (distance > 5) {
                        lastX = e.clientX;
                        lastY = e.clientY;
                    }
                });
            });
        }
    }

    private async simulateHumanDelay() {
        const baseDelay = Math.random() * 1000 + 500; // 500-1500ms base delay
        const randomVariation = Math.random() * 500; // 0-500ms additional random variation
        await new Promise(resolve => setTimeout(resolve, baseDelay + randomVariation));
    }

    private async simulateHumanTyping(text: string): Promise<void> {
        if (!this.page) return;
        
        const chars = text.split('');
        for (const char of chars) {
            const delay = Math.random() * 100 + 50; // 50-150ms between keystrokes
            await new Promise(resolve => setTimeout(resolve, delay));
            await this.page.keyboard.type(char);
        }
    }

    private async capturePageState(): Promise<string | null> {
        if (!this.page) return null;
        try {
            await this.page.evaluate(highlightLinks);
            return await this.page.screenshot({ encoding: 'base64' });
        } catch (e) {
            console.error(`Error capturing page state: ${e}`);
            return null;
        }
    }

    async performTask(task: string) {
        if (!this.page) throw new Error('Browser not initialized');
        console.log('\n=== Starting New Task ===');
        console.log('Task:', task);

        const messages = [
            new SystemMessage(SYSTEM_PROMPT),
            new HumanMessage(task)
        ];

        let stepCount = 0;
        const MAX_STEPS = 15;
        
        while (stepCount < MAX_STEPS) {
            console.log(`\n=== Step ${stepCount + 1} ===`);
            try {
                console.log('Invoking AI model...');
                const response = await this.model.invoke(messages);
                console.log('AI Response:', response.content);
                
                const content = response.content.toString();
                
                // Extract the first tool call if it exists
                const toolCallMatch = content.match(/handle_\w+\(\{[^}]+\}\)/);
                
                if (toolCallMatch) {
                    const toolCallString = toolCallMatch[0];
                    try {
                        const toolMatch = toolCallString.match(/handle_(\w+)\((.*)\)/);
                        if (toolMatch) {
                            const toolName = `handle_${toolMatch[1]}`;
                            const args = JSON.parse(toolMatch[2]);
                            
                            console.log(`Executing tool call: ${toolName}`);
                            const tool = this.tools.find(t => t.name === toolName);
                            if (!tool) {
                                throw new Error(`Tool ${toolName} not found`);
                            }
                            
                            const result = await tool.invoke(args);
                            console.log('Tool execution result:', result);
                            
                            const screenshot = await this.capturePageState();
                            const messageContent = screenshot 
                                ? [
                                    { type: 'text', text: `Action result: ${result}` },
                                    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${screenshot}` } }
                                ]
                                : `Action result: ${result}`;
                            
                            messages.push(new HumanMessage({ content: messageContent }));
                            stepCount++;
                            continue;
                        }
                    } catch (e: any) {
                        console.error('Error executing tool call:', e);
                        messages.push(new HumanMessage({ content: `Error: ${e.message}` }));
                        stepCount++;
                        continue;
                    }
                }
                
                // If no tool call is found, this is the final answer
                if (this.isFinalAnswer(content)) {
                    const finalResponse = {
                        status: "complete",
                        final_answer: content,
                        timestamp: new Date().toISOString()
                    };
                    console.log('Final Response:', JSON.stringify(finalResponse, null, 2));
                    return finalResponse;
                }
                
                messages.push(response);
                stepCount++;

            } catch (error) {
                console.error('❌ Error during task execution:', error);
                break;
            }
        }

        if (stepCount >= MAX_STEPS) {
            console.log('⚠️ Task reached maximum number of steps:', MAX_STEPS);
            return {
                status: "incomplete",
                error: "Maximum steps reached",
                timestamp: new Date().toISOString()
            };
        }

        return {
            status: "incomplete",
            error: "Task ended without completion",
            timestamp: new Date().toISOString()
        };
    }

    private isFinalAnswer(content: string): boolean {
        // Simple check - if there's no tool call, it's a final answer
        return !content.includes('handle_');
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            console.log('Browser closed');
        }
    }
}

async function searchAppleStock() {
    const agent = new AIBrowserAgent();
    try {
        await agent.initialize();
        await agent.performTask("serach for the latest yt video from mr beast and show me the top 5 comments from that video ");
    } catch (error) {
        console.error('Error:', error);
    } finally {
        // await agent.close();
    }
}

// Run the example
searchAppleStock();

export { AIBrowserAgent, searchAppleStock };