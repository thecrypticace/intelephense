/* Copyright © Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import { Position, Range, Predicate, Tree, TreeVisitor, Event, BinarySearch, SuffixArray } from './types';
import { Phrase, PhraseType, PhraseFlag, Token, TokenType } from 'php7parser';
import { PhpDocParser, PhpDoc, Tag, MethodTagParam, TypeTag, MethodTag, ParsedDocument } from './parse';
import * as util from './util';
import {
    PhpSymbol, NameResolver, ImportRule, ImportTable, SymbolKind, TypeString,
    SymbolModifier, SymbolTree, VariableTable, SymbolStore, SymbolTable
} from './symbol';


function nameNodeToFqnString(nameNode: Phrase, nameResolver: NameResolver, kind: SymbolKind) {

    if (!nameNode || !nameNode.children) {
        return '';
    }

    let namespaceName = namespaceNameNodeToString(nameNode.children[0]);

    switch ((<Phrase>nameNode.value).flag) {
        case PhraseFlag.NameRelative:
            return nameResolver.resolveRelative(namespaceName);
        case PhraseFlag.NameNotFullyQualified:
            return nameResolver.resolveNotFullyQualified(namespaceName, kind);
        default:
            //fqn
            return namespaceName;
    }
}

function variableNodeToString(variableNode: Tree<Phrase | Token>) {
    let child = variableNode.children[0] as Tree<Token>;

    if (!child.value || child.value.tokenType !== TokenType.T_VARIABLE) {
        return '';
    }

    return child.value.text;
}

function namespaceNodeToString(namespaceNode: Tree<Phrase | Token>) {
    return namespaceNameNodeToString(namespaceNode.children[0]);
}

/**
 * Uses node position to provide a "unique" name
 * Possible but unlikely that two closures or anon classes
 * occupy exactly same position in separate files
 */
function anonymousName(anonNode: Tree<Phrase | Token>) {
    let start: Position, end: Position;
    let type = (<Phrase>anonNode.value).phraseType;
    let suffix = [start.line, start.character, end.line, end.character].join('.');

    if (type === PhraseType.AnonymousClassDeclaration) {
        return '.anonymous.class.' + suffix;
    } else if (type === PhraseType.Closure) {
        return '.closure.' + suffix;
    } else {
        throw new Error('Invalid Argument');
    }

}

function isAnonymousName(name: string) {
    return name.indexOf('.anonymous.class.') !== -1
}

function tokenNodeToString(node: Tree<Phrase | Token>) {
    return (<Token>node.value).tokenType && node.value ? (<Token>node.value).text : '';
}



export class SymbolAtLineSearch implements TreeVisitor<PhpSymbol> {

    private _node: Tree<PhpSymbol>;
    private _line: number;
    private _kindMask: SymbolKind;

    constructor(line: number, kindMask: SymbolKind) {
        this._line = line;
        this._kindMask = kindMask;
    }

    get node() {
        return this._node;
    }

    preOrder(node: Tree<PhpSymbol>) {

        if (node.value !== null &&
            node.value.start >= this._line &&
            node.value.end <= this._line &&
            (!this._kindMask || (node.value.kind & this._kindMask) > 0)) {
            this._node = node;
            return TreeVisitorResult.None;
        }
        return TreeVisitorResult.DoNotDescend;

    }

}

export class AstContextVisitor implements TreeVisitor<Phrase | Token>{

    private _position: Position;
    private _token: Tree<Phrase | Token>;
    private _phrase: Tree<Phrase | Token>;
    private _scope: Tree<Phrase | Token>;
    private _concreteScope: Tree<Phrase | Token>;
    private _thisPhrase: Tree<Phrase | Token>;
    private _namespace: Tree<Phrase | Token>;

    haltTraverse: boolean;

    constructor(position: Position) {
        this._position = position;
        this.haltTraverse = false;
    }

    get token() {
        return this._token;
    }

    get phraseNode() {
        return this._phrase;
    }

    get scopeNode() {
        return this._scope;
    }

    get concreteScopeNode() {
        return this._concreteScope;
    }

    get thisNode() {
        return this._thisPhrase;
    }

    get namespaceNode() {
        return this._namespace;
    }

    preOrder(node: Tree<Phrase | Token>) {

        if (!node.value || this.haltTraverse) {
            return false;
        }

        let start: Position, end: Position;
        if (node.value.hasOwnProperty('phraseType')) {
            start = (<Phrase>node.value).startToken.range.start;
            end = (<Phrase>node.value).endToken.range.end;
        } else {
            //Token
            start = (<Token>node.value).range.start;
            end = (<Token>node.value).range.end;
        }

        if ((<Phrase>node.value).phraseType === PhraseType.Namespace) {
            this._namespace = node;
        }

        if (util.isInRange(this._position, start, end) === 0) {

            switch ((<Phrase>node.value).phraseType) {
                case PhraseType.TopStatementList:
                    this._phrase = this._scope = this._concreteScope = node;
                    break;
                case PhraseType.InterfaceDeclaration:
                case PhraseType.TraitDeclaration:
                case PhraseType.ClassDeclaration:
                case PhraseType.AnonymousClassDeclaration:
                    this._phrase = this._scope = this._thisPhrase = this._concreteScope = node;
                    break;
                case PhraseType.FunctionDeclaration:
                case PhraseType.MethodDeclaration:
                    this._phrase = this._scope = this._concreteScope = node;
                    break;
                case PhraseType.Closure:
                    this._phrase = this._scope = node;
                    break;
                case undefined:
                    this._token = node;
                    this.haltTraverse = true;
                    return false;
                default:
                    this._phrase = node;
                    break;
            }

            return true;
        }

        return false;

    }

}

/**
 * Resolves variable type
 */
export class VariableTypeResolver implements TreeVisitor<Phrase | Token>{

    private _haltAtNode: Tree<Phrase | Token>;
    private _exprResolver: ExpressionTypeResolver;
    private _varName: string;

    haltTraverse: boolean;

    constructor(public variableTable: VariableTable,
        public nameResolver: NameResolver,
        public symbolStore: SymbolStore,
        exprResolver: ExpressionTypeResolver,
        haltAtNode: Tree<Phrase | Token> = null,
        varName: string = null) {
        this._exprResolver = exprResolver;
        this._haltAtNode = haltAtNode;
        this.haltTraverse = false;
        this._varName = varName;
    }

    preOrder(node: Tree<Phrase | Token>) {

        if (this._haltAtNode === node) {
            this.haltTraverse = true;
            return false;
        }

        if (!node.value) {
            return false;
        }

        switch ((<Phrase>node.value).phraseType) {
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
            case PhraseType.Closure:
                this._closure(node);
                return true;
            case PhraseType.IfList:
            case PhraseType.Switch:
                this.variableTable.pushBranchGroup();
                return true;
            case PhraseType.If:
            case PhraseType.Case:
                this.variableTable.pushBranch();
                return true;
            case PhraseType.BinaryExpression:
                if ((<Phrase>node.value).flag === PhraseFlag.BinaryAssign ||
                    (<Phrase>node.value).flag === PhraseFlag.BinaryInstanceOf) {
                    this._binaryExpression(node);
                }
                return true;
            case PhraseType.Foreach:
                this._foreach(node);
                return true;
            default:
                return true;
        }

    }

    postOrder(node: Tree<Phrase | Token>) {

        if (!node.value) {
            return;
        }

        switch ((<Phrase>node.value).phraseType) {
            case PhraseType.IfList:
            case PhraseType.Switch:
                this.variableTable.popBranchGroup();
                break;
            case PhraseType.If:
            case PhraseType.Case:
                this.variableTable.popBranch();
                break;
            case PhraseType.FunctionDeclaration:
            case PhraseType.MethodDeclaration:
            case PhraseType.ClassDeclaration:
            case PhraseType.TraitDeclaration:
            case PhraseType.InterfaceDeclaration:
            case PhraseType.AnonymousClassDeclaration:
            case PhraseType.Closure:
                this.variableTable.popScope();
                break;
            default:
                break;
        }

    }

    private _methodOrFunction(node: Tree<Phrase | Token>, kind: SymbolKind) {

        this.variableTable.pushScope();
        let name = tokenNodeToString(node.children[0]);

        if (!name) {
            return;
        }

        let symbol: Tree<PhpSymbol>;

        if (kind === SymbolKind.Function) {
            name = this.nameResolver.resolveRelative(name);
            symbol = this.symbolStore.match(name, SymbolKind.Function).shift();
        } else {
            symbol = this.symbolStore.lookupTypeMember(this.nameResolver.thisName, SymbolKind.Method, name);
        }

        if (symbol) {
            this._variableTableSetParams(SymbolTree.parameters(symbol));
        }

    }

    private _closure(node: Tree<Phrase | Token>) {

        let name = anonymousName(node);
        let symbol = this.symbolStore.match(name, SymbolKind.Function).shift();

        if (symbol) {
            let useVarNames = SymbolTree.closureUseVariables(symbol).map((v, i, a) => {
                return v.value.name;
            });

            this.variableTable.pushScope(useVarNames);
            this._variableTableSetParams(SymbolTree.parameters(symbol));
        }

    }

    private _variableTableSetParams(parameters: Tree<PhpSymbol>[]) {
        for (let n = 0; n < parameters.length; ++n) {
            if (parameters[n].value.type) {
                this.variableTable.setType(parameters[n].value.name, parameters[n].value.type);
            }
        }
    }

    private _binaryExpression(node: Tree<Phrase | Token>) {

        let lhs = node.children[0];
        let rhs = node.children[1];

        //if only resolving single variable then check it's in this expr
        if (this._varName && !this._varExists(lhs, this._varName)) {
            return;
        }

        if (!lhs.value ||
            ((<Phrase>lhs.value).phraseType !== PhraseType.Variable &&
                (<Phrase>lhs.value).phraseType !== PhraseType.Array &&
                (<Phrase>lhs.value).phraseType !== PhraseType.Dimension) ||
            !rhs.value) {
            return;
        }

        this._exprResolver.clear();
        rhs.traverse(this._exprResolver);
        if (!this._exprResolver.type || this._exprResolver.type.isEmpty()) {
            return;
        }

        this._assignType(lhs, this._exprResolver.type);

    }

    private _foreach(node: Tree<Phrase | Token>) {

        let expr1 = node.children[0];
        let expr3 = node.children[2];

        //if only resolving single variable then check it's in this expr
        if (this._varName && !this._varExists(expr3, this._varName)) {
            return;
        }

        if (!expr3.value ||
            ((<Phrase>expr3.value).phraseType !== PhraseType.Variable &&
                (<Phrase>expr3.value).phraseType !== PhraseType.Array &&
                (<Phrase>expr3.value).phraseType !== PhraseType.Dimension) ||
            !expr1.value) {
            return;
        }

        this._exprResolver.clear();
        expr1.traverse(this._exprResolver);
        if (!this._exprResolver.type || this._exprResolver.type.isEmpty()) {
            return;
        }

        this._assignType(expr3, this._exprResolver.type);

    }

    private _varExists(node: Tree<Phrase | Token>, varName: string) {

        return !!node.find((x) => {
            return x.value && (<Token>x.value).text === varName;
        });
    }

    private _assignType(node: Tree<Phrase | Token>, typeString: TypeString) {

        if (!node.value) {
            return;
        }

        switch ((<Phrase>node.value).phraseType) {
            case PhraseType.Array:
                this._array(node, typeString);
            case PhraseType.ArrayPair:
                this._arrayPair(node.children[1], typeString);
                break;
            case PhraseType.Dimension:
                this._dimension(node, typeString);
                break;
            case PhraseType.Variable:
                this._variable(node, typeString);
                break;
            default:
                break;
        }

    }

    private _dimension(node: Tree<Phrase | Token>, typeString: TypeString) {
        this._assignType(node.children[0], typeString.array());
    }

    private _array(node: Tree<Phrase | Token>, typeString: TypeString) {
        let type = typeString.arrayDereference();

        if (!node.children) {
            return;
        }

        for (let n = 0; n < node.children.length; ++n) {
            this._arrayPair(node.children[n], type);
        }
    }

    private _arrayPair(node: Tree<Phrase | Token>, typeString: TypeString) {
        this._assignType(node.children[1], typeString);
    }

    private _variable(node: Tree<Phrase | Token>, typeString: TypeString) {

        if (node.children && node.children.length &&
            (<Token>node.children[0].value).tokenType === TokenType.T_VARIABLE &&
            typeString &&
            !typeString.isEmpty()) {
            this.variableTable.setType((<Token>node.children[0].value).text, typeString);
        }

    }

}

export interface LookupVariableTypeDelegate {
    (node: Tree<Phrase | Token>): TypeString;
}

export class ExpressionTypeResolver implements TreeVisitor<Phrase | Token>{

    private _skipStack: Tree<Phrase | Token>[];
    private _type: TypeString;
    private _lookupVariableTypeDelegate: LookupVariableTypeDelegate;

    constructor(public nameResolver: NameResolver,
        public symbolStore: SymbolStore,
        lookupVariableTypeDelegate: LookupVariableTypeDelegate) {
        this._skipStack = [];
        this._lookupVariableTypeDelegate = lookupVariableTypeDelegate;
    }

    get type() {
        return this._type;
    }

    clear() {
        this._type = null;
        this._skipStack = [];
    }

    preOrder(node: Tree<Phrase | Token>) {

        if (!node.value || util.top<Tree<Phrase | Token>>(this._skipStack) === node) {
            return false;
        }

        switch ((<Phrase>node.value).phraseType) {

            case PhraseType.Variable:
                return false;
            case PhraseType.Dimension:
                //skip dimension offset
                this._skipStack.push(node.children[1]);
                return true;
            case PhraseType.StaticProperty:
            case PhraseType.Property:
                //skip property name
                this._skipStack.push(node.children[1]);
                return true;
            case PhraseType.StaticMethodCall:
            case PhraseType.MethodCall:
                //skip method name and args
                this._skipStack.push(node.children[1], node.children[2]);
                return true;
            case PhraseType.Call:
            case PhraseType.Name:
                return false;
            case PhraseType.BinaryExpression:
                if ((<Phrase>node.value).flag === PhraseFlag.BinaryAssign) {
                    //skip lhs
                    this._skipStack.push(node.children[0]);
                }
                return true;
            case PhraseType.TernaryExpression:
                if (!node.children[1].value) {
                    this._skipStack.push(node.children[1]);
                } else {
                    this._skipStack.push(node.children[0]);
                }

            default:
                return true;
        }

    }

    postOrder(node: Tree<Phrase | Token>) {

        if (util.top<Tree<Phrase | Token>>(this._skipStack) === node) {
            this._skipStack.pop();
            return;
        }

        if (!node.value) {
            this._type = null;
            return;
        }

        switch ((<Phrase>node.value).phraseType) {

            case PhraseType.Variable:
                return this._variable(node);
            case PhraseType.Dimension:
                return this._dimension(node);
            case PhraseType.StaticProperty:
            case PhraseType.Property:
                return this._property(node);
            case PhraseType.StaticMethodCall:
            case PhraseType.MethodCall:
                return this._methodCall(node);
            case PhraseType.Call:
                return this._call(node);
            case PhraseType.Name:
                return this._name(node);
            default:
                break;
        }

    }

    private _dimension(node: Tree<Phrase | Token>) {

        if (this._type) {
            this._type = this._type.arrayDereference();
        }

    }

    private _call(node: Tree<Phrase | Token>) {

        let nameNode = node.children[0];
        let name: string

        if (!nameNode.value || (<Phrase>nameNode.value).phraseType !== PhraseType.Name ||
            !(name = nameNodeToFqnString(nameNode, this.nameResolver, SymbolKind.Function))) {
            this._type = null;
            return;
        }

        let functionSymbol = this.symbolStore.match(name, SymbolKind.Function).shift();
        if (functionSymbol && functionSymbol.value.type && !functionSymbol.value.type.isEmpty()) {
            this._type = functionSymbol.value.type;
        } else {
            this._type = null;
        }

    }

    private _methodCall(node: Tree<Phrase | Token>) {

        let methodNameToken = node.children[1].value as Token;
        if (!methodNameToken || !this._type) {
            this._type = null;
            return;
        }

        let methodSymbols = this._lookupMemberSymbols(
            this._type.atomicClassArray(),
            methodNameToken.text,
            SymbolKind.Method
        );

        this._type = this._mergeTypes(methodSymbols);

    }

    private _property(node: Tree<Phrase | Token>) {

        let propName = variableNodeToString(node.children[1]);
        if (!propName || !this._type) {
            return null;
        }

        let propSymbols = this._lookupMemberSymbols(
            this._type.atomicClassArray(),
            propName,
            SymbolKind.Property
        );

        this._type = this._mergeTypes(propSymbols);

    }

    private _variable(node: Tree<Phrase | Token>) {

        let child = node.children[0] as Tree<Token>;

        if (!child.value || child.value.tokenType !== TokenType.T_VARIABLE) {
            this._type = null;
        }

        this._type = this._lookupVariableTypeDelegate(node);

    }

    private _name(node: Tree<Phrase | Token>) {
        let name = nameNodeToFqnString(node, this.nameResolver, SymbolKind.Class);
        if (name) {
            this._type = new TypeString(name);
        } else {
            this._type = null;
        }
    }

    private _lookupMemberSymbols(typeNames: string[], memberName: string, kind: SymbolKind) {

        let member: Tree<PhpSymbol>;
        let members: Tree<PhpSymbol>[] = [];

        for (let n = 0; n < typeNames.length; ++n) {

            member = this.symbolStore.lookupTypeMember(typeNames[n], kind, memberName);
            if (member) {
                members.push(member);
            }

        }

        return members;

    }

    private _mergeTypes(symbols: Tree<PhpSymbol>[]) {

        let type: TypeString = null;
        let symbol: PhpSymbol;

        for (let n = 0; n < symbols.length; ++n) {
            symbol = symbols[n].value;
            if (symbol.type) {
                type = type ? type.merge(symbol.type) : symbol.type;
            }
        }

        return type;
    }

}

export class DocumentContext {

    private _tokenIndex: number;
    private _token: Token;
    private _phraseNode: Tree<Phrase | Token>;
    private _scopeNode: Tree<Phrase | Token>;
    private _concreteScopeNode: Tree<Phrase | Token>;
    private _thisNode: Tree<Phrase | Token>;
    private _namespaceNode: Tree<Phrase | Token>;

    constructor(public position: Position,
        public parsedDoc: ParsedDocument,
        public symbolStore: SymbolStore) {
        let visitor = new AstContextVisitor(this.position);
        this.parsedDoc.parseTree.traverse(visitor);
        this._phraseNode = visitor.phraseNode;
        this._scopeNode = visitor.scopeNode;
        this._namespaceNode = visitor.namespaceNode;
        this._thisNode = visitor.thisNode;
        this._concreteScopeNode = visitor.concreteScopeNode;
    }

    get token() {
        return this.parsedDoc.tokens[this.tokenIndex];
    }

    get phraseNode() {
        return this._phraseNode;
    }

    get scopeNode() {
        return this._scopeNode;
    }

    get concreteScopeNode() {
        return this._concreteScopeNode;
    }

    get tokenIndex() {
        if (this._tokenIndex === undefined) {
            this._tokenIndex = this.parsedDoc.tokenIndexAtPosition(this.position);
        }
        return this._tokenIndex;
    }

    get namespaceNode() {
        return this._namespaceNode;
    }

    get thisNode() {
        return this._thisNode;
    }

    get namespaceName() {
        return this._namespaceNode ? namespaceNodeToString(this._namespaceNode) : '';
    }

    get thisName() {
        if (!this._thisNode) {
            return '';
        }

        let thisName: string
        if ((<Phrase>this._thisNode.value).phraseType === PhraseType.AnonymousClassDeclaration) {
            thisName = anonymousName(this._thisNode);
        } else {
            thisName = tokenNodeToString(this._thisNode.children[0]);
            let nsName = this.namespaceName;
            if (thisName && nsName) {
                thisName = nsName + '\\' + thisName;
            }
        }

        return thisName;

    }

    get thisExtendsName() {
        let thisNode = this.thisNode;
        if(!thisNode || (<Phrase>thisNode.value).phraseType !== PhraseType.ClassDeclaration){
            return '';
        }

        let docSymbols = this.symbolStore.getSymbolTable(this.parsedDoc.uri);
        let nameResolver = new NameResolver(docSymbols.importTable);
        nameResolver.namespace = this.namespaceName;
        return nameNodeToFqnString(thisNode.children[2], nameResolver, SymbolKind.Class);

    }

    typeResolveExpression(node: Tree<Phrase | Token>) {

        let docSymbols = this.symbolStore.getSymbolTable(this.parsedDoc.uri);
        let nameResolver = new NameResolver(docSymbols.importTable);
        nameResolver.namespace = this.namespaceName;
        nameResolver.thisName = this.thisName;
        let exprTypeResolver = new ExpressionTypeResolver(nameResolver, this.symbolStore, this.typeResolveVariable);
        node.traverse(exprTypeResolver);
        return exprTypeResolver.type;

    }

    typeResolveVariable = (varNode: Tree<Phrase|Token>) => {

        let docSymbols = this.symbolStore.getSymbolTable(this.parsedDoc.uri);
        let nameResolver = new NameResolver(docSymbols.importTable);
        nameResolver.namespace = this.namespaceName;
        nameResolver.thisName = this.thisName;
        let varName = variableNodeToString(varNode);
        
        if (!varName) {
            return null;
        } else if (varName === '$this') {
            return new TypeString(nameResolver.thisName);
        } else {

            let varTable = new VariableTable();
            if (nameResolver.thisName) {
                varTable.pushThisType(new TypeString(nameResolver.thisName));
            }
            let varTypeResolver = new VariableTypeResolver(varTable, nameResolver,
                this.symbolStore, new ExpressionTypeResolver(nameResolver, this.symbolStore, this.typeResolveVariable),
                varNode, varName);

            this._concreteScopeNode.traverse(varTypeResolver);
            return varTypeResolver.variableTable.getType(varName);

        }

    }

}

