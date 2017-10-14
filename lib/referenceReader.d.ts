import { TreeVisitor } from './types';
import { Phrase, Token } from 'php7parser';
import { SymbolStore, SymbolTable } from './symbolStore';
import { ParsedDocument } from './parsedDocument';
import { NameResolver } from './nameResolver';
export declare class ReferenceReader implements TreeVisitor<Phrase | Token> {
    doc: ParsedDocument;
    nameResolver: NameResolver;
    symbolStore: SymbolStore;
    symbolTable: SymbolTable;
    private _transformStack;
    private _variableTable;
    private _classStack;
    private _scopeStack;
    private _symbols;
    private _symbolFilter;
    private _lastVarTypehints;
    constructor(doc: ParsedDocument, nameResolver: NameResolver, symbolStore: SymbolStore, symbolTable: SymbolTable);
    preorder(node: Phrase | Token, spine: (Phrase | Token)[]): boolean;
    postorder(node: Phrase | Token, spine: (Phrase | Token)[]): void;
    private _nameSymbolType(parent);
    private _methodDeclaration();
    private _functionDeclaration();
    private _anonymousFunctionCreationExpression();
    private _referenceSymbols;
}
export declare namespace ReferenceReader {
    function discoverReferences(doc: ParsedDocument, table: SymbolTable, symbolStore: SymbolStore): SymbolTable;
}
