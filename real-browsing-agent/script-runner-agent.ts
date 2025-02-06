import * as puppeteer from 'puppeteer';
import OpenAI from 'openai';
import { CaptchaSolverTool } from './tools/CaptchaSolverTool';
import { NavigationTool } from './tools/NavigationTool';
import { SearchTool } from './tools/SearchTool';
import { ClickTool } from './tools/ClickTool';
import { TypingTool } from './tools/TypingTool';
import { TypingWithEnterTool } from './tools/TypingWithEnterTool';
import { ScrollTool } from './tools/ScrollTool';
import { BackTool } from './tools/BackTool';
import { ScriptCommand, ElementInfo } from '../types';

export class ScriptRunnerAgent {
    private browser: puppeteer.Browser | null = null;
    private page: puppeteer.Page | null = null;
    private client: OpenAI;
    
    // Tools
    private navigationTool: NavigationTool | null = null;
    private searchTool: SearchTool | null = null;
    private clickTool: ClickTool | null = null;
    private typingTool: TypingTool | null = null;
    private typingWithEnterTool: TypingWithEnterTool | null = null;
    private captchaSolver: CaptchaSolverTool | null = null;
    private scrollTool: ScrollTool | null = null;
    private backTool: BackTool | null = null;

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
            // Initialize all tools
            this.navigationTool = new NavigationTool(this.page, this.client);
            this.searchTool = new SearchTool(this.page, this.client);
            this.clickTool = new ClickTool(this.page, this.client);
            this.typingTool = new TypingTool(this.page, this.client);
            this.typingWithEnterTool = new TypingWithEnterTool(this.page, this.client);
            this.captchaSolver = new CaptchaSolverTool(this.page, this.client);
            this.scrollTool = new ScrollTool(this.page, this.client);
            this.backTool = new BackTool(this.page, this.client);
        }
        
        console.log('Browser and tools initialized successfully');
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

    async executeCommands(commands: ScriptCommand[]) {
        if (!this.page) throw new Error('Browser not initialized');
        
        try {
            for (const command of commands) {
                // Check for CAPTCHA before each action
                const captchaSolved = await this.handleCaptchaIfPresent();
                if (!captchaSolved) {
                    throw new Error('Failed to solve CAPTCHA');
                }

                // Execute the command using the appropriate tool
                console.log(`Executing command: ${command.type}`, command);
                await this.executeCommand(command);
                
                // Wait for any navigation or network activity to settle
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            console.log('Commands execution completed successfully');
            
        } catch (error) {
            console.error('Commands execution failed:', error);
            throw error;
        }
    }

    private async executeCommand(command: ScriptCommand) {
        if (!this.page) throw new Error('Page not initialized');
        
        try {
            switch (command.type) {
                case 'navigation':
                    if (!this.navigationTool) throw new Error('Navigation tool not initialized');
                    if (command.url) {
                        await this.navigationTool.run(command.url);
                    }
                    break;
                    
                case 'click':
                    if (!this.clickTool) throw new Error('Click tool not initialized');
                    if (command.identifier) {
                        await this.clickTool.run(command.identifier);
                    }
                    break;
                    
                case 'type':
                case 'typeAndEnter':
                    const tool = command.type === 'type' ? this.typingTool : this.typingWithEnterTool;
                    if (!tool) throw new Error(`${command.type} tool not initialized`);
                    if (command.placeholder_value && command.text) {
                        await tool.run(command.placeholder_value, command.text);
                    }
                    break;
                    
                case 'search':
                    if (!this.searchTool) throw new Error('Search tool not initialized');
                    if (command.query) {
                        await this.searchTool.run(command.query);
                    }
                    break;

                case 'scroll':
                    if (!this.scrollTool) throw new Error('Scroll tool not initialized');
                    await this.scrollTool.run();
                    break;

                case 'back':
                    if (!this.backTool) throw new Error('Back tool not initialized');
                    await this.backTool.run();
                    break;

                case 'solveCaptcha':
                    if (!this.captchaSolver) throw new Error('Captcha solver not initialized');
                    await this.captchaSolver.run();
                    break;
                    
                default:
                    throw new Error(`Unknown command type: ${command.type}`);
            }
            
            // Add a small delay after each command for stability
            await new Promise(resolve => setTimeout(resolve, 500));
            
        } catch (error) {
            console.error(`Failed to execute command ${command.type}:`, error);
            throw error;
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            console.log('Browser closed');
        }
    }
} 