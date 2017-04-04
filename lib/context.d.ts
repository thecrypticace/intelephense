import { SymbolStore, NameResolver, PhpSymbol } from './symbol';
import { TreeTraverser } from './types';
import { ParsedDocument } from './parsedDocument';
import { Position } from 'vscode-languageserver-types';
import { Phrase, Token } from 'php7parser';
export declare class Context {
    symbolStore: SymbolStore;
    document: ParsedDocument;
    position: Position;
    private _nameResolver;
    private _parseTreeSpine;
    private _offset;
    private _namespaceDefinition;
    private _scopePhrase;
    private _scopeSymbol;
    constructor(symbolStore: SymbolStore, document: ParsedDocument, position: Position);
    readonly token: Token;
    readonly offset: number;
    readonly spine: (Token | Phrase)[];
    readonly scopePhrase: Phrase;
    readonly scopeSymbol: PhpSymbol;
    createNameResolver(): NameResolver;
    createTraverser(): TreeTraverser<Token | Phrase>;
    private _isScopePhrase(p);
    private _isScopeBody(p);
    private _importFilter(s);
}
