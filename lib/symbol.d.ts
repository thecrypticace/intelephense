import { Location } from 'vscode-languageserver-types';
import { Predicate, TreeVisitor } from './types';
import { Phrase, Token, NamespaceName, FunctionDeclarationHeader, TypeDeclaration, QualifiedName, ParameterDeclaration, ConstElement, FunctionDeclaration, ClassDeclaration, ClassDeclarationHeader, ClassBaseClause, ClassInterfaceClause, QualifiedNameList, InterfaceDeclaration, InterfaceDeclarationHeader, InterfaceBaseClause, TraitDeclaration, TraitDeclarationHeader, ClassConstDeclaration, ClassConstElement, Identifier, MethodDeclaration, MethodDeclarationHeader, PropertyDeclaration, PropertyElement, MemberModifierList, NamespaceDefinition, NamespaceUseDeclaration, NamespaceUseClause, AnonymousClassDeclaration, AnonymousFunctionCreationExpression, AnonymousFunctionUseVariable, TraitUseClause, SimpleVariable, ObjectCreationExpression, SubscriptExpression, FunctionCallExpression, FullyQualifiedName, RelativeQualifiedName, MemberName, PropertyAccessExpression, ClassTypeDesignator, ScopedCallExpression, ScopedMemberName, ScopedPropertyAccessExpression, TernaryExpression } from 'php7parser';
import { PhpDoc, Tag, MethodTagParam } from './phpDoc';
import { ParsedDocument, ParsedDocumentChangeEventArgs } from './parsedDocument';
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
    ClassConstant = 1024,
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
    document: ParsedDocument;
    importedSymbols: PhpSymbol[];
    namespaceName: string;
    thisName: string;
    thisBaseName: string;
    constructor(document: ParsedDocument, importedSymbols: PhpSymbol[], namespaceName: string, thisName: string, thisBaseName: string);
    resolveRelative(relativeName: string): string;
    resolveNotFullyQualified(notFqName: string, kind: SymbolKind): string;
    createAnonymousName(node: Phrase): string;
    namespaceNamePhraseText(node: NamespaceName, endOffset?: number): string;
    qualifiedNamePhraseText(node: FullyQualifiedName | QualifiedName | RelativeQualifiedName, kind: SymbolKind): string;
    tokenText(t: Token, endOffset?: number): string;
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
    filter(predicate: Predicate<PhpSymbol>): PhpSymbol[];
    find(predicate: Predicate<PhpSymbol>): PhpSymbol;
    static create(parsedDocument: ParsedDocument): SymbolTable;
}
export declare class SymbolStore {
    private _map;
    private _index;
    private _symbolCount;
    constructor();
    onParsedDocumentChange: (args: ParsedDocumentChangeEventArgs) => void;
    getSymbolTable(uri: string): SymbolTable;
    readonly tableCount: number;
    readonly symbolCount: number;
    add(symbolTable: SymbolTable): void;
    remove(uri: string): void;
    /**
     * As per match but returns first item in result
     * @param text
     * @param kindMask
     */
    find(text: string, filter?: Predicate<PhpSymbol>): PhpSymbol;
    /**
     * Matches any indexed symbol by name or partial name with optional additional filter
     * Parameters and variables that are not file scoped are not indexed.
     */
    match(text: string, filter?: Predicate<PhpSymbol>): PhpSymbol[];
    private _classOrInterfaceFilter(s);
    lookupTypeMembers(typeName: string, memberPredicate: Predicate<PhpSymbol>): PhpSymbol[];
    lookupTypeMember(typeName: string, memberPredicate: Predicate<PhpSymbol>): PhpSymbol;
    private _lookupTypeMembers(type, predicate);
    private _indexSymbols(root);
    private _indexFilter(s);
}
export declare class SymbolReader implements TreeVisitor<Phrase | Token> {
    parsedDocument: ParsedDocument;
    nameResolver: NameResolver;
    spine: PhpSymbol[];
    lastPhpDoc: PhpDoc;
    lastPhpDocLocation: Location;
    namespaceUseDeclarationKind: SymbolKind;
    namespaceUseDeclarationPrefix: string;
    classConstDeclarationModifier: SymbolModifier;
    propertyDeclarationModifier: SymbolModifier;
    constructor(parsedDocument: ParsedDocument, nameResolver: NameResolver, spine: PhpSymbol[]);
    preOrder(node: Phrase | Token, spine: (Phrase | Token)[]): boolean;
    postOrder(node: Phrase | Token, spine: (Phrase | Token)[]): void;
    private _variableExists(name);
    private _token(t);
    private _addSymbol(symbol, pushToSpine);
    nameTokenToFqn(t: Token): string;
    phraseLocation(p: Phrase): Location;
    functionDeclaration(node: FunctionDeclaration, phpDoc: PhpDoc): PhpSymbol;
    functionDeclarationHeader(node: FunctionDeclarationHeader): string;
    parameterDeclaration(node: ParameterDeclaration, phpDoc: PhpDoc): PhpSymbol;
    typeDeclaration(node: TypeDeclaration): string;
    qualifiedName(node: QualifiedName, kind: SymbolKind): string;
    constElement(node: ConstElement, phpDoc: PhpDoc): PhpSymbol;
    classConstantDeclaration(node: ClassConstDeclaration): SymbolModifier;
    classConstElement(modifiers: SymbolModifier, node: ClassConstElement, phpDoc: PhpDoc): PhpSymbol;
    methodDeclaration(node: MethodDeclaration, phpDoc: PhpDoc): PhpSymbol;
    memberModifierList(node: MemberModifierList): SymbolModifier;
    methodDeclarationHeader(node: MethodDeclarationHeader): string;
    propertyDeclaration(node: PropertyDeclaration): SymbolModifier;
    propertyElement(modifiers: SymbolModifier, node: PropertyElement, phpDoc: PhpDoc): PhpSymbol;
    identifier(node: Identifier): string;
    interfaceDeclaration(node: InterfaceDeclaration, phpDoc: PhpDoc, phpDocLoc: Location): PhpSymbol;
    phpDocMembers(phpDoc: PhpDoc, phpDocLoc: Location): PhpSymbol[];
    methodTagToSymbol(tag: Tag, phpDocLoc: Location): PhpSymbol;
    magicMethodParameterToSymbol(p: MethodTagParam, phpDocLoc: Location): PhpSymbol;
    propertyTagToSymbol(t: Tag, phpDocLoc: Location): PhpSymbol;
    magicPropertyModifier(t: Tag): SymbolModifier;
    interfaceDeclarationHeader(node: InterfaceDeclarationHeader): string;
    interfaceBaseClause(node: InterfaceBaseClause): PhpSymbol[];
    traitDeclaration(node: TraitDeclaration, phpDoc: PhpDoc, phpDocLoc: Location): PhpSymbol;
    traitDeclarationHeader(node: TraitDeclarationHeader): string;
    classDeclaration(node: ClassDeclaration, phpDoc: PhpDoc, phpDocLoc: Location): PhpSymbol;
    classDeclarationHeader(s: PhpSymbol, node: ClassDeclarationHeader): PhpSymbol;
    classBaseClause(node: ClassBaseClause): PhpSymbol;
    classInterfaceClause(node: ClassInterfaceClause): PhpSymbol[];
    traitUseClause(node: TraitUseClause): PhpSymbol[];
    anonymousClassDeclaration(node: AnonymousClassDeclaration): PhpSymbol;
    anonymousFunctionCreationExpression(node: AnonymousFunctionCreationExpression): PhpSymbol;
    anonymousFunctionUseVariable(node: AnonymousFunctionUseVariable): PhpSymbol;
    simpleVariable(node: SimpleVariable): PhpSymbol;
    qualifiedNameList(node: QualifiedNameList): string[];
    modifierListElementsToSymbolModifier(tokens: Token[]): SymbolModifier;
    modifierTokenToSymbolModifier(t: Token): SymbolModifier;
    concatNamespaceName(prefix: string, name: string): string;
    namespaceUseClause(node: NamespaceUseClause, kind: SymbolKind, prefix: string): PhpSymbol;
    tokenToSymbolKind(t: Token): SymbolKind;
    namespaceUseDeclaration(node: NamespaceUseDeclaration): [SymbolKind, string];
    namespaceDefinition(node: NamespaceDefinition): PhpSymbol;
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
export interface LookupVariableTypeDelegate {
    (name: string, offset: number): TypeString;
}
export declare class ExpressionTypeResolver {
    nameResolver: NameResolver;
    symbolStore: SymbolStore;
    lookupVariableTypeDelegate: LookupVariableTypeDelegate;
    constructor(nameResolver: NameResolver, symbolStore: SymbolStore, lookupVariableTypeDelegate: LookupVariableTypeDelegate);
    resolveExpression(node: Phrase | Token): TypeString;
    ternaryExpression(node: TernaryExpression): TypeString;
    scopedMemberAccessExpression(node: ScopedPropertyAccessExpression | ScopedCallExpression, kind: SymbolKind): TypeString;
    lookupMemberOnTypes(typeNames: string[], kind: SymbolKind, memberName: string, modifierMask: SymbolModifier, notModifierMask: SymbolModifier): PhpSymbol[];
    scopedMemberName(node: ScopedMemberName): string;
    classTypeDesignator(node: ClassTypeDesignator): TypeString;
    objectCreationExpression(node: ObjectCreationExpression): TypeString;
    simpleVariable(node: SimpleVariable): TypeString;
    subscriptExpression(node: SubscriptExpression): TypeString;
    functionCallExpression(node: FunctionCallExpression): TypeString;
    memberName(node: MemberName): string;
    instanceMemberAccessExpression(node: PropertyAccessExpression, kind: SymbolKind): TypeString;
    mergeTypes(symbols: PhpSymbol[]): TypeString;
}
