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
            // Wait for any navigation to complete
            // await this.page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {});

            // Find the input field
            const inputField = await this.findInputField(placeholder_value);
            if (!inputField) {
                throw new Error(`No input field found with placeholder/label: ${placeholder_value}`);
            }
            console.log('Input field found:', inputField);

            // Clear the field and type the new text
            await inputField.click({ clickCount: 3 }); // Select all text
            await inputField.press('Backspace'); // Clear the field
            await inputField.type(text, { delay: 50 }); // Type with a slight delay for realism
            await inputField.press('Enter'); // Press Enter after typing

            return 'Successfully typed text into input field and pressed Enter';
        } catch (error) {
            console.error('Typing failed:', error);
            throw error;
        }
    }

    private async findInputField(placeholder: string) {
        const selectors = [
            'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([aria-hidden="true"]):not(.hidden):not(.invisible)',
            'textarea:not([aria-hidden="true"]):not(.hidden):not(.invisible)',
            // Add more specific selectors that might help
            '[role="textbox"]',
            '[contenteditable="true"]'
        ];
        console.log('Finding input field with placeholder:', placeholder);
        console.log('Using selectors:', selectors);

        for (const selector of selectors) {
            console.log(`Checking selector: ${selector}`);
            const elements = await this.page.$$(selector);
            console.log(`Found ${elements.length} elements for selector ${selector}`);

            for (const element of elements) {
                const fieldInfo = await this.page.evaluate((el: Element) => {
                    const input = el as HTMLInputElement | HTMLTextAreaElement;
                    const fieldData = {
                        placeholder: input.placeholder?.trim(),
                        label: input.labels?.[0]?.textContent?.trim(),
                        ariaLabel: input.getAttribute('aria-label')?.trim(),
                        name: input.name?.trim(),
                        id: input.id?.trim(),
                        value: input.value?.trim(),
                        innerText: input.innerText?.trim(),
                        textContent: input.textContent?.trim(),
                        // Also check for parent elements with labels
                        parentLabel: el.parentElement?.querySelector('label')?.textContent?.trim(),
                        // Check preceding label elements
                        previousLabel: el.previousElementSibling?.tagName === 'LABEL' 
                            ? el.previousElementSibling.textContent?.trim() 
                            : null
                    };
                    console.log('Field data:', fieldData);
                    return fieldData;
                }, element);

                console.log(`Checking element with info:`, fieldInfo);

                // Check if any of the field's identifying information matches the placeholder
                const matches = Object.entries(fieldInfo)
                    .filter(([_, value]) => value) // Filter out null/undefined values
                    .filter(([key, value]) => 
                        typeof value === 'string' && 
                        (
                            value.toLowerCase().includes(placeholder.toLowerCase()) ||
                            placeholder.toLowerCase().includes(value.toLowerCase())
                        )
                    );

                if (matches.length > 0) {
                    console.log(`Found matching element with properties:`, matches);
                    return element;
                }
            }
        }

        // If no element found, log all visible input-like elements for debugging
        console.log('No matching element found. Logging all potential input elements:');
        await this.logAllInputElements();

        return null;
    }

    private async logAllInputElements() {
        const allElements = await this.page.$$('input, textarea, [role="textbox"], [contenteditable="true"]');
        for (const element of allElements) {
            const info = await this.page.evaluate((el: Element) => {
                return {
                    tag: el.tagName,
                    type: (el as HTMLInputElement).type,
                    placeholder: (el as HTMLInputElement).placeholder,
                    value: (el as HTMLInputElement).value,
                    id: el.id,
                    className: el.className,
                    isVisible: (el as HTMLElement).offsetParent !== null,
                    rect: (el as HTMLElement).getBoundingClientRect()
                };
            }, element);
            console.log('Potential input element:', info);
        }
    }
} 