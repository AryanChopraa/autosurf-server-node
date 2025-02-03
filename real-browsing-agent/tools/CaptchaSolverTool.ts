import { BaseTool } from './BaseTools';
import { Page, Frame, ElementHandle } from 'puppeteer';
import OpenAI from 'openai';
import { TypingTool } from './TypingTool';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

interface CaptchaTile {
    element: ElementHandle;
    screenshot: string;
}

interface CaptchaPageData {
    url: string;
    selectors: {
        inputSelector: string;
        captchaSelector: string;
    };
    timestamp: number;
}

interface CaptchaAnalysis {
    found: boolean;
    inputField?: boolean;
    selector?: string;
    submitSelector?: string;
    coordinates?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    instructions?: string;
}

export class CaptchaSolverTool extends BaseTool {
    protected static override ToolConfig = {
        ...BaseTool.ToolConfig,
        strict: true,
        oneCallAtATime: true,
        outputAsResult: false,
        asyncMode: null as 'threading' | null
    };

    private retryCount = 0;
    private maxRetries = 5;
    private captchaDataDir: string;
    private captchaDataFile: string;
    private captchaPagesMap: Map<string, CaptchaPageData>;

    constructor(page: Page, client: OpenAI) {
        super(page, client);
        this.captchaDataDir = path.join(process.cwd(), 'captcha-data');
        this.captchaDataFile = path.join(this.captchaDataDir, 'selectors-map.json');
        this.captchaPagesMap = new Map();
        this.initCaptchaDataDir();
    }

    private initCaptchaDataDir() {
        try {
            if (!fs.existsSync(this.captchaDataDir)) {
                fs.mkdirSync(this.captchaDataDir, { recursive: true });
            }
            if (fs.existsSync(this.captchaDataFile)) {
                const data = JSON.parse(fs.readFileSync(this.captchaDataFile, 'utf-8'));
                this.captchaPagesMap = new Map(Object.entries(data));
            }
        } catch (error) {
            console.error('Error initializing captcha data directory:', error);
        }
    }

    private async saveCaptchaPageData(url: string, html: string, selectors: { inputSelector: string; captchaSelector: string }) {
        try {
            // Create hash of the URL to use as identifier
            const urlHash = crypto.createHash('md5').update(url).digest('hex');
            
            // Save the HTML content
            const htmlFileName = path.join(this.captchaDataDir, `${urlHash}.html`);
            fs.writeFileSync(htmlFileName, html);

            // Update the selectors map
            const pageData: CaptchaPageData = {
                url,
                selectors,
                timestamp: Date.now()
            };
            this.captchaPagesMap.set(urlHash, pageData);

            // Save the updated map
            const mapData = Object.fromEntries(this.captchaPagesMap);
            fs.writeFileSync(this.captchaDataFile, JSON.stringify(mapData, null, 2));
        } catch (error) {
            console.error('Error saving captcha page data:', error);
        }
    }

    private async findExistingSelectors(url: string): Promise<{ inputSelector: string; captchaSelector: string } | null> {
        try {
            const urlHash = crypto.createHash('md5').update(url).digest('hex');
            const pageData = this.captchaPagesMap.get(urlHash);
            
            if (pageData && Date.now() - pageData.timestamp < 7 * 24 * 60 * 60 * 1000) { // 7 days validity
                return pageData.selectors;
            }
        } catch (error) {
            console.error('Error finding existing selectors:', error);
        }
        return null;
    }

    static override getJsonSchema() {
        return {
            title: 'handle_captcha',
            description: 'Attempt to solve a CAPTCHA on the page',
            properties: {},
            type: 'object',
            required: []
        };
    }

    private async detectCaptcha(): Promise<boolean> {
        const captchaSelectors = [
            'iframe[src*="recaptcha"][src*="anchor"]',
            'iframe[src*="hcaptcha"][src*="challenge"]',
            '#captcha:not([style*="display: none"])',
            '.captcha:not([style*="display: none"])',
            '[class*="captcha"]:not([style*="display: none"])',
            '[id*="captcha"]:not([style*="display: none"])',
            'iframe[title*="reCAPTCHA"]:not([style*="display: none"])',
            '[aria-label*="captcha"]:not([style*="display: none"])',
            'form[action*="captcha"]:not([style*="display: none"])'
        ];

        for (const selector of captchaSelectors) {
            const elements = await this.page.$$(selector);
            for (const element of elements) {
                const isVisible = await element.evaluate((el: HTMLElement) => {
                    const style = window.getComputedStyle(el);
                    const rect = el.getBoundingClientRect();
                    const isAframe = el.getAttribute('src')?.includes('api2/aframe');
                    return style.display !== 'none' && 
                           style.visibility !== 'hidden' && 
                           rect.width > 0 && 
                           rect.height > 0 &&
                           !isAframe;
                });
                
                if (isVisible) {
                    return true;
                }
            }
        }

        return false;
    }

    private async getElementScreenshot(element: ElementHandle): Promise<string> {
        try {
            const screenshot = await element.screenshot({ encoding: 'base64' });
            return screenshot;
        } catch (error) {
            console.error('Error taking element screenshot:', error);
            throw error;
        }
    }

    private async findAndSwitchToFrame(type: 'anchor' | 'challenge'): Promise<Frame | null> {
        if (!this.page) return null;

        const selector = type === 'anchor' 
            ? 'iframe[src*="recaptcha"][src*="anchor"]'
            : 'iframe[title="recaptcha challenge expires in two minutes"]';

        try {
            // Wait for frame to be present (similar to Selenium's WebDriverWait)
            await this.page.waitForFunction(
                (sel: string) => {
                    const frame = document.querySelector(sel);
                    return frame && frame.getBoundingClientRect().height > 0;
                },
                { timeout: 10000 },
                selector
            );

            // Get frame element
            const frameElement = await this.page.$(selector);
            if (!frameElement) return null;

            // Switch to frame (similar to Selenium's switch_to.frame)
            const frame = await frameElement.contentFrame();
            if (!frame) return null;

            // Wait for frame to be ready (similar to Selenium's frame_to_be_available_and_switch_to_it)
            await frame.waitForFunction(
                () => {
                    return document.readyState === 'complete' && 
                           document.body !== null &&
                           window.getComputedStyle(document.body).display !== 'none';
                },
                { timeout: 5000 }
            );

            return frame;
        } catch (error) {
            console.error(`Error finding ${type} frame:`, error);
            return null;
        }
    }

    private async waitForElementInFrame(frame: Frame, selector: string, timeout = 5000): Promise<ElementHandle | null> {
        try {
            // Similar to Selenium's presence_of_element_located and WebDriverWait
            await frame.waitForFunction(
                (sel: string) => {
                    const element = document.querySelector(sel);
                    if (!element) return false;
                    
                    const rect = element.getBoundingClientRect();
                    const style = window.getComputedStyle(element);
                    
                    return rect.width > 0 && 
                           rect.height > 0 && 
                           style.visibility !== 'hidden' && 
                           style.display !== 'none';
                },
                { timeout },
                selector
            );

            return await frame.$(selector);
        } catch (error) {
            console.error(`Error waiting for element ${selector}:`, error);
            return null;
        }
    }

    private async clickCaptchaCheckbox(frame: Frame): Promise<boolean> {
        try {
            // Wait for checkbox with increased timeout
            const checkbox = await frame.waitForSelector('#recaptcha-anchor', { 
                timeout: 5000,
                visible: true 
            });
            
            if (!checkbox) return false;

            // Ensure checkbox is in view
            await frame.evaluate((el: Element) => {
                el.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center'
                });
            }, checkbox);

            // Wait for scrolling to complete
            await new Promise(resolve => setTimeout(resolve, 500));

            // Click with retry
            for (let i = 0; i < 3; i++) {
                try {
                    await checkbox.click({ delay: 100 });
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    const isChecked = await frame.evaluate(() => {
                        const checkbox = document.querySelector('.recaptcha-checkbox');
                        return checkbox?.getAttribute('aria-checked') === 'true';
                    });

                    if (isChecked) return true;
                } catch (e) {
                    continue;
                }
            }

            return false;
        } catch (error) {
            console.error('Error clicking checkbox:', error);
            return false;
        }
    }

    private async getCaptchaTiles(frame: Frame): Promise<CaptchaTile[]> {
        try {
            // Wait for tiles to be present
            await frame.waitForSelector('.rc-imageselect-tile', { timeout: 5000 });
            
            // Get all tiles that haven't been selected yet
            const tiles = await frame.$$('.rc-imageselect-tile');
            const captchaTiles: CaptchaTile[] = [];

            for (const tile of tiles) {
                try {
                    // Check if tile is already selected
                    const isSelected = await frame.evaluate(
                        (el) => {
                            return el.classList.contains('rc-imageselect-dynamic-selected') ||
                                   el.classList.contains('rc-imageselect-tileselected');
                        },
                        tile
                    );

                    if (!isSelected) {
                        // Take a screenshot of the tile
                        const screenshot = await tile.screenshot({
                            encoding: 'base64',
                            type: 'jpeg',
                            quality: 90
                        });

                        if (typeof screenshot === 'string') {
                            captchaTiles.push({
                                element: tile,
                                screenshot: screenshot
                            });
                        }
                    }
                } catch (e) {
                    console.error('Error processing tile:', e);
                    continue;
                }
            }

            return captchaTiles;
        } catch (error) {
            console.error('Error getting CAPTCHA tiles:', error);
            return [];
        }
    }

    private async processTilesWithGPT(tiles: CaptchaTile[], taskText: string): Promise<number[]> {
        if (!this.client) throw new Error('OpenAI client not initialized');

        const imageContent: OpenAI.Chat.ChatCompletionContentPart[] = [];
        tiles.forEach((tile, index) => {
            imageContent.push(
                { type: 'text', text: `Image ${index + 1}:` },
                {
                    type: 'image_url',
                    image_url: {
                        url: `data:image/jpeg;base64,${tile.screenshot}`,
                        detail: 'high'
                    }
                }
            );
        });

        // Clean up task text
        let cleanTaskText = taskText
            .replace('Click verify', 'Output 0')
            .replace('click skip', 'Output 0')
            .replace('once', 'if')
            .replace('none left', 'none')
            .replace('all', 'only')
            .replace('squares', 'images');

        // Add additional context for 4x4 grids
        let additionalInfo = '';
        if (tiles.length > 9) {
            additionalInfo = 'Keep in mind that all images are a part of a bigger image from left to right, and top to bottom. The grid is 4x4.';
        }

        try {
            const response = await this.client.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                    {
                        role: 'system',
                        content: `You are an advanced AI designed to support users with visual impairments.
                            User will provide you with ${tiles.length} images numbered from 1 to ${tiles.length}. Your task is to output
                            the numbers of the images that contain the requested object, or at least some part of the requested
                            object. ${additionalInfo} If there are no individual images that satisfy this condition, output 0.`
                    },
                    {
                        role: 'user',
                        content: [
                            ...imageContent,
                            {
                                type: 'text',
                                text: `${cleanTaskText}. Only output numbers separated by commas and nothing else. Output 0 if there are none.`
                            }
                        ]
                    }
                ],
                max_tokens: 50,
                temperature: 0
            });

            const result = response.choices[0]?.message?.content || '0';
            
            // Parse the response into numbers
            if (result.includes('0') && !result.includes('10')) {
                return [];
            }

            return result
                .split(',')
                .map(s => parseInt(s.trim()))
                .filter(n => !isNaN(n) && n > 0 && n <= tiles.length);

        } catch (error) {
            console.error('Error processing tiles with GPT:', error);
            return [];
        }
    }

    private async solveCaptchaChallenge(frame: Frame): Promise<boolean> {
        try {
            // Wait for challenge to be fully loaded
            await frame.waitForSelector('.rc-imageselect-instructions', { timeout: 5000 });
            
            const taskText = await frame.evaluate(() => {
                const element = document.querySelector('.rc-imageselect-instructions');
                return element?.textContent?.trim().replace(/\n/g, ' ') || '';
            });

            const isContinuousTask = taskText.toLowerCase().includes('once there are none left');
            const tiles = await this.getCaptchaTiles(frame);
            
            if (tiles.length === 0) return false;

            const selectedTiles = await this.processTilesWithGPT(tiles, taskText);
            if (!selectedTiles || selectedTiles.length === 0) return false;

            // Click tiles with proper delays
            for (const tileIndex of selectedTiles) {
                if (tileIndex <= tiles.length) {
                    const tile = tiles[tileIndex - 1].element;
                    await frame.evaluate((el) => {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, tile);
                    await new Promise(resolve => setTimeout(resolve, 300));
                    await tile.click();
                    await new Promise(resolve => setTimeout(resolve, 300));
                }
            }

            if (!isContinuousTask) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                const verifyButton = await frame.$('#recaptcha-verify-button');
                if (verifyButton) {
                    await verifyButton.click();
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }

            // Check for incorrect response
            const isIncorrect = await frame.$('.rc-imageselect-incorrect-response');
            return !isIncorrect;
        } catch (error) {
            console.error('Error solving challenge:', error);
            return false;
        }
    }

    private async verifySolveSuccess(): Promise<boolean> {
        try {
            // Wait for potential redirect/changes
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Check if still on CAPTCHA
            const hasCaptcha = await this.detectCaptcha();
            if (hasCaptcha) return false;

            // Wait for main content
            await this.page?.waitForFunction(() => {
                const mainContent = document.body.textContent || '';
                return mainContent.length > 100 && !mainContent.includes('captcha');
            }, { timeout: 5000 }).catch(() => {});

            return true;
        } catch (error) {
            console.error('Error verifying solve:', error);
            return false;
        }
    }

    private async solveTextCaptcha(): Promise<boolean> {
        try {
            if (!this.client || !this.page) {
                return false;
            }

            // Take a full page screenshot
            const screenshot = await this.page.screenshot({ 
                encoding: 'base64',
                fullPage: true,
                type: 'jpeg',
                quality: 90
            });

            // First, analyze the page to find CAPTCHA elements
            const analysisResponse = await this.client.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                    {
                        role: 'system',
                        content: 'You are an AI designed to analyze web pages for CAPTCHA elements. Look for text input fields, images, or any visual challenges that appear to be CAPTCHA-related.'
                    },
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: 'Analyze this page for any CAPTCHA elements. Look for: 1) Text input fields with CAPTCHA-related labels or placeholders 2) Images containing text or visual challenges 3) Instructions asking to solve a puzzle or enter text from an image.'
                            },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:image/jpeg;base64,${screenshot}`,
                                    detail: 'high'
                                }
                            }
                        ]
                    }
                ],
                response_format: { type: "json_object" }
            });

            const analysis = JSON.parse(analysisResponse.choices[0]?.message?.content || '{}');
            
            if (!analysis.found) {
                return false;
            }

            // If text input is found, try to solve the CAPTCHA
            if (analysis.inputField) {
                // Get a closer screenshot of the CAPTCHA area if coordinates are provided
                let captchaScreenshot = screenshot;
                if (analysis.coordinates) {
                    const element = await this.page.$(analysis.selector);
                    if (element) {
                        const elementScreenshot = await element.screenshot({
                            encoding: 'base64',
                            type: 'jpeg',
                            quality: 90
                        });
                        if (typeof elementScreenshot === 'string') {
                            captchaScreenshot = elementScreenshot;
                        }
                    }
                }

                // Use GPT-4o to solve the CAPTCHA
                const solutionResponse = await this.client.chat.completions.create({
                    model: 'gpt-4o',
                    messages: [
                        {
                            role: 'system',
                            content: 'You are an AI designed to solve CAPTCHA challenges. Analyze the image and extract any text, numbers, or solve any visual puzzles present.'
                        },
                        {
                            role: 'user',
                            content: [
                                {
                                    type: 'text',
                                    text: `${analysis.instructions || 'Solve this CAPTCHA. If you see text or numbers in the image, provide them exactly as shown. If it\'s a puzzle, describe the solution.'}`
                                },
                                {
                                    type: 'image_url',
                                    image_url: {
                                        url: `data:image/jpeg;base64,${captchaScreenshot}`,
                                        detail: 'high'
                                    }
                                }
                            ]
                        }
                    ]
                });

                const solution = solutionResponse.choices[0]?.message?.content;
                if (!solution) {
                    return false;
                }

                // Try to input the solution
                try {
                    const inputField = await this.page.$(analysis.selector);
                    if (inputField) {
                        await inputField.click();
                        await this.page.keyboard.type(solution);
                        
                        // If submit button is provided, click it
                        if (analysis.submitSelector) {
                            const submitButton = await this.page.$(analysis.submitSelector);
                            if (submitButton) {
                                await submitButton.click();
                                await this.delay(2000);
                            }
                        } else {
                            // Try pressing Enter
                            await this.page.keyboard.press('Enter');
                            await this.delay(2000);
                        }

                        // Check if CAPTCHA is still present
                        const stillHasCaptcha = await this.detectCaptcha();
                        return !stillHasCaptcha;
                    }
                } catch (error) {
                    console.error('Error inputting CAPTCHA solution:', error);
                    return false;
                }
            }

            return false;
        } catch (error) {
            console.error('Text CAPTCHA solving failed:', error);
            return false;
        }
    }

    async run(): Promise<string> {
        if (!this.page) throw new Error('Page not initialized');

        try {
            const hasCaptcha = await this.detectCaptcha();
            if (!hasCaptcha) {
                return 'No CAPTCHA detected on the page';
            }

            // Try reCAPTCHA first
            console.log('Attempting to solve reCAPTCHA...');
            const recaptchaSolved = await this.solveReCaptcha();
            if (recaptchaSolved) {
                return 'Successfully solved reCAPTCHA';
            }

            // Try hCaptcha next
            console.log('Attempting to solve hCaptcha...');
            const hcaptchaSolved = await this.solveHCaptcha();
            if (hcaptchaSolved) {
                return 'Successfully solved hCaptcha';
            }

            // If neither worked, try the general text/image CAPTCHA solver
            console.log('Attempting to solve text/image CAPTCHA...');
            const textCaptchaSolved = await this.solveTextCaptcha();
            if (textCaptchaSolved) {
                return 'Successfully solved text/image CAPTCHA';
            }

            return 'Unable to solve CAPTCHA';
        } catch (error) {
            console.error('CAPTCHA solving failed:', error);
            throw error;
        }
    }

    private async delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private async solveReCaptcha(): Promise<boolean> {
        try {
            // 1. First try to find and switch to reCAPTCHA iframe
            const mainFrame = await this.findAndSwitchToFrame('anchor');
            if (!mainFrame) {
                console.log('No reCAPTCHA frame found');
                return false;
            }

            // 2. Find and click the checkbox (using waitForElement instead of waitForSelector)
            console.log('Finding and clicking checkbox...');
            const checkbox = await this.waitForElementInFrame(mainFrame, '#recaptcha-anchor');
            if (!checkbox) {
                console.log('Checkbox not found');
                return false;
            }

            // Click the checkbox using evaluate for better reliability
            await mainFrame.evaluate((el: Element) => {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                const clickEvent = new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    view: window
                });
                el.dispatchEvent(clickEvent);
            }, checkbox);

            // Quick check if CAPTCHA is still present after clicking
            await this.delay(1500); // Short delay to allow for potential redirect
            const stillHasCaptcha = await this.detectCaptcha();
            if (!stillHasCaptcha) {
                console.log('CAPTCHA solved immediately after checkbox click');
                return true;
            }

            // 3. Wait for and check if checkbox was successful (similar to Selenium's WebDriverWait)
            try {
                await mainFrame.waitForFunction(
                    () => {
                        const checkbox = document.querySelector('.recaptcha-checkbox');
                        return checkbox?.getAttribute('aria-checked') === 'true';
                    },
                    { timeout: 3000 }
                );

                // Double check after a short delay
                await this.delay(1000);
                const isChecked = await mainFrame.evaluate(() => {
                    const checkbox = document.querySelector('.recaptcha-checkbox');
                    return checkbox?.getAttribute('aria-checked') === 'true';
                });

                if (isChecked) {
                    console.log('Checkbox clicked successfully');
                    return true;
                }
            } catch (e) {
                console.log(e);
                console.log('Checkbox click did not succeed, attempting challenge');
            }

            // 4. Switch back to main content (similar to Selenium's switch_to.default_content())
            if (this.page) {
                await this.page.evaluate(() => {
                    window.focus();
                    document.documentElement.focus();
                });
            }

            // Wait for and switch to challenge frame
            console.log('Looking for challenge frame...');
            const challengeFrame = await this.findAndSwitchToFrame('challenge');
            if (!challengeFrame) {
                console.log('No challenge frame found');
                return false;
            }

            // 5. Handle image challenge
            console.log('Starting image challenge...');
            let attempts = 0;
            const maxAttempts = 5;

            while (attempts < maxAttempts) {
                console.log(`Attempt ${attempts + 1} of ${maxAttempts}`);

                // Wait for challenge content
                try {
                    await challengeFrame.waitForSelector('.rc-imageselect-instructions', { timeout: 5000 });
                } catch (error) {
                    console.log('Challenge instructions not found, checking if already solved');
                    return await this.checkSuccess();
                }

                // Get task text
                const taskText = await challengeFrame.evaluate(() => {
                    const element = document.querySelector('.rc-imageselect-instructions');
                    return element?.textContent?.trim().replace(/\n/g, ' ') || '';
                });

                if (!taskText) {
                    console.log('No task text found, checking if already solved');
                    return await this.checkSuccess();
                }

                const isContinuousTask = taskText.toLowerCase().includes('once there are none left');
                console.log('Task:', taskText);
                console.log('Continuous task:', isContinuousTask);

                let continuousAttemptComplete = false;
                while (isContinuousTask && !continuousAttemptComplete) {
                    // Get and process tiles
                    const tiles = await this.getCaptchaTiles(challengeFrame);
                    if (tiles.length === 0) {
                        if (await this.checkSuccess()) return true;
                        continuousAttemptComplete = true;
                        break;
                    }

                    const selectedTiles = await this.processTilesWithGPT(tiles, taskText);
                    if (!selectedTiles || selectedTiles.length === 0) {
                        // If no tiles selected in continuous mode, click verify to check if we're done
                        await this.clickVerifyButton(challengeFrame);
                        await this.delay(2000);
                        
                        // Check if we succeeded
                        if (await this.checkSuccess()) return true;
                        
                        // If we're still here and no tiles were found, consider this attempt complete
                        continuousAttemptComplete = true;
                        break;
                    }

                    // Click tiles
                    for (const tileIndex of selectedTiles) {
                        if (tileIndex <= tiles.length) {
                            try {
                                await tiles[tileIndex - 1].element.click();
                                await this.delay(300);
                            } catch (error) {
                                console.log(`Failed to click tile ${tileIndex}`);
                            }
                        }
                    }

                    await this.delay(1000);
                    await this.clickVerifyButton(challengeFrame);
                    await this.delay(2000);

                    // Check if we succeeded after verify
                    if (await this.checkSuccess()) return true;
                }

                // For non-continuous tasks or after a complete continuous attempt
                if (!isContinuousTask) {
                    // Get and process tiles
                    const tiles = await this.getCaptchaTiles(challengeFrame);
                    if (tiles.length === 0) {
                        if (await this.checkSuccess()) return true;
                        break;
                    }

                    const selectedTiles = await this.processTilesWithGPT(tiles, taskText);
                    if (!selectedTiles || selectedTiles.length === 0) {
                        await this.clickVerifyButton(challengeFrame);
                        await this.delay(2000);
                        if (await this.checkSuccess()) return true;
                        attempts++;
                        continue;
                    }

                    // Click tiles
                    for (const tileIndex of selectedTiles) {
                        if (tileIndex <= tiles.length) {
                            try {
                                await tiles[tileIndex - 1].element.click();
                                await this.delay(300);
                            } catch (error) {
                                console.log(`Failed to click tile ${tileIndex}`);
                            }
                        }
                    }

                    await this.delay(1000);
                    await this.clickVerifyButton(challengeFrame);
                    await this.delay(2000);

                    if (await this.checkSuccess()) return true;
                }

                attempts++;
                await this.delay(1000);
            }

            return await this.checkSuccess();
        } catch (error) {
            console.error('reCAPTCHA solving failed:', error);
            return false;
        }
    }

    private async clickVerifyButton(frame: Frame): Promise<void> {
        try {
            const verifyButton = await frame.$('#recaptcha-verify-button');
            if (verifyButton) {
                await verifyButton.click();
            }
        } catch (error) {
            console.error('Error clicking verify button:', error);
        }
    }

    private async checkSuccess(): Promise<boolean> {
        try {
            await this.delay(1000); // Wait before checking

            // First check if any captcha elements are still present
            const hasCaptcha = await this.detectCaptcha();
            if (!hasCaptcha) {
                console.log('No CAPTCHA elements found, considering it solved');
                return true;
            }

            // If captcha elements are still present, check the checkbox state
            const mainFrame = await this.findAndSwitchToFrame('anchor');
            if (!mainFrame) return false;

            // Wait a bit for the state to settle
            await this.delay(500);

            const isChecked = await mainFrame.evaluate(() => {
                const checkbox = document.querySelector('.recaptcha-checkbox');
                return checkbox?.getAttribute('aria-checked') === 'true';
            }).catch(() => false);

            if (isChecked) {
                // Double check after a short delay
                await this.delay(1000);
                const finalCheck = await mainFrame.evaluate(() => {
                    const checkbox = document.querySelector('.recaptcha-checkbox');
                    return checkbox?.getAttribute('aria-checked') === 'true';
                }).catch(() => false);

                return finalCheck;
            }

            return false;
        } catch (error) {
            console.error('Error checking success:', error);
            return false;
        }
    }

    private async solveHCaptcha(): Promise<boolean> {
        try {
            const hcaptchaFrame = await this.page.$('iframe[src*="hcaptcha"]');
            if (!hcaptchaFrame) {
                return false;
            }

            const frame = await hcaptchaFrame.contentFrame();
            if (!frame) {
                return false;
            }

            await frame.click('.checkbox');
            await this.delay(2000);

            const success = await frame.$('.checkbox.checked');
            return !!success;
        } catch (error) {
            console.error('hCaptcha solving failed:', error);
            return false;
        }
    }
}

