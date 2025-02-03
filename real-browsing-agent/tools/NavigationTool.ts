import { BaseTool } from './BaseTools';
import { Page } from 'puppeteer';
import OpenAI from 'openai';

export class NavigationTool extends BaseTool {
    protected static override ToolConfig = {
        ...BaseTool.ToolConfig,
        strict: true,
        oneCallAtATime: true,
        outputAsResult: false,
        asyncMode: null as 'threading' | null
    };

    constructor(page: Page, client: OpenAI) {
        super(page, client);
    }

    static override getJsonSchema() {
        return {
            title: 'handle_url',
            description: 'Navigate to a specific URL',
            properties: {
                url: {
                    type: 'string',
                    description: 'The URL to navigate to'
                }
            },
            type: 'object',
            required: ['url']
        };
    }

    async run(url: string): Promise<string> {
        if (!this.page) throw new Error('Page not initialized');

        try {
            // Set a longer timeout for navigation
            await this.page.setDefaultNavigationTimeout(60000);

            // First attempt: Load with minimal waiting
            try {
                await this.page.goto(url, { 
                    waitUntil: 'domcontentloaded',
                    timeout: 30000 
                });

                // Wait for the body to be available
                await this.page.waitForSelector('body', { timeout: 10000 });

                // Wait for any initial scripts to load
                await this.page.waitForFunction(() => {
                    return document.readyState === 'complete';
                }, { timeout: 10000 }).catch(() => {});

            } catch (error) {
                console.log('First navigation attempt failed, retrying with different strategy...');
                
                // Second attempt: Try with network idle
                await this.page.goto(url, { 
                    waitUntil: 'networkidle0',
                    timeout: 60000 
                });
            }

            // Additional waiting for dynamic content
            try {
                // Wait for common UI elements that indicate page is ready
                await Promise.race([
                    this.page.waitForSelector('header', { timeout: 5000 }),
                    this.page.waitForSelector('nav', { timeout: 5000 }),
                    this.page.waitForSelector('main', { timeout: 5000 }),
                    this.page.waitForSelector('#content', { timeout: 5000 })
                ]).catch(() => {});

                // Wait a bit for any remaining dynamic content
                await this.page.waitForFunction(() => {
                    const elements = document.body.children;
                    return elements.length > 5; // Basic check for meaningful content
                }, { timeout: 5000 }).catch(() => {});

            } catch (error) {
                console.log('Additional waiting completed with some timeouts, but proceeding...');
            }

            // Final check for basic interactivity
            const isPageUsable = await this.page.evaluate(() => {
                return document.body !== null && 
                       document.body.children.length > 0 && 
                       document.readyState === 'complete';
            });

            if (!isPageUsable) {
                throw new Error('Page did not load properly');
            }

            return 'Successfully navigated to URL';
        } catch (error) {
            console.error('Navigation failed:', error);
            throw error;
        }
    }
} 