import { Position } from 'vscode-languageserver-types';
export declare function popMany<T>(array: T[], count: number): T[];
export declare function top<T>(array: T[]): T;
export declare function isString(s: any): boolean;
export declare function isInRange(position: Position, startRange: Position, endRange: Position): 1 | 0 | -1;
export declare function guid(): string;
