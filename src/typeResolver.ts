/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */

'use strict';

import { ParsedDocument } from './parsedDocument';
import { NameResolver } from './nameResolver';
import { SymbolStore } from './symbolStore';
import { TypeString } from './typeString';
import { TreeVisitor, MultiVisitor } from './types';
import { SymbolKind, PhpSymbol, SymbolModifier } from './symbol';
import { NameResolverVisitor } from './nameResolverVisitor';
import { PhpDocParser, PhpDoc, Tag, MethodTagParam } from './phpDoc';
import { Location, Range } from 'vscode-languageserver-types';
import {
    Phrase, PhraseType, Token, TokenType, NamespaceName, FunctionDeclarationHeader,
    ReturnType, TypeDeclaration, QualifiedName, ParameterDeclarationList,
    ParameterDeclaration, ConstElement, FunctionDeclaration, ClassDeclaration,
    ClassDeclarationHeader, ClassBaseClause, ClassInterfaceClause, QualifiedNameList,
    InterfaceDeclaration, InterfaceDeclarationHeader, InterfaceBaseClause,
    TraitDeclaration, TraitDeclarationHeader, ClassConstDeclaration, ClassConstElementList,
    ClassConstElement, Identifier, MethodDeclaration, MethodDeclarationHeader,
    PropertyDeclaration, PropertyElement, MemberModifierList, NamespaceDefinition,
    NamespaceUseDeclaration, NamespaceUseClause, NamespaceAliasingClause, AnonymousClassDeclaration,
    AnonymousClassDeclarationHeader, AnonymousFunctionCreationExpression, AnonymousFunctionUseVariable,
    TraitUseClause, SimpleVariable, ObjectCreationExpression, TypeDesignator, SubscriptExpression,
    FunctionCallExpression, FullyQualifiedName, RelativeQualifiedName, MethodCallExpression,
    MemberName, PropertyAccessExpression, ClassTypeDesignator, ScopedCallExpression,
    ScopedMemberName, ScopedPropertyAccessExpression, BinaryExpression, TernaryExpression,
    RelativeScope, ListIntrinsic, IfStatement, InstanceOfExpression, InstanceofTypeDesignator,
    ArrayInitialiserList, ArrayElement, ForeachStatement, CatchClause, ArgumentExpressionList,
    CoalesceExpression
} from 'php7parser';

export class ExpressionTypeResolver {

    constructor(
        public document: ParsedDocument,
        public nameResolver: NameResolver,
        public symbolStore: SymbolStore,
        public variableTable: VariableTable) {

    }

    resolveExpression(node: Phrase | Token): TypeString {

        if (!node) {
            return new TypeString('');
        }

        switch ((<Phrase>node).phraseType) {

            case PhraseType.SimpleVariable:
                return this.simpleVariable(<SimpleVariable>node);
            case PhraseType.SubscriptExpression:
                return this.subscriptExpression(<SubscriptExpression>node);
            case PhraseType.ScopedCallExpression:
                return this.scopedMemberAccessExpression(<ScopedCallExpression>node, SymbolKind.Method);
            case PhraseType.ScopedPropertyAccessExpression:
                return this.scopedMemberAccessExpression(<ScopedPropertyAccessExpression>node, SymbolKind.Property);
            case PhraseType.PropertyAccessExpression:
                return this.instanceMemberAccessExpression(<PropertyAccessExpression>node, SymbolKind.Property);
            case PhraseType.MethodCallExpression:
                return this.instanceMemberAccessExpression(<MethodCallExpression>node, SymbolKind.Method);
            case PhraseType.FunctionCallExpression:
                return this.functionCallExpression(<FunctionCallExpression>node);
            case PhraseType.TernaryExpression:
                return this.ternaryExpression(<TernaryExpression>node);
            case PhraseType.SimpleAssignmentExpression:
            case PhraseType.ByRefAssignmentExpression:
                return this.resolveExpression((<BinaryExpression>node).right);
            case PhraseType.ObjectCreationExpression:
                return this.objectCreationExpression(<ObjectCreationExpression>node);
            case PhraseType.ClassTypeDesignator:
            case PhraseType.InstanceofTypeDesignator:
                return this.classTypeDesignator(<any>node);
            case PhraseType.AnonymousClassDeclaration:
                return new TypeString(this.document.createAnonymousName(<AnonymousClassDeclaration>node));
            case PhraseType.QualifiedName:
            case PhraseType.FullyQualifiedName:
            case PhraseType.RelativeQualifiedName:
                return new TypeString(this._namePhraseToFqn(<any>node, SymbolKind.Class));
            case PhraseType.RelativeScope:
                return new TypeString(this.nameResolver.className);
            case PhraseType.CoalesceExpression:
                return new TypeString('')
                    .merge(this.resolveExpression((<BinaryExpression>node).left))
                    .merge(this.resolveExpression((<BinaryExpression>node).right));

            default:
                return new TypeString('');
        }

    }

    ternaryExpression(node: TernaryExpression) {

        return new TypeString('')
            .merge(this.resolveExpression(node.trueExpr))
            .merge(this.resolveExpression(node.falseExpr));

    }

    scopedMemberAccessExpression(node: ScopedPropertyAccessExpression | ScopedCallExpression, kind: SymbolKind) {

        let memberName = this.scopedMemberName(node.memberName);
        let scopeTypeString = this.resolveExpression(node.scope);

        if (!scopeTypeString || scopeTypeString.isEmpty() || !memberName) {
            return new TypeString('');
        }

        let typeNames = scopeTypeString.atomicClassArray();
        let symbols = this.lookupMemberOnTypes(typeNames, kind, memberName, SymbolModifier.Static, 0);
        return this.mergeTypes(symbols);

    }

    lookupMemberOnTypes(typeNames: string[], kind: SymbolKind, memberName: string, modifierMask: SymbolModifier, notModifierMask: SymbolModifier) {

        let symbols: PhpSymbol[] = [];
        let s: PhpSymbol;
        let visibilityNotModifierMask = 0;
        let typeName: string;

        for (let n = 0, l = typeNames.length; n < l; ++n) {

            typeName = typeNames[n];
            if (typeName === this.nameResolver.className) {
                visibilityNotModifierMask = 0;
            } else if (typeName === this.nameResolver.classBaseName) {
                visibilityNotModifierMask = SymbolModifier.Private;
            } else {
                visibilityNotModifierMask = SymbolModifier.Private | SymbolModifier.Protected;
            }

            let memberPredicate = (x: PhpSymbol) => {
                return x.kind === kind &&
                    (!modifierMask || (x.modifiers & modifierMask) > 0) &&
                    !(visibilityNotModifierMask & x.modifiers) &&
                    !(notModifierMask & x.modifiers) &&
                    x.name === memberName;
            }

            s = this.symbolStore.lookupTypeMember({ typeName: typeName, memberPredicate: memberPredicate });
            if (s) {
                symbols.push(s);
            }
        }

        return symbols;

    }

    scopedMemberName(node: ScopedMemberName) {

        if (node && ParsedDocument.isToken(node.name, [TokenType.VariableName])) {
            return this.document.tokenText(<Token>node.name);
        } else if (node && ParsedDocument.isPhrase(node.name, [PhraseType.Identifier])) {
            return this.document.tokenText((<Identifier>node.name).name);
        }

        return '';
    }

    classTypeDesignator(node: ClassTypeDesignator) {
        if (node && ParsedDocument.isPhrase(node.type,
            [PhraseType.QualifiedName, PhraseType.FullyQualifiedName, PhraseType.RelativeQualifiedName])) {
            return new TypeString(this._namePhraseToFqn(<any>node.type, SymbolKind.Class));
        } else if (node && ParsedDocument.isPhrase(node.type, [PhraseType.RelativeScope])) {
            return new TypeString(this.nameResolver.className);
        } else {
            return new TypeString('');
        }

    }

    objectCreationExpression(node: ObjectCreationExpression) {

        if (ParsedDocument.isPhrase(node.type, [PhraseType.AnonymousClassDeclaration])) {
            return new TypeString(this.document.createAnonymousName(node));
        } else if (ParsedDocument.isPhrase(node.type, [PhraseType.ClassTypeDesignator])) {
            return this.classTypeDesignator(<ClassTypeDesignator>node.type);
        } else {
            return new TypeString('');
        }

    }

    simpleVariable(node: SimpleVariable) {
        if (ParsedDocument.isToken(node.name, [TokenType.VariableName])) {
            return this.variableTable.getType(this.document.tokenText(<Token>node.name), this.nameResolver.className);
        }

        return new TypeString('');
    }

    subscriptExpression(node: SubscriptExpression) {
        let type = this.resolveExpression(node.dereferencable);
        return type ? type.arrayDereference() : new TypeString('');
    }

    functionCallExpression(node: FunctionCallExpression) {

        let qName = <Phrase>node.callableExpr;
        if (!ParsedDocument.isPhrase(qName,
            [PhraseType.FullyQualifiedName, PhraseType.QualifiedName, PhraseType.RelativeQualifiedName])) {
            return new TypeString('');
        }

        let functionName = this._namePhraseToFqn(<any>qName, SymbolKind.Function)
        let symbol = this.symbolStore.find(functionName, (x) => { return x.kind === SymbolKind.Function });
        return symbol && symbol.type ? symbol.type : new TypeString('');

    }

    memberName(node: MemberName) {
        return node ? this.document.tokenText((<Token>node.name)) : '';
    }

    instanceMemberAccessExpression(node: PropertyAccessExpression, kind: SymbolKind) {

        let memberName = ParsedDocument.isToken(node.memberName) ?
            this.document.tokenText(<Token>node.memberName) :
            this.memberName(<MemberName>node.memberName);

        let type = this.resolveExpression(node.variable);

        if (!memberName || !type) {
            return new TypeString('');
        }

        if (kind === SymbolKind.Property) {
            memberName = '$' + memberName;
        }

        let symbols = this.lookupMemberOnTypes(type.atomicClassArray(), kind, memberName, 0, SymbolModifier.Static);
        return this.mergeTypes(symbols);

    }

    mergeTypes(symbols: PhpSymbol[]) {

        let type = new TypeString('');
        let symbol: PhpSymbol;

        for (let n = 0, l = symbols.length; n < l; ++n) {
            type = type.merge(symbols[n].type);
        }

        return type;
    }

    protected _namePhraseToFqn(node: Phrase, kind: SymbolKind) {
        if (!node) {
            return '';
        }

        switch (node.phraseType) {
            case PhraseType.QualifiedName:
                return this.nameResolver.resolveNotFullyQualified(this.document.namespaceNamePhraseToString((<QualifiedName>node).name), kind);
            case PhraseType.RelativeQualifiedName:
                return this.nameResolver.resolveRelative(this.document.namespaceNamePhraseToString((<RelativeQualifiedName>node).name));
            case PhraseType.FullyQualifiedName:
                return this.document.namespaceNamePhraseToString((<FullyQualifiedName>node).name);
            case PhraseType.NamespaceName:
                return this.document.namespaceNamePhraseToString(<NamespaceName>node);
            default:
                return '';
        }
    }

}

export class VariableTypeResolver extends MultiVisitor<Phrase | Token> {

    private _nameResolverVisitor:NameResolverVisitor;
    private _variableTypeVisitor:VariableTypeVisitor;

    constructor(
        nameResolverVisitor: NameResolverVisitor,
        variableTypeVisitor: VariableTypeVisitor
    ) {
        super([nameResolverVisitor, variableTypeVisitor]);
        this._nameResolverVisitor = nameResolverVisitor;
        this._variableTypeVisitor = variableTypeVisitor;
    }

    set haltAtOffset(offset:number){
        this._variableTypeVisitor.haltAtOffset = offset;
    }

    get variableTable(){
        return this._variableTypeVisitor.variableTable;
    }

    static create(document: ParsedDocument, nameResolver: NameResolver, symbolStore: SymbolStore, variableTable: VariableTable) {
        return new VariableTypeResolver(
            new NameResolverVisitor(document, nameResolver),
            new VariableTypeVisitor(document, nameResolver, symbolStore, variableTable)
        );
    }

}

export class VariableTypeVisitor implements TreeVisitor<Phrase | Token> {

    haltTraverse = false;
    haltAtOffset = -1;

    constructor(
        public document: ParsedDocument,
        public nameResolver: NameResolver,
        public symbolStore: SymbolStore,
        public variableTable: VariableTable) {
    }

    preorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        switch ((<Phrase>node).phraseType) {
            case PhraseType.FunctionDeclaration:
                this._methodOrFunction(node, SymbolKind.Function);
                return true;
            case PhraseType.MethodDeclaration:
                this._methodOrFunction(node, SymbolKind.Method);
                return true;
            case PhraseType.ClassDeclaration:
            case PhraseType.TraitDeclaration:
            case PhraseType.InterfaceDeclaration:
            case PhraseType.AnonymousClassDeclaration:
                this.variableTable.pushScope();
                return true;
            case PhraseType.AnonymousFunctionCreationExpression:
                this._anonymousFunctionCreationExpression(node);
                return true;
            case PhraseType.IfStatement:
            case PhraseType.CaseStatement:
            case PhraseType.DefaultStatement:
            case PhraseType.ElseIfClause:
                this.variableTable.pushBranch();
                return true;
            case PhraseType.ElseClause:
                let elseClauseParent = spine[spine.length - 1];
                if (!(<IfStatement>elseClauseParent).elseIfClauseList) {
                    this.variableTable.popBranch();
                }
                this.variableTable.pushBranch();
                return true;
            case PhraseType.ElseIfClauseList:
                this.variableTable.popBranch(); //pop the if branch
                return true;
            case PhraseType.SimpleAssignmentExpression:
            case PhraseType.ByRefAssignmentExpression:
                if (ParsedDocument.isPhrase((<BinaryExpression>node).left, [PhraseType.SimpleVariable, PhraseType.ListIntrinsic])) {
                    this._assignmentExpression(<BinaryExpression>node);
                    if (this.haltAtOffset > -1 && ParsedDocument.isOffsetInNode(this.haltAtOffset, node)) {
                        this.haltTraverse = true;
                    }
                    return false;
                }
                return true;
            case PhraseType.InstanceOfExpression:
                this._instanceOfExpression(<InstanceOfExpression>node);
                if (this.haltAtOffset > -1 && ParsedDocument.isOffsetInNode(this.haltAtOffset, node)) {
                    this.haltTraverse = true;
                }
                return false;
            case PhraseType.ForeachStatement:
                this._foreachStatement(<ForeachStatement>node);
                return true;
            case PhraseType.CatchClause:
                this._catchClause(<CatchClause>node);
                return true;
            case undefined:
                this._token(<Token>node);
                return false;
            default:
                return true;
        }

    }

    postorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        switch ((<Phrase>node).phraseType) {
            case PhraseType.IfStatement:
                if (!(<IfStatement>node).elseClause && !(<IfStatement>node).elseIfClauseList) {
                    this.variableTable.popBranch();
                }
                this.variableTable.pruneBranches();
                break;
            case PhraseType.SwitchStatement:
                this.variableTable.pruneBranches();
                break;
            case PhraseType.CaseStatement:
            case PhraseType.DefaultStatement:
            case PhraseType.ElseClause:
            case PhraseType.ElseIfClause:
                this.variableTable.popBranch();
                break;
            case PhraseType.FunctionDeclaration:
            case PhraseType.MethodDeclaration:
            case PhraseType.ClassDeclaration:
            case PhraseType.TraitDeclaration:
            case PhraseType.InterfaceDeclaration:
            case PhraseType.AnonymousClassDeclaration:
            case PhraseType.AnonymousFunctionCreationExpression:
                this.variableTable.popScope();
                break;
            default:
                break;
        }

    }


    private _qualifiedNameList(node: QualifiedNameList) {

        let fqns: string[] = [];

        for (let n = 0, l = node.elements.length; n < l; ++n) {
            fqns.push(this._namePhraseToFqn(node.elements[n], SymbolKind.Class));
        }

        return new TypeString(fqns.join('|'));
    }

    private _namePhraseToFqn(node: Phrase, kind: SymbolKind) {
        if (!node) {
            return '';
        }

        let text = this.document.nodeText((<QualifiedName>node).name, [TokenType.Comment, TokenType.Whitespace]);

        switch (node.phraseType) {
            case PhraseType.QualifiedName:
                return this.nameResolver.resolveNotFullyQualified(text, kind);
            case PhraseType.RelativeQualifiedName:
                return this.nameResolver.resolveRelative(text);
            case PhraseType.FullyQualifiedName:
                return text;
            default:
                return '';
        }
    }

    private _catchClause(node: CatchClause) {
        this.variableTable.setType(this.document.tokenText(node.variable), this._qualifiedNameList(node.nameList));
    }

    private _listIntrinsic(node: ListIntrinsic) {

        let elements = node.initialiserList.elements;
        let element: ArrayElement;
        let varNames: string[] = [];
        let varName: string;

        for (let n = 0, l = elements.length; n < l; ++n) {
            element = elements[n];
            varName = this._simpleVariable(<SimpleVariable>element.value.expr);
            if (varName) {
                varNames.push(varName);
            }
        }

        return varNames;

    }

    private _token(t: Token) {

        //doc block type hints
        if (t.tokenType === TokenType.DocumentComment) {
            let phpDoc = PhpDocParser.parse(this.document.tokenText(t));
            if (phpDoc) {
                let varTags = phpDoc.varTags;
                let varTag: Tag;
                for (let n = 0, l = varTags.length; n < l; ++n) {
                    varTag = varTags[n];
                    this.variableTable.setType(varTag.name, new TypeString(varTag.typeString).nameResolve(this.nameResolver));
                }
            }
        }

        if(this.haltAtOffset > -1 && ParsedDocument.isOffsetInToken(this.haltAtOffset, t)){
            this.haltTraverse = true;
        }

    }

    private _parameterSymbolFilter(s: PhpSymbol) {
        return s.kind === SymbolKind.Parameter;
    }

    private _methodOrFunction(node: Phrase | Token, kind: SymbolKind) {

        this.variableTable.pushScope();
        let symbol = this._findSymbolForPhrase(<Phrase>node);

        if (symbol) {
            let params = symbol.children.filter(this._parameterSymbolFilter);
            let param: PhpSymbol;
            for (let n = 0, l = params.length; n < l; ++n) {
                param = params[n];
                this.variableTable.setType(param.name, param.type);
            }
        }

    }

    private _findSymbolForPhrase(p: Phrase) {

        let symbolTable = this.symbolStore.getSymbolTable(this.document.uri);
        let range = this.document.nodeRange(p);
        let predicate = (x: PhpSymbol) => {
            return x.location &&
                x.location.range.start.line === range.start.line &&
                x.location.range.start.character === range.start.character;
        };
        return symbolTable.find(predicate);

    }

    private _anonymousFunctionUseVariableSymbolFilter(s: PhpSymbol) {
        return s.kind === SymbolKind.Variable && (s.modifiers & SymbolModifier.Use) > 0;
    }

    private _anonymousFunctionCreationExpression(node: Phrase | Token) {

        let symbol = this._findSymbolForPhrase(<Phrase>node);

        let carry: string[] = [];
        if (symbol && symbol.children) {

            let useVariables = symbol.children.filter(this._anonymousFunctionUseVariableSymbolFilter);

            for (let n = 0, l = useVariables.length; n < l; ++n) {
                carry.push(useVariables[n].name);
            }

        }

        this.variableTable.pushScope(carry);
    }

    private _simpleVariable(node: SimpleVariable) {
        return this._isNonDynamicSimpleVariable(node) ? this.document.tokenText(<Token>node.name) : '';
    }

    private _instanceOfExpression(node: InstanceOfExpression) {

        let lhs = node.left as SimpleVariable;
        let rhs = node.right as InstanceofTypeDesignator;
        let varName = this._simpleVariable(lhs);
        let exprTypeResolver = new ExpressionTypeResolver(this.document, this.nameResolver, this.symbolStore, this.variableTable);
        this.variableTable.setType(varName, exprTypeResolver.resolveExpression(rhs));

    }

    private _isNonDynamicSimpleVariable(node: Phrase | Token) {
        return ParsedDocument.isPhrase(node, [PhraseType.SimpleVariable]) &&
            ParsedDocument.isToken((<SimpleVariable>node).name, [TokenType.VariableName]);
    }

    private _assignmentExpression(node: BinaryExpression) {

        let lhs = node.left;
        let rhs = node.right;
        let exprTypeResolver = new ExpressionTypeResolver(this.document, this.nameResolver, this.symbolStore, this.variableTable);
        let type: TypeString;

        if (ParsedDocument.isPhrase(lhs, [PhraseType.SimpleVariable])) {
            let varName = this._simpleVariable(<SimpleVariable>lhs);
            type = exprTypeResolver.resolveExpression(rhs);
            this.variableTable.setType(varName, type);
        } else if (ParsedDocument.isPhrase(node, [PhraseType.ListIntrinsic])) {
            let varNames = this._listIntrinsic(<ListIntrinsic>rhs);
            this.variableTable.setTypeMany(varNames, exprTypeResolver.resolveExpression(rhs).arrayDereference());
        }

    }

    private _foreachStatement(node: ForeachStatement) {

        let collection = node.collection;
        let value = node.value;

        let exprResolver = new ExpressionTypeResolver(this.document, this.nameResolver, this.symbolStore, this.variableTable);
        let type = exprResolver.resolveExpression(collection.expr).arrayDereference();

        if (ParsedDocument.isPhrase(value.expr, [PhraseType.SimpleVariable])) {
            let varName = this._simpleVariable(<SimpleVariable>value.expr);
            this.variableTable.setType(varName, type);
        } else if (ParsedDocument.isPhrase(value.expr, [PhraseType.ListIntrinsic])) {
            let varNames = this._listIntrinsic(<ListIntrinsic>value.expr);
            this.variableTable.setTypeMany(varNames, type.arrayDereference());
        }

    }

}

interface TypedVariable {
    name: string;
    type: TypeString;
}

const enum TypedVariableSetKind {
    None, Scope, BranchGroup, Branch
}

interface TypedVariableSet {
    kind: TypedVariableSetKind;
    variables: { [index: string]: TypedVariable };
    branches: TypedVariableSet[];
}

export class VariableTable {

    private _typeVariableSetStack: TypedVariableSet[];

    constructor() {

        this._typeVariableSetStack = [{
            kind: TypedVariableSetKind.Scope,
            variables: {},
            branches: []
        }];
    }

    setType(varName: string, type: TypeString) {
        if (!varName || !type || type.isEmpty()) {
            return;
        }
        this._top().variables[varName] = { name: varName, type: type };
    }

    setTypeMany(varNames: string[], type: TypeString) {
        for (let n = 0, l = varNames.length; n < l; ++n) {
            this.setType(varNames[n], type);
        }
    }

    pushScope(carry?: string[]) {

        let scope = <TypedVariableSet>{
            kind: TypedVariableSetKind.Scope,
            variables: {},
            branches: []
        }

        if (carry) {
            let type: TypeString;
            for (let n = 0; n < carry.length; ++n) {
                type = this.getType(carry[n]);
                if (type) {
                    scope.variables[carry[n]] = { name: carry[n], type: type };
                }
            }
        }

        this._typeVariableSetStack.push(scope);

    }

    popScope() {
        this._typeVariableSetStack.pop();
    }

    pushBranch() {
        let b = <TypedVariableSet>{
            kind: TypedVariableSetKind.Branch,
            variables: {},
            branches: []
        };
        this._top().branches.push(b);
        this._typeVariableSetStack.push(b);
    }

    popBranch() {
        this._typeVariableSetStack.pop();
    }

    /**
     * consolidates variables. 
     * each variable can be any of types discovered in branches after this.
     */
    pruneBranches() {

        let node = this._top();
        let branches = node.branches;
        node.branches = [];
        for (let n = 0, l = branches.length; n < l; ++n) {
            this._mergeSets(node, branches[n]);
        }

    }

    getType(varName: string, className?: string) {

        if (varName === '$this' && className) {
            return new TypeString(className);
        }

        let typeSet: TypedVariableSet;

        for (let n = this._typeVariableSetStack.length - 1; n >= 0; --n) {
            typeSet = this._typeVariableSetStack[n];
            if (typeSet.variables[varName]) {
                return typeSet.variables[varName].type;
            }

            if (typeSet.kind === TypedVariableSetKind.Scope) {
                break;
            }
        }

        return new TypeString('');

    }

    private _mergeSets(a: TypedVariableSet, b: TypedVariableSet) {

        let keys = Object.keys(b.variables);
        let typedVar: TypedVariable;
        for (let n = 0, l = keys.length; n < l; ++n) {
            typedVar = b.variables[keys[n]];
            if (a.variables[typedVar.name]) {
                a.variables[typedVar.name].type = a.variables[typedVar.name].type.merge(typedVar.type);
            } else {
                a.variables[typedVar.name] = typedVar;
            }
        }

    }

    private _top() {
        return this._typeVariableSetStack[this._typeVariableSetStack.length - 1];
    }

}