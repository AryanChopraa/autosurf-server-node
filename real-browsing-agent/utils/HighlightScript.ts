/**
 * Interface for the WebDriver type
 */
interface WebDriver {
    executeScript(script: string): void;
}

/**
 * Highlights clickable elements like buttons, links, and certain divs and spans
 * on the webpage with a red border and only adds numeric labels to elements without text content.
 */
export function highlightElementsWithLabels(): void {
    // Helper function to check if an element is visible
    function isElementVisible(element: Element): boolean {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 ||
            rect.top >= (window.innerHeight || document.documentElement.clientHeight) ||
            rect.bottom <= 0 ||
            rect.left >= (window.innerWidth || document.documentElement.clientWidth) ||
            rect.right <= 0) {
            return false;
        }
        // Check if any parent element is hidden, which would hide this element as well
        let parent = element as HTMLElement | null;
        while (parent) {
            const style = window.getComputedStyle(parent);
            if (style.display === 'none' || style.visibility === 'hidden') {
                return false;
            }
            parent = parent.parentElement;
        }
        return true;
    }

    // Remove previous labels and styles if they exist
    document.querySelectorAll('.highlight-label').forEach((label) => {
        label.remove();
    });
    document.querySelectorAll('.highlighted-element').forEach((element) => {
        element.classList.remove('highlighted-element');
        element.removeAttribute('data-highlighted');
    });

    // Inject custom style for highlighting elements
    let styleElement = document.getElementById('highlight-style');
    if (!styleElement) {
        styleElement = document.createElement('style');
        styleElement.id = 'highlight-style';
        document.head.appendChild(styleElement);
    }
    styleElement.textContent = `
        .highlighted-element {
            border: 2px solid red !important;
            position: relative;
            box-sizing: border-box;
        }
        .highlight-label {
            position: absolute;
            z-index: 2147483647;
            background: yellow;
            color: black;
            font-size: 25px;
            padding: 3px 5px;
            border: 1px solid black;
            border-radius: 3px;
            white-space: nowrap;
            box-shadow: 0px 0px 2px #000;
            top: -25px;
            left: 0;
            display: none;
        }
    `;

    // Function to get element's text or attribute content
    function getElementIdentifier(element: Element): string {
        const textContent = element.textContent?.trim();
        const value = element.getAttribute('value')?.trim();
        const ariaLabel = element.getAttribute('aria-label')?.trim();
        const title = element.getAttribute('title')?.trim();
        const placeholder = element.getAttribute('placeholder')?.trim();
        
        // Return the first non-empty value in order of priority
        return textContent || value || ariaLabel || title || placeholder || '';
    }

    // Modified function to create and append label only for elements without text
    function createAndAdjustLabel(element: Element, index: number): void {
        if (!isElementVisible(element)) return;

        element.classList.add('highlighted-element');
        const identifier = getElementIdentifier(element);
        
        // Only create label if there's no identifier
        if (!identifier) {
            const label = document.createElement('div');
            label.className = 'highlight-label';
            label.textContent = index.toString();
            label.style.display = 'block';

            // Calculate label position
            const rect = element.getBoundingClientRect();
            const top = rect.top + window.scrollY - 25;
            const left = rect.left + window.scrollX;

            label.style.top = top + 'px';
            label.style.left = left + 'px';

            document.body.appendChild(label);
        }
    }

    // Select and highlight all elements, but only label those without text
    const selector = 'a, button, div[onclick], div[role="button"], div[tabindex], span[onclick], span[role="button"], span[tabindex]';
    const allElements = document.querySelectorAll(selector);
    let numberIndex = 1;
    
    allElements.forEach((element) => {
        const htmlElement = element as HTMLElement;
        if (!htmlElement.dataset.highlighted && isElementVisible(element)) {
            htmlElement.dataset.highlighted = 'true';
            createAndAdjustLabel(element, numberIndex++);
        }
    });
}

/**
 * Removes all red borders and labels from the webpage elements,
 * reversing the changes made by the highlight functions.
 */
export function removeHighlightAndLabels(): void {
    const selector = 
        'a, button, input, textarea, div[onclick], div[role="button"], div[tabindex], span[onclick], ' +
        'span[role="button"], span[tabindex]';

    // Remove all labels
    document.querySelectorAll('.highlight-label').forEach((label) => {
        label.remove();
    });

    // Remove the added style for red borders
    const highlightStyle = document.getElementById('highlight-style');
    if (highlightStyle) {
        highlightStyle.remove();
    }

    // Remove inline styles added by highlighting function
    document.querySelectorAll(selector).forEach((element) => {
        (element as HTMLElement).style.border = '';
    });
}

export const HIGHLIGHT_ELEMENTS_SCRIPT = `
    // Define selector at the top to avoid duplicate declaration
    const selector = 'a, button, div[onclick], div[role="button"], div[tabindex], span[onclick], span[role="button"], span[tabindex]';

    // Helper function to check if an element is visible
    function isElementVisible(element) {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 ||
            rect.top >= (window.innerHeight || document.documentElement.clientHeight) ||
            rect.bottom <= 0 ||
            rect.left >= (window.innerWidth || document.documentElement.clientWidth) ||
            rect.right <= 0) {
            return false;
        }
        let parent = element;
        while (parent) {
            const style = window.getComputedStyle(parent);
            if (style.display === 'none' || style.visibility === 'hidden') {
                return false;
            }
            parent = parent.parentElement;
        }
        return true;
    }

    // Remove previous labels and styles
    document.querySelectorAll('.highlight-label').forEach((label) => {
        label.remove();
    });
    document.querySelectorAll('.highlighted-element').forEach((element) => {
        element.classList.remove('highlighted-element');
        element.removeAttribute('data-highlighted');
    });

    // Inject custom style
    let styleElement = document.getElementById('highlight-style');
    if (!styleElement) {
        styleElement = document.createElement('style');
        styleElement.id = 'highlight-style';
        document.head.appendChild(styleElement);
    }
    styleElement.textContent = \`
        .highlighted-element {
            border: 2px solid red !important;
            position: relative;
            box-sizing: border-box;
        }
        .highlight-label {
            position: absolute;
            z-index: 2147483647;
            background: yellow;
            color: black;
            font-size: 25px;
            padding: 3px 5px;
            border: 1px solid black;
            border-radius: 3px;
            white-space: nowrap;
            box-shadow: 0px 0px 2px #000;
            top: -25px;
            left: 0;
            display: block;
        }
    \`;

    function getElementIdentifier(element) {
        const textContent = element.textContent?.trim();
        const value = element.getAttribute('value')?.trim();
        const ariaLabel = element.getAttribute('aria-label')?.trim();
        const title = element.getAttribute('title')?.trim();
        const placeholder = element.getAttribute('placeholder')?.trim();
        return textContent || value || ariaLabel || title || placeholder || '';
    }

    function createAndAdjustLabel(element, index) {
        if (!isElementVisible(element)) return;

        element.classList.add('highlighted-element');
        const identifier = getElementIdentifier(element);
        
        if (!identifier) {
            const label = document.createElement('div');
            label.className = 'highlight-label';
            label.textContent = index.toString();

            const rect = element.getBoundingClientRect();
            const top = rect.top + window.scrollY - 25;
            const left = rect.left + window.scrollX;

            label.style.top = top + 'px';
            label.style.left = left + 'px';

            document.body.appendChild(label);
        }
    }

    // Select and highlight clickable elements
    const allElements = document.querySelectorAll(selector);
    let numberIndex = 1;
    
    allElements.forEach((element) => {
        if (!element.dataset.highlighted && isElementVisible(element)) {
            element.dataset.highlighted = 'true';
            createAndAdjustLabel(element, numberIndex++);
        }
    });
`;

export const HIGHLIGHT_TEXT_FIELDS_SCRIPT = `
    const textFieldSelector = 'input[type="text"], input[type="password"], input[type="email"], input[type="tel"], input[type="number"], input[type="search"], textarea';
    const textFieldElements = document.querySelectorAll(textFieldSelector);
    textFieldElements.forEach((element) => {
        element.style.border = '2px solid red';
    });
`;

export const HIGHLIGHT_DROPDOWNS_SCRIPT = `
    const dropdownSelector = 'select';
    const dropdownElements = document.querySelectorAll(dropdownSelector);
    dropdownElements.forEach((element) => {
        element.style.border = '2px solid red';
    });
`;

export const REMOVE_HIGHLIGHTS_SCRIPT = `
    // Remove all labels
    document.querySelectorAll('.highlight-label').forEach((label) => {
        label.remove();
    });

    // Remove the added style
    const highlightStyle = document.getElementById('highlight-style');
    if (highlightStyle) {
        highlightStyle.remove();
    }

    // Remove inline styles
    const removeSelector = 'a, button, input, textarea, select, div[onclick], div[role="button"], div[tabindex], span[onclick], span[role="button"], span[tabindex]';
    document.querySelectorAll(removeSelector).forEach((element) => {
        element.style.border = '';
    });
`;