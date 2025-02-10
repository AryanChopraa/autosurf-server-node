import * as puppeteer from 'puppeteer';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { TOOLS } from './tools/Tools';
import { SYSTEM_PROMPT } from './utils/Prompts';
import { NavigationTool } from './tools/NavigationTool';
import { SearchTool } from './tools/SearchTool';
import { ClickTool } from './tools/ClickTool';
import { TypingTool } from './tools/TypingTool';
import { TypingWithEnterTool } from './tools/TypingWithEnterTool';
import { CaptchaSolverTool } from './tools/CaptchaSolverTool';
import { ScrollTool } from './tools/ScrollTool';
import { BackTool } from './tools/BackTool';
import { 
    HIGHLIGHT_ELEMENTS_SCRIPT, 
    REMOVE_HIGHLIGHTS_SCRIPT 
} from './utils/HighlightScript';
import { ScriptCommand } from '../types';
import fs from 'fs';

dotenv.config();

// Create a WebDriver adapter for the window object
interface WebDriverAdapter {
    executeScript(script: string): void;
}

function createWebDriverAdapter(window: Window): WebDriverAdapter {
    return {
        executeScript: (script: string) => {
            Function(script).call(window);
        }
    };
}

class AIBrowserAgent {
    private browser: puppeteer.Browser | null = null;
    private page: puppeteer.Page | null = null;
    private client: OpenAI;
    private navigationTool: NavigationTool | null = null;
    private searchTool: SearchTool | null = null;
    private clickTool: ClickTool | null = null;
    private typingTool: TypingTool | null = null;
    private typingWithEnterTool: TypingWithEnterTool | null = null;
    private captchaSolver: CaptchaSolverTool | null = null;
    private scrollTool: ScrollTool | null = null;
    private backTool: BackTool | null = null;
    private prev_message = "";
    private sharedState: Map<string, string> = new Map();
    private executedCommands: ScriptCommand[] = [];
    private steps: { number: number; action: string; explanation: string; }[] = [];
    public onStepUpdate: ((step: { number: number; action: string; explanation: string; }) => void) | null = null;

    constructor() {
        this.client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }

    async initialize() {
        console.log('Starting browser...');
        this.browser = await puppeteer.launch({
            headless: true,
            args: [
                '--window-size=1440,900',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ],
            executablePath: '/usr/bin/google-chrome'
        });

 
        this.page = await this.browser.newPage();
        await this.page.setViewport({ width: 1440, height: 900 });
        
        // Set a more realistic user agent
        await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        
        // Initialize tools
        if (this.page) {
            this.navigationTool = new NavigationTool(this.page, this.client);
            this.searchTool = new SearchTool(this.page, this.client);
            this.clickTool = new ClickTool(this.page, this.client);
            this.typingTool = new TypingTool(this.page, this.client);
            this.typingWithEnterTool = new TypingWithEnterTool(this.page, this.client);
            this.captchaSolver = new CaptchaSolverTool(this.page, this.client);
            this.scrollTool = new ScrollTool(this.page, this.client);
            this.backTool = new BackTool(this.page, this.client);
        }
        
        console.log('Browser started successfully');
    }

    private async responseValidator(message: string): Promise<string> {
        // Filter out everything in square brackets
        const filteredMessage = message.replace(/\[.*?\]/g, "").trim();

        if (filteredMessage && this.prev_message === filteredMessage) {
            throw new Error(
                "Do not repeat yourself. If you are stuck, try a different approach or search in google for the page you are looking for directly."
            );
        }

        this.prev_message = filteredMessage;
        if (message) {
            await this.removeHighlights();
            await this.highlightClickableElements();
        }

        return message;
    }

    private async highlightClickableElements() {
        if (!this.page) return;
        await this.page.evaluate(HIGHLIGHT_ELEMENTS_SCRIPT);
    }

    private async removeHighlights() {
        if (!this.page) return;
        await this.page.evaluate(REMOVE_HIGHLIGHTS_SCRIPT);
    }

    private removeUnicode(text: string): string {
        return text.replace(/[^\x00-\x7F]+/g, '');
    }

    private formatElementTexts(texts: string[]): string {
        const elementTextsJson: Record<string, string> = {};
        texts.forEach((text, i) => {
            const cleanText = this.removeUnicode(text);
            if (cleanText) {
                elementTextsJson[String(i + 1)] = cleanText;
            }
        });
        return Object.entries(elementTextsJson)
            .map(([key, value]) => `${key}: ${value}`)
            .join(', ');
    }

    private formatDropdownValues(values: Record<string, string[]>): string {
        return Object.entries(values)
            .map(([key, options]) => `${key}: [${options.join(', ')}]`)
            .join(', ');
    }

    private async createResponseContent(responseText: string): Promise<any[]> {
        const screenshot = await this.page?.screenshot({ 
            encoding: 'base64',
            type: 'jpeg',
            quality: 80
        });

        if (!screenshot) {
            return [{ type: "text", text: responseText }];
        }

        const file = new File([Buffer.from(screenshot, 'base64')], 'screenshot.jpg', { type: 'image/jpeg' });
        const fileId = await this.client.files.create({
            file,
            purpose: "vision",
        }).then(response => response.id);

        return [
            { type: "text", text: responseText },
            { type: "image_file", image_file: { file_id: fileId } },
        ];
    }

    private async capturePageState(stepCount: number): Promise<string | null> {
        if (!this.page) return null;
        try {
            await this.page.waitForNetworkIdle({ timeout: 2000 }).catch(() => {});
            
            await this.page.evaluate(() => {
                document.querySelectorAll('[class*="overlay"], [class*="popup"], [class*="modal"]')
                    .forEach(el => el.remove());
            });

            const screenshot = await this.page.screenshot({ 
                encoding: 'base64',
                fullPage: false,
                type: 'jpeg',
                quality: 80
            });
            
            return typeof screenshot === 'string' ? screenshot : null;
        } catch (e) {
            console.error('Error capturing page state:', e);
            return null;
        }
    }

    // Add public method for capturing screenshots
    public async captureScreenshot(): Promise<string | null> {
        return this.capturePageState(0);  // Step count is not relevant for periodic screenshots
    }

    private async executeAction(toolCall: OpenAI.ChatCompletionMessageToolCall, stepCount: number): Promise<string | null> {
        if (!this.page) return null;

        const { function: { name, arguments: functionArgs } } = toolCall;
        const parsedArgs = JSON.parse(functionArgs);
        console.log("The explanation is:", parsedArgs.explanation);
        console.log("The action is:", parsedArgs.action);

        try {
            const hasCaptcha = await this.detectCaptcha();
            console.log('🔒 CAPTCHA detected:', hasCaptcha);

            if (hasCaptcha && this.captchaSolver) {
                console.log('🔒 CAPTCHA detected before action');
                const solved = await this.captchaSolver.run();
                if (!solved.includes('Success')) {
                    throw new Error('Failed to solve initial CAPTCHA');
                }
            }

            // Execute the action using the appropriate tool
            let result: string;
            switch (name) {
                case 'handle_url':
                    if (!this.navigationTool) throw new Error('Navigation tool not initialized');
                    result = await this.navigationTool.run(parsedArgs.url);
                    this.executedCommands.push({
                        type: 'navigation',
                        url: parsedArgs.url
                    });
                    break;
                
                case 'handle_search':
                    if (!this.searchTool) throw new Error('Search tool not initialized');
                    result = await this.searchTool.run(parsedArgs.query);
                    this.executedCommands.push({
                        type: 'search',
                        query: parsedArgs.query
                    });
                    break;
                
                case 'handle_click':
                    if (!this.clickTool) throw new Error('Click tool not initialized');
                    result = await this.clickTool.run(parsedArgs.identifier);
                    this.executedCommands.push({
                        type: 'click',
                        identifier: parsedArgs.identifier
                    });
                    break;
                
                case 'handle_typing':
                case 'handle_typing_with_enter':
                    const tool = name === 'handle_typing' ? this.typingTool : this.typingWithEnterTool;
                    if (!tool) throw new Error(`${name} tool not initialized`);
                    result = await tool.run(parsedArgs.placeholder_value, parsedArgs.text);
                    this.executedCommands.push({
                        type: name === 'handle_typing' ? 'type' : 'typeAndEnter',
                        placeholder_value: parsedArgs.placeholder_value,
                        text: parsedArgs.text
                    });
                    break;
                
                case 'handle_captcha':
                    if (!this.captchaSolver) throw new Error('Captcha solver not initialized');
                    result = await this.captchaSolver.run();
                    this.executedCommands.push({
                        type: 'solveCaptcha'
                    });
                    break;
                
                case 'scroll_down':
                    if (!this.scrollTool) throw new Error('Scroll tool not initialized');
                    result = await this.scrollTool.run();
                    this.executedCommands.push({
                        type: 'scroll'
                    });
                    break;
                
                case 'handle_back':
                    if (!this.backTool) throw new Error('Back tool not initialized');
                    result = await this.backTool.run();
                    this.executedCommands.push({
                        type: 'back'
                    });
                    break;
                
                default:
                    throw new Error(`Unknown tool: ${name}`);
            }

            await this.page.waitForFunction(() => {
                return document.readyState !== 'loading' && document.body != null;
            }, { timeout: 1000 }).catch(() => {});

            return await this.capturePageState(stepCount);

        } catch (error) {
            console.error('Action execution failed:', error);
            throw error;
        }
    }

    private async detectCaptcha(): Promise<boolean> {
        if (!this.page) {
            console.log('🔒 CAPTCHA Detection: Page not initialized');
            return false;
        }

        try {
            console.log('🔒 Starting CAPTCHA detection...');
            const captchaSelectors = [
                'iframe[src*="recaptcha"][src*="anchor"]', // Only match interactive reCAPTCHA frames
                'iframe[src*="hcaptcha"][src*="challenge"]', // Only match interactive hCaptcha frames
                '#captcha:not([style*="display: none"])',
                '.captcha:not([style*="display: none"])',
                '[class*="captcha"]:not([style*="display: none"])',
                '[id*="captcha"]:not([style*="display: none"])',
                'iframe[title*="reCAPTCHA"]:not([style*="display: none"])',
                '[aria-label*="captcha"]:not([style*="display: none"])',
                'form[action*="captcha"]:not([style*="display: none"])'
            ];

            interface ElementInfo {
                isVisible: boolean;
                details: {
                    tagName: string;
                    id: string;
                    className: string;
                    src: string;
                    display: string;
                    visibility: string;
                    width: number;
                    height: number;
                };
            }

            for (const selector of captchaSelectors) {
                console.log(`🔒 Checking selector: ${selector}`);
                const elements = await this.page.$$(selector);
                
                for (const element of elements) {
                    // Check if element is visible and not an aframe
                    const elementInfo = await element.evaluate((el: Element): ElementInfo => {
                        const htmlEl = el as HTMLElement;
                        const style = window.getComputedStyle(htmlEl);
                        const rect = htmlEl.getBoundingClientRect();
                        const src = htmlEl.getAttribute('src');
                        const isAframe = src?.includes('api2/aframe');
                        
                        return {
                            isVisible: style.display !== 'none' && 
                                      style.visibility !== 'hidden' && 
                                      rect.width > 0 && 
                                      rect.height > 0 &&
                                      !isAframe,
                            details: {
                                tagName: htmlEl.tagName,
                                id: htmlEl.id,
                                className: htmlEl.className,
                                src: src || '',
                                display: style.display,
                                visibility: style.visibility,
                                width: rect.width,
                                height: rect.height
                            }
                        };
                    });

                    console.log(`🔒 Element details for ${selector}:`, JSON.stringify(elementInfo.details, null, 2));

                    if (elementInfo.isVisible) {
                        console.log(`🔒 Found visible CAPTCHA element with selector: ${selector}`);
                        return true;
                    } else {
                        console.log(`🔒 Found hidden/invalid CAPTCHA element with selector: ${selector}`);
                    }
                }
            }

            console.log('🔒 No valid CAPTCHA elements found');
            return false;

        } catch (error) {
            console.error('🔒 Error in CAPTCHA detection:', error);
            console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
            return false;
        }
    }

    // Update getExecutedCommands to use only ScriptRunnerAgent compatible commands
    public getExecutedCommands(): ScriptCommand[] {
        return this.executedCommands.filter(cmd => cmd.type !== 'solveCaptcha');
    }

    async performTask(task: string): Promise<{ steps: { number: number; action: string; explanation: string; }[]; finalAnswer: string }> {
        if (!this.page) throw new Error('Browser not initialized');
        console.log('\n=== 🚀 Starting New Task ===');
        console.log('📝 Task:', task);

        // Reset steps array at the start of each task
        this.steps = [];

        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: task }
        ];

        let stepCount = 0;
        const MAX_STEPS = 25;
        let finalAnswer = '';

        while (stepCount < MAX_STEPS) {
            console.log(`\n=== 📍 Step ${stepCount + 1} of ${MAX_STEPS} ===`);
            try {
                console.log('🤖 Invoking AI model...');
                const chatResponse = await this.client.chat.completions.create({
                    model: 'gpt-4o',
                    messages,
                    max_tokens: 1000,
                    tools: TOOLS
                });

                const response = chatResponse.choices[0].message;
                console.log('\n📢 AI Response:');
                console.log('Content:', response.content);
                console.log('Tool Calls:', JSON.stringify(response.tool_calls, null, 2));

                if (response.content) {
                    console.log('\n🔍 Validating response...');
                    const validatedResponse = await this.responseValidator(response.content);
                    console.log('Validated response:', validatedResponse);

                    if (validatedResponse !== response.content) {
                        console.log('Response was modified by validator');
                        const content = await this.createResponseContent(validatedResponse);
                        messages.push({ role: 'assistant', content });
                        stepCount++;
                        continue;
                    }

                    if (!response.tool_calls) {
                        console.log('\n✅ Final answer received (no tool calls):', validatedResponse);
                        finalAnswer = validatedResponse;
                        break;
                    }
                }

                if (response.tool_calls) {
                    console.log('\n🛠️ Executing tool calls...');
                    stepCount++;
                    const toolCall = response.tool_calls[0];
                    const parsedArgs = JSON.parse(toolCall.function.arguments);
                    
                    // Add step before execution
                    const newStep = {
                        number: stepCount,
                        action: parsedArgs.action,
                        explanation: parsedArgs.explanation
                    };
                    this.steps.push(newStep);

                    // Call the step update callback if it exists
                    if (this.onStepUpdate) {
                        this.onStepUpdate(newStep);
                    }

                    const screenshot = await this.executeAction(toolCall, stepCount);
                    console.log('Tool execution result:', screenshot ? 'Success' : 'Failed');

                    if (screenshot) {
                        console.log('Adding screenshot to messages');
                        messages.push({
                            role: 'user',
                            content: [
                                { type: 'text', text: `Here is the screenshot after executing: ${toolCall.function.name}` },
                                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${screenshot}` } }
                            ] as OpenAI.Chat.ChatCompletionContentPart[]
                        });
                    }
                } else {
                    console.log('\n✅ Final answer received:', response.content);
                    finalAnswer = response.content || '';
                    break;
                }
            } catch (error) {
                console.error('\n❌ Error during task execution:', error);
                console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
                
                if (error instanceof Error && error.message.includes('Do not repeat yourself')) {
                    console.log('🔄 Handling repetition error');
                    messages.push({
                        role: 'user',
                        content: 'Please try a different approach or search strategy.'
                    });
                } else {
                    throw error;
                }
            }
        }

        if (stepCount >= MAX_STEPS) {
            throw new Error('Maximum steps reached. Task could not be completed.');
        }

        return { steps: this.steps, finalAnswer };
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            console.log('Browser closed');
        }
    }
}

export { AIBrowserAgent };