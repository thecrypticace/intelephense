import { ParsedDocument } from './parsedDocument';
import { NameResolver } from './nameResolver';
import { SymbolStore } from './symbolStore';
import { TypeString } from './typeString';
import { SymbolKind, PhpSymbol, SymbolModifier } from './symbol';
import { ParsedDocumentVisitor } from './parsedDocumentVisitor';
import { Phrase, Token, SimpleVariable, ObjectCreationExpression, SubscriptExpression, FunctionCallExpression, MemberName, PropertyAccessExpression, ClassTypeDesignator, ScopedCallExpression, ScopedMemberName, ScopedPropertyAccessExpression, TernaryExpression } from 'php7parser';
export declare class ExpressionTypeResolver {
    document: ParsedDocument;
    nameResolver: NameResolver;
    symbolStore: SymbolStore;
    variableTable: VariableTable;
    constructor(document: ParsedDocument, nameResolver: NameResolver, symbolStore: SymbolStore, variableTable: VariableTable);
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
    protected _namePhraseToFqn(node: Phrase, kind: SymbolKind): string;
}
export declare class VariableTypeResolver extends ParsedDocumentVisitor {
    document: ParsedDocument;
    nameResolver: NameResolver;
    symbolStore: SymbolStore;
    variableTable: VariableTable;
    constructor(document: ParsedDocument, nameResolver: NameResolver, symbolStore: SymbolStore, variableTable: VariableTable);
    protected _preorder(node: Phrase | Token, spine: (Phrase | Token)[]): boolean;
    protected _postorder(node: Phrase | Token, spine: (Phrase | Token)[]): void;
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
    getType(varName: string, className?: string): TypeString;
    private _mergeSets(a, b);
    private _top();
}
