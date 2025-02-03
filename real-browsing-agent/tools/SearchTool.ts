import { BaseTool } from './BaseTools';
import { Page } from 'puppeteer';
import OpenAI from 'openai';

export class SearchTool extends BaseTool {
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
            title: 'handle_search',
            description: 'Search for a specific query',
            properties: {
                query: {
                    type: 'string',
                    description: 'The search query to execute'
                }
            },
            type: 'object',
            required: ['query']
        };
    }

    async run(query: string): Promise<string> {
        if (!this.page) throw new Error('Page not initialized');

        try {
            // Wait for the page to be interactive
            await this.page.waitForFunction(() => {
                return document.readyState === 'complete';
            }, { timeout: 10000 }).catch(() => {});

            // Try multiple search input selectors
            const searchSelectors = [
                'input[type="search"]',
                'input[type="text"]',
                'input[placeholder*="Search"]',
                'input[placeholder*="search"]',
                'input[aria-label*="Search"]',
                'input[aria-label*="search"]',
                '#yfin-usr-qry',  // Yahoo Finance specific
                '#header-search-input',  // Yahoo Finance specific
                '[name="p"]'  // Yahoo Finance specific
            ];

            let searchInput = null;
            for (const selector of searchSelectors) {
                searchInput = await this.page.$(selector);
                if (searchInput) {
                    break;
                }
            }

            if (!searchInput) {
                throw new Error('No search input found');
            }

            // Clear any existing text and focus the input
            await searchInput.click({ clickCount: 3 }); // Select all text
            await searchInput.press('Backspace'); // Clear the field
            await this.page.waitForTimeout(500); // Small delay for stability

            // Type the query with a realistic delay
            await searchInput.type(query, { delay: 100 });
            await this.page.waitForTimeout(500); // Wait a bit after typing

            // Try different methods to submit the search
            try {
                // Method 1: Press Enter
                await searchInput.press('Enter');
                
                // Method 2: Look for and click a search button if Enter didn't work
                const searchButton = await this.page.$('button[type="submit"], button[aria-label*="Search"], button[title*="Search"]');
                if (searchButton) {
                    await searchButton.click();
                }

                // Wait for navigation or content update
                await Promise.race([
                    this.page.waitForNavigation({ timeout: 10000 }),
                    this.page.waitForFunction(() => {
                        // Check for search results or content changes
                        const resultsExist = document.querySelector('[role="main"], #results, .results, [data-test="quote-header"]');
                        return !!resultsExist;
                    }, { timeout: 10000 })
                ]).catch(() => {});

                // Additional wait for Yahoo Finance specific elements
                await Promise.race([
                    this.page.waitForSelector('[data-test="quote-header"]', { timeout: 5000 }),
                    this.page.waitForSelector('.quote-header', { timeout: 5000 }),
                    this.page.waitForSelector('.QuoteHeader', { timeout: 5000 })
                ]).catch(() => {});

            } catch (error) {
                console.log('Search submission completed with some timeouts, but proceeding...');
            }

            return 'Search executed successfully';
        } catch (error) {
            console.error('Search failed:', error);
            throw error;
        }
    }
} 