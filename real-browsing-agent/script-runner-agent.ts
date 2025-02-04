import * as puppeteer from 'puppeteer';
import OpenAI from 'openai';
import { CaptchaSolverTool } from './tools/CaptchaSolverTool';

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

export class ScriptRunnerAgent {
    private browser: puppeteer.Browser | null = null;
    private page: puppeteer.Page | null = null;
    private client: OpenAI;
    private captchaSolver: CaptchaSolverTool | null = null;

    constructor() {
        // Load environment variables
        require('dotenv').config();
        
        this.client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
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
        
        if (this.page) {
            this.captchaSolver = new CaptchaSolverTool(this.page, this.client);
        }
        
        console.log('Browser started successfully');
    }

    private async detectCaptcha(): Promise<boolean> {
        if (!this.page) {
            console.log('🔒 CAPTCHA Detection: Page not initialized');
            return false;
        }

        try {
            console.log('🔒 Starting CAPTCHA detection...');
            const captchaSelectors = [
                'iframe[src*="recaptcha"][src*="anchor"]',
                'iframe[src*="hcaptcha"][src*="challenge"]',
                '#captcha:not([style*="display: none"])',
                '.captcha:not([style*="display: none"])',
                '[class*="captcha"]:not([style*="display: none"])',
                '[id*="captcha"]:not([style*="display: none"])',
                'iframe[title*="reCAPTCHA"]:not([style*="display: none"])',
                '[aria-label*="captcha"]:not([style*="display: none"])',
                'form[action*="captcha"]:not([style*="display: none"])'
            ];

            for (const selector of captchaSelectors) {
                console.log(`🔒 Checking selector: ${selector}`);
                const elements = await this.page.$$(selector);
                
                for (const element of elements) {
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

                    if (elementInfo.isVisible) {
                        console.log(`🔒 Found visible CAPTCHA element with selector: ${selector}`);
                        return true;
                    }
                }
            }

            console.log('🔒 No valid CAPTCHA elements found');
            return false;

        } catch (error) {
            console.error('🔒 Error in CAPTCHA detection:', error);
            return false;
        }
    }

    private async handleCaptchaIfPresent(): Promise<boolean> {
        const hasCaptcha = await this.detectCaptcha();
        if (hasCaptcha && this.captchaSolver) {
            console.log('🔒 CAPTCHA detected, attempting to solve...');
            const solved = await this.captchaSolver.run();
            return solved.includes('Success');
        }
        return true;
    }

    async executeScript(scriptContent: string) {
        if (!this.page) throw new Error('Browser not initialized');
        
        try {
            // Parse the script to extract individual commands
            const commands = this.parseScriptCommands(scriptContent);
            
            // Execute each command with CAPTCHA checking
            for (const command of commands) {
                // Check for CAPTCHA before each action
                const captchaSolved = await this.handleCaptchaIfPresent();
                if (!captchaSolved) {
                    throw new Error('Failed to solve CAPTCHA');
                }

                // Execute the command
                console.log(`Executing command: ${command.type}`, command.params);
                await this.executeCommand(command);
                
                // Wait for any navigation or network activity to settle
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            console.log('Script execution completed successfully');
            
        } catch (error) {
            console.error('Script execution failed:', error);
            throw error;
        }
    }

    private parseScriptCommands(scriptContent: string): Array<{
        type: string;
        params: any;
    }> {
        const commands: Array<{ type: string; params: any }> = [];
        
        // Extract commands using regex
        const commandRegex = /await page\.(\w+)\((.*)\);/g;
        let match;
        
        while ((match = commandRegex.exec(scriptContent)) !== null) {
            const [_, commandType, argsString] = match;
            
            // Parse the arguments
            let params;
            try {
                // Handle different argument formats
                if (argsString.includes('=>')) {
                    // Handle function arguments (like in evaluate)
                    params = { fn: argsString };
                } else {
                    // Handle regular arguments
                    params = argsString
                        .split(',')
                        .map(arg => {
                            try {
                                return JSON.parse(arg.trim());
                            } catch {
                                // If JSON.parse fails, return the string without quotes
                                return arg.trim().replace(/['"]/g, '');
                            }
                        });
                }
            } catch (error) {
                console.warn(`Failed to parse arguments for command ${commandType}:`, error);
                params = [];
            }
            
            commands.push({ type: commandType, params });
        }
        
        return commands;
    }

    private async executeCommand(command: { type: string; params: any }) {
        if (!this.page) throw new Error('Page not initialized');
        
        switch (command.type) {
            case 'goto':
                await this.page.goto(command.params[0]);
                break;
                
            case 'click':
                await this.page.click(command.params[0]);
                break;
                
            case 'type':
                await this.page.type(command.params[0], command.params[1]);
                break;
                
            case 'keyboard.press':
                await this.page.keyboard.press(command.params[0]);
                break;
                
            case 'evaluate':
                await this.page.evaluate(command.params.fn);
                break;
                
            case 'waitForTimeout':
                await new Promise(resolve => setTimeout(resolve, command.params[0]));
                break;
                
            default:
                throw new Error(`Unknown command type: ${command.type}`);
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            console.log('Browser closed');
        }
    }
} 