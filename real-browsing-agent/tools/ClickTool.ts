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
            description: 'The text content to click example: handle_click({"identifier": "Login"}), handle_click({"identifier": "Which countries have restricted DeepSeek and why?"}), handle_click({"identifier": "Rin Detergent Liquid 2L Pouch - Top Load"}),handle_click({"identifier": "Top news on DeepSeek"})',
            properties: {
                identifier: {
                    type: 'string',
                    description: 'The text content to click example Login , Which countries have restricted DeepSeek and why?, Rin Detergent Liquid 2L Pouch - Top Load, Top news on DeepSeek'
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
            // await this.page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {});

            console.log('Clicking on element with identifier:', identifier);

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
        // First try to find the label element
        const labelElements = await this.page.$$('.highlight-label');
        
        for (const labelElement of labelElements) {
            const labelText = await this.page.evaluate((el: Element) => el.textContent, labelElement);
            
            if (labelText === label) {
                // Get the position of the label
                const labelPosition = await this.page.evaluate((el: Element) => {
                    const style = window.getComputedStyle(el);
                    return {
                        top: parseInt(style.top),
                        left: parseInt(style.left)
                    };
                }, labelElement);

                // Find the corresponding highlighted element
                const highlightedElement = await this.page.evaluate((position: { top: number; left: number }) => {
                    const elements = document.querySelectorAll('.highlighted-element');
                    for (const el of Array.from(elements)) {
                        const rect = el.getBoundingClientRect();
                        // The label is positioned 25px above the element
                        if (Math.abs(rect.top - (position.top + 25)) < 5 && Math.abs(rect.left - position.left) < 5) {
                            return el;
                        }
                    }
                    return null;
                }, labelPosition);

                if (highlightedElement) {
                    return await this.page.evaluateHandle((el: Element) => el, highlightedElement);
                }
            }
        }

        return null;
    }

    private async findClickableElement(text: string) {
        if (!text) return null;

        // Try exact match first in highlighted elements
        const highlightedElements = await this.page.$$('.highlighted-element');
        
        // First pass: Look for exact matches
        for (const element of highlightedElements) {
            const elementText = await this.page.evaluate((el: Element) => {
                const textContent = el.textContent?.trim();
                const value = el.getAttribute('value')?.trim();
                const ariaLabel = el.getAttribute('aria-label')?.trim();
                const title = el.getAttribute('title')?.trim();
                const placeholder = el.getAttribute('placeholder')?.trim();
                return textContent || value || ariaLabel || title || placeholder || '';
            }, element);

            console.log('Element text:', elementText);

            if (elementText && text && elementText.toLowerCase() === text.toLowerCase()) {
                return element;
            }
        }

        // Second pass: Look for partial matches in highlighted elements
        for (const element of highlightedElements) {
            const elementText = await this.page.evaluate((el: Element) => {
                const textContent = el.textContent?.trim();
                const value = el.getAttribute('value')?.trim();
                const ariaLabel = el.getAttribute('aria-label')?.trim();
                const title = el.getAttribute('title')?.trim();
                const placeholder = el.getAttribute('placeholder')?.trim();
                return textContent || value || ariaLabel || title || placeholder || '';
            }, element);

            if (elementText && text && elementText.toLowerCase().includes(text.toLowerCase())) {
                return element;
            }
        }

        // If not found in highlighted elements, try standard selectors
        const selectors = [
            `a:not([aria-hidden="true"]):not(.hidden):not(.invisible)`,
            `button:not([aria-hidden="true"]):not(.hidden):not(.invisible)`,
            `[role="button"]:not([aria-hidden="true"]):not(.hidden):not(.invisible)`,
            `input[type="submit"]:not([aria-hidden="true"]):not(.hidden):not(.invisible)`,
            `input[type="button"]:not([aria-hidden="true"]):not(.hidden):not(.invisible)`,
            `div[onclick]:not([aria-hidden="true"]):not(.hidden):not(.invisible)`,
            `span[onclick]:not([aria-hidden="true"]):not(.hidden):not(.invisible)`,
            `div[role="button"]:not([aria-hidden="true"]):not(.hidden):not(.invisible)`,
            `span[role="button"]:not([aria-hidden="true"]):not(.hidden):not(.invisible)`
        ];

        // First try exact matches in standard selectors
        for (const selector of selectors) {
            const elements = await this.page.$$(selector);
            for (const element of elements) {
                const elementText = await this.page.evaluate((el: Element) => {
                    const textContent = el.textContent?.trim();
                    const value = el.getAttribute('value')?.trim();
                    const ariaLabel = el.getAttribute('aria-label')?.trim();
                    const title = el.getAttribute('title')?.trim();
                    const placeholder = el.getAttribute('placeholder')?.trim();
                    return textContent || value || ariaLabel || title || placeholder || '';
                }, element);

                if (elementText && text && elementText.toLowerCase() === text.toLowerCase()) {
                    return element;
                }
            }
        }

        // Finally, try partial matches in standard selectors
        for (const selector of selectors) {
            const elements = await this.page.$$(selector);
            for (const element of elements) {
                const elementText = await this.page.evaluate((el: Element) => {
                    const textContent = el.textContent?.trim();
                    const value = el.getAttribute('value')?.trim();
                    const ariaLabel = el.getAttribute('aria-label')?.trim();
                    const title = el.getAttribute('title')?.trim();
                    const placeholder = el.getAttribute('placeholder')?.trim();
                    return textContent || value || ariaLabel || title || placeholder || '';
                }, element);

                if (elementText && text && elementText.toLowerCase().includes(text.toLowerCase())) {
                    return element;
                }
            }
        }

        return null;
    }
} 