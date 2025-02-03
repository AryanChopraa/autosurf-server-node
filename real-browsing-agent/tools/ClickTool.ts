import { BaseTool } from './BaseTools';
import { Page } from 'puppeteer';
import OpenAI from 'openai';

export class ClickTool extends BaseTool {
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
            title: 'handle_click',
            description: 'Click on an element with specific text or attributes',
            properties: {
                text: {
                    type: 'string',
                    description: 'The text content or attribute value of the element to click'
                }
            },
            type: 'object',
            required: ['text']
        };
    }

    async run(text: string): Promise<string> {
        if (!this.page) throw new Error('Page not initialized');

        try {
            // Wait for any navigation to complete
            await this.page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {});

            // Try to find and click the element
            const element = await this.findClickableElement(text);
            if (!element) {
                throw new Error(`No clickable element found with text: ${text}`);
            }

            await element.click();

            // Wait for any resulting navigation or network activity
            await this.page.waitForNavigation({ 
                waitUntil: 'networkidle0',
                timeout: 10000 
            }).catch(() => {});

            return 'Successfully clicked element';
        } catch (error) {
            console.error('Click failed:', error);
            throw error;
        }
    }

    private async findClickableElement(text: string) {
        const selectors = [
            `a:not([aria-hidden="true"]):not(.hidden):not(.invisible)`,
            `button:not([aria-hidden="true"]):not(.hidden):not(.invisible)`,
            `[role="button"]:not([aria-hidden="true"]):not(.hidden):not(.invisible)`,
            `input[type="submit"]:not([aria-hidden="true"]):not(.hidden):not(.invisible)`,
            `input[type="button"]:not([aria-hidden="true"]):not(.hidden):not(.invisible)`
        ];

        for (const selector of selectors) {
            const elements = await this.page.$$(selector);
            for (const element of elements) {
                const elementText = await this.page.evaluate((el: Element) => {
                    return el.textContent?.trim() || 
                           (el as HTMLElement).getAttribute('value')?.trim() || 
                           (el as HTMLElement).getAttribute('aria-label')?.trim() ||
                           (el as HTMLElement).getAttribute('title')?.trim();
                }, element);

                if (elementText && elementText.toLowerCase().includes(text.toLowerCase())) {
                    return element;
                }
            }
        }

        return null;
    }
} 