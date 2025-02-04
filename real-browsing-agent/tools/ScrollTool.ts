import { BaseTool } from './BaseTools';
import { Page } from 'puppeteer';
import OpenAI from 'openai';

export class ScrollTool extends BaseTool {
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
            title: 'scroll_down',
            description: 'Scroll down the page by one viewport height',
            type: 'object',
            properties: {
                explanation: {
                    type: 'string',
                    description: 'Explanation for why this action is being taken.'
                },
                action: {
                    type: 'string',
                    description: 'Textual summary of the action being taken.'
                }
            },
            required: []
        };
    }

    async run(): Promise<string> {
        if (!this.page) throw new Error('Page not initialized');

        try {
            // Get viewport height and scroll by that amount
            const scrollResult = await this.page.evaluate(() => {
                const viewportHeight = window.innerHeight;
                window.scrollBy({
                    top: viewportHeight,
                    behavior: 'smooth'
                });
                return viewportHeight;
            });

            // Wait for scroll to complete
            await this.page.evaluate(() => {
                return new Promise((resolve) => setTimeout(resolve, 500));
            });

            return `Successfully scrolled down by ${Math.round(scrollResult)} pixels`;
        } catch (error) {
            console.error('Scrolling failed:', error);
            throw error;
        }
    }
}
