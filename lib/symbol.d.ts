import { Position, Location } from 'vscode-languageserver-types';
import { Predicate, TreeVisitor } from './types';
import { Phrase, PhraseType, Token, NamespaceName, FunctionDeclarationHeader, TypeDeclaration, QualifiedName, ParameterDeclaration, ConstElement, FunctionDeclaration, ClassDeclaration, ClassDeclarationHeader, ClassBaseClause, ClassInterfaceClause, QualifiedNameList, InterfaceDeclaration, InterfaceDeclarationHeader, InterfaceBaseClause, TraitDeclaration, TraitDeclarationHeader, ClassConstDeclaration, ClassConstElement, Identifier, MethodDeclaration, MethodDeclarationHeader, PropertyDeclaration, PropertyElement, MemberModifierList, NamespaceDefinition, NamespaceUseDeclaration, NamespaceUseClause, AnonymousClassDeclaration, AnonymousFunctionCreationExpression, AnonymousFunctionUseVariable, TraitUseClause, SimpleVariable, ObjectCreationExpression, SubscriptExpression, FunctionCallExpression, MemberName, PropertyAccessExpression, ClassTypeDesignator, ScopedCallExpression, ScopedMemberName, ScopedPropertyAccessExpression, TernaryExpression } from 'php7parser';
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
    value?: string;
    typeSource?: TypeSource;
}
export declare namespace PhpSymbol {
    function signatureString(s: PhpSymbol): string;
    function hasParameters(s: PhpSymbol): boolean;
    function notFqn(s: PhpSymbol): string;
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
    namePhraseToFqn(node: Phrase, kind: SymbolKind): string;
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
    symbolAtPosition(position: Position): PhpSymbol;
    static create(parsedDocument: ParsedDocument, ignorePhraseTypes?: PhraseType[]): SymbolTable;
    static createBuiltIn(): SymbolTable;
}
export interface MemberQuery {
    typeName: string;
    memberPredicate: Predicate<PhpSymbol>;
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
     * As per match but returns first item in result that matches text exactly
     * @param text
     * @param kindMask
     */
    find(text: string, filter?: Predicate<PhpSymbol>): PhpSymbol;
    /**
     * Matches any indexed symbol by name or partial name with optional additional filter
     * Parameters and variables that are not file scoped are not indexed.
     */
    match(text: string, filter?: Predicate<PhpSymbol>, fuzzy?: boolean): PhpSymbol[];
    private _classOrInterfaceFilter(s);
    lookupTypeMembers(query: MemberQuery): PhpSymbol[];
    lookupTypeMember(query: MemberQuery): PhpSymbol;
    lookupMembersOnTypes(queries: MemberQuery[]): PhpSymbol[];
    lookupMemberOnTypes(queries: MemberQuery[]): PhpSymbol;
    private _lookupTypeMembers(type, predicate, typeHistory);
    private _indexSymbols(root);
    private _indexFilter(s);
}
export declare const enum TypeSource {
    None = 0,
    TypeDeclaration = 1,
}
export declare class SymbolReader implements TreeVisitor<Phrase | Token> {
    parsedDocument: ParsedDocument;
    nameResolver: NameResolver;
    spine: PhpSymbol[];
    private static _varAncestors;
    private static _builtInTypes;
    private static _globalVars;
    lastPhpDoc: PhpDoc;
    lastPhpDocLocation: Location;
    namespaceUseDeclarationKind: SymbolKind;
    namespaceUseDeclarationPrefix: string;
    classConstDeclarationModifier: SymbolModifier;
    propertyDeclarationModifier: SymbolModifier;
    ignore: PhraseType[];
    constructor(parsedDocument: ParsedDocument, nameResolver: NameResolver, spine: PhpSymbol[]);
    preOrder(node: Phrase | Token, spine: (Phrase | Token)[]): boolean;
    postOrder(node: Phrase | Token, spine: (Phrase | Token)[]): void;
    private _shouldReadVar(spine);
    private _top();
    private _variableExists(name);
    private _token(t);
    private _addSymbol(symbol, pushToSpine);
    nameTokenToFqn(t: Token): string;
    phraseLocation(p: Phrase): Location;
    tokenLocation(t: Token): Location;
    functionDeclaration(node: FunctionDeclaration, phpDoc: PhpDoc): PhpSymbol;
    functionDeclarationHeader(s: PhpSymbol, node: FunctionDeclarationHeader): PhpSymbol;
    parameterDeclaration(node: ParameterDeclaration, phpDoc: PhpDoc): PhpSymbol;
    typeDeclaration(node: TypeDeclaration): string;
    qualifiedName(node: QualifiedName, kind: SymbolKind): string;
    constElement(node: ConstElement, phpDoc: PhpDoc): PhpSymbol;
    classConstantDeclaration(node: ClassConstDeclaration): SymbolModifier;
    classConstElement(modifiers: SymbolModifier, node: ClassConstElement, phpDoc: PhpDoc): PhpSymbol;
    methodDeclaration(node: MethodDeclaration, phpDoc: PhpDoc): PhpSymbol;
    memberModifierList(node: MemberModifierList): SymbolModifier;
    methodDeclarationHeader(s: PhpSymbol, node: MethodDeclarationHeader): PhpSymbol;
    propertyDeclaration(node: PropertyDeclaration): SymbolModifier;
    propertyElement(modifiers: SymbolModifier, node: PropertyElement, phpDoc: PhpDoc): PhpSymbol;
    identifier(node: Identifier): string;
    interfaceDeclaration(node: InterfaceDeclaration, phpDoc: PhpDoc, phpDocLoc: Location): PhpSymbol;
    phpDocMembers(phpDoc: PhpDoc, phpDocLoc: Location): PhpSymbol[];
    methodTagToSymbol(tag: Tag, phpDocLoc: Location): PhpSymbol;
    magicMethodParameterToSymbol(p: MethodTagParam, phpDocLoc: Location): PhpSymbol;
    propertyTagToSymbol(t: Tag, phpDocLoc: Location): PhpSymbol;
    magicPropertyModifier(t: Tag): SymbolModifier;
    interfaceDeclarationHeader(s: PhpSymbol, node: InterfaceDeclarationHeader): PhpSymbol;
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
    concatNamespaceName(prefix: string, name: string): string;
    namespaceUseClause(node: NamespaceUseClause, kind: SymbolKind, prefix: string): PhpSymbol;
    tokenToSymbolKind(t: Token): SymbolKind;
    namespaceUseDeclaration(node: NamespaceUseDeclaration): [SymbolKind, string];
    namespaceDefinition(node: NamespaceDefinition): PhpSymbol;
}
export declare namespace SymbolReader {
    function modifierListElementsToSymbolModifier(tokens: Token[]): SymbolModifier;
    function modifierTokenToSymbolModifier(t: Token): SymbolModifier;
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
    match(text: string, fuzzy?: boolean): PhpSymbol[];
    private _sortedFuzzyResults(query, matches);
    private _nodeMatch(lcText);
    private _nodeFind(text);
    private _insertNode(node);
    private _deleteNode(node);
    private _symbolKeys(s);
}
export interface LookupVariableTypeDelegate {
    (t: Token): TypeString;
}
export declare class ExpressionTypeResolver {
    nameResolver: NameResolver;
    symbolStore: SymbolStore;
    variableTable: VariableTable;
    constructor(nameResolver: NameResolver, symbolStore: SymbolStore, variableTable: VariableTable);
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
export declare class VariableTypeResolver implements TreeVisitor<Phrase | Token> {
    variableTable: VariableTable;
    document: ParsedDocument;
    nameResolver: NameResolver;
    symbolStore: SymbolStore;
    haltAtToken: Token;
    private _varName;
    haltTraverse: boolean;
    constructor(variableTable: VariableTable, document: ParsedDocument, nameResolver: NameResolver, symbolStore: SymbolStore, haltAtToken?: Token);
    preOrder(node: Phrase | Token, spine: (Phrase | Token)[]): boolean;
    postOrder(node: Phrase | Token, spine: (Phrase | Token)[]): void;
    private _checkForHaltToken(ancestor);
    private _qualifiedNameList(node);
    private _catchClause(node);
    private _listIntrinsic(node);
    private _token(t);
    private _parameterSymbolFilter(s);
    private _methodOrFunction(node, kind);
    private _findSymbolForPhrase(p);
    private _anonymousFunctionUseVariableSymbolFilter(s);
    private _anonymousFunctionCreationExpression(node);
    private _simpleVariable(node);
    private _instanceOfExpression(node);
    private _isNonDynamicSimpleVariable(node);
    private _assignmentExpression(node);
    private _foreachStatement(node);
}
export declare class VariableTable {
    private _typeVariableSetStack;
    constructor();
    setType(varName: string, type: TypeString): void;
    setTypeMany(varNames: string[], type: TypeString): void;
    pushScope(carry?: string[]): void;
    popScope(): void;
    pushBranch(): void;
    popBranch(): void;
    /**
     * consolidates variables.
     * each variable can be any of types discovered in branches after this.
     */
    pruneBranches(): void;
    getType(varName: string, thisName: string): TypeString;
    private _mergeSets(a, b);
    private _top();
}
