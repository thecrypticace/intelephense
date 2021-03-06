import { Position, Range } from 'vscode-languageserver-types';
import { Predicate } from './types';
export declare function popMany<T>(array: T[], count: number): T[];
export declare function top<T>(array: T[]): T;
export declare function isString(s: any): boolean;
export declare function isInRange(position: Position, range: Range): 0 | 1 | -1;
export declare function positionEquality(p1: Position, p2: Position): boolean;
export declare function rangeEquality(r1: Range, r2: Range): boolean;
export declare function acronym(text: string): string;
export declare function trigrams(text: string): Set<string>;
export declare function ciStringContains(query: string, subject: string): boolean;
export declare function ciStringMatch(a: string, b: string): boolean;
export declare function whitespace(n: number): string;
/**
 * http://stackoverflow.com/a/7616484
 */
export declare function hash32(text: string): number;
export declare function filter<T>(items: T[], fn: Predicate<T>): T[];
export declare function find<T>(items: T[], fn: Predicate<T>): T;
export declare function cloneRange(range: Range): Range;
