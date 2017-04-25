import { NameResolver } from './nameResolver';
export declare class TypeString {
    private static _classNamePattern;
    private static _keywords;
    private _parts;
    constructor(text: string);
    isEmpty(): boolean;
    atomicClassArray(): string[];
    arrayDereference(): TypeString;
    array(): TypeString;
    merge(type: string | TypeString): TypeString;
    nameResolve(nameResolver: NameResolver): TypeString;
    toString(): string;
    private _unique(parts);
    private _chunk(typeString);
}
