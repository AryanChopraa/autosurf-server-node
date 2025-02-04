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
    private SCREENSHOT_FILE_NAME = "screenshot.jpg";
    private SCREENSHOTS_DIR = "screenshots";
    private prev_message = "";
    private sharedState: Map<string, string> = new Map();
    private executedCommands: Array<{
        command: string;
        selector?: string;
        value?: string;
        url?: string;
    }> = [];

    constructor() {
        this.client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
        // Create screenshots directory if it doesn't exist
        if (!fs.existsSync(this.SCREENSHOTS_DIR)) {
            fs.mkdirSync(this.SCREENSHOTS_DIR);
        }
    }

    async initialize() {
        console.log('Starting browser...');
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


        // if (message.toLowerCase().includes("[send screenshot]")) {
        //     await this.removeHighlights();
        //     await this.takeScreenshot();
        //     return "Here is the screenshot of the current web page:";
        // }

        // if (message.toLowerCase().includes("[highlight clickable elements]")) {
        //     await this.highlightClickableElements();
        //     await this.takeScreenshot();

        //     const elementTexts = await this.getHighlightedElementTexts();
        //     const elementTextsFormatted = this.formatElementTexts(elementTexts);

        //     return `Here is the screenshot of the current web page with highlighted clickable elements. \n\n` +
        //            `Texts of the elements are: ${elementTextsFormatted}.\n\n` +
        //            `Elements without text are not shown, but are available on screenshot. \n` +
        //            `Please make sure to analyze the screenshot to find the clickable element you need to click on.`;
        // }

        // if (message.toLowerCase().includes("[highlight text fields]")) {
        //     await this.highlightTextFields();
        //     await this.takeScreenshot();

        //     const elementTexts = await this.getHighlightedElementTexts();
        //     const elementTextsFormatted = this.formatElementTexts(elementTexts);

        //     return `Here is the screenshot of the current web page with highlighted text fields: \n` +
        //            `Texts of the elements are: ${elementTextsFormatted}.\n` +
        //            `Please make sure to analyze the screenshot to find the text field you need to fill.`;
        // }

        // if (message.toLowerCase().includes("[highlight dropdowns]")) {
        //     await this.highlightDropdowns();
        //     await this.takeScreenshot();

        //     const dropdownValues = await this.getDropdownValues();
        //     const dropdownValuesFormatted = this.formatDropdownValues(dropdownValues);

        //     return `Here is the screenshot with highlighted dropdowns. \n` +
        //            `Selector values are: ${dropdownValuesFormatted}.\n` +
        //            `Please make sure to analyze the screenshot to find the dropdown you need to select.`;
        // }

        return message;
    }

    private async highlightClickableElements() {
        if (!this.page) return;
        await this.page.evaluate(HIGHLIGHT_ELEMENTS_SCRIPT);
    }

    // private async highlightTextFields() {
    //     if (!this.page) return;
    //     await this.page.evaluate(HIGHLIGHT_TEXT_FIELDS_SCRIPT);
    // }

    // private async highlightDropdowns() {
    //     if (!this.page) return;
    //     await this.page.evaluate(HIGHLIGHT_DROPDOWNS_SCRIPT);
    // }

    private async removeHighlights() {
        if (!this.page) return;
        await this.page.evaluate(REMOVE_HIGHLIGHTS_SCRIPT);
    }

    // private async getHighlightedElementTexts(): Promise<string[]> {
    //     if (!this.page) return [];
    //     return await this.page.evaluate(() => {
    //         const elements = document.querySelectorAll('.highlighted-element');
    //         return Array.from(elements).map(el => el.textContent || '').filter(text => text.trim() !== '');
    //     });
    // }

    // private async getDropdownValues(): Promise<Record<string, string[]>> {
    //     if (!this.page) return {};
    //     return await this.page.evaluate(() => {
    //         const dropdowns = document.querySelectorAll('select.highlighted-element');
    //         const values: Record<string, string[]> = {};
    //         dropdowns.forEach((dropdown, index) => {
    //             const options = Array.from(dropdown.querySelectorAll('option'));
    //             values[String(index + 1)] = options.map(opt => opt.textContent || '').slice(0, 10);
    //         });
    //         return values;
    //     });
    // }

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

    private async takeScreenshot(): Promise<void> {
        if (!this.page) return;
        // Clean up previous screenshot if it exists
        if (fs.existsSync(this.SCREENSHOT_FILE_NAME)) {
            fs.unlinkSync(this.SCREENSHOT_FILE_NAME);
        }
        const screenshot = await this.page.screenshot({ encoding: 'base64' });
        if (typeof screenshot === 'string') {
            const buffer = Buffer.from(screenshot, 'base64');
            fs.writeFileSync(this.SCREENSHOT_FILE_NAME, buffer);
        }
    }

    private async createResponseContent(responseText: string): Promise<any[]> {
        const fileContent = fs.readFileSync(this.SCREENSHOT_FILE_NAME);
        const file = new File([fileContent], this.SCREENSHOT_FILE_NAME, { type: 'image/jpeg' });
        const fileId = await this.client.files.create({
            file,
            purpose: "vision",
        }).then(response => response.id);

        // Clean up the screenshot after uploading
        if (fs.existsSync(this.SCREENSHOT_FILE_NAME)) {
            fs.unlinkSync(this.SCREENSHOT_FILE_NAME);
        }

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
                fullPage: false, // Only capture visible portion
                type: 'jpeg',
                quality: 100 // Maximum quality
            });
            
            if (typeof screenshot === 'string' && stepCount > 1) {
                // Save screenshot with step number
                const stepScreenshotPath = `${this.SCREENSHOTS_DIR}/screenshot-step${stepCount}.jpg`;
                const buffer = Buffer.from(screenshot, 'base64');
                fs.writeFileSync(stepScreenshotPath, buffer);
                console.log(`Screenshot saved: ${stepScreenshotPath}`);
            }
            
            return typeof screenshot === 'string' ? screenshot : null;
        } catch (e) {
            console.error('Error capturing page state:', e);
            return null;
        }
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
            this.highlightClickableElements();

            // Execute the action using the appropriate tool
            let result: string;
            switch (name) {
                case 'handle_url':
                    if (!this.navigationTool) throw new Error('Navigation tool not initialized');
                    result = await this.navigationTool.run(parsedArgs.url);
                    this.executedCommands.push({
                        command: 'goto',
                        url: parsedArgs.url
                    });
                    break;
                
                case 'handle_search':
                    if (!this.searchTool) throw new Error('Search tool not initialized');
                    result = await this.searchTool.run(parsedArgs.query);
                    this.executedCommands.push({
                        command: 'type',
                        selector: '[name="q"]',
                        value: parsedArgs.query
                    });
                    break;
                
                case 'handle_click':
                    if (!this.clickTool) throw new Error('Click tool not initialized');
                    result = await this.clickTool.run(parsedArgs.identifier);
                    this.executedCommands.push({
                        command: 'click',
                        selector: parsedArgs.identifier
                    });
                    break;
                
                case 'handle_typing':
                    if (!this.typingTool) throw new Error('Typing tool not initialized');
                    result = await this.typingTool.run(parsedArgs.placeholder_value, parsedArgs.text);
                    this.executedCommands.push({
                        command: 'type',
                        selector: `[placeholder="${parsedArgs.placeholder_value}"]`,
                        value: parsedArgs.text
                    });
                    break;

                case 'handle_typing_with_enter':
                    if (!this.typingWithEnterTool) throw new Error('Typing with Enter tool not initialized');
                    result = await this.typingWithEnterTool.run(parsedArgs.placeholder_value, parsedArgs.text);
                    this.executedCommands.push({
                        command: 'typeAndEnter',
                        selector: `[placeholder="${parsedArgs.placeholder_value}"]`,
                        value: parsedArgs.text
                    });
                    break;
                
                case 'handle_captcha':
                    if (!this.captchaSolver) throw new Error('Captcha solver not initialized');
                    result = await this.captchaSolver.run();
                    this.executedCommands.push({
                        command: 'solveCaptcha'
                    });
                    break;
                
                case 'scroll_down':
                    if (!this.scrollTool) throw new Error('Scroll tool not initialized');
                    result = await this.scrollTool.run();
                    this.executedCommands.push({
                        command: 'scroll'
                    });
                    break;
                
                case 'handle_back':
                    if (!this.backTool) throw new Error('Back tool not initialized');
                    result = await this.backTool.run();
                    this.executedCommands.push({
                        command: 'back'
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

    // Add method to get executed commands
    public getExecutedCommands(): string {
        let scriptContent = `const puppeteer = require('puppeteer');\n\n`;
        scriptContent += `(async () => {
    const browser = await puppeteer.launch({
        headless: false,
        args: ['--window-size=1440,900']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });\n\n`;

        for (const cmd of this.executedCommands) {
            switch (cmd.command) {
                case 'goto':
                    scriptContent += `    await page.goto('${cmd.url}');\n`;
                    break;
                case 'click':
                    scriptContent += `    await page.click('${cmd.selector}');\n`;
                    break;
                case 'type':
                    scriptContent += `    await page.type('${cmd.selector}', '${cmd.value}');\n`;
                    break;
                case 'typeAndEnter':
                    scriptContent += `    await page.type('${cmd.selector}', '${cmd.value}');\n`;
                    scriptContent += `    await page.keyboard.press('Enter');\n`;
                    break;
                case 'scroll':
                    scriptContent += `    await page.evaluate(() => window.scrollBy(0, 500));\n`;
                    break;
                case 'back':
                    scriptContent += `    await page.goBack();\n`;
                    break;
            }
            scriptContent += `    await page.waitForTimeout(1000);\n`;
        }

        scriptContent += `    // await browser.close();\n`;
        scriptContent += `})();`;

        return scriptContent;
    }

    async performTask(task: string) {
        if (!this.page) throw new Error('Browser not initialized');
        console.log('\n=== 🚀 Starting New Task ===');
        console.log('📝 Task:', task);

        // Clean up screenshots directory at the start of each task
        if (fs.existsSync(this.SCREENSHOTS_DIR)) {
            fs.readdirSync(this.SCREENSHOTS_DIR).forEach(file => {
                fs.unlinkSync(`${this.SCREENSHOTS_DIR}/${file}`);
            });
        }

        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: task }
        ];

        let stepCount = 0;
        const MAX_STEPS = 25;

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

                    // Add this block to handle final answers without tool calls
                    if (!response.tool_calls) {
                        console.log('\n✅ Final answer received (no tool calls):', validatedResponse);
                        messages.push({ role: 'assistant', content: validatedResponse });
                        break;
                    }
                }

                if (response.tool_calls) {
                    console.log('\n🛠️ Executing tool calls...');
                    stepCount++;
                    const screenshot = await this.executeAction(response.tool_calls[0], stepCount);
                    console.log('Tool execution result:', screenshot ? 'Success' : 'Failed');

                    if (screenshot) {
                        console.log('Adding screenshot to messages');
                        messages.push({
                            role: 'user',
                            content: [
                                { type: 'text', text: `Here is the screenshot after executing: ${response.tool_calls[0].function.name}` },
                                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${screenshot}` } }
                            ] as OpenAI.Chat.ChatCompletionContentPart[]
                        });
                    }
                } else {
                    console.log('\n✅ Final answer received:', response.content);
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

        // At the end of performTask, print the executed commands
        console.log('\n=== 📝 Executed Commands ===');
        console.log(this.getExecutedCommands());
        
        if (stepCount >= MAX_STEPS) {
            console.log('⚠️ Maximum steps reached. Task may not be complete.');
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