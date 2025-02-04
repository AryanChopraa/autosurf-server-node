import { NavigationTool } from './NavigationTool';
import { SearchTool } from './SearchTool';
import { ClickTool } from './ClickTool';
import { TypingTool } from './TypingTool';
import { TypingWithEnterTool } from './TypingWithEnterTool';
import { CaptchaSolverTool } from './CaptchaSolverTool';
import { ScrollTool } from './ScrollTool';
import { BackTool } from './BackTool';
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
                    },
                    explanation: {
                        type: 'string',
                        description: 'Explanation for why this action is being taken.'
                    },
                    action: {
                        type: 'string',
                        description: 'Textual summary of the action being taken.'
                    }
                },
                required: ['url']
            }
        }
    },
    // {
    //     type: 'function',
    //     function: {
    //         name: SearchTool.openaiSchema.name,
    //         description: SearchTool.openaiSchema.description,
    //         parameters: {
    //             type: 'object',
    //             properties: {
    //                 query: {
    //                     type: 'string',
    //                     description: 'The search query to execute'
    //                 },
    //                 explanation: {
    //                     type: 'string',
    //                     description: 'Explanation for why this action is being taken.'
    //                 },
    //                 action: {
    //                     type: 'string',
    //                     description: 'Textual summary of the action being taken.'
    //                 }
    //             },
    //             required: ['query']
    //         }
    //     }
    // },
    {
        type: 'function',
        function: {
            name: ClickTool.openaiSchema.name,
            description: ClickTool.openaiSchema.description,
            parameters: {
                type: 'object',
                properties: {
                    identifier: {
                        type: 'string',
                        description: 'The text content to click example Login , Which countries have restricted DeepSeek and why?, Rin Detergent Liquid 2L Pouch - Top Load, Top news on DeepSeek'
                    },
                    explanation: {
                        type: 'string',
                        description: 'Explanation for why this action is being taken.'
                    },
                    action: {
                        type: 'string',
                        description: 'Textual summary of the action being taken.'
                    }
                },
                required: ['identifier']
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
                    },
                    explanation: {
                        type: 'string',
                        description: 'Explanation for why this action is being taken.'
                    },
                    action: {
                        type: 'string',
                        description: 'Textual summary of the action being taken.'
                    }
                },
                required: ['placeholder_value', 'text']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'handle_typing_with_enter',
            description: 'Type text into an input field and press Enter',
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
                    },
                    explanation: {
                        type: 'string',
                        description: 'Explanation for why this action is being taken.'
                    },
                    action: {
                        type: 'string',
                        description: 'Textual summary of the action being taken.'
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
                properties: {
                    explanation: {
                        type: 'string',
                        description: 'Explanation for why this action is being taken.'
                    },
                    action: {
                        type: 'string',
                        description: 'Textual summary of the action being taken.'
                    }
                },
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: ScrollTool.openaiSchema.name,
            description: ScrollTool.openaiSchema.description,
            parameters: {
                type: 'object',
                properties: {
                    explanation: {
                        type: 'string',
                        description: 'Explanation for why this action is being taken.'
                    },
                    action: {
                        type: 'string',
                        description: 'Textual summary of the action being taken.'
                    }
                },
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: BackTool.openaiSchema.name,
            description: BackTool.openaiSchema.description,
            parameters: {
                type: 'object',
                properties: {
                    explanation: {
                        type: 'string',
                        description: 'Explanation for why this action is being taken.'
                    },
                    action: {
                        type: 'string',
                        description: 'Textual summary of the action being taken.'
                    }
                },
                required: []
            }
        }
    }
];