export interface KUHULASTNode {
    type: string;
    start: number;
    end: number;
    value?: any;
    children?: KUHULASTNode[];
}
export declare class KUHULParser {
    private sourceFile;
    private πBindings;
    private τBindings;
    private glyphCalls;
    constructor(source: string, filename?: string);
    parse(): KUHULProgram;
    private visitNode;
    private evaluateExpression;
    private parseArgs;
    private parseArgValue;
    private generateTransformedCode;
}
export interface KUHULProgram {
    πBindings: Map<string, any>;
    τBindings: Map<string, any>;
    glyphCalls: Array<{
        glyph: string;
        args: any[];
        position?: number;
        source?: string;
    }>;
    functions: Array<{
        name: string;
        parameters: string[];
        body: string;
        isGenerator: boolean;
        position?: number;
    }>;
    directives: Array<{
        type: string;
        condition?: string;
        thenBranch?: string;
        elseBranch?: string;
        position?: number;
    }>;
    transformedCode: string;
}
