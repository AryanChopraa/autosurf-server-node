import OpenAI from 'openai';

// Custom decorator to replicate Python's classproperty
function classproperty(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const getter = descriptor.get;
    if (!getter) throw new Error('Classproperty must have a getter');
    
    // Create a new descriptor that works on the class
    const newDescriptor: PropertyDescriptor = {
        enumerable: descriptor.enumerable,
        configurable: descriptor.configurable,
        get: function(this: any) {
            return getter.call(this);
        }
    };
    
    return newDescriptor;
}

interface SharedState {
    [key: string]: any;
}

interface ToolParameters {
    properties: Record<string, any>;
    required?: string[];
    $defs?: Record<string, any>;
    additionalProperties?: boolean;
}

export abstract class BaseTool {
    protected static _sharedState: SharedState = {};
    protected callerAgent: any = null;
    protected eventHandler: any = null;
    protected toolCall: any = null;
    
    // Configuration object definition
    protected static ToolConfig = {
        strict: false,
        oneCallAtATime: false,
        outputAsResult: false,
        asyncMode: null as 'threading' | null
    };

    constructor(protected page?: any, protected client?: OpenAI) {}

    static get openaiSchema(): Record<string, any> {
        const schema = this.getJsonSchema();
        const docString = this.getDocString();
        
        const parameters: ToolParameters = {
            properties: {},
            required: []
        };

        Object.entries(schema)
            .filter(([key]) => !['title', 'description'].includes(key))
            .forEach(([key, value]) => {
                parameters.properties[key] = value;
            });

        // Add docstring descriptions to parameters if available
        if (docString.params) {
            docString.params.forEach(param => {
                const paramName = param.name;
                if (paramName in parameters.properties && param.description) {
                    parameters.properties[paramName].description = param.description;
                }
            });
        }

        // Set required parameters
        parameters.required = Object.entries(parameters.properties)
            .filter(([_, value]) => typeof value === 'object' && !value.hasOwnProperty('default'))
            .map(([key]) => key)
            .sort();

        // Build final schema
        const finalSchema: {
            name: string;
            description: string;
            parameters: ToolParameters;
            strict?: boolean;
        } = {
            name: schema.title || this.name,
            description: schema.description || docString.shortDescription || 
                        `Correctly extracted \`${this.name}\` with all the required parameters with correct types`,
            parameters
        };

        // Add strict mode properties if enabled
        if (this.ToolConfig.strict) {
            finalSchema.strict = true;
            finalSchema.parameters.additionalProperties = false;

            // Set additionalProperties to false in all definitions
            if (finalSchema.parameters.$defs) {
                Object.values(finalSchema.parameters.$defs).forEach((def: any) => {
                    def.additionalProperties = false;
                });
            }
        }

        return finalSchema;
    }

    // Helper method to get JSON schema (implement based on your needs)
    protected static getJsonSchema(): Record<string, any> {
        return {
            title: this.name,
            description: '',
            properties: {},
            required: []
        };
    }

    // Helper method to parse docstring (implement based on your needs)
    protected static getDocString(): {
        shortDescription?: string;
        params?: Array<{
            name: string;
            description?: string;
        }>;
    } {
        return {
            shortDescription: '',
            params: []
        };
    }

    // Abstract method that must be implemented by child classes
    abstract run(...args: any[]): Promise<any>;

    // Utility methods that can be used by child classes
    protected async waitForElement(selector: string, timeout = 5000): Promise<any> {
        if (!this.page) throw new Error('Page is not initialized');
        return await this.page.waitForSelector(selector, { timeout });
    }

    protected async executeWithRetry<T>(
        action: () => Promise<T>,
        retries = 3,
        delay = 1000
    ): Promise<T> {
        let lastError: Error | null = null;
        
        for (let i = 0; i < retries; i++) {
            try {
                return await action();
            } catch (error) {
                lastError = error as Error;
                if (i < retries - 1) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        
        throw lastError || new Error('Operation failed after retries');
    }

    // Getter for shared state
    protected get sharedState(): SharedState {
        return (this.constructor as typeof BaseTool)._sharedState;
    }

    // Method to update shared state
    protected setSharedState(key: string, value: any): void {
        const constructor = this.constructor as typeof BaseTool;
        constructor._sharedState[key] = value;
    }
}