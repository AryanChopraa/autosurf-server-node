/**
 * Interface for the WebDriver type
 */
interface WebDriver {
    executeScript(script: string): void;
}

/**
 * Highlights clickable elements like buttons, links, and certain divs and spans
 * that match the given CSS selector on the webpage with a red border and ensures 
 * that labels are visible and positioned correctly within the viewport.
 * 
 * @param driver - Instance of WebDriver
 * @param selector - CSS selector for the elements to be highlighted
 * @returns The WebDriver instance
 */
export function highlightElementsWithLabels(driver: WebDriver, selector: string): WebDriver {
    const script = `
        // Helper function to check if an element is visible
        function isElementVisible(element) {
            var rect = element.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0 ||
                rect.top >= (window.innerHeight || document.documentElement.clientHeight) ||
                rect.bottom <= 0 ||
                rect.left >= (window.innerWidth || document.documentElement.clientWidth) ||
                rect.right <= 0) {
                return false;
            }
            // Check if any parent element is hidden, which would hide this element as well
            var parent = element;
            while (parent) {
                var style = window.getComputedStyle(parent);
                if (style.display === 'none' || style.visibility === 'hidden') {
                    return false;
                }
                parent = parent.parentElement;
            }
            return true;
        }

        // Remove previous labels and styles if they exist
        document.querySelectorAll('.highlight-label').forEach(function(label) {
            label.remove();
        });
        document.querySelectorAll('.highlighted-element').forEach(function(element) {
            element.classList.remove('highlighted-element');
            element.removeAttribute('data-highlighted');
        });

        // Inject custom style for highlighting elements
        var styleElement = document.getElementById('highlight-style');
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
                display: none;
            }
        \`;

        // Function to create and append a label to the body
        function createAndAdjustLabel(element, index) {
            if (!isElementVisible(element)) return;

            element.classList.add('highlighted-element');
            var label = document.createElement('div');
            label.className = 'highlight-label';
            label.textContent = index.toString();
            label.style.display = 'block'; // Make the label visible

            // Calculate label position
            var rect = element.getBoundingClientRect();
            var top = rect.top + window.scrollY - 25; // Position label above the element
            var left = rect.left + window.scrollX;

            label.style.top = top + 'px';
            label.style.left = left + 'px';

            document.body.appendChild(label); // Append the label to the body
        }

        // Select all clickable elements and apply the styles
        var allElements = document.querySelectorAll('${selector}');
        var index = 1;
        allElements.forEach(function(element) {
            // Check if the element is not already highlighted and is visible
            if (!element.dataset.highlighted && isElementVisible(element)) {
                element.dataset.highlighted = 'true';
                createAndAdjustLabel(element, index++);
            }
        });
    `;

    driver.executeScript(script);
    return driver;
}

/**
 * Removes all red borders and labels from the webpage elements,
 * reversing the changes made by the highlight functions.
 * 
 * @param driver - Instance of WebDriver
 * @returns The WebDriver instance
 */
export function removeHighlightAndLabels(driver: WebDriver): WebDriver {
    const selector = 
        'a, button, input, textarea, div[onclick], div[role="button"], div[tabindex], span[onclick], ' +
        'span[role="button"], span[tabindex]';

    const script = `
        // Remove all labels
        document.querySelectorAll('.highlight-label').forEach(function(label) {
            label.remove();
        });

        // Remove the added style for red borders
        var highlightStyle = document.getElementById('highlight-style');
        if (highlightStyle) {
            highlightStyle.remove();
        }

        // Remove inline styles added by highlighting function
        document.querySelectorAll('${selector}').forEach(function(element) {
            element.style.border = '';
        });
    `;

    driver.executeScript(script);
    return driver;
}