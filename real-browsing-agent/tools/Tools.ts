import { NavigationTool } from './NavigationTool';
import { SearchTool } from './SearchTool';
import { ClickTool } from './ClickTool';
import { TypingTool } from './TypingTool';
import { CaptchaSolverTool } from './CaptchaSolverTool';
import OpenAI from 'openai';

export interface ToolFunction {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, {
            type: string;
            description: string;
        }>;
        required: string[];
    };
}

export interface Tool extends OpenAI.ChatCompletionTool {
    type: 'function';
    function: ToolFunction;
}

// Cast and transform the schemas to match OpenAI's ChatCompletionTool type
export const TOOLS: Tool[] = [
    {
        type: 'function',
        function: {
            name: NavigationTool.openaiSchema.name,
            description: NavigationTool.openaiSchema.description,
            parameters: {
                type: 'object',
                properties: {
                    url: {
                        type: 'string',
                        description: 'The URL to navigate to'
                    }
                },
                required: ['url']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: SearchTool.openaiSchema.name,
            description: SearchTool.openaiSchema.description,
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'The search query to execute'
                    }
                },
                required: ['query']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: ClickTool.openaiSchema.name,
            description: ClickTool.openaiSchema.description,
            parameters: {
                type: 'object',
                properties: {
                    text: {
                        type: 'string',
                        description: 'The text content or attribute value of the element to click'
                    }
                },
                required: ['text']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: TypingTool.openaiSchema.name,
            description: TypingTool.openaiSchema.description,
            parameters: {
                type: 'object',
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
                required: ['placeholder_value', 'text']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: CaptchaSolverTool.openaiSchema.name,
            description: CaptchaSolverTool.openaiSchema.description,
            parameters: {
                type: 'object',
                properties: {},
                required: []
            }
        }
    }
];