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
            title: 'handle_scroll',
            description: 'Scroll the page up or down',
            properties: {
                direction: {
                    type: 'string',
                    description: 'The direction to scroll: "up" or "down"',
                    enum: ['up', 'down']
                },
                amount: {
                    type: 'number',
                    description: 'The amount to scroll in pixels (default is viewport height)'
                }
            },
            type: 'object',
            required: ['direction']
        };
    }

    async run(direction: string, amount?: number): Promise<string> {
        if (!this.page) throw new Error('Page not initialized');

        try {
            // Get viewport height if amount is not specified
            const viewportHeight = await this.page.evaluate(() => window.innerHeight);
            const scrollAmount = amount || viewportHeight;

            // Perform the scroll
            await this.page.evaluate((params: { direction: string; amount: number }) => {
                const { direction, amount } = params;
                const scrollY = direction === 'up' ? -amount : amount;
                window.scrollBy({
                    top: scrollY,
                    behavior: 'smooth'
                });
            }, { direction, amount: scrollAmount });

            // Wait for scroll to complete
            await this.page.waitForTimeout(500);

            return `Successfully scrolled ${direction} by ${scrollAmount} pixels`;
        } catch (error) {
            console.error('Scrolling failed:', error);
            throw error;
        }
    }
}
