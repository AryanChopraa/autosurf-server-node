export interface ScriptCommand {
    type: 'navigation' | 'click' | 'type' | 'typeAndEnter' | 'scroll' | 'back' | 'search' | 'solveCaptcha';
    xpath?: string;
    value?: string;
    url?: string;
    identifier?: string;
    placeholder_value?: string;
    text?: string;
    query?: string;
}

export interface ElementInfo {
    isVisible: boolean;
    details: {
        tagName: string;
        id: string;
        className: string;
        src: string;
        display: string;
        visibility: string;
        width: number;
        height: number;
    };
} 