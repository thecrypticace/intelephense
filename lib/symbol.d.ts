import { Location } from 'vscode-languageserver-types';
import { Predicate, TreeVisitor } from './types';
import { Phrase, Token, NamespaceName, FunctionDeclarationHeader, TypeDeclaration, QualifiedName, ParameterDeclaration, ConstElement, FunctionDeclaration, ClassDeclaration, ClassDeclarationHeader, ClassBaseClause, ClassInterfaceClause, QualifiedNameList, InterfaceDeclaration, InterfaceDeclarationHeader, InterfaceBaseClause, TraitDeclaration, TraitDeclarationHeader, ClassConstDeclaration, ClassConstElement, Identifier, MethodDeclaration, MethodDeclarationHeader, PropertyDeclaration, PropertyElement, MemberModifierList, NamespaceDefinition, NamespaceUseDeclaration, NamespaceUseClause, AnonymousClassDeclaration, AnonymousFunctionCreationExpression, AnonymousFunctionUseVariable, TraitUseClause, SimpleVariable } from 'php7parser';
import { PhpDoc, Tag, MethodTagParam } from './phpDoc';
import { ParseTree } from './parse';
import { TextDocument } from './document';
export declare const enum SymbolKind {
    None = 0,
    Class = 1,
    Interface = 2,
    Trait = 4,
    Constant = 8,
    Property = 16,
    Method = 32,
    Function = 64,
    Parameter = 128,
    Variable = 256,
    Namespace = 512,
}
export declare const enum SymbolModifier {
    None = 0,
    Public = 1,
    Protected = 2,
    Private = 4,
    Final = 8,
    Abstract = 16,
    Static = 32,
    ReadOnly = 64,
    WriteOnly = 128,
    Magic = 256,
    Anonymous = 512,
    Reference = 1024,
    Variadic = 2048,
    Use = 4096,
}
export interface PhpSymbol {
    kind: SymbolKind;
    name: string;
    location?: Location;
    modifiers?: SymbolModifier;
    description?: string;
    type?: TypeString;
    associated?: PhpSymbol[];
    children?: PhpSymbol[];
    scope?: string;
}
export declare namespace PhpSymbol {
    function acronym(s: PhpSymbol): string;
    /**
     * Get suffixes after $, namespace separator, underscore and on lowercase uppercase boundary
     */
    function suffixArray(s: PhpSymbol): string[];
}
export declare class NameResolver {
    namespaceName: string;
    thisName: string;
    importedSymbols: PhpSymbol[];
    constructor(namespaceName: string, thisName: string, importedSymbols: PhpSymbol[]);
    resolveRelative(relativeName: string): string;
    resolveNotFullyQualified(notFqName: string, kind: SymbolKind): string;
    private _matchImportedSymbol(text, kind);
    private _resolveQualified(name, pos);
    private _resolveUnqualified(name, kind);
}
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
export declare class SymbolTable {
    uri: string;
    root: PhpSymbol;
    constructor(uri: string, root: PhpSymbol);
    readonly symbols: PhpSymbol[];
    readonly count: number;
    static create(parseTree: ParseTree, textDocument: TextDocument): SymbolTable;
}
export declare class SymbolStore {
    private _map;
    private _index;
    private _symbolCount;
    constructor();
    getSymbolTable(uri: string): SymbolTable;
    readonly tableCount: number;
    readonly symbolCount: number;
    add(symbolTable: SymbolTable): void;
    remove(uri: string): void;
    /**
     * Matches any symbol by name or partial name (excluding parameters and variables)
     */
    match(text: string, kindMask?: SymbolKind): PhpSymbol[];
    lookupTypeMembers(typeName: string, memberPredicate: Predicate<PhpSymbol>): PhpSymbol[];
    lookupTypeMember(typeName: string, memberPredicate: Predicate<PhpSymbol>): PhpSymbol;
    private _lookupTypeMembers(type, predicate);
    private _indexSymbols(root);
}
export declare class SymbolReader implements TreeVisitor<Phrase | Token> {
    textDocument: TextDocument;
    nameResolver: NameResolver;
    spine: PhpSymbol[];
    lastPhpDoc: PhpDoc;
    namespaceUseDeclarationKind: SymbolKind;
    namespaceUseDeclarationPrefix: string;
    classConstDeclarationModifier: SymbolModifier;
    propertyDeclarationModifier: SymbolModifier;
    constructor(textDocument: TextDocument, nameResolver: NameResolver, spine: PhpSymbol[]);
    preOrder(node: Phrase | Token, spine: (Phrase | Token)[]): boolean;
    postOrder(node: Phrase | Token, spine: (Phrase | Token)[]): void;
    private _variableExists(name);
    private _token(t);
    private _addSymbol(symbol, pushToSpine);
}
export declare namespace SymbolReader {
    var nameResolver: NameResolver;
    var textDocument: TextDocument;
    function tokenText(t: Token): string;
    function nameTokenToFqn(t: Token): string;
    function phraseLocation(p: Phrase): Location;
    /**
     *
     * Uses phrase range to provide "unique" name
     */
    function anonymousName(node: Phrase): string;
    function functionDeclaration(node: FunctionDeclaration, phpDoc: PhpDoc): PhpSymbol;
    function functionDeclarationHeader(node: FunctionDeclarationHeader): string;
    function parameterDeclaration(node: ParameterDeclaration, phpDoc: PhpDoc): PhpSymbol;
    function typeDeclaration(node: TypeDeclaration): string;
    function qualifiedName(node: QualifiedName, kind: SymbolKind): string;
    function constElement(node: ConstElement, phpDoc: PhpDoc): PhpSymbol;
    function classConstantDeclaration(node: ClassConstDeclaration): SymbolModifier;
    function classConstElement(modifiers: SymbolModifier, node: ClassConstElement, phpDoc: PhpDoc): PhpSymbol;
    function methodDeclaration(node: MethodDeclaration, phpDoc: PhpDoc): PhpSymbol;
    function memberModifierList(node: MemberModifierList): SymbolModifier;
    function methodDeclarationHeader(node: MethodDeclarationHeader): string;
    function propertyDeclaration(node: PropertyDeclaration): SymbolModifier;
    function propertyElement(modifiers: SymbolModifier, node: PropertyElement, phpDoc: PhpDoc): PhpSymbol;
    function identifier(node: Identifier): string;
    function interfaceDeclaration(node: InterfaceDeclaration, phpDoc: PhpDoc): PhpSymbol;
    function phpDocMembers(phpDoc: PhpDoc): PhpSymbol[];
    function methodTagToSymbol(tag: Tag): PhpSymbol;
    function magicMethodParameterToSymbol(p: MethodTagParam): PhpSymbol;
    function propertyTagToSymbol(t: Tag): PhpSymbol;
    function magicPropertyModifier(t: Tag): SymbolModifier;
    function interfaceDeclarationHeader(node: InterfaceDeclarationHeader): string;
    function interfaceBaseClause(node: InterfaceBaseClause): PhpSymbol[];
    function traitDeclaration(node: TraitDeclaration, phpDoc: PhpDoc): PhpSymbol;
    function traitDeclarationHeader(node: TraitDeclarationHeader): string;
    function classDeclaration(node: ClassDeclaration, phpDoc: PhpDoc): PhpSymbol;
    function classDeclarationHeader(s: PhpSymbol, node: ClassDeclarationHeader): PhpSymbol;
    function classBaseClause(node: ClassBaseClause): PhpSymbol;
    function classInterfaceClause(node: ClassInterfaceClause): PhpSymbol[];
    function traitUseClause(node: TraitUseClause): PhpSymbol[];
    function anonymousClassDeclaration(node: AnonymousClassDeclaration): PhpSymbol;
    function anonymousFunctionCreationExpression(node: AnonymousFunctionCreationExpression): PhpSymbol;
    function anonymousFunctionUseVariable(node: AnonymousFunctionUseVariable): PhpSymbol;
    function simpleVariable(node: SimpleVariable): PhpSymbol;
    function qualifiedNameList(node: QualifiedNameList): string[];
    function modifierListElementsToSymbolModifier(tokens: Token[]): SymbolModifier;
    function modifierTokenToSymbolModifier(t: Token): SymbolModifier;
    function namespaceName(node: NamespaceName): string;
    function concatNamespaceName(prefix: string, name: string): string;
    function namespaceUseClause(node: NamespaceUseClause, kind: SymbolKind, prefix: string): PhpSymbol;
    function tokenToSymbolKind(t: Token): SymbolKind;
    function namespaceUseDeclaration(node: NamespaceUseDeclaration): [SymbolKind, string];
    function namespaceDefinition(node: NamespaceDefinition): PhpSymbol;
}
export declare class SymbolIndex {
    private _nodeArray;
    private _binarySearch;
    private _collator;
    constructor();
    add(item: PhpSymbol): void;
    addMany(items: PhpSymbol[]): void;
    remove(item: PhpSymbol): void;
    removeMany(items: PhpSymbol[]): void;
    match(text: string): PhpSymbol[];
    private _nodeMatch(text);
    private _nodeFind(text);
    private _insertNode(node);
    private _deleteNode(node);
    private _symbolSuffixes(s);
}
