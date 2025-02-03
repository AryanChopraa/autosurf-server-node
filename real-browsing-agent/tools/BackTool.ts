import { BaseTool } from './BaseTools';
import { Page } from 'puppeteer';
import OpenAI from 'openai';

export class BackTool extends BaseTool {
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
            title: 'handle_back',
            description: 'Navigate back to the previous page',
            properties: {},
            type: 'object',
            required: []
        };
    }

    async run(): Promise<string> {
        if (!this.page) throw new Error('Page not initialized');

        try {
            // Go back to the previous page
            await this.page.goBack({
                waitUntil: 'networkidle0',
                timeout: 5000
            });

            // Wait a moment for the page to stabilize
            await this.page.waitForTimeout(500);

            return 'Successfully navigated back to the previous page';
        } catch (error) {
            console.error('Back navigation failed:', error);
            throw error;
        }
    }
} 