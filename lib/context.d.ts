import { SymbolStore, NameResolver } from './symbol';
import { TreeTraverser } from './types';
import { ParsedDocument } from './parsedDocument';
import { Position } from 'vscode-languageserver-types';
import { Phrase, Token } from 'php7parser';
export declare class Context {
    private _nameResolver;
    private _spine;
    private _offset;
    constructor(spine: (Phrase | Token)[], nameResolver: NameResolver, offset: number);
    readonly offset: number;
    readonly spine: (Token | Phrase)[];
    readonly nameResolver: NameResolver;
    createTraverser(): TreeTraverser<Token | Phrase>;
    static create(symbolStore: SymbolStore, document: ParsedDocument, position: Position): Context;
}
