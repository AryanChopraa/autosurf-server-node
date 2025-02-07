import { BaseTool } from './BaseTools';
import { Page } from 'puppeteer';
import OpenAI from 'openai';

export class TypingWithEnterTool extends BaseTool {
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
            title: 'handle_typing_with_enter',
            description: 'Type text into an input field and press Enter',
            properties: {
                placeholder_value: {
                    type: 'string',
                    description: 'The placeholder text or label of the input field'
                },
                text: {
                    type: 'string',
                    description: 'The text to type into the field'
                }
            },
            type: 'object',
            required: ['placeholder_value', 'text']
        };
    }

    async run(placeholder_value: string, text: string): Promise<string> {
        if (!this.page) throw new Error('Page not initialized');

        try {
            console.log('Typing with Enter tool');
            
            // Wait for the page to be ready
            await this.page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
            
            // Wait a bit for any dynamic content to load
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Find the input field with retry mechanism
            let inputField = null;
            for (let i = 0; i < 3; i++) {
                inputField = await this.findInputField(placeholder_value);
                if (inputField) break;
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            if (!inputField) {
                throw new Error(`No input field found with placeholder/label: ${placeholder_value}`);
            }

            // Ensure element is visible and clickable
            await this.page.waitForFunction(
                (el: Element) => {
                    const rect = el.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== 'hidden';
                },
                { timeout: 5000 },
                inputField
            );
            
            // Clear the field and type the new text
            await inputField.click({ clickCount: 3 }); // Select all text
            await inputField.press('Backspace'); // Clear the field
            await inputField.type(text, { delay: 50 }); // Type with a slight delay for realism
            await inputField.press('Enter'); // Press Enter after typing

            // Wait for any navigation or network activity to complete
            await this.page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});

            return 'Successfully typed text into input field and pressed Enter';
        } catch (error) {
            console.error('Typing failed:', error);
            throw error;
        }
    }

    private async findInputField(placeholder: string) {
        const selectors = [
            'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([aria-hidden="true"]):not(.hidden):not(.invisible)',
            'textarea:not([aria-hidden="true"]):not(.hidden):not(.invisible)'
        ];

        for (const selector of selectors) {
            const elements = await this.page.$$(selector);
            for (const element of elements) {
                const fieldInfo = await this.page.evaluate((el: Element) => {
                    const input = el as HTMLInputElement | HTMLTextAreaElement;
                    return {
                        placeholder: input.placeholder?.trim(),
                        label: input.labels?.[0]?.textContent?.trim(),
                        ariaLabel: input.getAttribute('aria-label')?.trim(),
                        name: input.name?.trim(),
                        id: input.id?.trim()
                    };
                }, element);

                // Check if any of the field's identifying information matches the placeholder
                if (Object.values(fieldInfo).some(value => 
                    typeof value === 'string' && value.toLowerCase().includes(placeholder.toLowerCase())
                )) {
                    return element;
                }
            }
        }

        return null;
    }
} 