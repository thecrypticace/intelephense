import { TreeVisitor, MultiVisitor } from './types';
import { Phrase, Token } from 'php7parser';
import { PhpSymbol } from './symbol';
import { SymbolStore } from './symbolStore';
import { ParsedDocument } from './parsedDocument';
import { NameResolver } from './nameResolver';
import { Predicate } from './types';
import { NameResolverVisitor } from './nameResolverVisitor';
import { VariableTypeVisitor, VariableTable } from './typeResolver';
import * as lsp from 'vscode-languageserver-types';
export declare class ReferenceReader extends MultiVisitor<Phrase | Token> {
    nameResolverVisitor: NameResolverVisitor;
    variableTypeVisitor: VariableTypeVisitor;
    referenceVisitor: ReferenceVisitor;
    constructor(nameResolverVisitor: NameResolverVisitor, variableTypeVisitor: VariableTypeVisitor, referenceVisitor: ReferenceVisitor);
    readonly references: DocumentReferences;
    static create(document: ParsedDocument, nameResolver: NameResolver, symbolStore: SymbolStore, variableTable: VariableTable): ReferenceReader;
}
export declare class ReferenceVisitor implements TreeVisitor<Phrase | Token> {
    doc: ParsedDocument;
    nameResolver: NameResolver;
    symbolStore: SymbolStore;
    private _references;
    private _transformerStack;
    constructor(doc: ParsedDocument, nameResolver: NameResolver, symbolStore: SymbolStore);
    readonly references: DocumentReferences;
    preorder(node: Phrase | Token, spine: (Phrase | Token)[]): boolean;
    postorder(node: Phrase | Token, spine: (Phrase | Token)[]): void;
}
export interface Reference {
    range: lsp.Range;
    symbol: PhpSymbol | PhpSymbol[];
    typeString?: string;
}
export declare class DocumentReferences {
    private _references;
    private _uri;
    private _search;
    constructor(uri: string, references: Reference[]);
    filter(predicate: Predicate<Reference>): Reference[];
    referenceAtPosition(position: lsp.Position): Reference;
}
