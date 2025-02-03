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
    private captchaSourceDir: string;

    constructor(page: Page, client: OpenAI) {
        super(page, client);
        this.captchaDataDir = path.join(process.cwd(), 'captcha-data');
        this.captchaDataFile = path.join(this.captchaDataDir, 'selectors-map.json');
        this.captchaPagesMap = new Map();
        this.captchaSourceDir = path.join(process.cwd(), 'captcha-sources');
        this.initCaptchaDataDir();
        this.initCaptchaSourceDir();
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

    private initCaptchaSourceDir() {
        if (!fs.existsSync(this.captchaSourceDir)) {
            fs.mkdirSync(this.captchaSourceDir, { recursive: true });
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
            'iframe[src*="recaptcha"][src*="anchor"]', // Only match interactive reCAPTCHA frames
            'iframe[src*="hcaptcha"][src*="challenge"]', // Only match interactive hCaptcha frames
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
                // Check if element is visible and not an aframe
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

    private async findAndSwitchToFrame(urlPattern: string): Promise<Frame | null> {
        try {
            // Wait for frames to load
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const frames = this.page?.frames() || [];
            for (const frame of frames) {
                try {
                    const url = frame.url();
                    if (url.includes(urlPattern)) {
                        // Verify frame is still attached
                        await frame.evaluate(() => true);
                        return frame;
                    }
                } catch (e) {
                    continue; // Frame was detached, try next one
                }
            }
            return null;
        } catch (error) {
            console.error(`Error finding frame with pattern ${urlPattern}:`, error);
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
            const tiles = await frame.$$('.rc-imageselect-tile');
            const captchaTiles: CaptchaTile[] = [];

            for (const tile of tiles) {
                try {
                    const isSelected = await frame.evaluate(
                        (el) => el.classList.contains('rc-imageselect-dynamic-selected'),
                        tile
                    );

                    if (!isSelected) {
                        const screenshot = await this.getElementScreenshot(tile);
                        captchaTiles.push({ element: tile, screenshot });
                    }
                } catch (e) {
                    continue; // Skip problematic tiles
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

        try {
            const response = await this.client.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                    {
                        role: 'system',
                        content: 'You are an AI designed to solve visual CAPTCHA challenges. Analyze the images and identify which ones match the given task. Output ONLY the numbers of matching images, separated by commas. If no images match, output 0.'
                    },
                    {
                        role: 'user',
                        content: [
                            ...imageContent,
                            { type: 'text', text: `${taskText}. Only output numbers separated by commas.` }
                        ]
                    }
                ],
                max_tokens: 50,
                temperature: 0
            });

            const result = response.choices[0]?.message?.content || '0';
            return result.split(',')
                .map(s => s.trim())
                .filter(s => s.match(/^\d+$/))
                .map(s => parseInt(s, 10));
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

    private async savePageSource(url: string, html: string) {
        try {
            const urlHash = crypto.createHash('md5').update(url).digest('hex');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const fileName = path.join(this.captchaSourceDir, `${urlHash}_${timestamp}.html`);
            fs.writeFileSync(fileName, html);
            console.log(`Page source saved to: ${fileName}`);
        } catch (error) {
            console.error('Error saving page source:', error);
        }
    }

    private async solveTextCaptcha(): Promise<boolean> {
        try {
            if (!this.client || !this.page) {
                return false;
            }

            // Save the page source first
            const url = this.page.url();
            const html = await this.page.content();
            await this.savePageSource(url, html);

            // Take screenshot of the entire page
            const screenshot = await this.page.screenshot({ encoding: 'base64' });
            
            // Process with GPT-4o
            const response = await this.client.chat.completions.create({
                model: 'gpt-4o',
                response_format: { type: "json_object" },
                messages: [
                    {
                        role: 'system',
                        content: 'You are an AI designed to solve text CAPTCHA challenges. Look at this page screenshot and: 1) Find any text CAPTCHA in the image 2) Identify the input field placeholder or label for the CAPTCHA. Return a JSON object with format {"captchaText": "found text", "placeholder": "found placeholder"}.'
                    },
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: 'Find and solve any text CAPTCHA in this image, and identify its input field placeholder/label.' },
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
                max_tokens: 150,
                temperature: 0
            });

            const result = response.choices[0]?.message?.content || '';
            
            try {
                const parsed = JSON.parse(result);
                if (parsed.captchaText && parsed.placeholder) {
                    const typingTool = new TypingTool(this.page, this.client);
                    await typingTool.run(parsed.placeholder, parsed.captchaText);
                    return await this.verifySolveSuccess();
                }
            } catch (e) {
                console.error('Error parsing GPT response:', e);
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
            // Check for common CAPTCHA elements
            const hasCaptcha = await this.detectCaptcha();
            if (!hasCaptcha) {
                return 'No CAPTCHA detected on the page';
            }

            // Try to solve reCAPTCHA if present
            const recaptchaSolved = await this.solveReCaptcha();
            if (recaptchaSolved) {
                return 'Successfully solved reCAPTCHA';
            }

            // Try to solve hCaptcha if present
            const hcaptchaSolved = await this.solveHCaptcha();
            if (hcaptchaSolved) {
                return 'Successfully solved hCaptcha';
            }

            // Try to solve text CAPTCHA as a fallback
            const textCaptchaSolved = await this.solveTextCaptcha();
            if (textCaptchaSolved) {
                return 'Successfully solved text CAPTCHA';
            }

            return 'Unable to solve CAPTCHA';
        } catch (error) {
            console.error('CAPTCHA solving failed:', error);
            throw error;
        }
    }

    private async solveReCaptcha(): Promise<boolean> {
        try {
            // Find visible reCAPTCHA iframe (excluding aframe)
            const frames = await this.page.$$('iframe[src*="recaptcha"]');
            let targetFrame = null;

            for (const frame of frames) {
                const isValidFrame = await frame.evaluate((el: HTMLIFrameElement) => {
                    const src = el.getAttribute('src') || '';
                    const style = window.getComputedStyle(el);
                    const rect = el.getBoundingClientRect();
                    return !src.includes('api2/aframe') && 
                           src.includes('anchor') &&
                           style.display !== 'none' && 
                           style.visibility !== 'hidden' && 
                           rect.width > 0 && 
                           rect.height > 0;
                });

                if (isValidFrame) {
                    targetFrame = frame;
                    break;
                }
            }

            if (!targetFrame) {
                console.log('No valid reCAPTCHA frame found');
                return false;
            }

            // Switch to the frame
            const frameContent = await targetFrame.contentFrame();
            if (!frameContent) {
                console.log('Could not access frame content');
                return false;
            }

            // Wait for and click the checkbox with retry logic
            for (let i = 0; i < 3; i++) {
                try {
                    await frameContent.waitForSelector('.recaptcha-checkbox-border', { 
                        visible: true,
                        timeout: 2000 
                    });
                    
                    await frameContent.click('.recaptcha-checkbox-border');
                    await this.page.waitForTimeout(2000);

                    const success = await frameContent.$('.recaptcha-checkbox-checked');
                    if (success) {
                        return true;
                    }
                } catch (e) {
                    console.log(`Attempt ${i + 1} failed:`, e);
                    await this.page.waitForTimeout(1000);
                }
            }

            return false;
        } catch (error) {
            console.error('reCAPTCHA solving failed:', error);
            return false;
        }
    }

    private async solveHCaptcha(): Promise<boolean> {
        try {
            // Check for hCaptcha iframe
            const hcaptchaFrame = await this.page.$('iframe[src*="hcaptcha"]');
            if (!hcaptchaFrame) {
                return false;
            }

            // Switch to hCaptcha iframe
            const frame = await hcaptchaFrame.contentFrame();
            if (!frame) {
                return false;
            }

            // Click the checkbox
            await frame.click('.checkbox');
            await this.page.waitForTimeout(2000);

            // Check if solved
            const success = await frame.$('.checkbox.checked');
            return !!success;
        } catch (error) {
            console.error('hCaptcha solving failed:', error);
            return false;
        }
    }
}
