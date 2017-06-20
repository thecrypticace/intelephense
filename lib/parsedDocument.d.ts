import { Phrase, Token, MemberName, TokenType, PhraseType, SimpleVariable, ScopedMemberName } from 'php7parser';
import * as lsp from 'vscode-languageserver-types';
import { TreeVisitor, TreeTraverser, Event, Predicate, Traversable } from './types';
export interface ParsedDocumentChangeEventArgs {
    parsedDocument: ParsedDocument;
}
export declare class ParsedDocument implements Traversable<Phrase | Token> {
    private static _wordRegex;
    private _textDocument;
    private _parseTree;
    private _changeEvent;
    private _debounce;
    private _reparse;
    constructor(uri: string, text: string);
    readonly tree: Phrase;
    readonly uri: string;
    readonly changeEvent: Event<ParsedDocumentChangeEventArgs>;
    find(predicate: Predicate<Phrase | Token>): Phrase;
    textBeforeOffset(offset: number, length: number): string;
    lineSubstring(offset: number): string;
    wordAtOffset(offset: number): string;
    flush(): void;
    traverse(visitor: TreeVisitor<Phrase | Token>): TreeVisitor<Token | Phrase>;
    createTraverser(): TreeTraverser<Token | Phrase>;
    applyChanges(contentChanges: lsp.TextDocumentContentChangeEvent[]): void;
    tokenRange(t: Token): lsp.Range;
    nodeLocation(node: Phrase | Token): lsp.Location;
    nodeRange(node: Phrase | Token): lsp.Range;
    tokenText(t: Token): string;
    nodeText(node: Phrase | Token, ignore?: TokenType[]): string;
    createAnonymousName(node: Phrase): string;
    positionAtOffset(offset: number): lsp.Position;
    offsetAtPosition(position: lsp.Position): number;
    namespaceNamePhraseToString(node: Phrase | Token): string;
}
export declare namespace ParsedDocument {
    function firstToken(node: Phrase | Token): Token;
    function lastToken(node: Phrase | Token): Token;
    function isToken(node: Phrase | Token, types?: TokenType[]): boolean;
    function isPhrase(node: Phrase | Token, types?: PhraseType[]): boolean;
    function isOffsetInToken(offset: number, t: Token): boolean;
    function isOffsetInNode(offset: any, node: Phrase | Token): boolean;
    function isFixedMemberName(phrase: MemberName): boolean;
    function isFixedSimpleVariable(phrase: SimpleVariable): boolean;
    function isFixedScopedMemberName(phrase: ScopedMemberName): boolean;
    function stringyfyReplacer(k: any, v: any): any;
    function firstPhraseOfType(type: PhraseType, nodes: (Phrase | Token)[]): Phrase;
    function isNamePhrase(node: Phrase | Token): boolean;
}
export declare class ParsedDocumentStore {
    private _parsedDocumentChangeEvent;
    private _parsedDocumentmap;
    private _unsubscribeMap;
    private _bubbleEvent;
    constructor();
    readonly parsedDocumentChangeEvent: Event<ParsedDocumentChangeEventArgs>;
    readonly count: number;
    has(uri: string): boolean;
    add(parsedDocument: ParsedDocument): void;
    remove(uri: string): void;
    find(uri: string): ParsedDocument;
}
