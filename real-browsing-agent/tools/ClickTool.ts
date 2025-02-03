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
            description: 'Click on an element using text content or numbered label (for icons/images)',
            properties: {
                identifier: {
                    type: 'string',
                    description: 'The text content of the element to click, or the numbered label for elements without text'
                }
            },
            type: 'object',
            required: ['identifier']
        };
    }

    async run(identifier: string): Promise<string> {
        if (!this.page) throw new Error('Page not initialized');

        try {
            // Wait for any navigation to complete
            await this.page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {});

            // First try to find by text content
            let element = await this.findClickableElement(identifier);

            // If no element found by text and identifier is a number, try finding by label
            if (!element && /^\d+$/.test(identifier)) {
                element = await this.findElementByLabel(identifier);
            }

            if (!element) {
                throw new Error(`No clickable element found with text or label: ${identifier}`);
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

    private async findElementByLabel(label: string): Promise<any> {
        const elements = await this.page?.$$('.highlighted-element');
        if (!elements) return null;

        for (const element of elements) {
            const labelElement = await this.page?.evaluateHandle((el: Element) => {
                const rect = el.getBoundingClientRect();
                return document.querySelector(`.highlight-label[style*="top: ${rect.top - 25}px"][style*="left: ${rect.left}px"]`) as Element;
            }, element);

            const labelText = await this.page?.evaluate((el: Element | null) => el?.textContent, labelElement);
            if (labelText === label) {
                return element;
            }
        }
        return null;
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